/**
 * How the page and the runtime talk.
 *
 * Deno Desktop documents `win.bind()` for this, and it is the obvious answer —
 * but on this platform it cannot be reached. `new Deno.BrowserWindow()` blocks
 * for ever on Windows under Deno 2.9.5, during module evaluation and equally
 * from a later task, so there is no window object to call `bind` on. The
 * runtime makes its own window and navigates it at the loopback server; that
 * server is the only handle we get.
 *
 * Which turns out to be enough, and arguably better. The page calls the
 * runtime with `fetch`, the runtime calls the page over an `EventSource`, and
 * both directions are ordinary HTTP that can be exercised with `curl` while
 * the app is running. Nothing here depends on an experimental API, and the day
 * `BrowserWindow` works this can move behind it without the page noticing.
 *
 * Everything lives under `/__massing/`, which is not a path the editor uses.
 */

import { pickPath, readFile, watchFile, writeBytes, writeFile } from './files.ts';

type Watcher = ReturnType<typeof watchFile>;

/**
 * How long a tool waits on the window.
 *
 * Long enough for a large document to be parsed, laid out and rendered;
 * short enough that a CLI blocked on a window that has stopped answering
 * finds out inside one turn rather than one coffee.
 */
const CALL_TIMEOUT_MS = 15_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

/** The name at the end of a path, whichever separator this platform uses. */
export function baseName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

export function createBridge() {
  /**
   * Open `EventSource` connections.
   *
   * A set rather than one, because a reload opens a second before the first
   * has been torn down, and a push that went only to the stale one would be a
   * change the window never hears about.
   */
  const listeners = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder();

  let watcher: Watcher | null = null;
  let watching: string | null = null;

  /**
   * Calls the runtime has made into the page and is waiting on.
   *
   * The MCP tools act on the document in the window, which means the runtime
   * has to ask the page a question and get an answer back. The push channel is
   * one-way, so a call goes out over it with an id and the answer comes back as
   * an ordinary POST carrying the same id. This map is the middle.
   */
  const waiting = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (err: Error) => void; timer: number }
  >();
  let nextId = 0;

  function push(event: unknown) {
    const chunk = encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
    for (const listener of [...listeners]) {
      try {
        listener.enqueue(chunk);
      } catch {
        // The window went away mid-push; drop it rather than retrying.
        listeners.delete(listener);
      }
    }
  }

  /**
   * Follow one file, and only one.
   *
   * The app has a single open document, so a second call replaces the first
   * rather than adding to it — otherwise opening ten files in a session leaves
   * ten watchers running and every one of them reporting.
   */
  function watch(path: string | null) {
    if (path === watching) return;
    watcher?.stop();
    watcher = null;
    watching = path;
    if (!path) return;
    watcher = watchFile(path, () => push({ type: 'file-changed', path }));
  }

  async function body(req: Request): Promise<Record<string, string>> {
    try {
      const parsed = await req.json();
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  /**
   * Ask the window to do something, and wait for the answer.
   *
   * Rejecting when no window is listening is the important case, not an edge
   * one: it is what a CLI sees when the app is not running, or is still
   * starting, and "the window is not listening" is an answer a model can act
   * on where a request that hangs for ever is not.
   */
  function ask(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (listeners.size === 0) {
      return Promise.reject(new Error('The Massing window is not listening. Is the app open?'));
    }
    const id = `c${++nextId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`The window did not answer ${name} within ${CALL_TIMEOUT_MS}ms.`));
      }, CALL_TIMEOUT_MS);
      waiting.set(id, { resolve, reject, timer: timer as unknown as number });
      push({ type: 'call', id, name, args });
    });
  }

  return {
    get watching() {
      return watching;
    },
    get connected() {
      return listeners.size > 0;
    },
    ask,
    push,
    stop() {
      for (const [, pending] of waiting) {
        clearTimeout(pending.timer);
        pending.reject(new Error('The app is shutting down.'));
      }
      waiting.clear();
      watcher?.stop();
      for (const listener of [...listeners]) {
        try {
          listener.close();
        } catch { /* already gone */ }
      }
      listeners.clear();
    },

    async handle(req: Request): Promise<Response | null> {
      const { pathname } = new URL(req.url);
      if (!pathname.startsWith('/__massing/')) return null;
      const route = pathname.slice('/__massing/'.length);

      /*
       * The push channel.
       *
       * `cancel` is what keeps the listener set honest: a closed window or a
       * reload cancels the stream, and without removing the controller there
       * the set grows for the life of the process.
       */
      if (route === 'events') {
        let mine: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            mine = controller;
            listeners.add(controller);
            controller.enqueue(encoder.encode(': open\n\n'));
          },
          cancel() {
            listeners.delete(mine);
          },
        });
        return new Response(stream, {
          headers: {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-store',
            connection: 'keep-alive',
          },
        });
      }

      if (route === 'dialog/open' || route === 'dialog/save') {
        const { suggested } = await body(req);
        const path = await pickPath({
          mode: route === 'dialog/save' ? 'save' : 'open',
          suggested,
        });
        // A dismissed dialog and a dialog that could not be shown are the same
        // answer here; the page falls back to what a browser would do.
        return json(path ? { path, name: baseName(path) } : { path: null });
      }

      if (route === 'read') {
        const { path } = await body(req);
        if (!path) return json({ error: 'read needs a path' }, 400);
        try {
          return json({ text: await readFile(path), name: baseName(path) });
        } catch (err) {
          return json({ error: String((err as Error).message ?? err) }, 404);
        }
      }

      if (route === 'write') {
        const { path, text } = await body(req);
        if (!path) return json({ error: 'write needs a path' }, 400);
        try {
          // Announced before the write, not after: the events can arrive while
          // `writeTextFile` is still returning, and a suppression window that
          // opens afterwards has already missed them.
          watcher?.mine();
          await writeFile(path, text ?? '');
          return json({ ok: true });
        } catch (err) {
          return json({ error: String((err as Error).message ?? err) }, 500);
        }
      }

      /*
       * An exported image, which is bytes rather than text.
       *
       * Base64 rather than a raw body because this is the one payload that is
       * not JSON, and giving it its own content type would mean a second way
       * of reading a request for the sake of one route.
       */
      if (route === 'export') {
        const { suggested, base64 } = await body(req);
        const path = await pickPath({ mode: 'save', suggested: suggested ?? 'diagram.png' });
        if (!path) return json({ path: null });
        try {
          const binary = Uint8Array.from(atob(base64 ?? ''), (c) => c.charCodeAt(0));
          await writeBytes(path, binary);
          return json({ path, name: baseName(path) });
        } catch (err) {
          return json({ error: String((err as Error).message ?? err) }, 500);
        }
      }

      /*
       * The other half of `ask`. The page has finished a call and is handing
       * back what it got — or what went wrong, which travels as a value rather
       * than as an HTTP error, because the failure belongs to the tool that
       * asked and not to this request.
       */
      if (route === 'result') {
        const payload = await req.json().catch(() => ({}));
        const pending = waiting.get(payload?.id);
        if (!pending) return json({ ok: false, error: 'no call is waiting on that id' }, 409);
        waiting.delete(payload.id);
        clearTimeout(pending.timer);
        if (payload.ok) pending.resolve(payload.value);
        else pending.reject(new Error(payload.error ?? 'the window did not say what went wrong'));
        return json({ ok: true });
      }

      if (route === 'watch') {
        const { path } = await body(req);
        watch(path || null);
        return json({ watching });
      }

      return json({ error: `no such route: ${route}` }, 404);
    },
  };
}
