/**
 * Transient status messages.
 *
 * Errors behave differently from the rest on purpose. They never expire on
 * their own and they carry a Copy button, because the useful part of a failure
 * -- the stack, the offending JSON, the parser's position -- is exactly what
 * you want to hand to someone else, and a toast that vanishes after five
 * seconds is a toast you cannot report.
 */

import { h, copyText } from '../util/dom.js';

/** Milliseconds before a toast fades. Zero means it stays until dismissed. */
const DURATION = { info: 2600, warn: 7000, error: 0 };
const MAX_VISIBLE = 5;
const COPIED_FEEDBACK = 1400;

export function createToaster(container) {
  /**
   * @param {string} message  the one-line summary shown on screen
   * @param {'info'|'warn'|'error'} level
   * @param {{detail?: string, copyable?: boolean}} options
   *   `detail` is what the Copy button puts on the clipboard; it defaults to
   *   the message, and is where a stack trace belongs.
   */
  function show(message, level = 'info', { detail = null, copyable } = {}) {
    const withActions = copyable ?? level === 'error';
    const el = h('div', { class: `toast is-${level}` }, [
      h('span', { class: 'toast-text', text: message }),
    ]);

    let timer = 0;
    const lifetime = DURATION[level] ?? DURATION.info;
    const startTimer = () => {
      if (lifetime) timer = setTimeout(() => el.remove(), lifetime);
    };

    if (withActions) {
      el.classList.add('has-actions');
      el.append(
        h('span', { class: 'toast-actions' }, [
          h('button', {
            class: 'toast-btn',
            title: 'Copy the full text of this message',
            text: 'Copy',
            onClick: async (e) => {
              const button = e.currentTarget;
              const full = detail ?? message;
              clearTimeout(timer);
              const ok = await copyText(full);
              button.textContent = ok ? 'Copied' : 'Failed';
              setTimeout(() => {
                button.textContent = 'Copy';
              }, COPIED_FEEDBACK);
              // Silence here would be the worst outcome: the clipboard still
              // holds whatever was in it before, and the user pastes that
              // instead, believing it is this message.
              if (!ok) showManualCopy(full);
            },
          }),
          h('button', {
            class: 'toast-btn',
            title: 'Dismiss',
            'aria-label': 'Dismiss',
            text: '✕',
            onClick: () => el.remove(),
          }),
        ])
      );

      // Hovering must not pull the button out from under the pointer.
      el.addEventListener('mouseenter', () => clearTimeout(timer));
      el.addEventListener('mouseleave', startTimer);
    }

    container.append(el);
    while (container.children.length > MAX_VISIBLE) container.firstChild.remove();
    startTimer();
    return el;
  }

  return {
    info: (message) => show(message, 'info'),
    warn: (message, options) => show(message, 'warn', options),
    error: (message, options) => show(message, 'error', options),

    /**
     * Report loader warnings without burying the user: the first few verbatim,
     * then a count for the rest. Every one of them copies the *complete* list,
     * since a partial list is not much use in a bug report or a prompt.
     */
    warnings(list) {
      if (!list?.length) return;
      const detail = list.join('\n');
      list.slice(0, 3).forEach((w) => show(w, 'warn', { detail, copyable: true }));
      if (list.length > 3) {
        show(`…and ${list.length - 3} more issue(s).`, 'warn', { detail, copyable: true });
      }
    },
  };
}

/**
 * Last resort when the browser refuses to write to the clipboard for us: put
 * the text on screen, focused and already selected, so Ctrl+C genuinely works
 * rather than being advice that does nothing.
 */
function showManualCopy(text) {
  const area = h('textarea', {
    class: 'copy-area',
    readonly: true,
    spellcheck: 'false',
    rows: 12,
  });
  area.value = text;

  const dialog = h('dialog', { class: 'sheet' }, [
    h('h2', { class: 'sheet-title', text: 'Copy this manually' }),
    h('p', {
      class: 'panel-hint',
      text: 'The browser blocked the clipboard. The text below is selected — press Ctrl+C (Cmd+C on a Mac).',
    }),
    area,
    h('button', { class: 'btn sheet-close', text: 'Close', onClick: () => dialog.close() }),
  ]);

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => dialog.remove());

  document.body.append(dialog);
  dialog.showModal();
  area.focus();
  area.select();
}
