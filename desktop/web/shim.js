/**
 * The page's half of the desktop app.
 *
 * This is browser code, and it is deliberately the only browser code the
 * desktop build adds. It runs before `src/main.js` — the server injects it as
 * the module script ahead of the app's own — and by the time the editor is
 * constructed it has already put a File System Access API on `window`.
 *
 * That timing is the whole design. `io.js` asks `typeof
 * window.showSaveFilePicker === 'function'` exactly once, when the editor is
 * built, and everything it does afterwards goes through a handle with four
 * members on it: `name`, `getFile()`, `createWritable()` and an optional
 * `queryPermission()`. Give it those four and Open, Save, Save As and
 * reload-from-disk all work against real paths, with not one line changed in
 * `io.js`. The alternative — a desktop code path threaded through the editor —
 * would be a second implementation of file handling to keep in step with the
 * first.
 *
 * Nothing here loads unless the server injected it, so the web build cannot
 * reach any of it.
 */

/*
 * Imported from the app's own tree, by the URL the app loads them from — so
 * these are the same module instances the editor is running, not copies. A
 * document arriving from Claude Code therefore meets the same loader and the
 * same checks as one typed into the panel, which is the whole point of putting
 * the tools here rather than in the runtime.
 */
import { normalizeDoc, serializeDoc } from '/src/core/schema.js';
import { formatReport, validateDocument } from '/src/core/validate.js';
import { misplaced, overConnected, underDrawn } from '/src/core/assistant.js';

const API = '/__massing';

async function call(route, payload) {
  const response = await fetch(`${API}/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `${route} failed (${response.status})`);
  return body;
}

/**
 * A handle over a real path.
 *
 * `getFile` re-reads the disk every time rather than caching, which is what
 * makes reload work: `io.js` keeps the handle as the source it re-reads, so a
 * cached `File` would make every reload report "has not changed".
 *
 * `queryPermission` is deliberately absent. `io.js` treats a handle without it
 * as already permitted, which is the truth here — the app was given
 * `--allow-read` and `--allow-write` at build time and cannot ask for more.
 */
function handleFor(path, name) {
  return {
    name,
    // Read by `main.js` when it stores handles; see the note there.
    massingPath: path,
    async getFile() {
      const { text } = await call('read', { path });
      // The name matters: `io.js` reports it, and the library keys records by
      // it. `lastModified` is what a `File` from a picker would carry.
      return new File([text], name, { type: 'application/json', lastModified: Date.now() });
    },
    async createWritable() {
      let pending = '';
      return {
        write(chunk) {
          pending += typeof chunk === 'string' ? chunk : '';
          return Promise.resolve();
        },
        async close() {
          await call('write', { path, text: pending });
          // Saving a file is also how you choose which file to follow.
          await call('watch', { path });
        },
      };
    },
  };
}

function install() {
  window.showSaveFilePicker = async (options = {}) => {
    const { path, name } = await call('dialog/save', {
      suggested: options.suggestedName ?? 'diagram.arch.json',
    });
    // `io.js` reads an AbortError as "the person cancelled" and leaves the
    // document alone, which is exactly what a dismissed dialog means.
    if (!path) throw new DOMException('The dialog was dismissed.', 'AbortError');
    return handleFor(path, name);
  };

  window.showOpenFilePicker = async () => {
    const { path, name } = await call('dialog/open');
    if (!path) throw new DOMException('The dialog was dismissed.', 'AbortError');
    const handle = handleFor(path, name);
    await call('watch', { path });
    return [handle];
  };

  /**
   * Where an export goes.
   *
   * `downloadBlob` in `util/dom.js` looks for this and uses it when it is
   * there. Without it every export would land in the browser's download
   * directory, which on a desktop app is a folder nobody chose.
   */
  window.__massingSave = async (blob, name) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // Chunked, because `String.fromCharCode(...bytes)` on a multi-megabyte PNG
    // overflows the argument list and throws.
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    const { path } = await call('export', { suggested: name, base64: btoa(binary) });
    return Boolean(path);
  };

  /**
   * The file changed underneath us.
   *
   * Straight into the reload the toolbar's button and the `R` key already use:
   * it compares the incoming document against the open one in canonical form
   * and does nothing when they match, keeps the camera still and prunes the
   * selection rather than dropping it. Everything a watcher wants was already
   * written for the person who presses `R` while a model finishes writing.
   */
  const events = new EventSource(`${API}/events`);
  events.onmessage = (event) => {
    let message = {};
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === 'file-changed') window.massing?.io?.reload();
    if (message.type === 'call') answer(message);
    // The runtime has something to say — a staged update, a rollback. Through
    // the editor's own toasts, because a desktop app that talks to you in a
    // console is a desktop app that never talks to you.
    if (message.type === 'notice') window.massing?.toaster?.info(message.message);
  };
}

// ---------------------------------------------------------------------------
// What the MCP tools actually do
// ---------------------------------------------------------------------------

/**
 * A document sent by a model, put through the loader — or a refusal.
 *
 * Deliberately the same shape of answer `src/core/assistant.js` gives its own
 * tools, down to the wording. A model driving the editor from Claude Code and
 * a model driving it from the panel should not have to learn two dialects of
 * "that is not a diagram".
 */
function readDocument(text, wrapped) {
  let incoming;
  try {
    incoming = JSON.parse(text);
  } catch (err) {
    return { refusal: `Refused: \`document\` is not valid JSON — ${err.message}` };
  }
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return { refusal: 'Refused: `document` must be a complete .arch.json document.' };
  }
  if (Array.isArray(incoming.tabs)) return { refusal: `Refused: \`document\` is wrapped in \`tabs\`. ${wrapped}` };
  const parsed = normalizeDoc(incoming);
  if (parsed.rejection) return { refusal: `Refused: that is not a diagram — ${parsed.rejection}` };
  return { doc: parsed.doc, warnings: parsed.warnings };
}

function report(doc, { opening, subject, warnings, fromScratch }) {
  const lines = [];
  if (warnings.length) {
    lines.push(
      `${opening}, with ${warnings.length} thing(s) the loader had to repair.`,
      'These are problems in what you sent. Fix them and send the document again:',
      ...warnings.map((w) => `- ${w}`)
    );
  } else {
    lines.push(`${opening}.`);
  }
  lines.push(
    `${subject} has ${doc.nodes.length} blocks, ${doc.groups.length} zones, ` +
    `${doc.edges.length} connections, ${doc.texts.length} notes.`
  );
  for (const note of [overConnected(doc), underDrawn(doc, { fromScratch }), misplaced(doc)]) {
    if (note) lines.push(note);
  }
  return lines.join('\n');
}

const TOOLS = {
  get_diagram: () => serializeDoc(window.massing.store.state.doc),

  replace_diagram: ({ document }) => {
    const read = readDocument(document, 'Send the one drawing that is open, as a plain document ' +
      'with `nodes` at the top level. To put a second drawing beside it, call `add_tab`.');
    if (read.refusal) return read.refusal;
    const { store, commands } = window.massing;
    const fromScratch = store.state.doc.nodes.length === 0;
    // Through the store, so it is one undo away like any other edit.
    store.replaceDoc(read.doc, 'MCP edit');
    commands?.zoomFit?.();
    return report(read.doc, {
      opening: 'Applied',
      subject: 'The diagram now',
      warnings: read.warnings,
      fromScratch,
    });
  },

  add_tab: ({ name, document }) => {
    const label = String(name ?? '').trim();
    if (!label) return 'Refused: `name` is required — name the tab after what it shows.';
    const { tabs, store } = window.massing;
    if (!tabs) return 'Refused: this window cannot add drawings.';
    if (tabs.count >= MAX_TABS) {
      return `Refused: the file already holds ${tabs.count} drawings, which is as many as ` +
        'this tool will add.';
    }
    const read = readDocument(document, 'Send the one new drawing, as a plain document.');
    if (read.refusal) return read.refusal;
    const firstDrawing = store.state.doc.nodes.length === 0;
    tabs.add(read.doc);
    tabs.rename(tabs.active, label);
    return report(read.doc, {
      opening: `Added "${label}" as a new tab, and switched to it`,
      subject: 'The new tab',
      warnings: read.warnings,
      fromScratch: firstDrawing,
    });
  },

  validate_diagram: () => formatReport(validateDocument(window.massing.store.state.doc)),
};

/** The same ceiling the panel's `add_tab` uses, for the same reason. */
const MAX_TABS = 8;

/**
 * Run one call from the runtime and post the answer back.
 *
 * Errors travel as a value rather than as a failed request: what went wrong
 * belongs to the tool that asked, and a 500 here would tell the runtime that
 * *this* POST failed, which is a different and less useful fact.
 */
async function answer({ id, name, args }) {
  let payload;
  try {
    const tool = TOOLS[name];
    if (!tool) throw new Error(`there is no tool called "${name}"`);
    if (!window.massing) throw new Error('the editor is still starting');
    payload = { id, ok: true, value: tool(args ?? {}) };
  } catch (err) {
    payload = { id, ok: false, error: err?.message ?? String(err) };
  }
  await fetch(`${API}/result`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

install();
