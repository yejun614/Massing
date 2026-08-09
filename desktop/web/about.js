/**
 * About Massing.
 *
 * Everything in it is read from the running app rather than written down here,
 * because the one question this box exists to answer — "which version am I
 * actually on?" — is worthless if the answer is a constant somebody forgot to
 * bump. The shell reads it from its own package metadata.
 *
 * Desktop-only, like the rest of `desktop/web/`: the web build has no version
 * to report and no shell to ask.
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
.about-mark { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
.about-mark svg { width: 38px; height: 38px; flex: none; }
.about-name { font-size: 17px; font-weight: 650; line-height: 1.2; }
.about-version { font-size: 12.5px; color: var(--ink-muted); }
.about-rows { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; margin: 16px 0 4px; }
.about-rows dt { font-size: 11.5px; color: var(--ink-muted); }
.about-rows dd { margin: 0; font-size: 12px; font-family: var(--mono); overflow-wrap: anywhere; }
`;

/** The same isometric mark as the favicon and the application icon. */
const MARK = `<svg viewBox="0 0 32 32" aria-hidden="true">
  <path d="M16 3 29 10.5v11L16 29 3 21.5v-11Z" fill="#f59e0b"/>
  <path d="M16 3 29 10.5 16 18 3 10.5Z" fill="#fbbf24"/>
  <path d="M16 18v11L3 21.5v-11Z" fill="#ea580c"/>
</svg>`;

let dialog = null;

export async function showAbout() {
  if (!dialog) {
    document.head.append(h('style', { text: STYLE }));
    dialog = h('dialog', { class: 'sheet sheet-narrow' });
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
    document.body.append(dialog);
  }

  let info = {};
  try {
    info = await fetch(`${API}/about`, { method: 'POST' }).then((r) => r.json());
  } catch {
    // Shown anyway, with what is known. A dialog that refuses to open because
    // it could not fetch its own subtitle is worse than one missing a line.
  }

  const mark = h('span', { class: 'about-mark-svg' });
  mark.innerHTML = MARK;

  const rows = [
    ['Version', info.version ?? 'unknown'],
    ['Platform', info.os && info.arch ? `${info.os} ${info.arch}` : 'unknown'],
    ['Tauri', info.tauri ?? '—'],
    ['MCP', info.mcp ?? 'off'],
  ];

  dialog.replaceChildren(
    h('div', { class: 'about-mark' }, [
      mark,
      h('div', {}, [
        h('div', { class: 'about-name', text: 'Massing' }),
        h('div', { class: 'about-version', text: `Version ${info.version ?? 'unknown'}` }),
      ]),
    ]),
    h('p', {
      class: 'sheet-text',
      text: 'An isometric architecture diagram editor. Diagrams are .arch.json ' +
        'files on your disk, meant to be read and written by people and by ' +
        'language models alike.',
    }),
    h('dl', { class: 'about-rows' }, rows.flatMap(([label, value]) => [
      h('dt', { text: label }),
      h('dd', { text: String(value) }),
    ])),
    h('div', { class: 'sheet-actions' }, [
      h('button', {
        class: 'btn',
        type: 'button',
        text: 'Check for updates',
        // The menu item does the same thing; this is the copy somebody looking
        // at a version number is most likely to want next.
        onClick: () => fetch(`${API}/check-updates`, { method: 'POST' }).catch(() => {}),
      }),
      h('button', { class: 'btn btn-primary', type: 'button', text: 'Close', onClick: () => dialog.close() }),
    ])
  );
  dialog.showModal();
}
