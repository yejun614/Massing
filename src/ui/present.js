/**
 * Presentation mode: the diagram, and nothing else.
 *
 * Showing a diagram to a room is not the same activity as drawing one. What is
 * wanted then is the picture at full size, the ability to move around it, and a
 * way to step through the drawings in the file — and emphatically *not* the
 * ability to move a block by a cell because a click landed on it mid-sentence.
 * So this mode does two things: it takes the interface away, and it takes
 * editing away.
 *
 * Taking the interface away is a class on the root element and a stylesheet
 * that knows what to fold — see `--- presentation ---` in `styles/app.css`. The
 * panels keep their own state untouched, so leaving puts everything back the way
 * it was found rather than the way this mode would have left it.
 *
 * Taking editing away is `state.presenting`, which the pointer and the keyboard
 * both consult. Hiding the toolbar would already remove most of the ways in, but
 * a drag on the canvas and a keystroke are not toolbar buttons, and a mode whose
 * safety came from things merely being off screen would be one stray keypress
 * from rearranging a diagram in front of an audience.
 *
 * The tool is forced to `pan` for the duration, which is what makes a drag mean
 * "look over there": it is the one gesture the mode keeps, and it is the same
 * one the editor already has, rather than a second implementation of dragging.
 */

import { h, setAttrs } from '../util/dom.js';
import { fullUrlFrom } from '../core/embed.js';
import { UI_ICONS } from './icons-ui.js';
import { isTextTarget } from '../input/pointer.js';

/** On the root element, so the phone layout's `--rail-w` can be zeroed with it. */
const PRESENT_CLASS = 'is-presenting';

/** Whether this drawing has anything to click, so the mode can say so or not. */
const hasLinks = (doc) =>
  ['nodes', 'groups', 'shapes', 'cells', 'texts', 'images', 'edges'].some((key) =>
    (doc[key] ?? []).some((entity) => entity.link)
  );

/** Presenting inside somebody else's page, which the stylesheet tightens up. */
const EMBED_CLASS = 'is-embedded';

/** How long the bar waits, with nothing happening, before it fades back. */
const IDLE_MS = 2800;

export function createPresenter({ store, tabs, commands, toaster, onExit } = {}) {
  let active = false;
  /**
   * Presenting with no way out: the page is an embed on somebody else's site.
   *
   * There is nothing to leave to. Dropping a reader of a blog post into a full
   * editor squeezed into a 480px frame is not a feature, so the mode keeps the
   * keys and the button that would do it — and offers a link to the real editor
   * in a tab of its own instead, which is what someone pressing Escape in an
   * embedded diagram actually wants.
   */
  let locked = false;
  /** The tool to give back on the way out; the mode borrows `pan` while it runs. */
  let restoreTool = 'select';
  /** Whether *we* put the page into fullscreen, so only we take it back out. */
  let ownsFullscreen = false;
  let idleTimer = 0;

  // --- the bar --------------------------------------------------------------

  /*
   * One strip along the bottom, and it is the whole interface for the duration.
   *
   * On the body rather than inside the canvas: the canvas owns every pointer
   * event over it, and a control living in there would have to spend its own
   * code stopping its clicks from becoming pans — which is exactly what the tab
   * strip has to do, and why that one is written the way it is.
   */
  const barBtn = (icon, label, onClick) =>
    h('button', {
      class: 'present-btn',
      type: 'button',
      title: label,
      'aria-label': label,
      html: UI_ICONS[icon],
      onClick,
    });

  const prevBtn = barBtn('chevronLeft', 'Previous drawing (←)', () => step(-1));
  const nextBtn = barBtn('chevronRight', 'Next drawing (→)', () => step(1));
  const fitBtn = barBtn('fit', 'Fit the drawing to the screen (0)', () => commands.zoomFit());
  const exitBtn = h('button', {
    class: 'present-btn present-exit',
    type: 'button',
    title: 'Leave presentation mode (Esc)',
    onClick: () => exit(),
  }, [h('span', { class: 'present-exit-icon', html: UI_ICONS.close }), 'Exit']);

  /*
   * The two an embed gets instead.
   *
   * Fullscreen because a diagram in a column of text is small, and this is the
   * one control that turns an embed into something you can present from. It
   * needs `allowfullscreen` on the frame, which the snippet writes — see
   * `core/embed.js`.
   *
   * And a way out to the real thing, in a tab of its own: an embed is a place
   * a diagram is quoted, and following the quotation to the whole document is
   * the one navigation it owes its reader.
   */
  const fullscreenBtn = barBtn('expand', 'Fullscreen', () => toggleFullscreen());
  const openLink = h('a', {
    class: 'present-btn present-open',
    target: '_blank',
    rel: 'noopener noreferrer',
    title: 'Open this diagram in Massing (new tab)',
  }, [h('span', { class: 'present-exit-icon', html: UI_ICONS.external }), 'Open']);

  const label = h('span', { class: 'present-name' });
  const count = h('span', { class: 'present-count' });
  const where = h('span', { class: 'present-where' }, [label, count]);
  const nav = h('div', { class: 'present-nav' }, [prevBtn, where, nextBtn]);

  const bar = h('div', {
    class: 'present-bar is-hidden',
    role: 'group',
    'aria-label': 'Presentation',
  }, [
    nav,
    h('span', { class: 'present-sep', 'aria-hidden': 'true' }),
    fitBtn, fullscreenBtn, exitBtn, openLink,
  ]);
  document.body.append(bar);

  // A press on the bar is a press on a control, not the start of a look-around,
  // and the canvas has no business hearing about it either way.
  for (const type of ['pointerdown', 'pointermove', 'wheel', 'dblclick']) {
    bar.addEventListener(type, (e) => e.stopPropagation());
  }

  /**
   * Which drawing this is, and whether there is another.
   *
   * The name is always shown, one drawing or five: it is what the thing on
   * screen is called, and a diagram presented without it is one the room has to
   * be told the name of out loud. What goes away with a single drawing is the
   * apparatus for moving between them — two arrows that cannot be pressed and a
   * "1 / 1" that counts to one — because those describe a choice that does not
   * exist rather than the drawing that does.
   */
  function render() {
    // An embed cannot leave, so it is offered the two things it can do instead.
    exitBtn.hidden = locked;
    fullscreenBtn.hidden = !locked;
    openLink.hidden = !locked;
    paintFullscreen();

    const list = tabs.list;
    const at = tabs.active;
    const many = list.length > 1;
    label.textContent = list[at]?.name ?? '';
    count.textContent = `${at + 1} / ${list.length}`;
    for (const el of [prevBtn, nextBtn, count]) el.hidden = !many;
    prevBtn.disabled = at <= 0;
    nextBtn.disabled = at >= list.length - 1;
  }
  // Renaming, reordering or deleting a drawing all happen behind this mode
  // rather than in it, but the strip has to be right when it comes back.
  tabs.subscribe(render);

  // --- moving between drawings ---------------------------------------------

  function go(index) {
    if (index < 0 || index >= tabs.count || index === tabs.active) return;
    tabs.select(index); // frames the new drawing through `onSwitch`
    render();
    wake();
  }

  const step = (delta) => go(tabs.active + delta);

  // --- the bar gets out of the way ------------------------------------------

  /**
   * Nothing happening for a few seconds means the diagram is being talked about,
   * so the bar fades down to a hint of itself. It comes back on any movement,
   * and hovering it holds it — see the `:hover` rule beside `.present-bar.is-idle`.
   */
  function wake() {
    clearTimeout(idleTimer);
    bar.classList.remove('is-idle');
    if (!active) return;
    idleTimer = setTimeout(() => bar.classList.add('is-idle'), IDLE_MS);
  }

  window.addEventListener('pointermove', () => {
    if (active) wake();
  }, { passive: true });

  // --- the keyboard ---------------------------------------------------------

  /**
   * In the capture phase, and it swallows what it does not use.
   *
   * The editor's own shortcuts are window listeners in `input/keyboard.js` and
   * `input/pointer.js`, so a capture listener here runs before both and
   * `stopPropagation` is what makes "editing is off" true of the keyboard as
   * well as of the mouse. Only single presses are taken: anything with a
   * modifier is left entirely to the browser, so Ctrl+W still closes the tab and
   * F5 still reloads — a mode that has to be escaped before the browser answers
   * you is a trap, however briefly.
   */
  function onKeyDown(e) {
    if (!active || isTextTarget(e.target)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    // Anything past this line is either handled here or deliberately dropped.
    // Nothing below reaches an editing shortcut.
    e.stopPropagation();
    wake();

    const take = () => e.preventDefault();

    switch (key) {
      case 'Escape':
      case 'p':
        take();
        // Locked, this is the one key with nothing to do: `exit` refuses, and
        // saying so once beats a press that appears to have been ignored.
        if (locked) toaster?.info('This is an embedded diagram. Open it in Massing to edit.');
        else exit();
        return;
      // Forward, in every idiom a remote clicker or a keyboard offers.
      case 'ArrowRight':
      case 'ArrowDown':
      case 'PageDown':
      case ' ':
      case 'Enter':
        take();
        step(1);
        return;
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
        take();
        step(-1);
        return;
      case 'Home':
        take();
        go(0);
        return;
      case 'End':
        take();
        go(tabs.count - 1);
        return;
      // Looking at the diagram is the other half of the mode, so the view keys
      // carry on working exactly as they do in the editor.
      case 'q':
        commands.rotateLeft();
        return;
      case 'e':
        commands.rotateRight();
        return;
      case '2':
        commands.toggleMode();
        return;
      case '0':
        commands.zoomFit();
        return;
      case '1':
        commands.zoomReset();
        return;
      case '=':
      case '+':
        commands.zoomIn();
        return;
      case '-':
        commands.zoomOut();
        return;
      default:
        return; // swallowed above: no key edits the drawing while presenting
    }
  }
  window.addEventListener('keydown', onKeyDown, true);

  // --- fullscreen -----------------------------------------------------------

  /**
   * Asked for, never required.
   *
   * A projector wants the browser's own furniture gone as much as ours, but the
   * request can be refused — an embedded frame, a policy, a call that the
   * browser does not consider to have come from a click — and presentation mode
   * is perfectly usable in a window. So the failure is swallowed and the mode
   * carries on.
   */
  /** Which way the button points, and what it says. */
  function paintFullscreen() {
    const on = Boolean(document.fullscreenElement);
    setAttrs(fullscreenBtn, {
      html: UI_ICONS[on ? 'compress' : 'expand'],
      title: on ? 'Leave fullscreen' : 'Fullscreen',
      'aria-label': on ? 'Leave fullscreen' : 'Fullscreen',
    });
  }

  /**
   * The embed's own fullscreen, which is a press rather than a consequence.
   *
   * A frame may only do this if the page holding it said so, and a host that
   * pasted the snippet without `allowfullscreen` — or edited it out — leaves a
   * button that does nothing. So the refusal is reported inside the frame,
   * where the only person who can see it is the one who can fix it.
   */
  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
      return;
    }
    document.documentElement.requestFullscreen?.().catch(() => {
      toaster?.warn('The page holding this diagram does not allow fullscreen.');
    });
  }

  function requestFullscreen() {
    const el = document.documentElement;
    if (!el.requestFullscreen || document.fullscreenElement) return;
    el.requestFullscreen()
      .then(() => {
        ownsFullscreen = active;
      })
      .catch(() => {
        ownsFullscreen = false;
      });
  }

  /*
   * Leaving fullscreen leaves the mode.
   *
   * Escape inside fullscreen is the browser's before it is ours — it never
   * reaches the handler above — so without this the tools would stay hidden
   * with the one key anybody would press to bring them back already spent.
   */
  document.addEventListener('fullscreenchange', () => {
    if (!active) return;
    paintFullscreen();
    // The frame or the window just changed size under the diagram, either way.
    commands.zoomFit();
    // An embed's fullscreen is a button of its own and going in and out of it
    // is not leaving anything; only the mode that asked for it exits with it.
    if (!locked && !document.fullscreenElement && ownsFullscreen) exit();
  });

  // --- entering and leaving -------------------------------------------------

  /**
   * @param {{locked?: boolean}} options
   *   `locked` is the embed: no way out, and the bar offers fullscreen and a
   *   link to the full editor in its place.
   */
  function enter({ locked: lock = false } = {}) {
    if (active) return;
    active = true;
    locked = lock;
    restoreTool = store.state.tool;

    document.documentElement.classList.add(PRESENT_CLASS);
    document.documentElement.classList.toggle(EMBED_CLASS, locked);
    bar.classList.remove('is-hidden');
    if (locked) openLink.href = fullUrlFrom();

    // Selection handles drawn over a diagram on a projector are somebody else's
    // work in progress; a queued component would be waiting to be dropped by
    // the first click. Neither belongs in front of an audience.
    store.clearSelection();
    store.setUI({
      presenting: true,
      tool: 'pan',
      pendingType: null,
      hover: null,
      hoverId: null,
      aiTouched: [],
      landed: null,
    });

    // An embed is already the whole page it is given; taking over the reader's
    // screen the moment an article scrolls into view would be an ambush.
    if (!locked) requestFullscreen();
    render();
    wake();
    // The canvas has just gained two panels and a toolbar's worth of room, and
    // a diagram fitted to the old window would sit in the middle of the new one.
    commands.zoomFit();

    // Silent in an embed: a toast of instructions is the first thing a reader
    // of somebody else's page would see, over a diagram they came for.
    if (locked) return;
    toaster?.info(
      tabs.count > 1
        ? 'Presenting. ← → change drawing, drag to look around, Esc leaves.'
        : 'Presenting. Drag to look around, Esc leaves.'
    );
    // Said separately, and only when there is one to click: it is an
    // instruction about this particular drawing rather than about the mode.
    if (hasLinks(store.state.doc)) {
      toaster?.info('Anything wearing a badge is a link — click it.');
    }
  }

  function exit() {
    if (!active || locked) return;
    active = false;
    clearTimeout(idleTimer);

    document.documentElement.classList.remove(PRESENT_CLASS);
    bar.classList.add('is-hidden');
    bar.classList.remove('is-idle');

    store.setUI({ presenting: false, tool: restoreTool });

    // Only the fullscreen this mode asked for: someone who was already
    // fullscreen before presenting should still be afterwards.
    if (ownsFullscreen && document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {
        /* already gone, or refused; either way the mode is over */
      });
    }
    ownsFullscreen = false;

    /*
     * Whatever was hidden is back, and anything that measures itself has to be
     * told: a control with no box on screen cannot read its own layout, so a
     * render it did while it was away wrote nonsense or, at best, nothing.
     * The tab strip is the one that does — see `measure` in `ui/tabs.js`.
     */
    onExit?.();
    commands.zoomFit();
  }

  return {
    enter,
    exit,
    toggle: () => (active ? exit() : enter()),
    get active() {
      return active;
    },
  };
}
