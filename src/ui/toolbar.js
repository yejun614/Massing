/**
 * Toolbar. Buttons are created once and only their state is refreshed, so the
 * document title input never loses focus mid-edit.
 */

import { h, clear, setClass, setAttrs } from '../util/dom.js';
import { UI_ICONS } from './icons-ui.js';
import { REPO_URL } from '../data/links.js';

export function createToolbar({ root, store, commands, io, onHelp, onCopyPrompt, onAddImage, onCopyLink, onExport, onPublish, onAssistant, onLibrary, theme, panels }) {
  const region = (name) => root.querySelector(`[data-region="${name}"]`);
  /** The bar itself: a row across the top, or a rail down the side. */
  const bar = root.querySelector('.toolbar');

  const btn = (icon, title, onClick, extra = {}) =>
    h('button', {
      class: 'btn btn-icon',
      title,
      'aria-label': title,
      html: UI_ICONS[icon],
      onClick,
      ...extra,
    });

  /**
   * A button that stays on the rail when the rest are folded away.
   *
   * Which ones those are is a judgement about editing on a phone rather than
   * about the desktop toolbar's grouping: the two panels, because they are how
   * anything is added or edited at all; select and pan, because they decide
   * what a finger does; connect, because it is the one thing you can create
   * that the palette does not offer; and undo, redo and delete, which are what
   * you reach for after every mistake.
   */
  const core = (button) => {
    button.classList.add('is-core');
    return button;
  };

  /**
   * An anchor rather than a button that calls `window.open`: it opens in a new
   * tab from a plain click, but middle-click, Ctrl+click and "copy link" all
   * keep working, and it survives a popup blocker.
   */
  const link = (icon, title, href) =>
    h('a', {
      class: 'btn btn-icon',
      href,
      target: '_blank',
      rel: 'noopener noreferrer',
      title,
      'aria-label': title,
      html: UI_ICONS[icon],
    });

  // --- file ----------------------------------------------------------------
  const newBtn = btn('file', 'New diagram (Ctrl+N)', () => commands.newDoc());
  const openBtn = btn('open', 'Open… (Ctrl+O)', () => io.open());
  const libraryBtn = btn(
    'library',
    'Your diagrams — everything saved, opened or published from this browser',
    () => onLibrary?.()
  );
  const reloadBtn = btn('refresh', 'Reload from disk (R)', () => io.reload());
  const saveBtn = btn('save', 'Save (Ctrl+S)', () => io.save());
  const copyBtn = btn('clipboard', 'Copy diagram JSON to clipboard', () => io.copyDocumentJson());
  const shareBtn = btn(
    'share',
    'Copy a shareable link — the whole diagram travels inside the URL',
    () => onCopyLink?.()
  );
  const promptBtn = btn(
    'sparkle',
    'Copy the LLM prompt — paste it into a chat, then ask for a diagram',
    () => onCopyPrompt?.()
  );
  const imageBtn = btn(
    'picture',
    'Add a picture — it is embedded in the diagram file',
    () => onAddImage?.()
  );
  const exportBtn = btn(
    'image',
    'Export an image (Ctrl+E) — format, projection, grid and size',
    () => onExport?.()
  );
  /*
   * The two hosted buttons.
   *
   * Hidden from the markup rather than disabled, and only revealed once the
   * deployment has said the feature is on. A control whose only purpose is to
   * explain that it does not work here is worse than no control, and every
   * build that is not the hosted one has no server to ask.
   */
  const publishBtn = btn(
    'cloud',
    'Publish — store the diagram and get a short link to it',
    () => onPublish?.()
  );
  // The panel reports its own state back through `setAssistantOpen`, because
  // the toolbar is not the only thing that closes it -- the panel has a close
  // button of its own, and a button that lit up here and stayed lit was the
  // result of this deciding for itself what the panel was doing.
  const assistantBtn = btn(
    'chat',
    // "Beta" here as well as on the panel, because this is the tooltip read
    // before deciding to open it, and the panel's badge is only visible to
    // somebody who already has.
    'Assistant (beta) — describe a change and have it made',
    () => onAssistant?.()
  );
  for (const button of [publishBtn, assistantBtn]) button.hidden = true;

  clear(region('file')).append(
    newBtn, openBtn, libraryBtn, reloadBtn, saveBtn, imageBtn, copyBtn, shareBtn,
    publishBtn, assistantBtn, promptBtn, exportBtn
  );

  /**
   * Name the file the button will actually read. Which file a reload picks up
   * is the only thing about it worth being unsure of, and a tooltip that says
   * so costs nothing; disabled with no explanation would just look broken.
   */
  function paintReload() {
    const name = io.sourceName;
    reloadBtn.disabled = !name;
    setAttrs(reloadBtn, {
      title: name
        ? `Reload ${name} from disk (R) — picks up edits made outside this page`
        : 'Reload from disk (R) — open a diagram file first',
    });
  }

  // --- edit ----------------------------------------------------------------
  const undoBtn = core(btn('undo', 'Undo (Ctrl+Z)', () => commands.undo()));
  const redoBtn = core(btn('redo', 'Redo (Ctrl+Shift+Z)', () => commands.redo()));
  const deleteBtn = core(btn('trash', 'Delete selection (Del)', () => commands.deleteSelection()));
  const tidyBtn = btn(
    'tidy',
    'Tidy (A) — nudge blocks apart until nothing is hidden, keeping your layout',
    () => commands.tidy()
  );
  const layoutBtn = btn(
    'layout',
    'Auto layout (Shift+A) — re-flow the diagram from its connections',
    () => commands.autoLayout()
  );
  clear(region('edit')).append(undoBtn, redoBtn, deleteBtn, tidyBtn, layoutBtn);

  // --- view ----------------------------------------------------------------
  const selectBtn = core(btn('cursor', 'Select tool (V)', () => commands.setTool('select')));
  const panBtn = core(btn('hand', 'Pan tool (H) — Space + drag does the same from any tool', () =>
    commands.setTool('pan')
  ));
  const zoneBtn = btn('zone', 'Draw a zone (G)', () => commands.setTool('group'));
  const connectBtn = core(btn('link', 'Connect blocks (C)', () => commands.setTool('connect')));
  const rotLeft = btn('rotateLeft', 'Rotate left (Q)', () => commands.rotateLeft());
  const rotRight = btn('rotateRight', 'Rotate right (E)', () => commands.rotateRight());
  // The rail has no room for these and the dock in the corner has them, so on
  // a narrow screen these three step aside rather than appear twice.
  const docked = (button) => {
    button.classList.add('is-docked');
    return button;
  };
  const zoomOut = docked(btn('zoomOut', 'Zoom out (-)', () => commands.zoomOut()));
  const zoomIn = docked(btn('zoomIn', 'Zoom in (+)', () => commands.zoomIn()));
  const fitBtn = docked(btn('fit', 'Zoom to fit (0)', () => commands.zoomFit()));
  const modeBtn = btn('cube', 'Toggle 2D / 3D (2)', () => commands.toggleMode());
  const themeBtn = btn('themeSystem', 'Theme', () => {
    paintTheme(theme.cycle());
  });
  const leftPanelBtn = core(btn('panelLeft', 'Show or hide the component panel ([)', () =>
    panels?.toggle('left')
  ));
  const rightPanelBtn = core(btn('panelRight', 'Show or hide the properties panel (])', () =>
    panels?.toggle('right')
  ));
  const helpBtn = btn('help', 'Keyboard shortcuts', () => onHelp?.());
  const repoLink = link('github', 'Source on GitHub (opens in a new tab)', REPO_URL);

  /**
   * Fold the rest of the rail away, and bring it back.
   *
   * Twenty-nine buttons is a fine toolbar and a poor rail: on a phone it would
   * be a column taller than the screen, so all but the core fold behind this.
   * It is the last thing on the rail and marked core itself, or pressing it
   * once would hide the way back.
   */
  const moreBtn = core(btn('more', 'More tools', () => {
    const open = bar.classList.toggle('is-expanded');
    setClass(moreBtn, 'is-active', open);
    // The name changes with the state, and both copies of it have to: a
    // tooltip saying one thing while a screen reader says the other is worse
    // than either being wrong on its own.
    const label = open ? 'Fewer tools' : 'More tools';
    setAttrs(moreBtn, { title: label, 'aria-label': label, 'aria-expanded': String(open) });
  }, { class: 'btn btn-icon is-rail-only', 'aria-expanded': 'false' }));


  /**
   * A folded panel dims its button rather than lighting it up. `is-active` in
   * this toolbar already means "this tool is the current one", and reusing it
   * for "this panel is gone" would read as the opposite of what it shows.
   */
  function paintPanels() {
    if (!panels) return;
    for (const [button, side] of [[leftPanelBtn, 'left'], [rightPanelBtn, 'right']]) {
      const hidden = panels.isCollapsed(side);
      setClass(button, 'is-off', hidden);
      setAttrs(button, { 'aria-pressed': String(!hidden) });
    }
  }

  /** Show which of the three theme states is active, not merely light/dark. */
  function paintTheme(state) {
    const icon = { system: 'themeSystem', light: 'themeLight', dark: 'themeDark' }[state.mode];
    setAttrs(themeBtn, { html: UI_ICONS[icon], title: state.label });
    setClass(themeBtn, 'is-active', state.mode !== 'system');
  }
  paintTheme(theme.current());
  clear(region('view')).append(
    selectBtn, panBtn, zoneBtn, connectBtn,
    rotLeft, rotRight,
    zoomOut, zoomIn, fitBtn,
    modeBtn, themeBtn, helpBtn, repoLink,
    moreBtn
  );

  clear(region('panels')).append(leftPanelBtn, rightPanelBtn);
  paintPanels();

  // Zoom lives in the corner on a phone: within reach of a thumb, and out of
  // the way of a rail that is already full. The same three commands as the
  // toolbar's, not the same three elements, because one of the two is always
  // hidden and moving nodes between them on every resize is worse.
  clear(region('zoom')).append(
    btn('zoomIn', 'Zoom in', () => commands.zoomIn()),
    btn('zoomOut', 'Zoom out', () => commands.zoomOut()),
    btn('fit', 'Zoom to fit', () => commands.zoomFit())
  );

  // --- document ------------------------------------------------------------
  const dirtyDot = h('span', { class: 'dirty-dot', title: 'Unsaved changes' });
  const title = h('input', {
    class: 'doc-title',
    type: 'text',
    'aria-label': 'Diagram title',
    onFocus: () => store.beginGesture('Rename'),
    onBlur: () => store.endGesture(),
    onInput: (e) => {
      const value = e.target.value;
      store.commit('Rename', (doc) => {
        doc.meta.title = value;
      });
    },
  });
  clear(region('doc')).append(dirtyDot, title);

  // --- reaching a bar that has outgrown the window --------------------------

  /**
   * The bar scrolls when it does not fit, and now it says so.
   *
   * Twenty-nine buttons need about 1150px, so any window narrower than that
   * cuts the row off — and the scrollbar is hidden, because a bar one line tall
   * would spend that line on the scrollbar rather than on the icons it is there
   * to reveal. That left the missing buttons with nothing pointing at them and,
   * with a mouse, no way to reach them at all: a plain wheel does nothing to a
   * horizontal scroller. Hence a wheel that does, and a chevron at each end for
   * the people who will never think to try one.
   *
   * The rail is the same problem stood on its end — unfolded it is far taller
   * than a phone — so both axes are handled by the same code.
   */

  /** The rail scrolls down the screen; the toolbar scrolls across it. */
  const vertical = () =>
    bar.scrollHeight - bar.clientHeight > bar.scrollWidth - bar.clientWidth;
  const scrollMax = () =>
    vertical() ? bar.scrollHeight - bar.clientHeight : bar.scrollWidth - bar.clientWidth;
  const scrollPos = () => (vertical() ? bar.scrollTop : bar.scrollLeft);

  function scrollBar(direction) {
    const down = vertical();
    const step = direction * (down ? bar.clientHeight : bar.clientWidth) * 0.7;
    bar.scrollBy({ [down ? 'top' : 'left']: step, behavior: 'smooth' });
  }

  /**
   * A wheel over the bar scrolls it — but only while there is somewhere to
   * scroll to.
   *
   * On `window` and in the capture phase, not on the bar itself: as a rail the
   * bar takes no pointer events, so that a finger between two icons still pans
   * the diagram underneath, and a listener on it would never hear anything.
   * Which means the bar is found by its rectangle instead. When it fits, the
   * event is left alone and reaches the canvas as a zoom, which is what a wheel
   * means everywhere else on the page.
   */
  window.addEventListener('wheel', (e) => {
    if (scrollMax() < 1) return;
    const box = bar.getBoundingClientRect();
    const inside =
      e.clientX >= box.left && e.clientX <= box.right &&
      e.clientY >= box.top && e.clientY <= box.bottom;
    if (!inside) return;
    /*
     * Anything laid *over* the bar keeps the wheel: a sheet on a short window
     * reaches the top of the screen, and scrolling the toolbar behind it would
     * be the wrong list moving. The only things the bar is ever above are the
     * canvas and, as a rail, the drawers it floats across.
     */
    const under = document.elementFromPoint(e.clientX, e.clientY);
    if (!under || !(bar.contains(under) || under.closest('.canvas, .panel'))) return;
    e.preventDefault();
    e.stopPropagation();
    // Both deltas count, so a trackpad swipe works as well as a wheel.
    const step = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (vertical()) bar.scrollTop += step;
    else bar.scrollLeft += step;
  }, { capture: true, passive: false });

  /**
   * The two chevrons ride in the pinned groups at either end.
   *
   * Those are the only parts of the row that stay put while the middle scrolls
   * under them, so a button placed there is where the content it reveals comes
   * from and cannot itself scroll out of reach.
   */
  const nudge = (icon, label, direction) =>
    h('button', {
      class: `toolbar-nudge toolbar-nudge-${direction < 0 ? 'start' : 'end'}`,
      type: 'button',
      title: label,
      'aria-label': label,
      html: UI_ICONS[icon],
      onClick: () => scrollBar(direction),
    });
  region('panels').append(nudge('chevronLeft', 'Show the tools to the left', -1));
  region('doc').prepend(nudge('chevronRight', 'Show the tools to the right', 1));

  /** Say which way there is more, so the ends can show a chevron and a shadow. */
  function paintOverflow() {
    const max = scrollMax();
    setClass(bar, 'can-scroll-start', max > 1 && scrollPos() > 1);
    setClass(bar, 'can-scroll-end', max > 1 && scrollPos() < max - 1);
  }
  bar.addEventListener('scroll', paintOverflow);
  // The bar's own box changes with every window resize, in either orientation,
  // so this covers the resize as well as a panel or a font settling in.
  new ResizeObserver(paintOverflow).observe(bar);
  paintOverflow();

  function render(state) {
    undoBtn.disabled = !store.canUndo();
    redoBtn.disabled = !store.canRedo();
    deleteBtn.disabled = state.selection.length === 0;

    setClass(selectBtn, 'is-active', state.tool === 'select');
    setClass(panBtn, 'is-active', state.tool === 'pan');
    setClass(zoneBtn, 'is-active', state.tool === 'group');
    setClass(connectBtn, 'is-active', state.tool === 'connect');
    setClass(modeBtn, 'is-active', state.camera.mode === 'flat');
    setAttrs(modeBtn, {
      html: UI_ICONS[state.camera.mode === 'flat' ? 'square' : 'cube'],
      title: state.camera.mode === 'flat' ? 'Switch to 3D (2)' : 'Switch to 2D (2)',
    });

    paintPanels();
    paintReload();
    setClass(dirtyDot, 'is-on', state.dirty);
    if (document.activeElement !== title && title.value !== state.doc.meta.title) {
      title.value = state.doc.meta.title;
    }
  }

  return {
    render,
    /**
     * Reveal the buttons the deployment has switched on.
     *
     * Called once the flags have arrived, which is after the first paint --
     * so the toolbar someone sees for a moment is the offline one, and it
     * gains buttons rather than losing them. That way round is the safe one:
     * a button that appears late is a surprise, one that vanishes is a bug.
     */
    setHostedFeatures(flags) {
      publishBtn.hidden = !flags?.storage;
      assistantBtn.hidden = !flags?.assistant;
      // Two more buttons can be what tips the row over the edge of the window,
      // and the bar's own box has not changed, so nothing else would notice.
      paintOverflow();
    },

    /** Whatever opened or closed the assistant, this is how the button learns. */
    setAssistantOpen(open) {
      setClass(assistantBtn, 'is-active', open === true);
      setAttrs(assistantBtn, { 'aria-pressed': String(open === true) });
    },
  };
}
