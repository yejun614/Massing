/**
 * The scene: one SVG element, five stacked layers, and a keyed diff.
 *
 * Rendering never rebuilds the tree. Each entity keeps its own `<g>` across
 * frames, identified by document id, so attribute writes are the only work in
 * the common case. Only the block layer is depth-sorted, and only its DOM
 * order is touched when the sort changes.
 *
 * Layer order is the painter's order for the whole diagram:
 *   grid -> zones -> edges -> blocks -> texts -> overlay
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
import { sortForPaint } from '../geom/depth.js';
import { nodeBox, rotatedBox, groupsInPaintOrder, endpointBox } from '../core/doc.js';
import { luminance } from '../util/color.js';

export function createScene(container, { onResize } = {}) {
  const grid = createGridView();
  // Flat content marked "behind" sits under everything, which is what a
  // floorplan or a backdrop wants to be.
  const behind = svg('g', { class: 'layer layer-behind' });
  const zones = svg('g', { class: 'layer layer-zones' });
  const edges = svg('g', { class: 'layer layer-edges' });
  const blocks = svg('g', { class: 'layer layer-blocks' });
  // Annotations sit above the blocks: an explanation hidden behind a cube is
  // no explanation at all.
  const texts = svg('g', { class: 'layer layer-texts' });
  const overlay = svg('g', { class: 'layer layer-overlay' });

  const handles = createHandlesView();

  const root = svg('g', { class: 'scene-root' }, [grid.el, behind, zones, edges, blocks, texts, overlay]);
  const el = svg('svg', { class: 'scene', xmlns: 'http://www.w3.org/2000/svg' }, [root, handles.el]);
  container.append(el);

  const zoneViews = new Map();
  const edgeViews = new Map();
  const blockViews = new Map();
  const textViews = new Map();
  const imageViews = new Map();

  let viewport = { width: container.clientWidth || 800, height: container.clientHeight || 600 };
  const observer = new ResizeObserver(() => {
    viewport = { width: container.clientWidth, height: container.clientHeight };
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

    // The scene's ink follows the *document's* background, not the interface
    // theme: a dark canvas needs light labels whichever theme is on, and a
    // white canvas needs dark ones even in dark mode. Everything in
    // canvas.css reads these two custom properties.
    const dark = luminance(doc.canvas.background) < 0.45;
    setAttr(
      el,
      'style',
      `background:${doc.canvas.background};` +
        `--scene-ink:${dark ? '#e8eef6' : '#26313f'};` +
        `--scene-ink-soft:${dark ? '#9fb0c4' : '#54637a'};` +
        `--scene-halo:${doc.canvas.background};` +
        `--scene-grid:${dark ? '#31404f' : '#cbd5e1'};` +
        `--scene-axis:${dark ? '#465a6d' : '#9aa8b8'}`
    );
    setAttr(root, 'transform', cameraTransform(camera));

    updateGridView(grid, { cam: camera, proj, viewport: cover ?? viewport, hover: state.hover });

    const ctxBase = { proj, rot, doc };

    // --- zones -------------------------------------------------------------
    const orderedGroups = groupsInPaintOrder(doc);
    diff(zones, orderedGroups, zoneViews, createGroupView, (view, group) =>
      updateGroupView(view, group, {
        ...ctxBase,
        selected: selected.has(group.id),
        hovered: hoverId === group.id,
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
      })
    );

    // --- blocks ------------------------------------------------------------
    const boxes = doc.nodes.map((node) => ({
      ...rotatedBox(nodeBox(node), rot),
      node,
    }));
    const ordered = sortForPaint(boxes, !proj.showsSides).map((b) => b.node);
    diff(blocks, ordered, blockViews, createBlockView, (view, node) =>
      updateBlockView(view, node, {
        ...ctxBase,
        selected: selected.has(node.id),
        hovered: hoverId === node.id,
      })
    );
    reorder(blocks, ordered, blockViews);

    // --- flat content ------------------------------------------------------
    // Pictures and text share one placement model, so they also share the
    // choice of which side of the blocks to land on.
    const planar = [
      ...doc.images.map((entity) => ({ entity, kind: 'image' })),
      ...doc.texts.map((entity) => ({ entity, kind: 'text' })),
    ];
    for (const [layer, wantBehind] of [[behind, true], [texts, false]]) {
      const here = planar.filter((p) => !!p.entity.behind === wantBehind);
      diffMixed(layer, here, { image: imageViews, text: textViews }, {
        image: [createImageView, updateImageView],
        text: [createTextView, updateTextView],
      }, (entity) => ({
        ...ctxBase,
        selected: selected.has(entity.id),
        hovered: hoverId === entity.id,
      }));
    }

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
    const boxes = [behind, zones, edges, blocks, texts]
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
    layers: { behind, zones, edges, blocks, texts, overlay, handles: handles.el },
    render,
    contentBox,
    get viewport() {
      return viewport;
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
  const seen = { image: new Set(), text: new Set() };
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
