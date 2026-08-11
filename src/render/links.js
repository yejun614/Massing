/**
 * The marks that say a link is there, and the one that says you just arrived.
 *
 * A link is invisible until the pointer happens to cross it, and a diagram
 * whose clickable parts can only be found by sweeping the mouse over it is a
 * diagram nobody clicks. So every element carrying a link wears a small chain
 * badge at its upper-right corner: it is the affordance, and in a presentation
 * it is the only thing telling a room that there is more to see.
 *
 * One layer for all of them rather than a badge inside each entity's own view.
 * A badge is the same object wherever it lands — same size, same glyph, same
 * offset — and it hangs off a *box*, which every kind of element can produce.
 * Adding it to the six renderers would have been six copies of one decision,
 * and they would have disagreed about the offset within a month.
 *
 * The layer is painted above the solids and takes no pointer events. The thing
 * the badge belongs to is what you click, which is what makes a link work when
 * the badge is behind a taller block, and what stops the badge from swallowing
 * a drag that started on the element under it.
 *
 * The landing ring is the other half of following a link. Arriving somewhere is
 * a camera move, and a camera move on its own does not say *which* of the
 * things now on screen was the destination — least of all when the destination
 * was already in frame and the camera barely travelled.
 */

import { svg, setAttr, setClass } from '../util/dom.js';
import { rotateRect, rotatePoint } from '../geom/iso.js';
import { round2 } from '../util/num.js';
import { parseLink } from '../core/link.js';
import { entityBox, edgeById } from '../core/doc.js';
import { edgeRoute, routeMidpoint, EDGE_Z } from './edge.js';

/**
 * The two glyphs, each in its own 16-unit box.
 *
 * The same paths as the toolbar's `link` and `external` icons, written out
 * rather than imported: that module produces whole `<svg>` elements for HTML
 * buttons, and what is wanted inside a scene is bare geometry that inherits the
 * group's transform.
 *
 * Two glyphs rather than one in two colours. Whether a link stays in the
 * diagram or leaves it is the one distinction worth making before the click —
 * it is the difference between looking and going — and shape survives being
 * small, printed and colour-blind in a way that a hue does not.
 */
const GLYPHS = {
  chain:
    '<path d="M6.6 9.4a2.6 2.6 0 0 0 3.9.3l2-2a2.6 2.6 0 0 0-3.7-3.7l-1.1 1.1"/>' +
    '<path d="M9.4 6.6a2.6 2.6 0 0 0-3.9-.3l-2 2a2.6 2.6 0 0 0 3.7 3.7l1.1-1.1"/>',
  external:
    '<path d="M9.4 2.6h4v4M13.4 2.6 7.6 8.4"/>' +
    '<path d="M12 9.6v2.8a1.2 1.2 0 0 1-1.2 1.2H3.6a1.2 1.2 0 0 1-1.2-1.2V5.2A1.2 1.2 0 0 1 3.6 4h2.8"/>',
};

/**
 * Badge radius in scene pixels.
 *
 * Scene pixels, so it travels and scales with the drawing exactly as a caption
 * does — which is also what keeps an exported image right, since an export is
 * the scene at its own scale with the camera taken off. Generous, because at
 * the zoom a whole diagram fits at, a badge sized like a piece of interface
 * would be four pixels of nothing.
 */
const R = 13;

/** How far up and to the right of the corner it sits, in scene pixels. */
const OFFSET = { x: 5, y: -8 };

/** Radius of the ring drawn around whatever a link just landed on. */
const RING = 26;

export function createLinksView() {
  const badges = svg('g', { class: 'link-marks' });
  const ring = svg('circle', { class: 'link-landing', r: RING, visibility: 'hidden' });
  const el = svg('g', { class: 'layer layer-links' }, [ring, badges]);
  return { el, badges, ring, views: new Map(), landed: null };
}

/**
 * @param {object} view from `createLinksView`
 * @param {{doc: object, proj: object, rot: number, hoverId: string|null,
 *          landed: string|null}} ctx
 */
export function updateLinksView(view, ctx) {
  const { doc, hoverId } = ctx;

  const seen = new Set();
  for (const entity of linkedEntities(doc)) {
    const at = anchorFor(doc, entity.id, ctx);
    if (!at) continue;
    let badge = view.views.get(entity.id);
    if (!badge) {
      badge = createBadge();
      view.views.set(entity.id, badge);
      view.badges.append(badge.el);
    }
    setAttr(badge.el, 'transform', `translate(${round2(at.x + OFFSET.x)} ${round2(at.y + OFFSET.y)})`);
    setClass(badge.el, 'is-hovered', hoverId === entity.id);
    // An external link is the one kind that leaves: worth saying before the
    // click rather than only in the sheet the click brings up.
    const leaves = parseLink(entity.link)?.kind === 'url';
    setClass(badge.el, 'is-external', leaves);
    setGlyph(badge, leaves ? 'external' : 'chain');
    seen.add(entity.id);
  }
  for (const [id, badge] of view.views) {
    if (seen.has(id)) continue;
    badge.el.remove();
    view.views.delete(id);
  }

  // --- the landing ring ----------------------------------------------------
  const landing = ctx.landed ? anchorFor(doc, ctx.landed, ctx, { centre: true }) : null;
  if (!landing) {
    setAttr(view.ring, 'visibility', 'hidden');
    view.landed = null;
    return;
  }
  setAttr(view.ring, 'cx', round2(landing.x));
  setAttr(view.ring, 'cy', round2(landing.y));
  setAttr(view.ring, 'visibility', 'visible');
  /*
   * Restarted only when the destination changes.
   *
   * The animation is a CSS one on the element, so it plays once when the class
   * arrives and never again — and following the same link twice, which is
   * exactly what someone does when they were not sure the first press landed,
   * would otherwise show nothing at all the second time. Taking the class off
   * and forcing a reflow before putting it back is the one way to replay it.
   */
  if (view.landed !== ctx.landed) {
    view.ring.classList.remove('is-landing');
    void view.ring.getBoundingClientRect();
    view.ring.classList.add('is-landing');
    view.landed = ctx.landed;
  }
}

function createBadge() {
  const disc = svg('circle', { class: 'link-mark-disc', r: R });
  const glyph = svg('g', {
    class: 'link-mark-glyph',
    // The glyph is drawn in a 16-unit box, so it is scaled to the badge and
    // then pulled back by half of itself to sit on the centre.
    transform: `scale(${round2((R * 1.5) / 16)}) translate(-8 -8)`,
  });
  return { el: svg('g', { class: 'link-mark' }, [disc, glyph]), glyph, drawn: null };
}

/** Swapped only when it changes: `innerHTML` reparses, and this runs per frame. */
function setGlyph(badge, name) {
  if (badge.drawn === name) return;
  badge.glyph.innerHTML = GLYPHS[name];
  badge.drawn = name;
}

/** Everything in the drawing that carries something resembling a link. */
function linkedEntities(doc) {
  const out = [];
  for (const key of ['groups', 'nodes', 'shapes', 'cells', 'images', 'texts', 'edges']) {
    for (const entity of doc[key] ?? []) {
      // Drawn for anything with a link written on it, including one that points
      // nowhere. A badge on a broken link is how its author finds out; hiding
      // it would make a typo look like a link that was never added.
      if (entity.link) out.push(entity);
    }
  }
  return out;
}

/**
 * Where a mark hangs off an element, in scene pixels.
 *
 * The badge goes at the corner of maximum x and minimum y, on the top face —
 * the upper right of the silhouette at every rotation, since the corner is
 * chosen in the *rotated* frame. The ring goes at the middle instead, because
 * it is drawn around the thing rather than tagged onto it.
 */
function anchorFor(doc, id, { proj, rot }, { centre = false } = {}) {
  const box = entityBox(doc, id);
  if (box) {
    const r = rotateRect(box.x, box.y, box.w, box.h, rot);
    const top = box.z + (proj.showsSides ? box.ht : 0);
    return centre
      ? proj.project(r.x + r.w / 2, r.y + r.h / 2, top)
      : proj.project(r.x + r.w, r.y, top);
  }
  // A connection has no footprint, so its mark rides the line it is drawn as.
  const edge = edgeById(doc, id);
  const route = edge && edgeRoute(doc, edge);
  if (!route) return null;
  const mid = routeMidpoint(route.points);
  const p = rotatePoint(mid.x, mid.y, rot);
  return proj.project(p.x, p.y, EDGE_Z);
}
