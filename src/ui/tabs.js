/**
 * The tab strip, parked in the bottom-left corner of the canvas.
 *
 * It is always there, one drawing or five, and it always looks the same: a row
 * of names and a `+` on the end, on a surface of its own. Both of those are
 * corrections. Hiding the strip until a second drawing existed left a lone `+`
 * floating over the diagram, which vanished outright over a white drawing in
 * dark mode — an icon with no background of its own is only as visible as
 * whatever happens to be behind it. And giving the active tab a pair of action
 * buttons meant every switch resized two tabs and shifted the whole row under
 * the pointer.
 *
 * So a tab is a name and nothing else, its width does not depend on whether it
 * is the current one, and everything you can do *to* a drawing — rename, move,
 * duplicate, delete — is in a popover opened from the tab itself. Dragging a
 * tab sideways reorders the file, which is the other way to do the moving.
 */

import { h, clear, setAttrs } from '../util/dom.js';
import { UI_ICONS } from './icons-ui.js';

/** How far a press has to travel before it is a drag rather than a click. */
const DRAG_SLOP = 4;

export function createTabStrip(root, { tabs, toaster, onChange } = {}) {
  /*
   * The moving part is one element, not a border on each tab.
   *
   * It slides from the old tab to the new one, which is what makes a switch
   * read as "this row, now here" rather than as two independent repaints. It
   * sits behind the tabs and is measured from them after every render, so it
   * follows a rename, a reorder or a delete as readily as a switch.
   */
  const marker = h('div', { class: 'tab-marker', 'aria-hidden': 'true' });
  const list = h('div', { class: 'tab-list', role: 'tablist', 'aria-label': 'Drawings in this file' });
  const strip = h('div', { class: 'tab-strip' }, [list]);
  root.append(strip);

  /*
   * The strip sits inside the canvas, so its gestures have to stop here.
   *
   * Left alone they carry on to the drawing underneath: a click with the place
   * tool armed drops a block behind the strip, a drag along the row pans the
   * diagram behind it, and a double-click on a tab writes a note under it and
   * moves the caret into the inspector, which used to close the rename field
   * before anyone could type in it.
   *
   * Wheel is deliberately not in the list: zooming should still work with the
   * pointer anywhere over the canvas, including here.
   */
  for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu']) {
    strip.addEventListener(type, (e) => e.stopPropagation());
  }

  // --- the popover ----------------------------------------------------------

  /** Which tab the popover is open on, or -1. */
  let editing = -1;

  const nameField = h('input', {
    class: 'tab-pop-name',
    type: 'text',
    'aria-label': 'Tab name',
    onKeydown: (e) => {
      if (e.key === 'Enter') closePopover({ commit: true });
      else if (e.key === 'Escape') closePopover({ commit: false });
      // The canvas listens for single letters, and `t` is the note tool.
      e.stopPropagation();
    },
  });

  /** The keyboard's way to do what dragging the tab does. */
  const moveBtn = (icon, label, step) =>
    h('button', {
      class: 'btn btn-icon tab-pop-move',
      type: 'button',
      title: label,
      'aria-label': label,
      html: UI_ICONS[icon],
      onClick: () => {
        const at = editing;
        // The name goes in first: it is on screen, it has been typed, and the
        // popover stays open so that a second nudge does not need a second
        // click on the tab.
        tabs.rename(at, nameField.value);
        if (tabs.move(at, at + step)) {
          editing = at + step;
          onChange?.();
          positionPopover();
        }
      },
    });

  const leftBtn = moveBtn('chevronLeft', 'Move this drawing earlier', -1);
  const rightBtn = moveBtn('chevronRight', 'Move this drawing later', 1);

  const duplicateBtn = h('button', {
    class: 'btn tab-pop-btn',
    type: 'button',
    onClick: () => {
      const at = editing;
      closePopover({ commit: true });
      tabs.duplicate(at);
      onChange?.();
    },
  }, [h('span', { class: 'tab-pop-icon', html: UI_ICONS.copy }), 'Duplicate']);

  const deleteBtn = h('button', {
    class: 'btn tab-pop-btn is-danger',
    type: 'button',
    onClick: () => {
      const at = editing;
      const name = tabs.list[at]?.name ?? '';
      // Committing first: deleting a drawing is not a reason to lose the rename
      // that was typed a moment ago, since it can be put straight back.
      closePopover({ commit: true });
      deleteTab(at, name);
    },
  }, [h('span', { class: 'tab-pop-icon', html: UI_ICONS.trash }), 'Delete']);

  const popover = h('div', {
    class: 'tab-pop is-hidden',
    role: 'dialog',
    'aria-label': 'Drawing',
  }, [
    h('div', { class: 'tab-pop-row' }, [nameField, leftBtn, rightBtn]),
    h('div', { class: 'tab-pop-actions' }, [duplicateBtn, deleteBtn]),
  ]);
  strip.append(popover);

  /** Left-aligned with its own tab, and never past the edge of the strip. */
  function positionPopover() {
    const tab = list.querySelectorAll('.tab')[editing];
    const offset = tab
      ? tab.getBoundingClientRect().left - strip.getBoundingClientRect().left
      : 0;
    popover.style.left = `${Math.max(0, Math.min(offset, strip.clientWidth - popover.offsetWidth))}px`;
    leftBtn.disabled = editing <= 0;
    rightBtn.disabled = editing < 0 || editing >= tabs.count - 1;
    deleteBtn.disabled = tabs.count <= 1;
    setAttrs(deleteBtn, {
      title: tabs.count <= 1
        ? 'The last drawing cannot be deleted — press New for an empty file'
        : 'Delete this drawing',
    });
  }

  function openPopover(index) {
    editing = index;
    nameField.value = tabs.list[index]?.name ?? '';
    popover.classList.remove('is-hidden');
    positionPopover();
    nameField.focus();
    nameField.select();
    render();
  }

  function closePopover({ commit }) {
    if (editing < 0) return;
    const at = editing;
    editing = -1;
    popover.classList.add('is-hidden');
    if (commit) tabs.rename(at, nameField.value);
    render();
    onChange?.();
  }

  // Anywhere else on the page dismisses it, keeping what was typed — the same
  // bargain as clicking away from the document title in the toolbar.
  document.addEventListener('pointerdown', () => closePopover({ commit: true }));

  // --- deleting a drawing ---------------------------------------------------

  /**
   * Delete one, and offer it back.
   *
   * Not a confirmation dialog. Deleting a drawing is outside the undo history —
   * the histories are per drawing and the deleted one takes its own with it —
   * so something has to catch a mis-click, and a toast that puts it back
   * catches it without stopping the nine times out of ten that were meant. It
   * is the same bargain `io.js` strikes after a reload over unsaved work.
   */
  function deleteTab(index, name) {
    const gone = tabs.remove(index);
    if (!gone) return;
    onChange?.();
    const el = toaster?.warn(`Deleted "${name}". Click here to put it back.`);
    if (!el) return;
    el.style.pointerEvents = 'auto';
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      tabs.insert(index, gone);
      onChange?.();
      el.remove();
    });
  }

  // --- dragging a tab along the row -----------------------------------------

  /**
   * Reordering, done entirely in transforms until the pointer comes up.
   *
   * Nothing is committed mid-drag. Re-rendering the row on every crossing would
   * destroy the element under the pointer — taking the pointer capture with it
   * — and the list is the one thing that must not move while it is being
   * rearranged. So the dragged tab follows the pointer, its neighbours slide by
   * exactly its width (which is what a reflow would have moved them by, so the
   * preview is the answer rather than an impression of it), and `move` is
   * called once at the end.
   */
  let drag = null;
  /** Set when a press turned into a drag, so the click it ends with is not one. */
  let dragged = false;

  function startDrag(e, index) {
    if (e.button !== 0 || tabs.count < 2) return;
    const tab = e.currentTarget;
    // Cleared here rather than only in the click that follows, so a drag that
    // ended somewhere without one cannot swallow the next real click.
    dragged = false;
    drag = {
      index,
      to: index,
      startX: e.clientX,
      moving: false,
      tab,
      // Measured once: the layout does not change until the drag is over.
      others: [...list.querySelectorAll('.tab')].map((el) => ({
        el,
        left: el.offsetLeft,
        mid: el.offsetLeft + el.offsetWidth / 2,
      })),
      width: tab.offsetWidth + 2, // the gap between tabs is part of the step
    };
    try {
      tab.setPointerCapture(e.pointerId);
    } catch {
      // No capture is a worse drag, not a broken one: the moves still arrive
      // while the pointer is over the row, which is most of the gesture.
    }
  }

  function onDrag(e) {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    if (!drag.moving) {
      if (Math.abs(dx) < DRAG_SLOP) return;
      drag.moving = true;
      dragged = true;
      list.classList.add('is-dragging');
      drag.tab.classList.add('is-dragged');
      closePopover({ commit: true });
      // `closePopover` renders, and a render is refused mid-drag, so the class
      // the popover left on this tab has to come off by hand.
      drag.tab.classList.remove('is-editing');
    }

    drag.tab.style.transform = `translateX(${dx}px)`;

    // Where it would land: the neighbour whose middle the tab has passed.
    const centre = drag.others[drag.index].mid + dx;
    let to = drag.index;
    for (const [i, other] of drag.others.entries()) {
      if (i === drag.index) continue;
      if (i < drag.index && centre < other.mid) { to = Math.min(to, i); }
      if (i > drag.index && centre > other.mid) { to = Math.max(to, i); }
    }
    if (to !== drag.to) {
      drag.to = to;
      shiftNeighbours();
    }
    // The pill marks a drawing, not a place in the row, so it goes wherever
    // that drawing's tab has gone — following the pointer when the tab being
    // dragged is the one you are looking at.
    const under = drag.others[tabs.active];
    if (under) {
      marker.style.transform = `translateX(${under.left + shiftFor(tabs.active, dx)}px)`;
    }
  }

  /** How far tab `i` has been displaced, mid-drag. */
  function shiftFor(i, dx) {
    const { index, to, width } = drag;
    if (i === index) return dx;
    if (i > index && i <= to) return -width;
    if (i < index && i >= to) return width;
    return 0;
  }

  /** Slide everything between the tab's old place and its new one out of the way. */
  function shiftNeighbours() {
    for (const [i, other] of drag.others.entries()) {
      if (i === drag.index) continue;
      const shift = shiftFor(i, 0);
      other.el.style.transform = shift ? `translateX(${shift}px)` : '';
    }
  }

  function endDrag(e) {
    if (!drag) return;
    const { index, to, moving, tab } = drag;
    try {
      tab.releasePointerCapture(e.pointerId);
    } catch {
      // The pointer was already released, which is not a problem to report.
    }
    drag = null;
    list.classList.remove('is-dragging');
    tab.classList.remove('is-dragged');
    if (!moving) return;
    if (to !== index) {
      tabs.move(index, to);
      onChange?.();
    }
    // Whether or not anything moved, the transforms were a preview and the
    // render that follows is the real thing.
    render();
  }

  // --- rendering ------------------------------------------------------------

  function tabButton({ name, index, active }) {
    return h('button', {
      class: `tab${active ? ' is-active' : ''}${index === editing ? ' is-editing' : ''}`,
      role: 'tab',
      'aria-selected': String(active),
      title: active
        ? `${name} — click again to rename, duplicate or delete. Drag to reorder`
        : `Show ${name}`,
      onPointerdown: (e) => startDrag(e, index),
      onPointermove: onDrag,
      onPointerup: endDrag,
      onPointercancel: endDrag,
      onClick: () => {
        // The click that ends a drag is not a click on the tab.
        if (dragged) {
          dragged = false;
          return;
        }
        // A click on the drawing you are already looking at cannot mean "show
        // it", so it means "do something with it". A click on any other tab
        // means switch, and nothing else — a popover in the way of that would
        // be a menu appearing every time you changed drawings.
        if (active) openPopover(index);
        else {
          closePopover({ commit: true });
          tabs.select(index);
          onChange?.();
        }
      },
      onDblclick: () => openPopover(index),
      // Middle-click deletes, as it closes in every other strip of tabs.
      onAuxclick: (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        deleteTab(index, name);
      },
    }, [h('span', { class: 'tab-name', text: name })]);
  }

  const addBtn = h('button', {
    class: 'tab-add',
    type: 'button',
    'aria-label': 'Add another drawing to this file',
    html: UI_ICONS.plus,
    onClick: () => {
      closePopover({ commit: true });
      tabs.add();
      onChange?.();
    },
  });

  /** Put the marker under the active tab, and let CSS carry it there. */
  function placeMarker() {
    const tab = list.querySelector('.tab.is-active');
    if (!tab) return;
    marker.style.transform = `translateX(${tab.offsetLeft}px)`;
    marker.style.width = `${tab.offsetWidth}px`;
    // The first placement is where the marker *is*, not somewhere it slid to,
    // so the transition is switched on only once it has been put somewhere.
    if (!marker.classList.contains('is-ready')) {
      requestAnimationFrame(() => marker.classList.add('is-ready'));
    }
  }

  function render() {
    // A render mid-drag would pull the element out from under the pointer.
    if (drag?.moving) return;
    const entries = tabs.list;
    setAttrs(addBtn, {
      title: `Add another drawing to this file (${entries.length} so far)`,
    });
    clear(list).append(marker, ...entries.map(tabButton), addBtn);
    placeMarker();
  }

  render();
  tabs.subscribe(render);
  return { render };
}
