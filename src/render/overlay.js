/**
 * Transient decoration: marquee rectangle, placement ghost, connection
 * preview. None of it belongs to the document, so it lives in its own layer
 * and is driven directly by the input layer rather than by a render pass.
 */

import { svg, setAttr } from '../util/dom.js';
import { screenToScene } from './camera.js';
import { CELL } from '../geom/iso.js';
import { projectRing, ringPath, liftRing, bodyPath } from './solid.js';
import { round2 } from '../util/num.js';

export function createOverlay(layer) {
  const marquee = svg('rect', { class: 'marquee', visibility: 'hidden' });
  /*
   * The ghost is a solid, not a footprint.
   *
   * What is about to be placed has a height, and a flat rectangle on the floor
   * says nothing about how much of the diagram it will cover once it stands up
   * — which is exactly what you are judging while deciding where to put it. Two
   * paths, the same body-and-lid the real thing is drawn with.
   */
  const ghostBody = svg('path', { class: 'ghost-cell ghost-body', visibility: 'hidden' });
  const ghost = svg('path', { class: 'ghost-cell ghost-top', visibility: 'hidden' });
  const link = svg('polyline', { class: 'link-preview', visibility: 'hidden' });
  layer.append(marquee, ghostBody, ghost, link);

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

    /**
     * @param {{x,y,w,h,ht?}|null} box in document grid coordinates. `ht` is how
     *   tall the thing being placed will stand; a zone being dragged out has
     *   none and draws as the floor rectangle it is.
     */
    ghost(cam, proj, box) {
      if (!box) {
        hide(ghost);
        return hide(ghostBody);
      }
      const lift = proj.showsSides ? (box.ht ?? 0) * CELL : 0;
      const ring = projectRing(
        [[0, 0], [box.w * CELL, 0], [box.w * CELL, box.h * CELL], [0, box.h * CELL]],
        [box.x, box.y],
        proj,
        cam.rot
      );
      const top = liftRing(ring, lift);
      setAttr(ghost, 'd', ringPath(top));
      show(ghost);
      if (lift <= 0) return hide(ghostBody);
      setAttr(ghostBody, 'd', bodyPath(ring, top));
      show(ghostBody);
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

