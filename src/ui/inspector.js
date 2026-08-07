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

import { h, clear, setClass, setText } from '../util/dom.js';
import { COMPONENTS, GROUP_KINDS, componentFor } from '../data/components.js';
import { nodeById, groupById, edgeById, textById, imageById, planarById, entityById } from '../core/doc.js';
import { PLANES, PLANE_LABELS, SPINS } from '../geom/plane.js';
import { approximateBytes, formatSize } from '../core/images.js';

const SWATCHES = [
  '#ed7100', '#f59e0b', '#eab308', '#7aa116', '#16a34a', '#0ea5a5', '#2a7fd4', '#2563eb',
  '#8c4fff', '#a855f7', '#c925d1', '#e7157b', '#dd344c', '#78716c', '#64748b', '#334155',
];

export function createInspector({ root, store, commands }) {
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
    if (found.kind === 'node') return buildNode(root, store, found.entity.id);
    if (found.kind === 'group') return buildGroup(root, store, found.entity.id);
    if (found.kind === 'text') return buildText(root, store, found.entity.id);
    if (found.kind === 'image') return buildImage(root, store, found.entity.id);
    return buildEdge(root, store, found.entity.id);
  }

  return { render };
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
  const section = h('section', { class: 'section' }, [
    h('h2', { class: 'section-title', text: 'Diagram' }),
  ]);

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

function buildNode(root, store, id) {
  const fields = [];
  const section = h('section', { class: 'section' }, [
    h('h2', { class: 'section-title', text: 'Block' }),
  ]);
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
      get: (s) => nodeById(s.doc, id)?.labelPlane ?? 'floor',
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

  root.append(section, idSection(id));
  return fields;
}

function buildGroup(root, store, id) {
  const fields = [];
  const section = h('section', { class: 'section' }, [
    h('h2', { class: 'section-title', text: 'Zone' }),
  ]);
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
      get: (s) => groupById(s.doc, id)?.labelPlane ?? 'right',
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

  root.append(section, idSection(id));
  return fields;
}

function buildText(root, store, id) {
  const fields = [];
  const section = h('section', { class: 'section' }, [
    h('h2', { class: 'section-title', text: 'Text' }),
  ]);
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
      options: [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']],
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
  root.append(idSection(id));
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
      get: (s) => planarById(s.doc, id)?.plane ?? 'screen',
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

function buildImage(root, store, id) {
  const fields = [];
  const section = h('section', { class: 'section' }, [
    h('h2', { class: 'section-title', text: 'Picture' }),
  ]);
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
  root.append(idSection(id));
  return fields;
}

function buildEdge(root, store, id) {
  const fields = [];
  const section = h('section', { class: 'section' }, [
    h('h2', { class: 'section-title', text: 'Connection' }),
  ]);
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
      label: 'Label on',
      options: PLANES.map((p) => [p, PLANE_LABELS[p]]),
      get: (s) => edgeById(s.doc, id)?.labelPlane ?? 'floor',
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
  return fields;
}

function buildMulti(root, store, commands, selection) {
  const fields = [];
  const section = h('section', { class: 'section' }, [
    h('h2', { class: 'section-title', text: 'Selection' }),
    h('div', { class: 'entity-kind', text: `${selection.length} items selected` }),
  ]);

  fields.push(
    swatchField(section, store, {
      label: 'Colour',
      colors: SWATCHES,
      get: () => null,
      set: (value) => (doc) => {
        for (const id of selection) {
          const target = nodeById(doc, id) || groupById(doc, id) || edgeById(doc, id);
          if (target) target.color = value;
        }
      },
    })
  );

  section.append(
    h('button', {
      class: 'btn',
      text: 'Delete selection',
      style: 'margin-top:8px;color:var(--danger)',
      onClick: () => commands.deleteSelection(),
    })
  );

  root.append(section);
  return fields;
}

function idSection(id) {
  return h('section', { class: 'section' }, [
    h('h2', { class: 'section-title', text: 'Identifier' }),
    h('div', { class: 'entity-id', text: id }),
  ]);
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

function textField(parent, store, { label, get, set }) {
  const input = h('input', {
    type: 'text',
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

function numberField(parent, store, { label, get, set, min = -400, max = 400 }) {
  const input = h('input', {
    type: 'number',
    min,
    max,
    step: 1,
    onFocus: () => store.beginGesture(`Edit ${label.toLowerCase()}`),
    onBlur: () => store.endGesture(),
    onInput: (e) => {
      const value = parseGridInt(e.target.value, min, max);
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

function selectField(parent, store, { label, options, get, set }) {
  const select = h(
    'select',
    {
      onChange: (e) => commitWith(store, `Change ${label.toLowerCase()}`, set, e.target.value),
    },
    options.map(([value, text]) => h('option', { value, text }))
  );
  row(parent, label, select);
  return {
    sync: (state) => {
      const value = get(state);
      if (value != null && select.value !== value) select.value = value;
    },
  };
}

function swatchField(parent, store, { label, colors, get, set }) {
  const buttons = colors.map((color) =>
    h('button', {
      class: 'swatch',
      style: `background:${color}`,
      title: color,
      'aria-label': color,
      onClick: () => commitWith(store, `Change ${label.toLowerCase()}`, set, color),
    })
  );
  parent.append(
    h('div', { class: 'field-block' }, [
      h('label', { class: 'field-block-label', text: label }),
      h('div', { class: 'swatches' }, buttons),
    ])
  );
  return {
    sync: (state) => {
      const active = (get(state) ?? '').toLowerCase();
      buttons.forEach((button, i) => setClass(button, 'is-active', colors[i] === active));
    },
  };
}

/** Null for a half-typed value like "-", so the commit is skipped entirely. */
function parseGridInt(raw, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}
