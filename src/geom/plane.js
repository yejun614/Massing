/**
 * Placing flat 2D content into the isometric world.
 *
 * A picture or a line of prose is a rectangle, and there are only four
 * interesting ways to hang a rectangle in this scene: flat on the ground, up
 * against either of the two visible walls, or square to the screen. Each is a
 * plane spanned by two of the world's basis directions, so all four collapse
 * to the same job -- build the 2x3 affine matrix that maps the element's own
 * pixel space onto the screen.
 *
 * The projection is linear, so projecting a *direction* is the same call as
 * projecting a point. And every unit grid direction projects to exactly CELL
 * pixels, so dividing by CELL yields a unit screen vector: local pixels stay
 * local pixels, skewed but never rescaled. A 14px font is 14px along its
 * plane, whichever plane that is.
 */

import { CELL, rotatePoint } from './iso.js';
import { round2, round6 } from '../util/num.js';

/** `screen` keeps content square to the viewer; the rest lie in the world. */
export const PLANES = ['screen', 'floor', 'right', 'left'];

export const PLANE_LABELS = {
  screen: 'Face the viewer',
  floor: 'Lie on the ground',
  right: 'Stand on the right wall',
  left: 'Stand on the left wall',
};

/** In-plane rotations, in degrees. */
export const SPINS = [0, 90, 180, 270];

/**
 * Which two world directions span each plane, as (x, y, z) grid vectors.
 *
 * `v` is -z on a wall because image space grows downward while world height
 * grows up the screen. `u` is then chosen so the pair always has a *positive*
 * determinant on screen: a negative one silently mirrors everything drawn on
 * the plane, which renders text as its own reflection.
 *
 * That is why the left wall runs along -y rather than the +y one might expect.
 * On the wall we see from the left, the direction that reads left-to-right on
 * screen is the one going away from the viewer.
 */
const BASIS = {
  floor: { u: [1, 0, 0], v: [0, 1, 0] },
  right: { u: [1, 0, 0], v: [0, 0, -1] },
  left: { u: [0, -1, 0], v: [0, 0, -1] },
};

export function isPlane(value) {
  return PLANES.includes(value);
}

/**
 * The plane actually used for drawing.
 *
 * In the 2D top-down view height collapses, which would flatten both walls to
 * a zero-height sliver. Standing content falls back to facing the viewer so it
 * stays readable rather than disappearing.
 */
export function effectivePlane(plane, proj) {
  if (plane === 'screen' || !isPlane(plane)) return 'screen';
  if (!proj.showsSides && plane !== 'floor') return 'screen';
  return plane;
}

/** Project a world *direction* and normalise it to one screen pixel per unit. */
function directionToScreen(proj, rot, [gx, gy, gz]) {
  const r = rotatePoint(gx, gy, rot);
  const p = proj.project(r.x, r.y, gz); // linear: this is the vector, not a point
  return { x: p.x / CELL, y: p.y / CELL };
}

function screenBasis(proj, rot, plane) {
  if (plane === 'screen') return { u: { x: 1, y: 0 }, v: { x: 0, y: 1 } };
  const basis = BASIS[plane];
  return {
    u: directionToScreen(proj, rot, basis.u),
    v: directionToScreen(proj, rot, basis.v),
  };
}

/**
 * Where an element's plane sits, before any spin: an origin in scene pixels
 * and the two unit axes its local pixel space is drawn along.
 *
 * Rounded exactly as the emitted matrix is, so anything positioned from these
 * numbers -- a resize grip, say -- lands on the same pixel as the element.
 */
function planeFrame(proj, rot, el, spinCentre) {
  const anchor = rotatePoint(el.pos[0], el.pos[1], rot);
  const origin = proj.project(anchor.x, anchor.y, el.z ?? 0);
  let { u, v } = screenBasis(proj, rot, effectivePlane(el.plane, proj));

  // Orbiting the camera eventually brings you round to the *back* of a wall,
  // where the plane's axes wind the other way and everything on it would be
  // drawn as its own reflection. Physically that is what seeing the reverse of
  // a poster looks like, but unreadable text is no use in a diagram, so the
  // in-plane direction is flipped to keep content facing the reader.
  //
  // The flip is folded into the matrix rather than appended as another
  // transform: mirroring local x about `cx` maps (x, y) to (2cx - x, y), which
  // is exactly u -> -u with the origin walked along u by 2cx. Images spin
  // about their centre so they stay put; text flips about its anchor.
  let ox = origin.x;
  let oy = origin.y;
  if (u.x * v.y - u.y * v.x < 0) {
    const shift = 2 * spinCentre[0];
    ox += u.x * shift;
    oy += u.y * shift;
    u = { x: -u.x, y: -u.y };
  }

  // The basis is kept at full precision, the translation only needs pixels.
  return {
    origin: { x: round2(ox), y: round2(oy) },
    u: { x: round6(u.x), y: round6(u.y) },
    v: { x: round6(v.x), y: round6(v.y) },
  };
}

/**
 * SVG transform putting an element's local pixel space onto its plane.
 *
 * @param {object} proj      current projection
 * @param {number} rot       camera rotation in quarter-turns
 * @param {object} el        `{ pos: [x, y], z, plane, spin }`
 * @param {[number, number]} spinCentre  local pixel point to spin about
 */
export function planeTransform(proj, rot, el, spinCentre = [0, 0]) {
  const { origin, u, v } = planeFrame(proj, rot, el, spinCentre);
  const matrix = `matrix(${u.x},${u.y},${v.x},${v.y},${origin.x},${origin.y})`;

  const spin = normaliseSpin(el.spin);
  if (!spin) return matrix;
  return `${matrix} rotate(${spin} ${round2(spinCentre[0])} ${round2(spinCentre[1])})`;
}

/**
 * The same placement as `planeTransform`, as numbers rather than a string and
 * with the spin folded in: a local pixel point `(lx, ly)` sits at
 * `origin + u*lx + v*ly` in scene pixels.
 *
 * Resize grips have to be put on a flat element's own corners and a drag has
 * to be read back into its local pixels. Deriving both from the frame the
 * renderer already uses is the only way the grip and the picture cannot end up
 * disagreeing about where a corner is.
 */
export function planeAxes(proj, rot, el, spinCentre = [0, 0]) {
  const frame = planeFrame(proj, rot, el, spinCentre);
  const spin = normaliseSpin(el.spin);
  if (!spin) return frame;

  // SVG applies `rotate(a cx cy)` in local space, so folding it in is a change
  // of axes plus whatever shift keeps the spin centre where it was.
  const rad = (spin * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const { origin, u, v } = frame;
  const su = { x: u.x * cos + v.x * sin, y: u.y * cos + v.y * sin };
  const sv = { x: -u.x * sin + v.x * cos, y: -u.y * sin + v.y * cos };
  const [cx, cy] = spinCentre;
  return {
    origin: {
      x: origin.x + (u.x * cx + v.x * cy) - (su.x * cx + sv.x * cy),
      y: origin.y + (u.y * cx + v.y * cy) - (su.y * cx + sv.y * cy),
    },
    u: su,
    v: sv,
  };
}

/**
 * A scene-pixel vector read back into an element's own local pixels.
 *
 * Only the axes are involved, never the origin -- which is what makes it safe
 * to use during a resize. The origin of a spun or flipped plane is a function
 * of the element's own size, so mapping absolute points would feed the new
 * size straight back into the reading and run away.
 */
export function planeVector(axes, dx, dy) {
  const det = axes.u.x * axes.v.y - axes.u.y * axes.v.x;
  if (!det) return { x: 0, y: 0 };
  return {
    x: (dx * axes.v.y - dy * axes.v.x) / det,
    y: (dy * axes.u.x - dx * axes.u.y) / det,
  };
}

export function normaliseSpin(spin) {
  const n = Math.round(Number(spin) || 0);
  return ((n % 360) + 360) % 360;
}
