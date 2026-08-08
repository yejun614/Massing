/**
 * Asking for feedback, once.
 *
 * The moment to ask is just after someone has exported an image, because that
 * is the point at which the editor has actually done the thing they came for
 * and they have an opinion worth having. Every other moment is an interruption.
 *
 * Once means once, and the flag is written the instant the prompt is shown
 * rather than when it is dismissed. Closing it, ignoring it, reloading the page
 * mid-prompt — all of those are answers, and none of them is an invitation to
 * ask again. A browser with storage disabled gets it once per session, which is
 * the closest thing to honouring the promise that is available there.
 */

import { h } from '../util/dom.js';
import { ISSUES_URL } from '../data/links.js';

const ASKED_KEY = 'massing:feedback-asked:v1';

function alreadyAsked() {
  try {
    return localStorage.getItem(ASKED_KEY) === '1';
  } catch {
    return false;
  }
}

function markAsked() {
  try {
    localStorage.setItem(ASKED_KEY, '1');
  } catch {
    // Storage disabled. The prompt simply does not outlive the session.
  }
}

export function createFeedbackPrompt(root) {
  let asked = alreadyAsked();
  const dialog = h('dialog', { class: 'sheet sheet-narrow' });

  dialog.append(
    h('h2', { class: 'sheet-title', text: 'Getting on with it?' }),
    h('p', { class: 'sheet-text', text:
      'If Massing is working for you — or especially if it is not — the issue ' +
      'tracker is where that goes. Bugs, missing component types, diagrams that ' +
      'came out wrong: all of it is useful.' }),
    h('div', { class: 'sheet-actions' }, [
      h('button', { class: 'btn', text: 'Not now', onClick: () => dialog.close() }),
      h('a', {
        class: 'btn btn-primary',
        href: ISSUES_URL,
        target: '_blank',
        rel: 'noopener noreferrer',
        text: 'Open an issue',
        onClick: () => dialog.close(),
      }),
    ])
  );

  // Clicking the backdrop lands on the dialog element itself, not its content.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  root.append(dialog);

  return {
    /**
     * Show it, if it has never been shown. A no-op every time after that.
     *
     * Deferred a beat so it does not open on top of the browser's own download
     * bar or share sheet, which is the tail end of the export that prompted it.
     */
    maybeAsk() {
      if (asked) return false;
      asked = true;
      markAsked();
      setTimeout(() => dialog.showModal(), 1200);
      return true;
    },
  };
}
