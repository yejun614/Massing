/**
 * Publishing a diagram, and the two links that come back.
 *
 * The name is optional and that is the point of the field: leaving it blank is
 * the fast path, and typing one is for a link you are going to say out loud or
 * put in a document. Both links are shown afterwards because they mean
 * different things — the short one always shows the newest version under that
 * name, the hash one always shows exactly what was published just now — and
 * choosing between them is the author's call, not something to decide for them.
 */

import { h, clear, copyText } from '../util/dom.js';

export function createPublishDialog(root, { cloud, store, toaster, onPublished }) {
  const dialog = h('dialog', { class: 'sheet sheet-narrow' });
  const name = h('input', {
    type: 'text',
    class: 'publish-name',
    placeholder: 'leave blank for a generated one',
    spellcheck: 'false',
    autocapitalize: 'off',
    onKeyDown: (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        run();
      }
    },
  });
  const status = h('p', { class: 'sheet-text' });
  const results = h('div', { class: 'publish-links' });
  const publishBtn = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    text: 'Publish',
    onClick: () => run(),
  });

  function linkRow(label, url, hint) {
    return h('div', { class: 'publish-link' }, [
      h('div', { class: 'publish-link-head' }, [
        h('span', { class: 'publish-link-label', text: label }),
        h('button', {
          class: 'btn',
          type: 'button',
          text: 'Copy',
          onClick: async (e) => {
            const ok = await copyText(url);
            e.target.textContent = ok ? 'Copied' : 'Failed';
            setTimeout(() => {
              e.target.textContent = 'Copy';
            }, 1400);
          },
        }),
      ]),
      h('code', { class: 'publish-url', text: url }),
      h('span', { class: 'publish-hint', text: hint }),
    ]);
  }

  async function run() {
    publishBtn.disabled = true;
    status.textContent = 'Publishing…';
    clear(results);
    const result = await cloud.publish({ displayId: name.value });
    publishBtn.disabled = false;
    if (!result) {
      status.textContent = 'It was not published. The message above says why.';
      return;
    }
    // The library keeps the address, so it can be found again without this
    // sheet -- and so republishing under the same name updates in place.
    onPublished?.(result);
    const kb = Math.max(1, Math.round(result.bytes / 1024));
    // The lifetime is said here or it is not said anywhere, and a link whose
    // expiry nobody mentioned is one people find out about from a document
    // they shared three months ago.
    status.textContent = result.expiresAt
      ? `Published, ${kb} kB. Kept until ${result.expiresAt.slice(0, 10)}, and for ` +
        `${result.retentionDays} more days each time someone opens it.`
      : `Published, ${kb} kB.`;
    results.append(
      linkRow('By name', result.url, 'Publish again under this name to update what it shows.')
    );
    if (result.hashUrl) {
      results.append(
        linkRow('By content', result.hashUrl, 'Always this exact version, whatever you publish later.')
      );
    }
    // The address bar follows, so a reload reopens what was just published and
    // the link in it is one you can copy out of the browser rather than only
    // out of this sheet.
    history.replaceState(null, '', new URL(result.url).pathname);
  }

  clear(dialog).append(
    h('h2', { class: 'sheet-title', text: 'Publish this diagram' }),
    h('p', { class: 'sheet-text', text:
      'The diagram is stored on this deployment and reachable by a short link. ' +
      'Anyone with the link can read it, so treat it as public. Opening a link ' +
      'keeps it alive; one nobody opens is eventually removed.' }),
    h('div', { class: 'field' }, [h('label', { text: 'Name' }), name]),
    status,
    results,
    h('div', { class: 'sheet-actions' }, [
      h('button', { class: 'btn', type: 'button', text: 'Close', onClick: () => dialog.close() }),
      publishBtn,
    ])
  );

  root.append(dialog);

  return {
    open() {
      clear(results);
      status.textContent = '';
      // A diagram already published under a name this browser owns offers that
      // name back, because "publish again" is what the button usually means.
      const title = store.state.doc.meta.title ?? '';
      const suggestion = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
      name.value = cloud.ownsName(suggestion) ? suggestion : '';
      dialog.showModal();
      name.focus();
    },
  };
}
