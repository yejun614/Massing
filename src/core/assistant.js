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
      const incoming = args?.document;
      if (!incoming || typeof incoming !== 'object') {
        return 'Refused: `document` must be a complete .arch.json object.';
      }
      const parsed = normalizeDoc(incoming);
      if (parsed.rejection) {
        return `Refused: that is not a diagram — ${parsed.rejection}`;
      }
      // Through the store, so it is one undo away like any other edit.
      store.replaceDoc(parsed.doc, 'Assistant edit');
      commands?.zoomFit?.();
      const counts =
        `${parsed.doc.nodes.length} blocks, ${parsed.doc.groups.length} zones, ` +
        `${parsed.doc.edges.length} connections, ${parsed.doc.texts.length} notes`;
      if (!parsed.warnings.length) return `Applied. The diagram now has ${counts}.`;
      return [
        `Applied, with ${parsed.warnings.length} thing(s) the loader had to repair.`,
        'These are problems in what you sent. Fix them and send the document again:',
        ...parsed.warnings.map((w) => `- ${w}`),
        `The diagram now has ${counts}.`,
      ].join('\n');
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
    async ask(text) {
      const question = String(text ?? '').trim();
      if (!question || busy) return { ok: false };
      busy = true;

      const session = current() ?? startSession(question);
      session.messages.push({ role: 'user', content: question });
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
