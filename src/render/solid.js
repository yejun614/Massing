/**
 * Standing a flat outline up into the scene.
 *
 * Shared by everything drawn as a slab on the ground — flowchart shapes and
 * data structures both — because the trick is the same one and it is worth
 * having in a single place: `+z` projects to exactly `CELL` pixels *straight up
 * the screen* and nothing sideways, so the top of a solid is its footprint
 * shifted vertically, and the body between them needs no three-dimensional
 * machinery at all.
 *
 * What it does need is the *outer silhouette* rather than one quad per edge of
 * the ring. Quads are the cheap version and they are wrong twice over: a stroke
 * on them draws every seam between neighbours, which on a curve comes out as a
 * coil, and without a stroke the solid has no vertical edges to be read by.
 */

import { CELL, rotatePoint } from '../geom/iso.js';
import { round2 } from '../util/num.js';

/**
 * How a solid on this ground is lit, matching the block's own faces: the lid a
 * shade lighter than the colour it was given, the walls a shade darker. Here
 * rather than in each renderer so two slabs standing side by side cannot
 * disagree about where the light comes from.
 */
export const FACE_LIGHT = 0.06;
export const WALL_SHADE = -0.16;
/** The two visible walls, lit exactly as a block's two faces are. */
export const RIGHT_SHADE = -0.07;
export const LEFT_SHADE = -0.18;

/**
 * A line cut into a lid rather than drawn on it: the shadowed edge, the lit
 * lower lip, and how far below the shadow that lip sits in screen pixels.
 *
 * Shared so a structure's slot dividers and a subroutine's bars are the same
 * cut in the same light — and shallow, because a groove between two slots is a
 * millimetre deep, not a gap onto the void.
 */
export const GROOVE_SHADE = -0.17;
export const GROOVE_LIGHT = 0.16;
export const GROOVE = 1.4;

/**
 * A ring given in an entity's own pixel space, projected onto the ground.
 *
 * The local space is the footprint: a point `CELL` pixels along is one cell
 * along, which is what lets a shape describe itself in pixels and land on the
 * grid without knowing anything about the projection.
 */
export function projectRing(points, origin, proj, rot) {
  return points.map(([lx, ly]) => {
    const g = rotatePoint(origin[0] + lx / CELL, origin[1] + ly / CELL, rot);
    return proj.project(g.x, g.y, 0);
  });
}

export const ringPath = (points) =>
  `M${points.map((p) => `${round2(p.x)},${round2(p.y)}`).join(' L')} Z`;

/** The same ring, `lift` screen pixels higher: the top face of the solid. */
export const liftRing = (ring, lift) => ring.map((p) => ({ x: p.x, y: p.y - lift }));

/**
 * The outline of the whole solid: the ring on the ground, the same ring lifted,
 * and the two verticals joining them at the extremes.
 *
 * The extremes are the leftmost and rightmost points on screen, which for a
 * convex ring are exactly where the silhouette turns from the bottom copy to
 * the top one. Between them the boundary runs along whichever of the two chains
 * hangs lower — worked out by comparing them rather than assumed, because which
 * way the ring winds on screen changes with the camera's rotation.
 */
/**
 * The two chains of a convex ring, in screen order.
 *
 * The extremes are the leftmost and rightmost points on screen, which for a
 * convex ring are exactly where a silhouette turns from the bottom copy to the
 * top one. Between them the boundary runs along whichever of the two chains
 * hangs lower — worked out by comparing them rather than assumed, because which
 * way the ring winds on screen changes with the camera's rotation.
 */
function chains(ring) {
  const n = ring.length;
  let left = 0;
  let right = 0;
  for (let i = 1; i < n; i++) {
    if (ring[i].x < ring[left].x) left = i;
    if (ring[i].x > ring[right].x) right = i;
  }
  const walk = (step) => {
    const out = [];
    for (let i = left; ; i = (i + step + n) % n) {
      out.push(i);
      if (i === right) break;
    }
    return out;
  };
  const forward = walk(1);
  const backward = walk(-1);
  const depth = (chain) => chain.reduce((sum, i) => sum + ring[i].y, 0) / chain.length;
  const lower = depth(forward) >= depth(backward) ? forward : backward;
  return { lower, upper: lower === forward ? backward : forward };
}

/** A closed silhouette from a run of the ground ring and the lifted copy of it. */
const wallPath = (part, ring, top) =>
  ringPath([...part.map((i) => ring[i]), ...part.slice().reverse().map((i) => top[i])]);

/**
 * The solid's two visible walls, told apart so they can be lit differently.
 *
 * A cuboid is legible because its two faces are different shades of one colour,
 * and a slab painted in a single one reads as a flat outline with a thick
 * border. The split is at the ring's *lowest* point on screen: that is the near
 * corner, and everything before it faces one way while everything after it
 * faces the other, at every camera rotation and for a curve as readily as for a
 * rectangle.
 */
export function bodyWalls(ring, top) {
  const { lower } = chains(ring);
  let at = 0;
  for (let i = 1; i < lower.length; i++) {
    if (ring[lower[i]].y > ring[lower[at]].y) at = i;
  }
  return {
    left: wallPath(lower.slice(0, at + 1), ring, top),
    right: wallPath(lower.slice(at), ring, top),
  };
}

/** The whole silhouette as one path, for a hint that is drawn in one colour. */
export function bodyPath(ring, top) {
  const { lower, upper } = chains(ring);
  return ringPath([
    ...lower.map((i) => ring[i]),
    ...upper.slice().reverse().map((i) => top[i]),
  ]);
}

/** Loose line segments in local pixels, projected onto the top face. */
export function segmentsOnTop(segments, origin, proj, rot, lift) {
  return segments
    .map(([a, b]) => {
      const [p, q] = projectRing([a, b], origin, proj, rot);
      return `M${round2(p.x)},${round2(p.y - lift)} L${round2(q.x)},${round2(q.y - lift)}`;
    })
    .join(' ');
}
