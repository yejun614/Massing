/**
 * Pointer interaction: hover, selection, dragging, panning, zooming and
 * placement.
 *
 * A small explicit state machine (`idle` -> `pan` | `marquee` | `move` |
 * `connect`) rather than a tangle of boolean flags, because every one of these
 * gestures starts from the same pointerdown and only diverges on what was hit.
 *
 * Drag deltas are computed in grid space, not screen space: the pointer is
 * unprojected onto the ground plane each frame and the delta is snapped to
 * whole cells. That keeps dragging exact at any zoom or rotation.
 */

import { screenToGrid, gridToScreen, zoomAt, pan, projectionOf } from '../render/camera.js';
import {
  nodeById,
  groupById,
  textById,
  imageById,
  planarById,
  nodeBox,
  groupBox,
  boxContains,
  containingGroup,
  makeNode,
  makeGroup,
  makeText,
  makeEdge,
  reassignGroups,
} from '../core/doc.js';
import { componentFor } from '../data/components.js';

const DRAG_THRESHOLD = 3; // px before a press becomes a drag
const CONNECT_KEY = 'c';

export function attachPointer({ canvas, store, scene, overlay, toaster }) {
  /** @type {null | {mode: string, ...}} */
  let drag = null;
  let spaceDown = false;

  // --- helpers -------------------------------------------------------------

  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const cellAt = (pt) => {
    const g = screenToGrid(store.state.camera, pt.x, pt.y, 0);
    return { x: Math.floor(g.x), y: Math.floor(g.y) };
  };

  /**
   * Entity under the pointer. Resolved by coordinate rather than from
   * `e.target`, because once the canvas has pointer capture every event
   * reports the canvas as its target -- which would make drop targets during a
   * connect drag invisible to us.
   */
  const hitId = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    return el?.closest?.('[data-id]')?.dataset.id ?? null;
  };

  function refreshOverlay() {
    const { camera, pendingType, hover } = store.state;
    if (pendingType && hover) {
      const def = componentFor(pendingType);
      overlay.ghost(camera, projectionOf(camera), {
        x: hover.x,
        y: hover.y,
        w: def.size[0],
        h: def.size[1],
      });
    } else if (!drag) {
      overlay.ghost(camera, projectionOf(camera), null);
    }
  }

  // --- pointer down --------------------------------------------------------

  canvas.addEventListener('pointerdown', (e) => {
    canvas.focus({ preventScroll: true });
    const pt = local(e);

    const wantsPan = e.button === 1 || spaceDown || store.state.tool === 'pan';
    if (wantsPan) {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      drag = { mode: 'pan', last: pt };
      return;
    }
    if (e.button !== 0) return;

    // Placement mode consumes the click.
    // Shift keeps the component armed so a row of them can be dropped quickly.
    if (store.state.pendingType) {
      placeNode(store.state.pendingType, cellAt(pt));
      if (!e.shiftKey) store.setUI({ pendingType: null, tool: 'select' });
      refreshOverlay(); // drop the ghost now rather than on the next move
      return;
    }

    canvas.setPointerCapture(e.pointerId);

    if (store.state.tool === 'text') {
      placeText(cellAt(pt));
      return;
    }

    // The zone tool always draws a fresh rectangle, even over existing content.
    if (store.state.tool === 'group') {
      drag = { mode: 'draw-zone', startCell: cellAt(pt) };
      return;
    }

    const id = hitId(e);

    if (!id) {
      if (!e.shiftKey) store.clearSelection();
      drag = { mode: 'pending-marquee', origin: pt, additive: e.shiftKey };
      return;
    }

    if (e.shiftKey) {
      store.select(id, { toggle: true });
    } else if (!store.state.selection.includes(id)) {
      store.select(id);
    }

    if (store.state.tool === 'connect') {
      const node = nodeById(store.state.doc, id);
      if (node) {
        drag = { mode: 'connect', fromId: id, origin: pt, current: pt };
        return;
      }
    }

    const targets = captureMoveTargets(store.state.doc, store.state.selection);
    if (!targets.nodes.length && !targets.groups.length && !targets.planar.length) return;
    drag = {
      mode: 'move',
      origin: pt,
      startGrid: screenToGrid(store.state.camera, pt.x, pt.y, 0),
      targets,
      moved: false,
    };
  });

  // --- pointer move --------------------------------------------------------

  canvas.addEventListener('pointermove', (e) => {
    const pt = local(e);

    if (!drag) {
      const cell = cellAt(pt);
      const id = hitId(e);
      const prev = store.state.hover;
      if (!prev || prev.x !== cell.x || prev.y !== cell.y || store.state.hoverId !== id) {
        store.setUI({ hover: cell, hoverId: id });
        refreshOverlay();
      }
      return;
    }

    switch (drag.mode) {
      case 'pan': {
        store.setUI({
          camera: pan(store.state.camera, pt.x - drag.last.x, pt.y - drag.last.y),
        });
        drag.last = pt;
        break;
      }

      case 'pending-marquee': {
        if (Math.hypot(pt.x - drag.origin.x, pt.y - drag.origin.y) < DRAG_THRESHOLD) break;
        drag = { ...drag, mode: 'marquee', base: store.state.selection.slice() };
        // fall through on the next move
        break;
      }

      case 'marquee': {
        const rect = { x0: drag.origin.x, y0: drag.origin.y, x1: pt.x, y1: pt.y };
        overlay.marquee(store.state.camera, rect);
        const inside = entitiesInRect(store.state, rect);
        store.select(drag.additive ? unique([...drag.base, ...inside]) : inside);
        break;
      }

      case 'move': {
        const g = screenToGrid(store.state.camera, pt.x, pt.y, 0);
        const dx = Math.round(g.x - drag.startGrid.x);
        const dy = Math.round(g.y - drag.startGrid.y);
        if (!drag.moved) {
          if (dx === 0 && dy === 0) break;
          store.beginGesture('Move');
          drag.moved = true;
        }
        applyMove(drag.targets, dx, dy);
        break;
      }

      case 'draw-zone': {
        drag.endCell = cellAt(pt);
        overlay.ghost(store.state.camera, projectionOf(store.state.camera), zoneRect(drag));
        break;
      }

      case 'connect': {
        drag.current = pt;
        const from = nodeById(store.state.doc, drag.fromId);
        if (!from) break;
        const anchor = gridToScreen(
          store.state.camera,
          from.pos[0] + from.size[0] / 2,
          from.pos[1] + from.size[1] / 2,
          from.height
        );
        overlay.link(store.state.camera, [anchor, pt]);
        store.setUI({ hoverId: hitId(e) });
        break;
      }
    }
  });

  // --- pointer up ----------------------------------------------------------

  const finish = (e) => {
    if (!drag) return;
    const active = drag;
    drag = null;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch { /* pointer already released */ }

    if (active.mode === 'move' && active.moved) {
      store.commit('Move', (doc) => {
        reassignGroups(doc, active.targets.nodes.map((t) => nodeById(doc, t.id)).filter(Boolean));
      });
      store.endGesture();
    } else if (active.mode === 'connect') {
      connect(active.fromId, hitId(e));
    } else if (active.mode === 'draw-zone') {
      createZone(zoneRect(active));
    }
    overlay.clear();
    refreshOverlay();
  };

  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);

  canvas.addEventListener('pointerleave', () => {
    if (drag) return;
    store.setUI({ hover: null, hoverId: null });
    overlay.clear();
  });

  // --- wheel ---------------------------------------------------------------

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const pt = local(e);
      if (e.shiftKey && !e.ctrlKey) {
        store.setUI({ camera: pan(store.state.camera, -e.deltaY, 0) });
        return;
      }
      const step = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      store.setUI({ camera: zoomAt(store.state.camera, pt.x, pt.y, Math.exp(-step * 0.0016)) });
    },
    { passive: false }
  );

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // --- space-to-pan --------------------------------------------------------

  const onKeyDown = (e) => {
    if (e.code === 'Space' && !isTextTarget(e.target)) {
      spaceDown = true;
      canvas.style.cursor = 'grab';
    }
    if (e.key.toLowerCase() === CONNECT_KEY && !isTextTarget(e.target) && !e.metaKey && !e.ctrlKey) {
      store.setUI({ tool: store.state.tool === 'connect' ? 'select' : 'connect' });
    }
  };
  const onKeyUp = (e) => {
    if (e.code === 'Space') {
      spaceDown = false;
      canvas.style.cursor = '';
    }
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // --- actions -------------------------------------------------------------

  function placeNode(type, cell) {
    const def = componentFor(type);
    const x = cell.x - Math.floor(def.size[0] / 2);
    const y = cell.y - Math.floor(def.size[1] / 2);
    let newId = null;
    store.commit('Add block', (doc) => {
      const node = makeNode(doc, type, x, y);
      doc.nodes.push(node);
      reassignGroups(doc, [node]);
      newId = node.id;
    });
    if (newId) store.select(newId);
  }

  function placeText(cell) {
    let newId = null;
    store.commit('Add text', (doc) => {
      const note = makeText(doc, cell.x, cell.y);
      doc.texts.push(note);
      newId = note.id;
    });
    store.setUI({ tool: 'select' });
    if (newId) store.select(newId);
  }

  function createZone(rect) {
    if (rect.w < 1 || rect.h < 1) return;
    let newId = null;
    store.commit('Add zone', (doc) => {
      const group = makeGroup(doc, store.state.pendingGroupKind || 'vpc', [
        rect.x,
        rect.y,
        rect.w,
        rect.h,
      ]);
      const parent = containingGroup(doc, rect);
      group.parent = parent ? parent.id : null;
      doc.groups.push(group);
      reassignGroups(doc, doc.nodes);
      newId = group.id;
    });
    if (newId) store.select(newId);
    store.setUI({ tool: 'select', pendingGroupKind: null });
  }

  function connect(fromId, toId) {
    if (!toId || toId === fromId) return;
    const doc = store.state.doc;
    if (!nodeById(doc, fromId) || !nodeById(doc, toId)) return;
    const exists = doc.edges.some(
      (e) =>
        (e.from === fromId && e.to === toId) || (e.from === toId && e.to === fromId)
    );
    if (exists) {
      toaster?.info('These blocks are already connected.');
      return;
    }
    store.commit('Connect', (d) => {
      d.edges.push(makeEdge(d, fromId, toId));
    });
  }

  function applyMove(targets, dx, dy) {
    store.commit('Move', (doc) => {
      for (const t of targets.nodes) {
        const node = nodeById(doc, t.id);
        if (node) node.pos = [t.pos[0] + dx, t.pos[1] + dy];
      }
      for (const t of targets.groups) {
        const group = groupById(doc, t.id);
        if (group) group.rect = [t.rect[0] + dx, t.rect[1] + dy, t.rect[2], t.rect[3]];
      }
      // Pictures and notes share the planar placement model, so they move
      // through the same lookup.
      for (const t of targets.planar) {
        const el = planarById(doc, t.id);
        if (el) el.pos = [t.pos[0] + dx, t.pos[1] + dy];
      }
    });
  }

  return {
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    },
    refreshOverlay,
  };
}

// ---------------------------------------------------------------------------
// Selection expansion
// ---------------------------------------------------------------------------

/**
 * Snapshot of what a drag will move. Selecting a zone moves everything sitting
 * inside it, which is what "drag the VPC" is expected to mean.
 */
function captureMoveTargets(doc, selection) {
  const nodeIds = new Set();
  const groupIds = new Set();
  const planarIds = new Set();

  for (const id of selection) {
    const group = groupById(doc, id);
    if (group) {
      collectSubtree(doc, group, groupIds, nodeIds, planarIds);
      continue;
    }
    if (nodeById(doc, id)) nodeIds.add(id);
    else if (planarById(doc, id)) planarIds.add(id);
  }

  return {
    nodes: [...nodeIds].map((id) => ({ id, pos: [...nodeById(doc, id).pos] })),
    groups: [...groupIds].map((id) => ({ id, rect: [...groupById(doc, id).rect] })),
    planar: [...planarIds].map((id) => ({ id, pos: [...planarById(doc, id).pos] })),
  };
}

function collectSubtree(doc, group, groupIds, nodeIds, planarIds) {
  if (groupIds.has(group.id)) return;
  groupIds.add(group.id);
  const box = groupBox(group);
  for (const node of doc.nodes) {
    if (boxContains(box, nodeBox(node))) nodeIds.add(node.id);
  }
  for (const el of [...doc.texts, ...doc.images]) {
    const anchor = { x: el.pos[0], y: el.pos[1], w: 0, h: 0 };
    if (boxContains(box, anchor)) planarIds.add(el.id);
  }
  for (const other of doc.groups) {
    if (other.id === group.id || groupIds.has(other.id)) continue;
    if (other.parent === group.id || boxContains(box, groupBox(other))) {
      collectSubtree(doc, other, groupIds, nodeIds, planarIds);
    }
  }
}

// ---------------------------------------------------------------------------
// Marquee hit testing
// ---------------------------------------------------------------------------

/**
 * Blocks are caught by touching the marquee; zones only by being fully
 * enclosed. Zones are large, so an intersection rule would sweep a VPC into
 * the selection every time the marquee clipped its edge -- and dragging that
 * selection would then move the entire diagram.
 */
function entitiesInRect(state, rect) {
  const { doc, camera } = state;
  const box = {
    x0: Math.min(rect.x0, rect.x1),
    y0: Math.min(rect.y0, rect.y1),
    x1: Math.max(rect.x0, rect.x1),
    y1: Math.max(rect.y0, rect.y1),
  };
  const hits = [];
  for (const node of doc.nodes) {
    if (intersects(box, screenAABB(camera, nodeBox(node)))) hits.push(node.id);
  }
  for (const group of doc.groups) {
    if (encloses(box, screenAABB(camera, groupBox(group)))) hits.push(group.id);
  }
  for (const el of [...doc.texts, ...doc.images]) {
    const p = gridToScreen(camera, el.pos[0], el.pos[1], el.z ?? 0);
    if (p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1) hits.push(el.id);
  }
  return hits;
}

/** Screen-space bounding box of a grid box, including its vertical extent. */
function screenAABB(cam, b) {
  const pts = [];
  for (const [dx, dy] of [[0, 0], [b.w, 0], [b.w, b.h], [0, b.h]]) {
    pts.push(gridToScreen(cam, b.x + dx, b.y + dy, 0));
    if (b.ht) pts.push(gridToScreen(cam, b.x + dx, b.y + dy, b.ht));
  }
  return {
    x0: Math.min(...pts.map((p) => p.x)),
    x1: Math.max(...pts.map((p) => p.x)),
    y0: Math.min(...pts.map((p) => p.y)),
    y1: Math.max(...pts.map((p) => p.y)),
  };
}

function intersects(a, b) {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

function encloses(outer, inner) {
  return (
    inner.x0 >= outer.x0 && inner.x1 <= outer.x1 &&
    inner.y0 >= outer.y0 && inner.y1 <= outer.y1
  );
}

function unique(list) {
  return [...new Set(list)];
}

/** Normalised rectangle from a zone drag, inclusive of the end cell. */
function zoneRect(drag) {
  const a = drag.startCell;
  const b = drag.endCell ?? drag.startCell;
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x) + 1,
    h: Math.abs(b.y - a.y) + 1,
  };
}

export function isTextTarget(el) {
  const tag = el?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable;
}
