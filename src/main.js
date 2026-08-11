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
import { createDownloadDialog } from './ui/download.js';
import { createFeatures, desktopBuild } from './core/features.js';
import { createCloud, publishedKeyFrom } from './core/cloud.js';
import { createAssistant } from './core/assistant.js';
import { createLibrary } from './core/library.js';
import { createTabs, splitTabs } from './core/tabs.js';
import { createNavigator } from './core/navigate.js';
import { createLinkDialog } from './ui/link-dialog.js';
import { createTabStrip } from './ui/tabs.js';
import { createHandleStore } from './core/handles.js';
import { createLibraryDialog } from './ui/library.js';
import { createTheme } from './ui/theme.js';
import { createPanels } from './ui/panels.js';
import { createPresenter } from './ui/present.js';
import { createEmbedDialog } from './ui/embed-dialog.js';
import { embedded } from './core/embed.js';

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

/*
 * The store holds one drawing; the file may hold several.
 *
 * Splitting here rather than inside the store is what keeps tabs out of every
 * other module: nothing below this line has to know whether the file it came
 * from had one drawing in it or five. See core/tabs.js.
 */
const startingTabs = splitTabs(startingDocument());
const store = createStore(startingTabs[0].doc);

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
const handles = createHandleStore();
const library = createLibrary({ store, files: handles });
// Before `io`, which writes and reads the whole file rather than the drawing on
// screen, and so has to be able to ask what the whole file is.
const tabs = createTabs({
  store,
  initial: startingTabs,
  // A different drawing is a different thing to look at, so it arrives framed.
  onSwitch: () => {
    commands?.zoomFit();
    scheduleRender();
  },
});
const io = createIO({
  store,
  tabs,
  toaster,
  onOpened: () => commands.zoomFit(),
  // Whichever way a file arrived, the library learns which file it was — and
  // keeps the handle, so the entry can reopen it rather than only name it.
  onFile: async ({ fileName, handle }) => {
    // The same file reopens its own record rather than spawning a second one,
    // and a different file is a different diagram rather than an edit to this.
    const known = library.matching({ fileName });
    if (!known) library.startFresh();
    const entry = library.remember(tabs.document(), { id: known?.id, source: 'file', fileName });
    if (handle) await handles.keep(entry.id, handle);
    library.remember(tabs.document(), { id: entry.id, handleKey: handle ? entry.id : null });
  },
});
const commands = createCommands({ store, scene, toaster, io, library, tabs });
const exporter = createExporter({ store, scene, toaster });

const shortcuts = createShortcutsDialog(document.body);
const feedback = createFeedbackPrompt(document.body);
// Nothing here reaches the network until `features.load()` has been answered,
// and in a build without the hosted marker it never asks.
const features = createFeatures();
const cloud = createCloud({ store, toaster, document: () => tabs.document() });
const assistant = createAssistant({ store, commands, library, tabs });
const exportDialog = createExportDialog(document.body, {
  store,
  exporter,
  onExported: () => feedback.maybeAsk(),
});
const publishDialog = createPublishDialog(document.body, {
  cloud,
  store,
  toaster,
  onPublished: (result) => library.recordPublish(result),
});
const embedDialog = createEmbedDialog(document.body, {
  store,
  tabs,
  toaster,
  // For the one thing the sheet offers to *do*: turn a diagram whose address
  // runs to kilobytes into a short link, without sending anyone off to another
  // sheet and back. The library keeps the address either way, exactly as it
  // does when the publish sheet is what produced it.
  cloud,
  onPublished: (result) => library.recordPublish(result),
});
const libraryDialog = createLibraryDialog(document.body, {
  library,
  toaster,
  onDelete: (entry) => library.forget(entry.id),
  onOpen: (entry) => openFromLibrary(entry),
});
/*
 * The one thing the desktop app does not get.
 *
 * Both offers below — the toolbar button and the assistant's note about MCP —
 * are for a program the desktop build already is, so there it is built at all.
 * Deciding here rather than in each of them keeps the question in one place:
 * neither the toolbar nor the panel has to know that a desktop build exists,
 * they are simply given something to do or not given it.
 */
const downloadDialog = desktopBuild() ? null : createDownloadDialog(document.body);
const assistantPanel = createAssistantPanel(document.body, {
  assistant,
  store,
  toaster,
  onToggle: (open) => toolbar.setAssistantOpen(open),
  onGetDesktop: downloadDialog ? () => downloadDialog.open() : null,
});
// The theme decides the canvas colour for any document that has not named one,
// so what it resolves to has to reach the store the render reads.
const theme = createTheme((state) => {
  store.setUI({ dark: state.dark });
  scheduleRender();
});
store.setUI({ dark: theme.current().dark });
// Takes the interface away and turns editing off; everything it needs is a
// store to say so in, the tabs to step through and the view commands.
const presenter = createPresenter({
  store,
  tabs,
  commands,
  toaster,
  // The strip is hidden while presenting, and a hidden strip cannot measure
  // itself -- so a drawing switched to from in there left its marker behind on
  // the tab that was current when the mode began. It is rendered again here,
  // with a layout under it. `tabStrip` is built further down and this is only
  // ever called long after that.
  onExit: () => tabStrip.render(),
});
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
  onLibrary: () => libraryDialog.open(),
  onDownload: downloadDialog ? () => downloadDialog.open() : null,
  onPresent: () => presenter.enter(),
  onEmbed: () => embedDialog.open(),
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
  onArm: () => {
    panels.armed();
    /*
     * Show the hint at once, rather than at the next cell boundary.
     *
     * The ghost is refreshed when the pointer moves to a *different* cell, so
     * arming something while the pointer is already sitting still left the
     * canvas with no hint at all until you happened to cross a line — and the
     * hint is how you decide where to press.
     */
    pointer.refreshOverlay();
  },
});
/*
 * Following the links written on the drawing.
 *
 * Built here rather than inside the pointer or the panel because it is the one
 * thing in the editor that needs all of them at once: the drawing on screen to
 * read the link off, the whole file to resolve it against, the camera to fly,
 * and a sheet to ask before leaving. Everything that can follow a link -- a
 * click while presenting, Ctrl-click while editing, the button in the panel --
 * comes through this and not through three implementations of it.
 */
const linkDialog = createLinkDialog(document.body);
const links = createNavigator({
  store,
  tabs,
  commands,
  toaster,
  askExternal: (href, options) => linkDialog.ask(href, options),
});
const inspector = createInspector({ root: region('inspector'), store, commands, links });
// Inside the canvas, so it sits over the drawing rather than taking a strip of
// the window from it — and so it is beside what it switches between.
const tabStrip = createTabStrip(canvasEl, { tabs, toaster, onChange: () => scheduleRender() });

const pointer = attachPointer({
  canvas: canvasEl,
  store,
  scene,
  overlay,
  toaster,
  onEditText: () => inspector.focusEditor(),
  links,
  // A hand on the camera outranks a flight it is already making.
  onCameraGrab: () => commands.stopGlide(),
});
attachKeyboard({
  store,
  commands,
  io,
  panels,
  onExport: () => exportDialog.open(),
  onPresent: () => presenter.enter(),
});

/*
 * This page is a frame on somebody else's site.
 *
 * Everything below the flag follows from that: it opens presenting and locked,
 * and the three things that write to this browser on behalf of *its* owner --
 * the draft, the library and the analytics question -- are all off. An embed
 * is a visit to a page that happens to contain a diagram, and it has no
 * business leaving a stranger's document in the reader's editor, nor asking
 * them a question they did not come here to answer.
 */
const isEmbed = embedded();

io.attachDropZone(canvasEl, (e) => {
  const r = canvasEl.getBoundingClientRect();
  const g = screenToGrid(store.state.camera, e.clientX - r.left, e.clientY - r.top, 0);
  return { x: Math.floor(g.x), y: Math.floor(g.y) };
});

// Pasting a screenshot straight onto the canvas is the fastest way in.
window.addEventListener('paste', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (store.state.presenting) return; // presenting is not editing
  const file = [...(e.clipboardData?.items ?? [])]
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .find((f) => f && f.type.startsWith('image/'));
  if (!file) return;
  e.preventDefault();
  e.stopPropagation();
  io.insertImage(file, store.state.hover ?? { x: 0, y: 0 });
}, true);
/*
 * The library follows the document, debounced like the autosave beside it.
 *
 * Not on every keystroke -- writing the whole list that often would be the most
 * expensive thing in the editor -- and not only on save, because a diagram
 * someone worked on for an hour and never saved is exactly the one worth
 * finding in a list tomorrow.
 */
let libraryTimer = 0;
if (!isEmbed) {
  store.subscribe((state, what) => {
    if (what !== 'doc') return;
    clearTimeout(libraryTimer);
    libraryTimer = setTimeout(() => library.remember(tabs.document()), 1500);
  });
  io.startAutosave();

  // Does nothing at all unless this build was made with analytics in it, which
  // is every build except one made deliberately with MASSING_VERCEL_FEATURES=1.
  createConsent();
}

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
    // The assistant panel reads the selection, so it repaints with everything
    // else rather than only when the conversation changes.
    assistantPanel.render(state);
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
// A frame on somebody else's page carries its own diagram in its address. There
// is no draft of theirs to recover into it, and offering one would put a
// stranger's work in the middle of an article.
else if (!isEmbed) offerRecovery();

/*
 * Presenting from the first frame.
 *
 * Before the document arrives rather than after: opening the diagram is a
 * network round trip for a published link and a decompression for a shared one,
 * and a frame that showed the editor's panels for half a second before folding
 * them away would announce itself as a web app on a page that asked for a
 * picture. Both routes fit the camera when they land, so nothing is lost by
 * being early.
 */
if (isEmbed) presenter.enter({ locked: true });

// Last, because it is the only thing here that touches the network, and the
// editor has to be usable before the answer arrives — or without one.
features.load().then((flags) => {
  toolbar.setHostedFeatures(flags);
  embedDialog.setHostedFeatures(flags);
});

/**
 * Open something out of the library, by whichever route it still has.
 *
 * Stored text first, because it is instant and needs nobody's permission. Then
 * the file, which is a real prompt on a real click — and is exactly why this is
 * not attempted at start-up. Then the published link, which is the only route
 * left for a diagram too large to have kept its text.
 */
async function openFromLibrary(entry) {
  library.setCurrent(entry.id);

  const stored = library.read(entry.id);
  if (stored?.doc) {
    tabs.load(stored.doc);
    io.forget();
    commands.zoomFit();
    toaster.info(`Opened ${entry.title}`);
    return;
  }

  if (entry.handleKey) {
    const handle = await handles.recall(entry.handleKey);
    const file = handle && (await handles.fileFrom(handle));
    if (file) return void io.loadFile(file, { handle });
    toaster.warn(`${entry.fileName ?? 'That file'} could not be reopened — it may have moved.`);
  }

  if (entry.published && !entry.published.gone) {
    return void openPublishedDiagram(entry.published.displayId, entry.id);
  }

  toaster.error(`"${entry.title}" has nothing left to open it from.`, {
    detail: 'Its contents were too large to keep here, its file cannot be reached, and it has no live published link.',
  });
}

/**
 * Open a diagram published to this deployment.
 *
 * The failure that matters is a link someone was given that does not work, so
 * it is reported with the key in it rather than swallowed — and the sample
 * stays on screen, which at least leaves something to work with.
 */
async function openPublishedDiagram(key, entryId = null) {
  try {
    const result = await cloud.fetchDiagram(key);
    if (result.rejection) throw new Error(result.rejection);
    tabs.load(result.doc);
    io.forget();
    commands.zoomFit();
    const known = entryId ? { id: entryId } : library.matching({ displayId: key });
    if (!known) library.startFresh();
    library.remember(tabs.document(), { id: known?.id, source: 'published' });
    toaster.warnings(result.warnings);
    if (!result.warnings.length) toaster.info(`Opened ${key}`);
  } catch (err) {
    // Expired or swept: the library stops offering the link, without a fuss
    // about it. The record stays, because the document may still be here.
    if (err.gone && entryId) library.markPublishGone(entryId, err.gone);
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
    // The draft and the library's newest entry are the same document by two
    // routes. Reuniting them is what keeps a restore from arriving as an
    // untitled stranger with none of its conversations attached.
    const known = library.matchingText(serializeDoc(tabs.document()));
    if (known) library.setCurrent(known.id);
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
    const url = shareUrlFrom(await encodeShareText(serializeDoc(tabs.document())));
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

/*
 * Exposed for the console and for automated checks.
 *
 * `tabs` joined the list when the desktop build needed to add a drawing to the
 * open file from outside the window. It belongs here anyway: this is the
 * handle on "the whole file" as opposed to the drawing on screen, and every
 * other member of this object had already been reached for from a console at
 * some point while the one that answers "what is actually in this file" was
 * the one you could not get at.
 */
window.massing = {
  store, scene, commands, io, exporter, exportDialog, pointer, tabs, toaster,
  presenter, links,
  prompt: LLM_PROMPT,
};
