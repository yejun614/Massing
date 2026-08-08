/**
 * Group (zone) rendering: a flat translucent slab on the ground with a label
 * pinned to its far corner, where blocks are least likely to cover it.
 */

import { svg, setAttr, setText, setClass } from '../util/dom.js';
import { rotateRect, unrotatePoint } from '../geom/iso.js';
import { groupKindFor } from '../data/components.js';
import { shade } from '../util/color.js';
import { planeTransform, effectivePlane } from '../geom/plane.js';
import { round2 } from '../util/num.js';

const LABEL_OFFSET = 10;
/** Cells of margin when a caption is written inside the zone. */
const INSET = 0.4;

export function createGroupView() {
  const fill = svg('polygon', { class: 'zone-fill' });
  const label = svg('text', { class: 'zone-label' });
  const el = svg('g', { class: 'zone' }, [fill, label]);
  return { el, fill, label };
}

/**
 * @param {{proj: object, rot: number, selected: boolean, hovered: boolean}} ctx
 */
export function updateGroupView(view, group, ctx) {
  const { proj, rot } = ctx;
  const r = rotateRect(group.rect[0], group.rect[1], group.rect[2], group.rect[3], rot);
  const kind = groupKindFor(group.kind);

  const corners = [[0, 0], [r.w, 0], [r.w, r.h], [0, r.h]]
    .map(([dx, dy]) => proj.project(r.x + dx, r.y + dy, 0))
    .map((p) => `${round2(p.x)},${round2(p.y)}`)
    .join(' ');

  setAttr(view.el, 'data-id', group.id);
  setClass(view.el, 'is-selected', ctx.selected);
  setClass(view.el, 'is-hovered', ctx.hovered);
  // Marks what the assistant just changed, for a couple of seconds.
  setClass(view.el, 'is-ai-touched', ctx.touched === true);
  setClass(view.el, 'is-dashed', kind.dash);

  setAttr(view.fill, 'points', corners);
  setAttr(view.fill, 'fill', group.color);
  setAttr(view.fill, 'stroke', shade(group.color, -0.12));

  setAttr(view.label, 'fill', shade(group.color, -0.22));
  setText(view.label, group.label || '');
  setAttr(view.label, 'font-size', group.labelSize);
  setAttr(view.label, 'visibility', group.label ? 'visible' : 'hidden');
  placeZoneLabel(view, group, ctx, r);
}

/**
 * Where a zone's caption goes.
 *
 * The default floats it just above the zone's topmost vertex, square to the
 * viewer. The other planes put it into the scene: written on the ground just
 * inside the zone, or stood up along one of its two back edges — which reads
 * like a sign on a plot, and stays clear of whatever is sitting inside.
 *
 * Unlike a block, a zone's `<g>` carries no transform of its own, so these
 * anchors are already in world coordinates.
 */
function placeZoneLabel(view, group, ctx, r) {
  const { proj, rot } = ctx;
  const plane = effectivePlane(group.labelPlane, proj);

  if (plane === 'screen') {
    // The (r.x, r.y) corner projects to the topmost vertex of the diamond.
    const anchor = proj.project(r.x, r.y, 0);
    setAttr(view.label, 'transform', '');
    setAttr(view.label, 'x', round2(anchor.x));
    setAttr(view.label, 'y', round2(anchor.y - LABEL_OFFSET));
    return;
  }

  // The slab projects to a diamond whose two upper edges face away from the
  // viewer. Both standing planes anchor to one of those, so the sign is never
  // in front of the zone's own contents: `right` runs along +x up the
  // upper-right edge, `left` runs along -y up the upper-left one.
  const anchors = {
    floor: { pos: [r.x + INSET, r.y + INSET], z: 0 },
    right: { pos: [r.x + INSET, r.y], z: 0.05 },
    left: { pos: [r.x, r.y + r.h - INSET], z: 0.05 },
  }[plane];

  // The anchors above are in the rotated frame; planeTransform rotates what it
  // is given, so convert back to document coordinates first.
  const anchor = unrotatePoint(anchors.pos[0], anchors.pos[1], rot);

  setAttr(view.label, 'x', 0);
  setAttr(view.label, 'y', 0);
  setAttr(
    view.label,
    'transform',
    planeTransform(proj, rot, {
      pos: [anchor.x, anchor.y],
      z: anchors.z,
      plane: group.labelPlane,
      spin: 0,
    })
  );
}

