/**
 * Estimating how much room a caption takes, without a DOM.
 *
 * The arrange pass has to know roughly how wide a label is so it can keep the
 * ground clear for it, but it runs in plain JavaScript with no text metrics
 * available -- and must stay deterministic so the tests can pin its output.
 *
 * So this is an estimate, and deliberately a slightly generous one: reserving
 * a little too much space leaves a gap, while reserving too little hides the
 * end of a word.
 */

/** Average advance of a Latin glyph, as a fraction of the font size. */
const NARROW_EM = 0.55;
/** CJK and full-width forms occupy a full em. */
const WIDE_EM = 1;
const CAPTION_LINE_HEIGHT = 1.35;

/**
 * Full-width character ranges: Hangul, CJK ideographs, kana, and the
 * full-width Latin block. Everything else is treated as narrow.
 */
function isWide(codePoint) {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0x303e) ||
    (codePoint >= 0x3041 && codePoint <= 0x33ff) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xa000 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6)
  );
}

/** Approximate width of one line, in pixels. */
export function estimateLineWidth(line, fontSize) {
  let em = 0;
  for (const ch of String(line)) em += isWide(ch.codePointAt(0)) ? WIDE_EM : NARROW_EM;
  return em * fontSize;
}

/**
 * Approximate rendered size of a caption, in pixels.
 * @returns {{width: number, height: number, lines: number}}
 */
export function estimateTextBox(text, fontSize) {
  const lines = String(text ?? '').split('\n');
  const width = Math.max(0, ...lines.map((line) => estimateLineWidth(line, fontSize)));
  return {
    width,
    height: lines.length * fontSize * CAPTION_LINE_HEIGHT,
    lines: lines.length,
  };
}
