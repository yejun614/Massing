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
  };
}

install();
