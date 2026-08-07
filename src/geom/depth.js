/**
 * Painter's-algorithm ordering for isometric boxes.
 *
 * The obvious key -- sort by `x + y` -- is wrong for boxes of mixed size. A
 * long thin block can have a larger corner sum than a small block that sits
 * clearly in front of it. So we derive a real "draw before" relation and
 * topologically sort it.
 *
 * For two axis-aligned footprints, A is strictly behind B when A ends before B
 * begins on either axis (both +x and +y point toward the viewer). When the
 * footprints overlap on both axes the boxes are stacked, so lower `z` wins.
 *
 * The relation is only meaningful for boxes whose screen bounds actually
 * overlap; two boxes far apart on screen can produce a contradictory pair
 * (A behind B by x, B behind A by y). Requiring screen overlap before adding
 * an edge keeps the graph acyclic and shrinks it considerably.
 */

import { COS30, SIN30, CELL } from './iso.js';

/** Above this many boxes the O(n^2) graph build stops paying for itself. */
const MAX_TOPO = 600;

/**
 * @param {Array<{x:number,y:number,w:number,h:number,z:number,ht:number}>} items
 *   Footprints in rotated grid space, already re-anchored at their minimum
 *   corner. `z` is the base height, `ht` the box height.
 * @param {boolean} flat True in 2D mode, where only stacking order matters.
 * @returns {Array} the same objects, back to front.
 */
export function sortForPaint(items, flat = false) {
  if (items.length < 2) return items.slice();

  const byKey = items.slice().sort(compareFallback);
  if (flat || items.length > MAX_TOPO) return byKey;

  const n = byKey.length;
  const bounds = byKey.map(screenBounds);
  const after = Array.from({ length: n }, () => []); // i must be drawn before these
  const indeg = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!overlaps(bounds[i], bounds[j])) continue;
      const order = compareDepth(byKey[i], byKey[j]);
      if (order < 0) {
        after[i].push(j);
        indeg[j]++;
      } else if (order > 0) {
        after[j].push(i);
        indeg[i]++;
      }
    }
  }

  // Kahn's algorithm, always taking the lowest-key ready node so the output is
  // stable across renders.
  const out = [];
  const done = new Array(n).fill(false);
  for (let emitted = 0; emitted < n; emitted++) {
    let pick = -1;
    for (let i = 0; i < n; i++) {
      if (!done[i] && indeg[i] === 0) { pick = i; break; }
    }
    if (pick === -1) {
      // Unreachable given the screen-overlap guard, but never drop boxes.
      for (let i = 0; i < n; i++) if (!done[i]) out.push(byKey[i]);
      return out;
    }
    done[pick] = true;
    out.push(byKey[pick]);
    for (const j of after[pick]) indeg[j]--;
  }
  return out;
}

/** Negative when `a` must be painted before `b`. */
function compareDepth(a, b) {
  if (a.x + a.w <= b.x) return -1;
  if (b.x + b.w <= a.x) return 1;
  if (a.y + a.h <= b.y) return -1;
  if (b.y + b.h <= a.y) return 1;
  return a.z - b.z; // footprints overlap: this is a stack
}

/** Ordering used before the graph is built, and as the large-scene fallback. */
function compareFallback(a, b) {
  const ka = a.x + a.w + a.y + a.h;
  const kb = b.x + b.w + b.y + b.h;
  if (ka !== kb) return ka - kb;
  return a.z - b.z;
}

/** Screen-space bounding box of a projected iso box, in unzoomed pixels. */
function screenBounds(b) {
  const cx = COS30 * CELL;
  const cy = SIN30 * CELL;
  return {
    x0: (b.x - (b.y + b.h)) * cx,
    x1: (b.x + b.w - b.y) * cx,
    y0: (b.x + b.y) * cy - (b.z + b.ht) * CELL,
    y1: (b.x + b.w + b.y + b.h) * cy - b.z * CELL,
  };
}

function overlaps(a, b) {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}
