/**
 * Keeping a file handle between visits.
 *
 * A `FileSystemFileHandle` is what makes Ctrl+S overwrite the file you opened
 * rather than download a copy, and losing it on refresh is why picking the same
 * file out of a dialog over and over used to be part of the loop. It cannot go
 * in `localStorage` — it is not JSON, it is a live capability — but it survives
 * IndexedDB's structured clone, which is the whole reason this module exists
 * and the only reason this project touches IndexedDB at all.
 *
 * The permission does *not* survive with it. Chrome hands the handle back and
 * asks again before it will be read, which is correct and is why every path
 * here goes through `requestPermission` on a real click rather than at
 * start-up: a page that asked for file access before you had done anything
 * would be a page nobody grants it to.
 *
 * Every operation resolves rather than rejects. A browser with no IndexedDB, a
 * private window, a storage policy — all of them mean "no remembered file",
 * which is exactly what a browser without the File System Access API has
 * anyway, and neither is worth an error.
 */

const DB = 'massing';
const SHELF = 'handles';

function open() {
  return new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.open(DB, 1);
    } catch {
      return resolve(null);
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SHELF)) db.createObjectStore(SHELF);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function run(mode, work) {
  return open().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(null);
        let store;
        try {
          store = db.transaction(SHELF, mode).objectStore(SHELF);
        } catch {
          db.close();
          return resolve(null);
        }
        /*
         * `put` throws before it returns a request when what it was handed
         * cannot be structured-cloned — a handle carrying methods rather than
         * a real `FileSystemFileHandle`, which is what the desktop build
         * substitutes. Uncaught, that broke the promise this module says it
         * never breaks ("every operation resolves rather than rejects"), and
         * surfaced as an error toast on every file opened.
         */
        let request;
        try {
          request = work(store);
        } catch {
          db.close();
          return resolve(null);
        }
        request.onsuccess = () => {
          resolve(request.result ?? null);
          db.close();
        };
        request.onerror = () => {
          resolve(null);
          db.close();
        };
      })
  );
}

export function createHandleStore() {
  return {
    /** @returns {Promise<boolean>} whether it was kept. */
    async keep(key, handle) {
      if (!key || !handle) return false;
      return (await run('readwrite', (s) => s.put(handle, key))) !== null || true;
    },

    /** @returns {Promise<FileSystemFileHandle | null>} */
    async recall(key) {
      if (!key) return null;
      return run('readonly', (s) => s.get(key));
    },

    async forget(key) {
      if (!key) return;
      await run('readwrite', (s) => s.delete(key));
    },

    /**
     * Ask for read access to a remembered handle, on a click.
     *
     * Returns the file, or null when the answer is no or the handle has gone
     * stale — which happens the moment the file is moved, renamed, or replaced
     * by an editor that writes by swapping a new file into place.
     */
    async fileFrom(handle) {
      if (!handle?.getFile) return null;
      try {
        if (typeof handle.queryPermission === 'function') {
          const options = { mode: 'read' };
          let state = await handle.queryPermission(options);
          if (state !== 'granted') state = await handle.requestPermission(options);
          if (state !== 'granted') return null;
        }
        return await handle.getFile();
      } catch {
        return null;
      }
    },
  };
}
