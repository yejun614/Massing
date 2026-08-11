/**
 * Application state and undo history.
 *
 * State is split in two. `doc` is the diagram, and every change to it goes
 * through `commit` so it can be undone. Everything else -- selection, camera,
 * active tool, transient UI -- lives alongside it and is not part of history,
 * because undoing a pan is never what anyone wants.
 *
 * History uses whole-document snapshots rather than inverse commands. A
 * diagram is a few kilobytes, so the copy is free at this scale, and it
 * removes the entire class of bugs where an inverse operation drifts out of
 * sync with the operation it is supposed to undo.
 */

import { createEmptyDoc } from './schema.js';
import { createCamera } from '../render/camera.js';

const HISTORY_LIMIT = 100;

export function createStore(doc = createEmptyDoc()) {
  const listeners = new Set();
  const undoStack = [];
  const redoStack = [];

  let gesture = null; // { label, snapshot } while a drag is in flight
  let revision = 0;

  const state = {
    doc,
    /** Ids of selected nodes, groups and edges. */
    selection: [],
    camera: createCamera(),
    /** 'select' | 'pan' | 'place' | 'group' | 'connect' */
    tool: 'select',
    /** Component type queued for placement by the palette. */
    pendingType: null,
    /** Zone kind used by the group tool. */
    pendingGroupKind: 'vpc',
    /** Flowchart shape queued for placement by the palette. */
    pendingShape: null,
    /** Grid cell under the pointer, or null. */
    hover: null,
    /** Id of the entity under the pointer, or null. */
    hoverId: null,
    /**
     * Ids the assistant has just touched, so the render can point at them.
     *
     * Not part of the document and not part of the selection: it is a fact
     * about the last few seconds rather than about the diagram, which is why it
     * lives here and clears itself.
     */
    aiTouched: [],
    /**
     * What following a link just arrived at, so the render can ring it.
     *
     * Beside `aiTouched` rather than folded into it: both point at something for
     * a few seconds, but one is "the model changed these" and the other is
     * "this is the thing you asked to see", and a link followed while the
     * assistant's highlight was still fading must not cancel it. Like that one,
     * it is a fact about the last few seconds and clears itself.
     */
    landed: null,
    /** Document revision; bumped on every committed change. */
    revision: 0,
    /** True when the document differs from the last saved copy. */
    dirty: false,
    /**
     * Whether the interface is currently dark. Kept here rather than read from
     * the DOM so a render is a pure function of state, and because a document
     * with no background of its own takes its colour from it.
     */
    dark: false,
    /**
     * Whether the diagram is being presented rather than edited.
     *
     * Here rather than only as a class on the page, because the two layers that
     * have to refuse an edit -- the pointer and the keyboard -- ask the state
     * for everything else they decide and should not be reading the DOM to
     * decide this one. See `ui/present.js`.
     */
    presenting: false,
  };

  function notify(what) {
    for (const fn of listeners) fn(state, what);
  }

  function snapshot() {
    return structuredClone(state.doc);
  }

  function pushUndo(label) {
    undoStack.push({ label, doc: snapshot() });
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
  }

  return {
    get state() {
      return state;
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** Change UI state. Never recorded in history. */
    setUI(patch) {
      let changed = false;
      for (const [k, v] of Object.entries(patch)) {
        if (state[k] !== v) {
          state[k] = v;
          changed = true;
        }
      }
      if (changed) notify('ui');
    },

    /** Apply a document change and record it for undo. */
    commit(label, mutator) {
      if (!gesture) pushUndo(label);
      mutator(state.doc);
      state.revision = ++revision;
      state.dirty = true;
      notify('doc');
    },

    /**
     * Start a multi-step change (a drag) that undoes as one entry. Every
     * `commit` until `endGesture` folds into the snapshot taken here.
     */
    beginGesture(label) {
      if (gesture) this.endGesture();
      gesture = { label, snapshot: snapshot() };
    },

    /** Finish a gesture, discarding it entirely if nothing actually changed. */
    endGesture() {
      if (!gesture) return;
      const { label, snapshot: before } = gesture;
      gesture = null;
      if (JSON.stringify(before) === JSON.stringify(state.doc)) return;
      undoStack.push({ label, doc: before });
      if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
      redoStack.length = 0;
      notify('history');
    },

    /**
     * Swap in a whole new document (file load, new diagram, paste-over).
     *
     * `keepSelection` is for a reload: that is the same diagram a moment later,
     * so whatever was selected should still be selected if it still exists.
     * Opening a different file clears it, because carrying a selection across
     * would be arbitrary.
     */
    replaceDoc(next, label = 'Load', { markSaved = false, keepSelection = false } = {}) {
      pushUndo(label);
      state.doc = next;
      state.selection = keepSelection ? pruneSelection(state.selection, next) : [];
      state.revision = ++revision;
      state.dirty = !markSaved;
      notify('doc');
    },

    markSaved() {
      state.dirty = false;
      notify('ui');
    },

    /**
     * Lift the undo history out, and put one back.
     *
     * For tabs, which swap the whole document: each drawing keeps its own
     * history rather than sharing one stack, because a shared stack undoes an
     * edit made in a drawing you are no longer looking at — the entries are
     * whole documents, so it would quietly overwrite the tab you *are* looking
     * at with a snapshot of a different one.
     *
     * `detachHistory` empties the stacks as it hands them over, so the
     * `replaceDoc` that follows is the first entry of the incoming tab's
     * history and is then discarded by `attachHistory`.
     */
    detachHistory() {
      const taken = { undo: undoStack.splice(0), redo: redoStack.splice(0) };
      notify('history');
      return taken;
    },

    attachHistory(history) {
      undoStack.length = 0;
      redoStack.length = 0;
      undoStack.push(...(history?.undo ?? []));
      redoStack.push(...(history?.redo ?? []));
      notify('history');
    },

    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    undoLabel: () => undoStack.at(-1)?.label ?? null,
    redoLabel: () => redoStack.at(-1)?.label ?? null,

    undo() {
      if (!undoStack.length) return false;
      const entry = undoStack.pop();
      redoStack.push({ label: entry.label, doc: snapshot() });
      state.doc = entry.doc;
      state.selection = pruneSelection(state.selection, entry.doc);
      state.revision = ++revision;
      state.dirty = true;
      notify('doc');
      return true;
    },

    redo() {
      if (!redoStack.length) return false;
      const entry = redoStack.pop();
      undoStack.push({ label: entry.label, doc: snapshot() });
      state.doc = entry.doc;
      state.selection = pruneSelection(state.selection, entry.doc);
      state.revision = ++revision;
      state.dirty = true;
      notify('doc');
      return true;
    },

    // --- selection ---------------------------------------------------------

    select(ids, { additive = false, toggle = false } = {}) {
      const list = Array.isArray(ids) ? ids : [ids].filter(Boolean);
      let next;
      if (toggle) {
        next = state.selection.slice();
        for (const id of list) {
          const at = next.indexOf(id);
          if (at >= 0) next.splice(at, 1);
          else next.push(id);
        }
      } else if (additive) {
        next = state.selection.concat(list.filter((id) => !state.selection.includes(id)));
      } else {
        next = list;
      }
      if (sameIds(next, state.selection)) return;
      state.selection = next;
      notify('selection');
    },

    clearSelection() {
      if (!state.selection.length) return;
      state.selection = [];
      notify('selection');
    },
  };
}

function pruneSelection(selection, doc) {
  const alive = new Set([
    ...doc.nodes.map((n) => n.id),
    ...doc.groups.map((g) => g.id),
    ...doc.edges.map((e) => e.id),
    ...doc.texts.map((t) => t.id),
    ...doc.images.map((i) => i.id),
    ...doc.shapes.map((sh) => sh.id),
  ]);
  return selection.filter((id) => alive.has(id));
}

function sameIds(a, b) {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
