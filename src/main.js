/**
 * Bootstrap.
 *
 * Wires the store, the scene and the UI panels together and owns the single
 * render loop. Every subsystem talks to the store and nothing else, so the
 * flow is one-directional: input -> store -> render.
 */

import { createStore } from './core/store.js';
import { normalizeDoc, serializeDoc } from './core/schema.js';
import {
  encodeShareText,
  decodeShareText,
  shareUrlFrom,
  sharePayloadFrom,
  SHARE_WARN_LENGTH,
} from './core/share.js';
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
import { createTooltips } from './ui/tooltip.js';
import { createConsent } from './ui/consent.js';
import { createExportDialog } from './ui/export-dialog.js';
import { createFeedbackPrompt } from './ui/feedback.js';
import { createPublishDialog } from './ui/publish.js';
import { createAssistantPanel } from './ui/assistant.js';
import { createFeatures } from './core/features.js';
import { createCloud, publishedKeyFrom } from './core/cloud.js';
import { createAssistant } from './core/assistant.js';
import { createTheme } from './ui/theme.js';
import { createPanels } from './ui/panels.js';

import { THREE_TIER } from './data/samples.js';
import { LLM_PROMPT } from './data/prompt.js';
import { copyText } from './util/dom.js';

const region = (name) => document.querySelector(`[data-region="${name}"]`);

const canvasEl = region('canvas');
const toaster = createToaster(region('toasts'));

// Declared up here, not beside the render loop below: `scheduleRender` is
// hoisted and subsystems may call it while they are still being wired, and a
// `let` further down the file would be in its temporal dead zone when they do.
let frame = 0;

installCrashReporting();

const store = createStore(startingDocument());

/*
 * A finger starts by moving the drawing, not by selecting things in it.
 *
 * With a mouse, select-first is right: the cursor is precise and panning has a
 * wheel, a held space and a middle button. A touchscreen has none of those, so
 * select-first means every attempt to look at the rest of the diagram lands on
 * whatever was under the thumb. Two fingers still pan and pinch from any tool.
 *
 * Keyed off the pointer rather than the width: a narrow desktop window still
 * has a mouse, and a touchscreen laptop still has a finger.
 */
if (window.matchMedia?.('(pointer: coarse)').matches) {
  store.setUI({ tool: 'pan' });
}

/**
 * A bundle built with `--doc` carries its diagram inline, which is what makes
 * a single `.html` file both the editor and the document. Without one we open
 * the sample.
 */
function startingDocument() {
  const embedded = document.getElementById('embedded-diagram')?.textContent?.trim();
  if (embedded && embedded !== 'null') {
    try {
      // Unparseable, or parseable but not a diagram: either way the bundle was
      // built around something that is not a document, and the sample beats
      // opening to a blank page with no explanation for it.
      const embeddedDoc = normalizeDoc(JSON.parse(embedded));
      if (!embeddedDoc.rejection) return embeddedDoc.doc;
    } catch {
      /* fall through to the sample */
    }
  }
  return normalizeDoc(THREE_TIER).doc;
}

const scene = createScene(canvasEl, { onResize: () => scheduleRender() });
const panels = createPanels({
  onResize: () => scheduleRender(),
  onChange: () => scheduleRender(),
});
const overlay = createOverlay(scene.overlay);
// io first: `newDoc` has to tell it to forget which file is open, and io
// itself depends only on the store.
// `commands` does not exist yet, and does not need to: opening a file is the
// one thing that happens long after start-up, and a diagram that arrives from
// outside has no reason to land under the camera the last one left behind.
const io = createIO({ store, toaster, onOpened: () => commands.zoomFit() });
const commands = createCommands({ store, scene, toaster, io });
const exporter = createExporter({ store, scene, toaster });

const shortcuts = createShortcutsDialog(document.body);
const feedback = createFeedbackPrompt(document.body);
// Nothing here reaches the network until `features.load()` has been answered,
// and in a build without the hosted marker it never asks.
const features = createFeatures();
const cloud = createCloud({ store, toaster });
const assistant = createAssistant({ store, commands });
const exportDialog = createExportDialog(document.body, {
  store,
  exporter,
  onExported: () => feedback.maybeAsk(),
});
const publishDialog = createPublishDialog(document.body, { cloud, store, toaster });
const assistantPanel = createAssistantPanel(document.body, {
  assistant,
  toaster,
  onToggle: (open) => toolbar.setAssistantOpen(open),
});
// The theme decides the canvas colour for any document that has not named one,
// so what it resolves to has to reach the store the render reads.
const theme = createTheme((state) => {
  store.setUI({ dark: state.dark });
  scheduleRender();
});
store.setUI({ dark: theme.current().dark });
const toolbar = createToolbar({
  root: document,
  store,
  commands,
  io,
  onHelp: () => shortcuts.open(),
  onExport: () => exportDialog.open(),
  onCopyPrompt: copyPrompt,
  onAddImage: () => io.pickImage(store.state.hover ?? { x: 0, y: 0 }),
  onCopyLink: copyShareLink,
  onPublish: () => publishDialog.open(),
  onAssistant: () => assistantPanel.toggle(),
  theme,
  panels,
});
// After the toolbar has filled itself in, though the listeners are delegated
// so the order is a matter of reading rather than of correctness.
createTooltips(document.querySelector('.toolbar'));

const palette = createPalette({
  root: region('palette'),
  store,
  commands,
  // On a phone the palette is a drawer over the canvas, so picking a component
  // and then being unable to reach the canvas to place it is the whole
  // interaction failing on its last step.
  onArm: () => panels.armed(),
});
const inspector = createInspector({ root: region('inspector'), store, commands });

const pointer = attachPointer({
  canvas: canvasEl,
  store,
  scene,
  overlay,
  toaster,
  onEditText: () => inspector.focusEditor(),
});
attachKeyboard({ store, commands, io, panels, onExport: () => exportDialog.open() });

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

// Does nothing at all unless this build was made with analytics in it, which
// is every build except one made deliberately with MASSING_VERCEL_FEATURES=1.
createConsent();

// --- render loop -----------------------------------------------------------

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

/*
 * What to open, in order of how specific the request was.
 *
 * A published key in the path and a diagram inside the fragment are both
 * someone asking for one particular document, and they beat a draft this
 * browser happens to have. The draft is still in storage either way, and
 * putting two competing documents on screen with no obvious answer is the
 * failure worth avoiding.
 */
const publishedKey = publishedKeyFrom();
if (publishedKey) openPublishedDiagram(publishedKey);
else if (sharePayloadFrom()) openSharedDiagram();
else offerRecovery();

// Last, because it is the only thing here that touches the network, and the
// editor has to be usable before the answer arrives — or without one.
features.load().then((flags) => {
  toolbar.setHostedFeatures(flags);
});

/**
 * Open a diagram published to this deployment.
 *
 * The failure that matters is a link someone was given that does not work, so
 * it is reported with the key in it rather than swallowed — and the sample
 * stays on screen, which at least leaves something to work with.
 */
async function openPublishedDiagram(key) {
  try {
    const result = await cloud.fetchDiagram(key);
    if (result.rejection) throw new Error(result.rejection);
    store.replaceDoc(result.doc, 'Open', { markSaved: true });
    io.forget();
    commands.zoomFit();
    toaster.warnings(result.warnings);
    if (!result.warnings.length) toaster.info(`Opened ${key}`);
  } catch (err) {
    toaster.error(`Could not open the published diagram "${key}": ${err.message}`, {
      detail: [describeError(err), '', describeEnvironment()].join('\n'),
    });
  }
}

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
    io.loadText(saved.text, 'recovered draft'); // frames itself
    el.remove();
  });
}

/**
 * Open the diagram carried by the address bar.
 *
 * Decoding is asynchronous, so this runs after the first paint rather than
 * feeding `startingDocument`. The sample is on screen for a frame or two first,
 * which is a better failure mode than a blank page if the payload is corrupt.
 */
async function openSharedDiagram() {
  const payload = sharePayloadFrom();
  if (!payload) return;
  try {
    io.loadText(await decodeShareText(payload), 'shared link'); // frames itself
  } catch (err) {
    toaster.error('That shared link could not be read.', {
      detail: [describeError(err), '', describeEnvironment()].join('\n'),
    });
  }
}

/**
 * Put the whole diagram in a URL and hand it to the clipboard.
 *
 * The payload rides in the fragment, so it never reaches a server -- see
 * `core/share.js`. What it cannot do is stay short once pictures are embedded,
 * so the length is reported rather than silently producing a link that some
 * chat client will truncate into a broken one.
 */
async function copyShareLink() {
  try {
    const url = shareUrlFrom(await encodeShareText(serializeDoc(store.state.doc)));
    if (!(await copyText(url))) {
      toaster.error('Could not reach the clipboard.', { detail: url });
      return;
    }
    if (url.length > SHARE_WARN_LENGTH) {
      toaster.warn(
        `Link copied, but it is ${(url.length / 1000).toFixed(1)} kB long. Chat apps and ` +
          'mail clients often truncate links past a few thousand characters — embedded ' +
          'pictures are usually the reason.'
      );
    } else {
      toaster.info('Link copied. The whole diagram travels inside the URL.');
    }
  } catch (err) {
    toaster.error('Could not build a shareable link.', { detail: describeError(err) });
  }
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
