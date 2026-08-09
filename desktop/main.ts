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

/**
 * Where the app's own files are.
 *
 * `import.meta.dirname` is the `desktop/` directory in a source run and the
 * embedded root in a compiled one, so the repo root is one level up in both.
 */
const ROOT = new URL('../', import.meta.url);

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
