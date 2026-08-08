/**
 * Document schema, normalisation and serialisation.
 *
 * The `.arch.json` file is the product, not an implementation detail: people
 * and language models are expected to read and edit it directly. Two rules
 * follow from that.
 *
 * 1. Loading is forgiving. Missing fields get defaults, unknown component
 *    types degrade to `generic`, dangling references are dropped -- each with
 *    a warning, never an exception. A hand-written document that is 95%
 *    correct should open and show its author what was wrong.
 *
 * 2. Writing is deterministic. Fixed key order, two-space indent, short
 *    numeric arrays kept on one line. Save -> load -> save is byte-identical,
 *    so diffs stay readable in version control.
 *
 * Forgiving is not the same as silent, and the two have to be separated by a
 * gate. Normalisation will read *any* object as a diagram, so a package.json
 * used to open as a blank canvas with nothing said -- the drawing on screen
 * thrown away for a file that was never a diagram at all. `docRejection` is
 * that gate: it answers whether this JSON is a diagram before the forgiving
 * part is allowed to start repairing it.
 */

import { componentFor, isKnownType, groupKindFor, FALLBACK_TYPE } from '../data/components.js';
import { clamp, clampInt, clampTenth } from '../util/num.js';
import { isPlane, normaliseSpin, SPINS } from '../geom/plane.js';

export const FORMAT_VERSION = 1;
export const FILE_EXTENSION = '.arch.json';

/** Sanity bound on grid coordinates and sizes, shared with the resize drag. */
export const MAX_SPAN = 400;
const EDGE_STYLES = new Set(['solid', 'dashed', 'dotted']);
const EDGE_ARROWS = new Set(['none', 'end', 'start', 'both']);

/**
 * How a connection turns the corner between its two ends.
 *
 * `auto` lets the router pick the elbow that passes through fewest blocks.
 * `x` and `y` pin it to one of the two orthogonal families, and `bend` then
 * says where along that axis the run crosses over -- which is the single
 * number a drag on the connection's grip writes.
 */
const EDGE_ROUTES = new Set(['auto', 'x', 'y']);
export const DEFAULT_EDGE_ROUTE = 'auto';

/**
 * What an unset canvas background resolves to, light and dark.
 *
 * Both are offered in the inspector's swatches too, so "automatic" always
 * lands on a colour the author could have chosen deliberately.
 */
export const CANVAS_BACKGROUNDS = { light: '#eef1f5', dark: '#0f172a' };

/**
 * The colour to actually paint behind a diagram.
 *
 * `null` means the author has not chosen one, and the viewer's theme decides —
 * a diagram nobody has an opinion about should not be a white rectangle in a
 * dark room. A colour means they have, and it is honoured whatever the theme
 * is doing: the file says so, and the theme is not allowed to argue.
 */
export function canvasBackground(doc, dark = false) {
  return doc?.canvas?.background ?? CANVAS_BACKGROUNDS[dark ? 'dark' : 'light'];
}

export function createEmptyDoc(title = 'Untitled diagram') {
  return {
    version: FORMAT_VERSION,
    meta: { title },
    // Not a colour: a new diagram has no opinion, so it follows the theme.
    canvas: { background: null },
    groups: [],
    nodes: [],
    edges: [],
    texts: [],
    images: [],
  };
}

/**
 * Where flat content hangs unless told otherwise: lying on the ground, which
 * is the placement that reads as part of the isometric scene rather than
 * stuck on top of it. One constant so everything that defaults -- text,
 * pictures, block captions, connection captions and zone captions -- cannot
 * drift apart.
 */
export const DEFAULT_PLANE = 'floor';

/**
 * Zone captions stand against the right wall by default rather than lying on
 * the ground. A zone is large and usually full, so a caption written flat
 * inside it competes with its own contents; standing it along the far edge
 * keeps it clear.
 */
export const DEFAULT_ZONE_LABEL_PLANE = 'right';

/** Caption size in pixels, matching the stylesheet's own default. */
export const DEFAULT_LABEL_SIZE = 12;

/**
 * Captions centre on what they describe.
 *
 * A block's caption reads against the block's own width and a connection's
 * against the point it hangs from, but "centred" is the sane answer for both,
 * and it is what the `screen` plane has always done.
 */
export const DEFAULT_LABEL_ALIGN = 'center';

export const TEXT_ALIGNS = new Set(['left', 'center', 'right']);
export const TEXT_DEFAULTS = {
  size: 14,
  color: '#334155',
  align: 'left',
  plane: DEFAULT_PLANE,
};

export const IMAGE_DEFAULTS = {
  size: [6, 4],
  plane: DEFAULT_PLANE,
  opacity: 1,
};

/** Shared placement fields for anything flat: pictures and text alike. */
function readPlanar(raw, defaultPlane) {
  return {
    z: clampInt(raw.z, 0, 40, 0),
    plane: isPlane(raw.plane) ? raw.plane : defaultPlane,
    spin: SPINS.includes(normaliseSpin(raw.spin)) ? normaliseSpin(raw.spin) : 0,
    behind: raw.behind === true,
  };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * The five collections that make an object a diagram rather than merely JSON.
 *
 * An empty one still counts. A saved empty diagram writes all five as `[]`,
 * and refusing to reopen the file you just saved would be its own bug.
 */
export const CONTENT_KEYS = ['nodes', 'groups', 'edges', 'texts', 'images'];

/** What a value is, in the words the error message wants. */
function jsonKind(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'a list';
  if (typeof v === 'object') return 'an object';
  if (typeof v === 'string') return 'text';
  return `a ${typeof v}`;
}

/**
 * Why `raw` cannot be read as a diagram, or null when it can.
 *
 * The message is the whole point of the function, so it names what was found
 * instead: told only "this is not a diagram", the first thing anyone does is
 * open the file to see what it *is*.
 *
 * @returns {string | null}
 */
export function docRejection(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return `the top level is ${jsonKind(raw)}, and a diagram is an object.`;
  }
  if (CONTENT_KEYS.some((key) => Array.isArray(raw[key]))) return null;

  const keys = Object.keys(raw);
  const found = keys.length
    ? `its top-level keys are ${keys.slice(0, 8).join(', ')}${keys.length > 8 ? ', …' : ''}`
    : 'it has no keys at all';
  return `it carries none of ${CONTENT_KEYS.join(', ')} — ${found}.`;
}

/**
 * @returns {{doc: object, warnings: string[], rejection: string | null}}
 * @throws {SyntaxError} only when the text is not JSON at all.
 */
export function parseDoc(text) {
  const raw = JSON.parse(text);
  return normalizeDoc(raw);
}

/**
 * @returns {{doc: object, warnings: string[], rejection: string | null}}
 *   A rejection still comes with an empty `doc`, so a caller that has already
 *   decided to open something regardless has one to open. Callers that have
 *   not must check it -- replacing a drawing with a blank canvas is exactly
 *   the failure this exists to stop.
 */
export function normalizeDoc(raw) {
  const warnings = [];
  const rejection = docRejection(raw);
  if (rejection) return { doc: createEmptyDoc(), warnings, rejection };

  const version = int(raw.version, FORMAT_VERSION);
  if (version > FORMAT_VERSION) {
    warnings.push(
      `Document version ${version} is newer than this editor (v${FORMAT_VERSION}); unknown fields were dropped.`
    );
  }

  const doc = createEmptyDoc(str(raw.meta?.title) || 'Untitled diagram');
  if (raw.canvas && typeof raw.canvas === 'object') {
    // Absent, or unreadable, leaves it automatic. A file that names a colour
    // is stating a preference; one that does not has none to state.
    doc.canvas.background = color(raw.canvas.background);
  }

  const usedIds = new Set();

  // --- groups (parents resolved in a second pass) ---------------------------
  const groupIndex = new Map();
  const pendingParents = [];
  for (const g of readCollection(raw, 'groups', warnings)) {
    const kindDef = groupKindFor(str(g.kind));
    if (g.kind && kindDef.kind !== g.kind) {
      warnings.push(`Group kind "${g.kind}" is unknown; used "group".`);
    }
    const label = readLabel(g.label, kindDef.label);
    const id = takeId(g.id, label || kindDef.kind, usedIds, warnings, 'Group');
    const rect = readRect(g.rect ?? [g.x, g.y, g.w, g.h]);
    if (!Array.isArray(g.rect) && !Number.isFinite(Number(g.x))) {
      warnings.push(`Group "${id}" has no rect; gave it ${rect.join(', ')}.`);
    }
    const group = {
      id,
      kind: kindDef.kind,
      label,
      rect,
      color: color(g.color) || kindDef.color,
      // A zone's caption is a flat rectangle too, so it hangs on a plane just
      // like a block's does.
      labelPlane: isPlane(g.labelPlane) ? g.labelPlane : DEFAULT_ZONE_LABEL_PLANE,
      labelSize: clampInt(g.labelSize, 6, 96, DEFAULT_LABEL_SIZE),
      parent: null,
    };
    groupIndex.set(id, group);
    doc.groups.push(group);
    if (str(g.parent)) pendingParents.push([group, str(g.parent)]);
  }
  for (const [group, parent] of pendingParents) {
    if (!groupIndex.has(parent) || parent === group.id) {
      warnings.push(`Group "${group.id}" referenced unknown parent "${parent}".`);
    } else {
      group.parent = parent;
    }
  }
  breakGroupCycles(doc.groups, warnings);

  // --- nodes ----------------------------------------------------------------
  const nodeIndex = new Map();
  for (const n of readCollection(raw, 'nodes', warnings)) {
    let type = str(n.type) || FALLBACK_TYPE;
    if (!isKnownType(type)) {
      warnings.push(`Node type "${type}" is unknown; drawn as a generic block.`);
      type = FALLBACK_TYPE;
    }
    const def = componentFor(type);
    // `?? n.name` and not `|| n.name`: an explicit empty label is an answer,
    // and must not fall through to the alias.
    const label = readLabel(n.label ?? n.name, def.label);
    const id = takeId(n.id, label || type, usedIds, warnings, 'Node');
    const pos = readPair(n.pos ?? [n.x, n.y], [0, 0]);
    const size = readPair(n.size ?? [n.w, n.h], def.size, 1);
    // Worth saying, because the default is not a neutral one: every block that
    // forgot its position lands on the same cell and stacks into one lump.
    if (!Array.isArray(n.pos) && !Number.isFinite(Number(n.x))) {
      warnings.push(`Node "${id}" has no pos; placed it at 0, 0.`);
    }

    const node = {
      id,
      type,
      label,
      pos,
      size,
      // The one measurement on this grid that is not whole cells.
      height: clampTenth(n.height, 0, 40, def.height),
      color: color(n.color) || def.color,
      // A block's caption is a flat rectangle like any other, so it can be
      // laid on the ground or written onto one of the block's own faces.
      labelPlane: isPlane(n.labelPlane) ? n.labelPlane : DEFAULT_PLANE,
      labelSize: clampInt(n.labelSize, 6, 96, DEFAULT_LABEL_SIZE),
      labelAlign: TEXT_ALIGNS.has(n.labelAlign) ? n.labelAlign : DEFAULT_LABEL_ALIGN,
      group: null,
      props: plainProps(n.props),
    };
    const group = str(n.group);
    if (group) {
      if (groupIndex.has(group)) node.group = group;
      else warnings.push(`Node "${id}" referenced unknown group "${group}".`);
    }
    nodeIndex.set(id, node);
    doc.nodes.push(node);
  }

  // --- edges ----------------------------------------------------------------
  for (const e of readCollection(raw, 'edges', warnings)) {
    const from = str(e.from) ?? str(e.source);
    const to = str(e.to) ?? str(e.target);
    // Either end may be a block or a zone: both are rectangles on the grid,
    // and "this whole subnet talks to that one" is a real thing to draw.
    const connectable = (id) => nodeIndex.has(id) || groupIndex.has(id);
    if (!connectable(from) || !connectable(to)) {
      warnings.push(`Dropped edge ${from || '?'} -> ${to || '?'}: endpoint does not exist.`);
      continue;
    }
    if (from === to) {
      warnings.push(`Dropped self-edge on "${from}".`);
      continue;
    }
    const id = takeId(e.id, `${from}-${to}`, usedIds, warnings, 'Edge');
    const route = EDGE_ROUTES.has(e.route) ? e.route : DEFAULT_EDGE_ROUTE;
    doc.edges.push({
      id,
      from,
      to,
      route,
      // The crossover only means anything once an axis has been chosen, so an
      // automatic route never carries one -- otherwise a stale number from an
      // earlier drag would silently come back the next time the axis was set.
      bend: route === DEFAULT_EDGE_ROUTE ? null : halfCell(e.bend),
      label: str(e.label) || '',
      style: EDGE_STYLES.has(e.style) ? e.style : 'solid',
      arrow: EDGE_ARROWS.has(e.arrow) ? e.arrow : 'end',
      color: color(e.color) || '#64748b',
      // A connection's caption is a flat rectangle like any other, so it hangs
      // on a plane too -- written on the ground along the line by default.
      labelPlane: isPlane(e.labelPlane) ? e.labelPlane : DEFAULT_PLANE,
      labelSize: clampInt(e.labelSize, 6, 96, DEFAULT_LABEL_SIZE),
      labelAlign: TEXT_ALIGNS.has(e.labelAlign) ? e.labelAlign : DEFAULT_LABEL_ALIGN,
    });
  }

  // --- text annotations -----------------------------------------------------
  for (const t of readCollection(raw, 'texts', warnings)) {
    // Leading and trailing whitespace is kept -- it may be deliberate
    // indentation -- but a note that is *only* whitespace renders as nothing
    // and would sit in the document as an invisible, unfindable entity.
    const raw = typeof t.text === 'string' ? t.text : str(t.label) ?? str(t.content);
    const body = raw?.trim() ? raw : null;
    if (!body) {
      warnings.push('Dropped a text annotation with no content.');
      continue;
    }
    doc.texts.push({
      id: takeId(t.id, body.split('\n')[0], usedIds, warnings, 'Text'),
      text: body,
      pos: readPair(t.pos ?? [t.x, t.y], [0, 0]),
      size: clampInt(t.size, 6, 200, TEXT_DEFAULTS.size),
      color: color(t.color) || TEXT_DEFAULTS.color,
      bold: t.bold === true,
      italic: t.italic === true,
      underline: t.underline === true,
      align: TEXT_ALIGNS.has(t.align) ? t.align : TEXT_DEFAULTS.align,
      ...readPlanar(t, TEXT_DEFAULTS.plane),
    });
  }

  // --- pictures -------------------------------------------------------------
  for (const im of readCollection(raw, 'images', warnings)) {
    const src = typeof im.src === 'string' ? im.src.trim() : '';
    if (!src) {
      warnings.push('Dropped an image with no src.');
      continue;
    }
    doc.images.push({
      id: takeId(im.id, str(im.label) || 'image', usedIds, warnings, 'Image'),
      src,
      label: str(im.label) || '',
      pos: readPair(im.pos ?? [im.x, im.y], [0, 0]),
      size: readPair(im.size ?? [im.w, im.h], IMAGE_DEFAULTS.size, 1),
      opacity: clamp(Number.isFinite(Number(im.opacity)) ? Number(im.opacity) : 1, 0.05, 1),
      ...readPlanar(im, IMAGE_DEFAULTS.plane),
    });
  }

  return { doc, warnings, rejection: null };
}

/**
 * The entries of one collection, complaining about anything unusable.
 *
 * Skipping a malformed entry is right -- one bad block should not cost you the
 * other seventeen -- but skipping it *quietly* is how a file half-written by
 * hand opens missing most of itself with nothing said. Every skip is named,
 * with its index, because "nodes[4]" is what makes it findable in the file.
 */
function* readCollection(raw, key, warnings) {
  const value = raw[key];
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) {
    warnings.push(`"${key}" is ${jsonKind(value)}, not a list; ignored it.`);
    return;
  }
  for (const [index, entry] of value.entries()) {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) yield entry;
    else warnings.push(`Dropped ${key}[${index}]: it is ${jsonKind(entry)}, not an object.`);
  }
}

/** Parent chains must be a forest; snap any cycle back to a root. */
function breakGroupCycles(groups, warnings) {
  const byId = new Map(groups.map((g) => [g.id, g]));
  for (const start of groups) {
    const seen = new Set([start.id]);
    let cur = start;
    while (cur.parent) {
      if (seen.has(cur.parent)) {
        warnings.push(`Group "${start.id}" is part of a parent cycle; detached it.`);
        cur.parent = null;
        break;
      }
      seen.add(cur.parent);
      cur = byId.get(cur.parent);
    }
  }
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

/** Deterministic text form of a document. Always ends with a newline. */
export function serializeDoc(doc) {
  const wire = {
    version: FORMAT_VERSION,
    meta: { title: doc.meta.title },
    // An automatic background is written by *not* being written, or reopening
    // the file would turn "no opinion" into a preference for whatever theme
    // happened to be on when it was saved.
    canvas: omitEmpty({ background: doc.canvas.background }),
    groups: doc.groups.map((g) => omitEmpty({
      id: g.id,
      kind: g.kind,
      label: g.label,
      rect: g.rect,
      color: g.color,
      labelPlane: g.labelPlane === DEFAULT_ZONE_LABEL_PLANE ? null : g.labelPlane,
      labelSize: g.labelSize === DEFAULT_LABEL_SIZE ? null : g.labelSize,
      parent: g.parent,
    })),
    nodes: doc.nodes.map((n) => omitEmpty({
      id: n.id,
      type: n.type,
      label: n.label,
      pos: n.pos,
      size: n.size,
      height: n.height,
      color: n.color,
      labelPlane: n.labelPlane === DEFAULT_PLANE ? null : n.labelPlane,
      labelSize: n.labelSize === DEFAULT_LABEL_SIZE ? null : n.labelSize,
      labelAlign: n.labelAlign === DEFAULT_LABEL_ALIGN ? null : n.labelAlign,
      group: n.group,
      props: isEmpty(n.props) ? null : n.props,
    })),
    edges: doc.edges.map((e) => omitEmpty({
      id: e.id,
      from: e.from,
      to: e.to,
      label: e.label || null,
      style: e.style,
      arrow: e.arrow,
      route: e.route === DEFAULT_EDGE_ROUTE ? null : e.route,
      bend: e.bend,
      color: e.color,
      labelPlane: e.labelPlane === DEFAULT_PLANE ? null : e.labelPlane,
      labelSize: e.labelSize === DEFAULT_LABEL_SIZE ? null : e.labelSize,
      labelAlign: e.labelAlign === DEFAULT_LABEL_ALIGN ? null : e.labelAlign,
    })),
    // Styling flags are written only when set, so a plain note stays a plain
    // three-line object in the file.
    texts: doc.texts.map((t) => omitEmpty({
      id: t.id,
      text: t.text,
      pos: t.pos,
      size: t.size,
      color: t.color,
      bold: t.bold || null,
      italic: t.italic || null,
      underline: t.underline || null,
      align: t.align === TEXT_DEFAULTS.align ? null : t.align,
      ...planarWire(t, TEXT_DEFAULTS.plane),
    })),
    images: doc.images.map((im) => omitEmpty({
      id: im.id,
      src: im.src,
      label: im.label || null,
      pos: im.pos,
      size: im.size,
      opacity: im.opacity === 1 ? null : im.opacity,
      ...planarWire(im, IMAGE_DEFAULTS.plane),
    })),
  };
  return stringify(wire, 0) + '\n';
}

/**
 * JSON with short primitive arrays kept inline. `JSON.stringify` would spread
 * `"pos": [2, 2]` across five lines, which makes the file tedious to read and
 * to write by hand.
 */
function stringify(value, depth) {
  const pad = '  '.repeat(depth);
  const padIn = '  '.repeat(depth + 1);

  if (value === null || typeof value !== 'object') return JSON.stringify(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every((v) => v === null || typeof v !== 'object')) {
      return `[${value.map((v) => JSON.stringify(v)).join(', ')}]`;
    }
    const items = value.map((v) => padIn + stringify(v, depth + 1));
    return `[\n${items.join(',\n')}\n${pad}]`;
  }

  const keys = Object.keys(value);
  if (keys.length === 0) return '{}';
  const items = keys.map((k) => `${padIn}${JSON.stringify(k)}: ${stringify(value[k], depth + 1)}`);
  return `{\n${items.join(',\n')}\n${pad}}`;
}

/** Placement fields, written only when they differ from the default. */
function planarWire(el, defaultPlane) {
  return {
    z: el.z || null,
    plane: el.plane === defaultPlane ? null : el.plane,
    spin: el.spin || null,
    behind: el.behind || null,
  };
}

function omitEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/** URL-ish slug; ids are meant to be read and typed by humans. */
export function slugify(text) {
  const slug = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'item';
}

/** `base`, or `base-2`, `base-3`... until it is not in `taken`. */
export function uniqueId(base, taken) {
  const slug = slugify(base);
  if (!taken.has(slug)) return slug;
  for (let i = 2; ; i++) {
    const candidate = `${slug}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function takeId(raw, fallback, used, warnings, kind) {
  const wanted = slugify(str(raw) || fallback);
  const id = uniqueId(wanted, used);
  if (raw && id !== String(raw)) {
    warnings.push(`${kind} id "${raw}" was renamed to "${id}".`);
  }
  used.add(id);
  return id;
}

// ---------------------------------------------------------------------------
// Field coercion
// ---------------------------------------------------------------------------

function str(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * A caption that is allowed to be empty.
 *
 * An absent field and an empty one say different things: "nothing was
 * specified, name it after its type" versus "draw no caption here". `str`
 * collapses the two, which is why a label the user deleted used to grow back
 * the next time the file was opened. Blocks and zones are the only fields that
 * carry a non-empty default, so they are the only ones that needed this.
 */
function readLabel(raw, fallback) {
  return typeof raw === 'string' ? raw.trim() : fallback;
}

function color(v) {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim().toLowerCase() : null;
}

function int(v, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : fallback;
}

function readPair(v, fallback, min = -MAX_SPAN) {
  if (!Array.isArray(v)) return [...fallback];
  return [
    clampInt(v[0], min, MAX_SPAN, fallback[0]),
    clampInt(v[1], min, MAX_SPAN, fallback[1]),
  ];
}

/**
 * A coordinate on the half-cell grid, or null.
 *
 * Half rather than whole cells because a connection runs between block
 * *centres*, and a block of even width has its centre on a half cell -- snap a
 * dragged crossover to integers and it can never line up with the run it came
 * from.
 */
function halfCell(v) {
  // `Number(null)` is 0, not NaN, so "no crossover" would come back as a
  // crossover at zero -- and an edge with a pinned axis and no bend would jump
  // the first time its document was normalised again.
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return clamp(Math.round(n * 2) / 2, -MAX_SPAN, MAX_SPAN);
}

function readRect(v) {
  const a = Array.isArray(v) ? v : [];
  return [
    clampInt(a[0], -MAX_SPAN, MAX_SPAN, 0),
    clampInt(a[1], -MAX_SPAN, MAX_SPAN, 0),
    clampInt(a[2], 1, MAX_SPAN, 4),
    clampInt(a[3], 1, MAX_SPAN, 4),
  ];
}

/** Free-form annotations, restricted to flat string values. */
function plainProps(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (val === null || typeof val === 'object') continue;
    out[k] = String(val);
  }
  return out;
}

function isEmpty(obj) {
  return !obj || Object.keys(obj).length === 0;
}
