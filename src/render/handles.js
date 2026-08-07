/**
 * Resize grips.
 *
 * Decoration that is also a control, which is why this is the one part of the
 * scene drawn *outside* the camera transform: a grip has to stay the same size
 * on screen at every zoom, and the pointer layer already works in viewport
 * pixels, so hit testing costs nothing extra.
 *
 * Where a grip is and what it does are written once, here. Each one carries
 * its entity, its role and which corner of the shape it holds in its own data
 * attributes, and `input/pointer.js` reads the drag straight off the DOM --
 * so the two files cannot end up disagreeing about what was grabbed.
 */

import { svg, setAttr } from '../util/dom.js';
import { rotateRect, CELL } from '../geom/iso.js';
import { projectionOf, sceneToScreen } from './camera.js';
import { planeAxes } from '../geom/plane.js';
import { nodeById, groupById, imageById } from '../core/doc.js';
import { clampInt, round2 } from '../util/num.js';
import { MAX_SPAN } from '../core/schema.js';

/** Screen radius of a grip. */
const GRIP_RADIUS = 4.5;
/** Pixels the height grip floats above the block's topmost point. */
const GRIP_LIFT = 22;
/** Shortest on-screen side, in px, above which edge grips join the corners... */
const EDGE_GRIPS_ABOVE = 46;
/** ...and below which a shape gets none at all, because they would bury it. */
const NO_GRIPS_BELOW = 14;

/** Grip anchors as fractions of the shape. */
const CORNER_ANCHORS = [[0, 0], [1, 0], [1, 1], [0, 1]];
const EDGE_ANCHORS = [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * The grips for the current selection, in viewport pixels.
 *
 * One entity at a time: with several selected there is no single rectangle to
 * resize, and the drag anyone expects from a multiple selection is a move.
 * Grips are also withheld unless the select tool is live, or the press that
 * starts a connection would land on a grip instead of on the block.
 */
export function handlesFor(state) {
  const { doc, camera, selection, tool, pendingType } = state;
  if (tool !== 'select' || pendingType || selection.length !== 1) return [];

  const id = selection[0];
  const node = nodeById(doc, id);
  if (node) return blockHandles(node, camera);
  const group = groupById(doc, id);
  if (group) return footprintHandles(id, group.rect, 0, camera);
  const image = imageById(doc, id);
  if (image) return pictureHandles(image, camera);
  return [];
}

function blockHandles(node, cam) {
  const proj = projectionOf(cam);
  const ht = proj.showsSides ? node.height : 0;
  const rect = [node.pos[0], node.pos[1], node.size[0], node.size[1]];
  const grips = footprintHandles(node.id, rect, ht, cam);

  // Height is the one dimension the footprint grips cannot reach, so it gets
  // one of its own, floating over the top face on a stem. In 2D there is no
  // height to see, so there is nothing to drag either.
  if (grips.length && proj.showsSides) {
    const r = rotateRect(rect[0], rect[1], rect[2], rect[3], cam.rot);
    const stem = screenPoint(cam, proj.project(r.x + r.w / 2, r.y + r.h / 2, ht));
    // Cleared past the back corner rather than lifted a fixed amount off the
    // centre: on a small block a fixed lift lands the grip on the corner grip
    // that is already there. The (r.x, r.y) corner projects to the topmost
    // point of the top face, and to the same screen x as its centre.
    const back = screenPoint(cam, proj.project(r.x, r.y, ht));
    grips.push({
      key: 'height',
      role: 'height',
      target: node.id,
      x: stem.x,
      y: back.y - GRIP_LIFT,
      stem,
      cursor: 'ns-resize',
    });
  }
  return grips;
}

/**
 * Grips around a rectangle of grid cells, at height `ht`.
 *
 * The anchors are fractions of the *rotated* footprint, because "the left
 * edge" only means anything relative to the camera. `resizeFootprint` works in
 * the same frame, so the two agree at every camera angle.
 */
function footprintHandles(id, rect, ht, cam) {
  const proj = projectionOf(cam);
  const r = rotateRect(rect[0], rect[1], rect[2], rect[3], cam.rot);

  // A unit grid direction projects to exactly CELL pixels, so this is the real
  // on-screen length of the shortest side without measuring anything.
  const shortest = Math.min(r.w, r.h) * CELL * cam.zoom;
  if (shortest < NO_GRIPS_BELOW) return [];
  const anchors =
    shortest < EDGE_GRIPS_ABOVE ? CORNER_ANCHORS : [...CORNER_ANCHORS, ...EDGE_ANCHORS];

  const at = (ax, ay) => screenPoint(cam, proj.project(r.x + ax * r.w, r.y + ay * r.h, ht));
  const centre = at(0.5, 0.5);
  return anchors.map(([ax, ay]) => {
    const p = at(ax, ay);
    return {
      key: `size:${ax},${ay}`,
      role: 'size',
      target: id,
      ax,
      ay,
      x: p.x,
      y: p.y,
      cursor: cursorFor(p.x - centre.x, p.y - centre.y),
    };
  });
}

/**
 * Grips on a picture, in its own plane.
 *
 * Only the far edges get one. A picture hangs from `pos`, the single point of
 * it the author placed deliberately, and moving that anchor means walking it
 * along a plane axis that is itself a function of the camera, the spin and the
 * readability flip -- a lot of machinery so a picture can grow the other way,
 * when dragging it afterwards does the same job.
 */
function pictureHandles(image, cam) {
  const proj = projectionOf(cam);
  const w = image.size[0] * CELL;
  const h = image.size[1] * CELL;
  const axes = planeAxes(proj, cam.rot, image, [w / 2, h / 2]);
  const at = (lx, ly) =>
    screenPoint(cam, {
      x: axes.origin.x + axes.u.x * lx + axes.v.x * ly,
      y: axes.origin.y + axes.u.y * lx + axes.v.y * ly,
    });

  // Plane axes are unit screen vectors, so local pixels are screen pixels.
  const shortest = Math.min(w, h) * cam.zoom;
  if (shortest < NO_GRIPS_BELOW) return [];
  const anchors = shortest < EDGE_GRIPS_ABOVE ? [[1, 1]] : [[1, 0.5], [0.5, 1], [1, 1]];

  const centre = at(w / 2, h / 2);
  return anchors.map(([ax, ay]) => {
    const p = at(ax * w, ay * h);
    return {
      key: `plane:${ax},${ay}`,
      role: 'plane-size',
      target: image.id,
      ax,
      ay,
      x: p.x,
      y: p.y,
      cursor: cursorFor(p.x - centre.x, p.y - centre.y),
    };
  });
}

/**
 * The rectangle a grip drags out, in the rotated frame.
 *
 * A grip anchored at 0 moves the near edge and leaves the far one where it is;
 * one at 1 does the opposite; one at 0.5 leaves that axis alone entirely. The
 * two edges never cross -- the moving one stops a cell short.
 *
 * @param {{x,y,w,h}} start  footprint at the moment of the grab
 * @param {{x,y}} at         pointer, in the same rotated grid frame
 */
export function resizeFootprint(start, ax, ay, at) {
  const [x, w] = resizeAxis(start.x, start.w, ax, at.x);
  const [y, h] = resizeAxis(start.y, start.h, ay, at.y);
  return { x, y, w, h };
}

function resizeAxis(lo, span, anchor, at) {
  if (anchor === 0) {
    const far = lo + span;
    const next = clampInt(at, -MAX_SPAN, far - 1, lo);
    return [next, far - next];
  }
  if (anchor === 1) {
    const far = clampInt(at, lo + 1, MAX_SPAN, lo + span);
    return [lo, far - lo];
  }
  return [lo, span];
}

function screenPoint(cam, p) {
  return sceneToScreen(cam, p.x, p.y);
}

/**
 * A resize cursor from the direction a grip lies in. Only the axis matters and
 * not which end of it, so the angle is folded into half a turn.
 */
function cursorFor(dx, dy) {
  const deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 180) % 180;
  if (deg < 22.5 || deg >= 157.5) return 'ew-resize';
  if (deg < 67.5) return 'nwse-resize';
  if (deg < 112.5) return 'ns-resize';
  return 'nesw-resize';
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function createHandlesView() {
  const el = svg('g', { class: 'layer layer-handles' });
  return { el, grips: new Map() };
}

/** Keyed diff, like every other layer: a grip keeps its element across frames. */
export function updateHandlesView(view, state) {
  const wanted = handlesFor(state);
  const seen = new Set();

  for (const grip of wanted) {
    let g = view.grips.get(grip.key);
    if (!g) {
      g = createGrip();
      view.grips.set(grip.key, g);
      view.el.append(g.el);
    }
    setAttr(g.el, 'data-handle', grip.role);
    // A grip stands in for its entity while the pointer is over it, so hover
    // does not flicker off the very thing being resized.
    setAttr(g.el, 'data-id', grip.target);
    setAttr(g.el, 'data-ax', grip.ax ?? 0);
    setAttr(g.el, 'data-ay', grip.ay ?? 0);
    setAttr(g.el, 'style', `cursor:${grip.cursor}`);

    setAttr(g.dot, 'cx', round2(grip.x));
    setAttr(g.dot, 'cy', round2(grip.y));
    setAttr(g.dot, 'r', GRIP_RADIUS);

    if (grip.stem) {
      setAttr(g.stem, 'x1', round2(grip.stem.x));
      setAttr(g.stem, 'y1', round2(grip.stem.y));
      setAttr(g.stem, 'x2', round2(grip.x));
      setAttr(g.stem, 'y2', round2(grip.y));
    }
    setAttr(g.stem, 'visibility', grip.stem ? 'visible' : 'hidden');
    seen.add(grip.key);
  }

  for (const [key, g] of view.grips) {
    if (seen.has(key)) continue;
    g.el.remove();
    view.grips.delete(key);
  }
}

function createGrip() {
  const stem = svg('line', { class: 'handle-stem', visibility: 'hidden' });
  const dot = svg('circle', { class: 'handle-dot' });
  const el = svg('g', { class: 'handle' }, [stem, dot]);
  return { el, stem, dot };
}
