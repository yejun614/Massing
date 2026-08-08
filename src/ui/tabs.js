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
 * is the current one, and everything you can do *to* a drawing — rename,
 * duplicate, close — is in a popover opened from the tab itself.
 */

import { h, clear, setAttrs } from '../util/dom.js';
import { UI_ICONS } from './icons-ui.js';

export function createTabStrip(root, { tabs, toaster, onChange } = {}) {
  /*
   * The moving part is one element, not a border on each tab.
   *
   * It slides from the old tab to the new one, which is what makes a switch
   * read as "this row, now here" rather than as two independent repaints. It
   * sits behind the tabs and is measured from them after every render, so it
   * follows a rename or a close as readily as a switch.
   */
  const marker = h('div', { class: 'tab-marker', 'aria-hidden': 'true' });
  const list = h('div', { class: 'tab-list', role: 'tablist', 'aria-label': 'Drawings in this file' });
  const strip = h('div', { class: 'tab-strip' }, [list]);
  root.append(strip);

  /*
   * The strip sits inside the canvas, so its gestures have to stop here.
   *
   * Left alone they carry on to the drawing underneath: a click with the place
   * tool armed drops a block behind the strip, and a double-click on a tab
   * writes a note under it and moves the caret into the inspector, which used
   * to close the rename field before anyone could type in it.
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

  const closeBtn = h('button', {
    class: 'btn tab-pop-btn is-danger',
    type: 'button',
    onClick: () => {
      const at = editing;
      const name = tabs.list[at]?.name ?? '';
      // Committing first: closing a drawing is not a reason to lose the rename
      // that was typed a moment ago, since it can be put straight back.
      closePopover({ commit: true });
      close(at, name);
    },
  }, [h('span', { class: 'tab-pop-icon', html: UI_ICONS.close }), 'Close']);

  const popover = h('div', {
    class: 'tab-pop is-hidden',
    role: 'dialog',
    'aria-label': 'Drawing',
  }, [nameField, h('div', { class: 'tab-pop-actions' }, [duplicateBtn, closeBtn])]);
  strip.append(popover);

  function openPopover(index) {
    editing = index;
    const entry = tabs.list[index];
    nameField.value = entry?.name ?? '';
    popover.classList.remove('is-hidden');
    // Left-aligned with its own tab, and never past the right edge of the
    // strip — a popover that opens off-screen is a popover nobody can use.
    const tab = list.querySelectorAll('.tab')[index];
    const offset = tab
      ? tab.getBoundingClientRect().left - strip.getBoundingClientRect().left
      : 0;
    popover.style.left = `${Math.max(0, Math.min(offset, strip.clientWidth - popover.offsetWidth))}px`;
    closeBtn.disabled = tabs.count <= 1;
    setAttrs(closeBtn, {
      title: tabs.count <= 1
        ? 'The last drawing cannot be closed — press New for an empty file'
        : 'Close this drawing',
    });
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

  // --- closing a drawing ----------------------------------------------------

  /**
   * Close one, and offer it back.
   *
   * Not a confirmation dialog. Closing a drawing is outside the undo history —
   * the histories are per drawing and the closed one takes its own with it — so
   * something has to catch a mis-click, and a toast that puts it back catches
   * it without stopping the nine times out of ten that were meant. It is the
   * same bargain `io.js` strikes after a reload over unsaved work.
   */
  function close(index, name) {
    const gone = tabs.remove(index);
    if (!gone) return;
    onChange?.();
    const el = toaster?.warn(`Closed "${name}". Click here to put it back.`);
    if (!el) return;
    el.style.pointerEvents = 'auto';
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      tabs.insert(index, gone);
      onChange?.();
      el.remove();
    });
  }

  // --- rendering ------------------------------------------------------------

  function tabButton({ name, index, active }) {
    return h('button', {
      class: `tab${active ? ' is-active' : ''}${index === editing ? ' is-editing' : ''}`,
      role: 'tab',
      'aria-selected': String(active),
      title: active ? `${name} — click again to rename, duplicate or close` : `Show ${name}`,
      onClick: () => {
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
      // Middle-click closes, as it does in every other strip of tabs.
      onAuxclick: (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        close(index, name);
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
