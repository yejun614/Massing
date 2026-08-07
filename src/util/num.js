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
