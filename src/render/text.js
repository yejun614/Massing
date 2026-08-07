/**
 * Free text annotations.
 *
 * Text defaults to the `screen` plane -- square to the viewer, the right way
 * up at every camera rotation -- because that is what commentary usually wants
 * to be. But it is a flat rectangle like any other, so it can equally be laid
 * on the ground or stood against a wall; the placement is entirely the plane
 * transform, exactly as for a picture.
 *
 * A spin rotates about the anchor point rather than the text's centre. The
 * anchor is the one part of a text whose position the user set deliberately,
 * so it is the part that should stay put.
 */

import { svg, setAttr, setClass, clear } from '../util/dom.js';
import { planeTransform, effectivePlane } from '../geom/plane.js';
import { textAnchorFor } from '../util/text.js';
import { round2 } from '../util/num.js';

const LINE_HEIGHT = 1.35;
const HIT_PADDING = 4; // px of grabbable margin around the glyphs

export function createTextView() {
  const hit = svg('rect', { class: 'text-hit' });
  const text = svg('text', { class: 'text-body' });
  const el = svg('g', { class: 'annotation' }, [hit, text]);
  return { el, hit, text, signature: null };
}

/**
 * @param {{proj: object, rot: number, selected: boolean, hovered: boolean}} ctx
 */
export function updateTextView(view, note, ctx) {
  const { proj, rot } = ctx;

  setAttr(view.el, 'data-id', note.id);
  setAttr(view.el, 'transform', planeTransform(proj, rot, note));
  setClass(view.el, 'is-selected', ctx.selected);
  setClass(view.el, 'is-hovered', ctx.hovered);
  setClass(view.el, 'is-flat', effectivePlane(note.plane, proj) === 'screen');

  setAttr(view.text, 'fill', note.color);
  setAttr(view.text, 'font-size', note.size);
  setAttr(view.text, 'font-weight', note.bold ? 700 : 400);
  setAttr(view.text, 'font-style', note.italic ? 'italic' : 'normal');
  setAttr(view.text, 'text-decoration', note.underline ? 'underline' : 'none');
  setAttr(view.text, 'text-anchor', textAnchorFor(note.align));

  // Rebuilding tspans on every frame would throw away the browser's text
  // layout during a drag, so only do it when the content actually differs.
  const signature = `${note.text} ${note.size} ${note.align}`;
  if (view.signature !== signature) {
    view.signature = signature;
    const lines = String(note.text).split('\n');
    clear(view.text);
    lines.forEach((line, i) => {
      view.text.append(
        svg('tspan', {
          x: 0,
          y: round2(i * note.size * LINE_HEIGHT),
          // A tspan with no content collapses, which would silently swallow
          // the blank lines a user typed to space paragraphs out.
          text: line === '' ? '​' : line,
        })
      );
    });
    resizeHitArea(view);
  } else if (view.hit.getAttribute('width') === null) {
    resizeHitArea(view);
  }
}

/**
 * Glyphs are thin and full of holes, so clicking the text itself is fiddly.
 * A rectangle sized from the rendered bounds gives it a sane grab target.
 */
function resizeHitArea(view) {
  let box;
  try {
    box = view.text.getBBox();
  } catch {
    return; // not laid out yet; the next update will size it
  }
  setAttr(view.hit, 'x', round2(box.x - HIT_PADDING));
  setAttr(view.hit, 'y', round2(box.y - HIT_PADDING));
  setAttr(view.hit, 'width', round2(box.width + HIT_PADDING * 2));
  setAttr(view.hit, 'height', round2(box.height + HIT_PADDING * 2));
}
