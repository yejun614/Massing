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
 */

import { h, clear, setText, setClass } from '../util/dom.js';
import {
  EXPORT_SCALES,
  DEFAULT_EXPORT,
  formatFor,
  supportedFormats,
} from '../core/export.js';

const STORAGE_KEY = 'massing:export:v1';

export function createExportDialog(root, { store, exporter }) {
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
      await exporter.run(effective());
    },
  });

  clear(dialog).append(
    h('h2', { class: 'sheet-title', text: 'Export image' }),
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

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
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
