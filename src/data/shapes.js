/**
 * Flowchart shapes: the vocabulary, and the geometry of each one.
 *
 * The convention for a step in an algorithm — a century old and taught
 * everywhere — is an outline whose *silhouette* carries the meaning. A diamond
 * is a question. A stadium is where the thing begins or ends. That is why these
 * are not blocks with a different texture: the shape is the word, and a cuboid
 * cannot say it.
 *
 * What they are not is flat. A silhouette lying on the ground of an isometric
 * scene is read through the projection's skew, and a diamond seen that way is a
 * parallelogram — the one thing the shape most needed not to look like. So the
 * ring described here is extruded: given a height it becomes a slab standing on
 * the floor, whose top face is the silhouette and whose sides give the eye the
 * depth cue that tells it what the top is. A height of 0 is still allowed and
 * still draws the flat outline. See `render/shape.js`.
 *
 * Each kind is described once, here, in three parts:
 *
 *   `points`   the silhouette as a ring, in the shape's own pixel space
 *   `inner`    anything drawn inside it (only the subroutine has any)
 *   `contains` the same silhouette as a test, in unit coordinates
 *
 * The third is not decoration. A connection is trimmed back to the boundary of
 * whatever it points at, and against a bounding box a line into a diamond stops
 * in mid-air a good half-shape short. `contains` is what lets the router find
 * the real edge — see `edgeRoute` in `render/edge.js` — so the arrow lands on
 * the point of the diamond rather than near it.
 */

import { round2 } from '../util/num.js';

/** How far an I/O parallelogram leans, and how far in a subroutine's bars sit. */
const LEAN = 0.28;
const BAR = 0.16;

/** Segments per quarter turn when a curve is flattened into a polygon. */
const ARC_STEPS = 7;

const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];

/**
 * A stadium: a rectangle with both ends rounded off entirely.
 *
 * Sampled rather than described with arcs, like every curve here, because these
 * outlines are extruded — and a solid is built by walking a *ring of points* up
 * into the air. One list of points is the single source both the flat silhouette
 * and the standing one are drawn from; two descriptions of the same curve would
 * eventually disagree about where its edge is.
 */
function stadium(w, h) {
  const r = Math.min(w, h) / 2;
  const ry = h / 2;
  const pts = [];
  const arc = (cx, from) => {
    for (let i = 0; i <= ARC_STEPS * 2; i++) {
      const a = from + (Math.PI * i) / (ARC_STEPS * 2);
      pts.push([cx + Math.cos(a) * r, ry + Math.sin(a) * ry]);
    }
  };
  arc(w - r, -Math.PI / 2); // the right end, top to bottom
  arc(r, Math.PI / 2); // the left end, bottom to top
  return pts;
}

function ellipse(w, h) {
  const pts = [];
  const n = ARC_STEPS * 4;
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n;
    pts.push([w / 2 + (Math.cos(a) * w) / 2, h / 2 + (Math.sin(a) * h) / 2]);
  }
  return pts;
}

const diamond = (w, h) => [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]];

function parallelogram(w, h) {
  const s = Math.min(w, h) * LEAN;
  return [[s, 0], [w, 0], [w - s, h], [0, h]];
}

/** Loose segments as an SVG path, for the palette icon. */
export function segmentsToPath(segments) {
  return segments
    .map(([[ax, ay], [bx, by]]) =>
      `M${round2(ax)},${round2(ay)} L${round2(bx)},${round2(by)}`)
    .join(' ');
}

/** The ring as an SVG path, for the palette icon. */
export function outlinePath(points) {
  return `M${points.map(([x, y]) => `${round2(x)},${round2(y)}`).join(' L')} Z`;
}

/**
 * The shapes, in the order a flowchart is usually drawn: where it starts, what
 * it does, what it asks, what goes in and out, what it defers to, and how a
 * line gets to the other side of the page.
 */
export const SHAPE_KINDS = [
  {
    kind: 'terminal',
    label: 'Start / end',
    hint: 'Where the algorithm begins or finishes',
    size: [4, 2],
    points: stadium,
    contains: (u, v, w, h) => {
      // The straight middle, or either rounded end.
      const ru = Math.min(w, h) / 2 / w;
      if (u >= ru && u <= 1 - ru) return true;
      const cu = u < 0.5 ? ru : 1 - ru;
      const du = (u - cu) / ru;
      const dv = (v - 0.5) * 2;
      return du * du + dv * dv <= 1;
    },
  },
  {
    kind: 'process',
    label: 'Process',
    hint: 'A step that does something',
    size: [5, 2],
    points: rect,
    contains: () => true,
  },
  {
    kind: 'decision',
    label: 'Decision',
    hint: 'A question, with a branch for each answer',
    size: [5, 3],
    points: diamond,
    contains: (u, v) => Math.abs(u - 0.5) * 2 + Math.abs(v - 0.5) * 2 <= 1,
  },
  {
    kind: 'io',
    label: 'Input / output',
    hint: 'Something read in or written out',
    size: [5, 2],
    points: parallelogram,
    contains: (u, v, w, h) => {
      const s = (Math.min(w, h) * LEAN) / w;
      return u >= s * (1 - v) && u <= 1 - s * v;
    },
  },
  {
    kind: 'subroutine',
    label: 'Subroutine',
    hint: 'A step defined by another diagram',
    size: [5, 2],
    points: rect,
    // Segments rather than a path, for the same reason the ring is points: they
    // are projected onto the top face, not transformed onto a plane.
    inner: (w, h) => {
      const b = Math.min(w, h) * BAR;
      return [[[b, 0], [b, h]], [[w - b, 0], [w - b, h]]];
    },
    contains: () => true,
  },
  {
    kind: 'connector',
    label: 'Connector',
    hint: 'Picks a line up where it was left off',
    size: [2, 2],
    points: ellipse,
    contains: (u, v) => {
      const du = (u - 0.5) * 2;
      const dv = (v - 0.5) * 2;
      return du * du + dv * dv <= 1;
    },
  },
];

const SHAPES_BY_KIND = new Map(SHAPE_KINDS.map((s) => [s.kind, s]));

export const DEFAULT_SHAPE_KIND = 'process';

export const isKnownShape = (kind) => SHAPES_BY_KIND.has(kind);

/** Falls back to a plain process box, the way an unknown block becomes a plain one. */
export function shapeKindFor(kind) {
  return SHAPES_BY_KIND.get(kind) ?? SHAPES_BY_KIND.get(DEFAULT_SHAPE_KIND);
}

/**
 * Whether a point inside the shape's *bounding box* is inside the shape, in
 * unit coordinates. Anything outside the box is outside the shape, so callers
 * that have already done the box test may skip it here.
 */
export function shapeContains(kind, u, v, w, h) {
  if (u < 0 || u > 1 || v < 0 || v > 1) return false;
  return shapeKindFor(kind).contains(u, v, Math.max(w, 1e-6), Math.max(h, 1e-6));
}
