/**
 * Ground grid.
 *
 * The grid is regenerated for whatever the viewport currently shows, so it
 * reads as infinite without ever building an infinite mesh. Line count is
 * capped: at low zoom the spacing coarsens instead of the browser drawing
 * thousands of near-identical lines.
 */

import { svg, setAttr, clear } from '../util/dom.js';
import { screenToGrid } from './camera.js';
import { rotatePoint } from '../geom/iso.js';
import { round2 } from '../util/num.js';

const MAX_LINES_PER_AXIS = 120;
const STEPS = [1, 2, 5, 10, 20, 50, 100];

export function createGridView() {
  const lines = svg('g', { class: 'grid-lines' });
  const cursor = svg('polygon', { class: 'grid-cursor', visibility: 'hidden' });
  const el = svg('g', { class: 'grid' }, [lines, cursor]);
  return { el, lines, cursor, key: '' };
}

/**
 * @param {{cam: object, proj: object, viewport: {width:number,height:number},
 *          hover: {x:number,y:number}|null}} ctx
 */
export function updateGridView(view, ctx) {
  const { cam, proj, viewport, hover } = ctx;
  const area = visibleGridArea(cam, viewport);
  const step = chooseStep(area);

  const x0 = Math.floor(area.x0 / step) * step;
  const x1 = Math.ceil(area.x1 / step) * step;
  const y0 = Math.floor(area.y0 / step) * step;
  const y1 = Math.ceil(area.y1 / step) * step;

  // Rebuilding is cheap but pointless when nothing moved.
  const key = `${x0},${x1},${y0},${y1},${step},${proj.kind}`;
  if (key !== view.key) {
    view.key = key;
    clear(view.lines);
    for (let x = x0; x <= x1; x += step) {
      view.lines.append(gridLine(proj, x, y0, x, y1, x === 0));
    }
    for (let y = y0; y <= y1; y += step) {
      view.lines.append(gridLine(proj, x0, y, x1, y, y === 0));
    }
  }

  if (hover) {
    const pts = [[0, 0], [1, 0], [1, 1], [0, 1]]
      .map(([dx, dy]) => rotatePoint(hover.x + dx, hover.y + dy, cam.rot))
      .map((p) => proj.project(p.x, p.y, 0))
      .map((p) => `${round2(p.x)},${round2(p.y)}`)
      .join(' ');
    setAttr(view.cursor, 'points', pts);
    setAttr(view.cursor, 'visibility', 'visible');
  } else {
    setAttr(view.cursor, 'visibility', 'hidden');
  }
}

/** Grid-space (already rotated) bounding box of what the viewport covers. */
function visibleGridArea(cam, viewport) {
  const corners = [
    [0, 0],
    [viewport.width, 0],
    [0, viewport.height],
    [viewport.width, viewport.height],
  ].map(([px, py]) => {
    const g = screenToGrid(cam, px, py, 0);
    return rotatePoint(g.x, g.y, cam.rot);
  });
  return {
    x0: Math.min(...corners.map((c) => c.x)),
    x1: Math.max(...corners.map((c) => c.x)),
    y0: Math.min(...corners.map((c) => c.y)),
    y1: Math.max(...corners.map((c) => c.y)),
  };
}

function chooseStep(area) {
  const span = Math.max(area.x1 - area.x0, area.y1 - area.y0);
  return STEPS.find((s) => span / s <= MAX_LINES_PER_AXIS) ?? STEPS.at(-1);
}

function gridLine(proj, x0, y0, x1, y1, isAxis) {
  const a = proj.project(x0, y0, 0);
  const b = proj.project(x1, y1, 0);
  return svg('line', {
    class: isAxis ? 'grid-line is-axis' : 'grid-line',
    x1: round2(a.x),
    y1: round2(a.y),
    x2: round2(b.x),
    y2: round2(b.y),
  });
}

