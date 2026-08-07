/**
 * Edge rendering.
 *
 * Routing happens in document grid space (not screen space) so a connection
 * keeps its shape when the camera rotates. The polyline is an elbow along the
 * dominant axis, trimmed back to each block's footprint so it emerges from the
 * side of a block rather than from under it.
 *
 * Arrowheads are drawn as explicit polygons rather than SVG markers, because
 * markers cannot inherit a per-edge colour without a marker definition per
 * colour.
 */

import { svg, setAttr, setText, setClass } from '../util/dom.js';
import { rotatePoint, unrotatePoint } from '../geom/iso.js';
import { nodeById } from '../core/doc.js';
import { round2 } from '../util/num.js';
import { planeTransform, effectivePlane } from '../geom/plane.js';

const EDGE_Z = 0.14; // lift off the ground plane to avoid z-fighting with the grid
const CLEARANCE = 0.2; // cells of daylight between a block and the line
const ARROW_LEN = 10;
const ARROW_HALF = 4.5;
const EDGE_LABEL_GAP = 6; // px of daylight between the line and its caption

export function createEdgeView() {
  const hit = svg('polyline', { class: 'edge-hit' });
  const line = svg('polyline', { class: 'edge-line' });
  const arrowStart = svg('polygon', { class: 'edge-arrow' });
  const arrowEnd = svg('polygon', { class: 'edge-arrow' });
  const label = svg('text', { class: 'edge-label', 'text-anchor': 'middle' });
  const el = svg('g', { class: 'edge' }, [hit, line, arrowStart, arrowEnd, label]);
  return { el, hit, line, arrowStart, arrowEnd, label };
}

/**
 * @param {{doc: object, proj: object, rot: number, selected: boolean,
 *          hovered: boolean}} ctx
 * @returns {boolean} false when an endpoint is missing and nothing was drawn
 */
export function updateEdgeView(view, edge, ctx) {
  const { doc, proj, rot } = ctx;
  const from = nodeById(doc, edge.from);
  const to = nodeById(doc, edge.to);
  if (!from || !to) return false;

  const obstacles = doc.nodes
    .filter((n) => n !== from && n !== to)
    .map((n) => ({ x: n.pos[0], y: n.pos[1], w: n.size[0], h: n.size[1] }));
  const grid = routeInGrid(from, to, obstacles);
  const rotated = grid.map((p) => rotatePoint(p.x, p.y, rot));
  const screen = rotated.map((p) => proj.project(p.x, p.y, EDGE_Z));
  const points = screen.map((p) => `${round2(p.x)},${round2(p.y)}`).join(' ');

  setAttr(view.el, 'data-id', edge.id);
  setClass(view.el, 'is-selected', ctx.selected);
  setClass(view.el, 'is-hovered', ctx.hovered);

  setAttr(view.hit, 'points', points);
  setAttr(view.line, 'points', points);
  setAttr(view.line, 'stroke', edge.color);
  setAttr(view.line, 'stroke-dasharray', dashFor(edge.style));

  const showEnd = edge.arrow === 'end' || edge.arrow === 'both';
  const showStart = edge.arrow === 'start' || edge.arrow === 'both';
  arrowhead(view.arrowEnd, screen.at(-2), screen.at(-1), showEnd, edge.color);
  arrowhead(view.arrowStart, screen[1], screen[0], showStart, edge.color);

  setText(view.label, edge.label || '');
  setAttr(view.label, 'font-size', edge.labelSize);
  setAttr(view.label, 'visibility', edge.label ? 'visible' : 'hidden');
  placeEdgeLabel(view, edge, ctx, rotated, screen);
  return true;
}

/**
 * Where a connection's caption goes.
 *
 * Always at the halfway point of the run, always just clear of the line -- the
 * plane only decides which way "clear of it" points. On the ground the caption
 * lies alongside the line; on either wall the same offset stands it up above
 * the line, because a wall's in-plane down direction is world height inverted.
 *
 * The midpoint is measured along the *grid* polyline rather than its screen
 * projection, so the caption sits at the middle of the connection as drawn on
 * the plan, not at the middle of the foreshortened picture of it.
 */
function placeEdgeLabel(view, edge, ctx, rotated, screen) {
  const { proj, rot } = ctx;
  const plane = effectivePlane(edge.labelPlane, proj);

  if (plane === 'screen') {
    const mid = midpoint(screen);
    setAttr(view.label, 'transform', '');
    setAttr(view.label, 'x', round2(mid.x));
    setAttr(view.label, 'y', round2(mid.y - EDGE_LABEL_GAP));
    return;
  }

  // planeTransform rotates the anchor it is given, so the midpoint has to go
  // back to document coordinates -- handing over the already-rotated point
  // would rotate it twice and fling the caption off the line.
  const mid = midpoint(rotated);
  const anchor = unrotatePoint(mid.x, mid.y, rot);

  // Anchored at the line and offset in local pixels, so `text-anchor: middle`
  // still centres the caption on the midpoint whichever plane it hangs on.
  setAttr(view.label, 'x', 0);
  setAttr(view.label, 'y', -EDGE_LABEL_GAP);
  setAttr(
    view.label,
    'transform',
    planeTransform(proj, rot, {
      pos: [anchor.x, anchor.y],
      z: EDGE_Z,
      plane: edge.labelPlane,
      spin: 0,
    })
  );
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/**
 * An elbow has two possible shapes -- along x first, or along y first -- and
 * they are rarely equally good. Picking the one that passes through fewer
 * blocks is nearly free and is what stops a connection from vanishing under
 * the middle of the diagram.
 */
function routeInGrid(from, to, obstacles) {
  const a = centreOf(from);
  const b = centreOf(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;

  let points;
  if (Math.abs(dx) < 1e-6 || Math.abs(dy) < 1e-6) {
    points = [a, b];
  } else {
    const alongX = [a, { x: b.x, y: a.y }, b];
    const alongY = [a, { x: a.x, y: b.y }, b];
    const costX = blocksCrossed(alongX, obstacles);
    const costY = blocksCrossed(alongY, obstacles);
    // Equal cost keeps the old behaviour: turn on the dominant axis.
    if (costX < costY) points = alongX;
    else if (costY < costX) points = alongY;
    else points = Math.abs(dx) >= Math.abs(dy) ? alongX : alongY;
  }

  points = trimStart(points, inflate(rectOf(from), CLEARANCE));
  points = trimStart(points.slice().reverse(), inflate(rectOf(to), CLEARANCE)).reverse();
  return points;
}

/** How many obstacle footprints a polyline passes through. */
function blocksCrossed(points, obstacles) {
  if (!obstacles?.length) return 0;
  let count = 0;
  for (const rect of obstacles) {
    for (let i = 1; i < points.length; i++) {
      if (segmentHitsRect(points[i - 1], points[i], rect)) {
        count++;
        break;
      }
    }
  }
  return count;
}

/**
 * Axis-aligned segment against an axis-aligned rectangle. Every segment an
 * elbow produces is horizontal or vertical, so this needs no general
 * line-clipping.
 */
function segmentHitsRect(p, q, rect) {
  const x0 = Math.min(p.x, q.x);
  const x1 = Math.max(p.x, q.x);
  const y0 = Math.min(p.y, q.y);
  const y1 = Math.max(p.y, q.y);
  return x0 < rect.x + rect.w && rect.x < x1 && y0 < rect.y + rect.h && rect.y < y1;
}

function centreOf(node) {
  return { x: node.pos[0] + node.size[0] / 2, y: node.pos[1] + node.size[1] / 2 };
}

function rectOf(node) {
  return { x: node.pos[0], y: node.pos[1], w: node.size[0], h: node.size[1] };
}

function inflate(rect, by) {
  return { x: rect.x - by, y: rect.y - by, w: rect.w + by * 2, h: rect.h + by * 2 };
}

/** Drop leading points inside `rect` and start exactly on its boundary. */
function trimStart(points, rect) {
  let i = 0;
  while (i < points.length && inside(rect, points[i])) i++;
  if (i === 0 || i >= points.length) return points;
  return [boundaryPoint(points[i - 1], points[i], rect), ...points.slice(i)];
}

function inside(rect, p) {
  return p.x > rect.x && p.x < rect.x + rect.w && p.y > rect.y && p.y < rect.y + rect.h;
}

/**
 * Point where the segment from `a` (inside) to `b` (outside) crosses the
 * rectangle. Bisection: 24 steps put us well under a thousandth of a cell.
 */
function boundaryPoint(a, b, rect) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const p = { x: a.x + (b.x - a.x) * mid, y: a.y + (b.y - a.y) * mid };
    if (inside(rect, p)) lo = mid;
    else hi = mid;
  }
  return { x: a.x + (b.x - a.x) * hi, y: a.y + (b.y - a.y) * hi };
}

// ---------------------------------------------------------------------------
// Decoration
// ---------------------------------------------------------------------------

function arrowhead(el, tail, tip, visible, color) {
  if (!visible || !tail || !tip) {
    setAttr(el, 'visibility', 'hidden');
    return;
  }
  const dx = tip.x - tail.x;
  const dy = tip.y - tail.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const bx = tip.x - ux * ARROW_LEN;
  const by = tip.y - uy * ARROW_LEN;
  const points = [
    [tip.x, tip.y],
    [bx - uy * ARROW_HALF, by + ux * ARROW_HALF],
    [bx + uy * ARROW_HALF, by - ux * ARROW_HALF],
  ]
    .map(([x, y]) => `${round2(x)},${round2(y)}`)
    .join(' ');
  setAttr(el, 'points', points);
  setAttr(el, 'fill', color);
  setAttr(el, 'visibility', 'visible');
}

/** Point at half the polyline's screen length. */
function midpoint(points) {
  if (points.length < 2) return points[0] ?? { x: 0, y: 0 };
  const segs = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    segs.push(len);
    total += len;
  }
  let remaining = total / 2;
  for (let i = 0; i < segs.length; i++) {
    if (remaining <= segs[i] || i === segs.length - 1) {
      const t = segs[i] ? remaining / segs[i] : 0;
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t,
      };
    }
    remaining -= segs[i];
  }
  return points[0];
}

function dashFor(style) {
  if (style === 'dashed') return '8 5';
  if (style === 'dotted') return '1.5 4';
  return null;
}

