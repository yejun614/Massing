/**
 * The last thing between unsaved work and the X button.
 *
 * The shell cannot answer this on its own — whether there is unsaved work is
 * the page's to know, and so is what saving it means. So the window refuses to
 * close, says so down the push channel, and waits: the only thing that actually
 * closes it is `POST /__massing/close`, which is sent from here.
 *
 * Three answers, because "no" is two different things. Discarding the work and
 * keeping the app open are opposite decisions and a two-button dialog would
 * have to leave one of them out.
 *
 * Desktop-only, like the rest of `desktop/web/`. A browser tab cannot offer
 * this: `beforeunload` gets one dialog, written by the browser, with the
 * browser's own two buttons.
 */

const API = '/__massing';

function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'text') el.textContent = String(value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [children].flat()) if (child) el.append(child);
  return el;
}

const STYLE = `
.close-actions { display: flex; align-items: center; gap: 8px; margin-top: 18px; }
/* The one that loses work sits apart from the two that do not. */
.close-actions .btn-cancel { margin-left: auto; }
.close-discard { color: var(--danger); }
.close-discard:hover:not(:disabled) { border-color: var(--danger); }
`;

let dialog = null;

const close = () => fetch(`${API}/close`, { method: 'POST' }).catch(() => {});

/**
 * Ask, unless there is nothing to ask about.
 *
 * A clean document closes straight away: a dialog whose only answer is "yes,
 * obviously" is a dialog that teaches people to dismiss dialogs.
 */
export async function confirmClose() {
  const store = window.massing?.store;
  const io = window.massing?.io;
  if (!store?.state?.dirty) {
    close();
    return;
  }

  if (!dialog) {
    document.head.append(h('style', { text: STYLE }));
    dialog = h('dialog', { class: 'sheet sheet-narrow' });
    // Neither a click outside nor Escape may answer this one. Both would have
    // to mean something, and the two harmless meanings are already buttons.
    dialog.addEventListener('cancel', (e) => e.preventDefault());
    document.body.append(dialog);
  }

  const title = store.state.doc?.meta?.title?.trim();
  const buttons = [];
  /** Nothing is answered twice, and nothing is answered while a save is open. */
  const busy = (on) => buttons.forEach((b) => { b.disabled = on; });

  const discard = h('button', {
    class: 'btn close-discard',
    type: 'button',
    title: 'Close, and lose the changes since the last save',
    text: 'Close without saving',
    onClick: () => {
      dialog.close();
      close();
    },
  });
  const cancel = h('button', {
    class: 'btn btn-cancel',
    type: 'button',
    text: 'Cancel',
    onClick: () => dialog.close(),
  });
  const save = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    text: 'Save',
    onClick: async () => {
      busy(true);
      // `save` opens the native dialog when the document has never been
      // written anywhere, and answers false when that dialog is dismissed.
      // Dismissing it is not an instruction to throw the work away, so the app
      // stays open and this dialog stays with it.
      const saved = await io?.save().catch(() => false);
      busy(false);
      if (!saved) return;
      dialog.close();
      close();
    },
  });
  buttons.push(discard, cancel, save);

  dialog.replaceChildren(
    h('h2', { class: 'sheet-title', text: 'Save before closing?' }),
    h('p', {
      class: 'sheet-text',
      text: title
        ? `"${title}" has changes that are not saved. Closing now loses them.`
        : 'This diagram has changes that are not saved. Closing now loses them.',
    }),
    h('div', { class: 'close-actions' }, [discard, cancel, save])
  );

  if (!dialog.open) {
    dialog.showModal();
    // The safe answer is the one under the finger: pressing the X a second
    // time, or Enter out of habit, must not be what discards the work.
    save.focus();
  }
}
