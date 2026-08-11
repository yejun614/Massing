/**
 * Data structures: a run of slots, drawn as one solid with dividers.
 *
 * An array, a stack, a queue and a matrix are one picture — a run of boxes with
 * values in them — so they are one thing here, and what tells them apart is the
 * shape of the run: a stack is a column, a queue is a row, a matrix is both.
 *
 * One slab with lines drawn on its lid, not a slab per slot. Twenty slots would
 * otherwise be twenty solids to sort against each other and eighty wall quads to
 * paint, and the seams between neighbouring boxes would be double-drawn — where
 * an array is a single object whose insides are divided.
 *
 * Everything on the lid — the dividers, the values, the index gutter — is
 * projected onto the top face rather than transformed onto a plane, so the
 * drawing cannot drift from the solid underneath it at any camera angle.
 */

import { svg, setAttr, setText, setClass, clear } from '../util/dom.js';
import { CELL } from '../geom/iso.js';
import { planeTransform, effectivePlane } from '../geom/plane.js';
import { shade } from '../util/color.js';
import {
  projectRing,
  ringPath,
  liftRing,
  bodyWalls,
  segmentsOnTop,
  FACE_LIGHT,
  LEFT_SHADE,
  RIGHT_SHADE,
  GROOVE_SHADE,
  GROOVE_LIGHT,
  GROOVE,
} from './solid.js';
import { round2 } from '../util/num.js';

// The cut, its light and its depth are shared: see `solid.js`.

/** How far outside the run the index gutter and the pointers sit, in cells. */
const GUTTER = 0.55;
const MARK_CLEAR = 1.15;

export function createCellsView() {
  // Two walls, not one: they are lit differently, like a block's faces.
  const wallLeft = svg('path', { class: 'cells-walls cells-wall-left' });
  const wallRight = svg('path', { class: 'cells-walls cells-wall-right' });
  const outline = svg('path', { class: 'cells-outline' });
  // Two strokes, not one: a groove is a dark edge with a lit one just below it.
  const groove = svg('path', { class: 'cells-groove' });
  const dividers = svg('path', { class: 'cells-dividers' });
  const values = svg('g', { class: 'cells-values' });
  const gutter = svg('g', { class: 'cells-gutter' });
  const marks = svg('g', { class: 'cells-marks' });
  const ends = svg('g', { class: 'cells-ends' });
  const label = svg('text', { class: 'cells-label', 'text-anchor': 'middle' });
  const description = svg('text', { class: 'cells-description', 'text-anchor': 'middle' });
  const el = svg('g', { class: 'cells' }, [
    wallLeft, wallRight, outline, groove, dividers, values, gutter, marks, ends, label, description,
  ]);
  return {
    el, wallLeft, wallRight, outline, groove, dividers, values, gutter, marks, ends, label, description,
  };
}

/**
 * @param {{proj: object, rot: number, selected: boolean, hovered: boolean,
 *          touched: boolean}} ctx
 */
export function updateCellsView(view, cells, ctx) {
  const { proj, rot, zoom = 1 } = ctx;
  const w = cells.cols * cells.slot[0] * CELL;
  const h = cells.rows * cells.slot[1] * CELL;
  const sw = cells.slot[0] * CELL;
  const sh = cells.slot[1] * CELL;
  const lift = proj.showsSides ? cells.height * CELL : 0;
  const z = lift > 0 ? cells.height : 0;

  setAttr(view.el, 'data-id', cells.id);
  setClass(view.el, 'is-selected', ctx.selected);
  setClass(view.el, 'is-hovered', ctx.hovered);
  setClass(view.el, 'is-ai-touched', ctx.touched === true);
  setClass(view.el, 'is-flat', lift <= 0);

  const ring = projectRing(
    [[0, 0], [w, 0], [w, h], [0, h]],
    cells.pos,
    proj,
    rot
  );
  const top = liftRing(ring, lift);

  const walls = lift > 0 ? bodyWalls(ring, top) : null;
  for (const [el, d, tint] of [
    [view.wallLeft, walls?.left, LEFT_SHADE],
    [view.wallRight, walls?.right, RIGHT_SHADE],
  ]) {
    setAttr(el, 'd', d ?? '');
    setAttr(el, 'fill', shade(cells.color, tint));
    setAttr(el, 'stroke', cells.color);
    setAttr(el, 'visibility', d ? 'visible' : 'hidden');
  }

  setAttr(view.outline, 'd', ringPath(top));
  setAttr(view.outline, 'stroke', cells.color);
  setAttr(view.outline, 'fill', lift > 0 ? shade(cells.color, FACE_LIGHT) : cells.color);

  // --- the dividers ---------------------------------------------------------
  const lines = [];
  for (let c = 1; c < cells.cols; c++) lines.push([[c * sw, 0], [c * sw, h]]);
  for (let r = 1; r < cells.rows; r++) lines.push([[0, r * sh], [w, r * sh]]);
  /*
   * The dividers are cut into the lid rather than drawn on it.
   *
   * A groove is two edges: the wall facing the light is in shadow and the one
   * facing away catches it, and the eye reads that pair as depth long before it
   * reads anything else. So the dark line sits on the join and a lighter one a
   * hair below it — below, because the light in this scene comes from above,
   * and the same two lines the other way round are a raised ridge.
   *
   * The offset is divided by the zoom so it stays one pixel of bevel on screen:
   * a groove is a trick of light, not a feature of the object, and one measured
   * in grid cells would be a canyon at 4x and invisible at a distance.
   */
  const bevel = GROOVE / zoom;
  setAttr(view.dividers, 'd', segmentsOnTop(lines, cells.pos, proj, rot, lift));
  setAttr(view.dividers, 'stroke', shade(cells.color, GROOVE_SHADE));
  setAttr(view.groove, 'd', segmentsOnTop(lines, cells.pos, proj, rot, lift - bevel));
  setAttr(view.groove, 'stroke', shade(cells.color, GROOVE_LIGHT));

  // --- what is in the slots -------------------------------------------------
  const plane = effectivePlane(cells.labelPlane, proj);
  const write = (parent, text, gx, gy, size, cls) => {
    const el = svg('text', { class: cls, 'text-anchor': 'middle' });
    setText(el, text);
    setAttr(el, 'font-size', round2(size));
    setAttr(el, 'transform', planeTransform(proj, rot, { pos: [gx, gy], z, plane, spin: 0 }));
    setAttr(el, 'x', 0);
    setAttr(el, 'y', round2(size * 0.35));
    parent.append(el);
    return el;
  };

  /** The centre of slot (col, row) in grid coordinates. */
  const centre = (col, row) => [
    cells.pos[0] + (col + 0.5) * cells.slot[0],
    cells.pos[1] + (row + 0.5) * cells.slot[1],
  ];

  clear(view.values);
  for (let i = 0; i < cells.items.length && i < cells.cols * cells.rows; i++) {
    const text = cells.items[i];
    if (!text) continue;
    const [gx, gy] = centre(i % cells.cols, Math.floor(i / cells.cols));
    write(view.values, text, gx, gy, cells.labelSize, 'cells-value');
  }

  // --- the index gutter -----------------------------------------------------
  //
  // Along the near edge for the columns and the left edge for the rows, so the
  // numbers sit where a reader looks for them without crossing the run itself.
  clear(view.gutter);
  if (cells.indices) {
    const small = cells.labelSize * 0.72;
    for (let c = 0; c < cells.cols; c++) {
      const [gx] = centre(c, 0);
      write(view.gutter, String(c), gx, cells.pos[1] - GUTTER, small, 'cells-index');
    }
    if (cells.rows > 1) {
      for (let r = 0; r < cells.rows; r++) {
        const [, gy] = centre(0, r);
        write(view.gutter, String(r), cells.pos[0] - GUTTER, gy, small, 'cells-index');
      }
    }
  }

  // --- pointers into the run ------------------------------------------------
  clear(view.marks);
  for (const mark of cells.marks) {
    const col = mark.at % cells.cols;
    const row = Math.floor(mark.at / cells.cols);
    if (row >= cells.rows) continue;
    const [gx] = centre(col, row);
    // Above the slot it names, clear of the index gutter that may be there too.
    const gy = cells.pos[1] - (cells.indices ? GUTTER + MARK_CLEAR * 0.6 : MARK_CLEAR * 0.6);
    write(view.marks, `${mark.text} ↓`, gx, gy, cells.labelSize * 0.8, 'cells-mark');
  }

  // --- the two ends ---------------------------------------------------------
  //
  // A run has two ends and they usually have names — Front and Back on a queue,
  // top and bottom on a stack. They are drawn beyond the ends rather than over
  // a slot, because that is what they name: a queue's front is wherever the
  // front happens to be, not slot 0 for ever.
  clear(view.ends);
  const cols = cells.cols;
  const rows = cells.rows;
  const upright = cols === 1 && rows > 1;
  const midX = cells.pos[0] + (cols * cells.slot[0]) / 2;
  const midY = cells.pos[1] + (rows * cells.slot[1]) / 2;
  const far = [
    upright ? [midX, cells.pos[1] - GUTTER] : [cells.pos[0] - GUTTER, midY],
    upright
      ? [midX, cells.pos[1] + rows * cells.slot[1] + GUTTER]
      : [cells.pos[0] + cols * cells.slot[0] + GUTTER, midY],
  ];
  // The glyph rather than a drawn triangle: it lands on the caption's plane with
  // the words, and a mark that skewed differently from its own label would read
  // as two separate things.
  const arrow = !cells.flow
    ? ''
    : cells.flow === 'both'
      // In at one end and out at the other is one arrow; in and out at *each*
      // end is two, which is what a stack's open top and a deque both look like.
      ? (upright ? '▲▼' : '◀▶')
      : upright
        ? (cells.flow === 'back' ? '▲' : '▼')
        : (cells.flow === 'back' ? '◀' : '▶');
  for (const [i, [gx, gy]] of far.entries()) {
    const name = cells.ends[i];
    if (!name && !arrow) continue;
    const text = [arrow, name].filter(Boolean).join(' ');
    const el = write(view.ends, text, gx, gy, cells.labelSize * 0.85, 'cells-end');
    if (!upright) setAttr(el, 'text-anchor', i === 0 ? 'end' : 'start');
  }

  // --- the structure's own name ---------------------------------------------
  //
  // Over the run and centred on it, which is where a table's caption goes and
  // where a reader looks for one. Beside it was the wrong side of a long array.
  setText(view.label, cells.label || '');
  setAttr(view.label, 'font-size', cells.labelSize);
  setAttr(view.label, 'visibility', cells.label ? 'visible' : 'hidden');
  /*
   * Over a row, beside a column.
   *
   * Not a setting, because there is only one answer either way: above a long
   * row is where a table's caption goes, and above a *column* is where the end
   * of the column already is — along with whatever marks its open end. Beside
   * it is the only clear ground a stack has.
   */
  const titleAt = upright
    ? [cells.pos[0] + cols * cells.slot[0] + GUTTER, midY]
    : [midX, cells.pos[1] - (cells.indices ? GUTTER + MARK_CLEAR : MARK_CLEAR)];
  setAttr(view.label, 'transform', planeTransform(proj, rot, {
    pos: titleAt, z, plane, spin: 0,
  }));
  setAttr(view.label, 'x', 0);
  setAttr(view.label, 'y', round2(cells.labelSize * 0.35));
  setAttr(view.label, 'text-anchor', upright ? 'start' : 'middle');

  // The second line, under the name and quieter, exactly as it reads on paper.
  setText(view.description, cells.description || '');
  setAttr(view.description, 'font-size', round2(cells.labelSize * 0.8));
  setAttr(view.description, 'visibility', cells.description ? 'visible' : 'hidden');
  setAttr(view.description, 'transform', planeTransform(proj, rot, {
    pos: titleAt, z, plane, spin: 0,
  }));
  setAttr(view.description, 'x', 0);
  setAttr(view.description, 'y', round2(cells.labelSize * 1.35));
  setAttr(view.description, 'text-anchor', upright ? 'start' : 'middle');
}
