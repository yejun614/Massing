/**
 * Automatic arrangement.
 *
 * In an isometric view a block hides whatever sits behind it, and "behind"
 * means smaller `x + y` -- further up the screen. Working out exactly when
 * that happens turns out to be simple:
 *
 *   screen y of a silhouette top = depth * (CELL/2) - height * CELL
 *
 * so a front block covers the top face of a back block only when
 *
 *   depthBack(front) - depthFront(back) < 2 * (height(front) - height(back))
 *
 * Two consequences drive everything here. A block that is no taller than the
 * one behind it can never hide it, however close they are. And a taller block
 * needs exactly `2 * the height difference` of extra depth to clear it. So the
 * cure for occlusion is not "spread everything out" -- it is "put tall things
 * at the back, and pay depth only where you cannot".
 *
 * A caption counts as much as the block it belongs to. Once labels lie on the
 * ground by default, "the block is visible" is not the same as "the diagram is
 * readable" -- a block one cell forward will happily sit on top of the caption
 * behind it. So every ground-level caption and note contributes a rectangle of
 * its own that the pass keeps clear, at height zero.
 *
 * Both entry points work in *rotated* grid space, arranging the diagram for
 * the camera the user is actually looking through, then convert the result
 * back into document coordinates.
 */

import { rotateRect, unrotatePoint, CELL } from '../geom/iso.js';
import { estimateTextBox } from '../util/text.js';
import { nodeById, groupById, reassignGroups } from './doc.js';

/** Cells of clear ground between neighbouring footprints. */
const MIN_GAP = 1;
/** Cells of clear screen between one rank of a flow layout and the next. */
const RANK_GAP = 2;

// ---------------------------------------------------------------------------
// Public API. Both mutate `doc` and are meant to be called inside a commit.
// ---------------------------------------------------------------------------

/**
 * Nudge blocks apart until nothing is hidden, keeping the arrangement the user
 * built. Only ever pushes a block forward along the depth axis, which moves it
 * straight down the screen and leaves its horizontal position untouched.
 *
 * @returns {number} how many blocks moved
 */
export function tidy(doc, { rot = 0, ids = null } = {}) {
  const items = collect(doc, ids, rot);
  // One block is enough to work on: it can be sitting on a note or a zone
  // caption even with nothing else in the diagram.
  if (!items.length) return 0;

  const fixed = fixedOccludees(doc, rot);
  const anchor = minCorner(items, fixed);
  deOcclude(items, fixed);
  restoreAnchor(items, anchor, fixed);

  const moved = commitPositions(items, doc, rot);
  fitGroups(doc);
  return moved;
}

/**
 * Re-flow the diagram from its connections: sources on the left, each step of
 * the flow one rank to the right.
 *
 * Ranks advance along `(+1, -1)`, which is pure screen-horizontal -- it does
 * not change depth at all. That is the whole trick: no rank can ever occlude
 * another, so occlusion is left as a within-rank problem, and within a rank it
 * is solved by the height rule above.
 *
 * @returns {number} how many blocks moved
 */
export function autoLayout(doc, { rot = 0, ids = null } = {}) {
  const items = collect(doc, ids, rot);
  if (!items.length) return 0;

  // Lay each zone out in its own right, so arranging never drags a block
  // across a VPC boundary it was deliberately placed inside.
  const byGroup = new Map();
  for (const item of items) {
    const key = item.node.group ?? '';
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(item);
  }

  for (const members of byGroup.values()) {
    const fixed = fixedOccludees(doc, rot);
    const anchor = minCorner(members, fixed);
    layoutFlow(members, edgesAmong(doc, members));
    deOcclude(members, fixed);
    restoreAnchor(members, anchor, fixed);
  }

  // Laying each zone out in isolation leaves one blind spot: a block in one
  // zone can still cover a caption in another. A final sweep over everything
  // closes it, and can only push blocks further forward than the per-zone
  // passes already did.
  deOcclude(items, fixedOccludees(doc, rot));

  const moved = commitPositions(items, doc, rot);
  fitGroups(doc);
  separateGroups(doc, rot);
  // Separating siblings can carry one of them out of the zone that contains
  // both, so parents have to be re-fitted around where their children landed.
  fitGroups(doc);

  // Pushing whole zones about can drop a block back on top of a note, so the
  // last word goes to a settling pass over the committed positions. It is
  // idempotent, so on a layout that is already clear it does nothing.
  return moved + tidy(doc, { rot, ids });
}

// ---------------------------------------------------------------------------
// Working in rotated space
// ---------------------------------------------------------------------------

/** Cells of clearance kept around a caption. */
const CAPTION_PAD = 0.2;

/**
 * The ground rectangle a caption occupies, in the rotated frame, or null when
 * it is not lying on the ground.
 *
 * Only `floor` captions are ground obstacles. A `screen` caption is drawn over
 * everything and cannot be hidden; the two standing planes sit against a far
 * edge where nothing passes in front of them.
 *
 * @param {{x: number, y: number}} box  the owner's rotated footprint
 * @param {[number, number]} offset  where the caption starts, relative to it
 */
function captionBox(text, size, plane, box, offset) {
  if (plane !== 'floor' || !text) return null;
  const metrics = estimateTextBox(text, size);
  return {
    x: box.x + offset[0] - CAPTION_PAD,
    y: box.y + offset[1] - CAPTION_PAD,
    // Local pixels map one-to-one onto plane units, so px / CELL is cells.
    w: metrics.width / CELL + CAPTION_PAD * 2,
    h: metrics.height / CELL + CAPTION_PAD * 2,
    ht: 0,
  };
}

/**
 * Everything that must stay visible but never moves on its own: captions
 * belonging to zones, and free-standing notes. A block carries its own caption
 * along when it is pushed, so that one is attached to the block instead.
 */
function fixedOccludees(doc, rot) {
  const out = [];

  for (const group of doc.groups) {
    const r = rotateRect(group.rect[0], group.rect[1], group.rect[2], group.rect[3], rot);
    // Zone captions start a little inside the slab's minimum corner.
    const box = captionBox(group.label, group.labelSize, group.labelPlane, r, [0.4, 0.4]);
    if (box) out.push(box);
  }

  for (const note of doc.texts) {
    const r = rotateRect(note.pos[0], note.pos[1], 0, 0, rot);
    const box = captionBox(note.text, note.size, note.plane, r, [0, 0]);
    if (box) out.push(box);
  }

  return out;
}

/**
 * Snapshot the target blocks as boxes in rotated grid space. Positions are
 * mutated on these copies; `commitPositions` converts the deltas back.
 */
function collect(doc, ids, rot) {
  const wanted = ids?.length ? new Set(ids) : null;
  return doc.nodes
    .filter((n) => !wanted || wanted.has(n.id))
    .map((node) => {
      const r = rotateRect(node.pos[0], node.pos[1], node.size[0], node.size[1], rot);
      return {
        node,
        x: r.x,
        y: r.y,
        w: r.w,
        h: r.h,
        ht: node.height,
        x0: r.x,
        y0: r.y,
        // Offset of the block's own caption in the rotated frame, matching
        // `placeBlockLabel`: a floor caption sits just in front of the block.
        caption:
          node.labelPlane === 'floor' && node.label
            ? { offset: [0, r.h + 0.35], text: node.label, size: node.labelSize }
            : null,
      };
    });
}

/** Apply the accumulated rotated-space deltas to the real document nodes. */
function commitPositions(items, doc, rot) {
  let moved = 0;
  for (const item of items) {
    // Rounded as a backstop: every push is integral by construction, but a
    // fractional position would escape into the saved file and break the
    // "all coordinates are integers" contract the format makes.
    const dx = Math.round(item.x - item.x0);
    const dy = Math.round(item.y - item.y0);
    if (dx === 0 && dy === 0) continue;
    // Rotation is linear, so a delta rotates like a point: no re-anchoring.
    const d = unrotatePoint(dx, dy, rot);
    const node = nodeById(doc, item.node.id);
    if (!node) continue;
    node.pos = [node.pos[0] + d.x, node.pos[1] + d.y];
    moved++;
  }
  return moved;
}

const depthBack = (b) => b.x + b.y;
const depthFront = (b) => b.x + b.w + b.y + b.h;
/** Horizontal screen extent, in units of (x - y). */
const colMin = (b) => b.x - (b.y + b.h);
const colMax = (b) => b.x + b.w - b.y;

function columnsOverlap(a, b) {
  return colMin(a) < colMax(b) && colMin(b) < colMax(a);
}

/**
 * Back corner of everything that defines where the diagram sits.
 *
 * Fixed occludees are included deliberately. They never move, so re-anchoring
 * on the blocks alone would shift the blocks back over the very notes the pass
 * just cleared -- and with a single block it would undo the push entirely.
 */
function minCorner(items, fixed = []) {
  const all = [...items, ...fixed];
  return {
    x: Math.min(...all.map((i) => i.x)),
    y: Math.min(...all.map((i) => i.y)),
  };
}

/** Keep the arrangement where the user left it rather than letting it drift. */
function restoreAnchor(items, anchor, fixed = []) {
  const now = minCorner(items, fixed);
  // Caption boxes have fractional edges, so the anchor can land off-grid.
  // Blocks live on whole cells, and the document contract says every
  // coordinate is an integer -- so the shift has to be one too.
  const dx = Math.round(anchor.x - now.x);
  const dy = Math.round(anchor.y - now.y);
  if (dx === 0 && dy === 0) return;
  for (const item of items) {
    item.x += dx;
    item.y += dy;
  }
}

// ---------------------------------------------------------------------------
// The occlusion pass
// ---------------------------------------------------------------------------

/**
 * Walk back to front and push each block forward until nothing in front of a
 * shorter neighbour hides it. Pushing only ever increases depth, so a single
 * ordered pass is enough -- a block is never compared against something that
 * moves afterwards.
 */
function deOcclude(items, fixed = [], rounds = 8) {
  // A push can be large enough to carry a block past one that was already
  // placed, which puts it in front of something nobody re-checked. Re-sorting
  // and sweeping again settles that; it converges quickly because every push
  // only ever increases depth.
  for (let pass = 0; pass < rounds; pass++) {
    if (!deOccludeOnce(items, fixed)) return;
  }
}

/** @returns {boolean} whether anything moved */
function deOccludeOnce(items, fixed) {
  const order = items.slice().sort((a, b) => depthBack(a) - depthBack(b) || a.x - b.x);
  let moved = false;

  // Starts at zero, not one. The backmost block has no block behind it, but a
  // note or a zone caption can still be behind it -- those are not part of the
  // ordering, so skipping index 0 would leave them permanently covered.
  for (let i = 0; i < order.length; i++) {
    const front = order[i];
    let requiredBack = depthBack(front);

    // Everything already placed that this block could cover: the blocks behind
    // it, their captions, and anything fixed that was there to begin with.
    const behind = [];
    for (let j = 0; j < i; j++) {
      behind.push(order[j]);
      const caption = captionOf(order[j]);
      if (caption) behind.push(caption);
    }
    behind.push(...fixed);

    for (const back of behind) {
      if (!columnsOverlap(back, front)) continue; // side by side: never hidden
      if (depthBack(front) < depthBack(back)) continue; // genuinely behind it
      const clearance = Math.max(2 * MIN_GAP, 2 * (front.ht - back.ht));
      requiredBack = Math.max(requiredBack, depthFront(back) + clearance);
    }

    const deficit = requiredBack - depthBack(front);
    if (deficit <= 0) continue;
    // Moving k cells along (1,1) buys 2k of depth and no horizontal shift.
    const k = Math.ceil(deficit / 2);
    front.x += k;
    front.y += k;
    moved = true;
  }

  return moved;
}

/** A block's own caption as a ground box at the block's current position. */
function captionOf(item) {
  if (!item.caption) return null;
  return captionBox(item.caption.text, item.caption.size, 'floor', item, item.caption.offset);
}

// ---------------------------------------------------------------------------
// The flow layout
// ---------------------------------------------------------------------------

function edgesAmong(doc, items) {
  const inside = new Set(items.map((i) => i.node.id));
  return doc.edges.filter((e) => inside.has(e.from) && inside.has(e.to));
}

function layoutFlow(items, edges) {
  if (items.length < 2) return;

  const byId = new Map(items.map((i) => [i.node.id, i]));
  const rank = rankNodes(items, edges);
  const ranks = groupByRank(items, rank);
  orderWithinRanks(ranks, edges, byId, rank);

  // Ranks step along (+1,-1): straight across the screen, depth unchanged.
  let across = 0;
  for (const members of ranks) {
    const span = Math.max(...members.map((m) => m.w + m.h));
    let depth = 0;
    for (const item of members) {
      item.x = across + depth;
      item.y = -across + depth;
      depth += Math.ceil((item.w + item.h) / 2) + MIN_GAP;
    }
    across += Math.ceil((span + RANK_GAP * 2) / 2);
  }
}

/**
 * Longest-path ranking, relaxed rather than topologically sorted so a cyclic
 * graph still terminates with something sensible instead of throwing.
 */
function rankNodes(items, edges) {
  const rank = new Map(items.map((i) => [i.node.id, 0]));
  for (let pass = 0; pass < items.length; pass++) {
    let changed = false;
    for (const e of edges) {
      const next = rank.get(e.from) + 1;
      if (next > rank.get(e.to)) {
        rank.set(e.to, next);
        changed = true;
      }
    }
    if (!changed) break; // a cycle stops here with ranks already spread out
  }
  return rank;
}

function groupByRank(items, rank) {
  const buckets = new Map();
  for (const item of items) {
    const r = rank.get(item.node.id) ?? 0;
    if (!buckets.has(r)) buckets.set(r, []);
    buckets.get(r).push(item);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => list);
}

/**
 * Two barycentre sweeps: each node drifts towards the average position of its
 * neighbours in the neighbouring rank, which is the cheap classic way to pull
 * edge crossings out of a layered drawing.
 */
function orderWithinRanks(ranks, edges, byId, rank) {
  const successors = new Map();
  const predecessors = new Map();
  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    if (!successors.has(e.from)) successors.set(e.from, []);
    if (!predecessors.has(e.to)) predecessors.set(e.to, []);
    successors.get(e.from).push(e.to);
    predecessors.get(e.to).push(e.from);
  }

  const index = new Map();
  ranks.forEach((members) => members.forEach((m, i) => index.set(m.node.id, i)));

  const sweep = (order, neighboursOf) => {
    for (const members of order) {
      const score = new Map(
        members.map((m) => {
          const ns = (neighboursOf.get(m.node.id) ?? [])
            .map((id) => index.get(id))
            .filter((v) => v !== undefined);
          // No neighbours in that direction: hold position rather than jump.
          const mean = ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : index.get(m.node.id);
          return [m.node.id, mean];
        })
      );
      members.sort((a, b) => score.get(a.node.id) - score.get(b.node.id));
      members.forEach((m, i) => index.set(m.node.id, i));
    }
  };

  sweep(ranks, predecessors);
  sweep(ranks.slice().reverse(), successors);

  // Within a rank, ties are broken tallest-first so height order lines up with
  // depth order, which is the arrangement that needs no extra clearance at all.
  for (const members of ranks) {
    members.sort((a, b) => index.get(a.node.id) - index.get(b.node.id) || b.ht - a.ht);
  }
  void rank;
}

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

/** Grow or shrink every zone to hold its members, with a cell of margin. */
function fitGroups(doc) {
  for (const group of doc.groups) {
    const members = doc.nodes.filter((n) => n.group === group.id);
    if (!members.length) continue;
    const x0 = Math.min(...members.map((n) => n.pos[0])) - 1;
    const y0 = Math.min(...members.map((n) => n.pos[1])) - 1;
    const x1 = Math.max(...members.map((n) => n.pos[0] + n.size[0])) + 1;
    const y1 = Math.max(...members.map((n) => n.pos[1] + n.size[1])) + 1;
    group.rect = [x0, y0, x1 - x0, y1 - y0];
  }
  // Nested zones must still contain their children after resizing.
  for (const group of doc.groups) {
    const children = doc.groups.filter((g) => g.parent === group.id);
    if (!children.length) continue;
    const x0 = Math.min(group.rect[0], ...children.map((c) => c.rect[0] - 1));
    const y0 = Math.min(group.rect[1], ...children.map((c) => c.rect[1] - 1));
    const x1 = Math.max(
      group.rect[0] + group.rect[2],
      ...children.map((c) => c.rect[0] + c.rect[2] + 1)
    );
    const y1 = Math.max(
      group.rect[1] + group.rect[3],
      ...children.map((c) => c.rect[1] + c.rect[3] + 1)
    );
    group.rect = [x0, y0, x1 - x0, y1 - y0];
  }
}

/**
 * Zones that grew into each other are pushed apart along the depth axis, along
 * with everything inside them. Siblings only -- a nested zone is supposed to
 * overlap its parent.
 */
function separateGroups(doc, rot) {
  const boxes = doc.groups.map((group) => {
    const r = rotateRect(group.rect[0], group.rect[1], group.rect[2], group.rect[3], rot);
    return { group, ...r, ht: 0 };
  });
  boxes.sort((a, b) => depthBack(a) - depthBack(b));

  for (let i = 1; i < boxes.length; i++) {
    const front = boxes[i];
    let requiredBack = depthBack(front);
    for (let j = 0; j < i; j++) {
      const back = boxes[j];
      if (related(doc, front.group, back.group)) continue;
      if (!columnsOverlap(back, front)) continue;
      requiredBack = Math.max(requiredBack, depthFront(back) + 2 * MIN_GAP);
    }
    const deficit = requiredBack - depthBack(front);
    if (deficit <= 0) continue;

    const k = Math.ceil(deficit / 2);
    const d = unrotatePoint(k, k, rot);
    front.x += k;
    front.y += k;
    shiftGroupTree(doc, front.group, d.x, d.y);
  }
}

function related(doc, a, b) {
  return isAncestor(doc, a, b.id) || isAncestor(doc, b, a.id);
}

function isAncestor(doc, group, ancestorId) {
  let cur = group;
  for (let i = 0; cur?.parent && i < 32; i++) {
    if (cur.parent === ancestorId) return true;
    cur = groupById(doc, cur.parent);
  }
  return false;
}

/** Move a zone, its descendants and everything sitting inside them. */
function shiftGroupTree(doc, group, dx, dy) {
  if (dx === 0 && dy === 0) return;
  const ids = new Set([group.id]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const g of doc.groups) {
      if (g.parent && ids.has(g.parent) && !ids.has(g.id)) {
        ids.add(g.id);
        changed = true;
      }
    }
  }
  for (const g of doc.groups) {
    if (!ids.has(g.id)) continue;
    g.rect = [g.rect[0] + dx, g.rect[1] + dy, g.rect[2], g.rect[3]];
  }
  for (const n of doc.nodes) {
    if (!ids.has(n.group)) continue;
    n.pos = [n.pos[0] + dx, n.pos[1] + dy];
  }
}

/**
 * How many blocks are currently hidden by something in front of them. Used to
 * report what an arrange actually achieved, and by the tests.
 */
export function countOccluded(doc, rot = 0) {
  const items = collect(doc, null, rot);

  // Blocks are the only things that hide anything; captions and notes lie flat
  // on the ground and hide nothing themselves, but can certainly be hidden.
  const targets = [...items];
  for (const item of items) {
    const caption = captionOf(item);
    if (caption) targets.push(caption);
  }
  targets.push(...fixedOccludees(doc, rot));

  let hidden = 0;
  for (const back of targets) {
    for (const front of items) {
      if (front === back) continue;
      if (depthBack(front) <= depthBack(back)) continue;
      if (!columnsOverlap(back, front)) continue;
      if (depthBack(front) - depthFront(back) < 2 * (front.ht - back.ht)) {
        hidden++;
        break;
      }
    }
  }
  return hidden;
}

export { reassignGroups };
