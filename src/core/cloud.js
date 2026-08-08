/**
 * Diagrams that live at a URL.
 *
 * The share link already puts a whole diagram inside the address bar, and that
 * stays the right answer for a small one: nothing is stored anywhere and no
 * server sees it. It stops being the right answer somewhere around a diagram
 * with pictures in it, because chat clients and issue trackers truncate long
 * URLs. Publishing is the other end of that trade — a short link, at the cost
 * of the document sitting on a server.
 *
 * Two ways to name what you publish. The hash addresses the exact bytes and can
 * never move, so a link to one keeps showing what it showed. A display id is a
 * name you chose, and it can be re-pointed at a newer version — but only by
 * whoever claimed it, which with no accounts in this project means whoever
 * holds the token minted at the time. Those tokens live in this browser and
 * nowhere else, so publishing over your own name from a second machine is not
 * possible; that is a real limitation and the price of having no accounts.
 */

import { serializeDoc, parseDoc } from './schema.js';
import { describeError } from '../util/errors.js';

const TOKEN_KEY = 'massing:publish-tokens:v1';

/** Where a published diagram is read from, and what a share of it looks like. */
export const publishedPath = (key) => `/d/${encodeURIComponent(key)}`;

/**
 * The key in the address, or null.
 *
 * Two spellings for one thing. `/d/<key>` is the link worth sharing, and works
 * because the deployment rewrites that path back to the page. `#s=<key>` is the
 * fallback for anywhere that rewrite does not exist — opening `index.html`
 * straight off a static host, say — so a link is never unopenable merely
 * because of how the site is served.
 */
export function publishedKeyFrom(loc = location) {
  const path = /^\/d\/([^/?#]+)\/?$/.exec(loc.pathname ?? '');
  if (path) return decodeURIComponent(path[1]);
  const hash = new URLSearchParams((loc.hash ?? '').replace(/^#/, '')).get('s');
  return hash ? hash.trim() : null;
}

function readTokens() {
  try {
    const raw = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function rememberToken(displayId, token) {
  if (!displayId || !token) return;
  try {
    const all = readTokens();
    all[displayId] = token;
    localStorage.setItem(TOKEN_KEY, JSON.stringify(all));
  } catch {
    // Without storage a name can be claimed but never updated again. The claim
    // still works, which is the part that matters on first use.
  }
}

export function createCloud({ store, toaster } = {}) {
  return {
    /** Whether this browser holds the token that may re-point `displayId`. */
    ownsName(displayId) {
      return Boolean(readTokens()[displayId]);
    },

    /**
     * Store the open document.
     *
     * @param {{displayId?: string}} options
     * @returns {Promise<{hash, shortHash, displayId, url} | null>}
     */
    async publish({ displayId } = {}) {
      const text = serializeDoc(store.state.doc);
      const name = displayId?.trim() || null;
      try {
        const response = await fetch('/api/diagrams', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            document: JSON.parse(text),
            displayId: name,
            // Sent only when this browser claimed the name. Absent, the server
            // refuses rather than overwriting, which is the whole protection.
            editToken: name ? readTokens()[name] : undefined,
          }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          // The storage detail goes in the copyable part rather than the line
          // on screen: it is the thing worth pasting into an issue, and the
          // wrong length for a toast.
          toaster?.error(body.error ?? `Publishing failed (${response.status}).`, {
            detail: [body.error, body.storage && JSON.stringify(body.storage, null, 2)]
              .filter(Boolean)
              .join('\n\n'),
          });
          return null;
        }
        rememberToken(body.displayId, body.editToken);
        return {
          hash: body.hash,
          shortHash: body.shortHash,
          displayId: body.displayId,
          bytes: body.bytes,
          expiresAt: body.expiresAt ?? null,
          retentionDays: body.retentionDays ?? 0,
          url: new URL(publishedPath(body.displayId), location.origin).href,
          // Null on the vanishingly rare occasion the short link was already
          // claimed by other content; the name and the full hash still work.
          hashUrl: body.shortHash
            ? new URL(publishedPath(body.shortHash), location.origin).href
            : null,
        };
      } catch (err) {
        toaster?.error('Publishing failed — the deployment could not be reached.', {
          detail: describeError(err),
        });
        return null;
      }
    },

    /**
     * Fetch a published diagram. Returns the parsed result, or null.
     *
     * The reply goes through the editor's own loader like any other file, so a
     * document stored by an older version opens with the same warnings a file
     * of it would produce, rather than with different ones.
     */
    async fetchDiagram(key) {
      const response = await fetch(`/api/diagrams/${encodeURIComponent(key)}`, {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const err = new Error(body.error ?? `Could not read "${key}" (${response.status}).`);
        // 404 and 410 are the two that mean "stop offering this link": swept,
        // deleted, or expired. Anything else is a bad moment, not a verdict.
        if (response.status === 404 || response.status === 410) {
          err.gone = response.status === 410 ? 'expired' : 'missing';
        }
        throw err;
      }
      const text = await response.text();
      return parseDoc(text);
    },
  };
}
