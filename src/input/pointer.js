/**
 * Pointer interaction: hover, selection, dragging, resizing, panning, zooming
 * and placement.
 *
 * A small explicit state machine (`idle` -> `pan` | `marquee` | `move` |
 * `resize` | `connect`) rather than a tangle of boolean flags, because every
 * one of these gestures starts from the same pointerdown and only diverges on
 * what was hit.
 *
 * Drag deltas are computed in grid space, not screen space: the pointer is
 * unprojected onto the ground plane each frame and the delta is snapped to
 * whole cells. That keeps dragging exact at any zoom or rotation.
 *
 * Touch adds one more: a second finger down means the camera, never the
 * document. One finger selects and drags, exactly as a mouse does; two pan and
 * pinch together, which is the convention every map and canvas on a phone
 * shares. There is no wheel on a phone and no key to hold, so without it the
 * diagram could be edited but never navigated.
 */

import {
  screenToGrid,
  screenToScene,
  gridToScreen,
  zoomAt,
  pan,
  projectionOf,
} from '../render/camera.js';
import { resizeFootprint } from '../render/handles.js';
import { edgeRoute, EDGE_Z } from '../render/edge.js';
import { rotatePoint, rotateRect, CELL } from '../geom/iso.js';
import { planeAxes, planeVector } from '../geom/plane.js';
import { MAX_SPAN, CELLS_DEFAULTS, SHAPE_DEFAULTS } from '../core/schema.js';
import { clamp, clampInt, clampTenth } from '../util/num.js';
import {
  nodeById,
  groupById,
  shapeById,
  cellsById,
  edgeById,
  imageById,
  planarById,
  positionedById,
  endpointBox,
  canConnect,
  nodeBox,
  groupBox,
  boxContains,
  containingGroup,
  makeNode,
  makeGroup,
  makeText,
  makeShape,
  makeCells,
  makeEdge,
  reassignGroups,
} from '../core/doc.js';
import { componentFor } from '../data/components.js';
import { shapeKindFor } from '../data/shapes.js';

const DRAG_THRESHOLD = 3; // px before a press becomes a drag
const CONNECT_KEY = 'c';
const MAX_HEIGHT = 40; // matches the loader's own bound on `height`

export function attachPointer({ canvas, store, scene, overlay, toaster, onEditText }) {
  /** @type {null | {mode: string, ...}} */
  let drag = null;
  let spaceDown = false;
  /** Every finger currently down, so a second one can take over as a gesture. */
  const touches = new Map();

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

  /**
   * The resize grip under the pointer, if any. Grips are drawn above the whole
   * scene, so a press that lands on one is never a press on the entity beneath
   * it -- which is why this is asked before anything else on the canvas.
   */
  const hitHandle = (e) => {
    if (store.state.tool !== 'select') return null;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-handle]');
    if (!el) return null;
    return {
      role: el.dataset.handle,
      id: el.dataset.id,
      ax: Number(el.dataset.ax),
      ay: Number(el.dataset.ay),
    };
  };

  /** Midpoint and separation of the first two fingers, in canvas pixels. */
  function twoFinger() {
    const [a, b] = [...touches.values()];
    return {
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      // Never zero: it divides the next frame's ratio.
      span: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
    };
  }

  /**
   * Close whatever the first finger had begun, keeping what it did.
   *
   * Undoing it would be the other reasonable choice, but a pinch usually
   * starts *after* a deliberate drag rather than instead of one, and throwing
   * that away because a second finger landed would be the worse surprise.
   */
  function abandonDrag() {
    if (!drag) return;
    if (drag.moved) store.endGesture();
    drag = null;
    overlay.clear();
  }

  /**
   * What the palette currently has armed, as a footprint and a height.
   *
   * One answer for the hint and for the press that follows it. They used to
   * work it out separately and disagreed: the ghost drew from the pointer's
   * cell as its *corner* while the press centred the thing on that cell, so
   * everything landed half its own width away from where it had been promised.
   */
  function armedPlacement() {
    const { pendingType, pendingShape } = store.state;
    if (pendingType) {
      const def = componentFor(pendingType);
      return { size: def.size, height: def.height };
    }
    if (pendingShape === 'cells') {
      return {
        size: [
          CELLS_DEFAULTS.cols * CELLS_DEFAULTS.slot[0],
          CELLS_DEFAULTS.rows * CELLS_DEFAULTS.slot[1],
        ],
        height: CELLS_DEFAULTS.height,
      };
    }
    if (pendingShape) {
      return { size: shapeKindFor(pendingShape).size, height: SHAPE_DEFAULTS.height };
    }
    return null;
  }

  /** Where that thing lands when the canvas is pressed at `cell`: centred on it. */
  function placementBox(armed, cell) {
    return {
      x: cell.x - Math.floor(armed.size[0] / 2),
      y: cell.y - Math.floor(armed.size[1] / 2),
      w: armed.size[0],
      h: armed.size[1],
      ht: armed.height ?? 0,
    };
  }

  function refreshOverlay() {
    const { camera, hover } = store.state;
    const armed = armedPlacement();
    if (armed && hover) {
      overlay.ghost(camera, projectionOf(camera), placementBox(armed, hover));
    } else if (!drag) {
      overlay.ghost(camera, projectionOf(camera), null);
    }
  }

  // --- pointer down --------------------------------------------------------

  canvas.addEventListener('pointerdown', (e) => {
    canvas.focus({ preventScroll: true });
    const pt = local(e);

    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, pt);
      // Two fingers are always the camera. Whatever the first one had started
      // is closed off here rather than abandoned, so a half-finished move is
      // still one undo entry.
      if (touches.size === 2) {
        abandonDrag();
        canvas.setPointerCapture(e.pointerId);
        drag = { mode: 'pinch', ...twoFinger() };
        return;
      }
      if (touches.size > 2) return;
    }

    // Presenting is unconditional rather than a consequence of the tool it
    // borrows: it is the promise that a press cannot select, place or move
    // anything, and it should not depend on nothing else having set the tool.
    const wantsPan =
      e.button === 1 || spaceDown || store.state.tool === 'pan' || store.state.presenting;
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

    const grip = hitHandle(e);
    if (grip) {
      const resize = beginResize(grip, pt);
      if (resize) {
        drag = resize;
        return;
      }
    }

    // A flowchart shape is placed by a click like a component, not drawn by a
    // drag like a zone: it has a shape of its own to keep, and the size that
    // suits it is the one its kind asks for.
    if (store.state.tool === 'shape' && store.state.pendingShape) {
      if (store.state.pendingShape === 'cells') placeCells(cellAt(pt));
      else placeShape(store.state.pendingShape, cellAt(pt));
      if (!e.shiftKey) store.setUI({ pendingShape: null, tool: 'select' });
      refreshOverlay();
      return;
    }

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

    // A zone is as connectable as a block: "this subnet talks to that one" is
    // a relationship people draw.
    if (store.state.tool === 'connect' && canConnect(store.state.doc, id)) {
      drag = { mode: 'connect', fromId: id, origin: pt, current: pt };
      return;
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
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) touches.set(e.pointerId, pt);

    if (drag?.mode === 'pinch') {
      if (touches.size < 2) return;
      const now = twoFinger();
      let camera = zoomAt(store.state.camera, now.mid.x, now.mid.y, now.span / drag.span);
      camera = pan(camera, now.mid.x - drag.mid.x, now.mid.y - drag.mid.y);
      store.setUI({ camera });
      drag = { mode: 'pinch', ...now };
      return;
    }

    if (!drag) {
      // Nothing under the pointer is selectable while presenting, so nothing
      // under it should light up as though it were.
      if (store.state.presenting) return;
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

      // The three resize gestures share a shape: work out what the shape would
      // become, do nothing if that is what it already is, and open the undo
      // gesture only once something is actually about to change.
      case 'resize': {
        const g = screenToGrid(store.state.camera, pt.x, pt.y, drag.z);
        const p = rotatePoint(g.x, g.y, drag.rot);
        const next = resizeFootprint(drag.start, drag.grip.ax, drag.grip.ay, p);
        // Back out of the rotated frame only now, at the point of writing.
        const r = rotateRect(next.x, next.y, next.w, next.h, -drag.rot);
        applyResize(drag, [r.x, r.y, r.w, r.h]);
        break;
      }

      case 'resize-height': {
        const doc = store.state.doc;
        const tall = nodeById(doc, drag.id) ?? shapeById(doc, drag.id) ?? cellsById(doc, drag.id);
        if (!tall) break;
        const height = heightFromDrag(
          drag.startHeight,
          drag.origin.y - pt.y,
          store.state.camera.zoom,
          tall.height
        );
        if (height === tall.height) break;
        openGesture(drag, 'Resize');
        store.commit('Resize', (d) => {
          const it = nodeById(d, drag.id) ?? shapeById(d, drag.id) ?? cellsById(d, drag.id);
          if (it) it.height = height;
        });
        break;
      }

      case 'resize-plane': {
        const image = imageById(store.state.doc, drag.id);
        if (!image) break;
        const size = pictureSize(store.state.camera, image, drag, pt);
        if (size[0] === image.size[0] && size[1] === image.size[1]) break;
        openGesture(drag, 'Resize');
        store.commit('Resize', (doc) => {
          const im = imageById(doc, drag.id);
          if (im) im.size = size;
        });
        break;
      }

      case 'reroute': {
        const edge = edgeById(store.state.doc, drag.id);
        if (!edge) break;
        // The route is worked out in document grid space, so unprojecting the
        // pointer onto the plane the line sits on gives the crossover directly.
        const g = screenToGrid(store.state.camera, pt.x, pt.y, EDGE_Z);
        const bend = halfCell(drag.axis === 'x' ? g.x : g.y);
        if (edge.route === drag.axis && edge.bend === bend) break;
        openGesture(drag, 'Reroute');
        store.commit('Reroute', (doc) => {
          const e = edgeById(doc, drag.id);
          if (!e) return;
          e.route = drag.axis;
          e.bend = bend;
        });
        break;
      }

      case 'draw-zone': {
        drag.endCell = cellAt(pt);
        overlay.ghost(store.state.camera, projectionOf(store.state.camera), zoneRect(drag));
        break;
      }

      case 'connect': {
        drag.current = pt;
        const from = endpointBox(store.state.doc, drag.fromId);
        if (!from) break;
        const anchor = gridToScreen(
          store.state.camera,
          from.x + from.w / 2,
          from.y + from.h / 2,
          from.ht
        );
        overlay.link(store.state.camera, [anchor, pt]);
        store.setUI({ hoverId: hitId(e) });
        break;
      }
    }
  });

  // --- pointer up ----------------------------------------------------------

  const finish = (e) => {
    if (e.pointerType === 'touch') touches.delete(e.pointerId);
    // A pinch ends when it stops being a pinch. The finger still down is not
    // promoted to a drag: it has been moving the camera, and taking whatever
    // is under it now would move a block by however far the pinch travelled.
    if (drag?.mode === 'pinch') {
      if (touches.size >= 2) {
        drag = { mode: 'pinch', ...twoFinger() };
        return;
      }
      drag = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch { /* already released */ }
      overlay.clear();
      refreshOverlay();
      return;
    }
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
    } else if (active.mode.startsWith('resize') && active.moved) {
      // A block that grew may now reach into a zone, and a zone that grew may
      // now hold blocks that were outside it a moment ago.
      store.commit('Resize', (doc) => {
        const node = nodeById(doc, active.id);
        if (node) reassignGroups(doc, [node]);
        else if (groupById(doc, active.id)) reassignGroups(doc, doc.nodes);
      });
      store.endGesture();
    } else if (active.mode === 'reroute' && active.moved) {
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

  // --- double-click: write here --------------------------------------------

  /**
   * Double-click means "write here".
   *
   * On bare canvas that is a new note where you clicked. On anything that is
   * already there it is the caret in whatever that thing calls its words -- a
   * note's content, a block's or a zone's caption, a connection's label -- all
   * of which the inspector puts first in its panel.
   *
   * The second half is what makes the first reachable. A diagram of any size is
   * mostly zone, so a rule that only fired over untouched ground would hardly
   * ever fire; and it is what finally makes a new note's placeholder honest,
   * having read "Double-click to edit" while nothing did.
   *
   * Only from the select tool. The text tool already writes a note on a single
   * click, and an armed component is waiting to be placed -- in both cases the
   * first click of the pair has done the work and the second must not repeat
   * it.
   */
  canvas.addEventListener('dblclick', (e) => {
    if (e.button !== 0 || store.state.tool !== 'select' || store.state.pendingType) return;
    const id = hitId(e);
    if (id) store.select(id);
    else placeText(cellAt(local(e)));
    onEditText?.();
  });

  // --- space-to-pan --------------------------------------------------------

  const onKeyDown = (e) => {
    // Presentation mode drags to look around from every tool, so it needs no
    // held Space -- and it has no use at all for a tool that draws connections.
    if (store.state.presenting) return;
    if (e.code === 'Space' && !isTextTarget(e.target)) {
      spaceDown = true;
      // A class rather than an inline cursor: blocks and captions set cursors
      // of their own, so styling only the container leaves the pointer looking
      // like a click target over exactly the things you want to drag past.
      canvas.classList.add('is-pan-ready');
    }
    if (e.key.toLowerCase() === CONNECT_KEY && !isTextTarget(e.target) && !e.metaKey && !e.ctrlKey) {
      store.setUI({ tool: store.state.tool === 'connect' ? 'select' : 'connect' });
    }
  };
  const onKeyUp = (e) => {
    if (e.code === 'Space') {
      spaceDown = false;
      canvas.classList.remove('is-pan-ready');
    }
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // --- actions -------------------------------------------------------------

  function placeNode(type, cell) {
    const def = componentFor(type);
    const { x, y } = placementBox({ size: def.size }, cell);
    let newId = null;
    store.commit('Add block', (doc) => {
      const node = makeNode(doc, type, x, y);
      doc.nodes.push(node);
      reassignGroups(doc, [node]);
      newId = node.id;
    });
    if (newId) store.select(newId);
  }

  function placeCells(cell) {
    let newId = null;
    store.commit('Add structure', (doc) => {
      const made = makeCells(doc, cell.x, cell.y);
      const box = placementBox(
        { size: [made.cols * made.slot[0], made.rows * made.slot[1]] },
        cell
      );
      made.pos = [box.x, box.y];
      doc.cells.push(made);
      newId = made.id;
    });
    if (newId) store.select(newId);
  }

  function placeShape(kind, cell) {
    const def = shapeKindFor(kind);
    const { x, y } = placementBox({ size: def.size }, cell);
    let newId = null;
    store.commit('Add shape', (doc) => {
      const shape = makeShape(doc, kind, x, y);
      doc.shapes.push(shape);
      newId = shape.id;
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
    if (!canConnect(doc, fromId) || !canConnect(doc, toId)) return;
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

  /**
   * Snapshot of what a resize starts from.
   *
   * Grip anchors are fractions of the *rotated* footprint, so the starting
   * rectangle is captured in that frame too and converted back to document
   * coordinates only when it is written. Returns null when the grip names
   * something that is no longer there, in which case the press falls through
   * and behaves as an ordinary one.
   */
  function beginResize(grip, pt) {
    const doc = store.state.doc;
    const { camera } = store.state;

    if (grip.role === 'height') {
      const tall = nodeById(doc, grip.id) ?? shapeById(doc, grip.id) ?? cellsById(doc, grip.id);
      if (!tall) return null;
      return {
        mode: 'resize-height',
        id: grip.id,
        origin: pt,
        startHeight: tall.height,
        moved: false,
      };
    }

    if (grip.role === 'plane-size') {
      const image = imageById(doc, grip.id);
      if (!image) return null;
      return {
        mode: 'resize-plane',
        id: grip.id,
        grip,
        origin: pt,
        startSize: [...image.size],
        moved: false,
      };
    }

    if (grip.role === 'bend') {
      const edge = edgeById(doc, grip.id);
      const route = edge && edgeRoute(doc, edge);
      if (!route) return null;
      // Fixed for the duration of the drag: re-deciding the axis mid-gesture
      // would make the line jump out from under the pointer.
      return { mode: 'reroute', id: grip.id, axis: route.dragAxis, moved: false };
    }

    const node = nodeById(doc, grip.id);
    const group = groupById(doc, grip.id);
    const shape = shapeById(doc, grip.id);
    const cells = cellsById(doc, grip.id);
    const rect = node
      ? [...node.pos, ...node.size]
      : shape
        ? [...shape.pos, ...shape.size]
        : cells
          ? [...cells.pos, cells.cols * cells.slot[0], cells.rows * cells.slot[1]]
          : group?.rect;
    if (!rect) return null;

    return {
      mode: 'resize',
      id: grip.id,
      grip,
      rot: camera.rot,
      // Footprint grips sit on the top face, so the drag has to be unprojected
      // onto that plane rather than onto the ground -- otherwise the pointer
      // and the corner it is holding drift apart on anything with height.
      z: node && projectionOf(camera).showsSides ? node.height : 0,
      start: rotateRect(rect[0], rect[1], rect[2], rect[3], camera.rot),
      moved: false,
    };
  }

  /** Open the undo gesture once, at the first change that actually happens. */
  function openGesture(drag, label) {
    if (drag.moved) return;
    store.beginGesture(label);
    drag.moved = true;
  }

  /** The half-cell grid a dragged crossover snaps to. */
  const halfCell = (v) => clamp(Math.round(v * 2) / 2, -MAX_SPAN, MAX_SPAN);

  function applyResize(drag, rect) {
    const doc = store.state.doc;
    const node = nodeById(doc, drag.id);
    const group = groupById(doc, drag.id);
    const shape = shapeById(doc, drag.id);
    const cells = cellsById(doc, drag.id);
    const current = node
      ? [...node.pos, ...node.size]
      : shape
        ? [...shape.pos, ...shape.size]
        : cells
          ? [...cells.pos, cells.cols * cells.slot[0], cells.rows * cells.slot[1]]
          : group?.rect;
    if (!current || current.every((v, i) => v === rect[i])) return;

    openGesture(drag, 'Resize');
    store.commit('Resize', (d) => {
      const n = nodeById(d, drag.id);
      if (n) {
        n.pos = [rect[0], rect[1]];
        n.size = [rect[2], rect[3]];
        return;
      }
      const sh = shapeById(d, drag.id);
      if (sh) {
        sh.pos = [rect[0], rect[1]];
        sh.size = [rect[2], rect[3]];
        return;
      }
      /*
       * A structure is resized in whole slots.
       *
       * Dragging its end is "make the array longer", not "make the boxes
       * wider" — the slot keeps the size it was given and the count follows the
       * footprint, which is what a run of numbered boxes has to do to stay a
       * run of numbered boxes.
       */
      const c = cellsById(d, drag.id);
      if (c) {
        c.pos = [rect[0], rect[1]];
        c.cols = Math.max(1, Math.round(rect[2] / c.slot[0]));
        c.rows = Math.max(1, Math.round(rect[3] / c.slot[1]));
        return;
      }
      const g = groupById(d, drag.id);
      if (g) g.rect = [...rect];
    });
  }

  /**
   * A picture's new size in cells, read out of its own plane.
   *
   * The drag is measured as a vector rather than an absolute point, because a
   * spun or flipped plane puts its origin at a place that depends on the
   * picture's own size -- so reading absolute positions would feed the new size
   * straight back into the next reading and run away.
   */
  function pictureSize(camera, image, drag, pt) {
    const axes = planeAxes(projectionOf(camera), camera.rot, image);
    const from = screenToScene(camera, drag.origin.x, drag.origin.y);
    const to = screenToScene(camera, pt.x, pt.y);
    const moved = planeVector(axes, to.x - from.x, to.y - from.y);
    const [w, h] = drag.startSize;
    return [
      drag.grip.ax === 1 ? clampInt(w + moved.x / CELL, 1, MAX_SPAN, w) : w,
      drag.grip.ay === 1 ? clampInt(h + moved.y / CELL, 1, MAX_SPAN, h) : h,
    ];
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
        const el = positionedById(doc, t.id);
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
    else if (positionedById(doc, id)) planarIds.add(id);
  }

  return {
    nodes: [...nodeIds].map((id) => ({ id, pos: [...nodeById(doc, id).pos] })),
    groups: [...groupIds].map((id) => ({ id, rect: [...groupById(doc, id).rect] })),
    planar: [...planarIds].map((id) => ({ id, pos: [...positionedById(doc, id).pos] })),
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

/**
 * What a block's height becomes when its grip is dragged `dy` pixels upward.
 *
 * Whole storeys, and only whole ones. A drag is a coarse gesture — the wrist is
 * no steadier than about half a cell — so letting it write tenths meant a block
 * came out 1.7 tall from a movement nobody could have aimed, and the number
 * then had to be repaired in the inspector. A tenth is a thing to type, and the
 * inspector's field, which steps by 0.1, is where it is typed.
 *
 * What is added is whole; what it is added to is left alone. A block someone
 * deliberately set to 1.5 drags to 2.5 rather than being rounded off to 2 by a
 * gesture that was never about the fraction — so the mouse can never *introduce*
 * a fraction, and never destroys one either.
 *
 * `+z` projects to exactly `CELL` pixels straight up the screen, so converting
 * the drag to storeys is that and the zoom, and nothing more.
 */
export function heightFromDrag(startHeight, dy, zoom, fallback = startHeight) {
  const risen = Math.round(dy / (CELL * zoom));
  return clampTenth(startHeight + risen, 0, MAX_HEIGHT, fallback);
}

export function isTextTarget(el) {
  const tag = el?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable;
}
