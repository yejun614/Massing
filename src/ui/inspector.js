/**
 * Property inspector.
 *
 * The panel is rebuilt only when the *shape* of the selection changes; while
 * the selection holds, field values are synced in place. Without that, typing
 * in a text box would rebuild the panel on every keystroke and steal focus.
 *
 * Text and number edits are wrapped in a store gesture, so a whole editing
 * session collapses into one undo entry rather than one per character.
 */

import { h, clear, setClass, setText, copyText } from '../util/dom.js';
import { COMPONENTS, GROUP_KINDS, componentFor } from '../data/components.js';
import {
  nodeById,
  groupById,
  edgeById,
  textById,
  imageById,
  planarById,
  shapeById,
  cellsById,
  entityById,
} from '../core/doc.js';
import { SHAPE_KINDS, DEFAULT_SHAPE_KIND } from '../data/shapes.js';
import { PLANES, PLANE_LABELS, SPINS } from '../geom/plane.js';
// The defaults come from the schema rather than being written out again here:
// a literal in the inspector is exactly how the two drift apart, and a control
// that shows the wrong default is worse than one that shows none.
import {
  DEFAULT_PLANE,
  DEFAULT_ZONE_LABEL_PLANE,
  DEFAULT_LABEL_ALIGN,
  SHAPE_DEFAULTS,
  CELLS_DEFAULTS,
} from '../core/schema.js';
import { approximateBytes, formatSize } from '../core/images.js';

/** Shared by every caption control, so the wording cannot drift apart. */
const ALIGN_OPTIONS = [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']];

/** Which side of a decision an answer leaves from. */
const SIDE_OPTIONS = [
  ['top', 'Top'],
  ['right', 'Right'],
  ['bottom', 'Bottom'],
  ['left', 'Left'],
];

const SWATCHES = [
  '#ed7100', '#f59e0b', '#eab308', '#7aa116', '#16a34a', '#0ea5a5', '#2a7fd4', '#2563eb',
  '#8c4fff', '#a855f7', '#c925d1', '#e7157b', '#dd344c', '#78716c', '#64748b', '#334155',
];

/**
 * @param {object} options
 * @param {{follow: Function, explain: Function}} [options.links]
 *   The navigator. The panel needs it for two things a field cannot work out on
 *   its own: what the link someone just typed actually resolves to — which
 *   depends on the whole file, not on the entity being edited — and a button to
 *   try it, because a link you cannot test from where you wrote it is a link
 *   you find out about in front of an audience.
 */
export function createInspector({ root, store, commands, links = null }) {
  let signature = null;
  let fields = [];

  function render(state) {
    const sig = signatureOf(state);
    if (sig !== signature) {
      signature = sig;
      fields = build(state);
    }
    for (const field of fields) field.sync(state);
  }

  function build(state) {
    clear(root);
    const { doc, selection } = state;

    if (selection.length === 0) return buildDocument(root, store);
    if (selection.length > 1) return buildMulti(root, store, commands, selection);

    const found = entityById(doc, selection[0]);
    if (!found) return buildDocument(root, store);
    const { id } = found.entity;
    if (found.kind === 'node') return buildNode(root, store, id, links);
    if (found.kind === 'group') return buildGroup(root, store, id, links);
    if (found.kind === 'text') return buildText(root, store, id, links);
    if (found.kind === 'image') return buildImage(root, store, id, links);
    if (found.kind === 'shape') return buildShape(root, store, id, links);
    if (found.kind === 'cells') return buildCells(root, store, id, links);
    return buildEdge(root, store, id, links);
  }

  /**
   * Put the caret in the panel's first writable field, all of it selected.
   *
   * Deferred by a frame because the panel is rebuilt from the render loop, so
   * at the moment a caller selects something and asks for this, the field it
   * means does not exist yet. Selecting the contents rather than only focusing
   * is what makes a note's placeholder disappear as soon as you type.
   */
  function focusEditor() {
    requestAnimationFrame(() => {
      const field = root.querySelector('textarea, input[type="text"]');
      if (!field) return;
      field.focus({ preventScroll: true });
      field.select();
    });
  }

  return { render, focusEditor };
}

/** Rebuild only when the selection identity or entity kinds change. */
function signatureOf(state) {
  if (!state.selection.length) return 'doc';
  return state.selection.join('|');
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function buildDocument(root, store) {
  const fields = [];
  const section = panelHead('Diagram');

  fields.push(
    textField(section, store, {
      label: 'Title',
      get: (s) => s.doc.meta.title,
      set: (value) => (doc) => (doc.meta.title = value),
    })
  );
  fields.push(
    swatchField(section, store, {
      label: 'Background',
      auto: 'Follow the theme',
      colors: ['#eef1f5', '#f8fafc', '#ffffff', '#e2e8f0', '#1e293b', '#0f172a'],
      get: (s) => s.doc.canvas.background,
      set: (value) => (doc) => (doc.canvas.background = value),
    })
  );

  root.append(section);
  root.append(
    h('section', { class: 'section' }, [
      h('h2', { class: 'section-title', text: 'Getting started' }),
      h('p', {
        class: 'panel-hint',
        text: 'Pick a component on the left, then click the canvas to place it. Drag to move, G to draw a zone, C to connect.',
      }),
    ])
  );
  return fields;
}

function buildNode(root, store, id, links) {
  const fields = [];
  const section = panelHead('Block', id);
  const withNode = (fn) => (doc) => {
    const node = nodeById(doc, id);
    if (node) fn(node);
  };

  fields.push(
    textField(section, store, {
      label: 'Label',
      get: (s) => nodeById(s.doc, id)?.label ?? '',
      set: (value) => withNode((n) => (n.label = value)),
    })
  );

  fields.push(
    selectField(section, store, {
      label: 'Type',
      options: COMPONENTS.map((c) => [c.type, c.label]),
      get: (s) => nodeById(s.doc, id)?.type ?? 'generic',
      set: (value) =>
        withNode((n) => {
          // Carry over the visual defaults only when they were untouched.
          const previous = componentFor(n.type);
          const next = componentFor(value);
          if (n.color === previous.color) n.color = next.color;
          if (n.height === previous.height) n.height = next.height;
          n.type = value;
        }),
    })
  );

  fields.push(
    pairField(section, store, {
      label: 'Size',
      min: 1,
      get: (s) => nodeById(s.doc, id)?.size ?? [2, 2],
      set: (pair) => withNode((n) => (n.size = pair)),
    })
  );

  fields.push(
    numberField(section, store, {
      label: 'Height',
      min: 0,
      max: 40,
      step: 0.1,
      get: (s) => nodeById(s.doc, id)?.height ?? 1,
      set: (value) => withNode((n) => (n.height = value)),
    })
  );

  fields.push(
    pairField(section, store, {
      label: 'Position',
      min: -400,
      get: (s) => nodeById(s.doc, id)?.pos ?? [0, 0],
      set: (pair) => withNode((n) => (n.pos = pair)),
    })
  );

  fields.push(
    swatchField(section, store, {
      label: 'Colour',
      colors: SWATCHES,
      get: (s) => nodeById(s.doc, id)?.color ?? '#64748b',
      set: (value) => withNode((n) => (n.color = value)),
    })
  );

  fields.push(
    selectField(section, store, {
      label: 'Label on',
      options: PLANES.map((p) => [p, PLANE_LABELS[p]]),
      get: (s) => nodeById(s.doc, id)?.labelPlane ?? DEFAULT_PLANE,
      set: (value) => withNode((n) => (n.labelPlane = value)),
    })
  );

  fields.push(
    numberField(section, store, {
      label: 'Label size',
      min: 6,
      max: 96,
      get: (s) => nodeById(s.doc, id)?.labelSize ?? 12,
      set: (value) => withNode((n) => (n.labelSize = value)),
    })
  );

  fields.push(
    selectField(section, store, {
      label: 'Label align',
      options: ALIGN_OPTIONS,
      get: (s) => nodeById(s.doc, id)?.labelAlign ?? DEFAULT_LABEL_ALIGN,
      set: (value) => withNode((n) => (n.labelAlign = value)),
    })
  );

  fields.push(
    areaField(section, store, {
      label: 'Notes',
      get: (s) => nodeById(s.doc, id)?.props?.note ?? '',
      set: (value) =>
        withNode((n) => {
          if (value) n.props.note = value;
          else delete n.props.note;
        }),
    })
  );

  root.append(section);
  linkSection(root, store, id, fields, links);
  return fields;
}

function buildGroup(root, store, id, links) {
  const fields = [];
  const section = panelHead('Zone', id);
  const withGroup = (fn) => (doc) => {
    const group = groupById(doc, id);
    if (group) fn(group);
  };

  fields.push(
    textField(section, store, {
      label: 'Label',
      get: (s) => groupById(s.doc, id)?.label ?? '',
      set: (value) => withGroup((g) => (g.label = value)),
    })
  );
  fields.push(
    selectField(section, store, {
      label: 'Kind',
      options: GROUP_KINDS.map((k) => [k.kind, k.label]),
      get: (s) => groupById(s.doc, id)?.kind ?? 'group',
      set: (value) => withGroup((g) => (g.kind = value)),
    })
  );
  fields.push(
    pairField(section, store, {
      label: 'Position',
      min: -400,
      get: (s) => (groupById(s.doc, id)?.rect ?? [0, 0, 4, 4]).slice(0, 2),
      set: (pair) => withGroup((g) => (g.rect = [pair[0], pair[1], g.rect[2], g.rect[3]])),
    })
  );
  fields.push(
    pairField(section, store, {
      label: 'Size',
      min: 1,
      get: (s) => (groupById(s.doc, id)?.rect ?? [0, 0, 4, 4]).slice(2),
      set: (pair) => withGroup((g) => (g.rect = [g.rect[0], g.rect[1], pair[0], pair[1]])),
    })
  );
  fields.push(
    swatchField(section, store, {
      label: 'Colour',
      colors: SWATCHES,
      get: (s) => groupById(s.doc, id)?.color ?? '#64748b',
      set: (value) => withGroup((g) => (g.color = value)),
    })
  );

  fields.push(
    selectField(section, store, {
      label: 'Label on',
      options: PLANES.map((p) => [p, PLANE_LABELS[p]]),
      get: (s) => groupById(s.doc, id)?.labelPlane ?? DEFAULT_ZONE_LABEL_PLANE,
      set: (value) => withGroup((g) => (g.labelPlane = value)),
    })
  );

  fields.push(
    numberField(section, store, {
      label: 'Label size',
      min: 6,
      max: 96,
      get: (s) => groupById(s.doc, id)?.labelSize ?? 12,
      set: (value) => withGroup((g) => (g.labelSize = value)),
    })
  );

  root.append(section);
  linkSection(root, store, id, fields, links);
  return fields;
}

function buildText(root, store, id, links) {
  const fields = [];
  const section = panelHead('Text', id);
  const withText = (fn) => (doc) => {
    const note = textById(doc, id);
    if (note) fn(note);
  };

  fields.push(
    areaField(section, store, {
      label: 'Content',
      rows: 5,
      get: (s) => textById(s.doc, id)?.text ?? '',
      set: (value) => withText((t) => (t.text = value)),
    })
  );

  fields.push(
    toggleField(section, store, {
      label: 'Style',
      options: [
        ['bold', 'B', 'Bold', 'font-weight:700'],
        ['italic', 'I', 'Italic', 'font-style:italic'],
        ['underline', 'U', 'Underline', 'text-decoration:underline'],
      ],
      get: (s) => textById(s.doc, id),
      set: (key, value) => withText((t) => (t[key] = value)),
    })
  );

  fields.push(
    numberField(section, store, {
      label: 'Size',
      min: 6,
      max: 200,
      get: (s) => textById(s.doc, id)?.size ?? 14,
      set: (value) => withText((t) => (t.size = value)),
    })
  );

  fields.push(
    selectField(section, store, {
      label: 'Align',
      options: ALIGN_OPTIONS,
      get: (s) => textById(s.doc, id)?.align ?? 'left',
      set: (value) => withText((t) => (t.align = value)),
    })
  );

  fields.push(
    pairField(section, store, {
      label: 'Position',
      min: -400,
      get: (s) => textById(s.doc, id)?.pos ?? [0, 0],
      set: (pair) => withText((t) => (t.pos = pair)),
    })
  );

  fields.push(
    swatchField(section, store, {
      label: 'Colour',
      colors: SWATCHES,
      get: (s) => textById(s.doc, id)?.color ?? '#334155',
      set: (value) => withText((t) => (t.color = value)),
    })
  );

  root.append(section);
  planarFields(root, store, id, fields);
  linkSection(root, store, id, fields, links);
  return fields;
}

/**
 * Plane, spin, elevation and stacking -- everything that decides how a flat
 * rectangle hangs in the isometric world. Shared by pictures and notes, since
 * they are placed by exactly the same rules.
 */
function planarFields(root, store, id, fields) {
  const section = h('section', { class: 'section' }, [
    h('h2', { class: 'section-title', text: 'Placement' }),
  ]);
  const withEl = (fn) => (doc) => {
    const el = planarById(doc, id);
    if (el) fn(el);
  };

  fields.push(
    selectField(section, store, {
      label: 'Plane',
      options: PLANES.map((p) => [p, PLANE_LABELS[p]]),
      get: (s) => planarById(s.doc, id)?.plane ?? DEFAULT_PLANE,
      set: (value) => withEl((el) => (el.plane = value)),
    })
  );
  fields.push(
    selectField(section, store, {
      label: 'Rotation',
      options: SPINS.map((deg) => [String(deg), `${deg}°`]),
      get: (s) => String(planarById(s.doc, id)?.spin ?? 0),
      set: (value) => withEl((el) => (el.spin = Number(value))),
    })
  );
  fields.push(
    numberField(section, store, {
      label: 'Elevation',
      min: 0,
      max: 40,
      get: (s) => planarById(s.doc, id)?.z ?? 0,
      set: (value) => withEl((el) => (el.z = value)),
    })
  );
  fields.push(
    checkboxField(section, store, {
      label: 'Behind',
      caption: 'Draw underneath the blocks',
      get: (s) => !!planarById(s.doc, id)?.behind,
      set: (value) => withEl((el) => (el.behind = value)),
    })
  );

  root.append(section);
}

function buildImage(root, store, id, links) {
  const fields = [];
  const section = panelHead('Picture', id);
  const withImage = (fn) => (doc) => {
    const im = imageById(doc, id);
    if (im) fn(im);
  };

  const preview = h('img', { class: 'image-preview', alt: '' });
  section.append(preview);

  fields.push(
    textField(section, store, {
      label: 'Label',
      get: (s) => imageById(s.doc, id)?.label ?? '',
      set: (value) => withImage((im) => (im.label = value)),
    })
  );
  fields.push(
    pairField(section, store, {
      label: 'Size',
      min: 1,
      get: (s) => imageById(s.doc, id)?.size ?? [6, 4],
      set: (pair) => withImage((im) => (im.size = pair)),
    })
  );
  fields.push(
    pairField(section, store, {
      label: 'Position',
      min: -400,
      get: (s) => imageById(s.doc, id)?.pos ?? [0, 0],
      set: (pair) => withImage((im) => (im.pos = pair)),
    })
  );
  fields.push(
    rangeField(section, store, {
      label: 'Opacity',
      min: 5,
      max: 100,
      get: (s) => Math.round((imageById(s.doc, id)?.opacity ?? 1) * 100),
      set: (value) => withImage((im) => (im.opacity = value / 100)),
    })
  );

  const weight = h('div', { class: 'entity-id' });
  section.append(weight);
  fields.push({
    sync: (state) => {
      const im = imageById(state.doc, id);
      if (!im) return;
      if (preview.getAttribute('src') !== im.src) preview.setAttribute('src', im.src);
      setText(weight, `${formatSize(approximateBytes(im.src))} embedded`);
    },
  });

  root.append(section);
  planarFields(root, store, id, fields);
  linkSection(root, store, id, fields, links);
  return fields;
}


/**
 * A flowchart shape.
 *
 * `Kind` sits at the top because it is the one field that changes what the
 * thing *says* — a process that should have been a decision is a wrong diagram,
 * not a mis-styled one — and because swapping it keeps everything else, so a
 * step can be re-labelled as a question without being drawn again.
 *
 * The two branch fields appear only on a decision. They are stored on every
 * kind, so nothing typed is lost by a change of mind, but a "Yes" caption on a
 * plain box would be a control with nowhere to put its result.
 */
function buildShape(root, store, id, links) {
  const fields = [];
  const section = panelHead('Flowchart shape', id);
  const withShape = (fn) => (doc) => {
    const shape = shapeById(doc, id);
    if (shape) fn(shape);
  };

  fields.push(
    selectField(section, store, {
      label: 'Kind',
      options: SHAPE_KINDS.map((k) => [k.kind, k.label]),
      get: (s) => shapeById(s.doc, id)?.kind ?? DEFAULT_SHAPE_KIND,
      set: (value) => withShape((sh) => (sh.kind = value)),
    })
  );

  fields.push(
    textField(section, store, {
      label: 'Label',
      get: (s) => shapeById(s.doc, id)?.label ?? '',
      set: (value) => withShape((sh) => (sh.label = value)),
    })
  );

  fields.push(
    pairField(section, store, {
      label: 'Size',
      min: 1,
      get: (s) => shapeById(s.doc, id)?.size ?? [5, 2],
      set: (pair) => withShape((sh) => (sh.size = pair)),
    })
  );

  fields.push(
    numberField(section, store, {
      label: 'Height',
      min: 0,
      max: 40,
      step: 0.1,
      get: (s) => shapeById(s.doc, id)?.height ?? SHAPE_DEFAULTS.height,
      set: (value) => withShape((sh) => (sh.height = value)),
    })
  );

  fields.push(
    pairField(section, store, {
      label: 'Position',
      min: -400,
      get: (s) => shapeById(s.doc, id)?.pos ?? [0, 0],
      set: (pair) => withShape((sh) => (sh.pos = pair)),
    })
  );

  fields.push(
    swatchField(section, store, {
      label: 'Colour',
      colors: SWATCHES,
      get: (s) => shapeById(s.doc, id)?.color ?? SHAPE_DEFAULTS.color,
      set: (value) => withShape((sh) => (sh.color = value)),
    })
  );

  fields.push(
    selectField(section, store, {
      label: 'Label on',
      options: PLANES.map((p) => [p, PLANE_LABELS[p]]),
      get: (s) => shapeById(s.doc, id)?.labelPlane ?? SHAPE_DEFAULTS.labelPlane,
      set: (value) => withShape((sh) => (sh.labelPlane = value)),
    })
  );

  fields.push(
    numberField(section, store, {
      label: 'Label size',
      min: 6,
      max: 96,
      get: (s) => shapeById(s.doc, id)?.labelSize ?? SHAPE_DEFAULTS.labelSize,
      set: (value) => withShape((sh) => (sh.labelSize = value)),
    })
  );
  root.append(section);

  // --- branches -------------------------------------------------------------
  const branches = h('section', { class: 'section' }, [
    h('h2', { class: 'section-title', text: 'Branches' }),
    h('p', { class: 'panel-hint', text:
      'Written beside the shape, on the side each answer leaves from.' }),
  ]);
  for (const [key, at, label] of [['yes', 'yesAt', 'Yes'], ['no', 'noAt', 'No']]) {
    fields.push(
      textField(branches, store, {
        label,
        get: (s) => shapeById(s.doc, id)?.[key] ?? '',
        set: (value) => withShape((sh) => (sh[key] = value)),
      })
    );
    fields.push(
      selectField(branches, store, {
        label: `${label} side`,
        options: SIDE_OPTIONS,
        get: (s) => shapeById(s.doc, id)?.[at] ?? SHAPE_DEFAULTS[at],
        set: (value) => withShape((sh) => (sh[at] = value)),
      })
    );
  }
  // Shown only where there is somewhere to put them, and synced like a field so
  // changing the kind reveals or hides it without rebuilding the panel.
  fields.push({
    sync: (state) => {
      setClass(branches, 'is-hidden', shapeById(state.doc, id)?.kind !== 'decision');
    },
  });
  root.append(branches);

  linkSection(root, store, id, fields, links);
  return fields;
}


/**
 * A data structure: a run of slots.
 *
 * The values are one field, a line per slot, because that is how the thing is
 * actually edited — you retype the row after a swap, you do not hunt for the
 * third box. The same goes for the pointers: `2: top` on its own line beats a
 * pair of controls per marker, and it reads as what it produces.
 */
function buildCells(root, store, id, links) {
  const NEWLINE = String.fromCharCode(10);
  const fields = [];
  const section = panelHead('Data structure', id);
  const withCells = (fn) => (doc) => {
    const c = cellsById(doc, id);
    if (c) fn(c);
  };

  fields.push(
    textField(section, store, {
      label: 'Name',
      get: (s) => cellsById(s.doc, id)?.label ?? '',
      set: (value) => withCells((c) => (c.label = value)),
    })
  );

  fields.push(
    textField(section, store, {
      label: 'Description',
      get: (s) => cellsById(s.doc, id)?.description ?? '',
      set: (value) => withCells((c) => (c.description = value)),
    })
  );

  fields.push(
    areaField(section, store, {
      label: 'Values',
      get: (s) => (cellsById(s.doc, id)?.items ?? []).join(NEWLINE),
      // Trailing blanks are dropped so an accidental newline does not become an
      // empty slot, but blanks *between* values are kept: a gap in an array is
      // usually the point being made.
      set: (value) => withCells((c) => {
        const lines = value.split(NEWLINE);
        while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
        c.items = lines.map((line) => line.trim());
      }),
    })
  );

  fields.push(
    pairField(section, store, {
      label: 'Slots',
      min: 1,
      max: 200,
      get: (s) => {
        const c = cellsById(s.doc, id);
        return [c?.cols ?? 1, c?.rows ?? 1];
      },
      set: (pair) => withCells((c) => {
        c.cols = pair[0];
        c.rows = pair[1];
      }),
    })
  );

  fields.push(
    pairField(section, store, {
      label: 'Slot size',
      min: 1,
      get: (s) => cellsById(s.doc, id)?.slot ?? CELLS_DEFAULTS.slot,
      set: (pair) => withCells((c) => (c.slot = pair)),
    })
  );

  fields.push(
    numberField(section, store, {
      label: 'Height',
      min: 0,
      max: 40,
      step: 0.1,
      get: (s) => cellsById(s.doc, id)?.height ?? CELLS_DEFAULTS.height,
      set: (value) => withCells((c) => (c.height = value)),
    })
  );

  fields.push(
    pairField(section, store, {
      label: 'Position',
      min: -400,
      get: (s) => cellsById(s.doc, id)?.pos ?? [0, 0],
      set: (pair) => withCells((c) => (c.pos = pair)),
    })
  );

  fields.push(
    checkboxField(section, store, {
      label: 'Index numbers',
      get: (s) => !!cellsById(s.doc, id)?.indices,
      set: (value) => withCells((c) => (c.indices = value)),
    })
  );

  fields.push(
    pairTextField(section, store, {
      label: 'Ends',
      placeholder: ['Front', 'Back'],
      get: (s) => cellsById(s.doc, id)?.ends ?? ['', ''],
      set: (pair) => withCells((c) => (c.ends = pair)),
    })
  );

  fields.push(
    selectField(section, store, {
      label: 'Flow',
      options: [
        ['', 'None'],
        ['back', 'Towards the first'],
        ['forward', 'Towards the last'],
        ['both', 'In and out at each end'],
      ],
      get: (s) => cellsById(s.doc, id)?.flow ?? '',
      set: (value) => withCells((c) => (c.flow = value || null)),
    })
  );

  fields.push(
    areaField(section, store, {
      label: 'Pointers',
      get: (s) =>
        (cellsById(s.doc, id)?.marks ?? []).map((m) => `${m.at}: ${m.text}`).join(NEWLINE),
      set: (value) => withCells((c) => {
        c.marks = value
          .split(NEWLINE)
          .map((line) => {
            const at = /^\s*(\d+)\s*[:=]?\s*(.*)$/.exec(line);
            if (!at || !at[2].trim()) return null;
            return { at: Number(at[1]), text: at[2].trim() };
          })
          .filter(Boolean);
      }),
    })
  );
  section.append(
    h('p', { class: 'panel-hint', text: 'One per line, as "2: top" — the slot number, then what points at it.' })
  );

  fields.push(
    swatchField(section, store, {
      label: 'Colour',
      colors: SWATCHES,
      get: (s) => cellsById(s.doc, id)?.color ?? CELLS_DEFAULTS.color,
      set: (value) => withCells((c) => (c.color = value)),
    })
  );

  fields.push(
    selectField(section, store, {
      label: 'Text on',
      options: PLANES.map((p) => [p, PLANE_LABELS[p]]),
      get: (s) => cellsById(s.doc, id)?.labelPlane ?? CELLS_DEFAULTS.labelPlane,
      set: (value) => withCells((c) => (c.labelPlane = value)),
    })
  );

  fields.push(
    numberField(section, store, {
      label: 'Text size',
      min: 6,
      max: 96,
      get: (s) => cellsById(s.doc, id)?.labelSize ?? CELLS_DEFAULTS.labelSize,
      set: (value) => withCells((c) => (c.labelSize = value)),
    })
  );

  root.append(section);
  linkSection(root, store, id, fields, links);
  return fields;
}

function buildEdge(root, store, id, links) {
  const fields = [];
  const section = panelHead('Connection', id);
  const withEdge = (fn) => (doc) => {
    const edge = edgeById(doc, id);
    if (edge) fn(edge);
  };

  fields.push(
    textField(section, store, {
      label: 'Label',
      get: (s) => edgeById(s.doc, id)?.label ?? '',
      set: (value) => withEdge((e) => (e.label = value)),
    })
  );
  fields.push(
    selectField(section, store, {
      label: 'Style',
      options: [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']],
      get: (s) => edgeById(s.doc, id)?.style ?? 'solid',
      set: (value) => withEdge((e) => (e.style = value)),
    })
  );
  fields.push(
    selectField(section, store, {
      label: 'Arrows',
      options: [['end', 'To target'], ['start', 'To source'], ['both', 'Both'], ['none', 'None']],
      get: (s) => edgeById(s.doc, id)?.arrow ?? 'end',
      set: (value) => withEdge((e) => (e.arrow = value)),
    })
  );
  fields.push(
    swatchField(section, store, {
      label: 'Colour',
      colors: SWATCHES,
      get: (s) => edgeById(s.doc, id)?.color ?? '#64748b',
      set: (value) => withEdge((e) => (e.color = value)),
    })
  );

  fields.push(
    selectField(section, store, {
      label: 'Route',
      options: [['auto', 'Automatic'], ['x', 'Turn along X'], ['y', 'Turn along Y']],
      get: (s) => edgeById(s.doc, id)?.route ?? 'auto',
      set: (value) =>
        withEdge((e) => {
          // The crossover is a coordinate on one particular axis, so it means
          // nothing on the other one — and automatic owns the crossover too.
          // Either way, changing this is the way back to a clean route.
          if (e.route !== value) e.bend = null;
          e.route = value;
        }),
    })
  );

  fields.push(
    selectField(section, store, {
      label: 'Label on',
      options: PLANES.map((p) => [p, PLANE_LABELS[p]]),
      get: (s) => edgeById(s.doc, id)?.labelPlane ?? DEFAULT_PLANE,
      set: (value) => withEdge((e) => (e.labelPlane = value)),
    })
  );

  fields.push(
    numberField(section, store, {
      label: 'Label size',
      min: 6,
      max: 96,
      get: (s) => edgeById(s.doc, id)?.labelSize ?? 12,
      set: (value) => withEdge((e) => (e.labelSize = value)),
    })
  );

  fields.push(
    selectField(section, store, {
      label: 'Label align',
      options: ALIGN_OPTIONS,
      get: (s) => edgeById(s.doc, id)?.labelAlign ?? DEFAULT_LABEL_ALIGN,
      set: (value) => withEdge((e) => (e.labelAlign = value)),
    })
  );

  const edge = edgeById(store.state.doc, id);
  root.append(section);
  if (edge) {
    root.append(
      h('section', { class: 'section' }, [
        h('h2', { class: 'section-title', text: 'Endpoints' }),
        h('div', { class: 'entity-id', text: `${edge.from} → ${edge.to}` }),
      ])
    );
  }
  linkSection(root, store, id, fields, links);
  return fields;
}

/** English plural without a table of exceptions, for the words used below. */
const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** How many ids a multiple selection lists before it starts counting instead. */
const MAX_ID_CHIPS = 12;

/**
 * The value every one of `items` agrees on, or null when they differ.
 *
 * Null is what a field renders as blank, which is the honest thing to show for
 * a mixed selection: an input that displayed the first item's value would be
 * offering to change everything to something only one of them has.
 */
function shared(items, read) {
  if (!items.length) return null;
  const first = read(items[0]);
  return items.every((item) => read(item) === first) ? first : null;
}

/**
 * Editing many things at once.
 *
 * Selecting eight blocks to give them one caption size is the whole reason the
 * uniformity this format wants is achievable by hand, so the panel offers every
 * field that is meaningful across a group rather than colour alone. Which
 * fields appear depends on what is actually selected: connections have no
 * height, notes have no caption plane, and a section for a kind that is not
 * present is a control that cannot do anything.
 *
 * The one thing deliberately missing is caption *text*. Everything here sets
 * one value on many entities, and the only thing that does to a set of names
 * is destroy them.
 */
function buildMulti(root, store, commands, selection) {
  const fields = [];

  /** The selection, resolved against a document and split up by kind. */
  const split = (doc) => {
    const found = selection.map((id) => entityById(doc, id)).filter(Boolean);
    const of = (kind) => found.filter((f) => f.kind === kind).map((f) => f.entity);
    return {
      nodes: of('node'),
      groups: of('group'),
      edges: of('edge'),
      texts: of('text'),
      images: of('image'),
    };
  };

  /** Apply `fn` to every selected entity of one of `kinds`. */
  const each = (kinds, fn) => (doc) => {
    for (const id of selection) {
      const found = entityById(doc, id);
      if (found && kinds.includes(found.kind)) fn(found.entity);
    }
  };

  const have = split(store.state.doc);
  const captioned = [...have.nodes, ...have.groups, ...have.edges];
  const aligned = [...have.nodes, ...have.edges];
  const planar = [...have.texts, ...have.images];

  const summary = [
    have.nodes.length && count(have.nodes.length, 'block'),
    have.groups.length && count(have.groups.length, 'zone'),
    have.edges.length && count(have.edges.length, 'connection'),
    have.texts.length && count(have.texts.length, 'note'),
    have.images.length && count(have.images.length, 'picture'),
  ].filter(Boolean);

  const section = (title) => {
    const el = h('section', { class: 'section' }, [
      h('h2', { class: 'section-title', text: title }),
    ]);
    root.append(el);
    return el;
  };

  const head = section('Selection');
  head.append(h('div', { class: 'entity-kind', text: summary.join(' · ') }));
  /*
   * Every id, as chips.
   *
   * A single selection names itself in its heading, and a multiple one had
   * nothing at all — which made "select these three and tell me what they are
   * called" a matter of clicking each in turn. Marqueeing a corner of the
   * diagram and reading back the names is the fastest way to find the id you
   * want to link to.
   *
   * Capped, because a Select All would otherwise fill the panel with a list
   * nobody is reading. The cap says how much it is hiding rather than trailing
   * off, since "and 40 more" and "and 4 more" are different situations.
   */
  const shown = selection.slice(0, MAX_ID_CHIPS);
  head.append(
    h('div', { class: 'id-chips' }, [
      ...shown.map((id) => idChip(id)),
      selection.length > shown.length
        ? h('span', { class: 'entity-kind', text: `and ${selection.length - shown.length} more` })
        : null,
    ])
  );

  if (captioned.length) {
    fields.push(
      swatchField(head, store, {
        label: 'Colour',
        colors: SWATCHES,
        get: (s) => shared(split(s.doc).nodes.concat(split(s.doc).groups, split(s.doc).edges),
          (e) => e.color),
        set: (value) => each(['node', 'group', 'edge'], (e) => (e.color = value)),
      })
    );
  }

  // --- captions -------------------------------------------------------------
  if (captioned.length) {
    const box = section('Captions');
    fields.push(
      numberField(box, store, {
        label: 'Size',
        min: 6,
        max: 96,
        get: (s) => {
          const d = split(s.doc);
          return shared([...d.nodes, ...d.groups, ...d.edges], (e) => e.labelSize);
        },
        set: (value) => each(['node', 'group', 'edge'], (e) => (e.labelSize = value)),
      }),
      selectField(box, store, {
        label: 'Plane',
        mixed: true,
        options: PLANES.map((p) => [p, PLANE_LABELS[p]]),
        get: (s) => {
          const d = split(s.doc);
          return shared([...d.nodes, ...d.groups, ...d.edges], (e) => e.labelPlane);
        },
        set: (value) => each(['node', 'group', 'edge'], (e) => (e.labelPlane = value)),
      })
    );
    if (aligned.length) {
      fields.push(
        selectField(box, store, {
          label: 'Align',
          mixed: true,
          options: ALIGN_OPTIONS,
          get: (s) => {
            const d = split(s.doc);
            return shared([...d.nodes, ...d.edges], (e) => e.labelAlign);
          },
          set: (value) => each(['node', 'edge'], (e) => (e.labelAlign = value)),
        })
      );
    }
  }

  // --- blocks ---------------------------------------------------------------
  if (have.nodes.length) {
    const box = section('Blocks');
    fields.push(
      pairField(box, store, {
        label: 'Footprint',
        min: 1,
        max: 400,
        // The one action that makes a scattered diagram uniform in one go.
        get: (s) => shared(split(s.doc).nodes, (n) => n.size.join('x'))
          ? split(s.doc).nodes[0].size
          : null,
        set: (value) => each(['node'], (n) => (n.size = [...value])),
      }),
      numberField(box, store, {
        label: 'Height',
        min: 0,
        max: 40,
        step: 0.1,
        get: (s) => shared(split(s.doc).nodes, (n) => n.height),
        set: (value) => each(['node'], (n) => (n.height = value)),
      })
    );
  }

  // --- connections ----------------------------------------------------------
  if (have.edges.length) {
    const box = section('Connections');
    fields.push(
      selectField(box, store, {
        label: 'Line',
        mixed: true,
        options: [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']],
        get: (s) => shared(split(s.doc).edges, (e) => e.style),
        set: (value) => each(['edge'], (e) => (e.style = value)),
      }),
      selectField(box, store, {
        label: 'Arrow',
        mixed: true,
        options: [['end', 'End'], ['start', 'Start'], ['both', 'Both'], ['none', 'None']],
        get: (s) => shared(split(s.doc).edges, (e) => e.arrow),
        set: (value) => each(['edge'], (e) => (e.arrow = value)),
      })
    );
  }

  // --- notes ----------------------------------------------------------------
  if (have.texts.length) {
    const box = section('Notes');
    fields.push(
      numberField(box, store, {
        label: 'Size',
        min: 6,
        max: 200,
        get: (s) => shared(split(s.doc).texts, (t) => t.size),
        set: (value) => each(['text'], (t) => (t.size = value)),
      }),
      toggleField(box, store, {
        label: 'Style',
        options: [
          ['bold', 'B', 'Bold', 'font-weight:700'],
          ['italic', 'I', 'Italic', 'font-style:italic'],
          ['underline', 'U', 'Underline', 'text-decoration:underline'],
        ],
        // A synthetic entity: each flag is on only when every note has it, so
        // a mixed selection reads as off and one press turns them all on.
        get: (s) => {
          const notes = split(s.doc).texts;
          return {
            bold: shared(notes, (t) => t.bold) === true,
            italic: shared(notes, (t) => t.italic) === true,
            underline: shared(notes, (t) => t.underline) === true,
          };
        },
        set: (key, value) => each(['text'], (t) => (t[key] = value)),
      }),
      selectField(box, store, {
        label: 'Align',
        mixed: true,
        options: ALIGN_OPTIONS,
        get: (s) => shared(split(s.doc).texts, (t) => t.align),
        set: (value) => each(['text'], (t) => (t.align = value)),
      })
    );
  }

  // --- notes and pictures share their placement -----------------------------
  if (planar.length) {
    const box = section('Placement');
    const flat = (doc) => [...split(doc).texts, ...split(doc).images];
    fields.push(
      selectField(box, store, {
        label: 'Plane',
        mixed: true,
        options: PLANES.map((p) => [p, PLANE_LABELS[p]]),
        get: (s) => shared(flat(s.doc), (e) => e.plane),
        set: (value) => each(['text', 'image'], (e) => (e.plane = value)),
      }),
      selectField(box, store, {
        label: 'Rotation',
        mixed: true,
        options: SPINS.map((s) => [String(s), `${s}°`]),
        get: (s) => {
          const spin = shared(flat(s.doc), (e) => e.spin);
          return spin === null ? null : String(spin);
        },
        set: (value) => each(['text', 'image'], (e) => (e.spin = Number(value))),
      }),
      numberField(box, store, {
        label: 'Elevation',
        min: 0,
        max: 40,
        get: (s) => shared(flat(s.doc), (e) => e.z),
        set: (value) => each(['text', 'image'], (e) => (e.z = value)),
      }),
      checkboxField(box, store, {
        label: 'Behind',
        caption: 'Draw underneath the blocks',
        get: (s) => shared(flat(s.doc), (e) => e.behind) === true,
        set: (value) => each(['text', 'image'], (e) => (e.behind = value)),
      })
    );
  }

  if (have.images.length) {
    const box = section('Pictures');
    fields.push(
      rangeField(box, store, {
        label: 'Opacity',
        min: 5,
        max: 100,
        get: (s) => Math.round((shared(split(s.doc).images, (im) => im.opacity) ?? 1) * 100),
        set: (value) => each(['image'], (im) => (im.opacity = value / 100)),
      })
    );
  }

  // Last, and after every other section rather than under the swatches at the
  // top: the one control here that cannot be undone by setting it back should
  // not be the one nearest the pointer.
  root.append(
    h('button', {
      class: 'btn',
      text: 'Delete selection',
      style: 'margin:12px 0 0;color:var(--danger)',
      onClick: () => commands.deleteSelection(),
    })
  );

  return fields;
}

/**
 * A panel's heading: what this is, and what it is called.
 *
 * The id used to be a section of its own at the *bottom*, under ten fields —
 * which on any window shorter than the panel meant scrolling to find out what
 * the thing you have selected is called. That was survivable while an id was
 * something you only read when a warning mentioned one. It stopped being so
 * once links existed: writing `#element-id` means reading the id off one
 * element and typing it onto another, so it has to be somewhere you can see
 * both without hunting, and somewhere you can take a copy of without
 * transcribing it.
 *
 * Beside the kind rather than under it, because that is what the pair says
 * together: *this is a Block, and it is called `api-gateway`*.
 */
function panelHead(title, id = null) {
  return h('section', { class: 'section' }, [
    h('div', { class: 'section-head' }, [
      h('h2', { class: 'section-title', text: title }),
      id ? idChip(id) : null,
    ]),
  ]);
}

/** How long the chip says it worked before going back to being an id. */
const COPIED_MS = 1400;

/**
 * The id, as something you can take away.
 *
 * A button rather than a label, since it does something — but it keeps the
 * plain monospace look of the text it replaced, because it is still primarily
 * a thing to read. Failure is reported rather than swallowed: the clipboard is
 * refused often enough (a denied permission, an unfocused document, some
 * `file://` contexts) that a copy which silently did nothing would have you
 * pasting whatever was there before.
 */
function idChip(id) {
  let timer = 0;
  const chip = h('button', {
    class: 'entity-id id-chip',
    type: 'button',
    title: `Copy "${id}"`,
    text: id,
    onClick: async () => {
      const copied = await copyText(id);
      clearTimeout(timer);
      setClass(chip, 'is-copied', copied);
      setClass(chip, 'is-uncopied', !copied);
      timer = setTimeout(() => {
        setClass(chip, 'is-copied', false);
        setClass(chip, 'is-uncopied', false);
      }, COPIED_MS);
    },
  });
  return chip;
}

/**
 * Where this element leads, if anywhere.
 *
 * One section for every kind of entity, built once and appended by each panel,
 * because a link means exactly the same thing on a block, a note and a picture
 * — it is a property of *being an element*, not of being a block. Seven copies
 * of it would be seven places for the placeholder text and the hint wording to
 * drift apart.
 *
 * The hint under the field is the point of the section. A link is the one
 * property whose correctness cannot be seen in the drawing: a `#api-gatway`
 * with the letters transposed looks exactly like one that works, right up until
 * somebody clicks it. So the panel says, on every keystroke, what following it
 * would actually do — and the button beside it does that, so it can be checked
 * from where it was written rather than by leaving to go and try it.
 */
function linkSection(root, store, id, fields, links) {
  const section = h('section', { class: 'section' }, [
    h('h2', { class: 'section-title', text: 'Link' }),
  ]);

  fields.push(
    textField(section, store, {
      label: 'Goes to',
      placeholder: 'https://…  #element-id  tab:Name',
      get: (s) => entityById(s.doc, id)?.entity.link ?? '',
      // Empty is `null` rather than `""`: "no link" is the absence of the field,
      // and writing an empty string would put `"link": ""` in every saved file.
      set: (value) => (doc) => {
        const found = entityById(doc, id);
        if (found) found.entity.link = value.trim() || null;
      },
    })
  );

  const hint = h('p', { class: 'panel-hint' });
  const follow = h('button', {
    class: 'btn link-try',
    type: 'button',
    text: 'Follow it',
    onClick: () => links?.follow(id),
  });
  section.append(hint, follow);

  fields.push({
    sync: (state) => {
      const raw = entityById(state.doc, id)?.entity.link ?? '';
      setText(
        hint,
        raw
          ? links?.explain(raw) ?? ''
          : 'Nothing. Give it an address, another element or another drawing, and a ' +
            'click follows it while presenting — Ctrl-click while editing.'
      );
      follow.disabled = !raw;
    },
  });

  root.append(section);
}

// ---------------------------------------------------------------------------
// Field builders. Each returns { sync(state) }.
// ---------------------------------------------------------------------------

function row(parent, label, control) {
  parent.append(h('div', { class: 'field' }, [h('label', { text: label }), control]));
}

function commitWith(store, label, mutatorFactory, value) {
  store.commit(label, mutatorFactory(value));
}

function textField(parent, store, { label, get, set, placeholder = null }) {
  const input = h('input', {
    type: 'text',
    placeholder,
    onFocus: () => store.beginGesture(`Edit ${label.toLowerCase()}`),
    onBlur: () => store.endGesture(),
    onInput: (e) => commitWith(store, `Edit ${label.toLowerCase()}`, set, e.target.value),
  });
  row(parent, label, input);
  return {
    sync: (state) => {
      const value = get(state) ?? '';
      if (document.activeElement !== input && input.value !== value) input.value = value;
    },
  };
}

function areaField(parent, store, { label, get, set, rows = 3 }) {
  const input = h('textarea', {
    rows,
    onFocus: () => store.beginGesture(`Edit ${label.toLowerCase()}`),
    onBlur: () => store.endGesture(),
    onInput: (e) => commitWith(store, `Edit ${label.toLowerCase()}`, set, e.target.value),
  });
  row(parent, label, input);
  return {
    sync: (state) => {
      const value = get(state) ?? '';
      if (document.activeElement !== input && input.value !== value) input.value = value;
    },
  };
}

/**
 * @param {{step?: number}} options  1 for everything on this grid except block
 *   height, which is the one measurement a tenth of a cell means something in.
 */
function numberField(parent, store, { label, get, set, min = -400, max = 400, step = 1 }) {
  const input = h('input', {
    type: 'number',
    min,
    max,
    step,
    onFocus: () => store.beginGesture(`Edit ${label.toLowerCase()}`),
    onBlur: () => store.endGesture(),
    onInput: (e) => {
      const value = parseGridNumber(e.target.value, min, max, step);
      if (value !== null) commitWith(store, `Edit ${label.toLowerCase()}`, set, value);
    },
  });
  row(parent, label, input);
  return {
    sync: (state) => {
      const value = String(get(state) ?? '');
      if (document.activeElement !== input && input.value !== value) input.value = value;
    },
  };
}


/**
 * Two short text boxes on one row: the names of a thing's two ends.
 *
 * `pairField` next door does this for numbers; ends are words, and giving them
 * a row of their own is what keeps "Front" and "Back" reading as one setting
 * rather than two unrelated captions.
 */
function pairTextField(parent, store, { label, placeholder = ['', ''], get, set }) {
  const inputs = [0, 1].map((i) =>
    h('input', {
      type: 'text',
      placeholder: placeholder[i] ?? '',
      onInput: () => {
        const value = inputs.map((el) => el.value);
        store.commit(label, (doc) => set(value)(doc));
      },
      onFocus: () => store.beginGesture(label),
      onBlur: () => store.endGesture(),
    })
  );
  parent.append(
    h('div', { class: 'field' }, [
      h('label', { text: label }),
      h('div', { class: 'field-pair' }, inputs),
    ])
  );
  return {
    sync: (state) => {
      const value = get(state);
      for (const [i, el] of inputs.entries()) {
        if (document.activeElement !== el && el.value !== (value[i] ?? '')) {
          el.value = value[i] ?? '';
        }
      }
    },
  };
}

function pairField(parent, store, { label, get, set, min = -400, max = 400 }) {
  const make = (index) =>
    h('input', {
      type: 'number',
      min,
      max,
      step: 1,
      onFocus: () => store.beginGesture(`Edit ${label.toLowerCase()}`),
      onBlur: () => store.endGesture(),
      onInput: (e) => {
        const value = parseGridInt(e.target.value, min, max);
        if (value === null) return;
        const pair = [...current];
        pair[index] = value;
        commitWith(store, `Edit ${label.toLowerCase()}`, set, pair);
      },
    });

  let current = [0, 0];
  const a = make(0);
  const b = make(1);
  row(parent, label, h('div', { class: 'field-pair' }, [a, b]));

  return {
    sync: (state) => {
      current = get(state) ?? [0, 0];
      for (const [input, value] of [[a, current[0]], [b, current[1]]]) {
        const next = String(value);
        if (document.activeElement !== input && input.value !== next) input.value = next;
      }
    },
  };
}

/**
 * A row of independent on/off buttons, for styling flags that are naturally
 * combined rather than chosen between.
 */
function toggleField(parent, store, { label, options, get, set }) {
  const buttons = options.map(([key, glyph, title, css]) =>
    h('button', {
      class: 'toggle-btn',
      style: css,
      title,
      'aria-label': title,
      text: glyph,
      onClick: () => {
        const current = get(store.state);
        commitWith(store, `Toggle ${title.toLowerCase()}`, (value) => set(key, value), !current?.[key]);
      },
    })
  );
  row(parent, label, h('div', { class: 'toggle-row' }, buttons));
  return {
    sync: (state) => {
      const entity = get(state);
      options.forEach(([key], i) => setClass(buttons[i], 'is-active', !!entity?.[key]));
    },
  };
}

function checkboxField(parent, store, { label, caption, get, set }) {
  const input = h('input', {
    type: 'checkbox',
    onChange: (e) => commitWith(store, `Toggle ${label.toLowerCase()}`, set, e.target.checked),
  });
  row(parent, label, h('label', { class: 'checkbox-row' }, [input, h('span', { text: caption })]));
  return {
    sync: (state) => {
      const value = !!get(state);
      if (input.checked !== value) input.checked = value;
    },
  };
}

function rangeField(parent, store, { label, get, set, min = 0, max = 100 }) {
  const input = h('input', {
    type: 'range',
    min,
    max,
    step: 1,
    onInput: (e) => commitWith(store, `Edit ${label.toLowerCase()}`, set, Number(e.target.value)),
    onFocus: () => store.beginGesture(`Edit ${label.toLowerCase()}`),
    onBlur: () => store.endGesture(),
  });
  row(parent, label, input);
  return {
    sync: (state) => {
      const value = String(get(state));
      if (document.activeElement !== input && input.value !== value) input.value = value;
    },
  };
}

/**
 * @param {{mixed?: boolean}} options  for a selection whose members disagree.
 *   Adds a leading placeholder the field falls back to when `get` returns null,
 *   so a mixed selection says so rather than displaying one member's value as
 *   though it were everyone's — and choosing it commits nothing.
 */
function selectField(parent, store, { label, options, get, set, mixed = false }) {
  const MIXED = '';
  const choices = mixed ? [[MIXED, 'Mixed'], ...options] : options;
  const select = h(
    'select',
    {
      onChange: (e) => {
        if (mixed && e.target.value === MIXED) return;
        commitWith(store, `Change ${label.toLowerCase()}`, set, e.target.value);
      },
    },
    choices.map(([value, text]) => h('option', { value, text }))
  );
  row(parent, label, select);
  return {
    sync: (state) => {
      const value = get(state);
      if (value == null && !mixed) return;
      const next = value ?? MIXED;
      if (select.value !== next) select.value = next;
    },
  };
}

/**
 * @param {{auto?: string}} options  when given, a leading swatch that sets the
 *   value back to null — "no colour chosen", so something else decides. Without
 *   it, picking a colour once would be a door that only opens one way.
 */
function swatchField(parent, store, { label, colors, get, set, auto }) {
  const buttons = colors.map((color) =>
    h('button', {
      class: 'swatch',
      style: `background:${color}`,
      title: color,
      'aria-label': color,
      onClick: () => commitWith(store, `Change ${label.toLowerCase()}`, set, color),
    })
  );
  const autoBtn = auto
    ? h('button', {
        class: 'swatch swatch-auto',
        title: auto,
        'aria-label': auto,
        onClick: () => commitWith(store, `Change ${label.toLowerCase()}`, set, null),
      })
    : null;

  parent.append(
    h('div', { class: 'field-block' }, [
      h('label', { class: 'field-block-label', text: label }),
      h('div', { class: 'swatches' }, [autoBtn, ...buttons].filter(Boolean)),
    ])
  );
  return {
    sync: (state) => {
      const value = get(state);
      const active = (value ?? '').toLowerCase();
      buttons.forEach((button, i) => setClass(button, 'is-active', colors[i] === active));
      if (autoBtn) setClass(autoBtn, 'is-active', value == null);
    },
  };
}

/** Null for a half-typed value like "-", so the commit is skipped entirely. */
function parseGridInt(raw, min, max) {
  return parseGridNumber(raw, min, max, 1);
}

/**
 * The same, to whatever precision the field works in.
 *
 * A step of 1 rounds to whole cells as it always did; 0.1 keeps one decimal,
 * counted in tenths so a typed 1.15 lands on 1.2 rather than on something with
 * a tail of nines.
 */
function parseGridNumber(raw, min, max, step = 1) {
  const n = Number(raw);
  if (raw === '' || !Number.isFinite(n)) return null;
  const rounded = step === 1 ? Math.round(n) : Math.round(n / step) * step;
  const tidy = step === 1 ? rounded : Math.round(rounded * 10) / 10;
  return Math.min(max, Math.max(min, tidy));
}
