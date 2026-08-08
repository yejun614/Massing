/**
 * POST /api/chat — one turn of the assistant, against the Gemini API.
 *
 * The proxy has three jobs: keep the key off the client, put the house rules in
 * front of every conversation, and describe the tools. It holds no state — the
 * conversation lives in the browser, and so does the diagram.
 *
 * That last point is the design. The tools are *not* executed here. The model
 * asks to read or replace the diagram, this endpoint hands the request back,
 * and the editor carries it out against the document actually on screen before
 * asking again. A server editing its own copy would be editing a document
 * nobody is looking at.
 *
 * The wire format between the browser and here is ours, not Google's: the
 * client speaks in `{role, content, tool_calls, tool_call_id}` and this file
 * translates both ways. That is worth the fifty lines it costs. Conversations
 * are already sitting in people's `localStorage`, and a provider's request
 * shape is not something to write into storage that has to outlive it.
 *
 * Request:  { messages: [{role, content, tool_calls?, tool_call_id?}] }
 * Response: { message, finishReason, usage }
 */

import { LLM_PROMPT } from '../src/data/prompt.js';
import { send, fail, readJson, callerKey, methodAllowed } from './_lib/http.js';
import {
  MAX_CHAT_BYTES,
  MAX_CHAT_MESSAGES,
  MAX_OUTPUT_TOKENS,
  CHAT_TIMEOUT_MS,
  RATE_LIMITS,
  createRateLimiter,
} from './_lib/policy.js';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.5-flash-lite';

/**
 * The bare model id, whatever form it was configured in.
 *
 * Gemini wants `gemini-2.5-flash-lite`. Two other spellings turn up and both
 * 404 without saying why: `models/gemini-2.5-flash-lite`, which is how the API
 * names it in its own responses, and `google/gemini-2.5-flash-lite`, which is
 * the vendor-prefixed form every gateway uses — and which this project's own
 * setup notes told people to configure, back when it went through one. An
 * environment variable that was correct last week should not be a 404 today.
 */
export function modelId(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return DEFAULT_MODEL;
  const bare = trimmed.split('/').filter(Boolean).pop();
  return bare || DEFAULT_MODEL;
}

const limiter = createRateLimiter(RATE_LIMITS.chat);

/**
 * What the model may do to the editor.
 *
 * Two tools, and the pair is deliberate. `replace_diagram` matches how this
 * format is meant to be edited — the authoring rules already say to return the
 * complete document rather than a patch, because renaming an id silently breaks
 * every connection pointing at it, and a patch language would be a second way
 * to get that wrong. `get_diagram` is what makes that safe: read what is there,
 * then send back all of it with the change in place.
 *
 * The document goes across as *text* rather than as a declared object. Gemini's
 * function schema is an OpenAPI subset with no `additionalProperties`, so there
 * is no way to say "an object of the shape you were taught" — and writing the
 * whole `.arch.json` schema out here would be a second specification to keep in
 * step with the one in the system prompt. A string sidesteps both: the model is
 * already being told to write this document, and malformed JSON comes back as a
 * tool result it can correct rather than as a schema violation it cannot see.
 */
const FUNCTIONS = [
  {
    name: 'get_diagram',
    description:
      'Read the diagram currently open in the editor, as a .arch.json document. ' +
      'Call this before any edit so you are changing what is actually on screen, ' +
      'and so you keep the ids that already exist.',
  },
  {
    name: 'replace_diagram',
    description:
      'Replace what is open in the editor with a complete .arch.json document. ' +
      'Send the whole document, never a fragment: anything left out is deleted. ' +
      'The result reports whatever the loader had to repair, so read it and fix ' +
      'what it names rather than assuming the edit landed as written.',
    parameters: {
      type: 'object',
      properties: {
        document: {
          type: 'string',
          description: 'A complete .arch.json document as JSON text, in the format described above.',
        },
        summary: {
          type: 'string',
          description: 'One short line naming what changed, shown to the person watching.',
        },
      },
      required: ['document'],
    },
  },
];

/**
 * The house rules, plus the little the model needs to know about being here.
 *
 * The authoring guide is the same text the toolbar copies and the skill is
 * generated from, so an assistant in the editor and a model in a chat window
 * are working from one specification rather than two that drift.
 */
const SYSTEM = `${LLM_PROMPT}

---

## You are the assistant inside the Massing editor

Everything above is how to write these documents. What follows is how to work
here.

- The person you are talking to is looking at a diagram. Call \`get_diagram\`
  before your first edit of a conversation, and again whenever they might have
  changed it themselves.
- Make changes with \`replace_diagram\`, passing the complete document as JSON
  text. Keep the ids that already exist.
- The tool result lists what the loader repaired and what it refused. Those are
  real problems in what you sent — fix them and send again rather than telling
  the person it worked.
- Reply in prose, not JSON. The document goes through the tool; your message is
  for the person. Two or three sentences, saying what you changed and why, is
  the right length. They can see the diagram, so do not describe it back to
  them.
- If a request is ambiguous in a way that changes the drawing, ask. If it is
  ambiguous in a way that does not, choose and say which way you went.
- Answer in the language the person is writing in.`;

/** Only the fields we understand, and only from roles we understand. */
function sanitiseMessages(raw) {
  if (!Array.isArray(raw)) return { error: '`messages` must be a list.' };
  const roles = new Set(['user', 'assistant', 'tool']);
  const out = [];
  for (const message of raw.slice(-MAX_CHAT_MESSAGES)) {
    if (!message || typeof message !== 'object') continue;
    if (!roles.has(message.role)) continue;
    const clean = { role: message.role };
    if (typeof message.content === 'string') clean.content = message.content;
    if (message.role === 'tool') {
      if (typeof message.tool_call_id !== 'string') continue;
      clean.tool_call_id = message.tool_call_id;
      clean.content = typeof message.content === 'string' ? message.content : '';
    }
    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      clean.tool_calls = message.tool_calls
        .filter((call) => call?.id && call?.function?.name)
        .map((call) => ({
          id: String(call.id),
          type: 'function',
          function: {
            name: String(call.function.name),
            arguments: typeof call.function.arguments === 'string'
              ? call.function.arguments
              : JSON.stringify(call.function.arguments ?? {}),
          },
        }));
      // An assistant turn with neither words nor a call is nothing at all, and
      // a turn with no parts is rejected upstream.
      if (!clean.tool_calls.length && !clean.content) continue;
    }
    if (clean.content === undefined && !clean.tool_calls) continue;
    out.push(clean);
  }
  if (!out.length) return { error: 'There is nothing to send.' };
  return { messages: out };
}

/**
 * Our shape into Gemini's `contents`.
 *
 * Three things differ and all three are handled here. Gemini's assistant role
 * is `model`. A tool result is not its own role — it is a `functionResponse`
 * part in a *user* turn, and consecutive results belong in one turn. And there
 * are no call ids: a response is matched to its call by function name, so the
 * ids the client keeps are looked up here and dropped rather than sent.
 */
function toContents(messages) {
  const contents = [];
  const nameOfCall = new Map();

  for (const message of messages) {
    if (message.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: message.content ?? '' }] });
      continue;
    }

    if (message.role === 'assistant') {
      const parts = [];
      if (message.content) parts.push({ text: message.content });
      for (const call of message.tool_calls ?? []) {
        nameOfCall.set(call.id, call.function.name);
        let args = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          args = {};
        }
        parts.push({ functionCall: { name: call.function.name, args } });
      }
      if (parts.length) contents.push({ role: 'model', parts });
      continue;
    }

    // A tool result. `response` has to be an object, so a plain string result
    // is wrapped rather than sent bare.
    const part = {
      functionResponse: {
        name: nameOfCall.get(message.tool_call_id) ?? 'unknown',
        response: { result: message.content ?? '' },
      },
    };
    const last = contents[contents.length - 1];
    if (last?.role === 'user' && last.parts.every((p) => p.functionResponse)) last.parts.push(part);
    else contents.push({ role: 'user', parts: [part] });
  }
  return contents;
}

/**
 * Gemini's candidate back into our shape.
 *
 * Call ids are invented here because the client's loop is built around them and
 * Gemini has none. They only have to be unique within the turn: the client uses
 * one to label the result it sends back, and `toContents` turns it into a name
 * again on the way out.
 */
function fromCandidate(candidate) {
  const parts = candidate?.content?.parts ?? [];
  const message = { role: 'assistant', content: '' };
  const calls = [];

  for (const [index, part] of parts.entries()) {
    if (typeof part.text === 'string') message.content += part.text;
    if (part.functionCall) {
      calls.push({
        id: `${part.functionCall.name}-${index}`,
        type: 'function',
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args ?? {}),
        },
      });
    }
  }
  if (calls.length) message.tool_calls = calls;
  return message;
}

/** The refusals worth telling someone apart from "it did not work". */
function describeRefusal(status, body, model) {
  const message = body?.error?.message ?? '';
  if (status === 429) return [429, 'Gemini is rate limited right now, or the quota is spent. Try again in a moment.'];
  if (status === 400 && /API key not valid/i.test(message)) return [502, 'The Gemini API key is not valid.'];
  if (status === 403) return [502, 'The Gemini API key is not allowed to use this model.'];
  if (status === 404) {
    // Naming it is the whole point: this is nearly always a model id that is
    // right for some other provider, and unnameable it looks like an outage.
    return [502, `No model called "${model}" — check MASSING_AI_MODEL, or leave it unset for ${DEFAULT_MODEL}.`];
  }
  return [502, `The model could not be reached (${status}).`];
}

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ['POST'])) return;

  const key = process.env.GEMINI_API_KEY;
  if (!key) return fail(res, 503, 'The assistant is not configured on this deployment.');

  const allowed = limiter.check(callerKey(req));
  if (!allowed.ok) {
    return fail(res, 429, 'That is a lot of questions at once. Give it a moment.', {
      retryAfter: allowed.retryAfter,
    });
  }

  const body = await readJson(req, MAX_CHAT_BYTES);
  if (!body.ok) return fail(res, body.status, body.error);

  const sanitised = sanitiseMessages(body.value?.messages);
  if (sanitised.error) return fail(res, 400, sanitised.error);

  const model = modelId(process.env.MASSING_AI_MODEL);

  try {
    const upstream = await fetch(`${API}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        // In the header rather than the query string: a key in a URL ends up in
        // access logs, proxies and error reports.
        'x-goog-api-key': key,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: toContents(sanitised.messages),
        tools: [{ functionDeclarations: FUNCTIONS }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
        generationConfig: {
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          temperature: 0.4,
        },
      }),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });

    const result = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      console.error('gemini refused', model, upstream.status, result?.error?.message ?? '');
      const [status, message] = describeRefusal(upstream.status, result, model);
      return fail(res, status, message);
    }

    // A prompt refused outright answers with no candidate at all, which would
    // otherwise read as an empty reply.
    if (result?.promptFeedback?.blockReason) {
      return fail(res, 422, `The model declined to answer (${result.promptFeedback.blockReason}).`);
    }
    const candidate = result?.candidates?.[0];
    if (!candidate) return fail(res, 502, 'The model returned nothing usable.');

    const message = fromCandidate(candidate);
    if (!message.content && !message.tool_calls) {
      // Running out of room mid-answer is the common cause, and saying which it
      // was beats an empty bubble.
      const why = candidate.finishReason === 'MAX_TOKENS'
        ? 'The answer was longer than the reply limit. Ask for a smaller change.'
        : `The model stopped without answering (${candidate.finishReason ?? 'no reason given'}).`;
      return fail(res, 502, why);
    }

    return send(res, 200, {
      message,
      finishReason: candidate.finishReason ?? null,
      usage: result.usageMetadata
        ? {
            prompt_tokens: result.usageMetadata.promptTokenCount ?? null,
            completion_tokens: result.usageMetadata.candidatesTokenCount ?? null,
            total_tokens: result.usageMetadata.totalTokenCount ?? null,
          }
        : null,
      model: result.modelVersion ?? model,
    });
  } catch (err) {
    console.error('chat failed', err);
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      return fail(res, 504, 'The model took too long to answer.');
    }
    return fail(res, 502, 'The model could not be reached.');
  }
}
