/**
 * Where a link on an element points.
 *
 * Anything in a drawing may carry a `link`, and it is one string rather than an
 * object with a `kind` beside it. The form says what it is:
 *
 *   "#api-gateway"        another element — the camera flies to it
 *   "tab:Network detail"  another drawing in this file
 *   "https://…"           somewhere else entirely, behind a confirmation
 *
 * One string because this format is written by hand and by language models, and
 * `{"link": {"kind": "element", "target": "api-gateway"}}` is three decisions
 * where `"#api-gateway"` is none. The prefixes are the two that already mean
 * this everywhere else: `#` is a fragment, and `tab:` reads as what it does.
 *
 * The module is deliberately dependency-free — no DOM, no document module — so
 * the same rules run in the editor, in the validator and in a test.
 *
 * ## What may be opened
 *
 * `http`, `https` and `mailto`, and nothing else. A diagram is a document that
 * travels: it is published to a URL, embedded in somebody else's page and
 * pasted between people, so a `javascript:` link in one would be a script
 * someone else's click runs. Refusing at the point of *resolution* rather than
 * at the point of loading is deliberate — the string stays in the file, where
 * its author can see what they wrote and why nothing happens, instead of being
 * silently eaten by the loader.
 */

/** The only schemes a link may open. Everything else resolves to nothing. */
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/**
 * How long a link may be.
 *
 * Generous, because a share link from this very editor carries a whole diagram
 * in its fragment and runs to kilobytes. Bounded, because the field is stored,
 * saved and published, and an unbounded string in it is a way to make a file
 * enormous by accident.
 */
export const MAX_LINK = 4096;

const ELEMENT_PREFIX = '#';
const TAB_PREFIX = 'tab:';

/** What to write in a hint when someone has typed something that is not one. */
export const LINK_SYNTAX = 'https://…, #element-id, or tab:Name';

/**
 * The stored form of a link, or null when there is nothing to store.
 *
 * Whitespace only is nothing. Anything else is kept exactly as typed, including
 * text that does not parse: an author halfway through typing a URL should find
 * what they wrote still there, and the inspector says it is not a link yet
 * rather than the field emptying itself under the caret.
 */
export function readLink(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return null;
  return text.slice(0, MAX_LINK);
}

/**
 * What a link says, before anything is looked up.
 *
 * @returns {null
 *   | {kind: 'element', id: string}
 *   | {kind: 'tab', name: string, index: number|null}
 *   | {kind: 'url', href: string}
 *   | {kind: 'unknown', text: string}}
 */
export function parseLink(raw) {
  const text = readLink(raw);
  if (!text) return null;

  if (text.startsWith(ELEMENT_PREFIX)) {
    const id = text.slice(ELEMENT_PREFIX.length).trim();
    return id ? { kind: 'element', id } : { kind: 'unknown', text };
  }

  if (text.slice(0, TAB_PREFIX.length).toLowerCase() === TAB_PREFIX) {
    const name = text.slice(TAB_PREFIX.length).trim();
    if (!name) return { kind: 'unknown', text };
    // A number is offered as a fallback, never as the first reading: a drawing
    // someone actually called "2" is found by its name, and only a `tab:2` that
    // matches no name counts to the second drawing.
    return { kind: 'tab', name, index: /^\d+$/.test(name) ? Number(name) - 1 : null };
  }

  const href = absoluteHref(text);
  return href ? { kind: 'url', href } : { kind: 'unknown', text };
}

/**
 * A whole address from what was typed, or null when it is not one.
 *
 * `example.com` is accepted and read as `https://example.com`, because that is
 * what somebody typing it means and the alternative is a field that refuses the
 * most natural thing to put in it. A bare word is not: `notes` is far more
 * likely to be an unfinished thought than a host on this network, and turning
 * it into a navigation would be the editor inventing a destination.
 */
function absoluteHref(text) {
  if (/\s/.test(text)) return null;
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text);
  // A dot in the authority is what separates "a host" from "a word".
  if (!hasScheme && !/^[^/?#]+\.[^/?#]/.test(text)) return null;

  let url;
  try {
    url = new URL(hasScheme ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (!SAFE_SCHEMES.has(url.protocol)) return null;
  // `https:` with nothing after it is a scheme, not a destination.
  if (url.protocol !== 'mailto:' && !url.hostname) return null;
  return url.href;
}

/** Every id in one drawing, without importing the document module to get them. */
function idsOf(doc) {
  const ids = new Set();
  for (const key of ['nodes', 'groups', 'edges', 'texts', 'images', 'shapes', 'cells']) {
    for (const entity of doc?.[key] ?? []) if (entity?.id) ids.add(entity.id);
  }
  return ids;
}

/**
 * Where a link actually goes, given the file it is in.
 *
 * An element is looked for in the drawing on screen first and in the other
 * drawings afterwards, so `#api` means the `api` beside you when there is one —
 * two tabs may legitimately both have a block by that name, and the near one is
 * always the one that was meant.
 *
 * @param {string} raw
 * @param {{doc?: object, tabs?: {name: string, doc: object}[], activeTab?: number}} where
 * @returns {null
 *   | {kind: 'url', href: string}
 *   | {kind: 'tab', index: number, name: string, here: boolean}
 *   | {kind: 'element', id: string, tab: number}
 *   | {kind: 'missing', why: string}
 *   | {kind: 'unknown', text: string}}
 */
export function resolveLink(raw, { doc = null, tabs = null, activeTab = 0 } = {}) {
  const link = parseLink(raw);
  if (!link) return null;
  if (link.kind === 'url' || link.kind === 'unknown') return link;

  if (link.kind === 'tab') {
    const index = tabIndexOf(link, tabs);
    if (index === null) {
      return { kind: 'missing', why: `no drawing in this file is called "${link.name}"` };
    }
    return { kind: 'tab', index, name: tabs[index].name, here: index === activeTab };
  }

  if (doc && idsOf(doc).has(link.id)) return { kind: 'element', id: link.id, tab: activeTab };
  for (const [index, tab] of (tabs ?? []).entries()) {
    if (index === activeTab) continue;
    if (idsOf(tab.doc).has(link.id)) return { kind: 'element', id: link.id, tab: index };
  }
  return { kind: 'missing', why: `nothing in this file has the id "${link.id}"` };
}

/** Which drawing a `tab:` link names, or null. Name first, then number. */
function tabIndexOf(link, tabs) {
  if (!tabs?.length) return null;
  const wanted = link.name.toLowerCase();
  const byName = tabs.findIndex((tab) => (tab.name ?? '').trim().toLowerCase() === wanted);
  if (byName >= 0) return byName;
  if (link.index === null) return null;
  return link.index >= 0 && link.index < tabs.length ? link.index : null;
}

/**
 * One line saying what following this link would do.
 *
 * Written for the inspector, where the whole value of the field is knowing
 * whether what you typed found anything — a link that silently points at
 * nothing is indistinguishable from one that works until it is clicked in front
 * of an audience.
 */
export function describeLink(raw, where = {}) {
  const target = resolveLink(raw, where);
  if (!target) return '';
  switch (target.kind) {
    case 'url':
      return `Opens ${hostOf(target.href)} in a new tab, after asking.`;
    case 'tab':
      return target.here
        ? `Stays on this drawing — "${target.name}" is the one you are on.`
        : `Switches to the drawing "${target.name}".`;
    case 'element':
      return target.tab === (where.activeTab ?? 0)
        ? `Moves the view to "${target.id}".`
        : `Opens the drawing "${where.tabs[target.tab].name}" and moves to "${target.id}".`;
    case 'missing':
      return `Points nowhere: ${target.why}.`;
    default:
      return `Not a link yet. Write one of ${LINK_SYNTAX}.`;
  }
}

/** The part of an address a person reads, for a hint or a confirmation. */
export function hostOf(href) {
  try {
    const url = new URL(href);
    return url.protocol === 'mailto:' ? url.pathname : url.host;
  } catch {
    return href;
  }
}
