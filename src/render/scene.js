/**
 * The scene: one SVG element, five stacked layers, and a keyed diff.
 *
 * Rendering never rebuilds the tree. Each entity keeps its own `<g>` across
 * frames, identified by document id, so attribute writes are the only work in
 * the common case. Only the block layer is depth-sorted, and only its DOM
 * order is touched when the sort changes.
 *
 * Layer order is the painter's order for the whole diagram:
 *   grid -> behind -> zones -> edges -> solids -> overlay
 *
 * "Solids" is one layer holding everything that stands on the ground — blocks,
 * flowchart shapes, data structures, and any note or picture not marked
 * `behind` — because "what is in front of what" among them is one question with
 * one answer, and a separate layer per kind answers it by document order
 * instead.
 *
 * Resize grips are the exception. They hang outside the camera transform, so
 * they keep their size on screen at any zoom, and are drawn above everything.
 */

import { svg, setAttr } from '../util/dom.js';
import { cameraTransform, projectionOf } from './camera.js';
import { createGridView, updateGridView } from './grid.js';
import { createHandlesView, updateHandlesView } from './handles.js';
import { createGroupView, updateGroupView } from './group.js';
import { createEdgeView, updateEdgeView } from './edge.js';
import { createBlockView, updateBlockView } from './block.js';
import { createTextView, updateTextView } from './text.js';
import { createImageView, updateImageView } from './image.js';
import { createShapeView, updateShapeView } from './shape.js';
import { createCellsView, updateCellsView } from './cells.js';
import { sortForPaint } from '../geom/depth.js';
import { nodeBox, shapeBox, cellsBox, rotatedBox, groupsInPaintOrder, endpointBox } from '../core/doc.js';
import { canvasBackground } from '../core/schema.js';
import { luminance } from '../util/color.js';

export function createScene(container, { onResize } = {}) {
  const grid = createGridView();
  // Flat content marked "behind" sits under everything, which is what a
  // floorplan or a backdrop wants to be.
  const behind = svg('g', { class: 'layer layer-behind' });
  const zones = svg('g', { class: 'layer layer-zones' });
  const edges = svg('g', { class: 'layer layer-edges' });
  /*
   * Blocks and flowchart shapes share one layer, and that is the whole of how
   * they sort against each other.
   *
   * Both stand on the same ground and both have a footprint and a height, so
   * "which is in front" is one question with one answer — the painter's order
   * below. Two layers made it two questions, and the second was answered by
   * whichever layer happened to be later in the document: a step placed in
   * front of a server still drew behind it, at every camera angle, with no way
   * to fix it from the drawing.
   */
  const solids = svg('g', { class: 'layer layer-blocks' });
  // Annotations sit above the blocks: an explanation hidden behind a cube is
  // no explanation at all.
  const overlay = svg('g', { class: 'layer layer-overlay' });

  const handles = createHandlesView();

  const root = svg('g', { class: 'scene-root' }, [grid.el, behind, zones, edges, solids, overlay]);
  const el = svg('svg', { class: 'scene', xmlns: 'http://www.w3.org/2000/svg' }, [root, handles.el]);
  container.append(el);

  const zoneViews = new Map();
  const edgeViews = new Map();
  const shapeViews = new Map();
  const cellsViews = new Map();
  const blockViews = new Map();
  const textViews = new Map();
  const imageViews = new Map();

  const measure = () => ({
    width: container.clientWidth || 800,
    height: container.clientHeight || 600,
  });
  let viewport = measure();
  const observer = new ResizeObserver(() => {
    viewport = measure();
    // The grid is generated for whatever the viewport covers, so any layout
    // change -- a dragged panel divider, not just a window resize -- has to
    // reach the renderer or the grid is left short.
    onResize?.();
  });
  observer.observe(container);

  /**
   * @param {object} state
   * @param {{viewport?: {width:number,height:number}}} [options]
   *   The grid is generated for whatever the viewport covers, so an export
   *   that wants the grid behind content larger than the window has to say how
   *   much ground to cover. Everything else is in scene coordinates and does
   *   not care.
   */
  function render(state, { viewport: cover } = {}) {
    const { doc, camera } = state;

    // The pan tool changes what a press on the canvas does, so it has to change
    // what the canvas looks like. Space-to-pan sets the same affordance from
    // the pointer layer, which is the other way into the same mode.
    container.classList.toggle('is-pan-tool', state.tool === 'pan');
    const proj = projectionOf(camera);
    const rot = camera.rot;
    const selected = new Set(state.selection);
    const hoverId = state.hoverId;

    // The scene's ink follows the *background it is painted on*, not the
    // interface theme: a dark canvas needs light labels whichever theme is on,
    // and a white canvas needs dark ones even in dark mode. That the theme now
    // gets a say in what the background *is* when the document has no opinion
    // changes nothing here -- the ink still reads the colour, not the theme.
    const background = canvasBackground(doc, state.dark);
    const dark = luminance(background) < 0.45;
    setAttr(
      el,
      'style',
      `background:${background};` +
        `--scene-ink:${dark ? '#e8eef6' : '#26313f'};` +
        `--scene-ink-soft:${dark ? '#9fb0c4' : '#54637a'};` +
        `--scene-halo:${background};` +
        `--scene-grid:${dark ? '#31404f' : '#cbd5e1'};` +
        `--scene-axis:${dark ? '#465a6d' : '#9aa8b8'}`
    );
    setAttr(root, 'transform', cameraTransform(camera));

    updateGridView(grid, { cam: camera, proj, viewport: cover ?? viewport, hover: state.hover });

    const touched = new Set(state.aiTouched ?? []);
    // `zoom` is here for one thing: an effect measured in screen pixels — see
    // the groove between a structure's slots — has to divide by it.
    const ctxBase = { proj, rot, doc, touched, zoom: camera.zoom };

    // --- zones -------------------------------------------------------------
    const orderedGroups = groupsInPaintOrder(doc);
    diff(zones, orderedGroups, zoneViews, createGroupView, (view, group) =>
      updateGroupView(view, group, {
        ...ctxBase,
        selected: selected.has(group.id),
        hovered: hoverId === group.id,
        touched: touched.has(group.id),
      })
    );
    reorder(zones, orderedGroups, zoneViews);

    // --- edges -------------------------------------------------------------
    const liveEdges = doc.edges.filter(
      (e) => endpointBox(doc, e.from) && endpointBox(doc, e.to)
    );
    diff(edges, liveEdges, edgeViews, createEdgeView, (view, edge) =>
      updateEdgeView(view, edge, {
        ...ctxBase,
        selected: selected.has(edge.id),
        hovered: hoverId === edge.id,
        touched: touched.has(edge.id),
      })
    );

    // --- blocks and flowchart shapes, in one painter's order ---------------
    const boxes = [
      ...doc.nodes.map((node) => ({ ...rotatedBox(nodeBox(node), rot), entity: node, kind: 'block' })),
      ...doc.shapes.map((sh) => ({ ...rotatedBox(shapeBox(sh), rot), entity: sh, kind: 'shape' })),
      ...doc.cells.map((c) => ({ ...rotatedBox(cellsBox(c), rot), entity: c, kind: 'cells' })),
      /*
       * Flat content sorts with the solids too, unless it asked to be behind.
       *
       * A note or a picture standing among the blocks is *in* the scene, so a
       * block in front of it has to cover it — which it could not do while the
       * captions lived in a layer of their own painted after everything else.
       * `behind: true` is the one case that keeps a layer to itself, because
       * that is exactly what it asks for: under the whole drawing.
       */
      ...doc.texts
        .filter((t) => !t.behind)
        .map((t) => ({
          // A note hangs from a point rather than covering a footprint, so that
          // point is what decides whether it is in front of a block or behind.
          ...rotatedBox({ x: t.pos[0], y: t.pos[1], w: 0, h: 0, z: t.z, ht: 0 }, rot),
          entity: t,
          kind: 'text',
        })),
      ...doc.images
        .filter((im) => !im.behind)
        .map((im) => ({
          ...rotatedBox(
            { x: im.pos[0], y: im.pos[1], w: im.size[0], h: im.size[1], z: im.z, ht: 0 },
            rot
          ),
          entity: im,
          kind: 'image',
        })),
    ];
    const ordered = sortForPaint(boxes, !proj.showsSides)
      .map(({ entity, kind }) => ({ entity, kind }));
    const solidViews = {
      block: blockViews,
      shape: shapeViews,
      cells: cellsViews,
      text: textViews,
      image: imageViews,
    };
    diffMixed(
      solids,
      ordered,
      solidViews,
      {
        block: [createBlockView, updateBlockView],
        shape: [createShapeView, updateShapeView],
        cells: [createCellsView, updateCellsView],
        text: [createTextView, updateTextView],
        image: [createImageView, updateImageView],
      },
      (entity) => ({
        ...ctxBase,
        selected: selected.has(entity.id),
        hovered: hoverId === entity.id,
        touched: touched.has(entity.id),
      })
    );
    reorderMixed(solids, ordered, solidViews);

    // --- flat content ------------------------------------------------------
    // Pictures and text share one placement model, so they also share the
    // choice of which side of the blocks to land on.
    const underneath = [
      ...doc.images.filter((im) => im.behind).map((entity) => ({ entity, kind: 'image' })),
      ...doc.texts.filter((t) => t.behind).map((entity) => ({ entity, kind: 'text' })),
    ];
    diffMixed(behind, underneath, { image: imageViews, text: textViews }, {
      image: [createImageView, updateImageView],
      text: [createTextView, updateTextView],
    }, (entity) => ({
      ...ctxBase,
      selected: selected.has(entity.id),
      hovered: hoverId === entity.id,
    }));

    // --- resize grips ------------------------------------------------------
    updateHandlesView(handles, state);
  }

  /**
   * Union of the drawn content in scene coordinates, or null when the diagram
   * is empty. Measured from the DOM rather than derived from the document,
   * because that is the only way to include labels, which stick out well past
   * a block's own footprint.
   */
  function contentBox(padding = 0) {
    const boxes = [behind, zones, edges, solids]
      .filter((layer) => layer.childElementCount)
      .map((layer) => layer.getBBox())
      .filter((b) => b.width || b.height);
    if (!boxes.length) return null;

    const x0 = Math.min(...boxes.map((b) => b.x)) - padding;
    const y0 = Math.min(...boxes.map((b) => b.y)) - padding;
    const x1 = Math.max(...boxes.map((b) => b.x + b.width)) + padding;
    const y1 = Math.max(...boxes.map((b) => b.y + b.height)) + padding;
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }

  return {
    el,
    root,
    overlay,
    layers: { behind, zones, edges, solids, overlay, handles: handles.el },
    render,
    contentBox,
    /**
     * Measured on every read rather than served from the observer's cache.
     *
     * The cache is a frame behind on the one that matters most: the first
     * zoom-to-fit runs before any resize has been observed, so on a phone --
     * where the panels have just folded away and the canvas has gone from
     * nothing to full width -- it would otherwise fit the diagram to the 800px
     * fallback and open at roughly twice the right zoom.
     */
    get viewport() {
      return measure();
    },
    destroy() {
      observer.disconnect();
      el.remove();
    },
  };
}

/** Create, update and remove child views so they mirror `items` by id. */
function diff(layer, items, cache, create, update) {
  const seen = new Set();
  for (const item of items) {
    let view = cache.get(item.id);
    if (!view) {
      view = create();
      cache.set(item.id, view);
      layer.append(view.el);
    }
    update(view, item);
    seen.add(item.id);
  }
  for (const [id, view] of cache) {
    if (seen.has(id)) continue;
    view.el.remove();
    cache.delete(id);
  }
}

/**
 * Like `diff`, but for a layer holding more than one kind of entity. Views are
 * cached per kind so a picture and a note can share a layer without sharing a
 * view pool.
 */
function diffMixed(layer, items, caches, builders, contextFor) {
  const seen = Object.fromEntries(Object.keys(caches).map((kind) => [kind, new Set()]));
  for (const { entity, kind } of items) {
    const cache = caches[kind];
    let view = cache.get(entity.id);
    if (!view) {
      view = builders[kind][0]();
      cache.set(entity.id, view);
    }
    if (view.el.parentNode !== layer) layer.append(view.el);
    builders[kind][1](view, entity, contextFor(entity));
    seen[kind].add(entity.id);
  }
  for (const kind of Object.keys(caches)) {
    for (const [id, view] of caches[kind]) {
      if (seen[kind].has(id)) continue;
      // Another layer may legitimately own it now; only drop views that this
      // layer still holds.
      if (view.el.parentNode !== layer) continue;
      view.el.remove();
      caches[kind].delete(id);
    }
  }
}

/** `reorder`, for a layer whose entries live in more than one view cache. */
function reorderMixed(layer, items, caches) {
  let prev = null;
  for (const { entity, kind } of items) {
    const el = caches[kind].get(entity.id)?.el;
    if (!el) continue;
    const expected = prev ? prev.nextSibling : layer.firstChild;
    if (el !== expected) layer.insertBefore(el, expected);
    prev = el;
  }
}

/** Make DOM order match `items`, moving only the elements that are misplaced. */
function reorder(layer, items, cache) {
  let prev = null;
  for (const item of items) {
    const el = cache.get(item.id)?.el;
    if (!el) continue;
    const expected = prev ? prev.nextSibling : layer.firstChild;
    if (el !== expected) layer.insertBefore(el, expected);
    prev = el;
  }
}
