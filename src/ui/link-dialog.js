/**
 * "This link leaves the diagram. Go there?"
 *
 * A block in a diagram does not look like a link, and that is the problem this
 * sheet exists for. A diagram travels — it is published to a URL, embedded in
 * somebody else's article, mailed around as a file — so the person clicking is
 * very often not the person who wrote the link, and they have none of the
 * signals a browser gives them for an ordinary anchor: no status bar, no
 * underline, no address to read before they commit.
 *
 * So the address is shown, whole, before anything opens. Whole and unstyled:
 * the one thing this sheet must never do is present a shortened or prettified
 * version of where you are about to go, which is precisely the trick it is
 * here to defeat. The host is called out above it because that is the part
 * that decides who you are talking to, and it is the part a long URL buries.
 *
 * Opening is the secondary action. The primary one is not going, because
 * somebody reading this sheet at all is somebody who has already been
 * surprised.
 */

import { h, setText } from '../util/dom.js';
import { hostOf } from '../core/link.js';

export function createLinkDialog(root) {
  /** Resolves once the sheet is answered; null when nothing is open. */
  let settle = null;

  const host = h('p', { class: 'link-ask-host' });
  const address = h('p', { class: 'link-ask-url' });
  const from = h('p', { class: 'sheet-text link-ask-from' });

  const open = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    text: 'Open in a new tab',
    onClick: () => answer(true),
  });
  const cancel = h('button', {
    class: 'btn',
    type: 'button',
    text: 'Stay here',
    onClick: () => answer(false),
  });

  const dialog = h('dialog', { class: 'sheet sheet-narrow link-ask' }, [
    h('h2', { class: 'sheet-title', text: 'This link leaves the diagram' }),
    from,
    host,
    address,
    h('p', { class: 'sheet-text', text:
      'Massing cannot vouch for where it goes. Read the address above before opening it.' }),
    h('div', { class: 'sheet-actions' }, [cancel, open]),
  ]);

  /*
   * Escape and the backdrop both mean "no".
   *
   * A confirmation whose dismissal is ambiguous is not a confirmation, and
   * `dialog` fires `close` for every way out — including ones this file never
   * wrote a handler for. Answering `false` here means every one of them is a
   * refusal by construction rather than by enumeration.
   */
  dialog.addEventListener('close', () => answer(false));

  function answer(go) {
    const done = settle;
    settle = null;
    if (dialog.open) dialog.close();
    done?.(go);
  }

  /**
   * @param {string} href the resolved address, exactly as it will be opened
   * @param {{label?: string}} options what was clicked, when it has a name
   * @returns {Promise<boolean>} whether to go
   */
  function ask(href, { label = '' } = {}) {
    // Answer the sheet already open before replacing what it says, so a caller
    // waiting on it is never left holding a promise nothing will settle.
    answer(false);
    setText(host, hostOf(href));
    setText(address, href);
    from.textContent = label ? `You clicked "${label}".` : 'You clicked a linked element.';
    from.hidden = false;
    dialog.showModal();
    // Focused so Enter refuses rather than accepts: the safe answer is the one
    // that should be one keystroke away.
    cancel.focus();
    return new Promise((resolve) => {
      settle = resolve;
    });
  }

  root.append(dialog);
  return { ask };
}
