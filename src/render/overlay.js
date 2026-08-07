/**
 * Transient decoration: marquee rectangle, placement ghost, connection
 * preview. None of it belongs to the document, so it lives in its own layer
 * and is driven directly by the input layer rather than by a render pass.
 */

import { svg, setAttr } from '../util/dom.js';
import { screenToScene } from './camera.js';
import { rotatePoint } from '../geom/iso.js';
import { round2 } from '../util/num.js';

export function createOverlay(layer) {
  const marquee = svg('rect', { class: 'marquee', visibility: 'hidden' });
  const ghost = svg('polygon', { class: 'ghost-cell', visibility: 'hidden' });
  const link = svg('polyline', { class: 'link-preview', visibility: 'hidden' });
  layer.append(marquee, ghost, link);

  return {
    /** @param {{x0,y0,x1,y1}|null} rect in viewport pixels */
    marquee(cam, rect) {
      if (!rect) return hide(marquee);
      const a = screenToScene(cam, Math.min(rect.x0, rect.x1), Math.min(rect.y0, rect.y1));
      const b = screenToScene(cam, Math.max(rect.x0, rect.x1), Math.max(rect.y0, rect.y1));
      setAttr(marquee, 'x', round2(a.x));
      setAttr(marquee, 'y', round2(a.y));
      setAttr(marquee, 'width', round2(b.x - a.x));
      setAttr(marquee, 'height', round2(b.y - a.y));
      show(marquee);
    },

    /** @param {{x,y,w,h}|null} box in document grid coordinates */
    ghost(cam, proj, box) {
      if (!box) return hide(ghost);
      const points = [[0, 0], [box.w, 0], [box.w, box.h], [0, box.h]]
        .map(([dx, dy]) => rotatePoint(box.x + dx, box.y + dy, cam.rot))
        .map((p) => proj.project(p.x, p.y, 0))
        .map((p) => `${round2(p.x)},${round2(p.y)}`)
        .join(' ');
      setAttr(ghost, 'points', points);
      show(ghost);
    },

    /** @param {Array<{x,y}>|null} pts in viewport pixels */
    link(cam, pts) {
      if (!pts || pts.length < 2) return hide(link);
      const points = pts
        .map((p) => screenToScene(cam, p.x, p.y))
        .map((p) => `${round2(p.x)},${round2(p.y)}`)
        .join(' ');
      setAttr(link, 'points', points);
      show(link);
    },

    clear() {
      hide(marquee);
      hide(ghost);
      hide(link);
    },
  };
}

function show(el) {
  setAttr(el, 'visibility', 'visible');
}

function hide(el) {
  setAttr(el, 'visibility', 'hidden');
}

