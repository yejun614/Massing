/**
 * Document and view commands.
 *
 * Everything the toolbar, the keyboard and the panels can do lives here, so
 * there is exactly one implementation of "delete the selection" regardless of
 * how the user asked for it.
 *
 * The clipboard carries `.arch.json` fragments as plain text. That means a
 * copied selection can be pasted straight into a chat with a language model,
 * and a fragment written by that model can be pasted back onto the canvas.
 */

import { normalizeDoc, serializeDoc, uniqueId, createEmptyDoc } from './schema.js';
import {
  allIds,
  nodeById,
  groupById,
  textById,
  planarById,
  nodeBox,
  groupBox,
  boxContains,
  docBounds,
  removeEntities,
  reassignGroups,
} from './doc.js';
import { fitToBox, fitToSceneBox, rotate, zoomAt, createCamera } from '../render/camera.js';
import { copyText } from '../util/dom.js';
import { describeParseFailure } from '../util/errors.js';
import { tidy, autoLayout, countOccluded } from './arrange.js';

const PASTE_OFFSET = 2; // cells, so a paste is visibly not the original

export function createCommands({ store, scene, toaster, io }) {
  let localClipboard = null; // fallback when the system clipboard is unavailable

  // --- selection ---------------------------------------------------------

  function selectAll() {
    const { doc } = store.state;
    store.select([
      ...doc.nodes.map((n) => n.id),
      ...doc.groups.map((g) => g.id),
      ...doc.texts.map((t) => t.id),
      ...doc.images.map((i) => i.id),
    ]);
  }

  function deleteSelection() {
    const ids = store.state.selection;
    if (!ids.length) return;
    store.commit(`Delete ${ids.length} item(s)`, (doc) => removeEntities(doc, ids));
    store.clearSelection();
  }

  /** Move the selection by whole cells; used by the arrow keys. */
  function nudge(dx, dy) {
    const ids = expandForMove(store.state.doc, store.state.selection);
    if (!ids.nodes.size && !ids.groups.size && !ids.planar.size) return;
    store.commit('Nudge', (doc) => {
      for (const id of ids.nodes) {
        const node = nodeById(doc, id);
        if (node) node.pos = [node.pos[0] + dx, node.pos[1] + dy];
      }
      for (const id of ids.groups) {
        const group = groupById(doc, id);
        if (group) group.rect = [group.rect[0] + dx, group.rect[1] + dy, group.rect[2], group.rect[3]];
      }
      for (const id of ids.planar) {
        const el = planarById(doc, id);
        if (el) el.pos = [el.pos[0] + dx, el.pos[1] + dy];
      }
      reassignGroups(doc, [...ids.nodes].map((id) => nodeById(doc, id)).filter(Boolean));
    });
  }

  // --- clipboard ---------------------------------------------------------

  /** Serialise the selection (and any edges fully inside it) as a fragment. */
  function fragmentFromSelection() {
    const { doc, selection } = store.state;
    const sel = new Set(selection);
    const groups = doc.groups.filter((g) => sel.has(g.id));
    const nodeSet = new Set(doc.nodes.filter((n) => sel.has(n.id)).map((n) => n.id));

    // A copied zone brings its contents along, matching drag behaviour.
    for (const group of groups) {
      const box = groupBox(group);
      for (const node of doc.nodes) if (boxContains(box, nodeBox(node))) nodeSet.add(node.id);
    }

    const nodes = doc.nodes.filter((n) => nodeSet.has(n.id));
    const textSet = new Set(doc.texts.filter((t) => sel.has(t.id)).map((t) => t.id));
    for (const group of groups) {
      const box = groupBox(group);
      for (const note of doc.texts) {
        if (boxContains(box, { x: note.pos[0], y: note.pos[1], w: 0, h: 0 })) textSet.add(note.id);
      }
    }
    const texts = doc.texts.filter((t) => textSet.has(t.id));
    const imageSet = new Set(doc.images.filter((i) => sel.has(i.id)).map((i) => i.id));
    for (const group of groups) {
      const box = groupBox(group);
      for (const im of doc.images) {
        if (boxContains(box, { x: im.pos[0], y: im.pos[1], w: 0, h: 0 })) imageSet.add(im.id);
      }
    }
    const images = doc.images.filter((i) => imageSet.has(i.id));
    if (!nodes.length && !groups.length && !texts.length && !images.length) return null;

    const groupIds = new Set(groups.map((g) => g.id));
    // A connection can hang off a zone as readily as off a block, so both
    // count when deciding whether a copied fragment carries it along.
    const endpoints = new Set([...nodeSet, ...groupIds]);
    return {
      version: 1,
      meta: { title: doc.meta.title },
      canvas: { ...doc.canvas },
      groups: groups.map((g) => ({ ...g, parent: groupIds.has(g.parent) ? g.parent : null })),
      nodes: nodes.map((n) => ({ ...n, group: groupIds.has(n.group) ? n.group : null })),
      edges: doc.edges.filter((e) => endpoints.has(e.from) && endpoints.has(e.to)),
      texts,
      images,
    };
  }

  async function copy() {
    const fragment = fragmentFromSelection();
    if (!fragment) return;
    const text = serializeDoc(fragment);
    localClipboard = text; // in-page fallback for when the system clipboard is denied
    await copyText(text);
    const count = fragment.nodes.length + fragment.texts.length + fragment.images.length;
    toaster?.info(`Copied ${count} item(s) as JSON.`);
  }

  async function cut() {
    await copy();
    deleteSelection();
  }

  /** Insert a fragment, re-identifying everything so nothing collides. */
  function insertFragment(text, { offset = PASTE_OFFSET } = {}) {
    let parsed;
    try {
      parsed = normalizeDoc(JSON.parse(text));
    } catch (err) {
      toaster?.error('Clipboard does not contain a diagram fragment.', {
        detail: describeParseFailure('The pasted text', err, text),
      });
      return false;
    }
    const { doc: incoming, warnings } = parsed;
    if (!incoming.nodes.length && !incoming.groups.length && !incoming.texts.length &&
        !incoming.images.length) {
      toaster?.error('Nothing to paste.');
      return false;
    }

    const created = [];
    store.commit('Paste', (doc) => {
      const taken = allIds(doc);
      const remap = new Map();
      const claim = (oldId) => {
        const id = uniqueId(oldId, taken);
        taken.add(id);
        remap.set(oldId, id);
        return id;
      };

      for (const g of incoming.groups) {
        const id = claim(g.id);
        doc.groups.push({
          ...g,
          id,
          rect: [g.rect[0] + offset, g.rect[1] + offset, g.rect[2], g.rect[3]],
          parent: null,
        });
        created.push(id);
      }
      for (const g of incoming.groups) {
        if (!g.parent) continue;
        const self = doc.groups.find((x) => x.id === remap.get(g.id));
        if (self) self.parent = remap.get(g.parent) ?? null;
      }
      for (const n of incoming.nodes) {
        const id = claim(n.id);
        doc.nodes.push({
          ...n,
          id,
          pos: [n.pos[0] + offset, n.pos[1] + offset],
          group: remap.get(n.group) ?? null,
        });
        created.push(id);
      }
      for (const e of incoming.edges) {
        const from = remap.get(e.from);
        const to = remap.get(e.to);
        if (!from || !to) continue;
        doc.edges.push({ ...e, id: claim(e.id), from, to });
      }
      for (const t of incoming.texts) {
        const id = claim(t.id);
        doc.texts.push({ ...t, id, pos: [t.pos[0] + offset, t.pos[1] + offset] });
        created.push(id);
      }
      for (const im of incoming.images) {
        const id = claim(im.id);
        doc.images.push({ ...im, id, pos: [im.pos[0] + offset, im.pos[1] + offset] });
        created.push(id);
      }
      reassignGroups(doc, doc.nodes.filter((n) => created.includes(n.id)));
    });

    store.select(created);
    toaster?.warnings(warnings);
    return true;
  }

  async function paste() {
    let text = null;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      text = localClipboard;
    }
    if (!text?.trim()) {
      toaster?.error('Clipboard is empty.');
      return;
    }
    insertFragment(text);
  }

  function duplicate() {
    const fragment = fragmentFromSelection();
    if (!fragment) return;
    insertFragment(serializeDoc(fragment));
  }

  // --- arrangement ---------------------------------------------------------

  /**
   * Run an arrangement over the selection, or the whole diagram when nothing
   * is selected, and say what it achieved. Reporting the before/after hidden
   * count matters because a good arrange often moves very little -- without
   * the number it looks like the button did nothing.
   */
  function arrangeWith(label, fn) {
    const { doc, camera, selection } = store.state;
    if (!doc.nodes.length) return;

    const ids = selection.filter((id) => nodeById(doc, id));
    const before = countOccluded(doc, camera.rot);
    let moved = 0;
    store.commit(label, (d) => {
      moved = fn(d, { rot: camera.rot, ids: ids.length ? ids : null });
      reassignGroups(d, d.nodes);
    });
    const after = countOccluded(store.state.doc, camera.rot);

    if (!moved) toaster?.info('Nothing to move — everything is already clear.');
    else if (before > after) {
      toaster?.info(`${label}: moved ${moved} block(s), ${before - after} fewer hidden.`);
    } else {
      toaster?.info(`${label}: moved ${moved} block(s).`);
    }
    zoomFit();
  }

  // --- view ----------------------------------------------------------------

  /**
   * How much of the canvas something is floating over on the left.
   *
   * On a phone the toolbar is a rail laid over the drawing rather than a
   * column beside it, so the canvas keeps the full width and a diagram fitted
   * to all of it would sit half underneath. The stylesheet is what decides
   * that and already says so in `--rail-w`; reading the number back is better
   * than keeping a second copy of it here that could disagree.
   */
  function coveredLeft() {
    const value = getComputedStyle(document.documentElement).getPropertyValue('--rail-w');
    return Number.parseFloat(value) || 0;
  }

  function zoomBy(factor) {
    const { width, height } = scene.viewport;
    const left = coveredLeft();
    // About the middle of what can actually be seen.
    const camera = zoomAt(store.state.camera, left + (width - left) / 2, height / 2, factor);
    store.setUI({ camera });
  }

  /**
   * Fit the rendered content, not the document's grid extent. The scene is
   * rendered synchronously first so the measurement reflects the camera mode
   * and rotation being fitted, not the previous frame's.
   */
  function zoomFit() {
    scene.render(store.state);
    const box = scene.contentBox(24);
    const { width, height } = scene.viewport;
    const left = coveredLeft();
    // Fit into the part that is not covered, then slide the result across it.
    const usable = { width: Math.max(1, width - left), height };
    const camera = box
      ? fitToSceneBox(store.state.camera, box, usable)
      : fitToBox(store.state.camera, docBounds(store.state.doc), usable);
    store.setUI({ camera: { ...camera, tx: camera.tx + left } });
  }

  function zoomReset() {
    store.setUI({ camera: { ...createCamera(), rot: store.state.camera.rot, mode: store.state.camera.mode } });
    zoomFit();
  }

  function rotateBy(turns) {
    store.setUI({ camera: rotate(store.state.camera, turns) });
  }

  function toggleMode() {
    const mode = store.state.camera.mode === 'iso' ? 'flat' : 'iso';
    store.setUI({ camera: { ...store.state.camera, mode } });
    zoomFit();
  }

  function setTool(tool) {
    store.setUI({ tool, pendingType: tool === 'place' ? store.state.pendingType : null });
  }

  function newDoc() {
    store.replaceDoc(createEmptyDoc(), 'New diagram');
    // A blank diagram did not come from the file that was open, so reloading
    // it would silently throw the blank one away.
    io?.forget();
    zoomFit();
  }

  return {
    tidy: () => arrangeWith('Tidy', tidy),
    autoLayout: () => arrangeWith('Auto layout', autoLayout),
    selectAll,
    deleteSelection,
    nudge,
    copy,
    cut,
    paste,
    duplicate,
    insertFragment,
    fragmentFromSelection,
    zoomIn: () => zoomBy(1.25),
    zoomOut: () => zoomBy(0.8),
    zoomFit,
    zoomReset,
    rotateLeft: () => rotateBy(-1),
    rotateRight: () => rotateBy(1),
    toggleMode,
    setTool,
    newDoc,
    undo: () => store.undo(),
    redo: () => store.redo(),
  };
}

/** Same containment rule the pointer layer uses when dragging a zone. */
function expandForMove(doc, selection) {
  const nodes = new Set();
  const groups = new Set();
  const planar = new Set();
  for (const id of selection) {
    const group = groupById(doc, id);
    if (group) {
      groups.add(id);
      const box = groupBox(group);
      for (const node of doc.nodes) if (boxContains(box, nodeBox(node))) nodes.add(node.id);
      for (const el of [...doc.texts, ...doc.images]) {
        if (boxContains(box, { x: el.pos[0], y: el.pos[1], w: 0, h: 0 })) planar.add(el.id);
      }
      for (const other of doc.groups) {
        if (other.id !== id && boxContains(box, groupBox(other))) groups.add(other.id);
      }
      continue;
    }
    if (nodeById(doc, id)) nodes.add(id);
    else if (planarById(doc, id)) planar.add(id);
  }
  return { nodes, groups, planar };
}
