/** Keyboard reference, rendered into a native `<dialog>`. */

import { h, clear } from '../util/dom.js';
import { SHORTCUTS } from '../input/keyboard.js';

export function createShortcutsDialog(root) {
  const dialog = h('dialog', { class: 'sheet' });

  const rows = SHORTCUTS.map(([keys, what]) =>
    h('div', { class: 'sheet-row' }, [
      h('kbd', { text: keys }),
      h('span', { text: what }),
    ])
  );

  clear(dialog).append(
    h('h2', { class: 'sheet-title', text: 'Keyboard shortcuts' }),
    h('div', { class: 'sheet-grid' }, rows),
    h('button', {
      class: 'btn sheet-close',
      text: 'Close',
      onClick: () => dialog.close(),
    })
  );

  // Clicking the backdrop lands on the dialog element itself, not its content.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  root.append(dialog);
  return { open: () => dialog.showModal() };
}
