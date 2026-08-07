/**
 * Tooltips for a row of controls.
 *
 * The native `title` tooltip is slow to appear, unstyled, and on a long string
 * often wraps somewhere unhelpful. This replaces it with one bubble that is
 * moved and refilled, rather than an element per control.
 *
 * `title` stays the source of truth. It is harvested into `data-tip` the first
 * time a control is hovered and the attribute removed, so the browser's own
 * tooltip never gets a chance to appear alongside this one -- and because the
 * harvest happens on every hover, a title the toolbar rewrites as state
 * changes (which file a reload would read, whether the view is 2D or 3D) is
 * picked up without anyone having to tell us.
 *
 * The bubble is a popover, so it lives in the top layer. That is not
 * decoration: the toolbar scrolls sideways on a narrow window, and anything
 * positioned inside it would be clipped by that scroll box.
 */

import { h, clear } from '../util/dom.js';
import { clamp } from '../util/num.js';

/** Wait before the first tooltip, so passing over the row is quiet. */
const SHOW_DELAY = 380;
/** ...but once one is up, moving along the row should not make you wait again. */
const WARM_FOR = 500;
const GAP = 8; // px between the control and the bubble
const EDGE = 8; // px of daylight kept at the window edge

export function createTooltips(root) {
  if (!root) return { destroy() {} };

  const head = h('span', { class: 'tooltip-head' });
  const key = h('kbd', { class: 'tooltip-key' });
  const body = h('span', { class: 'tooltip-body' });
  const tip = h('div', {
    class: 'tooltip',
    // Every control here already carries an aria-label, so this is a visual
    // convenience and nothing else. Announcing it again would be noise, and
    // taking the pointer would make the thing it describes unclickable.
    'aria-hidden': 'true',
    popover: 'manual',
  }, [h('span', { class: 'tooltip-line' }, [head, key]), body]);
  document.body.append(tip);

  const supported = typeof tip.showPopover === 'function';
  let timer = 0;
  let shownAt = 0;
  let current = null;

  function textFor(el) {
    // Re-harvest whenever a title is present: it may have been rewritten.
    if (el.title) {
      el.dataset.tip = el.title;
      el.removeAttribute('title');
    }
    return el.dataset.tip ?? '';
  }

  function show(el) {
    const text = textFor(el);
    if (!text) return hide();
    const parts = splitTitle(text);

    head.textContent = parts.head;
    key.textContent = parts.key ?? '';
    key.hidden = !parts.key;
    body.textContent = parts.body;
    body.hidden = !parts.body;

    current = el;
    if (supported && !tip.matches(':popover-open')) tip.showPopover();
    tip.classList.add('is-open');
    place(el);
    shownAt = performance.now();
  }

  /**
   * Under the control, centred on it, and inside the window.
   *
   * Below the whole *bar*, not merely below the button: a control is shorter
   * than the bar it sits in, so hanging the bubble off the button alone tucks
   * its top edge back inside it, and every tooltip then lines up on one row,
   * which is what a menu bar's should do. That only holds while the container
   * is a bar — stood on its end as a rail it runs the height of the screen,
   * and clearing it would put every tooltip off the bottom edge.
   *
   * When the bubble has to be pushed sideways to stay on screen the arrow
   * stays where it was, so it still points at what it is describing.
   */
  function place(el) {
    const anchor = el.getBoundingClientRect();
    const row = root.getBoundingClientRect();
    const self = tip.getBoundingClientRect();
    const x = clamp(
      anchor.left + anchor.width / 2 - self.width / 2,
      EDGE,
      Math.max(EDGE, window.innerWidth - self.width - EDGE)
    );
    const isBar = row.width > row.height;
    let top = (isBar ? Math.max(anchor.bottom, row.bottom) : anchor.bottom) + GAP;
    // Out of room underneath: go above the control rather than off the screen.
    if (top + self.height > window.innerHeight - EDGE) {
      top = Math.max(EDGE, anchor.top - self.height - GAP);
    }
    tip.style.left = `${Math.round(x)}px`;
    tip.style.top = `${Math.round(top)}px`;
    tip.style.setProperty('--tip-arrow', `${Math.round(anchor.left + anchor.width / 2 - x)}px`);
  }

  function hide() {
    clearTimeout(timer);
    timer = 0;
    current = null;
    tip.classList.remove('is-open');
    if (supported && tip.matches(':popover-open')) tip.hidePopover();
  }

  function schedule(el) {
    if (el === current) return;
    clearTimeout(timer);
    // Warm: sliding from one button to the next is one gesture, not two.
    const warm = tip.classList.contains('is-open') || performance.now() - shownAt < WARM_FOR;
    if (warm) show(el);
    else timer = setTimeout(() => show(el), SHOW_DELAY);
  }

  const target = (e) => e.target?.closest?.('[title], [data-tip]');

  const onOver = (e) => {
    // A touch fires pointerover on the way to a tap, with no matching leave to
    // take it back down again -- so a tooltip raised by one sits there until
    // something else happens to hide it.
    if (e.pointerType === 'touch') return;
    const el = target(e);
    if (!el || !root.contains(el)) return hide();
    schedule(el);
  };
  const onOut = (e) => {
    // Moving between a button and its own icon is not leaving it.
    if (e.relatedTarget && target(e) === e.relatedTarget?.closest?.('[title], [data-tip]')) return;
    hide();
  };
  const onFocus = (e) => {
    const el = target(e);
    // Only for keyboard focus: a click already told the user what it does.
    if (el && root.contains(el) && el.matches(':focus-visible')) show(el);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') hide();
  };

  /**
   * Take down a tooltip that is already up, but leave a pending one alone.
   *
   * Scrolling the row moves the control out from under a visible bubble, so
   * that one has to go. Cancelling a *pending* one would mean that scrolling a
   * button into view -- which is exactly how you reach it on a narrow window --
   * suppressed its tooltip until the pointer moved again. The pending one is
   * safe because the position is read from the control when it finally shows.
   */
  const dismiss = () => {
    if (tip.classList.contains('is-open')) hide();
  };

  root.addEventListener('pointerover', onOver);
  root.addEventListener('pointerout', onOut);
  root.addEventListener('pointerdown', hide);
  root.addEventListener('focusin', onFocus);
  root.addEventListener('focusout', hide);
  root.addEventListener('scroll', dismiss, { passive: true });
  window.addEventListener('scroll', dismiss, { passive: true });
  window.addEventListener('resize', hide);
  window.addEventListener('blur', hide);
  window.addEventListener('keydown', onKey);

  return {
    destroy() {
      hide();
      root.removeEventListener('pointerover', onOver);
      root.removeEventListener('pointerout', onOut);
      root.removeEventListener('pointerdown', hide);
      root.removeEventListener('focusin', onFocus);
      root.removeEventListener('focusout', hide);
      root.removeEventListener('scroll', dismiss);
      window.removeEventListener('scroll', dismiss);
      window.removeEventListener('resize', hide);
      window.removeEventListener('blur', hide);
      window.removeEventListener('keydown', onKey);
      clear(tip).remove();
    },
  };
}

/**
 * Pull a title apart into a name, a shortcut and an explanation.
 *
 * The toolbar already writes them in one shape -- "Tidy (A) — nudge blocks
 * apart" -- so nothing had to be restated to get a shortcut set in a key cap
 * and the reason for the button on its own line.
 */
export function splitTitle(text) {
  const [first, ...rest] = String(text).split(' — ');
  const body = rest.join(' — ');
  const found = /^(.*?)\s*\(([^)]{1,12})\)$/.exec(first);
  // A shortcut has no spaces in it. That is what tells "(A)" and "(Ctrl+O)"
  // apart from an aside like "(opens in a new tab)", which is prose.
  if (found && !/\s/.test(found[2])) {
    return { head: found[1], key: found[2], body };
  }
  return { head: first, key: null, body };
}
