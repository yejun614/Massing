/**
 * Export options, in a native `<dialog>`.
 *
 * The choices are remembered between openings, because exporting a diagram is
 * something people do repeatedly while iterating on it and re-picking PNG at
 * 2× every time is friction with no upside.
 *
 * The pixel size is measured for real -- by rendering the scene the way the
 * export would and asking how big the content came out -- rather than
 * estimated, so the number under the controls is the number in the file.
 *
 * So is the preview. It is encoded through the same path the export takes and
 * shown as an image, rather than being a live copy of the canvas: the grid and
 * the projection would look right either way, but GIF's 256 colours happen in
 * the encoder, and a preview that skipped that would misrepresent the one
 * format whose output actually surprises people.
 */

import { h, clear, setText, setClass } from '../util/dom.js';
import {
  EXPORT_SCALES,
  DEFAULT_EXPORT,
  formatFor,
  supportedFormats,
} from '../core/export.js';

const STORAGE_KEY = 'massing:export:v1';

export function createExportDialog(root, { store, exporter, onExported }) {
  const settings = { ...DEFAULT_EXPORT, ...read() };
  const formats = supportedFormats();
  if (!formats.some((f) => f.id === settings.format)) settings.format = DEFAULT_EXPORT.format;

  const dialog = h('dialog', { class: 'sheet sheet-form' });
  const formatButtons = formats.map((f) =>
    h('button', {
      class: 'chip',
      type: 'button',
      title: f.hint,
      text: f.label,
      onClick: () => set({ format: f.id }),
    })
  );
  const scaleButtons = EXPORT_SCALES.map((s) =>
    h('button', {
      class: 'chip',
      type: 'button',
      text: `${s}×`,
      onClick: () => set({ scale: s }),
    })
  );
  const modeButtons = [
    ['iso', 'Isometric'],
    ['flat', '2D'],
  ].map(([id, label]) =>
    h('button', {
      class: 'chip',
      type: 'button',
      text: label,
      onClick: () => set({ mode: id }),
    })
  );

  const gridBox = h('input', {
    type: 'checkbox',
    onChange: (e) => set({ grid: e.target.checked }),
  });
  const hint = h('p', { class: 'panel-hint' });
  const size = h('div', { class: 'export-size' });
  const shot = h('img', { class: 'export-shot', alt: '' });
  const note = h('span', { class: 'export-note' });
  // A fixed frame: the preview changes shape with the projection, and a sheet
  // that jumps as you compare two options is a sheet you cannot compare in.
  const preview = h('div', { class: 'export-preview' }, [shot, note]);
  const scaleRow = optionRow('Scale', h('div', { class: 'chips' }, scaleButtons));

  const exportBtn = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    // `showModal` focuses the first focusable thing otherwise, which puts a
    // ring on whichever format happens to be listed first. Focusing the action
    // instead also means Ctrl+E, Enter exports with the remembered settings.
    autofocus: true,
    text: 'Export',
    onClick: async () => {
      dialog.close();
      // Only on a real export. A failed one has already put an error on screen,
      // and following it with a request for feedback would be a joke.
      if (await exporter.run(effective())) onExported?.();
    },
  });

  clear(dialog).append(
    h('h2', { class: 'sheet-title', text: 'Export image' }),
    preview,
    optionRow('Format', h('div', { class: 'chips' }, formatButtons)),
    hint,
    optionRow('View', h('div', { class: 'chips' }, modeButtons)),
    optionRow('Grid', h('label', { class: 'checkbox-row' }, [gridBox, h('span', { text: 'Draw the ground grid behind the diagram' })])),
    scaleRow,
    size,
    h('div', { class: 'sheet-actions' }, [
      h('button', { class: 'btn', type: 'button', text: 'Cancel', onClick: () => dialog.close() }),
      exportBtn,
    ])
  );

  // A blob URL outlives the element that pointed at it, so let it go.
  dialog.addEventListener('close', () => {
    token++;
    drop();
  });
  root.append(dialog);

  /** The settings as the exporter will see them, with `mode` resolved. */
  function effective() {
    return { ...settings, mode: settings.mode ?? store.state.camera.mode };
  }

  function set(patch) {
    Object.assign(settings, patch);
    write(settings);
    paint();
  }

  function paint() {
    const format = formatFor(settings.format);
    const mode = settings.mode ?? store.state.camera.mode;

    formats.forEach((f, i) => setClass(formatButtons[i], 'is-active', f.id === settings.format));
    EXPORT_SCALES.forEach((s, i) => setClass(scaleButtons[i], 'is-active', s === settings.scale));
    ['iso', 'flat'].forEach((id, i) => setClass(modeButtons[i], 'is-active', id === mode));

    setText(hint, format.hint);
    gridBox.checked = settings.grid;

    // Scale is a raster idea. SVG has no pixels to multiply, so the row goes
    // away rather than sitting there disabled and inviting a click.
    setClass(scaleRow, 'is-hidden', !format.raster);

    const measured = exporter.measure(effective());
    if (!measured) setText(size, 'Nothing to export yet.');
    else if (format.raster) {
      setText(size, `${measured.width} × ${measured.height} px`);
    } else {
      setText(size, `${measured.width} × ${measured.height} px, and scales without loss`);
    }
    exportBtn.disabled = !measured;
    repaint(measured ? effective() : null);
  }

  /**
   * Redraw the preview, discarding anything already in flight.
   *
   * Encoding is asynchronous and clicking through the formats is not, so
   * without the token a slow GIF started three clicks ago can land after the
   * PNG that replaced it and leave the sheet showing the wrong picture.
   */
  let token = 0;
  let shown = null;
  async function repaint(options) {
    const mine = ++token;
    if (!options) {
      setText(note, 'Nothing to export yet.');
      return drop();
    }

    // The picture already on screen stays until its replacement is ready, so
    // switching between two options does not blink through an empty frame.
    // The first one has nothing to keep, and can be slow enough to need
    // saying so: rasterising waits for the webfont, which on a cold load is
    // most of a second. Waiting is right -- an export must not be set in the
    // fallback face -- but a blank rectangle for a second is not.
    setText(note, 'Rendering…');
    setClass(preview, 'is-loading', true);

    let made = null;
    try {
      made = await exporter.preview(options);
    } catch {
      made = null; // an encoder that refused; the sheet still says the size
    }
    if (mine !== token) {
      if (made?.revoke) URL.revokeObjectURL(made.url);
      return;
    }

    setClass(preview, 'is-loading', false);
    if (!made) {
      setText(note, 'This one could not be drawn.');
      return drop();
    }
    if (shown?.revoke) URL.revokeObjectURL(shown.url);
    shown = made;
    shot.src = made.url;
    setClass(preview, 'has-shot', true);
  }

  function drop() {
    if (shown?.revoke) URL.revokeObjectURL(shown.url);
    shown = null;
    shot.removeAttribute('src');
    setClass(preview, 'has-shot', false);
    setClass(preview, 'is-loading', false);
  }

  return {
    open() {
      paint();
      dialog.showModal();
    },
  };
}

function optionRow(label, control) {
  return h('div', { class: 'field' }, [h('label', { text: label }), control]);
}

function read() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
  } catch {
    return {};
  }
}

function write(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage full or disabled: the choices simply do not outlive the session.
  }
}
