/**
 * Picture rendering.
 *
 * The picture itself is an ordinary `<image>` at the origin of its own pixel
 * space; every bit of isometric placement lives in the group's transform. That
 * keeps this file free of projection maths and means a picture behaves exactly
 * like planar text does.
 */

import { svg, setAttr, setClass } from '../util/dom.js';
import { CELL } from '../geom/iso.js';
import { planeTransform, effectivePlane } from '../geom/plane.js';
import { round2 } from '../util/num.js';

export function createImageView() {
  const picture = svg('image', {
    class: 'picture-body',
    preserveAspectRatio: 'none',
    x: 0,
    y: 0,
  });
  const frame = svg('rect', { class: 'picture-frame', x: 0, y: 0 });
  const el = svg('g', { class: 'picture' }, [picture, frame]);
  return { el, picture, frame, src: null };
}

/**
 * @param {{proj: object, rot: number, selected: boolean, hovered: boolean}} ctx
 */
export function updateImageView(view, image, ctx) {
  const { proj, rot } = ctx;
  const w = image.size[0] * CELL;
  const h = image.size[1] * CELL;

  setAttr(view.el, 'data-id', image.id);
  setAttr(view.el, 'transform', planeTransform(proj, rot, image, [w / 2, h / 2]));
  setClass(view.el, 'is-selected', ctx.selected);
  setClass(view.el, 'is-hovered', ctx.hovered);
  setClass(view.el, 'is-flat', effectivePlane(image.plane, proj) === 'screen');

  // Re-pointing href restarts decoding, so only touch it when it changed.
  if (view.src !== image.src) {
    setAttr(view.picture, 'href', image.src);
    view.src = image.src;
  }

  for (const el of [view.picture, view.frame]) {
    setAttr(el, 'width', round2(w));
    setAttr(el, 'height', round2(h));
  }
  setAttr(view.picture, 'opacity', image.opacity);
}
