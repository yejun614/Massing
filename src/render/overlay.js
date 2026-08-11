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
  /*
   * A patch of ground, not a rectangle on the screen.
   *
   * In the 3D view the grid's axes run diagonally, so a screen-aligned
   * rectangle cuts across every row and column of a diagram at 30 degrees:
   * sweeping "this column of blocks" is impossible, because no screen rectangle
   * describes a column. Lying it on the ground makes it a parallelogram whose
   * edges run along the grid lines already drawn underneath it, and the region
   * it covers is then the region it selects — see `entitiesInRect`.
   *
   * A path rather than a `<rect>` for that reason: the shape has four corners
   * but no right angles once it is projected. In the 2D view the projection is
   * the identity on the ground plane, so it comes out as exactly the
   * screen-aligned rectangle it always was.
   */
  const marquee = svg('path', { class: 'marquee', visibility: 'hidden' });
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
    /**
     * @param {{x0,y0,x1,y1}|null} rect  the two corners the drag has pinned, in
     *   document grid coordinates. Not normalised, and it does not need to be:
     *   a ring wound the other way fills and strokes the same.
     */
    marquee(cam, proj, rect) {
      if (!rect) return hide(marquee);
      const w = (rect.x1 - rect.x0) * CELL;
      const h = (rect.y1 - rect.y0) * CELL;
      const ring = projectRing(
        [[0, 0], [w, 0], [w, h], [0, h]],
        [rect.x0, rect.y0],
        proj,
        cam.rot
      );
      setAttr(marquee, 'd', ringPath(ring));
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

