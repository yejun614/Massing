/**
 * Raster and vector export.
 *
 * Both formats come from the same source: a clone of the live scene, cropped
 * to the content rather than the viewport, with the scene stylesheet inlined
 * so the file stands on its own. Nothing is re-drawn for export, so what is
 * saved is exactly what is on screen.
 */

import { slugify } from './schema.js';
import { round2 } from '../util/num.js';
import { downloadBlob } from '../util/dom.js';
import { describeError } from '../util/errors.js';

const PADDING = 40; // scene units around the content
const PNG_SCALE = 2; // retina-ish raster output

export function createExporter({ store, scene, toaster }) {
  /** A standalone SVG string of the current diagram. */
  function buildSvg() {
    const box = scene.contentBox(PADDING);
    if (!box) {
      toaster?.error('Nothing to export yet.');
      return null;
    }

    const clone = scene.el.cloneNode(true);
    clone.removeAttribute('style');
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', Math.round(box.width));
    clone.setAttribute('height', Math.round(box.height));
    clone.setAttribute('viewBox', `${round2(box.x)} ${round2(box.y)} ${round2(box.width)} ${round2(box.height)}`);

    // The camera transform is replaced by the viewBox crop.
    clone.querySelector('.scene-root')?.removeAttribute('transform');
    clone.querySelector('.grid')?.remove();
    clone.querySelector('.layer-overlay')?.remove();
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
    return new XMLSerializer().serializeToString(clone);
  }

  function fileBase() {
    return slugify(store.state.doc.meta.title || 'diagram');
  }

  function svg() {
    const text = buildSvg();
    if (!text) return;
    downloadBlob(new Blob([text], { type: 'image/svg+xml' }), `${fileBase()}.svg`);
    toaster?.info('Exported SVG.');
  }

  async function png() {
    const text = buildSvg();
    if (!text) return;
    try {
      const blob = await rasterize(text, PNG_SCALE);
      downloadBlob(blob, `${fileBase()}.png`);
      toaster?.info('Exported PNG.');
    } catch (err) {
      toaster?.error(`PNG export failed: ${err.message}`, { detail: describeError(err) });
    }
  }

  return { svg, png, buildSvg };
}

/**
 * The scene stylesheet, marked in the page with `data-scene-styles` so this
 * works both for the linked file and for the inlined single-file bundle.
 */
function sceneStyles() {
  const node = document.querySelector('[data-scene-styles]');
  const sheet = node?.sheet;
  if (!sheet) return '';
  try {
    return [...sheet.cssRules].map((rule) => rule.cssText).join('\n');
  } catch {
    return ''; // cross-origin stylesheet; export still works, just unstyled
  }
}

function rasterize(svgText, scale) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(image, 0, 0);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas produced no data'))), 'image/png');
    };
    image.onerror = () => reject(new Error('the browser could not render the SVG'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  });
}

