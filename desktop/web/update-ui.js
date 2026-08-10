/**
 * "There is a new version. Now?"
 *
 * The shell used to answer that question itself: the launch check downloaded
 * and installed whatever it found, which on Windows means the app closes and an
 * installer nobody asked for appears over whatever was on screen. An update is
 * not a background task when it ends the process you are working in, so this is
 * the dialog that stands between finding one and installing it.
 *
 * Three answers, because "not now" is really two different things. **Update**
 * installs. **Skip this version** is a decision about this release, and the
 * shell writes it down so the launch check stops raising it — the Help menu
 * still offers it, since somebody who went looking is not being interrupted.
 * **Remind me later** decides nothing, and the next launch asks again.
 *
 * Desktop-only, like the rest of `desktop/web/`.
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
.update-versions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 2px 0 14px;
  font-size: 12.5px;
  color: var(--ink-muted);
}
.update-from { text-decoration: line-through; }
.update-to { color: var(--ink); font-weight: 650; font-size: 15px; }
.update-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
/* The two refusals are one decision apart, so they read as a pair and the
   button that does something stands away from them. */
.update-actions .btn-primary { margin-left: auto; }
`;

let dialog = null;
/** Which version is on offer, so the buttons cannot answer about another. */
let offered = null;

const post = (route, body) =>
  fetch(`${API}/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }).catch(() => {
    // Nothing useful to say: the only thing on the other end is the shell this
    // page is running inside, and if that is gone the dialog is the least of it.
  });

/**
 * @param {{version: string, current: string, restarts: boolean}} update
 */
export function showUpdate(update) {
  if (!update?.version) return;
  offered = update.version;

  if (!dialog) {
    document.head.append(h('style', { text: STYLE }));
    dialog = h('dialog', { class: 'sheet sheet-narrow' });
    /*
     * No light-dismiss, and no Escape.
     *
     * Every other sheet in the editor closes on a click outside because
     * closing it decides nothing. This one has three answers and dismissing it
     * would silently pick a fourth, so the way out is a button that says what
     * it does. `cancel` is what Escape fires; treating it as "later" would be
     * a guess about which of the two refusals was meant.
     */
    dialog.addEventListener('cancel', (e) => e.preventDefault());
    document.body.append(dialog);
  }

  const close = () => {
    offered = null;
    dialog.close();
  };

  dialog.replaceChildren(
    h('h2', { class: 'sheet-title', text: 'A new version of Massing' }),
    h('div', { class: 'update-versions' }, [
      h('span', { class: 'update-from', text: update.current ?? '' }),
      h('span', { text: '→' }),
      h('span', { class: 'update-to', text: update.version }),
    ]),
    h('p', {
      class: 'sheet-text',
      text: update.restarts
        ? 'Installing it closes Massing, runs the installer and opens it again. ' +
          'Save anything you are in the middle of first.'
        : 'It is downloaded and put in place in the background, and is what starts ' +
          'the next time you open Massing.',
    }),
    h('div', { class: 'update-actions' }, [
      h('button', {
        class: 'btn',
        type: 'button',
        title: `Do not raise ${update.version} again. The Help menu still offers it.`,
        text: 'Skip this version',
        onClick: () => {
          post('update/skip', { version: offered });
          close();
        },
      }),
      h('button', {
        class: 'btn',
        type: 'button',
        title: 'Ask again the next time Massing starts',
        text: 'Remind me later',
        onClick: close,
      }),
      h('button', {
        class: 'btn btn-primary',
        type: 'button',
        text: 'Update',
        onClick: () => {
          post('update/install');
          close();
        },
      }),
    ])
  );

  // A second offer while the first is open would throw; the content has been
  // replaced above, which is the update that matters.
  if (!dialog.open) dialog.showModal();
}
