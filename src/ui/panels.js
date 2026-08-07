/**
 * The two side panels: draggable dividers, and folding them away.
 *
 * The dividers are not grid columns. They sit absolutely over the inner edge
 * of each panel, so the layout stays a plain three-column grid and the handle
 * cannot be scrolled away by a long palette.
 *
 * Widths are clamped twice: each panel has its own bounds, and the canvas is
 * guaranteed a minimum. Without that second clamp, dragging on a narrow window
 * can squeeze the drawing area to nothing — a state the user then has to drag
 * their way back out of.
 *
 * Folding a panel away is the same idea taken to its end: the column goes to
 * zero and the panel and its divider leave the layout entirely. A narrow window
 * does it on its own, because 320px of canvas between two 232px panels is not a
 * drawing area. What the viewport decides and what the user decides are kept
 * apart — see `setCollapsed`.
 *
 * On a phone a panel stops being a column at all and slides over the canvas
 * instead — the stylesheet does that on its own, off the same `is-collapsed`
 * class. Two things still need saying in script: only one drawer at a time,
 * since there is no room for two, and a scrim to dismiss it with, since there
 * is no longer any canvas beside it to press.
 */

const PANELS_KEY = 'massing:panels';
const MIN = 168;
const MAX = 560;
const MIN_CANVAS = 320;
const STEP = 16; // keyboard nudge

const DEFAULTS = { left: 232, right: 232 };
const VARS = { left: '--panel-left-w', right: '--panel-right-w' };

/**
 * Below these widths a panel folds itself away. The inspector goes first: it is
 * only useful once something is selected, whereas the palette is how blocks get
 * onto the canvas at all.
 */
const AUTO_HIDE = { right: 1180, left: 900 };

/** Below this the panels stop being columns and become drawers. */
const DRAWER_WIDTH = 760;

export function createPanels({ root = document, onResize, onChange } = {}) {
  const drawers = window.matchMedia(`(max-width: ${DRAWER_WIDTH - 1}px)`);
  const saved = readState();
  const widths = { ...DEFAULTS, ...saved.widths };

  // `pref` is what the user last chose at a comfortable width and is persisted.
  // `collapsed` is what is on screen now. `forced` records that the viewport,
  // not the user, is the reason a panel is away — so widening the window can
  // put it back without the user having asked twice.
  const pref = { left: false, right: false, ...saved.collapsed };
  const collapsed = { ...pref };
  const forced = { left: false, right: false };

  for (const side of ['left', 'right']) {
    const handle = root.querySelector(`[data-region="resize-${side}"]`);
    if (handle) attach(handle, side);
    watchViewport(side);
    apply(side);
  }

  function apply(side) {
    const width = collapsed[side] ? 0 : widths[side];
    document.documentElement.style.setProperty(VARS[side], `${width}px`);

    const panel = root.querySelector(`.panel-${side}`);
    const handle = root.querySelector(`[data-region="resize-${side}"]`);
    panel?.classList.toggle('is-collapsed', collapsed[side]);
    handle?.classList.toggle('is-collapsed', collapsed[side]);
    handle?.setAttribute('aria-valuenow', String(width));
    // The scrim is only ever drawn in drawer mode, but the class it keys off
    // is set either way -- one fewer thing that has to agree with a media
    // query it cannot see.
    document.body.classList.toggle('has-drawer', !collapsed.left || !collapsed.right);
  }

  /**
   * Clamp against both the panel's own bounds and the space left for the
   * canvas, measuring the *other* panel so the two cannot conspire to close
   * the drawing area between them. A folded panel measures zero.
   */
  function clamp(side, value) {
    const otherSide = side === 'left' ? 'right' : 'left';
    const other = collapsed[otherSide] ? 0 : widths[otherSide];
    const room = window.innerWidth - other - MIN_CANVAS;
    return Math.round(Math.max(MIN, Math.min(value, MAX, Math.max(MIN, room))));
  }

  function set(side, value) {
    const next = clamp(side, value);
    if (next === widths[side]) return;
    widths[side] = next;
    apply(side);
    saveState();
    onResize?.();
  }

  /**
   * `remember` is what separates a choice from a consequence. The user pressing
   * the toggle is a choice and is stored; the window crossing a breakpoint is
   * not, or resizing a window would quietly rewrite what the user asked for.
   * Opening a panel while the viewport is holding it shut is honoured for as
   * long as that viewport lasts, but is not remembered either — it was made
   * under duress.
   */
  function setCollapsed(side, value, { remember = true } = {}) {
    if (remember && !forced[side] && pref[side] !== value) {
      pref[side] = value;
      saveState();
    }
    // A drawer covers most of the screen, so two of them would leave nothing
    // to draw on. Closing the other is a consequence of the viewport and is
    // deliberately not remembered as a preference.
    if (!value && drawers.matches) {
      const other = side === 'left' ? 'right' : 'left';
      if (!collapsed[other]) setCollapsed(other, true, { remember: false });
    }
    if (collapsed[side] === value) return;
    collapsed[side] = value;
    apply(side);
    onChange?.();
    onResize?.();
  }

  /** Fold the panel away below its breakpoint, restore the preference above. */
  function watchViewport(side) {
    const query = window.matchMedia(`(max-width: ${AUTO_HIDE[side] - 1}px)`);
    query.addEventListener('change', () => {
      forced[side] = query.matches;
      setCollapsed(side, query.matches ? true : pref[side], { remember: false });
    });

    // The opening state is set directly rather than through `setCollapsed`.
    // Going through it would fire `onChange` from inside this constructor, i.e.
    // call back into a caller that has not finished building itself yet, and
    // the constructor's own `apply` puts the result on screen a moment later.
    forced[side] = query.matches;
    if (query.matches) collapsed[side] = true;
  }

  function attach(handle, side) {
    let startX = 0;
    let startWidth = 0;

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); // stop the press turning into a text selection
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('is-dragging');
      document.body.classList.add('is-resizing');
      startX = e.clientX;
      startWidth = widths[side];
    });

    handle.addEventListener('pointermove', (e) => {
      if (!handle.hasPointerCapture?.(e.pointerId)) return;
      const delta = e.clientX - startX;
      // The right panel grows as the pointer moves left, hence the sign flip.
      set(side, startWidth + (side === 'left' ? delta : -delta));
    });

    const end = (e) => {
      if (!handle.classList.contains('is-dragging')) return;
      handle.classList.remove('is-dragging');
      document.body.classList.remove('is-resizing');
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);

    // A divider is a real control, so it answers to the keyboard too.
    handle.addEventListener('keydown', (e) => {
      const towards = { ArrowLeft: -STEP, ArrowRight: STEP }[e.key];
      if (towards !== undefined) {
        e.preventDefault();
        set(side, widths[side] + (side === 'left' ? towards : -towards));
        return;
      }
      if (e.key === 'Home' || e.key === 'Enter') {
        e.preventDefault();
        set(side, DEFAULTS[side]);
      }
    });

    handle.addEventListener('dblclick', () => set(side, DEFAULTS[side]));
  }

  function saveState() {
    writeState({ ...widths, collapsed: { ...pref } });
  }

  // Pressing away from a drawer closes it: on a phone there is no canvas
  // beside it left to press instead.
  root.querySelector('[data-region="scrim"]')?.addEventListener('pointerdown', () => {
    setCollapsed('left', true, { remember: false });
    setCollapsed('right', true, { remember: false });
  });

  // A window that shrinks can invalidate a width that was fine when it was set.
  window.addEventListener('resize', () => {
    set('left', widths.left);
    set('right', widths.right);
  });

  return {
    get widths() {
      return { ...widths };
    },
    isCollapsed(side) {
      return collapsed[side];
    },
    toggle(side) {
      setCollapsed(side, !collapsed[side]);
    },
    show(side) {
      setCollapsed(side, false);
    },
    /**
     * Something was picked that is placed by pressing the canvas next.
     *
     * Only a drawer is in the way -- as a column the palette can stay open,
     * and closing it would undo the user's own choice for no reason.
     */
    armed() {
      if (drawers.matches) setCollapsed('left', true, { remember: false });
    },
    reset() {
      set('left', DEFAULTS.left);
      set('right', DEFAULTS.right);
      setCollapsed('left', false);
      setCollapsed('right', false);
    },
  };
}

function readState() {
  try {
    const raw = JSON.parse(localStorage.getItem(PANELS_KEY) ?? '{}');
    const widths = {};
    const collapsed = {};
    for (const side of ['left', 'right']) {
      if (Number.isFinite(raw[side])) widths[side] = raw[side];
      if (typeof raw.collapsed?.[side] === 'boolean') collapsed[side] = raw.collapsed[side];
    }
    return { widths, collapsed };
  } catch {
    return { widths: {}, collapsed: {} };
  }
}

function writeState(state) {
  try {
    localStorage.setItem(PANELS_KEY, JSON.stringify(state));
  } catch {
    // Storage disabled; the layout simply will not survive a reload.
  }
}
