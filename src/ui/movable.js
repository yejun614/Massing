/**
 * A floating panel you can move, for as long as the page lasts.
 *
 * The assistant panel sits over the canvas, which is the whole point of it —
 * you watch the diagram change while you talk about it. That also means it
 * covers part of the diagram, and which part is not something this code can
 * guess: it depends on where the drawing is, and the drawing moves. So the
 * panel moves too.
 *
 * **Nothing here is remembered.** Where it was dragged to holds until the page
 * is reloaded and no longer, at which point the stylesheet puts it back in the
 * bottom-right corner. That is deliberate rather than unfinished: a panel is
 * moved to get it off whatever is being looked at *now*, and a position that
 * outlived the drawing it was moved for would be a panel that opens somewhere
 * surprising for a reason nobody remembers.
 *
 * **Sizing is the browser's job, not this module's.** The panel carries
 * `resize: both` in CSS, so the grip, the cursor and the drag are the ones the
 * operating system already draws. Reimplementing that by hand would be sixty
 * lines to arrive back at a worse version of a native affordance.
 *
 * Moving has no such equivalent, so that part is here.
 */

/**
 * How much of the panel must stay on screen: enough of the title bar to grab.
 *
 * The panel may hang off any edge, because half of why you move one is to push
 * it mostly out of the way and leave a handle showing. What it may not do is
 * leave nothing to take hold of — so the constraint is on the header, not on
 * the card: a strip this wide stays within the viewport horizontally, and the
 * header band stays within it vertically.
 */
export const KEEP_VISIBLE = 96;

/** Roughly the header's height. The band that must remain reachable. */
export const HANDLE_HEIGHT = 44;

/**
 * A geometry with a handle still on screen, whatever it was before.
 *
 * Pure, and the only part of this worth testing on its own — every way a panel
 * gets out of reach goes through here. Dragged past an edge, or left in place
 * while the window narrowed underneath it: each arrives as a box with nothing
 * grabbable in view, and has to come back as one with a strip of title showing.
 *
 * Size is clamped before position, because a box wider than the viewport has
 * no position that would put all of it on screen, and clamping the other way
 * round would pin it to the left edge and then shrink it.
 *
 * The vertical rule is not the mirror of the horizontal one, and that asymmetry
 * is the point. Off the left or right, a sliver of header is still a handle.
 * Off the *top*, the header is the first thing to go and what is left below it
 * cannot be dragged at all — so `top` never goes negative.
 *
 * @param {{left:number, top:number, width:number, height:number}} box
 * @param {{width:number, height:number}} viewport
 * @param {{width:number, height:number}} min
 */
export function clampBox(box, viewport, min) {
  const width = Math.max(Math.min(box.width, viewport.width), Math.min(min.width, viewport.width));
  const height = Math.max(Math.min(box.height, viewport.height), Math.min(min.height, viewport.height));
  // Never ask for more visible strip than the panel is wide.
  const keep = Math.min(KEEP_VISIBLE, width);
  return {
    width,
    height,
    left: Math.max(keep - width, Math.min(box.left, viewport.width - keep)),
    top: Math.max(0, Math.min(box.top, Math.max(0, viewport.height - HANDLE_HEIGHT))),
  };
}

/**
 * @param {HTMLElement} el          the panel
 * @param {object} options
 * @param {HTMLElement} options.handle  what you grab to move it
 * @param {{width:number, height:number}} options.min
 * @param {MediaQueryList} options.fixedWhen  where moving is switched off
 */
export function makeMovable(el, { handle, min, fixedWhen }) {
  /**
   * Where it is, or null while it is still wherever the stylesheet put it.
   *
   * Null is the starting state on every load, and nothing writes it to
   * storage — see the note at the top of the file.
   *
   * @type {null | {left:number, top:number, width:number, height:number}}
   */
  let box = null;
  let dragging = null;

  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

  /**
   * Write the geometry onto the element.
   *
   * `right` and `bottom` are cleared because the stylesheet anchors the panel
   * to that corner, and a box with all four set would be a box whose width is
   * decided twice.
   */
  function apply() {
    if (!box || fixedWhen.matches) return;
    box = clampBox(box, viewport(), min);
    Object.assign(el.style, {
      left: `${box.left}px`,
      top: `${box.top}px`,
      right: 'auto',
      bottom: 'auto',
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
  }

  /** Hand the panel back to the stylesheet, for a narrow window. */
  function release() {
    for (const property of ['left', 'top', 'right', 'bottom', 'width', 'height']) {
      el.style.removeProperty(property);
    }
  }

  /** Where the panel is right now, whether or not it has been moved yet. */
  function measure() {
    const rect = el.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }

  // --- moving ---------------------------------------------------------------

  handle.addEventListener('pointerdown', (e) => {
    if (fixedWhen.matches || e.button !== 0) return;
    // The header carries the conversation menu, New and close. A drag that
    // started on one of those is a click that has not finished yet.
    if (e.target.closest('button, input, textarea, select, [role="listbox"]')) return;
    box = measure();
    dragging = { x: e.clientX, y: e.clientY, left: box.left, top: box.top };
    handle.setPointerCapture(e.pointerId);
    el.classList.add('is-moving');
    e.preventDefault();
  });

  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    box = {
      ...box,
      left: dragging.left + (e.clientX - dragging.x),
      top: dragging.top + (e.clientY - dragging.y),
    };
    apply();
  });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = null;
    el.classList.remove('is-moving');
    if (handle.hasPointerCapture?.(e.pointerId)) handle.releasePointerCapture(e.pointerId);
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);

  // --- resizing, which the browser does ------------------------------------

  /*
   * The observer fires for every layout that changes the box, including the
   * one `apply` just caused, so it only records a size when nothing else is
   * driving it — otherwise a drag would write its own geometry back on every
   * frame and a clamped box would fight the clamp.
   */
  let observing = false;
  const watcher = new ResizeObserver(() => {
    if (!observing || dragging || fixedWhen.matches) return;
    box = measure();
  });
  // Skip the observation that fires immediately on observe(), which reports
  // the stylesheet's size as though someone had chosen it.
  requestAnimationFrame(() => {
    observing = true;
  });
  watcher.observe(el);

  // --- the window changing underneath it ------------------------------------

  window.addEventListener('resize', () => {
    if (fixedWhen.matches) release();
    else apply();
  });

  const onBreakpoint = () => {
    if (fixedWhen.matches) release();
    else apply();
  };
  fixedWhen.addEventListener?.('change', onBreakpoint);

  apply();

  return {
    /** Put it back where the stylesheet wanted it. */
    reset() {
      box = null;
      release();
    },
    get box() {
      return box;
    },
  };
}
