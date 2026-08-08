/** Numeric helpers shared by the geometry, render and document layers. */

/**
 * Round to two decimals. Used on every coordinate written into an SVG
 * attribute: sub-pixel precision is invisible and roughly doubles the size of
 * the markup, which matters for the SVG export and the single-file bundle.
 */
export function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Three decimals, for values like zoom where 0.01 steps would be visible. */
export function round3(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * Six decimals, for the linear part of a transform matrix.
 *
 * Coordinates can be rounded to the pixel, but a basis vector is multiplied by
 * the content's size before it reaches the screen: rounding cos30 to 0.87
 * stretches the axis by 0.34%, which is a visible skew on a large picture and
 * leaves the two axes disagreeing about scale.
 */
export function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

export function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

/** Round and clamp, falling back when the input is not a finite number. */
export function clampInt(value, lo, hi, fallback = 0) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? clamp(n, lo, hi) : clamp(fallback, lo, hi);
}

/**
 * Clamped, and rounded to one decimal place.
 *
 * For block height alone. Everything else on this grid is whole cells and
 * should stay that way — a footprint of 2.3 has no meaning against a lattice
 * of squares — but height is the one dimension where half a cell reads as a
 * deliberate difference rather than a mistake, and 0.1 is as fine as anyone can
 * see at this scale.
 *
 * A tenth cannot be represented exactly in binary, so the arithmetic is done in
 * tenths and divided back: `Math.round(1.15 * 10) / 10` is 1.1 rather than the
 * 1.2000000000000002 that reaches a file and never leaves it.
 */
export function clampTenth(value, lo, hi, fallback = 0) {
  const n = Number(value);
  const usable = Number.isFinite(n) ? n : Number(fallback);
  return clamp(Math.round(usable * 10) / 10, lo, hi);
}
