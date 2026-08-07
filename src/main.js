/**
 * Bootstrap.
 *
 * Wires the store, the scene and the UI panels together and owns the single
 * render loop. Every subsystem talks to the store and nothing else, so the
 * flow is one-directional: input -> store -> render.
 */

import { createStore } from './core/store.js';
import { normalizeDoc } from './core/schema.js';
import { createCommands } from './core/commands.js';
import { createIO } from './core/io.js';
import { createExporter } from './core/export.js';
import { describeError, describeEnvironment } from './util/errors.js';

import { createScene } from './render/scene.js';
import { createOverlay } from './render/overlay.js';
import { screenToGrid } from './render/camera.js';

import { attachPointer } from './input/pointer.js';
import { attachKeyboard } from './input/keyboard.js';

import { createToaster } from './ui/toast.js';
import { createToolbar } from './ui/toolbar.js';
import { createPalette } from './ui/palette.js';
import { createInspector } from './ui/inspector.js';
import { createShortcutsDialog } from './ui/shortcuts.js';
import { createTheme } from './ui/theme.js';
import { createPanels } from './ui/panels.js';

import { THREE_TIER } from './data/samples.js';
import { LLM_PROMPT } from './data/prompt.js';
import { copyText } from './util/dom.js';

const region = (name) => document.querySelector(`[data-region="${name}"]`);

const canvasEl = region('canvas');
const toaster = createToaster(region('toasts'));

installCrashReporting();

const store = createStore(startingDocument());

/**
 * A bundle built with `--doc` carries its diagram inline, which is what makes
 * a single `.html` file both the editor and the document. Without one we open
 * the sample.
 */
function startingDocument() {
  const embedded = document.getElementById('embedded-diagram')?.textContent?.trim();
  if (embedded && embedded !== 'null') {
    try {
      return normalizeDoc(JSON.parse(embedded)).doc;
    } catch {
      // Fall through to the sample rather than opening to a blank page.
    }
  }
  return normalizeDoc(THREE_TIER).doc;
}

const scene = createScene(canvasEl, { onResize: () => scheduleRender() });
createPanels({ onResize: () => scheduleRender() });
const overlay = createOverlay(scene.overlay);
const commands = createCommands({ store, scene, toaster });
const io = createIO({ store, toaster });
const exporter = createExporter({ store, scene, toaster });

const shortcuts = createShortcutsDialog(document.body);
const theme = createTheme(() => scheduleRender());
const toolbar = createToolbar({
  root: document,
  store,
  commands,
  io,
  exporter,
  onHelp: () => shortcuts.open(),
  onCopyPrompt: copyPrompt,
  onAddImage: () => io.pickImage(store.state.hover ?? { x: 0, y: 0 }),
  theme,
});
const palette = createPalette({ root: region('palette'), store, commands });
const inspector = createInspector({ root: region('inspector'), store, commands });

const pointer = attachPointer({ canvas: canvasEl, store, scene, overlay, toaster });
attachKeyboard({ store, commands, io });

io.attachDropZone(canvasEl, (e) => {
  const r = canvasEl.getBoundingClientRect();
  const g = screenToGrid(store.state.camera, e.clientX - r.left, e.clientY - r.top, 0);
  return { x: Math.floor(g.x), y: Math.floor(g.y) };
});

// Pasting a screenshot straight onto the canvas is the fastest way in.
window.addEventListener('paste', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  const file = [...(e.clipboardData?.items ?? [])]
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .find((f) => f && f.type.startsWith('image/'));
  if (!file) return;
  e.preventDefault();
  e.stopPropagation();
  io.insertImage(file, store.state.hover ?? { x: 0, y: 0 });
}, true);
io.startAutosave();

// --- render loop -----------------------------------------------------------

let frame = 0;
function scheduleRender() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const state = store.state;
    scene.render(state);
    toolbar.render(state);
    palette.render(state);
    inspector.render(state);
  });
}
store.subscribe(scheduleRender);
window.addEventListener('resize', scheduleRender);

// --- start -----------------------------------------------------------------

// A first synchronous paint so `zoomFit` has real geometry to measure, then a
// rough grid-based fit as the fallback for an empty document.
scene.render(store.state);
commands.zoomFit();
store.markSaved();
scheduleRender();
offerRecovery();

/**
 * Surface an autosaved draft without hijacking the session: the sample stays
 * on screen and restoring is one click, never a modal.
 */
function offerRecovery() {
  const saved = io.readAutosave();
  if (!saved?.text) return;
  const when = new Date(saved.at).toLocaleString();
  const el = toaster.warn(`Unsaved work from ${when} was recovered. Click here to restore it.`);
  el.style.pointerEvents = 'auto';
  el.style.cursor = 'pointer';
  el.addEventListener('click', () => {
    io.loadText(saved.text, 'recovered draft');
    commands.zoomFit();
    el.remove();
  });
}

/**
 * Surface unexpected failures instead of letting them die in the console.
 *
 * A render loop that throws leaves the canvas frozen with no explanation, and
 * "it just stopped working" is not a reportable bug. The toast carries the
 * stack and the environment behind its Copy button, which is the difference
 * between a complaint and a bug report.
 */
function installCrashReporting() {
  let reported = 0;
  const LIMIT = 5; // one broken frame must not paper the screen in toasts

  const report = (label, error) => {
    console.error(label, error);
    if (reported > LIMIT) return;
    if (reported++ === LIMIT) {
      // Say so, rather than going quiet and looking like the errors stopped.
      toaster.error('Further errors will only be logged to the browser console.');
      return;
    }
    const summary = error?.message ?? String(error);
    toaster.error(`${label}: ${summary}`, {
      detail: [label, describeError(error), '', describeEnvironment()].join('\n'),
    });
  };

  window.addEventListener('error', (e) => {
    // Resource load failures fire a plain Event with nothing useful on it.
    if (!(e instanceof ErrorEvent)) return;
    report('Unexpected error', e.error ?? new Error(e.message));
  });
  window.addEventListener('unhandledrejection', (e) => {
    report('Unhandled promise rejection', e.reason);
  });
}

/**
 * Hand the model its instructions. The prompt is self-contained -- format,
 * component types, layout advice -- so pasting it into any chat is enough to
 * get back a document this editor will open.
 */
async function copyPrompt() {
  if (await copyText(LLM_PROMPT)) {
    toaster.info('LLM prompt copied. Paste it into a chat, then describe your system.');
  } else {
    toaster.error('Could not reach the clipboard.', { detail: LLM_PROMPT });
  }
}

// Exposed for the console and for automated checks.
window.massing = { store, scene, commands, io, exporter, pointer, prompt: LLM_PROMPT };
