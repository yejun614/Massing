/**
 * Read-only queries and mutators over a document.
 *
 * Everything here is plain functions on the document object so the renderer,
 * the input layer and the UI panels can share one notion of "where is this
 * thing" without importing each other.
 */

import { rotateRect } from '../geom/iso.js';
import { componentFor, groupKindFor } from '../data/components.js';
import {
  uniqueId,
  TEXT_DEFAULTS,
  IMAGE_DEFAULTS,
  DEFAULT_PLANE,
  DEFAULT_ZONE_LABEL_PLANE,
  DEFAULT_LABEL_SIZE,
  DEFAULT_LABEL_ALIGN,
  DEFAULT_EDGE_ROUTE,
} from './schema.js';

export function nodeById(doc, id) {
  return doc.nodes.find((n) => n.id === id) || null;
}

export function groupById(doc, id) {
  return doc.groups.find((g) => g.id === id) || null;
}

export function edgeById(doc, id) {
  return doc.edges.find((e) => e.id === id) || null;
}

export function textById(doc, id) {
  return doc.texts.find((t) => t.id === id) || null;
}

export function imageById(doc, id) {
  return doc.images.find((i) => i.id === id) || null;
}

/** Anything flat that shares the plane/spin placement model. */
export function planarById(doc, id) {
  return textById(doc, id) || imageById(doc, id);
}

/** Any selectable entity, tagged with what it is. */
export function entityById(doc, id) {
  const node = nodeById(doc, id);
  if (node) return { kind: 'node', entity: node };
  const group = groupById(doc, id);
  if (group) return { kind: 'group', entity: group };
  const edge = edgeById(doc, id);
  if (edge) return { kind: 'edge', entity: edge };
  const text = textById(doc, id);
  if (text) return { kind: 'text', entity: text };
  const image = imageById(doc, id);
  if (image) return { kind: 'image', entity: image };
  return null;
}

export function allIds(doc) {
  return new Set([
    ...doc.nodes.map((n) => n.id),
    ...doc.groups.map((g) => g.id),
    ...doc.edges.map((e) => e.id),
    ...doc.texts.map((t) => t.id),
    ...doc.images.map((i) => i.id),
  ]);
}

// ---------------------------------------------------------------------------
// Footprints
// ---------------------------------------------------------------------------

/** A node's box in document grid space. */
export function nodeBox(node) {
  return {
    x: node.pos[0],
    y: node.pos[1],
    w: node.size[0],
    h: node.size[1],
    z: 0,
    ht: node.height,
  };
}

/** A group's slab in document grid space. */
export function groupBox(group) {
  const [x, y, w, h] = group.rect;
  return { x, y, w, h, z: 0, ht: 0 };
}

/**
 * Anything a connection can attach to, as a ground box, or null.
 *
 * A block and a zone are both rectangles on the grid, so routing a connection
 * never has to care which of the two it found -- only where the edges of it
 * are, and how far off the ground to start.
 */
export function endpointBox(doc, id) {
  const node = nodeById(doc, id);
  if (node) return { ...nodeBox(node) };
  const group = groupById(doc, id);
  if (group) return { ...groupBox(group) };
  return null;
}

export function canConnect(doc, id) {
  return endpointBox(doc, id) !== null;
}

/** Re-anchor a box for the current camera rotation. */
export function rotatedBox(box, rot) {
  const r = rotateRect(box.x, box.y, box.w, box.h, rot);
  return { ...box, x: r.x, y: r.y, w: r.w, h: r.h };
}

/** Grid-space extent of everything in the document. */
export function docBounds(doc) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let zmax = 0;

  const consider = (b) => {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
    zmax = Math.max(zmax, b.z + b.ht);
  };
  doc.nodes.forEach((n) => consider(nodeBox(n)));
  doc.groups.forEach((g) => consider(groupBox(g)));
  doc.texts.forEach((t) => consider({ x: t.pos[0], y: t.pos[1], w: 1, h: 1, z: 0, ht: 0 }));
  doc.images.forEach((i) =>
    consider({ x: i.pos[0], y: i.pos[1], w: i.size[0], h: i.size[1], z: 0, ht: 0 })
  );

  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 12, y1: 12, zmax: 3 };
  return { x0, y0, x1, y1, zmax };
}

export function boxesOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function boxContains(outer, inner) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

/** Nesting level; 0 for a top-level group. */
export function groupDepth(doc, group) {
  let depth = 0;
  let cur = group;
  while (cur?.parent && depth < 32) {
    cur = groupById(doc, cur.parent);
    depth++;
  }
  return depth;
}

/**
 * Groups ordered for painting: outer slabs first, and among siblings the
 * larger one first so a nested slab is never hidden by its parent.
 */
export function groupsInPaintOrder(doc) {
  return doc.groups
    .map((g) => ({ group: g, depth: groupDepth(doc, g), area: g.rect[2] * g.rect[3] }))
    .sort((a, b) => a.depth - b.depth || b.area - a.area)
    .map((entry) => entry.group);
}

export function nodesInGroup(doc, groupId) {
  return doc.nodes.filter((n) => n.group === groupId);
}

/**
 * The innermost group whose rectangle fully contains `box`, or null.
 * Used to re-assign membership after a node is moved.
 */
export function containingGroup(doc, box, ignoreId = null) {
  let best = null;
  let bestArea = Infinity;
  for (const g of doc.groups) {
    if (g.id === ignoreId) continue;
    if (!boxContains(groupBox(g), box)) continue;
    const area = g.rect[2] * g.rect[3];
    if (area < bestArea) {
      best = g;
      bestArea = area;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Mutators -- always called from inside store.commit()
// ---------------------------------------------------------------------------

export function makeNode(doc, type, x, y, overrides = {}) {
  const def = componentFor(type);
  const label = overrides.label ?? def.label;
  return {
    // An empty label is allowed, but it makes a useless id, so the type's own
    // name stands in for the slug and only for the slug.
    id: uniqueId(overrides.id || label || def.label, allIds(doc)),
    type: def.type,
    label,
    pos: [x, y],
    size: [...def.size],
    height: def.height,
    color: def.color,
    labelPlane: DEFAULT_PLANE,
    labelSize: DEFAULT_LABEL_SIZE,
    labelAlign: DEFAULT_LABEL_ALIGN,
    group: null,
    props: {},
    ...stripIdentity(overrides),
  };
}

export function makeGroup(doc, kind, rect, overrides = {}) {
  const def = groupKindFor(kind);
  const label = overrides.label ?? def.label;
  return {
    id: uniqueId(overrides.id || label || def.label, allIds(doc)),
    kind: def.kind,
    label,
    rect: [...rect],
    color: def.color,
    labelPlane: DEFAULT_ZONE_LABEL_PLANE,
    labelSize: DEFAULT_LABEL_SIZE,
    parent: null,
    ...stripIdentity(overrides),
  };
}

/**
 * What a note is born at, which is not what an unstated `size` falls back to.
 *
 * A note lies on the ground, where the projection and the 45-degree skew each
 * take a cut, so `TEXT_DEFAULTS.size` -- fine for the format, since it is only
 * ever reached by a file that left the field out -- produces a smudge nobody
 * can read the moment it is on screen. A note someone has just made should be
 * legible without a trip to the inspector first.
 */
export const NEW_TEXT_SIZE = 50;

export function makeText(doc, x, y, overrides = {}) {
  const body = overrides.text ?? 'Double-click to edit';
  return {
    id: uniqueId(overrides.id ?? body.split('\n')[0], allIds(doc)),
    text: body,
    pos: [x, y],
    size: NEW_TEXT_SIZE,
    color: TEXT_DEFAULTS.color,
    bold: false,
    italic: false,
    underline: false,
    align: TEXT_DEFAULTS.align,
    z: 0,
    plane: TEXT_DEFAULTS.plane,
    spin: 0,
    behind: false,
    ...stripIdentity(overrides),
  };
}

export function makeImage(doc, x, y, overrides = {}) {
  return {
    id: uniqueId(overrides.id ?? overrides.label ?? 'image', allIds(doc)),
    src: '',
    label: '',
    pos: [x, y],
    size: [...IMAGE_DEFAULTS.size],
    opacity: IMAGE_DEFAULTS.opacity,
    z: 0,
    plane: IMAGE_DEFAULTS.plane,
    spin: 0,
    behind: false,
    ...stripIdentity(overrides),
  };
}

export function makeEdge(doc, from, to, overrides = {}) {
  return {
    id: uniqueId(overrides.id ?? `${from}-${to}`, allIds(doc)),
    from,
    to,
    route: DEFAULT_EDGE_ROUTE,
    bend: null,
    label: '',
    style: 'solid',
    arrow: 'end',
    color: '#64748b',
    labelPlane: DEFAULT_PLANE,
    labelSize: DEFAULT_LABEL_SIZE,
    labelAlign: DEFAULT_LABEL_ALIGN,
    ...stripIdentity(overrides),
  };
}

/** Remove entities and everything that referenced them. */
export function removeEntities(doc, ids) {
  const dead = new Set(ids);
  doc.nodes = doc.nodes.filter((n) => !dead.has(n.id));
  doc.groups = doc.groups.filter((g) => !dead.has(g.id));
  doc.texts = doc.texts.filter((t) => !dead.has(t.id));
  doc.images = doc.images.filter((i) => !dead.has(i.id));
  doc.edges = doc.edges.filter(
    (e) => !dead.has(e.id) && !dead.has(e.from) && !dead.has(e.to)
  );
  for (const g of doc.groups) if (dead.has(g.parent)) g.parent = null;
  for (const n of doc.nodes) if (dead.has(n.group)) n.group = null;
}

/** Recompute group membership for `nodes` after a move or resize. */
export function reassignGroups(doc, nodes) {
  for (const node of nodes) {
    const group = containingGroup(doc, nodeBox(node));
    node.group = group ? group.id : null;
  }
}

function stripIdentity(overrides) {
  const { id, ...rest } = overrides;
  return rest;
}
