/**
 * Serving the editor to its own window.
 *
 * The desktop app runs the same files the browser does — `index.html` loading
 * `src/main.js` as native ES modules — rather than the bundle. Two reasons.
 * The bundle exists so a diagram editor can be emailed as one file, which is a
 * problem the desktop app does not have; and running the unbundled tree means
 * an edit is one reload away instead of one build away, exactly as on the web.
 *
 * What the desktop needs on top of that is injected here rather than kept in a
 * second copy of `index.html`. A second copy is a file that drifts.
 *
 * Paths are resolved with `URL` rather than a path library. Not stubbornness:
 * URL resolution already collapses `..` to a normal form, and comparing the
 * result against the root prefix is the whole of the containment check — which
 * is one import fewer in a project that writes its own GIF encoder to avoid
 * them.
 */

/** Everything the window is allowed to load, relative to the repo root. */
const SERVED = ['src', 'styles', 'examples', 'schema'];

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  woff2: 'font/woff2',
};

function contentType(pathname: string): string {
  const dot = pathname.lastIndexOf('.');
  return TYPES[dot < 0 ? '' : pathname.slice(dot + 1).toLowerCase()] ?? 'application/octet-stream';
}

const noStore = (type: string) => ({
  // The window is the only client and it lives as long as the process.
  // Caching would mean editing a source file and reloading to nothing.
  'content-type': type,
  'cache-control': 'no-store',
});

/**
 * The two lines that turn the web app into the desktop one.
 *
 * The meta tag is a third gate beside the two in `core/features.js`, so a
 * build can say what it is. The shim script is loaded **before** the app's own,
 * which is what makes it work at all: `io.js` decides once, at construction,
 * whether the File System Access API exists, so anything installing a shim has
 * to have finished before `main.js` starts. Module scripts run in document
 * order, so putting it first is the entire mechanism.
 */
function desktopify(html: string): string {
  return html
    .replace('</head>', '<meta name="massing-desktop" content="1">\n</head>')
    .replace(
      '<script type="module" src="src/main.js"></script>',
      '<script type="module" src="/__massing/shim.js"></script>\n' +
        '<script type="module" src="src/main.js"></script>',
    );
}

export function createAppServer(rootUrl: URL) {
  const root = rootUrl.href.endsWith('/') ? rootUrl : new URL(`${rootUrl.href}/`);

  async function send(relative: string, type?: string): Promise<Response | null> {
    const target = new URL(relative, root);
    // `..` is already collapsed by URL resolution; this is what stops the
    // collapsed result from pointing outside the tree.
    if (!target.href.startsWith(root.href)) return null;
    try {
      return new Response(await Deno.readFile(target), {
        headers: noStore(type ?? contentType(target.pathname)),
      });
    } catch {
      return null;
    }
  }

  return {
    /** `null` when the request is not ours, so the caller can try the API. */
    async handle(req: Request): Promise<Response | null> {
      const { pathname } = new URL(req.url);

      if (pathname === '/' || pathname === '/index.html') {
        const html = await Deno.readTextFile(new URL('index.html', root));
        return new Response(desktopify(html), { headers: noStore(TYPES.html) });
      }

      if (pathname === '/__massing/shim.js') {
        return await send('desktop/web/shim.js', TYPES.js);
      }

      const relative = decodeURIComponent(pathname).replace(/^\/+/, '');
      if (!SERVED.includes(relative.split('/')[0])) return null;
      return await send(relative);
    },
  };
}
