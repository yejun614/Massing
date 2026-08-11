/**
 * The embed sheet: a frame to paste into somebody else's page.
 *
 * Three things, and the middle one is the reason the sheet exists rather than a
 * button that copies a string: the snippet, a preview of what it produces, and
 * the address it points at, said plainly. An embed is a promise made on another
 * site — that a diagram will be there, and be the right one — and the two ways
 * to make it have different failure modes. Whether the frame will show what you
 * are looking at now, or the copy on the server as it was when you last
 * published, is the thing to know before pasting, not after.
 *
 * The preview is the real page in a real frame, not a picture of one. It is the
 * same document, the same renderer and the same bar the reader will get, so
 * "does the height I chose fit the diagram" is answered by looking rather than
 * by guessing and reloading somebody's blog.
 */

import { h, clear, setText, setClass, copyText } from '../util/dom.js';
import { serializeDoc } from '../core/schema.js';
import { encodeShareText, shareUrlFrom, SHARE_WARN_LENGTH } from '../core/share.js';
import { publishedKeyFrom } from '../core/cloud.js';
import { embedUrlFrom, embedSnippet, fullUrlFrom, EMBED_SIZE } from '../core/embed.js';

export function createEmbedDialog(root, { store, tabs, toaster, cloud, onPublished }) {
  /** 'preview' | 'source' */
  let view = 'preview';
  let url = null;
  /**
   * Whether this deployment stores diagrams. Nothing here offers publishing
   * until the answer has arrived and is yes — the alternative is telling
   * somebody to press a button that does not exist in the build they are using.
   */
  let canPublish = false;

  const dialog = h('dialog', { class: 'sheet sheet-embed' });
  const about = h('p', { class: 'sheet-text' });

  const sizeField = (label, value, hint) =>
    h('input', {
      class: 'embed-size-input',
      type: 'text',
      value,
      'aria-label': label,
      title: hint,
      spellcheck: 'false',
      onInput: () => paint(),
    });
  const widthInput = sizeField('Frame width', EMBED_SIZE.width, 'A number of pixels, or any CSS length such as 100%');
  const heightInput = sizeField('Frame height', EMBED_SIZE.height, 'A number of pixels, or any CSS length');

  const tab = (id, text) =>
    h('button', {
      class: 'chip',
      type: 'button',
      text,
      onClick: () => {
        view = id;
        paint();
      },
    });
  const previewTab = tab('preview', 'Preview');
  const sourceTab = tab('source', 'Source');

  /*
   * `sandbox` is deliberately absent.
   *
   * The frame is this same origin running this same editor, and the snippet the
   * sheet hands over carries no sandbox either — a preview that ran under
   * tighter rules than the thing it is previewing would be a preview of
   * something else. What the snippet does carry is `allowfullscreen`, so the
   * button in the embed's own bar works here too.
   */
  const frame = h('iframe', {
    class: 'embed-frame',
    title: 'Embed preview',
    allowfullscreen: true,
  });
  const preview = h('div', { class: 'embed-preview' }, [frame]);
  const code = h('code', { class: 'embed-code' });
  const source = h('pre', { class: 'embed-source' }, [code]);
  const note = h('p', { class: 'panel-hint embed-note' });

  /*
   * The way out of a snippet that is kilobytes long, offered where the problem
   * is stated rather than as advice to go and do something elsewhere.
   *
   * It publishes without asking for a name — the same fast path the publish
   * sheet describes — and then rebuilds the frame around the short link. The
   * consequence is spelt out beside it rather than buried in the label, because
   * publishing puts the diagram on a server for anyone with the link to read,
   * and that is not something to discover after pressing a button about size.
   */
  const publishBtn = h('button', {
    class: 'btn embed-publish',
    type: 'button',
    hidden: true,
    text: 'Publish for a short link',
    onClick: () => publishAndUse(),
  });

  const copyBtn = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    // The button by name rather than through the event: `currentTarget` is
    // nulled once dispatch is over, and this reports back after an await.
    onClick: async () => {
      const ok = await copyText(code.textContent);
      setText(copyBtn, ok ? 'Copied' : 'Could not copy');
      if (!ok) toaster?.error('Could not reach the clipboard.', { detail: code.textContent });
      setTimeout(() => setText(copyBtn, 'Copy the code'), 1400);
    },
  }, ['Copy the code']);

  clear(dialog).append(
    h('h2', { class: 'sheet-title', text: 'Embed this diagram' }),
    about,
    h('div', { class: 'embed-controls' }, [
      h('div', { class: 'embed-size' }, [
        h('label', { class: 'embed-size-label', text: 'Size' }),
        widthInput,
        h('span', { class: 'embed-size-by', text: '×' }),
        heightInput,
      ]),
      h('div', { class: 'chips embed-tabs' }, [previewTab, sourceTab]),
    ]),
    preview,
    source,
    note,
    publishBtn,
    h('div', { class: 'sheet-actions' }, [
      h('button', { class: 'btn', type: 'button', text: 'Close', onClick: () => dialog.close() }),
      copyBtn,
    ])
  );

  /*
   * The frame is emptied on the way out.
   *
   * A hidden `<dialog>` still holds a live page: left alone, every opening of
   * this sheet would leave another copy of the editor running in the background
   * of the one you are working in.
   */
  dialog.addEventListener('close', () => {
    frame.src = 'about:blank';
  });
  root.append(dialog);

  /** The snippet, the preview's shape, and which of the two is on screen. */
  function paint() {
    const snippet = embedSnippet({
      url: url ?? '',
      width: widthInput.value,
      height: heightInput.value,
      title: store.state.doc.meta.title,
    });
    setText(code, snippet);

    // The sheet is a fixed width, so only the height is honoured literally --
    // which is the one that decides whether the diagram fits.
    const height = Number.parseFloat(heightInput.value);
    frame.style.height = `${Math.max(160, Number.isFinite(height) ? height : 480)}px`;

    setClass(previewTab, 'is-active', view === 'preview');
    setClass(sourceTab, 'is-active', view === 'source');
    setClass(preview, 'is-hidden', view !== 'preview');
    setClass(source, 'is-hidden', view !== 'source');
    // Loaded on first sight rather than on open: switching to Source and back
    // must not reload the editor, and opening straight onto Source should not
    // fetch it at all.
    if (view === 'preview' && url && frame.src !== url) frame.src = url;
  }

  /**
   * Which address the frame will point at.
   *
   * A page that is already a published diagram embeds itself — that link is
   * short, stable and the one its author meant to hand out. Anything else gets
   * the whole diagram inside the URL, which is the only form that needs no
   * server and is guaranteed to be exactly what is on screen.
   */
  const PUBLISHED_ABOUT =
    'This embeds the published copy of the diagram, so the frame stays small and ' +
    'the link stays short. Publish again after editing to update what it shows.';

  async function resolve() {
    if (publishedKeyFrom()) {
      return { url: embedUrlFrom(fullUrlFrom()), about: PUBLISHED_ABOUT };
    }
    // From the origin and path alone: the address may already carry a diagram
    // in its fragment, and that one is whatever was opened rather than what has
    // been drawn since.
    const base = new URL(location.pathname, location.origin).href;
    const payload = await encodeShareText(serializeDoc(tabs.document()));
    return {
      url: embedUrlFrom(shareUrlFrom(payload, base)),
      about:
        'The whole diagram travels inside the address, so the frame shows exactly ' +
        'this version and fetches nothing from a server.' +
        (canPublish ? ' Publish it for a short link instead.' : ''),
    };
  }

  /**
   * Publish, then re-point the frame at what came back.
   *
   * The address bar follows, exactly as the publish sheet makes it follow: this
   * page *is* that published diagram afterwards, so a reload reopens it and the
   * next embed or share of it resolves to the short link on its own.
   *
   * A failure needs nothing said here. `cloud.publish` has already put the
   * reason on screen, and the long address the sheet is showing is still a
   * working snippet — which is the point of not having thrown it away.
   */
  async function publishAndUse() {
    publishBtn.disabled = true;
    setText(publishBtn, 'Publishing…');
    const result = await cloud?.publish({});
    publishBtn.disabled = false;
    setText(publishBtn, 'Publish for a short link');
    if (!result) return;

    onPublished?.(result);
    history.replaceState(null, '', new URL(result.url).pathname);
    url = embedUrlFrom(result.url);
    setText(about, PUBLISHED_ABOUT);
    paint(); // the frame reloads itself: `src` no longer matches the new address
    paintNote();
  }

  /** Anything worth knowing before this is pasted somewhere public. */
  function paintNote() {
    const lines = [];
    const long = Boolean(url) && url.length > SHARE_WARN_LENGTH;
    if (long) {
      lines.push(
        `The address is ${(url.length / 1000).toFixed(1)} kB long — embedded pictures are ` +
          'usually why. It works, but a snippet this long is one some sites truncate or refuse.'
      );
      lines.push(
        canPublish
          ? 'Publishing stores the diagram on this deployment and gives a short link ' +
            'instead — anyone with that link can read it, so treat it as public.'
          : 'This build has nowhere to publish to, so the only shorter snippet is a ' +
            'diagram with fewer or smaller pictures in it.'
      );
    }
    if (!/^https?:$/.test(location.protocol)) {
      lines.push(
        `This page is served over ${location.protocol} rather than the web, so the ` +
          'snippet will only work on this machine.'
      );
    } else if (/^(localhost|127\.|\[?::1)/.test(location.host)) {
      lines.push(
        `${location.host} is only reachable from this machine, so the snippet works ` +
          'in a page you are building here but not for anybody else.'
      );
    }
    setText(note, lines.join(' '));
    note.hidden = lines.length === 0;
    // Offered only where it is the answer to something: a short address needs
    // no help, and a page that is already published cannot produce a long one.
    publishBtn.hidden = !(long && canPublish);
  }

  return {
    /**
     * What the deployment has switched on, once it has said. Same shape as the
     * toolbar's, and called from the same answer — see `main.js`.
     */
    setHostedFeatures(flags) {
      canPublish = Boolean(flags?.storage);
    },

    async open() {
      view = 'preview';
      url = null;
      setText(about, 'Working out the address…');
      setText(code, '');
      note.hidden = true;
      // Whatever the last opening concluded is not known to be true of this one.
      publishBtn.hidden = true;
      frame.src = 'about:blank';
      dialog.showModal();

      // Compressing a large diagram is not instant, and the sheet is already on
      // screen by then rather than the button appearing to have done nothing.
      try {
        const resolved = await resolve();
        url = resolved.url;
        setText(about, resolved.about);
      } catch (err) {
        setText(about, 'The address for this diagram could not be built.');
        toaster?.error('Could not build an embed link.', { detail: String(err) });
        return;
      }
      if (!dialog.open) return; // closed while we were working
      paint();
      paintNote();
    },
  };
}
