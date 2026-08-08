/**
 * Every diagram this browser has worked on.
 *
 * One record per diagram, holding whatever is known about where it lives: the
 * text itself, the file it came from, the link it was published to, and the
 * conversations held about it. That is the whole point — a diagram is usually
 * several of those at once, and keeping them in four unrelated places is what
 * makes reopening one a matter of remembering which.
 *
 * The hard constraint is space. `localStorage` is about five megabytes for the
 * whole origin, shared with the chat sessions and the export settings, and a
 * diagram with a screenshot pasted into it is megabytes on its own. So this
 * keeps a budget, evicts by age, and — importantly — an entry whose text has
 * been evicted is still an entry: it remembers the file and the published link,
 * which are the two ways to get the document back. Losing the shortcut is fine.
 * Losing the record that a diagram exists is not.
 */

import { serializeDoc, parseDoc } from './schema.js';

const LIBRARY_KEY = 'massing:library:v1';

/**
 * What the library may occupy, and how much of it one diagram may take.
 *
 * Two megabytes leaves room for the chat sessions in the same five, and 512 kB
 * per diagram covers everything but pasted images — which are exactly what
 * should not be sitting in a list of recent files.
 */
export const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
export const MAX_ENTRY_BYTES = 512 * 1024;
export const MAX_ENTRIES = 40;

const now = () => Date.now();

function newEntryId() {
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Reading and writing
// ---------------------------------------------------------------------------

export function readLibrary(storage = libraryStorage()) {
  try {
    const raw = JSON.parse(storage.getItem(LIBRARY_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((e) => e && typeof e.id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Storage that cannot throw, for the same reason `ui/consent.js` has one:
 * merely reading `localStorage` raises in a few real configurations, and a list
 * of recent diagrams is not worth taking the editor down for.
 */
function libraryStorage() {
  try {
    const probe = window.localStorage;
    probe.getItem(LIBRARY_KEY);
    return probe;
  } catch {
    const memory = new Map();
    return {
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => memory.set(k, v),
      removeItem: (k) => memory.delete(k),
    };
  }
}

/**
 * Fit the list into the budget, newest first.
 *
 * Text is dropped before entries are: an entry that has lost its text still
 * knows the file it came from and the address it was published to, and either
 * will bring the document back. Only once every text is gone does the list
 * itself start to shorten.
 */
export function withinBudget(entries, { total = MAX_TOTAL_BYTES, count = MAX_ENTRIES } = {}) {
  const sorted = [...entries].sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, count);
  const sizeOf = (e) => (e.text ? e.text.length : 0) + 400; // 400 ≈ the rest of the record

  const drop = (i) => {
    used -= sorted[i].text.length;
    sorted[i] = { ...sorted[i], text: null, evicted: true };
  };

  /*
   * Anything past the per-diagram cap loses its text regardless of budget or
   * age, which is the same rule `remember` applies on the way in — one policy
   * rather than two that can disagree.
   *
   * Doing it by age instead would let one screenshot pasted into one diagram
   * evict every other diagram before itself, purely by being the most recently
   * opened, which is the opposite of what a budget is for.
   */
  let used = sorted.reduce((sum, e) => sum + sizeOf(e), 0);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].text && sorted[i].text.length > MAX_ENTRY_BYTES) drop(i);
  }
  if (used <= total) return sorted;

  // Still over: oldest first, dropping the text but keeping the record.
  for (let i = sorted.length - 1; i >= 0 && used > total; i--) {
    if (sorted[i].text) drop(i);
  }
  // Still over: the records themselves have to go.
  while (sorted.length && used > total) {
    used -= sizeOf(sorted.pop());
  }
  return sorted;
}

export function writeLibrary(entries, storage = libraryStorage()) {
  const trimmed = withinBudget(entries);
  try {
    storage.setItem(LIBRARY_KEY, JSON.stringify(trimmed));
    return trimmed;
  } catch {
    // Quota, despite the budget — something else in this origin grew. Halve
    // and try once; failing that the library is simply not saved this time.
    const half = trimmed.slice(0, Math.max(1, Math.floor(trimmed.length / 2)))
      .map((e) => ({ ...e, text: null, evicted: true }));
    try {
      storage.setItem(LIBRARY_KEY, JSON.stringify(half));
      return half;
    } catch {
      return trimmed;
    }
  }
}

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

/**
 * @param {{store: object, files?: object}} deps
 *   `files` persists file handles; absent, entries simply have no file to
 *   reopen, which is what every browser without the File System Access API
 *   gets anyway.
 */
export function createLibrary({ store, files, storage = libraryStorage() } = {}) {
  let entries = readLibrary(storage);
  let currentId = null;
  const listeners = new Set();

  const announce = () => {
    for (const listener of listeners) listener();
  };

  function persist() {
    entries = writeLibrary(entries, storage);
    announce();
  }

  function find(id) {
    return entries.find((e) => e.id === id) ?? null;
  }

  /**
   * Create or update one record.
   *
   * `id` is pulled out of the patch rather than spread with it, which is not
   * fussiness: spreading `{ id: undefined }` over a freshly minted id put it
   * back to undefined, `readLibrary` drops anything without a string id, and the
   * whole library silently failed to survive a reload while looking like it
   * worked.
   */
  function upsert(patch) {
    const { id, ...rest } = patch;
    const at = now();
    const existing = id ? find(id) : null;
    const entryId = existing?.id ?? newEntryId();
    if (existing) Object.assign(existing, rest, { at });
    else entries.unshift({ id: entryId, at, ...rest });
    persist();
    // Eviction rewrites records rather than mutating them, so the object that
    // went in is not necessarily the one now in the list.
    return find(entryId) ?? { id: entryId, at, ...rest };
  }

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get entries() {
      return [...entries].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    },
    get currentId() {
      return currentId;
    },
    get current() {
      return find(currentId);
    },
    find,

    /**
     * Note that this document is now the open one.
     *
     * Called on every save, open and publish rather than continuously: writing
     * the whole library on each keystroke would be the most expensive thing in
     * the editor, and `io.js` already keeps a debounced autosave for the case
     * this does not cover, which is a crash between two saves.
     */
    remember(doc, { source, fileName, handleKey, id } = {}) {
      const text = serializeDoc(doc);
      const entry = upsert({
        id: id ?? currentId ?? undefined,
        title: doc.meta?.title || 'Untitled diagram',
        // Too large to keep is not too large to *have*: the record stays, and
        // the file or the published link is how it comes back.
        text: text.length <= MAX_ENTRY_BYTES ? text : null,
        evicted: text.length > MAX_ENTRY_BYTES,
        bytes: text.length,
        blocks: doc.nodes?.length ?? 0,
        ...(source ? { source } : {}),
        ...(fileName ? { fileName } : {}),
        ...(handleKey ? { handleKey } : {}),
      });
      currentId = entry.id;
      announce();
      return entry;
    },

    /** Start tracking a different diagram, without recording anything yet. */
    setCurrent(id) {
      currentId = id;
      announce();
    },

    /**
     * The next thing recorded is a new diagram, not an edit to the open one.
     *
     * Without this, pressing New and typing a title overwrote the entry for the
     * diagram before it: `remember` updates whatever is current, and after a
     * new document that was still the old one. Every route that swaps the
     * document for an unrelated one has to say so.
     */
    startFresh() {
      currentId = null;
      announce();
    },

    /**
     * The entry holding exactly this text, if any.
     *
     * Used once, on the recovered draft at start-up: the draft and the newest
     * entry are the same document written by two mechanisms, and matching them
     * is what stops a restore from opening as an untitled stranger with none of
     * its conversations.
     */
    matchingText(text) {
      return entries.find((e) => e.text === text) ?? null;
    },

    /**
     * The entry for a file or a published name, if this browser has one.
     *
     * Reopening the same file should land on its own record rather than
     * spawning a second one each time, and it is the file name and the
     * published id — not the contents — that say two documents are the same
     * diagram.
     */
    matching({ fileName, displayId } = {}) {
      if (fileName) {
        const found = entries.find((e) => e.fileName === fileName);
        if (found) return found;
      }
      if (displayId) {
        const found = entries.find((e) => e.published?.displayId === displayId);
        if (found) return found;
      }
      return null;
    },

    /** The document behind an entry, or null when only the record survives. */
    read(id) {
      const entry = find(id);
      if (!entry?.text) return null;
      try {
        return parseDoc(entry.text);
      } catch {
        return null;
      }
    },

    forget(id) {
      entries = entries.filter((e) => e.id !== id);
      if (currentId === id) currentId = null;
      files?.forget?.(id);
      persist();
    },

    /** What came back from `/api/diagrams`, kept so the link can be found again. */
    recordPublish(result) {
      if (!currentId) return null;
      return upsert({
        id: currentId,
        published: {
          displayId: result.displayId,
          shortHash: result.shortHash,
          hash: result.hash,
          url: result.url,
          expiresAt: result.expiresAt ?? null,
          at: now(),
        },
      });
    },

    /**
     * The link is gone — expired, swept, or deleted — so stop offering it.
     *
     * Quietly, because nobody asked: this is discovered while opening
     * something else, and a toast about a link you were not using is noise. The
     * record itself stays, since the document may still be here.
     */
    markPublishGone(id, reason = 'gone') {
      const entry = find(id);
      if (!entry?.published) return;
      entry.published = { ...entry.published, gone: reason, goneAt: now() };
      persist();
    },
  };
}
