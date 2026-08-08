/**
 * Several drawings in one file.
 *
 * The design decision worth stating: the editor never holds a tabbed document.
 * `store.state.doc` is one drawing, flat, exactly as it was before tabs
 * existed — so rendering, arranging, the inspector, undo and the assistant all
 * carry on knowing nothing about this. Tabs are assembled at the boundary, when
 * a file is written or published, and taken apart again when one is read.
 *
 * That is what keeps the feature small. The alternative — a document whose
 * collections live one level down — would have touched every module that says
 * `doc.nodes`, which is most of them, to no benefit: a drawing is a drawing
 * whether or not there is another one beside it.
 *
 * Switching is therefore a document swap, and each tab carries its own undo
 * history across it — see `store.detachHistory`. A shared stack would undo an
 * edit made in a drawing you are no longer looking at, and since history
 * entries are whole documents, it would do so by replacing the one you are.
 */

import { serializeDoc, normalizeDoc, createEmptyDoc, tabNameFrom } from './schema.js';

/** A default name for tab `index`, one-based as the strip shows it. */
export const tabName = (index) => `Tab ${index + 1}`;

/**
 * Split a loaded document into one flat document per tab.
 *
 * A plain file is one tab, which is the case that has to stay free: every
 * diagram written before this existed opens as a single drawing with a strip
 * that shows nothing worth clicking.
 *
 * @returns {{name: string, doc: object}[]}
 */
export function splitTabs(doc) {
  if (!doc.tabs?.length) return [{ name: tabName(0), doc }];
  return doc.tabs.map((tab, index) => {
    const { name, ...body } = tab;
    return {
      name: name || tabName(index),
      // Each tab becomes a document in its own right, sharing the title and the
      // background that belong to the file rather than to any one drawing.
      doc: { ...createEmptyDoc(doc.meta.title), canvas: { ...doc.canvas }, ...body },
    };
  });
}

/**
 * Put them back together for writing.
 *
 * The title and the canvas come from the active drawing, because that is the
 * one whose inspector was used to set them — they are properties of the file
 * and the file has only one of each.
 */
export function joinTabs(tabs, active = 0) {
  const lead = tabs[active]?.doc ?? tabs[0]?.doc ?? createEmptyDoc();
  if (tabs.length <= 1) return lead;
  return {
    ...createEmptyDoc(lead.meta.title),
    canvas: { ...lead.canvas },
    tabs: tabs.map(({ name, doc }, index) => ({
      name: name || tabName(index),
      groups: doc.groups,
      nodes: doc.nodes,
      edges: doc.edges,
      texts: doc.texts,
      images: doc.images,
    })),
  };
}

/**
 * The tabs of a document, and which one is showing.
 *
 * Holds every drawing in the file; the store holds only the one on screen. The
 * two are kept in step by writing the store's document back into the list on
 * the way out of a tab, and reading the next one in.
 */
export function createTabs({ store, initial = null, onSwitch } = {}) {
  /**
   * `initial` is the split of the starting document, whose first tab is already
   * in the store. Passing it in rather than loading it avoids a `replaceDoc`
   * during start-up, which would put a pointless entry at the bottom of the
   * undo stack before anyone has done anything.
   *
   * @type {{name: string, doc: object, history: object|null}[]}
   */
  let tabs = initial?.length
    ? initial.map((tab) => ({ ...tab, history: null }))
    : [{ name: tabName(0), doc: store?.state.doc ?? createEmptyDoc(), history: null }];
  let active = 0;
  const listeners = new Set();

  const announce = () => {
    for (const listener of listeners) listener();
  };

  /** Take what is on screen back into the list before leaving it. */
  function capture() {
    if (tabs[active]) tabs[active].doc = store.state.doc;
  }

  /**
   * @param {object|null} from
   *   Where the outgoing history is kept — the tab being left, or `null` when
   *   that tab is being closed and its history should go with it.
   */
  function show(index, from = tabs[active]) {
    // The order matters: taking the history out first means the switch itself
    // is the only entry `replaceDoc` can push, and it is dropped a line later.
    const outgoing = store.detachHistory();
    if (from) from.history = outgoing;
    active = Math.max(0, Math.min(index, tabs.length - 1));
    store.replaceDoc(tabs[active].doc, 'Switch tab', { markSaved: !store.state.dirty });
    store.attachHistory(tabs[active].history);
    onSwitch?.(active);
    announce();
  }

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get list() {
      capture();
      return tabs.map(({ name }, index) => ({ name, index, active: index === active }));
    },
    get active() {
      return active;
    },
    get count() {
      return tabs.length;
    },

    /** Every drawing in the file, with the open one up to date. */
    all() {
      capture();
      return tabs;
    },

    /** The whole file as one document, for saving, publishing or copying. */
    document() {
      capture();
      return joinTabs(tabs, active);
    },

    /**
     * Replace the lot — a file opened, a diagram restored, a new document.
     *
     * This puts the first drawing on screen itself rather than handing it back
     * for the caller to assign, because the two have to happen in that order
     * and the caller cannot control it: announcing the new list runs the strip,
     * the strip asks what is open, and `capture` would write the *outgoing*
     * document into the incoming tab. Doing both here closes that window.
     *
     * It does not frame the result. A file being opened wants the camera moved
     * and a file being re-read wants it left exactly where it is, and only the
     * caller knows which of the two this is.
     */
    load(doc, { label = 'Open', ...options } = {}) {
      tabs = splitTabs(doc).map((tab) => ({ ...tab, history: null }));
      active = 0;
      store.replaceDoc(tabs[0].doc, label, { markSaved: true, ...options });
      announce();
      return tabs[0].doc;
    },

    select(index) {
      if (index === active || index < 0 || index >= tabs.length) return;
      capture();
      show(index);
    },

    add(doc = null) {
      capture();
      tabs.push({ name: tabName(tabs.length), doc: doc ?? createEmptyDoc(store.state.doc.meta.title) });
      show(tabs.length - 1);
    },

    duplicate(index = active) {
      capture();
      const source = tabs[index];
      if (!source) return;
      // Through the loader, so the copy is a separate document rather than a
      // second reference to the same arrays.
      const copy = normalizeDoc(JSON.parse(serializeDoc(source.doc))).doc;
      tabs.splice(index + 1, 0, { name: `${source.name} copy`, doc: copy });
      show(index + 1);
    },

    rename(index, name) {
      const tab = tabs[index];
      if (!tab) return;
      // Through the loader's own rule, so a name typed here and a name read
      // from a file are bounded by one thing rather than by two.
      tab.name = tabNameFrom(name, index);
      announce();
    },

    /**
     * Delete one, never the last, and hand it back.
     *
     * A file with no drawings in it is not a state worth being able to reach:
     * emptying the only tab is what New is for, and it says so.
     *
     * What comes back is the whole drawing, history included, which is what
     * makes `insert` an undo for this rather than an approximation of one.
     *
     * @returns {{name: string, doc: object}|null} the deleted tab, or null
     */
    remove(index) {
      if (tabs.length <= 1 || index < 0 || index >= tabs.length) return null;
      capture();
      const closingTheOpenOne = index === active;
      const [gone] = tabs.splice(index, 1);

      // Closing a drawing you were not looking at changes nothing on screen, so
      // the document and its history are left exactly as they are.
      if (!closingTheOpenOne) {
        if (index < active) active -= 1;
        announce();
        return gone;
      }

      // `null`, so the deleted tab's history goes with it rather than being
      // handed to whichever tab takes its place — undoing into a drawing that
      // no longer exists would replace the one that does.
      gone.history = store.detachHistory();
      show(Math.min(index, tabs.length - 1), null);
      return gone;
    },

    /**
     * Move a drawing along the strip.
     *
     * Nothing about the document changes and neither does what is on screen —
     * only where its tab sits — so this never touches the store and never
     * costs an undo entry. `active` is an index into a list that just moved,
     * so it is chased across rather than left pointing at whatever slid into
     * its place.
     */
    move(from, to) {
      const last = tabs.length - 1;
      if (from < 0 || from > last || to < 0 || to > last || from === to) return false;
      capture();
      const [moved] = tabs.splice(from, 1);
      tabs.splice(to, 0, moved);
      if (active === from) active = to;
      else if (from < active && to >= active) active -= 1;
      else if (from > active && to <= active) active += 1;
      announce();
      return true;
    },

    /** Put a deleted tab back where it was, and show it. */
    insert(index, tab) {
      if (!tab) return;
      capture();
      const at = Math.max(0, Math.min(index, tabs.length));
      tabs.splice(at, 0, tab);
      if (at <= active) active += 1;
      show(at);
    },
  };
}
