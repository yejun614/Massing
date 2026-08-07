/**
 * Bringing a user's picture into the document.
 *
 * There is no server, so an image has to live inside the `.arch.json` as a data
 * URL. That is the only way a diagram stays one file you can email -- but it
 * also means every pixel is paid for in the document, forever, in base64 which
 * costs a third again. So imports are re-encoded down to something sane before
 * they are embedded, and anything still large is reported rather than silently
 * bloating the file.
 *
 * SVG is the exception: it is already small and already resolution
 * independent, so it goes in untouched.
 */

const MAX_EDGE = 1400; // px on the longest side after re-encoding
const WARN_BYTES = 400 * 1024;
const REJECT_BYTES = 6 * 1024 * 1024;
const ACCEPTED = /^image\/(png|jpeg|webp|gif|svg\+xml|avif)$/;

/** Default width in grid cells for a freshly placed picture. */
export const DEFAULT_IMAGE_WIDTH = 6;

export function isImageFile(file) {
  return !!file && ACCEPTED.test(file.type);
}

/**
 * @returns {Promise<{src: string, size: [number, number], name: string,
 *                    bytes: number, warning: string|null}>}
 * @throws {Error} when the file is not an image, or is too big to embed.
 */
export async function importImageFile(file) {
  if (!isImageFile(file)) {
    throw new Error(`${file?.name ?? 'That file'} is not an image this editor can embed.`);
  }

  const src = file.type === 'image/svg+xml' ? await readAsDataUrl(file) : await reencode(file);
  const bytes = approximateBytes(src);
  if (bytes > REJECT_BYTES) {
    throw new Error(
      `${file.name} is ${formatSize(bytes)} even after resizing, which is too large to embed.`
    );
  }

  const natural = await measure(src);
  const aspect = natural.height / natural.width || 1;
  const width = DEFAULT_IMAGE_WIDTH;

  return {
    src,
    size: [width, Math.max(1, Math.round(width * aspect))],
    name: file.name.replace(/\.[^.]+$/, ''),
    bytes,
    warning:
      bytes > WARN_BYTES
        ? `${file.name} adds ${formatSize(bytes)} to the document.`
        : null,
  };
}

/**
 * Draw through a canvas to cap the resolution. Re-encoding as WebP keeps
 * transparency and is markedly smaller than PNG; the PNG path is only there
 * for a browser that will not produce WebP.
 */
async function reencode(file) {
  const original = await readAsDataUrl(file);
  const image = await load(original);

  const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
  if (scale === 1 && approximateBytes(original) <= WARN_BYTES) return original;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const webp = canvas.toDataURL('image/webp', 0.9);
  const encoded = webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');

  // A tiny source can come out larger after a round trip; keep the smaller.
  return approximateBytes(encoded) < approximateBytes(original) ? encoded : original;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function load(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The browser could not decode that image.'));
    image.src = src;
  });
}

async function measure(src) {
  try {
    const image = await load(src);
    return { width: image.width || 1, height: image.height || 1 };
  } catch {
    return { width: 1, height: 1 }; // an SVG with no intrinsic size
  }
}

/** Decoded size of a data URL, without actually decoding it. */
export function approximateBytes(dataUrl) {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return dataUrl.length;
  const payload = dataUrl.length - comma - 1;
  return dataUrl.slice(0, comma).includes(';base64') ? Math.floor(payload * 0.75) : payload;
}

export function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} kB`;
}

/** Total weight of every embedded picture, for the document panel. */
export function totalImageBytes(doc) {
  return doc.images.reduce((sum, img) => sum + approximateBytes(img.src), 0);
}
