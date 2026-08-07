/**
 * File input and output.
 *
 * There is no server, so "the file" is a real file on the user's disk. Where
 * the File System Access API exists we keep the handle and Ctrl+S overwrites
 * in place, which is what makes the editor usable alongside a text editor and
 * a language model working on the same `.arch.json`. Elsewhere we fall back to
 * a download plus a file input.
 *
 * A debounced copy also goes to localStorage, purely so an accidental refresh
 * is not a data loss event. It is a safety net, never the source of truth.
 */

import { parseDoc, serializeDoc, slugify, FILE_EXTENSION } from './schema.js';
import { downloadBlob, copyText } from '../util/dom.js';
import { describeError, describeParseFailure } from '../util/errors.js';
import { importImageFile, isImageFile } from './images.js';
import { makeImage } from './doc.js';

const AUTOSAVE_KEY = 'massing:autosave:v1';
const AUTOSAVE_DELAY = 700;
const PICKER_TYPES = [
  { description: 'Massing diagram', accept: { 'application/json': ['.json'] } },
];

/**
 * Whether writing straight back to a file on disk is actually possible.
 *
 * Testing for `showSaveFilePicker` is not enough. On a `file://` page Chrome
 * exposes the whole API and even opens the picker, but the origin is opaque,
 * so `createWritable` then fails with NotAllowedError -- after the user has
 * already chosen a filename. Since the single-file bundle is meant to be
 * opened from disk, that path has to be ruled out up front.
 */
function canWriteToDisk() {
  return typeof window.showSaveFilePicker === 'function' && location.protocol !== 'file:';
}

/**
 * A refusal that will happen again no matter how many times we retry: an
 * enterprise policy, a sandboxed context, an origin the API will not serve.
 * Distinct from the user simply declining or cancelling.
 */
function isPlatformRefusal(err) {
  return err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
}

export function createIO({ store, toaster }) {
  /**
   * Not a constant: some browsers expose the whole File System Access API and
   * only refuse at the moment of use. Once that happens there is no point
   * asking again, so the capability is retired for the session and every later
   * open and save goes straight to the paths that do work.
   */
  let fsAvailable = canWriteToDisk();
  let handle = null;
  let autosaveTimer = 0;

  function fileName() {
    return slugify(store.state.doc.meta.title || 'diagram') + FILE_EXTENSION;
  }

  // --- writing -------------------------------------------------------------

  /**
   * Save, whatever it takes. Writing through a kept file handle is the good
   * path -- it is what makes Ctrl+S overwrite in place next to a text editor --
   * but a save request must never end with the user still holding unsaved
   * work, so anything short of an outright cancel falls back to a download.
   */
  async function save({ saveAs = false } = {}) {
    const text = serializeDoc(store.state.doc);

    if (fsAvailable) {
      const outcome = await writeThroughHandle(text, saveAs);
      if (outcome === 'saved') return true;
      if (outcome === 'cancelled') return false;
    }

    downloadBlob(new Blob([text], { type: 'application/json' }), fileName());
    store.markSaved();
    toaster?.info(`Downloaded ${fileName()}`);
    return true;
  }

  /** @returns {Promise<'saved' | 'cancelled' | 'blocked'>} */
  async function writeThroughHandle(text, saveAs) {
    try {
      if (!handle || saveAs) {
        // A handle straight from the picker already carries write permission;
        // asking again here would consume nothing and can only go wrong.
        handle = await window.showSaveFilePicker({
          suggestedName: fileName(),
          types: PICKER_TYPES,
        });
      } else if (!(await ensureWritePermission(handle))) {
        // This is the case re-asking exists for: a handle kept from an earlier
        // save, whose permission Chrome has since dropped.
        handle = null;
        toaster?.warn('Write access to that file has lapsed; downloading a copy instead.');
        return 'blocked';
      }

      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      store.markSaved();
      toaster?.info(`Saved ${handle.name}`);
      return 'saved';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
      handle = null;
      if (isPlatformRefusal(err)) {
        // Retire the API rather than re-prompt on every future save.
        fsAvailable = false;
        toaster?.warn(
          'This browser will not let the page write files directly. Saving downloads a copy instead.',
          { detail: describeError(err), copyable: true }
        );
      } else {
        toaster?.warn(`Could not write to the file (${err.name}); downloading a copy instead.`, {
          detail: describeError(err),
          copyable: true,
        });
      }
      return 'blocked';
    }
  }

  /**
   * Re-assert write permission on a handle kept from an earlier save. Chrome
   * grants it implicitly when the picker returns but drops it again later,
   * which is how a working Ctrl+S turns into NotAllowedError several saves in.
   *
   * Only ever call this on a stored handle. On a freshly picked one the answer
   * is already yes, and `requestPermission` would need the user activation the
   * picker has just consumed.
   */
  async function ensureWritePermission(target) {
    if (typeof target.queryPermission !== 'function') return true;
    const options = { mode: 'readwrite' };
    if ((await target.queryPermission(options)) === 'granted') return true;
    return (await target.requestPermission(options)) === 'granted';
  }

  // --- reading -------------------------------------------------------------

  /**
   * Open a diagram.
   *
   * The one rule here is that a single click produces a single dialog. Falling
   * back to the plain file input is only correct while nothing has been chosen
   * yet; once the user has picked a file, a failure is something to report, not
   * a reason to ask them to pick it all over again.
   */
  async function open() {
    if (fsAvailable) {
      const outcome = await openThroughPicker();
      if (outcome !== 'no-picker') return;
    }
    openThroughInput();
  }

  /**
   * @returns {Promise<'opened' | 'settled' | 'no-picker'>}
   *   'settled' covers cancelled and reported-failure alike: either way the
   *   user has had their dialog and must not be shown a second one.
   */
  async function openThroughPicker() {
    let picked;
    try {
      [picked] = await window.showOpenFilePicker({ types: PICKER_TYPES });
    } catch (err) {
      if (err?.name === 'AbortError') return 'settled';
      // The picker never opened, so nothing was lost and no dialog was seen.
      return 'no-picker';
    }

    try {
      // No permission check here on purpose. A handle straight from the picker
      // is already readable, and `requestPermission` needs transient user
      // activation that the picker has just consumed -- asking would fail for
      // no reason and send us into a second dialog.
      const file = await picked.getFile();
      handle = picked;
      await loadFile(file);
      return 'opened';
    } catch (err) {
      handle = null; // unreadable through this handle means unwritable too
      if (err?.name === 'AbortError') return 'settled';

      if (isPlatformRefusal(err)) {
        // The browser hands out handles it will not honour. Give up on them
        // for good and let the caller fall through to the standard picker, so
        // this click still opens a file and no later click sees two dialogs.
        fsAvailable = false;
        toaster?.warn(
          'This browser blocked direct file access. Using the standard file picker instead.',
          { detail: describeError(err), copyable: true }
        );
        return 'no-picker';
      }

      toaster?.error(`Could not read that file (${err.name}). Drag it onto the canvas instead.`, {
        detail: describeError(err),
      });
      return 'settled';
    }
  }

  function openThroughInput() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      handle = null; // chosen this way, there is no handle to save back through
      loadFile(file);
    });
    input.click();
  }

  async function loadFile(file) {
    try {
      loadText(await file.text(), file.name);
    } catch (err) {
      toaster?.error(`Could not read ${file.name}: ${err.message}`, { detail: describeError(err) });
    }
  }

  /** Replace the document from raw text. Returns false on unparseable JSON. */
  function loadText(text, sourceName = 'document') {
    let result;
    try {
      result = parseDoc(text);
    } catch (err) {
      toaster?.error(`${sourceName} is not valid JSON: ${err.message}`, {
        detail: describeParseFailure(sourceName, err, text),
      });
      return false;
    }
    store.replaceDoc(result.doc, 'Open', { markSaved: true });
    toaster?.warnings(result.warnings);
    if (!result.warnings.length) toaster?.info(`Opened ${sourceName}`);
    return true;
  }

  // --- pictures ------------------------------------------------------------

  /**
   * Embed a picture into the document at `cell`.
   *
   * The bytes go into the `.arch.json` as a data URL, because a diagram that
   * references a file on someone's disk is a diagram that breaks the moment it
   * is shared. That cost is real, so the size is reported when it is large.
   */
  async function insertImage(file, cell = { x: 0, y: 0 }) {
    try {
      const imported = await importImageFile(file);
      let newId = null;
      store.commit('Add picture', (doc) => {
        const image = makeImage(doc, cell.x, cell.y, {
          id: imported.name,
          src: imported.src,
          label: imported.name,
          size: imported.size,
        });
        doc.images.push(image);
        newId = image.id;
      });
      if (newId) store.select(newId);
      if (imported.warning) toaster?.warn(imported.warning);
      else toaster?.info(`Added ${file.name}.`);
      return true;
    } catch (err) {
      toaster?.error(err.message, { detail: describeError(err) });
      return false;
    }
  }

  /** Prompt for an image file and place it at the given cell. */
  function pickImage(cell) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) insertImage(file, cell);
    });
    input.click();
  }

  // --- drag and drop -------------------------------------------------------

  function attachDropZone(el, dropCell) {
    const stop = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    el.addEventListener('dragover', (e) => {
      stop(e);
      e.dataTransfer.dropEffect = 'copy';
      el.classList.add('is-drop-target');
    });
    el.addEventListener('dragleave', () => el.classList.remove('is-drop-target'));
    el.addEventListener('drop', (e) => {
      stop(e);
      el.classList.remove('is-drop-target');
      const file = e.dataTransfer?.files?.[0];
      if (file) {
        // A dropped picture joins the diagram; a dropped document replaces it.
        if (isImageFile(file)) {
          insertImage(file, dropCell?.(e) ?? { x: 0, y: 0 });
          return;
        }
        handle = null; // a dropped file has no writable handle
        loadFile(file);
        return;
      }
      const text = e.dataTransfer?.getData('text/plain');
      if (text?.trim().startsWith('{')) loadText(text, 'dropped text');
    });
  }

  // --- autosave ------------------------------------------------------------

  function startAutosave() {
    store.subscribe((state, what) => {
      if (what !== 'doc') return;
      clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(() => {
        try {
          localStorage.setItem(
            AUTOSAVE_KEY,
            JSON.stringify({ at: Date.now(), text: serializeDoc(state.doc) })
          );
        } catch {
          // Quota exceeded or storage disabled -- autosave is optional.
        }
      }, AUTOSAVE_DELAY);
    });
  }

  /** @returns {{at: number, text: string} | null} */
  function readAutosave() {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function clearAutosave() {
    try {
      localStorage.removeItem(AUTOSAVE_KEY);
    } catch {
      /* ignore */
    }
  }

  // --- clipboard-style helpers --------------------------------------------

  async function copyDocumentJson() {
    const text = serializeDoc(store.state.doc);
    if (await copyText(text)) toaster?.info('Diagram JSON copied to the clipboard.');
    else toaster?.error('Clipboard access was blocked by the browser.', { detail: text });
  }

  return {
    insertImage,
    pickImage,
    save,
    open,
    loadFile,
    loadText,
    attachDropZone,
    startAutosave,
    readAutosave,
    clearAutosave,
    copyDocumentJson,
    fileName,
    get hasHandle() {
      return handle !== null;
    },
  };
}
