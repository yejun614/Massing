/**
 * The one button, and what stands behind it.
 *
 * Connecting a CLI by hand means finding the right config file for the right
 * tool, in the right format, with a URL whose port is only knowable at
 * runtime — and being told nothing at all if you get it slightly wrong. That
 * is a bad first five minutes for the feature the desktop build exists for.
 *
 * Browser code, living in `desktop/` because it is desktop-only. `src/` does
 * not know this exists, which is the same rule the file-picker shim follows:
 * the editor is one program and the shell around it is another.
 *
 * The button is added to the toolbar rather than put somewhere of its own,
 * because it belongs with the other things that act on the whole application
 * and because a control nobody can find is not a shortcut.
 */

/*
 * The editor's own icon set, by the URL the editor loads it from. Every other
 * button on that toolbar is an SVG from here, and a text glyph sitting among
 * them reads as something that was bolted on afterwards -- which it was, and
 * which is not a reason for it to look like it.
 */
import { UI_ICONS } from '/src/ui/icons-ui.js';

const API = '/__massing';

/** The app's own helper, minus the parts that only make sense in modules. */
function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'text') el.textContent = String(value);
    // Only ever handed a constant from the editor's own icon set.
    else if (key === 'html') el.innerHTML = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [children].flat()) if (child) el.append(child);
  return el;
}

const post = (route, body) =>
  fetch(`${API}/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }).then((r) => r.json());

const STYLE = `
.mcp-list { display: grid; gap: 2px; margin: 14px 0 4px; }
.mcp-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 9px;
  padding: 7px 8px;
  border-radius: var(--radius);
  cursor: pointer;
}
.mcp-row:hover { background: var(--surface-2); }
.mcp-name { font-size: 13px; }
.mcp-note { font-size: 11.5px; color: var(--ink-muted); }
.mcp-url { margin-top: 12px; }
.mcp-url code {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--surface-2);
  font-family: var(--mono);
  font-size: 11.5px;
}
.mcp-fineprint { font-size: 11.5px; color: var(--ink-muted); }
`;

/**
 * Wait for the editor to have built its toolbar.
 *
 * This module is loaded before `src/main.js` — that ordering is what lets the
 * file-picker shim beside it win — and `createToolbar` *empties* the toolbar
 * region before filling it (`src/ui/toolbar.js`, `clear(region('file'))`). A
 * button added on load is therefore deleted a moment later, silently, which is
 * exactly what happened the first time. `window.massing` is assigned on the
 * last line of `main.js`, so it is the signal that the toolbar is built and
 * will not be cleared again.
 */
function whenReady(then) {
  if (window.massing) return then();
  const waiting = setInterval(() => {
    if (!window.massing) return;
    clearInterval(waiting);
    then();
  }, 100);
}

export function installMcpButton() {
  document.head.append(h('style', { text: STYLE }));
  whenReady(() => addButton());
}

function addButton() {
  const region = document.querySelector('[data-region="file"]');
  if (!region) return;

  const dialog = h('dialog', { class: 'sheet sheet-narrow' });
  document.body.append(dialog);

  const button = h('button', {
    class: 'btn btn-icon',
    type: 'button',
    title: 'Connect a coding agent — set up MCP for Claude Code, Codex or Antigravity',
    'aria-label': 'Connect a coding agent',
    html: UI_ICONS.link,
    onClick: () => open(),
  });
  region.append(button);

  /** Checkboxes survive a re-render, so what was ticked is remembered here. */
  let chosen = null;

  async function open() {
    dialog.showModal();
    render({ loading: true });
    render(await post('mcp/targets'));
  }

  function render(state) {
    const { url, targets = [], loading } = state;

    if (loading) {
      dialog.replaceChildren(
        h('h2', { class: 'sheet-title', text: 'Connect a coding agent' }),
        h('p', { class: 'sheet-text', text: 'Looking for what is installed…' })
      );
      return;
    }

    if (!url) {
      dialog.replaceChildren(
        h('h2', { class: 'sheet-title', text: 'Connect a coding agent' }),
        h('p', {
          class: 'sheet-text',
          text: 'The MCP server is switched off, so there is nothing to connect to. ' +
            'It is on unless MASSING_MCP=off was set.',
        }),
        h('button', { class: 'btn sheet-close', type: 'button', text: 'Close', onClick: () => dialog.close() })
      );
      return;
    }

    chosen ??= new Set(targets.filter((t) => t.found).map((t) => t.id));

    const rows = targets.map((target) => {
      const box = h('input', {
        type: 'checkbox',
        id: `mcp-${target.id}`,
        checked: chosen.has(target.id),
        onChange: (e) => {
          if (e.target.checked) chosen.add(target.id);
          else chosen.delete(target.id);
        },
      });
      // Said plainly rather than with a tick: "not found" is the one a person
      // needs to act on, and it is the only one that changes what they should do.
      const note = target.problem
        ? `could not write it — ${target.problem}`
        : target.registered
        ? 'already connected'
        : target.found
        ? 'installed, not connected'
        : 'not found on this machine';
      return h('label', { class: 'mcp-row', for: `mcp-${target.id}` }, [
        box,
        h('span', { class: 'mcp-name', text: target.label }),
        h('span', { class: 'mcp-note', text: note }),
      ]);
    });

    dialog.replaceChildren(
      h('h2', { class: 'sheet-title', text: 'Connect a coding agent' }),
      h('p', {
        class: 'sheet-text',
        text: 'They will be pointed at this app\'s MCP server, and can then read and ' +
          'change the diagram you have open.',
      }),
      h('div', { class: 'mcp-list' }, rows),
      h('p', { class: 'sheet-text mcp-url' }, [
        h('span', { text: 'Server: ' }),
        h('code', { text: url }),
      ]),
      h('p', {
        class: 'sheet-text mcp-fineprint',
        text: 'Your existing settings are kept — only one entry is added, and the ' +
          'previous file is saved beside it as .massing-backup.',
      }),
      h('div', { class: 'sheet-actions' }, [
        h('button', {
          class: 'btn btn-primary',
          type: 'button',
          text: 'Connect',
          onClick: async (e) => {
            e.target.disabled = true;
            e.target.textContent = 'Connecting…';
            const done = await post('mcp/register', { ids: [...chosen] });
            report(done);
          },
        }),
        h('button', { class: 'btn', type: 'button', text: 'Close', onClick: () => dialog.close() }),
      ])
    );
  }

  function report({ targets = [], error }) {
    const ok = targets.filter((t) => t.registered);
    const bad = targets.filter((t) => !t.registered);
    dialog.replaceChildren(
      h('h2', { class: 'sheet-title', text: error ? 'Not connected' : 'Connected' }),
      error
        ? h('p', { class: 'sheet-text', text: error })
        : h('p', {
          class: 'sheet-text',
          text: ok.length
            ? `${ok.map((t) => t.label).join(', ')} now points at this app. ` +
              'Restart the CLI if it was already running, then ask it to read the diagram.'
            : 'Nothing was changed.',
        }),
      ...bad.map((t) =>
        h('p', { class: 'sheet-text mcp-note', text: `${t.label}: ${t.problem ?? 'not written'}` })
      ),
      h('button', {
        class: 'btn sheet-close',
        type: 'button',
        text: 'Close',
        onClick: () => dialog.close(),
      })
    );
  }
}
