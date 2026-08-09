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

import { ASSISTANT_PROMPT } from '../src/data/prompt.js';
import { DEFAULT_TIER, isTier, modelForTier, TIER_IDS } from '../src/data/models.js';
import { send, fail, readJson, callerKey, methodAllowed } from './_lib/http.js';
import {
  MAX_CHAT_BYTES,
  MAX_CHAT_MESSAGES,
  MAX_OUTPUT_TOKENS,
  CHAT_TIMEOUT_MS,
  RATE_LIMITS,
  createRateLimiter,
} from './_lib/policy.js';

const HOST = 'https://generativelanguage.googleapis.com';

/**
 * Which model answers is a choice the person makes, out of three.
 *
 * The ladder, the ids and the reason each rung is an alias rather than a pinned
 * version all live in `src/data/models.js`, because the panel draws the same
 * table this resolves against. What stays here is the part that is nobody
 * else's business: a request names a *tier*, and this file turns it into an id.
 *
 * The fallback below is what a request that names no tier gets, which is every
 * request from a page cached before this feature existed.
 */
const DEFAULT_MODEL = modelForTier(DEFAULT_TIER, {});

/**
 * The handful worth suggesting, out of everything a key can call.
 *
 * A real key lists forty-odd models, most of which cannot hold a conversation
 * about a diagram — text-to-speech, image generation, robotics, music, deep
 * research. Printing all of them is a wall of text with the answer buried in
 * it. Aliases come first because they are the ones that do not go stale.
 */
export function suggestModels(available = []) {
  const chatty = (id) =>
    id.startsWith('gemini-') &&
    /(flash|pro)/.test(id) &&
    !/(tts|image|embedding|robotics|lyria|computer-use|deep-research|omni|customtools|nano-banana|antigravity)/.test(id);
  const usable = available.filter(chatty);
  const aliases = usable.filter((id) => id.endsWith('-latest'));
  const rest = usable.filter((id) => !id.endsWith('-latest'));
  return [...aliases, ...rest].slice(0, 8);
}

/**
 * Which API generation to call.
 *
 * `v1beta` carries the newest models and the widest feature set, and is what
 * the Gemini docs use. `v1` exists and lags. Configurable because "that model
 * does not exist" and "that model does not exist *on this version*" are the
 * same 404, and being able to try the other one without a deploy is the
 * difference between a minute and an afternoon.
 */
const apiVersion = (env) => String(env.GEMINI_API_VERSION ?? 'v1beta').trim() || 'v1beta';

/**
 * What this key is actually allowed to call.
 *
 * Only asked after a 404, and it is the whole answer to one: a model id is
 * right or wrong for a particular key, project and API version, and none of
 * those is visible from here. Listing them turns "no model called X" into
 * something someone can act on without guessing.
 */
async function listModels(key, version) {
  try {
    const response = await fetch(`${HOST}/${version}/models?pageSize=100`, {
      headers: { 'x-goog-api-key': key },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return (body.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m) => String(m.name ?? '').replace(/^models\//, ''))
      .filter(Boolean);
  } catch {
    return null;
  }
}

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
 * Three tools. Two of them are about the document and the pairing is
 * deliberate; the third, `ask_user`, is about the person, and is described
 * where it is declared.
 *
 * `replace_diagram` matches how this
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
export const FUNCTIONS = [
  {
    /*
     * The third tool, and the only one whose answer is not the document.
     *
     * The assistant sees exactly what was typed into the box and nothing else:
     * no repository, no URL, no disk. Handed a GitHub link it used to draw what
     * the name suggested — a service on Oracle Cloud running MySQL came back as
     * AWS and PostgreSQL, drawn confidently, with nothing in the picture to
     * mark which parts had been read and which were invented. There was no
     * third option available to it: answer, or refuse the whole request.
     *
     * `options` is a list of plain strings rather than a richer shape because
     * everything the person can do with it is click it, and the label is the
     * whole of what a click means. Free text stays available regardless — a
     * question worth asking is usually one whose best answer nobody listed.
     */
    name: 'ask_user',
    description:
      'Ask the person a question and wait for their answer. Use it when the diagram ' +
      'would differ depending on the answer and you cannot work it out from what they ' +
      'wrote — above all when you have been pointed at a repository, a URL or a file ' +
      'you cannot see, where the alternative is guessing at a system and drawing it ' +
      'wrongly. Offer options where the choice is between a few known answers. Ask ' +
      'once, and ask for everything you need in that one question rather than in three.',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The question, in the language the person is writing in. One or two sentences.',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Up to six answers to offer as buttons, each a few words. Optional: leave it ' +
            'out when the useful answer is something they have to type, such as a paste ' +
            'of a dependency list.',
        },
      },
      required: ['question'],
    },
  },
  {
    /*
     * The checks the prompt used to carry, as something to call instead.
     *
     * The authoring guide quotes a 337-line validator, because a model in a
     * chat window has a shell and no tools. In here that is exactly backwards:
     * the assistant cannot run anything, and 15,000 characters of a script it
     * has no way to execute went out with every single turn — a third of the
     * system prompt, paid for on each request, teaching a skill it could not
     * use. `ASSISTANT_PROMPT` cuts that section; this tool is what replaces it.
     *
     * The description is doing real work rather than naming the function. It is
     * the one piece of text about checking that a model in this editor still
     * reads, so it carries what the section it replaced was for: what the
     * checks catch, what the two levels mean, and — the part models get wrong —
     * that a report is something to act on rather than to summarise back.
     */
    name: 'validate_diagram',
    description:
      'Check the diagram that is open for the faults that make one unreadable: a block ' +
      'hidden behind a taller one in front, a connection that vanishes under a block, ' +
      'blocks overlapping, a block outside the zone it claims, zones that half-overlap, ' +
      'a nested zone too close in colour to its parent, captions left lying on the floor ' +
      'or written as sentences, a caption naming a group of things rather than one, notes ' +
      'too small to read on the ground, and too many connections for the number of blocks. ' +
      'Call it after every edit, before you reply — none of this is visible in the JSON, ' +
      'and you cannot see the screen. ERROR means the picture is visibly broken: fix it and ' +
      'send the document again rather than telling the person it worked. WARN means it is ' +
      'uglier than it needs to be: fix unless you can say why not. Reporting the findings ' +
      'back to the person instead of acting on them is the one wrong way to use this.',
  },
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
  {
    /*
     * The way to draw a second picture without touching the first.
     *
     * The authoring rules say a system too big for one diagram is two
     * diagrams — and a model with only `replace_diagram` has one way to obey
     * that, which is to send a whole file with both drawings in it. It is
     * refused there, and it should be: the person's file is not the model's to
     * rewrite, and the drawings it cannot see would go with it.
     *
     * So the second diagram gets a tool of its own, and the description is
     * written mostly to say when *not* to reach for it. A model given a way to
     * make tabs will make a tab per subsystem out of tidiness, and four
     * half-empty drawings are worse than one honest crowded one.
     */
    name: 'add_tab',
    description:
      'Add a new drawing to the file as a tab, beside the one already open, and switch ' +
      'to it. Use it when one picture genuinely will not hold the answer — a system past ' +
      'about 25 blocks, or a second view (a write path, a failover) the person asked for ' +
      'alongside the first. Never use it to tidy one diagram into several, and never as a ' +
      'way to avoid editing what is open: a change to the drawing they are looking at is ' +
      '`replace_diagram`. You cannot create files, delete tabs or reach the drawings in ' +
      'other tabs; to work in one of those, ask the person to click it.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            'What the tab is called, after what it shows — "Overview", "Write path", ' +
            '"Failover". A few words, in the language the person is writing in.',
        },
        document: {
          type: 'string',
          description:
            'The new drawing as a complete .arch.json document in JSON text, with `nodes` ' +
            'at the top level. Never wrapped in `tabs`: this is one drawing, not a file.',
        },
      },
      required: ['name', 'document'],
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
const SYSTEM = `${ASSISTANT_PROMPT}

---

## You are the assistant inside the Massing editor

Everything above is how to write these documents. What follows is how to work
here.

- The person you are talking to is looking at a diagram. Call \`get_diagram\`
  before your first edit of a conversation, and again whenever they might have
  changed it themselves.
- Make changes with \`replace_diagram\`, passing the complete document as JSON
  text. Keep the ids that already exist.
- A file may hold several drawings as tabs, but you only ever see and replace
  **the one they are looking at**. Send it as a plain document — never wrap
  what you send in \`tabs\`, which would replace the open drawing with a file
  inside it. To work on another existing drawing, ask them to click its tab.
- **You never create files.** The file is theirs; it may be saved on their disk
  and it may hold drawings you cannot see. When the rules above call for a
  second diagram, that second diagram is a **tab** — call \`add_tab\` with the
  new drawing. Nothing else about their file changes, and closing the tab is
  how they undo you.
- Count the connections before you send: at most one per three blocks. The tool
  result says so when you have overspent, and that is a thing to fix and send
  again — not a note to acknowledge in your reply.
- A question may end with \`[Selected in the editor: …]\`. Those are the things
  the person had selected when they asked, and the request is almost certainly
  about them — "make these blue" means those. Change what they name and leave
  the rest of the document alone.
- The tool result lists what the loader repaired and what it refused. Those are
  real problems in what you sent — fix them and send again rather than telling
  the person it worked.
- Reply in prose, not JSON. The document goes through the tool; your message is
  for the person. Two or three sentences, saying what you changed and why, is
  the right length. They can see the diagram, so do not describe it back to
  them.
- If a request is ambiguous in a way that changes the drawing, ask with
  \`ask_user\` rather than in prose: a question in your reply ends the turn and
  makes them start another one, while \`ask_user\` keeps the turn open and
  carries on with the answer. If it is ambiguous in a way that does not change
  the drawing, choose and say which way you went.
- **You cannot see anything they have not typed.** No repository, no URL, no
  file on their machine. Pointed at one, ask for what you need — the build
  file, the dependency list, the output of \`tree\` — or offer to draw a typical
  system of that kind and label it as that. Do not draw a named system from its
  name alone; it comes out plausible and wrong, and they cannot tell which.
- The tool result may say the diagram is thinner than the system described, or
  that a caption reads as a group of things rather than one thing. Both are
  real defects in what you sent. Fix them and send again.
- After an edit lands, call \`validate_diagram\` and act on what it says before
  you reply. You cannot see the drawing; that tool is the only thing here that
  can. A turn that ends with an unfixed ERROR has reported success on a broken
  picture.
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
    if (typeof message.signature === 'string') clean.signature = message.signature;
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
          ...(typeof call.signature === 'string' ? { signature: call.signature } : {}),
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
 * Four things differ and all four are handled here. Gemini's assistant role is
 * `model`. A tool result is not its own role — it is a `functionResponse` part
 * in a *user* turn, and consecutive results belong in one turn. There are no
 * call ids: a response is matched to its call by function name, so the ids the
 * client keeps are looked up here and dropped rather than sent.
 *
 * And the thinking models — everything from Gemini 3 on — stamp each part they
 * produce with a `thoughtSignature`, and refuse the *next* request if the parts
 * come back without it. The proxy neither reads nor understands those; it
 * carries them, out through the tool call and back in again. That is what the
 * `signature` field on our own message shape is for, and it is the one place
 * this format is not purely ours: a conversation that dropped them worked
 * perfectly on its first turn and 400'd on its second, which is the shape of
 * bug worth a comment.
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
      if (message.content) {
        parts.push({
          text: message.content,
          ...(message.signature ? { thoughtSignature: message.signature } : {}),
        });
      }
      for (const call of message.tool_calls ?? []) {
        nameOfCall.set(call.id, call.function.name);
        let args = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          args = {};
        }
        parts.push({
          functionCall: { name: call.function.name, args },
          ...(call.signature ? { thoughtSignature: call.signature } : {}),
        });
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
    if (typeof part.text === 'string') {
      message.content += part.text;
      if (part.thoughtSignature) message.signature = part.thoughtSignature;
    }
    if (part.functionCall) {
      calls.push({
        id: `${part.functionCall.name}-${index}`,
        type: 'function',
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args ?? {}),
        },
        // Carried, not understood. See `toContents`.
        ...(part.thoughtSignature ? { signature: part.thoughtSignature } : {}),
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
  if (status === 400 && /thought signature/i.test(message)) {
    // A conversation saved before the proxy knew to keep these can never be
    // continued, however many times it is retried. Saying so beats repeating
    // Google's wording at someone who has no way to act on it.
    return [502, 'This conversation was saved before the editor knew to keep the model\'s reasoning signatures, so it cannot be continued. Start a new one — your diagram is untouched.'];
  }
  if (status === 403) return [502, 'The Gemini API key is not allowed to use this model.'];
  // Everything else quotes Google. A 400 from this endpoint is almost always a
  // request this proxy built wrongly, and the upstream message is the only
  // thing that says which part -- so throwing it away in favour of "could not
  // be reached" costs exactly the sentence that would have explained it.
  return [502, message
    ? `The model refused the request (${status}): ${message}`
    : `The model could not be reached (${status}).`];
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

  /*
   * A tier, not a model id. Absent means the request came from a page that
   * predates the picker, which is a normal thing for a cached page to be and
   * gets the default rather than an error. A tier that is *named* and unknown
   * is a client sending something this deployment does not have, and saying so
   * beats quietly answering with a different model than the one asked for.
   */
  const asked = body.value?.model;
  if (asked !== undefined && !isTier(asked)) {
    return fail(res, 400, `Unknown model "${asked}". Choose one of: ${TIER_IDS.join(', ')}.`);
  }
  const tier = asked ?? DEFAULT_TIER;
  const model = modelId(modelForTier(tier, process.env));

  try {
    const version = apiVersion(process.env);
    const upstream = await fetch(`${HOST}/${version}/models/${encodeURIComponent(model)}:generateContent`, {
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
      console.error('gemini refused', model, version, upstream.status, result?.error?.message ?? '');
      /*
       * A 404 is the one refusal worth a second request. It means this key
       * cannot call this model on this API version, and which of those three is
       * wrong is not visible from here -- so ask, and put the answer in the
       * message rather than leaving someone to guess at model ids.
       */
      if (upstream.status === 404) {
        const models = await listModels(key, version);
        const suggested = suggestModels(models ?? []);
        /*
         * Google's own words first when it gave any. A retired model is the
         * case that reads as nonsense otherwise: it is still in the listing, so
         * "no model called that" is plainly untrue, and the reason -- closed to
         * new keys -- is a thing only this message says.
         */
        const why = result?.error?.message
          ? result.error.message.replace(/^\s*/, '')
          : `No model called "${model}" on ${version}.`;
        const next = suggested.length
          ? ` Set MASSING_AI_MODEL to one of: ${suggested.join(', ')}.`
          : models?.length
            ? ' None of the models this key lists can hold a conversation.'
            : ' This key could not list any models at all, which usually means the key itself is the problem rather than the model name.';
        return fail(res, 502, `${why}${next}`, {
          model,
          apiVersion: version,
          suggested,
          available: models ?? undefined,
          upstream: result?.error?.message ?? undefined,
        });
      }
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
      // Both, because they answer different questions: the tier is what was
      // asked for, and `model` is what a pinned deployment actually used.
      tier,
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
