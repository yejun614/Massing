#!/usr/bin/env node
/**
 * The application icon, drawn rather than converted.
 *
 * Tauri's bundler wants a `.ico` on Windows and PNGs elsewhere, and
 * what this project has is an inline SVG favicon in `index.html`. The usual
 * route from one to the other is a rasteriser — a headless browser, or
 * ImageMagick, or `sharp`. All three are a dependency, and a build step that
 * needs a 300 MB browser to produce a 16×16 image is not a trade this repo
 * makes anywhere else.
 *
 * The mark makes that easy to avoid: it is three flat-coloured quadrilaterals
 * forming an isometric cube. Filling three convex polygons is a scanline and
 * some arithmetic, which is the same reasoning that produced `core/gif.js`.
 *
 *   node scripts/icon.mjs      -> desktop/src-tauri/icons/
 *
 * Run it when the mark changes, which is approximately never; the output is
 * committed so a normal build needs nothing.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/*
 * The mark, in the same 32-unit space the favicon uses, and with its colours.
 *
 * Straight out of the `<path>` elements in `index.html`: the top face, the
 * left face and the right face of a cube standing on a point. Kept in that
 * order because they are painted in it.
 */
const FACES = [
  { fill: [0xfb, 0xbf, 0x24], points: [[16, 3], [29, 10.5], [16, 18], [3, 10.5]] },
  { fill: [0xea, 0x58, 0x0c], points: [[16, 18], [16, 29], [3, 21.5], [3, 10.5]] },
  { fill: [0xf5, 0x9e, 0x0b], points: [[16, 18], [29, 10.5], [29, 21.5], [16, 29]] },
];
const VIEW = 32;

/**
 * One RGBA image of the mark.
 *
 * Supersampled rather than antialiased analytically: each pixel is sampled on
 * a 4×4 grid and the coverage averaged. It is the crude way to do it and it is
 * the right one here — the shapes are convex and flat-filled, the largest
 * output is 256×256, and the whole thing runs in a few milliseconds.
 */
function render(size) {
  const S = 4;
  const pixels = new Uint8Array(size * size * 4);
  const scale = size / VIEW;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, hits = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = (x + (sx + 0.5) / S) / scale;
          const py = (y + (sy + 0.5) / S) / scale;
          // Last face wins, matching the SVG's paint order.
          let colour = null;
          for (const face of FACES) if (inside(px, py, face.points)) colour = face.fill;
          if (!colour) continue;
          r += colour[0];
          g += colour[1];
          b += colour[2];
          hits++;
        }
      }
      const at = (y * size + x) * 4;
      if (!hits) continue;
      // Averaged over the samples that hit, so the edge colour is the shape's
      // colour and only the alpha falls off. Averaging over all 16 would drag
      // every edge towards black.
      pixels[at] = Math.round(r / hits);
      pixels[at + 1] = Math.round(g / hits);
      pixels[at + 2] = Math.round(b / hits);
      pixels[at + 3] = Math.round((hits / (S * S)) * 255);
    }
  }
  return pixels;
}

/** Even-odd point-in-polygon, which is all a convex quad needs. */
function inside(x, y, points) {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, data, tail]);
}

function png(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  // Each row is prefixed with its filter byte; 0 is "none", which costs a
  // little size and saves implementing the other four.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// ICO
// ---------------------------------------------------------------------------

/**
 * An ICO whose entries are PNGs.
 *
 * The format predates PNG and its entries are normally headless BMPs with an
 * upside-down bitmap and a separate 1-bit mask. Since Vista an entry may be a
 * PNG file instead, which every Windows this app can run on understands, and
 * which means the encoder above does all the work.
 */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const directory = [];
  let offset = 6 + images.length * 16;
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    // 256 is written as 0: the field is one byte and the format says so.
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0; // palette
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32BE(0, 8);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    directory.push(entry);
    offset += data.length;
  }
  return Buffer.concat([header, ...directory, ...images.map((i) => i.data)]);
}

// ---------------------------------------------------------------------------

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const images = SIZES.map((size) => ({ size, data: png(size, render(size)) }));

const ICONS = resolve(ROOT, 'desktop/src-tauri/icons');
mkdirSync(ICONS, { recursive: true });
const icoPath = resolve(ICONS, 'icon.ico');
const pngPath = resolve(ICONS, 'icon.png');
writeFileSync(icoPath, ico(images));
// macOS and Linux take a PNG; 256 is the size both want most.
writeFileSync(pngPath, images.at(-1).data);

// Tauri's bundler also wants these two by name, for Linux desktop entries.
for (const size of [32, 128]) {
  const found = images.find((i) => i.size === size);
  writeFileSync(resolve(ICONS, `${size}x${size}.png`), found.data);
}
console.log(`wrote desktop/src-tauri/icons/ (ico ${SIZES.join(', ')} px, plus 32/128/256 png)`);
