/**
 * Isometric projection.
 *
 * World space is a grid: integer `(x, y)` on the ground plane, `z` upward in
 * cell units. The projection maps that to screen pixels through three basis
 * vectors, so every shape in the app is just a linear combination of them.
 *
 *   ex = ( cos30, sin30) * CELL   +x goes right and down
 *   ey = (-cos30, sin30) * CELL   +y goes left and down
 *   ez = ( 0,    -1    ) * CELL   +z goes straight up on screen
 *
 * Camera rotation is NOT part of the projection. It is a remap of grid
 * coordinates applied before projecting (see `rotatePoint`), which keeps the
 * projection itself a fixed 2x3 matrix and makes the inverse trivial.
 */

import { round2 } from '../util/num.js';

export const COS30 = Math.sqrt(3) / 2;
export const SIN30 = 0.5;

/** Pixel length of one grid cell edge at zoom 1. */
export const CELL = 40;

// ---------------------------------------------------------------------------
// Rotation: a 90-degree remap of the ground plane, applied before projecting.
// ---------------------------------------------------------------------------

/** Rotate a ground point by `rot` quarter-turns. */
export function rotatePoint(x, y, rot) {
  switch (((rot % 4) + 4) % 4) {
    case 0: return { x, y };
    case 1: return { x: y, y: -x };
    case 2: return { x: -x, y: -y };
    default: return { x: -y, y: x };
  }
}

/** Inverse of `rotatePoint`. */
export function unrotatePoint(x, y, rot) {
  return rotatePoint(x, y, -rot);
}

/**
 * Rotate an axis-aligned footprint and return it re-anchored at its minimum
 * corner. Odd rotations swap width and height, so callers must use the
 * returned `w`/`h` rather than the original ones.
 */
export function rotateRect(x, y, w, h, rot) {
  const a = rotatePoint(x, y, rot);
  const b = rotatePoint(x + w, y + h, rot);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

/**
 * A Projection converts rotated grid coordinates to unzoomed scene pixels.
 * `iso` and `flat` share this shape so the 2D/3D toggle is a swap of one
 * object -- hit testing, dragging and rendering are written against the
 * interface and need no branching.
 */

/** 3D isometric projection: blocks show a top face and two side faces. */
export const isoProjection = {
  kind: 'iso',
  showsSides: true,
  ex: { x: COS30 * CELL, y: SIN30 * CELL },
  ey: { x: -COS30 * CELL, y: SIN30 * CELL },
  ez: { x: 0, y: -CELL },

  project(x, y, z = 0) {
    return {
      x: (x - y) * COS30 * CELL,
      y: (x + y) * SIN30 * CELL - z * CELL,
    };
  },

  /** Screen point -> grid point on the horizontal plane at height `z`. */
  unproject(sx, sy, z = 0) {
    const ground = sy + z * CELL;
    const d = sx / (COS30 * CELL); // x - y
    const s = ground / (SIN30 * CELL); // x + y
    return { x: (s + d) / 2, y: (s - d) / 2 };
  },
};

/** 2D top-down projection: height collapses, only the top face is drawn. */
export const flatProjection = {
  kind: 'flat',
  showsSides: false,
  ex: { x: CELL, y: 0 },
  ey: { x: 0, y: CELL },
  ez: { x: 0, y: 0 },

  project(x, y) {
    return { x: x * CELL, y: y * CELL };
  },

  unproject(sx, sy) {
    return { x: sx / CELL, y: sy / CELL };
  },
};

export function getProjection(kind) {
  return kind === 'flat' ? flatProjection : isoProjection;
}

// ---------------------------------------------------------------------------
// Shape helpers, all in projection-local coordinates
// ---------------------------------------------------------------------------

/** Format a list of grid points as an SVG `points` attribute. */
export function polygonPoints(proj, pts) {
  let out = '';
  for (const [x, y, z] of pts) {
    const p = proj.project(x, y, z || 0);
    if (out) out += ' ';
    out += `${round2(p.x)},${round2(p.y)}`;
  }
  return out;
}

/**
 * The three visible faces of a box whose footprint is `[0,w] x [0,h]` at
 * height `ht`. The viewer is above and in front, so the visible sides are the
 * ones at maximum x (right) and maximum y (left).
 */
export function boxFaces(proj, w, h, ht) {
  return {
    top: polygonPoints(proj, [[0, 0, ht], [w, 0, ht], [w, h, ht], [0, h, ht]]),
    right: polygonPoints(proj, [[w, 0, ht], [w, h, ht], [w, h, 0], [w, 0, 0]]),
    left: polygonPoints(proj, [[0, h, ht], [w, h, ht], [w, h, 0], [0, h, 0]]),
  };
}

/**
 * Affine matrix that lays a square icon flat on the top face of a box.
 *
 * Maps icon viewBox space `[0, vb] x [0, vb]` onto the plane spanned by the
 * projection's ex/ey at height `ht`, centred on the footprint.
 */
export function topFaceMatrix(proj, w, h, ht, sizeInCells, vb = 24) {
  const k = sizeInCells / vb;
  const origin = proj.project((w - sizeInCells) / 2, (h - sizeInCells) / 2, ht);
  const a = proj.ex.x * k;
  const b = proj.ex.y * k;
  const c = proj.ey.x * k;
  const d = proj.ey.y * k;
  return `matrix(${round2(a)},${round2(b)},${round2(c)},${round2(d)},${round2(origin.x)},${round2(origin.y)})`;
}

