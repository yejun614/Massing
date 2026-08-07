/**
 * Toolbar. Buttons are created once and only their state is refreshed, so the
 * document title input never loses focus mid-edit.
 */

import { h, clear, setClass, setAttrs } from '../util/dom.js';
import { UI_ICONS } from './icons-ui.js';

const REPO_URL = 'https://github.com/yejun614/Massing';

export function createToolbar({ root, store, commands, io, exporter, onHelp, onCopyPrompt, onAddImage, onCopyLink, theme, panels }) {
  const region = (name) => root.querySelector(`[data-region="${name}"]`);

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
  const pngBtn = btn('image', 'Export as PNG', () => exporter.png());
  const svgBtn = btn('vector', 'Export as SVG', () => exporter.svg());
  clear(region('file')).append(newBtn, openBtn, saveBtn, imageBtn, copyBtn, shareBtn, promptBtn, pngBtn, svgBtn);

  // --- edit ----------------------------------------------------------------
  const undoBtn = btn('undo', 'Undo (Ctrl+Z)', () => commands.undo());
  const redoBtn = btn('redo', 'Redo (Ctrl+Shift+Z)', () => commands.redo());
  const deleteBtn = btn('trash', 'Delete selection (Del)', () => commands.deleteSelection());
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
  const selectBtn = btn('cursor', 'Select tool (V)', () => commands.setTool('select'));
  const zoneBtn = btn('zone', 'Draw a zone (G)', () => commands.setTool('group'));
  const connectBtn = btn('link', 'Connect blocks (C)', () => commands.setTool('connect'));
  const rotLeft = btn('rotateLeft', 'Rotate left (Q)', () => commands.rotateLeft());
  const rotRight = btn('rotateRight', 'Rotate right (E)', () => commands.rotateRight());
  const zoomOut = btn('zoomOut', 'Zoom out (-)', () => commands.zoomOut());
  const zoomIn = btn('zoomIn', 'Zoom in (+)', () => commands.zoomIn());
  const fitBtn = btn('fit', 'Zoom to fit (0)', () => commands.zoomFit());
  const modeBtn = btn('cube', 'Toggle 2D / 3D (2)', () => commands.toggleMode());
  const themeBtn = btn('themeSystem', 'Theme', () => {
    paintTheme(theme.cycle());
  });
  const leftPanelBtn = btn('panelLeft', 'Show or hide the component panel ([)', () =>
    panels?.toggle('left')
  );
  const rightPanelBtn = btn('panelRight', 'Show or hide the properties panel (])', () =>
    panels?.toggle('right')
  );
  const helpBtn = btn('help', 'Keyboard shortcuts', () => onHelp?.());
  const repoLink = link('github', 'Source on GitHub (opens in a new tab)', REPO_URL);

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
    selectBtn, zoneBtn, connectBtn,
    rotLeft, rotRight,
    zoomOut, zoomIn, fitBtn,
    modeBtn, themeBtn, helpBtn, repoLink
  );

  clear(region('panels')).append(leftPanelBtn, rightPanelBtn);
  paintPanels();

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

  function render(state) {
    undoBtn.disabled = !store.canUndo();
    redoBtn.disabled = !store.canRedo();
    deleteBtn.disabled = state.selection.length === 0;

    setClass(selectBtn, 'is-active', state.tool === 'select');
    setClass(zoneBtn, 'is-active', state.tool === 'group');
    setClass(connectBtn, 'is-active', state.tool === 'connect');
    setClass(modeBtn, 'is-active', state.camera.mode === 'flat');
    setAttrs(modeBtn, {
      html: UI_ICONS[state.camera.mode === 'flat' ? 'square' : 'cube'],
      title: state.camera.mode === 'flat' ? 'Switch to 3D (2)' : 'Switch to 2D (2)',
    });

    paintPanels();
    setClass(dirtyDot, 'is-on', state.dirty);
    if (document.activeElement !== title && title.value !== state.doc.meta.title) {
      title.value = state.doc.meta.title;
    }
  }

  return { render };
}
