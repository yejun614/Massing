/**
 * Draggable dividers for the two side panels.
 *
 * The dividers are not grid columns. They sit absolutely over the inner edge
 * of each panel, so the layout stays a plain three-column grid and the handle
 * cannot be scrolled away by a long palette.
 *
 * Widths are clamped twice: each panel has its own bounds, and the canvas is
 * guaranteed a minimum. Without that second clamp, dragging on a narrow window
 * can squeeze the drawing area to nothing — a state the user then has to drag
 * their way back out of.
 */

const PANELS_KEY = 'massing:panels';
const MIN = 168;
const MAX = 560;
const MIN_CANVAS = 320;
const STEP = 16; // keyboard nudge

const DEFAULTS = { left: 232, right: 232 };
const VARS = { left: '--panel-left-w', right: '--panel-right-w' };

export function createPanels({ root = document, onResize } = {}) {
  const widths = { ...DEFAULTS, ...readWidths() };
  apply('left');
  apply('right');

  for (const side of ['left', 'right']) {
    const handle = root.querySelector(`[data-region="resize-${side}"]`);
    if (handle) attach(handle, side);
  }

  function apply(side) {
    document.documentElement.style.setProperty(VARS[side], `${widths[side]}px`);
    const handle = root.querySelector(`[data-region="resize-${side}"]`);
    handle?.setAttribute('aria-valuenow', String(widths[side]));
  }

  /**
   * Clamp against both the panel's own bounds and the space left for the
   * canvas, measuring the *other* panel so the two cannot conspire to close
   * the drawing area between them.
   */
  function clamp(side, value) {
    const other = widths[side === 'left' ? 'right' : 'left'];
    const room = window.innerWidth - other - MIN_CANVAS;
    return Math.round(Math.max(MIN, Math.min(value, MAX, Math.max(MIN, room))));
  }

  function set(side, value) {
    const next = clamp(side, value);
    if (next === widths[side]) return;
    widths[side] = next;
    apply(side);
    saveWidths(widths);
    onResize?.();
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

  // A window that shrinks can invalidate a width that was fine when it was set.
  window.addEventListener('resize', () => {
    set('left', widths.left);
    set('right', widths.right);
  });

  return {
    get widths() {
      return { ...widths };
    },
    reset() {
      set('left', DEFAULTS.left);
      set('right', DEFAULTS.right);
    },
  };
}

function readWidths() {
  try {
    const raw = JSON.parse(localStorage.getItem(PANELS_KEY) ?? '{}');
    const clean = {};
    for (const side of ['left', 'right']) {
      if (Number.isFinite(raw[side])) clean[side] = raw[side];
    }
    return clean;
  } catch {
    return {};
  }
}

function saveWidths(widths) {
  try {
    localStorage.setItem(PANELS_KEY, JSON.stringify(widths));
  } catch {
    // Storage disabled; the widths simply will not survive a reload.
  }
}
