/**
 * Talking to a model about the diagram on screen.
 *
 * The conversation is the browser's. `/api/chat` is a proxy that keeps the key
 * off the client and puts the authoring rules in front of every turn; it holds
 * nothing between calls. What that buys is the important part: when the model
 * asks to change the diagram, the change is applied *here*, to the document
 * actually open, through the same store and the same undo history as a change
 * made by hand. Undo works on it. Reload does not lose it. The model is another
 * editor of the document, not the owner of a copy.
 *
 * A turn is therefore a loop rather than a request: send, and if the answer is
 * a tool call, run it, append the result, and send again. It ends when the
 * model replies with words, or when the loop has gone round enough times that
 * something is clearly wrong.
 */

import { serializeDoc, normalizeDoc } from './schema.js';

const SESSIONS_KEY = 'massing:chat:v1';

/**
 * How many tool calls one question may make.
 *
 * Read, write, read again to check, write again is four, and that is a model
 * working carefully. Past about eight it is a model stuck in a loop, and the
 * cost of finding out is a real bill, so the loop stops and says so.
 */
const MAX_STEPS = 8;

/** Sessions kept, newest first. Old conversations are not worth a quota crash. */
const MAX_SESSIONS = 20;

/**
 * The house rule the loader cannot enforce, said back in the tool result.
 *
 * Written into the prompt, it is advice a model agrees with and then overspends
 * anyway — measured against the live model, six diagrams out of six came back
 * over the limit, averaging a connection per block instead of one per three.
 * Said *here* it is feedback inside the loop, arriving after the mistake with
 * the arithmetic already done, which the model is told to fix and send again.
 *
 * Advisory, not a refusal: the edit is applied either way. Someone may have
 * asked for exactly those connections, and a style rule is not grounds for
 * throwing away a document that loads.
 *
 * It says which way to cut, because the first version did not and the model
 * found the other one: asked for a load balancer, two web servers and a
 * database, it came back under budget by drawing a single web server. Losing a
 * block someone asked for is a worse answer than the tangle this prevents.
 *
 * The threshold is the validator's, not a second opinion — over one per two
 * complains, one per three is the target it names.
 */
export function overConnected(doc) {
  const blocks = doc.nodes.length;
  const lines = doc.edges.length;
  if (!blocks || lines / blocks <= 0.5) return null;
  const budget = Math.max(1, Math.floor(blocks / 3));
  return (
    `Too many connections: ${lines} for ${blocks} blocks. The budget is one per ` +
    `three, so cut it to ${budget}. Delete connections, never blocks: every block ` +
    `stays exactly as it is. What to remove is whatever repeats something the ` +
    `grouping already says — a load balancer's second arm, two servers reaching ` +
    `the same database. Send the document again with those lines gone.`
  );
}

/** How long a change stays lit after the assistant makes it. */
const HIGHLIGHT_MS = 3200;

/**
 * What actually changed between two documents, by id.
 *
 * The assistant replaces the whole document every time, so "what did it do"
 * cannot be read off the call — it has to be worked out by comparing. Anything
 * new, and anything whose contents differ, is something to point at; everything
 * else was carried across unchanged and pointing at it would be noise.
 */
export function touchedIds(before, after) {
  const index = (doc) => {
    const map = new Map();
    for (const kind of ['nodes', 'groups', 'edges', 'texts', 'images']) {
      for (const entity of doc?.[kind] ?? []) map.set(entity.id, JSON.stringify(entity));
    }
    return map;
  };
  const was = index(before);
  const now = index(after);
  const changed = [];
  for (const [id, shape] of now) {
    if (was.get(id) !== shape) changed.push(id);
  }
  // A document rewritten from nothing is entirely new, and lighting every
  // block up says less than lighting none of them.
  return changed.length === now.size && was.size === 0 ? [] : changed;
}

/**
 * The selection, described for a model that cannot see the screen.
 *
 * Sent with the question rather than fetched by a tool call: "make these three
 * blue" is unanswerable without it, and a round trip to ask which ones were
 * meant is a round trip the person is waiting through.
 */
export function describeSelection(doc, selection) {
  if (!selection?.length) return null;
  const find = (id) => {
    for (const [kind, list] of [
      ['block', doc.nodes], ['zone', doc.groups], ['connection', doc.edges],
      ['note', doc.texts], ['picture', doc.images],
    ]) {
      const found = list?.find((e) => e.id === id);
      if (found) return `${id} (${kind}${found.label ? `, "${found.label}"` : ''})`;
    }
    return id;
  };
  return selection.map(find).join(', ');
}

/** A short, stable id without pulling in anything to generate one. */
function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * A name for a conversation, taken from how it opened.
 *
 * The first thing someone types is almost always what the conversation is
 * about, which beats numbering them and beats asking a model to name it.
 */
function titleFrom(text) {
  const line = String(text ?? '').trim().split('\n')[0];
  return line.length > 48 ? `${line.slice(0, 47)}…` : line || 'New conversation';
}

// ---------------------------------------------------------------------------
// Stored sessions
// ---------------------------------------------------------------------------

export function readSessions() {
  try {
    const raw = JSON.parse(localStorage.getItem(SESSIONS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((s) => s?.id && Array.isArray(s.messages)) : [];
  } catch {
    return [];
  }
}

export function writeSessions(sessions) {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
    return true;
  } catch {
    // Quota, or storage walled off. The conversation on screen still works; it
    // just will not be there tomorrow.
    return false;
  }
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

/**
 * @param {{store: object, commands?: object}} deps
 */
export function createAssistant({ store, commands, fetchImpl = fetch } = {}) {
  let sessions = readSessions();
  let currentId = sessions[0]?.id ?? null;
  let busy = false;
  const listeners = new Set();

  const announce = () => {
    for (const listener of listeners) listener();
  };

  function current() {
    return sessions.find((s) => s.id === currentId) ?? null;
  }

  function persist() {
    writeSessions(sessions);
    announce();
  }

  /**
   * Point at what just changed, then stop pointing at it.
   *
   * The assistant replaces the whole document, so without this the diagram
   * simply *is* different and finding out how is on the reader. The timer is
   * replaced rather than stacked: two edits in a row should leave the second
   * one lit for its full time, not the remainder of the first one's.
   */
  let highlightTimer = 0;
  function highlight(ids) {
    clearTimeout(highlightTimer);
    store.setUI({ aiTouched: ids });
    if (!ids.length) return;
    highlightTimer = setTimeout(() => store.setUI({ aiTouched: [] }), HIGHLIGHT_MS);
  }

  function startSession(firstMessage) {
    const session = {
      id: newId(),
      title: titleFrom(firstMessage),
      at: Date.now(),
      messages: [],
    };
    sessions = [session, ...sessions].slice(0, MAX_SESSIONS);
    currentId = session.id;
    return session;
  }

  /**
   * Carry out one tool call against the open document.
   *
   * The result string is what the model reads next, so it is written for a
   * reader rather than as a status code: a refusal says what was wrong with
   * what it sent, and an acceptance names what the loader had to repair, so the
   * next turn can fix it instead of reporting success.
   */
  function runTool(name, args) {
    if (name === 'get_diagram') {
      return serializeDoc(store.state.doc);
    }

    if (name === 'replace_diagram') {
      /*
       * The document arrives as JSON text, because that is the only way to ask
       * for "a document of the shape you were taught" through a function schema
       * that cannot express it. An object is accepted too: a model that sends
       * one has done nothing wrong, and refusing it would be pedantry.
       */
      let incoming = args?.document;
      if (typeof incoming === 'string') {
        try {
          incoming = JSON.parse(incoming);
        } catch (err) {
          return `Refused: \`document\` is not valid JSON — ${err.message}`;
        }
      }
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
        return 'Refused: `document` must be a complete .arch.json document.';
      }
      const parsed = normalizeDoc(incoming);
      if (parsed.rejection) {
        return `Refused: that is not a diagram — ${parsed.rejection}`;
      }
      // Worked out before the swap, or there is nothing left to compare with.
      const touched = touchedIds(store.state.doc, parsed.doc);
      // Through the store, so it is one undo away like any other edit.
      store.replaceDoc(parsed.doc, 'Assistant edit');
      commands?.zoomFit?.();
      highlight(touched);
      const counts =
        `${parsed.doc.nodes.length} blocks, ${parsed.doc.groups.length} zones, ` +
        `${parsed.doc.edges.length} connections, ${parsed.doc.texts.length} notes`;
      const lines = [];
      if (parsed.warnings.length) {
        lines.push(
          `Applied, with ${parsed.warnings.length} thing(s) the loader had to repair.`,
          'These are problems in what you sent. Fix them and send the document again:',
          ...parsed.warnings.map((w) => `- ${w}`)
        );
      } else {
        lines.push('Applied.');
      }
      lines.push(`The diagram now has ${counts}.`);
      const overspent = overConnected(parsed.doc);
      if (overspent) lines.push(overspent);
      return lines.join('\n');
    }

    return `Refused: there is no tool called "${name}".`;
  }

  /** One exchange with the proxy. Throws with a readable message on failure. */
  async function callModel(messages) {
    const response = await fetchImpl('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? `The assistant failed (${response.status}).`);
    return body;
  }

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get busy() {
      return busy;
    },
    get sessions() {
      return sessions;
    },
    get currentId() {
      return currentId;
    },
    /** Only the turns worth showing: what was said, not the plumbing. */
    get visible() {
      return (current()?.messages ?? []).filter(
        (m) => (m.role === 'user' || m.role === 'assistant') && m.content?.trim()
      );
    },

    select(id) {
      if (sessions.some((s) => s.id === id)) {
        currentId = id;
        announce();
      }
    },
    startNew() {
      currentId = null;
      announce();
    },
    remove(id) {
      sessions = sessions.filter((s) => s.id !== id);
      if (currentId === id) currentId = sessions[0]?.id ?? null;
      persist();
    },

    /**
     * Ask something, and run whatever the answer asks for.
     *
     * @returns {Promise<{ok: boolean, error?: string}>}
     */
    /**
     * @param {{selection?: string[]}} context  what was selected when asked.
     */
    async ask(text, { selection } = {}) {
      const question = String(text ?? '').trim();
      if (!question || busy) return { ok: false };
      busy = true;

      const attached = describeSelection(store.state.doc, selection);
      const session = current() ?? startSession(question);
      // Appended to the question rather than sent as its own turn: it is part
      // of what was asked, and a conversation reloaded tomorrow should still
      // show why the answer was about those particular blocks.
      session.messages.push({
        role: 'user',
        content: attached ? `${question}\n\n[Selected in the editor: ${attached}]` : question,
      });
      session.at = Date.now();
      persist();

      try {
        for (let step = 0; step < MAX_STEPS; step++) {
          const { message } = await callModel(session.messages);
          session.messages.push(message);
          persist();

          const calls = message.tool_calls ?? [];
          if (!calls.length) return { ok: true };

          for (const call of calls) {
            let args = {};
            try {
              args = JSON.parse(call.function.arguments || '{}');
            } catch {
              // Malformed arguments are the model's mistake to correct, so they
              // come back as a tool result rather than as an exception here.
              session.messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: 'Refused: the arguments were not valid JSON.',
              });
              continue;
            }
            session.messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: runTool(call.function.name, args),
            });
          }
          persist();
        }
        const stuck = 'The assistant kept working without finishing. Stopped it there.';
        session.messages.push({ role: 'assistant', content: stuck });
        persist();
        return { ok: false, error: stuck };
      } catch (err) {
        return { ok: false, error: err.message };
      } finally {
        busy = false;
        announce();
      }
    },
  };
}
