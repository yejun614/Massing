/**
 * Getting the desktop app, from the web one.
 *
 * The page cannot know what the newest installer is called — the bundler puts
 * the version in every filename — so this asks GitHub for the latest release
 * once and offers what it actually contains. Which means it can also be honest
 * when a file is not there, rather than linking to a 404 that looks like a
 * broken download.
 *
 * The system is chosen rather than guessed at. Detection only preselects: it
 * gets the operating system right often enough to save a click and never
 * reliably enough to be the only answer on offer, and a page that decided for
 * somebody on a machine it misread would be a page with no way forward.
 *
 * Built only on the web. The desktop app has no reason to advertise itself, and
 * `main.js` never constructs this there.
 */

import { h, clear } from '../util/dom.js';
import { PLATFORMS, detectPlatform, platformFiles } from '../data/downloads.js';
import { LATEST_RELEASE_API, RELEASES_URL } from '../data/links.js';

/** Long enough for a slow connection, short enough to stop looking stuck. */
const TIMEOUT = 8000;

export function createDownloadDialog(root, { fetchImpl = fetch, platformHint } = {}) {
  // `||`, not `??`: a `userAgentData` that reports an empty platform has told
  // us nothing, and the UA string underneath it usually has the answer.
  const hint = platformHint || navigator.userAgentData?.platform || navigator.userAgent || '';
  const detected = detectPlatform(hint);

  /** Which tab is showing. Starts on this machine's, when that is known. */
  let chosen = detected ?? PLATFORMS[0].id;
  /** The release body, once it has arrived. */
  let release = null;
  /** Set when the ask failed, which is a state with something to say. */
  let failed = false;
  let pending = null;

  const dialog = h('dialog', { class: 'sheet' });
  const status = h('p', { class: 'download-status' });
  const files = h('div', { class: 'download-files' });

  const chips = PLATFORMS.map((platform) =>
    h('button', {
      class: 'chip',
      type: 'button',
      role: 'radio',
      'aria-checked': 'false',
      text: platform.label,
      title: platform.id === detected
        ? 'Looks like the system you are on'
        : `Downloads for ${platform.label}`,
      onClick: () => {
        chosen = platform.id;
        paint();
      },
    })
  );

  /**
   * One file, as the link that fetches it.
   *
   * An anchor rather than a button that navigates: middle-click and "save link
   * as" both work, and a 40 MB installer should be something the browser is
   * downloading in its own way rather than something this page is doing.
   */
  function fileRow({ label, note, url }) {
    if (!url) {
      return h('div', { class: 'download-row is-missing' }, [
        h('span', { class: 'download-label', text: label }),
        h('span', { class: 'download-note', text: note }),
        h('span', { class: 'download-go', text: 'not in this release' }),
      ]);
    }
    return h('a', {
      class: 'download-row',
      href: url,
      // `download` is ignored cross-origin, so this is a plain navigation to a
      // release asset -- which the browser downloads, because that is what
      // GitHub serves it as.
      rel: 'noopener noreferrer',
      title: url.split('/').pop(),
    }, [
      h('span', { class: 'download-label', text: label }),
      h('span', { class: 'download-note', text: note }),
      h('span', { class: 'download-go', text: 'Download' }),
    ]);
  }

  function paint() {
    for (const [i, chip] of chips.entries()) {
      const on = PLATFORMS[i].id === chosen;
      chip.classList.toggle('is-active', on);
      chip.setAttribute('aria-checked', String(on));
    }

    const platform = PLATFORMS.find((p) => p.id === chosen) ?? PLATFORMS[0];
    clear(files);

    if (failed) {
      status.textContent = 'Could not reach GitHub to see what the newest release is.';
      files.append(h('p', { class: 'sheet-text', text:
        'Every build is on the releases page, including older ones.' }));
      return;
    }
    if (!release) {
      status.textContent = 'Finding the newest release…';
      return;
    }

    status.textContent = `Newest release: ${release.tag_name ?? 'unknown'}`;
    for (const file of platformFiles(platform, release.assets ?? [])) {
      files.append(fileRow(file));
    }
  }

  /**
   * Ask once, and again after a failure.
   *
   * The answer is kept for the life of the page: a release does not appear
   * while somebody is looking at this sheet, and asking on every open would
   * spend the unauthenticated rate limit on a list that has not changed.
   */
  function load() {
    if (pending) return pending;
    pending = fetchImpl(LATEST_RELEASE_API, {
      headers: { accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(TIMEOUT),
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((body) => {
        release = body;
        failed = false;
      })
      .catch(() => {
        failed = true;
        // Cleared so the next open tries again: the usual reason this fails is
        // a network that has since come back.
        pending = null;
      })
      .finally(paint);
    return pending;
  }

  clear(dialog).append(
    h('h2', { class: 'sheet-title', text: 'Get the desktop app' }),
    h('p', { class: 'sheet-text', text:
      'The same editor, in a window, with three things a browser will not do: an MCP ' +
      'server, so Claude Code, Codex or Antigravity can read and change the diagram on ' +
      'screen; a file watcher, so a diagram edited elsewhere appears at once; and native ' +
      'Save and Export dialogs, so a file goes where you chose.' }),
    h('div', {
      class: 'chips download-os',
      role: 'radiogroup',
      'aria-label': 'Operating system',
    }, chips),
    status,
    files,
    h('div', { class: 'sheet-actions' }, [
      h('a', {
        class: 'btn',
        href: RELEASES_URL,
        target: '_blank',
        rel: 'noopener noreferrer',
        text: 'All releases',
      }),
      h('button', { class: 'btn btn-primary', type: 'button', text: 'Close', onClick: () => dialog.close() }),
    ])
  );

  root.append(dialog);

  return {
    open() {
      paint();
      dialog.showModal();
      load();
    },
  };
}
