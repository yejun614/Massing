/**
 * Putting a diagram on somebody else's page.
 *
 * An embed is presentation mode with a flag in the address: `?embed=1` opens
 * the editor already presenting, locked, with no way back into the tools. That
 * is the whole mechanism, and it is deliberately the same page rather than a
 * second, cut-down build — a diagram in a frame on a blog is then the same
 * renderer, the same tab strip and the same camera as the one it was drawn in,
 * and it stays that way without anyone maintaining a second copy of it.
 *
 * The flag is a query parameter rather than part of the fragment because the
 * fragment is already spoken for: `#d=` carries a whole diagram and `#s=` a
 * published key (see `share.js` and `cloud.js`). A query lives alongside both,
 * so either kind of link can be embedded.
 *
 * What goes in the frame is therefore whichever address the diagram already
 * has, and there are exactly two:
 *
 *   published — short and stable, and shows the copy on the server, which is
 *               not necessarily the one on screen;
 *   shared    — the whole diagram inside the URL, so always exactly what is on
 *               screen, at the cost of a snippet that can run to kilobytes.
 *
 * Neither is better in general, so the choice is made by which one the page
 * already is, and said out loud in the dialog rather than decided quietly.
 */

export const EMBED_PARAM = 'embed';

/** Default frame size. A 16:9-ish box that suits a blog column. */
export const EMBED_SIZE = { width: '100%', height: '480' };

/** Whether this page was opened as somebody else's embed. */
export function embedded(loc = window.location) {
  return new URLSearchParams(loc.search ?? '').get(EMBED_PARAM) === '1';
}

/** The same address with the flag set — what goes in the frame. */
export function embedUrlFrom(href) {
  const url = new URL(href);
  url.searchParams.set(EMBED_PARAM, '1');
  return url.toString();
}

/** The same address without it — where "Open" in an embed's bar leads. */
export function fullUrlFrom(href = window.location.href) {
  const url = new URL(href);
  url.searchParams.delete(EMBED_PARAM);
  return url.toString();
}

/**
 * Text going into an HTML attribute in a snippet somebody will paste.
 *
 * A diagram title is written by its author and lands in `title=`, and a URL
 * carrying more than one query parameter contains an `&` that is an entity
 * reference wherever it is pasted. Neither is a security question here — the
 * snippet is handed to the person who owns the diagram, not rendered by us —
 * but a snippet that silently breaks on an apostrophe is a bad snippet.
 */
function attr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** A number is a pixel count; anything else (`100%`, `40rem`) is passed through. */
function size(value, fallback) {
  const text = String(value ?? '').trim();
  return text === '' ? fallback : text;
}

/**
 * The snippet.
 *
 * `allowfullscreen` because the bar inside an embed offers it, and without the
 * attribute on the frame that button silently does nothing on the host page.
 * `loading="lazy"` because an embed is usually somewhere down an article, and
 * the editor is not a small page to fetch for a diagram nobody scrolled to.
 */
export function embedSnippet({ url, width, height, title }) {
  const w = size(width, EMBED_SIZE.width);
  const h = size(height, EMBED_SIZE.height);
  return (
    `<iframe src="${attr(url)}"\n` +
    `        width="${attr(w)}" height="${attr(h)}"\n` +
    `        style="border:0;border-radius:12px"\n` +
    `        title="${attr(title || 'Diagram')}"\n` +
    `        loading="lazy" allowfullscreen></iframe>`
  );
}
