/**
 * A floating panel you can move, and that remembers where you put it.
 *
 * The assistant panel sits over the canvas, which is the whole point of it —
 * you watch the diagram change while you talk about it. That also means it
 * covers part of the diagram, and which part is not something this code can
 * guess: it depends on where the drawing is, and the drawing moves. So the
 * panel moves too, and stays where it was left.
 *
 * **Sizing is the browser's job, not this module's.** The panel carries
 * `resize: both` in CSS, so the grip, the cursor and the drag are the ones the
 * operating system already draws, and this file only has to hear about the
 * result — which a `ResizeObserver` does. Reimplementing that by hand would be
 * sixty lines to arrive back at a worse version of a native affordance.
 *
 * Moving has no such equivalent, so that part is here.
 */

/**
 * A geometry that fits on screen, whatever it was before.
 *
 * Pure, and the only part of this worth testing on its own — every way a
 * panel gets lost goes through here. A window narrowed since the geometry was
 * stored, a laptop unplugged from a second monitor, a stored box from a
 * browser session on a bigger screen: each arrives as a box that is too large
 * or off the edge, and each has to come back as one that is neither.
 *
 * Size is clamped before position, because a box wider than the viewport has
 * no position that would put all of it on screen, and clamping the other way
 * round would pin it to the left edge and then shrink it.
 *
 * @param {{left:number, top:number, width:number, height:number}} box
 * @param {{width:number, height:number}} viewport
 * @param {{width:number, height:number}} min
 */
export function clampBox(box, viewport, min) {
  const width = Math.max(Math.min(box.width, viewport.width), Math.min(min.width, viewport.width));
  const height = Math.max(Math.min(box.height, viewport.height), Math.min(min.height, viewport.height));
  return {
    width,
    height,
    left: Math.max(0, Math.min(box.left, viewport.width - width)),
    top: Math.max(0, Math.min(box.top, viewport.height - height)),
  };
}

/** Whether a stored value is a box at all, rather than whatever else is there. */
export function isBox(value) {
  return Boolean(value) && typeof value === 'object' &&
    ['left', 'top', 'width', 'height'].every((k) => Number.isFinite(value[k]));
}

/**
 * @param {HTMLElement} el          the panel
 * @param {object} options
 * @param {HTMLElement} options.handle  what you grab to move it
 * @param {string} options.storageKey
 * @param {{width:number, height:number}} options.min
 * @param {MediaQueryList} options.fixedWhen  where moving is switched off
 */
export function makeMovable(el, { handle, storageKey, min, fixedWhen }) {
  /** @type {null | {left:number, top:number, width:number, height:number}} */
  let box = read();
  let dragging = null;

  function read() {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
      return isBox(stored) ? stored : null;
    } catch {
      return null;
    }
  }

  function save() {
    try {
      if (box) localStorage.setItem(storageKey, JSON.stringify(box));
    } catch {
      // Storage walled off or full. The panel still moves; it just will not be
      // where you left it tomorrow, which is not worth an error message.
    }
  }

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
    save();
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
    save();
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
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* nothing worth saying */
      }
    },
    get box() {
      return box;
    },
  };
}
