/**
 * POST /api/chat — one turn of the assistant, through Vercel AI Gateway.
 *
 * The gateway speaks the OpenAI chat-completions shape, so this is a proxy with
 * three jobs: keep the key off the client, put the house rules in front of
 * every conversation, and describe the tools. It holds no state — the
 * conversation lives in the browser, and so does the diagram.
 *
 * That last point is the design. The tools are *not* executed here. The model
 * asks to read or replace the diagram, this endpoint hands the request back,
 * and the editor carries it out against the document actually on screen before
 * asking again. A server that edited its own copy would be editing a document
 * nobody is looking at.
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

const GATEWAY = 'https://ai-gateway.vercel.sh/v1/chat/completions';
const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';

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
 * The document is not described here beyond "the format you were taught". The
 * system prompt is the specification, and repeating a schema next to it is how
 * the two come to disagree.
 */
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_diagram',
      description:
        'Read the diagram currently open in the editor, as a .arch.json document. ' +
        'Call this before any edit so you are changing what is actually on screen, ' +
        'and so you keep the ids that already exist.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
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
            type: 'object',
            description: 'A complete .arch.json document, in the format described above.',
          },
          summary: {
            type: 'string',
            description: 'One short line naming what changed, shown to the person watching.',
          },
        },
        required: ['document'],
        additionalProperties: false,
      },
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
- Make changes with \`replace_diagram\`, sending the complete document. Keep the
  ids that already exist.
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

/** Only the fields the upstream accepts, and only from roles we understand. */
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
      // some providers reject it outright.
      if (!clean.tool_calls.length && !clean.content) continue;
    }
    if (clean.content === undefined && !clean.tool_calls) continue;
    out.push(clean);
  }
  if (!out.length) return { error: 'There is nothing to send.' };
  return { messages: out };
}

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ['POST'])) return;

  const key = process.env.AI_GATEWAY_API_KEY;
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

  const model = process.env.MASSING_AI_MODEL || DEFAULT_MODEL;

  try {
    const upstream = await fetch(GATEWAY, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: SYSTEM }, ...sanitised.messages],
        tools: TOOLS,
        tool_choice: 'auto',
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      console.error('gateway refused', upstream.status, detail);
      // The two the person can act on, told apart from everything else.
      if (upstream.status === 429) {
        return fail(res, 429, 'The model is rate limited right now. Try again in a moment.');
      }
      if (upstream.status === 402) {
        return fail(res, 402, 'The AI Gateway account is out of credit.');
      }
      return fail(res, 502, `The model could not be reached (${upstream.status}).`);
    }

    const result = await upstream.json();
    const choice = result.choices?.[0];
    if (!choice?.message) return fail(res, 502, 'The model returned nothing usable.');

    return send(res, 200, {
      message: choice.message,
      finishReason: choice.finish_reason ?? null,
      usage: result.usage ?? null,
      model: result.model ?? model,
    });
  } catch (err) {
    console.error('chat failed', err);
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      return fail(res, 504, 'The model took too long to answer.');
    }
    return fail(res, 502, 'The model could not be reached.');
  }
}
