/**
 * Flowchart shape rendering: a silhouette, stood up.
 *
 * The shape is a ring of points on the ground (see `data/shapes.js`), stood up
 * into a slab by `render/solid.js` — which every solid on this ground shares,
 * flowchart shapes and data structures alike.
 *
 * The caption is placed separately, on its own plane and at the height of the
 * top face — so by default it lies on the lid, reading as writing on the slab,
 * and a step whose words must be read square can hang its caption on the screen
 * plane instead without the silhouette moving at all.
 */

import { svg, setAttr, setText, setClass } from '../util/dom.js';
import { CELL } from '../geom/iso.js';
import { planeTransform, effectivePlane } from '../geom/plane.js';
import { shapeKindFor } from '../data/shapes.js';
import { shade } from '../util/color.js';
import {
  projectRing,
  ringPath,
  liftRing,
  bodyWalls,
  segmentsOnTop,
  FACE_LIGHT,
  LEFT_SHADE,
  RIGHT_SHADE,
  GROOVE_SHADE,
  GROOVE_LIGHT,
  GROOVE,
} from './solid.js';
import { round2 } from '../util/num.js';

// The cut, its light and its depth are shared: see `solid.js`.

/** Where a branch label sits, as a fraction of the shape, per side. */
const BRANCH_AT = {
  top: [0.5, 0],
  right: [1, 0.5],
  bottom: [0.5, 1],
  left: [0, 0.5],
};
/** How far outside the silhouette a branch label is written, in grid cells. */
const BRANCH_CLEAR = 0.55;

export function createShapeView() {
  // Two walls, not one: they are lit differently, like a block's faces.
  const wallLeft = svg('path', { class: 'shape-walls shape-wall-left' });
  const wallRight = svg('path', { class: 'shape-walls shape-wall-right' });
  const outline = svg('path', { class: 'shape-outline' });
  // The subroutine's two bars, cut into the lid the way a structure's slot
  // dividers are: one dark edge with a lit one just below it.
  const innerGroove = svg('path', { class: 'shape-groove' });
  const inner = svg('path', { class: 'shape-inner' });
  const label = svg('text', { class: 'shape-label', 'text-anchor': 'middle' });
  const yes = svg('text', { class: 'shape-branch', 'text-anchor': 'middle' });
  const no = svg('text', { class: 'shape-branch', 'text-anchor': 'middle' });
  const el = svg('g', { class: 'shape' }, [
    wallLeft, wallRight, outline, innerGroove, inner, yes, no, label,
  ]);
  return { el, wallLeft, wallRight, outline, innerGroove, inner, label, yes, no };
}

/**
 * @param {{proj: object, rot: number, selected: boolean, hovered: boolean,
 *          touched: boolean}} ctx
 */
export function updateShapeView(view, shape, ctx) {
  const { proj, rot, zoom = 1 } = ctx;
  const def = shapeKindFor(shape.kind);
  const w = shape.size[0] * CELL;
  const h = shape.size[1] * CELL;
  // Only where the projection shows sides at all: in 2D there is no height to
  // see, and a block has none there either.
  const lift = proj.showsSides ? shape.height * CELL : 0;

  setAttr(view.el, 'data-id', shape.id);
  setClass(view.el, 'is-selected', ctx.selected);
  setClass(view.el, 'is-hovered', ctx.hovered);
  setClass(view.el, 'is-ai-touched', ctx.touched === true);
  setClass(view.el, 'is-flat', lift <= 0);

  const ring = projectRing(def.points(w, h), shape.pos, proj, rot);
  const top = liftRing(ring, lift);

  const walls = lift > 0 ? bodyWalls(ring, top) : null;
  for (const [el, d, tint] of [
    [view.wallLeft, walls?.left, LEFT_SHADE],
    [view.wallRight, walls?.right, RIGHT_SHADE],
  ]) {
    setAttr(el, 'd', d ?? '');
    setAttr(el, 'fill', shade(shape.color, tint));
    setAttr(el, 'stroke', shape.color);
    setAttr(el, 'visibility', d ? 'visible' : 'hidden');
  }

  setAttr(view.outline, 'd', ringPath(top));
  setAttr(view.outline, 'stroke', shape.color);
  // Lit like a block's top face when it is one, and left as the tint it always
  // was when the shape is flat: a solid that lets the grid through its lid is
  // not a solid, and a flat outline that does not is not an outline.
  setAttr(view.outline, 'fill', lift > 0 ? shade(shape.color, FACE_LIGHT) : shape.color);

  // The subroutine's bars belong to the top face, so they are projected the same
  // way and lifted with it.
  const bars = def.inner?.(w, h) ?? null;
  const bevel = GROOVE / zoom;
  setAttr(view.inner, 'd', bars ? segmentsOnTop(bars, shape.pos, proj, rot, lift) : '');
  setAttr(view.inner, 'stroke', shade(shape.color, GROOVE_SHADE));
  setAttr(view.inner, 'visibility', bars ? 'visible' : 'hidden');
  setAttr(
    view.innerGroove,
    'd',
    bars ? segmentsOnTop(bars, shape.pos, proj, rot, lift - bevel) : ''
  );
  setAttr(view.innerGroove, 'stroke', shade(shape.color, GROOVE_LIGHT));
  setAttr(view.innerGroove, 'visibility', bars ? 'visible' : 'hidden');

  const z = lift > 0 ? shape.height : 0;
  branch(view.yes, shape, shape.yes, shape.yesAt, ctx, z);
  branch(view.no, shape, shape.no, shape.noAt, ctx, z);

  setText(view.label, shape.label || '');
  setAttr(view.label, 'font-size', shape.labelSize);
  setAttr(view.label, 'visibility', shape.label ? 'visible' : 'hidden');
  placeLabel(view, shape, ctx, z);
}

/**
 * A branch label, written just outside the side the answer leaves from.
 *
 * Anchored in grid space and hung on the caption's plane at the height of the
 * top face: it names a side of *this* shape and has to stay against it however
 * the camera turns, while a decision whose question stands up and whose answers
 * lie skewed beside it looks like two different drawings.
 */
function branch(el, shape, text, at, ctx, z) {
  if (!text) {
    setAttr(el, 'visibility', 'hidden');
    return;
  }
  const { proj, rot } = ctx;
  const [fx, fy] = BRANCH_AT[at] ?? BRANCH_AT.right;
  const anchor = [
    shape.pos[0] + fx * shape.size[0] + (fx - 0.5) * 2 * BRANCH_CLEAR,
    shape.pos[1] + fy * shape.size[1] + (fy - 0.5) * 2 * BRANCH_CLEAR,
  ];
  setText(el, text);
  setAttr(el, 'font-size', round2(shape.labelSize * 0.9));
  setAttr(el, 'transform', planeTransform(proj, rot, {
    pos: anchor,
    z,
    plane: effectivePlane(shape.labelPlane, proj),
    spin: 0,
  }));
  setAttr(el, 'x', 0);
  setAttr(el, 'y', round2(shape.labelSize * 0.35));
  setAttr(el, 'visibility', 'visible');
}

/** The caption, centred on the top face and hung on whichever plane it asked for. */
function placeLabel(view, shape, ctx, z) {
  const { proj, rot } = ctx;
  const centre = [shape.pos[0] + shape.size[0] / 2, shape.pos[1] + shape.size[1] / 2];
  setAttr(view.label, 'transform', planeTransform(proj, rot, {
    pos: centre,
    z,
    plane: effectivePlane(shape.labelPlane, proj),
    spin: 0,
  }));
  setAttr(view.label, 'x', 0);
  // Half the cap height, so one line reads as centred in the silhouette rather
  // than hanging from its middle.
  setAttr(view.label, 'y', round2(shape.labelSize * 0.35));
}
