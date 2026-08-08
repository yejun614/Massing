/**
 * Everything this browser has worked on, in one list.
 *
 * A diagram is usually several things at once — text in storage, a file on
 * disk, an address it was published to — and the point of the list is that
 * those are one row rather than three places to look. Each row says which of
 * them it actually has, because that decides what opening it will do: read it
 * back instantly, ask for the file again, or fetch it from the deployment.
 */

import { h, clear, copyText } from '../util/dom.js';

/** "3 minutes ago", roughly, without a formatting library. */
function ago(at) {
  const seconds = Math.max(0, Math.round((Date.now() - (at ?? 0)) / 1000));
  if (seconds < 90) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} d ago` : new Date(at).toLocaleDateString();
}

export function createLibraryDialog(root, { library, onOpen, onDelete, toaster }) {
  const dialog = h('dialog', { class: 'sheet sheet-wide' });
  const list = h('div', { class: 'library-list' });

  function row(entry) {
    const isCurrent = entry.id === library.currentId;
    const published = entry.published;

    /*
     * What this row can actually do, said plainly. "Saved" and "was saved
     * once" are different promises, and a list that showed them the same way
     * would be a list you cannot trust to open anything.
     */
    const marks = [
      entry.text ? ['stored', 'Held in this browser — opens instantly'] : null,
      entry.fileName ? ['file', `From ${entry.fileName}`] : null,
      published && !published.gone ? ['published', `At ${published.url}`] : null,
      published?.gone ? ['expired', 'The published link is gone'] : null,
      !entry.text && entry.evicted ? ['evicted', 'Too large to keep here; open it from its file or link'] : null,
    ].filter(Boolean);

    const open = h('button', {
      class: 'library-open',
      type: 'button',
      title: 'Open this diagram',
      onClick: () => {
        dialog.close();
        onOpen?.(entry);
      },
    }, [
      h('span', { class: 'library-title', text: entry.title || 'Untitled diagram' }),
      h('span', { class: 'library-meta', text:
        [ago(entry.at),
         entry.blocks ? `${entry.blocks} blocks` : null,
         entry.tabs > 1 ? `${entry.tabs} drawings` : null].filter(Boolean).join(' · ') }),
      h('span', { class: 'library-marks' }, marks.map(([name, why]) =>
        h('span', { class: `library-mark is-${name}`, title: why, text: name })
      )),
    ]);

    const actions = [];
    if (published && !published.gone) {
      actions.push(h('button', {
        class: 'btn library-action',
        type: 'button',
        title: `Copy ${published.url}`,
        text: 'Link',
        onClick: async (e) => {
          const ok = await copyText(published.url);
          e.target.textContent = ok ? 'Copied' : 'Failed';
          setTimeout(() => { e.target.textContent = 'Link'; }, 1400);
        },
      }));
    }
    actions.push(h('button', {
      class: 'btn library-action library-forget',
      type: 'button',
      title: 'Remove from this list. The file and any published copy are untouched.',
      'aria-label': `Forget ${entry.title}`,
      text: '✕',
      onClick: () => {
        onDelete?.(entry);
        paint();
      },
    }));

    return h('div', { class: `library-row${isCurrent ? ' is-current' : ''}` }, [open, ...actions]);
  }

  function paint() {
    clear(list);
    const entries = library.entries;
    if (!entries.length) {
      list.append(h('p', { class: 'sheet-text', text:
        'Nothing yet. Diagrams appear here as you save, open or publish them.' }));
      return;
    }
    for (const entry of entries) list.append(row(entry));
  }

  clear(dialog).append(
    h('h2', { class: 'sheet-title', text: 'Your diagrams' }),
    h('p', { class: 'sheet-text', text:
      'Kept in this browser. Large diagrams keep their record but not their contents, ' +
      'and open from their file or published link instead.' }),
    list,
    h('div', { class: 'sheet-actions' }, [
      h('button', { class: 'btn', type: 'button', text: 'Close', onClick: () => dialog.close() }),
    ])
  );

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  root.append(dialog);

  return {
    open() {
      paint();
      dialog.showModal();
    },
  };
}
