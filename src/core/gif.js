/**
 * A GIF89a encoder.
 *
 * The other raster formats come free from `canvas.toBlob`. GIF does not: no
 * browser will encode one, and asking for `image/gif` silently hands back a
 * PNG. So offering the format at all means writing it out by hand -- palette,
 * LZW and container.
 *
 * It is also the weakest of the formats on offer here. GIF carries 256 colours
 * and one bit of transparency, so what comes out is a quantised copy of what
 * PNG would have given you. It exists because things that only accept GIF
 * still exist, never because it is the better choice.
 */

/** Bits per channel in the colour histogram: 32 levels, 32768 buckets. */
const BITS = 5;
const LEVELS = 1 << BITS;
const BUCKETS = LEVELS ** 3;
const MAX_COLOURS = 256;
/** GIF stores width and height in two bytes each. */
export const GIF_MAX_SIDE = 65535;

/** 15-bit histogram key: five bits each of red, green and blue. */
const bucketOf = (r, g, b) =>
  ((r >> (8 - BITS)) << (BITS * 2)) | ((g >> (8 - BITS)) << BITS) | (b >> (8 - BITS));

const channelOf = (key, c) => (key >> (BITS * (2 - c))) & (LEVELS - 1);

/**
 * @param {Uint8ClampedArray} rgba  pixels, already composited over a background
 * @returns {Uint8Array} the bytes of a complete GIF file
 */
export function encodeGif(rgba, width, height) {
  if (width > GIF_MAX_SIDE || height > GIF_MAX_SIDE) {
    throw new Error(`GIF cannot hold an image ${width}×${height} px; the limit is ${GIF_MAX_SIDE} a side.`);
  }
  const { palette, lookup } = quantise(rgba);
  const indices = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < indices.length; i += 4, p++) {
    indices[p] = lookup[bucketOf(rgba[i], rgba[i + 1], rgba[i + 2])];
  }

  // The colour table has to be a power of two, at least two entries long.
  let depth = 1;
  while (1 << depth < palette.length) depth++;

  const out = new ByteSink();
  writeHeader(out, width, height, palette, depth);
  out.push(0x2c); // image descriptor
  writeShort(out, 0);
  writeShort(out, 0);
  writeShort(out, width);
  writeShort(out, height);
  out.push(0); // no local colour table, not interlaced
  writeLzw(out, indices, Math.max(2, depth));
  out.push(0x3b); // trailer
  return out.done();
}

// ---------------------------------------------------------------------------
// Colour reduction
// ---------------------------------------------------------------------------

/**
 * Median cut.
 *
 * The image is histogrammed into 32768 coarse buckets, and the bucket list is
 * repeatedly split -- always the box that is both populous and wide, always on
 * the channel it spans most, always at the median by population -- until there
 * are 256 boxes or nothing left worth splitting. Each box then contributes the
 * average of the pixels that landed in it.
 *
 * Splitting a *sorted range* of one shared array, rather than moving buckets
 * between lists, is what keeps this cheap: a box is a pair of offsets.
 */
function quantise(rgba) {
  const counts = new Uint32Array(BUCKETS);
  const sumR = new Float64Array(BUCKETS);
  const sumG = new Float64Array(BUCKETS);
  const sumB = new Float64Array(BUCKETS);

  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const k = bucketOf(r, g, b);
    counts[k]++;
    sumR[k] += r;
    sumG[k] += g;
    sumB[k] += b;
  }

  const used = [];
  for (let k = 0; k < BUCKETS; k++) if (counts[k]) used.push(k);
  if (!used.length) return { palette: [[0, 0, 0], [0, 0, 0]], lookup: new Uint8Array(BUCKETS) };

  const boxOf = (lo, hi) => {
    const min = [LEVELS, LEVELS, LEVELS];
    const max = [-1, -1, -1];
    let count = 0;
    for (let i = lo; i < hi; i++) {
      const k = used[i];
      count += counts[k];
      for (let c = 0; c < 3; c++) {
        const v = channelOf(k, c);
        if (v < min[c]) min[c] = v;
        if (v > max[c]) max[c] = v;
      }
    }
    return { lo, hi, min, max, count };
  };

  const boxes = [boxOf(0, used.length)];
  while (boxes.length < MAX_COLOURS) {
    let pick = -1;
    let best = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.hi - b.lo < 2) continue; // one bucket: nothing to cut
      const volume =
        (b.max[0] - b.min[0] + 1) * (b.max[1] - b.min[1] + 1) * (b.max[2] - b.min[2] + 1);
      const score = b.count * volume;
      if (score > best) {
        best = score;
        pick = i;
      }
    }
    if (pick < 0) break;

    const b = boxes[pick];
    let widest = 0;
    for (let c = 1; c < 3; c++) {
      if (b.max[c] - b.min[c] > b.max[widest] - b.min[widest]) widest = c;
    }
    const sorted = used
      .slice(b.lo, b.hi)
      .sort((p, q) => channelOf(p, widest) - channelOf(q, widest));
    for (let i = 0; i < sorted.length; i++) used[b.lo + i] = sorted[i];

    let half = 0;
    let cut = b.lo;
    for (; cut < b.hi - 1; cut++) {
      half += counts[used[cut]];
      if (half * 2 >= b.count) break;
    }
    // One bucket holding more than half the box runs the search off the end,
    // and a cut there yields the original box plus an empty one -- which would
    // then be picked and split again, forever. Both halves must be real.
    const at = Math.min(cut, b.hi - 2);
    boxes.splice(pick, 1, boxOf(b.lo, at + 1), boxOf(at + 1, b.hi));
  }

  const palette = boxes.map((b) => {
    let n = 0;
    let r = 0;
    let g = 0;
    let bl = 0;
    for (let i = b.lo; i < b.hi; i++) {
      const k = used[i];
      n += counts[k];
      r += sumR[k];
      g += sumG[k];
      bl += sumB[k];
    }
    return n ? [Math.round(r / n), Math.round(g / n), Math.round(bl / n)] : [0, 0, 0];
  });
  // A palette of one is legal arithmetic but not a legal colour table.
  if (palette.length < 2) palette.push([0, 0, 0]);

  // One flat array read per pixel, instead of a nearest-colour search.
  const lookup = new Uint8Array(BUCKETS);
  boxes.forEach((b, index) => {
    for (let i = b.lo; i < b.hi; i++) lookup[used[i]] = index;
  });
  return { palette, lookup };
}

// ---------------------------------------------------------------------------
// Container and compression
// ---------------------------------------------------------------------------

function writeHeader(out, width, height, palette, depth) {
  out.write([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // "GIF89a"
  writeShort(out, width);
  writeShort(out, height);
  // Global table present | 8-bit colour resolution | not sorted | table size
  out.push(0x80 | 0x70 | (depth - 1));
  out.push(0); // background colour index
  out.push(0); // pixel aspect ratio: none given
  for (let i = 0; i < 1 << depth; i++) out.write(palette[i] ?? [0, 0, 0]);
}

function writeShort(out, value) {
  out.push(value & 0xff);
  out.push((value >> 8) & 0xff);
}

/**
 * GIF's variable-width LZW, packed least-significant-bit first and cut into
 * sub-blocks of at most 255 bytes.
 *
 * The width grows one bit at a time as the table fills, and the *decoder*
 * grows it on exactly the same schedule -- which is why the width is bumped
 * before the new code is assigned, not after. Get that order wrong and the
 * file is unreadable rather than merely larger.
 */
function writeLzw(out, indices, minCodeSize) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  let table = new Map();

  let block = [];
  let acc = 0;
  let bits = 0;

  const flush = () => {
    if (!block.length) return;
    out.push(block.length);
    out.write(block);
    block = [];
  };
  const emit = (code) => {
    acc |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      block.push(acc & 0xff);
      acc >>>= 8;
      bits -= 8;
      if (block.length === 255) flush();
    }
  };

  out.push(minCodeSize);
  emit(clear);

  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const found = table.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (next === 4096) {
      // The table is full: start a fresh one, and say so at the old width.
      emit(clear);
      table = new Map();
      next = eoi + 1;
      codeSize = minCodeSize + 1;
    } else {
      if (next >= 1 << codeSize) codeSize++;
      table.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) {
    block.push(acc & 0xff);
    if (block.length === 255) flush();
  }
  flush();
  out.push(0); // block terminator
}

/** A Uint8Array that grows, so the file is assembled without array-of-numbers. */
class ByteSink {
  constructor() {
    this.bytes = new Uint8Array(4096);
    this.length = 0;
  }

  ensure(n) {
    if (this.length + n <= this.bytes.length) return;
    let size = this.bytes.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.bytes.subarray(0, this.length));
    this.bytes = next;
  }

  push(byte) {
    this.ensure(1);
    this.bytes[this.length++] = byte;
  }

  write(list) {
    this.ensure(list.length);
    this.bytes.set(list, this.length);
    this.length += list.length;
  }

  done() {
    return this.bytes.slice(0, this.length);
  }
}
