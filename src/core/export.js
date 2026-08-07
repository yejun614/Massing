/**
 * Raster and vector export.
 *
 * Everything comes from one source: a clone of the live scene, cropped to the
 * content rather than the viewport, with the scene stylesheet inlined so the
 * file stands on its own. Nothing is drawn a second way for export, so what is
 * saved is what was on screen.
 *
 * "What was on screen" is negotiable in three ways, though -- the projection,
 * the grid, and how many pixels a raster gets -- and each is handled by
 * rendering the scene again with a different state rather than by patching the
 * output. `scene.render` takes the state it draws, so an export can hand it a
 * camera that is not the user's without the user's camera ever moving.
 */

import { slugify } from './schema.js';
import { round2 } from '../util/num.js';
import { downloadBlob } from '../util/dom.js';
import { describeError } from '../util/errors.js';
import { encodeGif, GIF_MAX_SIDE } from './gif.js';

const PADDING = 40; // scene units around the content
/** Chrome refuses to allocate a canvas past this on a side. */
const MAX_CANVAS_SIDE = 16384;

/**
 * What can be written, in the order the dialog offers it.
 *
 * `mime` is what `canvas.toBlob` is asked for; a null mime means the format is
 * produced here rather than by the browser.
 */
export const EXPORT_FORMATS = [
  { id: 'svg', label: 'SVG', extension: 'svg', mime: null, raster: false,
    hint: 'Vector. Sharp at any size, and still editable.' },
  { id: 'png', label: 'PNG', extension: 'png', mime: 'image/png', raster: true,
    hint: 'Lossless, with transparency. The safe default for a diagram.' },
  { id: 'jpg', label: 'JPG', extension: 'jpg', mime: 'image/jpeg', raster: true,
    hint: 'Lossy and opaque. Smaller, but text edges soften.' },
  { id: 'webp', label: 'WebP', extension: 'webp', mime: 'image/webp', raster: true,
    hint: 'Lossless and smaller than PNG, where it is supported.' },
  { id: 'gif', label: 'GIF', extension: 'gif', mime: null, raster: true,
    hint: 'Only 256 colours, so gradients band. Prefer PNG unless something insists on GIF.' },
];

export const EXPORT_SCALES = [1, 2, 3, 4];

export const DEFAULT_EXPORT = {
  format: 'png',
  scale: 2,
  grid: false,
  mode: null, // null means "however the camera is pointing right now"
};

export function formatFor(id) {
  return EXPORT_FORMATS.find((f) => f.id === id) ?? EXPORT_FORMATS[1];
}

/**
 * Which raster types this browser will actually encode.
 *
 * Worth asking, because `toBlob` does not fail on a type it does not know --
 * it quietly returns a PNG. Offering WebP where it is unsupported would hand
 * someone a PNG named `.webp`.
 */
export function supportedFormats() {
  const probe = document.createElement('canvas');
  probe.width = 1;
  probe.height = 1;
  return EXPORT_FORMATS.filter((f) => {
    if (!f.mime || f.mime === 'image/png') return true;
    try {
      return probe.toDataURL(f.mime).startsWith(`data:${f.mime}`);
    } catch {
      return false;
    }
  });
}

export function createExporter({ store, scene, toaster }) {
  /**
   * Draw the scene as the export wants it, and measure the result.
   *
   * The camera's pan and zoom are replaced so that scene coordinates and
   * export pixels are the same thing, which is what lets the grid be generated
   * over exactly the crop. Only the grid and the (discarded) root transform
   * read those fields, so the drawing itself is untouched by the swap.
   */
  function renderForExport({ grid = false, mode = null } = {}) {
    const state = store.state;
    const camera = { ...state.camera, mode: mode ?? state.camera.mode };
    // Selection highlights and the hover cell belong to the session, not to
    // the picture.
    const clean = { ...state, camera, selection: [], hoverId: null, hover: null };

    scene.render(clean);
    const box = scene.contentBox(PADDING);
    if (!box || !grid) return box;

    scene.render(
      { ...clean, camera: { ...camera, zoom: 1, tx: -box.x, ty: -box.y } },
      { viewport: { width: box.width, height: box.height } }
    );
    return box;
  }

  /** A standalone SVG string of the current diagram. */
  function buildSvg(options = {}) {
    const box = renderForExport(options);
    if (!box) {
      toaster?.error('Nothing to export yet.');
      restore();
      return null;
    }

    const clone = scene.el.cloneNode(true);
    restore();

    clone.removeAttribute('style');
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', Math.round(box.width));
    clone.setAttribute('height', Math.round(box.height));
    clone.setAttribute('viewBox', `${round2(box.x)} ${round2(box.y)} ${round2(box.width)} ${round2(box.height)}`);

    // The camera transform is replaced by the viewBox crop.
    clone.querySelector('.scene-root')?.removeAttribute('transform');
    if (!options.grid) clone.querySelector('.grid')?.remove();
    // The hover diamond is a cursor, never part of the drawing, even when the
    // grid under it is wanted.
    clone.querySelector('.grid-cursor')?.remove();
    clone.querySelector('.layer-overlay')?.remove();
    clone.querySelector('.layer-handles')?.remove();
    for (const marker of clone.querySelectorAll('.is-selected, .is-hovered')) {
      marker.classList.remove('is-selected', 'is-hovered');
    }

    const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    background.setAttribute('x', round2(box.x));
    background.setAttribute('y', round2(box.y));
    background.setAttribute('width', round2(box.width));
    background.setAttribute('height', round2(box.height));
    background.setAttribute('fill', store.state.doc.canvas.background);

    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = sceneStyles();

    clone.prepend(background);
    clone.prepend(style);
    return { text: new XMLSerializer().serializeToString(clone), box };
  }

  /** Put the user's own view back, whatever the export just did to the scene. */
  function restore() {
    scene.render(store.state);
  }

  function fileBase() {
    return slugify(store.state.doc.meta.title || 'diagram');
  }

  /** Pixel size a raster export would come out at, for the dialog to show. */
  function measure(options = {}) {
    const box = renderForExport({ ...options, grid: false });
    restore();
    if (!box) return null;
    const scale = options.scale ?? DEFAULT_EXPORT.scale;
    return {
      width: Math.round(box.width * (formatFor(options.format).raster ? scale : 1)),
      height: Math.round(box.height * (formatFor(options.format).raster ? scale : 1)),
    };
  }

  async function run(options = {}) {
    const settings = { ...DEFAULT_EXPORT, ...options };
    const format = formatFor(settings.format);
    const built = buildSvg(settings);
    if (!built) return false;

    const name = `${fileBase()}.${format.extension}`;
    if (!format.raster) {
      downloadBlob(new Blob([built.text], { type: 'image/svg+xml' }), name);
      toaster?.info(`Exported ${name}.`);
      return true;
    }

    const width = Math.round(built.box.width * settings.scale);
    const height = Math.round(built.box.height * settings.scale);
    if (width > MAX_CANVAS_SIDE || height > MAX_CANVAS_SIDE) {
      toaster?.error(
        `${width}×${height} px is past what a browser canvas can hold. Try a smaller scale.`
      );
      return false;
    }
    if (format.id === 'gif' && (width > GIF_MAX_SIDE || height > GIF_MAX_SIDE)) {
      toaster?.error(`GIF cannot hold ${width}×${height} px. Try a smaller scale, or PNG.`);
      return false;
    }

    try {
      const canvas = await rasterize(built.text, width, height, store.state.doc.canvas.background);
      const blob = format.id === 'gif' ? gifBlob(canvas) : await canvasBlob(canvas, format.mime);
      downloadBlob(blob, name);
      toaster?.info(`Exported ${name} at ${width}×${height}.`);
      return true;
    } catch (err) {
      toaster?.error(`${format.label} export failed: ${err.message}`, { detail: describeError(err) });
      return false;
    }
  }

  return {
    run,
    measure,
    buildSvg: (options) => buildSvg(options)?.text ?? null,
    // Kept so a quick PNG or SVG is still one call from the console or a test.
    svg: () => run({ format: 'svg' }),
    png: () => run({ format: 'png' }),
  };
}

/**
 * The scene stylesheet, marked in the page with `data-scene-styles` so this
 * works both for the linked file and for the inlined single-file bundle.
 *
 * With one edit: `vector-effect: non-scaling-stroke` comes out. On screen it
 * earns its place -- outlines and grid lines must not fatten as the camera
 * zooms in. An exported picture has no camera, and the rule turns the scale
 * setting into a lie: it pins every stroke to the same device pixel whatever
 * size is asked for, so a 4× export draws four times the detail behind lines a
 * quarter as thick. Measured on the sample, the grid falls from 9.8% of the
 * image to 2.5% between 1× and 4×. Without the rule a 4× export is what it
 * says it is -- the same picture, four times the size.
 */
function sceneStyles() {
  const node = document.querySelector('[data-scene-styles]');
  const sheet = node?.sheet;
  if (!sheet) return '';
  try {
    return [...sheet.cssRules]
      .map((rule) => rule.cssText)
      .join('\n')
      .replace(/\s*vector-effect:\s*non-scaling-stroke;?/g, '');
  } catch {
    return ''; // cross-origin stylesheet; export still works, just unstyled
  }
}

/**
 * Draw the SVG onto a canvas at an exact pixel size.
 *
 * The background is painted underneath rather than relied upon from the SVG,
 * because a format with no alpha -- JPG, or GIF's single transparent index --
 * would otherwise composite the diagram onto black.
 */
function rasterize(svgText, width, height, background) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);
      resolve(canvas);
    };
    image.onerror = () => reject(new Error('the browser could not render the SVG'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  });
}

function canvasBlob(canvas, mime) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('the canvas produced no data'))),
      mime,
      0.92
    );
  });
}

function gifBlob(canvas) {
  const { width, height } = canvas;
  const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  return new Blob([encodeGif(pixels, width, height)], { type: 'image/gif' });
}
