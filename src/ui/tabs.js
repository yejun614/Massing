/**
 * The tab strip, parked in the bottom-left corner of the canvas.
 *
 * A file with one drawing in it shows nothing but a small `+`, because a lone
 * tab labelled "Tab 1" is a row of chrome that tells you something you already
 * know. The strip appears the moment there is a choice to make.
 *
 * Renaming is a double-click on the tab itself rather than a menu: the label is
 * the only thing about a tab worth editing, and a context menu for one command
 * is a command nobody finds.
 */

import { h, clear, setClass, setAttrs } from '../util/dom.js';
import { UI_ICONS } from './icons-ui.js';

export function createTabStrip(root, { tabs, toaster, onChange } = {}) {
  const list = h('div', { class: 'tab-list', role: 'tablist', 'aria-label': 'Drawings in this file' });
  const addBtn = h('button', {
    class: 'btn btn-icon tab-add',
    title: 'Add another drawing to this file',
    'aria-label': 'Add another drawing to this file',
    html: UI_ICONS.plus ?? '+',
    onClick: () => {
      tabs.add();
      onChange?.();
    },
  });
  const strip = h('div', { class: 'tab-strip' }, [list, addBtn]);
  root.append(strip);

  /*
   * The strip sits inside the canvas, so its gestures have to stop here.
   *
   * Left alone they carry on to the drawing underneath: a click with the place
   * tool armed drops a block behind the strip, and a double-click — the one
   * that renames a tab — inserts a note under it and moves the caret into the
   * inspector, which blurs the rename field before anyone can type in it.
   *
   * Wheel is deliberately not in the list: zooming should still work with the
   * pointer anywhere over the canvas, including here.
   */
  for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu']) {
    strip.addEventListener(type, (e) => e.stopPropagation());
  }

  /** The tab being renamed, so a render does not yank the input away. */
  let renaming = -1;

  function beginRename(index, name) {
    renaming = index;
    render();
    const input = list.querySelector('.tab-rename');
    if (!input) return;
    input.value = name;
    input.select();
  }

  function endRename(index, value, commit) {
    // Escape ends the edit and then, by removing the field, causes the blur
    // that would commit it. Whoever gets here first wins.
    if (renaming !== index) return;
    renaming = -1;
    if (commit) tabs.rename(index, value);
    render();
    onChange?.();
  }

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

  function tabButton({ name, index, active }) {
    if (index === renaming) {
      return h('input', {
        class: 'tab-rename',
        type: 'text',
        'aria-label': 'Tab name',
        onBlur: (e) => endRename(index, e.target.value, true),
        onKeydown: (e) => {
          if (e.key === 'Enter') e.target.blur();
          // Escape has to clear `renaming` before the blur it causes, or the
          // blur handler commits the very edit that was just cancelled.
          else if (e.key === 'Escape') endRename(index, name, false);
          e.stopPropagation();
        },
      });
    }

    const label = h('span', { class: 'tab-name', text: name });
    const button = h('button', {
      class: `tab${active ? ' is-active' : ''}`,
      role: 'tab',
      'aria-selected': String(active),
      title: active ? `${name} — double-click to rename` : `Show ${name}`,
      onClick: () => {
        if (active) return;
        tabs.select(index);
        onChange?.();
      },
      onDblclick: () => beginRename(index, name),
      // Middle-click closes, as it does in every other strip of tabs.
      onAuxclick: (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        close(index, name);
      },
    }, [label]);

    // The two per-tab actions live on the active tab only. On every tab they
    // would be a row of eight small targets, most of them for drawings you are
    // not looking at.
    if (active) {
      button.append(
        h('span', {
          class: 'tab-act',
          role: 'button',
          tabindex: '0',
          title: `Duplicate ${name}`,
          html: UI_ICONS.copy ?? '⧉',
          onClick: (e) => {
            e.stopPropagation();
            tabs.duplicate(index);
            onChange?.();
          },
        }),
        h('span', {
          class: 'tab-act',
          role: 'button',
          tabindex: '0',
          title: `Close ${name}`,
          html: UI_ICONS.close ?? '×',
          onClick: (e) => {
            e.stopPropagation();
            close(index, name);
          },
        })
      );
    }
    return button;
  }

  function render() {
    const entries = tabs.list;
    // One drawing needs no strip; the `+` alone is the invitation to make a
    // second, and it is what puts the feature within reach of someone who has
    // never seen it.
    setClass(strip, 'is-single', entries.length <= 1);
    setAttrs(addBtn, {
      title: entries.length <= 1
        ? 'Add another drawing to this file'
        : `Add another drawing (${entries.length} so far)`,
    });
    clear(list).append(...entries.map(tabButton));
  }

  render();
  tabs.subscribe(render);
  return { render };
}
