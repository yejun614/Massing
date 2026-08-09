/**
 * Massing, as a desktop app.
 *
 * The whole program is one loopback HTTP server. The runtime creates a window
 * and navigates it here; requests for `/`, `/src/…` and `/styles/…` are the
 * editor, and requests under `/__massing/…` are the three things a browser
 * cannot do — choose a path with the operating system's own dialog, read and
 * write that path, and say when something else has changed it.
 *
 * There is no `Deno.BrowserWindow` anywhere in this file. See `bridge.ts` for
 * why: it blocks for ever on Windows under 2.9.5, and the loopback server
 * turns out to be a better seam anyway.
 *
 *   deno task desktop        build it
 *   deno task desktop:dev    run it from source, in a browser
 */

import { createAppServer } from './serve.ts';
import { createBridge } from './bridge.ts';
import { startMcp } from './mcp.ts';
import { startUpdates } from './update.ts';
import { followWindowsTheme, setDarkFrame } from './win32.ts';

/**
 * Where the app's own files are.
 *
 * `import.meta.dirname` is the `desktop/` directory in a source run and the
 * embedded root in a compiled one, so the repo root is one level up in both.
 */
const ROOT = new URL('../', import.meta.url);

/** Reported to MCP clients as the server version; the one in `deno.json`. */
const VERSION = '0.1.0';

/*
 * The window is titled `M`, and this file cannot fix it.
 *
 * Deno Desktop names the window from `desktop.app.name` and something on the
 * way there reads a UTF-16 string as a C string, so "Massing" stops at the NUL
 * byte after `M`. Three ways out were tried and measured: `document.title`
 * from the page does not reach the frame; there is no window object to call
 * `setTitle` on, because `Deno.BrowserWindow` blocks (see `bridge.ts`); and
 * renaming it from outside with `user32!SetWindowTextW` returns success and is
 * then ignored by the backend's window proc — the title reads back unchanged.
 * So it stands until Deno fixes it, or until the `cef` backend is worth its
 * 400 MB. `docs/DESKTOP.md` has the table.
 *
 * The same handle is good for the one thing that *does* work, though: the
 * title bar can be told to go dark. See `win32.ts`.
 */

/** How the window is found: what each backend titles it. See `win32.ts`. */
const WINDOW_NAMES = ['M', 'Massing'];

const app = createAppServer(ROOT);
const bridge = createBridge();

/*
 * The first `Deno.serve` in the process is the one the runtime takes over: it
 * ignores whatever address is passed, binds to the one in
 * `DENO_SERVE_ADDRESS`, and points the window at it. That is why this call
 * comes before anything else that might want to listen — Phase 3's MCP server
 * has to be second, or it would find itself being rendered.
 *
 * The address is still spelled out, for the run that is *not* under
 * `deno desktop`: `deno task desktop:dev` is a plain program, nothing
 * overrides it, and the default would put a server holding a file-write API on
 * every interface of the machine. Loopback is the only place this belongs.
 */
const server = Deno.serve({
  hostname: '127.0.0.1',
  port: Number(Deno.env.get('MASSING_PORT') ?? 8123),
}, async (req) => {
  const served = await app.handle(req);
  if (served) return served;

  const answered = await bridge.handle(req);
  if (answered) return answered;

  return new Response('Not found', { status: 404 });
});

console.error(`massing: serving the editor on ${server.addr.hostname}:${server.addr.port}`);

/*
 * The MCP server, second and never first.
 *
 * `Deno.serve` inside `deno desktop` is forced onto the runtime's port — but
 * only the first call is: the override is consumed once. So the order of these
 * two calls is load-bearing. Started first, this one would take the window's
 * port and the editor would render a JSON-RPC endpoint.
 *
 * Switched off with `MASSING_MCP=off` for anyone who wants the editor without
 * a listener on it. It is on by default because it is the reason this build
 * exists; it binds to loopback, and `mcp.ts` turns away anything arriving with
 * a browser's `Origin`.
 */
const mcp = Deno.env.get('MASSING_MCP') === 'off' ? null : startMcp(bridge, {
  version: VERSION,
  port: Number(Deno.env.get('MASSING_MCP_PORT') ?? 0) || undefined,
});
if (mcp) {
  console.error(`massing: MCP on ${mcp.url}`);
  await writePortFile(mcp.port);
}

/**
 * Where the port is written down.
 *
 * The setup instructions name 7337, and usually that is what it is — but a
 * second copy of the app, or anything else already holding the port, makes it
 * something else. Rather than fail, the app takes what it can get and records
 * it, so "which URL do I give Claude Code" always has an answer that is true
 * of the copy actually running.
 */
async function writePortFile(port: number) {
  const home = Deno.env.get('APPDATA') ?? Deno.env.get('XDG_STATE_HOME') ??
    (Deno.env.get('HOME') ? `${Deno.env.get('HOME')}/.local/state` : null);
  if (!home) return;
  const dir = `${home}/massing`;
  try {
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/mcp.json`,
      `${JSON.stringify({ url: `http://127.0.0.1:${port}/`, port, pid: Deno.pid }, null, 2)}\n`,
    );
  } catch (err) {
    // Not being able to write it is not a reason not to run; the port is on
    // stderr either way.
    console.error('massing: could not record the MCP port:', err);
  }
}

/*
 * Updates, and what the window is told about them.
 *
 * Routed through the same push channel everything else uses, so a new version
 * arrives as a toast in the editor rather than as a line in a log nobody is
 * reading. Off in a source run: `deno task desktop:dev` is not an installed
 * app and has nothing to patch.
 */
/*
 * The title bar follows the editor's theme.
 *
 * Not awaited: it polls for a window the runtime has not created yet, and
 * nothing below depends on it.
 */
followWindowsTheme(WINDOW_NAMES);
bridge.onTheme(setDarkFrame);

const updates = startUpdates((message) => bridge.push({ type: 'notice', message }));
console.error(
  updates.on ? 'massing: checking for updates daily' : `massing: updates off - ${updates.reason}`,
);

/*
 * Leave the disk as we found it.
 *
 * The watcher holds an OS handle and the event streams hold sockets; a window
 * closed with either still open leaves the process alive with nothing to show.
 */
const shutdown = () => {
  bridge.stop();
  Deno.exit(0);
};
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  try {
    Deno.addSignalListener(signal, shutdown);
  } catch {
    // SIGTERM is not a thing on Windows; the window closing is what ends it.
  }
}
