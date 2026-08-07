/**
 * Block rendering: one node becomes one `<g>` holding three faces, an icon
 * laid flat on the top face, and a screen-horizontal label.
 *
 * Face polygons are computed in the block's own coordinates and the block is
 * positioned purely by the group `transform`. Moving a block is then a single
 * attribute write, which is what keeps dragging smooth without a virtual DOM.
 */

import { svg, setAttr, setText, setClass } from '../util/dom.js';
import { boxFaces, topFaceMatrix, rotateRect, unrotatePoint, CELL } from '../geom/iso.js';
import { shade, contrastInk } from '../util/color.js';
import { round2 } from '../util/num.js';
import { planeTransform, effectivePlane } from '../geom/plane.js';
import { textAnchorFor } from '../util/text.js';
import { componentFor } from '../data/components.js';
import { iconMarkup } from '../data/icons.js';

const TOP_LIGHT = 0.06;
const RIGHT_SHADE = -0.07;
const LEFT_SHADE = -0.18;
const ICON_SCALE = 0.62; // fraction of the smaller footprint dimension
const LABEL_GAP = 15; // px below the block's lowest screen point
/** Daylight a left- or right-aligned caption keeps from the block's own edge. */
const LABEL_INSET = 6;

export function createBlockView() {
  const left = svg('polygon', { class: 'face face-left' });
  const right = svg('polygon', { class: 'face face-right' });
  const top = svg('polygon', { class: 'face face-top' });
  const icon = svg('g', { class: 'block-icon' });
  const label = svg('text', { class: 'block-label', 'text-anchor': 'middle' });
  const el = svg('g', { class: 'block' }, [left, right, top, icon, label]);
  return { el, left, right, top, icon, label, iconName: null };
}

/**
 * @param {object} view  from `createBlockView`
 * @param {object} node  document node
 * @param {{proj: object, rot: number, selected: boolean, hovered: boolean}} ctx
 */
export function updateBlockView(view, node, ctx) {
  const { proj, rot } = ctx;
  const r = rotateRect(node.pos[0], node.pos[1], node.size[0], node.size[1], rot);
  const ht = proj.showsSides ? node.height : 0;
  const origin = proj.project(r.x, r.y, 0);

  setAttr(view.el, 'transform', `translate(${round2(origin.x)} ${round2(origin.y)})`);
  setAttr(view.el, 'data-id', node.id);
  setClass(view.el, 'is-selected', ctx.selected);
  setClass(view.el, 'is-hovered', ctx.hovered);

  const faces = boxFaces(proj, r.w, r.h, ht);
  const base = node.color;
  const topFill = shade(base, TOP_LIGHT);

  setAttr(view.top, 'points', faces.top);
  setAttr(view.top, 'fill', topFill);

  const showSides = proj.showsSides && ht > 0;
  setAttr(view.right, 'points', faces.right);
  setAttr(view.right, 'fill', shade(base, RIGHT_SHADE));
  setAttr(view.right, 'visibility', showSides ? 'visible' : 'hidden');
  setAttr(view.left, 'points', faces.left);
  setAttr(view.left, 'fill', shade(base, LEFT_SHADE));
  setAttr(view.left, 'visibility', showSides ? 'visible' : 'hidden');

  // --- icon, laid flat on the top face -------------------------------------
  const name = componentFor(node.type).icon;
  if (view.iconName !== name) {
    view.icon.innerHTML = iconMarkup(name) || '';
    view.iconName = name;
  }
  const iconCells = Math.min(r.w, r.h) * ICON_SCALE;
  const ink = contrastInk(topFill);
  setAttr(view.icon, 'transform', topFaceMatrix(proj, r.w, r.h, ht, iconCells));
  setAttr(view.icon, 'stroke', ink);
  view.icon.style.color = ink; // for icon parts that fill with currentColor
  // The matrix scales by CELL * iconCells / 24; undo it so strokes stay ~1.4px.
  setAttr(view.icon, 'stroke-width', round2((1.4 * 24) / (CELL * iconCells)));

  // --- label ---------------------------------------------------------------
  setText(view.label, node.label || '');
  setAttr(view.label, 'font-size', node.labelSize);
  setAttr(view.label, 'visibility', node.label ? 'visible' : 'hidden');
  placeBlockLabel(view, node, ctx, r, ht);
}

/**
 * Where a block's caption goes.
 *
 * The default sits it below the block and square to the viewer, which reads at
 * any rotation. The other planes write it into the scene instead -- flat on
 * the ground in front of the block, or onto one of its two visible faces -- by
 * handing the shared plane transform an origin on that face.
 *
 * `labelAlign` is read against the block itself in every case: the caption
 * lines up with the block's left edge, its centre or its right edge, rather
 * than against some fixed point. That is the only reading that stays useful
 * when the caption is longer than the block it names.
 *
 * The label group is inside the block's own `translate`, so every origin here
 * is expressed relative to the block, and moving the block still costs one
 * attribute write.
 */
function placeBlockLabel(view, node, ctx, r, ht) {
  const { proj, rot } = ctx;
  const plane = effectivePlane(node.labelPlane, proj);
  setAttr(view.label, 'text-anchor', textAnchorFor(node.labelAlign));

  if (plane === 'screen') {
    // Square to the viewer, so the block's extent is its *screen* width. The
    // footprint projects to a diamond: minimum x at the (0, h) corner, maximum
    // at (w, 0), whatever the projection.
    const left = proj.project(0, r.h, 0).x;
    const right = proj.project(r.w, 0, 0).x;
    const bottom = proj.project(r.w, r.h, 0);
    setAttr(view.label, 'transform', '');
    setAttr(view.label, 'x', round2(left + alignedOffset(node.labelAlign, right - left)));
    setAttr(view.label, 'y', round2(bottom.y + LABEL_GAP + (node.labelSize - 12) * 0.5));
    return;
  }

  // These offsets are expressed in the *rotated* frame, because "in front of"
  // and "on the right face" only mean anything relative to the camera. Each
  // anchor is the *start* of the run the caption reads along, with `span` its
  // length in cells; the offset perpendicular to it is what keeps the caption
  // clear of the block.
  const anchors = {
    // Just in front of the block, on the ground, reading along +x.
    floor: { pos: [0, r.h + 0.35], z: 0, span: r.w },
    // Bottom-left of the face at maximum x, reading along +x.
    right: { pos: [0, r.h], z: 0.55, span: r.w },
    // Bottom of the face at maximum y, reading along -y.
    left: { pos: [r.w, r.h], z: 0.55, span: r.h },
  }[plane];

  // planeTransform rotates the anchor itself, so hand it document
  // coordinates -- passing the already-rotated point would rotate it twice and
  // fling the caption off the block at every rotation but the first.
  const anchor = unrotatePoint(r.x + anchors.pos[0], r.y + anchors.pos[1], rot);

  // The block group is already translated to its own corner, so the label's
  // transform must be relative to that corner rather than to the world.
  const corner = proj.project(r.x, r.y, 0);
  const absolute = planeTransform(proj, rot, {
    pos: [anchor.x, anchor.y],
    z: anchors.z,
    plane: node.labelPlane,
    spin: 0,
  });
  // The plane transform keeps local pixels as pixels (see geom/plane.js), so
  // walking `x` along the run is the same measurement on every plane.
  setAttr(view.label, 'x', round2(alignedOffset(node.labelAlign, anchors.span * CELL)));
  setAttr(view.label, 'y', 0);
  setAttr(
    view.label,
    'transform',
    `translate(${round2(-corner.x)} ${round2(-corner.y)}) ${absolute}`
  );
}

/**
 * Where along a run of `span` pixels an aligned caption is anchored.
 *
 * Paired with the matching `text-anchor`, so the caption's own width never
 * enters into it -- which is what lets a caption wider than its block still
 * line up with the edge it was aligned to.
 */
function alignedOffset(align, span) {
  if (align === 'center') return span / 2;
  if (align === 'right') return span - LABEL_INSET;
  return LABEL_INSET;
}

