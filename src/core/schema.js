/**
 * Document schema, normalisation and serialisation.
 *
 * The `.arch.json` file is the product, not an implementation detail: people
 * and language models are expected to read and edit it directly. Two rules
 * follow from that.
 *
 * 1. Loading is forgiving. Missing fields get defaults, unknown component
 *    types degrade to `generic`, dangling references are dropped -- each with
 *    a warning, never an exception. A hand-written document that is 95%
 *    correct should open and show its author what was wrong.
 *
 * 2. Writing is deterministic. Fixed key order, two-space indent, short
 *    numeric arrays kept on one line. Save -> load -> save is byte-identical,
 *    so diffs stay readable in version control.
 *
 * Forgiving is not the same as silent, and the two have to be separated by a
 * gate. Normalisation will read *any* object as a diagram, so a package.json
 * used to open as a blank canvas with nothing said -- the drawing on screen
 * thrown away for a file that was never a diagram at all. `docRejection` is
 * that gate: it answers whether this JSON is a diagram before the forgiving
 * part is allowed to start repairing it.
 */

import { componentFor, isKnownType, groupKindFor, FALLBACK_TYPE } from '../data/components.js';
import { shapeKindFor } from '../data/shapes.js';
import { clamp, clampInt, clampTenth } from '../util/num.js';
import { isPlane, normaliseSpin, SPINS } from '../geom/plane.js';
import { readLink } from './link.js';

export const FORMAT_VERSION = 1;
export const FILE_EXTENSION = '.arch.json';

/** Sanity bound on grid coordinates and sizes, shared with the resize drag. */
export const MAX_SPAN = 400;

/**
 * How long a tab's name may be.
 *
 * A tab is about 25 characters wide before it starts eliding, so this is not
 * about what fits — it is a bound on what a file may carry. Without one a name
 * is unbounded text in a field that is only ever read at a glance, and a
 * paragraph pasted into it would be stored, saved and published in full.
 */
export const MAX_TAB_NAME = 40;
const EDGE_STYLES = new Set(['solid', 'dashed', 'dotted']);
const EDGE_ARROWS = new Set(['none', 'end', 'start', 'both']);

/**
 * How a connection turns the corner between its two ends.
 *
 * `auto` lets the router pick the elbow that passes through fewest blocks.
 * `x` and `y` pin it to one of the two orthogonal families, and `bend` then
 * says where along that axis the run crosses over -- which is the single
 * number a drag on the connection's grip writes.
 */
const EDGE_ROUTES = new Set(['auto', 'x', 'y']);
export const DEFAULT_EDGE_ROUTE = 'auto';

/**
 * What an unset canvas background resolves to, light and dark.
 *
 * Both are offered in the inspector's swatches too, so "automatic" always
 * lands on a colour the author could have chosen deliberately.
 */
export const CANVAS_BACKGROUNDS = { light: '#eef1f5', dark: '#0f172a' };

/**
 * The colour to actually paint behind a diagram.
 *
 * `null` means the author has not chosen one, and the viewer's theme decides —
 * a diagram nobody has an opinion about should not be a white rectangle in a
 * dark room. A colour means they have, and it is honoured whatever the theme
 * is doing: the file says so, and the theme is not allowed to argue.
 */
export function canvasBackground(doc, dark = false) {
  return doc?.canvas?.background ?? CANVAS_BACKGROUNDS[dark ? 'dark' : 'light'];
}

export function createEmptyDoc(title = 'Untitled diagram') {
  return {
    version: FORMAT_VERSION,
    meta: { title },
    // Not a colour: a new diagram has no opinion, so it follows the theme.
    canvas: { background: null },
    groups: [],
    nodes: [],
    edges: [],
    texts: [],
    images: [],
    shapes: [],
    cells: [],
  };
}

/**
 * Where flat content hangs unless told otherwise: lying on the ground, which
 * is the placement that reads as part of the isometric scene rather than
 * stuck on top of it. One constant so everything that defaults -- text,
 * pictures, block captions, connection captions and zone captions -- cannot
 * drift apart.
 */
export const DEFAULT_PLANE = 'floor';

/**
 * Zone captions stand against the right wall by default rather than lying on
 * the ground. A zone is large and usually full, so a caption written flat
 * inside it competes with its own contents; standing it along the far edge
 * keeps it clear.
 */
export const DEFAULT_ZONE_LABEL_PLANE = 'right';

/** Caption size in pixels, matching the stylesheet's own default. */
export const DEFAULT_LABEL_SIZE = 12;

/**
 * Captions centre on what they describe.
 *
 * A block's caption reads against the block's own width and a connection's
 * against the point it hangs from, but "centred" is the sane answer for both,
 * and it is what the `screen` plane has always done.
 */
export const DEFAULT_LABEL_ALIGN = 'center';

export const TEXT_ALIGNS = new Set(['left', 'center', 'right']);
export const TEXT_DEFAULTS = {
  size: 14,
  color: '#334155',
  align: 'left',
  plane: DEFAULT_PLANE,
};

export const IMAGE_DEFAULTS = {
  size: [6, 4],
  plane: DEFAULT_PLANE,
  opacity: 1,
};

/** Which side of a decision a branch label is written beside. */
export const SHAPE_SIDES = new Set(['top', 'right', 'bottom', 'left']);

export const SHAPE_DEFAULTS = {
  /*
   * One neutral for every kind, and it is a choice rather than an omission.
   * A flowchart is read by silhouette — the diamond is the question — so
   * colouring the shapes by kind would spend the drawing's one loud channel on
   * something already said by their outlines. Colour is left for the author to
   * mean something with.
   */
  color: '#64748b',
  /*
   * Standing, but only just.
   *
   * Flat on the ground, a silhouette is read through the projection's skew, and
   * a diamond seen that way is a parallelogram — the one thing it most needed
   * not to look like. Half a cell of thickness gives the eye the sides it needs
   * to read the top face as a top face. A whole cell would make these blocks,
   * which they are not.
   */
  height: 0.5,
  /*
   * On the ground with everything else, which is the same default the rest of
   * this format has.
   *
   * Standing the caption up was the right call when the shape was a flat
   * outline and the words were all there was to look at. Now that a shape is a
   * slab, the caption lands on its top face and reads as writing on the thing
   * itself — where a screen-facing label floats over the scene looking stuck on.
   * A step whose words really need to be read square can still say so.
   */
  labelPlane: DEFAULT_PLANE,
  /*
   * Bigger than the 12px a caption starts at elsewhere, because it now lies on
   * the ground and ground text is foreshortened twice over — squashed by the
   * projection and skewed 45 degrees. This is the same correction the format's
   * own advice makes for notes, at a size that suits a phrase inside a shape
   * rather than a paragraph beside the diagram.
   */
  labelSize: 20,
  yesAt: 'right',
  noAt: 'bottom',
};

/**
 * A row, a column or a grid of slots: an array, a stack, a queue, a matrix.
 *
 * One entity for all four because they are one picture — a run of boxes with
 * values in them — and what tells them apart is the shape of the run and what
 * the author writes beside it, not anything the drawing needs to know. A stack
 * is one column, a queue is one row, a matrix is both.
 */
/** Which way a run is worked through, if it is worked through at all. */
export const CELLS_FLOW = new Set(['forward', 'back', 'both']);

export const CELLS_DEFAULTS = {
  /**
   * One slot's footprint, in grid cells.
   *
   * Square, because a slot is a box holding one value and a square is what an
   * array's boxes are drawn as everywhere they are drawn. A wider slot reads as
   * a row of fields rather than as a run of equal cells, and the run being
   * *equal* is most of what the picture is saying.
   */
  slot: [2, 2],
  cols: 6,
  rows: 1,
  height: 0.5,
  color: '#64748b',
  labelSize: 20,
  labelPlane: DEFAULT_PLANE,
};

/** Bound on how many slots one structure may have, in each direction. */
export const MAX_SLOTS = 200;

/** Whether two short numeric arrays match, for deciding what to omit. */
function sameNumbers(a, b) {
  return Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Shared placement fields for anything flat: pictures and text alike. */
function readPlanar(raw, defaultPlane) {
  return {
    z: clampInt(raw.z, 0, 40, 0),
    plane: isPlane(raw.plane) ? raw.plane : defaultPlane,
    spin: SPINS.includes(normaliseSpin(raw.spin)) ? normaliseSpin(raw.spin) : 0,
    behind: raw.behind === true,
  };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * The six collections that make an object a diagram rather than merely JSON.
 *
 * An empty one still counts. A saved empty diagram writes all five as `[]`,
 * and refusing to reopen the file you just saved would be its own bug.
 */
export const CONTENT_KEYS = ['nodes', 'groups', 'edges', 'texts', 'images', 'shapes', 'cells'];

/** What a value is, in the words the error message wants. */
function jsonKind(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'a list';
  if (typeof v === 'object') return 'an object';
  if (typeof v === 'string') return 'text';
  return `a ${typeof v}`;
}

/**
 * Why `raw` cannot be read as a diagram, or null when it can.
 *
 * The message is the whole point of the function, so it names what was found
 * instead: told only "this is not a diagram", the first thing anyone does is
 * open the file to see what it *is*.
 *
 * @returns {string | null}
 */
export function docRejection(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return `the top level is ${jsonKind(raw)}, and a diagram is an object.`;
  }
  // A tabbed file carries its drawings one level down, so it has none of the
  // collections at the top and would otherwise be refused as not a diagram.
  if (Array.isArray(raw.tabs) && raw.tabs.length) return null;
  if (CONTENT_KEYS.some((key) => Array.isArray(raw[key]))) return null;

  const keys = Object.keys(raw);
  const found = keys.length
    ? `its top-level keys are ${keys.slice(0, 8).join(', ')}${keys.length > 8 ? ', …' : ''}`
    : 'it has no keys at all';
  return `it carries none of ${CONTENT_KEYS.join(', ')}, tabs — ${found}.`;
}

/**
 * @returns {{doc: object, warnings: string[], rejection: string | null}}
 * @throws {SyntaxError} only when the text is not JSON at all.
 */
export function parseDoc(text) {
  const raw = JSON.parse(text);
  return normalizeDoc(raw);
}

/**
 * @returns {{doc: object, warnings: string[], rejection: string | null}}
 *   A rejection still comes with an empty `doc`, so a caller that has already
 *   decided to open something regardless has one to open. Callers that have
 *   not must check it -- replacing a drawing with a blank canvas is exactly
 *   the failure this exists to stop.
 */
export function normalizeDoc(raw) {
  const warnings = [];
  const rejection = docRejection(raw);
  if (rejection) return { doc: createEmptyDoc(), warnings, rejection };

  const version = int(raw.version, FORMAT_VERSION);
  if (version > FORMAT_VERSION) {
    warnings.push(
      `Document version ${version} is newer than this editor (v${FORMAT_VERSION}); unknown fields were dropped.`
    );
  }

  const doc = createEmptyDoc(str(raw.meta?.title) || 'Untitled diagram');
  if (raw.canvas && typeof raw.canvas === 'object') {
    // Absent, or unreadable, leaves it automatic. A file that names a colour
    // is stating a preference; one that does not has none to state.
    doc.canvas.background = color(raw.canvas.background);
  }

  /*
   * A file with `tabs` holds several drawings that share a title and a
   * background. Each is read exactly as a whole document's body is, with its
   * own id space -- two tabs may both have a block called `api`, because they
   * are two drawings rather than two halves of one.
   *
   * The shapes stay separate: a tabbed document has `tabs` and no collections
   * of its own, a plain one has collections and no `tabs`. Carrying both would
   * be two sources of truth for the same blocks.
   */
  if (Array.isArray(raw.tabs)) {
    doc.tabs = [];
    for (const [index, tab] of raw.tabs.entries()) {
      if (!tab || typeof tab !== 'object' || Array.isArray(tab)) {
        warnings.push(`Dropped tabs[${index}]: it is ${jsonKind(tab)}, not an object.`);
        continue;
      }
      const body = emptyBody();
      readBody(tab, body, warnings, `tabs[${index}].`);
      const given = str(tab.name);
      if (given && [...given].length > MAX_TAB_NAME) {
        warnings.push(
          `Shortened tabs[${index}].name to ${MAX_TAB_NAME} characters.`
        );
      }
      doc.tabs.push({ name: tabNameFrom(given, index), ...body });
    }
    if (!doc.tabs.length) doc.tabs.push({ name: 'Tab 1', ...emptyBody() });
    for (const key of CONTENT_KEYS) delete doc[key];
    return { doc, warnings, rejection: null };
  }

  readBody(raw, doc, warnings, '');
  return { doc, warnings, rejection: null };
}

/**
 * A tab's name, bounded, or its number when it has none.
 *
 * Counted in code points rather than in `length`, so a name of emoji or of
 * Korean is cut where it looks cut rather than at a UTF-16 unit, which would
 * leave a half character behind.
 */
export function tabNameFrom(name, index) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return `Tab ${index + 1}`;
  return [...trimmed].slice(0, MAX_TAB_NAME).join('');
}

/** The five collections a drawing is made of, empty. */
function emptyBody() {
  return { groups: [], nodes: [], edges: [], texts: [], images: [], shapes: [], cells: [] };
}

/**
 * Read one drawing's worth of collections into `doc`.
 *
 * Split out of `normalizeDoc` so a tab and a whole document are read by the
 * same code rather than by two that drift. `where` prefixes the warnings, so
 * "tabs[1].nodes[4]" stays as findable in a tabbed file as "nodes[4]" is in a
 * plain one.
 */
function readBody(raw, doc, warnings, where = '') {
  const usedIds = new Set();

  // --- groups (parents resolved in a second pass) ---------------------------
  const groupIndex = new Map();
  const pendingParents = [];
  for (const g of readCollection(raw, 'groups', warnings, where)) {
    const kindDef = groupKindFor(str(g.kind));
    if (g.kind && kindDef.kind !== g.kind) {
      warnings.push(`Group kind "${g.kind}" is unknown; used "group".`);
    }
    const label = readLabel(g.label, kindDef.label);
    const id = takeId(g.id, label || kindDef.kind, usedIds, warnings, 'Group');
    const rect = readRect(g.rect ?? [g.x, g.y, g.w, g.h]);
    if (!Array.isArray(g.rect) && !Number.isFinite(Number(g.x))) {
      warnings.push(`Group "${id}" has no rect; gave it ${rect.join(', ')}.`);
    }
    const group = {
      id,
      kind: kindDef.kind,
      label,
      rect,
      color: color(g.color) || kindDef.color,
      // A zone's caption is a flat rectangle too, so it hangs on a plane just
      // like a block's does.
      labelPlane: isPlane(g.labelPlane) ? g.labelPlane : DEFAULT_ZONE_LABEL_PLANE,
      labelSize: clampInt(g.labelSize, 6, 96, DEFAULT_LABEL_SIZE),
      link: readLink(g.link),
      parent: null,
    };
    groupIndex.set(id, group);
    doc.groups.push(group);
    if (str(g.parent)) pendingParents.push([group, str(g.parent)]);
  }
  for (const [group, parent] of pendingParents) {
    if (!groupIndex.has(parent) || parent === group.id) {
      warnings.push(`Group "${group.id}" referenced unknown parent "${parent}".`);
    } else {
      group.parent = parent;
    }
  }
  breakGroupCycles(doc.groups, warnings);

  // --- nodes ----------------------------------------------------------------
  const nodeIndex = new Map();
  for (const n of readCollection(raw, 'nodes', warnings, where)) {
    let type = str(n.type) || FALLBACK_TYPE;
    if (!isKnownType(type)) {
      warnings.push(`Node type "${type}" is unknown; drawn as a generic block.`);
      type = FALLBACK_TYPE;
    }
    const def = componentFor(type);
    // `?? n.name` and not `|| n.name`: an explicit empty label is an answer,
    // and must not fall through to the alias.
    const label = readLabel(n.label ?? n.name, def.label);
    const id = takeId(n.id, label || type, usedIds, warnings, 'Node');
    const pos = readPair(n.pos ?? [n.x, n.y], [0, 0]);
    const size = readPair(n.size ?? [n.w, n.h], def.size, 1);
    // Worth saying, because the default is not a neutral one: every block that
    // forgot its position lands on the same cell and stacks into one lump.
    if (!Array.isArray(n.pos) && !Number.isFinite(Number(n.x))) {
      warnings.push(`Node "${id}" has no pos; placed it at 0, 0.`);
    }

    const node = {
      id,
      type,
      label,
      pos,
      size,
      // The one measurement on this grid that is not whole cells.
      height: clampTenth(n.height, 0, 40, def.height),
      color: color(n.color) || def.color,
      // A block's caption is a flat rectangle like any other, so it can be
      // laid on the ground or written onto one of the block's own faces.
      labelPlane: isPlane(n.labelPlane) ? n.labelPlane : DEFAULT_PLANE,
      labelSize: clampInt(n.labelSize, 6, 96, DEFAULT_LABEL_SIZE),
      labelAlign: TEXT_ALIGNS.has(n.labelAlign) ? n.labelAlign : DEFAULT_LABEL_ALIGN,
      group: null,
      props: plainProps(n.props),
      link: readLink(n.link),
    };
    const group = str(n.group);
    if (group) {
      if (groupIndex.has(group)) node.group = group;
      else warnings.push(`Node "${id}" referenced unknown group "${group}".`);
    }
    nodeIndex.set(id, node);
    doc.nodes.push(node);
  }

  // --- flowchart shapes -----------------------------------------------------
  //
  // A shape lies on the ground and occupies a rectangle of cells, exactly as a
  // picture does, so it reads as part of the drawing rather than as an overlay
  // — and so a connection can find its edges. An unknown kind becomes a plain
  // process box for the same reason an unknown block type becomes a plain
  // block: the diagram still says what it was for.
  const shapeIndex = new Set();
  for (const sh of readCollection(raw, 'shapes', warnings, where)) {
    const def = shapeKindFor(str(sh.kind));
    if (sh.kind && def.kind !== sh.kind) {
      warnings.push(`Shape kind "${sh.kind}" is unknown; used "${def.kind}".`);
    }
    const label = readLabel(sh.label, '');
    const id = takeId(sh.id, label || def.kind, usedIds, warnings, 'Shape');
    shapeIndex.add(id);
    doc.shapes.push({
      id,
      kind: def.kind,
      label,
      pos: readPair(sh.pos ?? [sh.x, sh.y], [0, 0]),
      size: readPair(sh.size ?? [sh.w, sh.h], def.size, 1),
      // A slab rather than a cuboid: enough to stand the silhouette off the
      // floor and give the eye a depth cue, not enough to compete with the
      // blocks. Zero is allowed and draws the flat outline.
      height: clampTenth(sh.height, 0, 40, SHAPE_DEFAULTS.height),
      color: color(sh.color) || SHAPE_DEFAULTS.color,
      labelSize: clampInt(sh.labelSize, 6, 96, SHAPE_DEFAULTS.labelSize),
      // A caption laid on the floor skews with the floor, which is right for a
      // drawing and hard work for a long line of code. So the caption may face
      // the viewer instead, the same choice a block's caption already has.
      labelPlane: isPlane(sh.labelPlane) ? sh.labelPlane : SHAPE_DEFAULTS.labelPlane,
      // Only a decision has anywhere to put these, but reading them off every
      // shape costs nothing and means a kind changed in the inspector does not
      // silently drop what was typed.
      yes: readLabel(sh.yes, ''),
      no: readLabel(sh.no, ''),
      yesAt: SHAPE_SIDES.has(sh.yesAt) ? sh.yesAt : SHAPE_DEFAULTS.yesAt,
      noAt: SHAPE_SIDES.has(sh.noAt) ? sh.noAt : SHAPE_DEFAULTS.noAt,
      link: readLink(sh.link),
    });
  }

  // --- data structures ------------------------------------------------------
  //
  // Read beside the shapes and before the edges, for the same reason: a
  // connection may point at one, so the ids have to exist by the time the edges
  // are read.
  const cellsIndex = new Set();
  for (const c of readCollection(raw, 'cells', warnings, where)) {
    const label = readLabel(c.label, '');
    const id = takeId(c.id, label || 'cells', usedIds, warnings, 'Cells');
    cellsIndex.add(id);
    const items = Array.isArray(c.items)
      ? c.items.slice(0, MAX_SLOTS * MAX_SLOTS).map((v) => readLabel(v, ''))
      : [];
    const cols = clampInt(c.cols, 1, MAX_SLOTS, Math.max(1, items.length) || CELLS_DEFAULTS.cols);
    doc.cells.push({
      id,
      label,
      pos: readPair(c.pos ?? [c.x, c.y], [0, 0]),
      cols,
      rows: clampInt(c.rows, 1, MAX_SLOTS, CELLS_DEFAULTS.rows),
      slot: readPair(c.slot ?? c.cell, CELLS_DEFAULTS.slot, 1),
      // Row-major, and shorter than the grid is fine: an array with room left
      // in it is a thing people draw on purpose.
      items,
      /** Numbers along the edges. Off unless asked for: they are for when the
          position of a value is the point, which is not every diagram. */
      indices: c.indices === true,
      /*
       * What the two ends of the run are called — "Front" and "Back" on a
       * queue, "top" and "bottom" on a stack.
       *
       * Ends rather than slots, because that is what they name: a queue's front
       * is wherever the front currently is, not slot 0 forever, and a pointer
       * pinned to an index would say the wrong thing the moment anything moved.
       */
      ends: Array.isArray(c.ends)
        ? [readLabel(c.ends[0], ''), readLabel(c.ends[1], '')]
        : ['', ''],
      /**
       * A quieter second line under the name: what the structure holds, how big
       * it is, what a slot means. The name says which structure this is; the
       * description says the thing you would otherwise put in a note beside it.
       */
      description: readLabel(c.description, ''),
      /** Which way things travel through it, drawn as a mark beyond each end. */
      flow: CELLS_FLOW.has(c.flow) ? c.flow : null,
      /**
       * Pointers into the run — `top`, `head`, `i`. Each names a slot by index,
       * so a marker moves with the structure and cannot drift off the slot it
       * is pointing at, which is the whole reason it is not a free note.
       */
      marks: Array.isArray(c.marks)
        ? c.marks
            .map((m) => ({
              text: readLabel(m?.text, ''),
              at: clampInt(m?.at, 0, MAX_SLOTS * MAX_SLOTS - 1, 0),
            }))
            .filter((m) => m.text)
            .slice(0, 24)
        : [],
      height: clampTenth(c.height, 0, 40, CELLS_DEFAULTS.height),
      color: color(c.color) || CELLS_DEFAULTS.color,
      labelSize: clampInt(c.labelSize, 6, 96, CELLS_DEFAULTS.labelSize),
      labelPlane: isPlane(c.labelPlane) ? c.labelPlane : CELLS_DEFAULTS.labelPlane,
      link: readLink(c.link),
    });
  }

  // --- edges ----------------------------------------------------------------
  for (const e of readCollection(raw, 'edges', warnings, where)) {
    const from = str(e.from) ?? str(e.source);
    const to = str(e.to) ?? str(e.target);
    // Either end may be a block, a zone or a flowchart shape: all three are
    // rectangles on the grid, and "this whole subnet talks to that one" and
    // "this step leads to that question" are both real things to draw. Shapes
    // are read above for exactly this reason — an edge naming one must find it.
    const connectable = (id) =>
      nodeIndex.has(id) || groupIndex.has(id) || shapeIndex.has(id) || cellsIndex.has(id);
    if (!connectable(from) || !connectable(to)) {
      warnings.push(`Dropped edge ${from || '?'} -> ${to || '?'}: endpoint does not exist.`);
      continue;
    }
    if (from === to) {
      warnings.push(`Dropped self-edge on "${from}".`);
      continue;
    }
    const id = takeId(e.id, `${from}-${to}`, usedIds, warnings, 'Edge');
    const route = EDGE_ROUTES.has(e.route) ? e.route : DEFAULT_EDGE_ROUTE;
    doc.edges.push({
      id,
      from,
      to,
      route,
      // The crossover only means anything once an axis has been chosen, so an
      // automatic route never carries one -- otherwise a stale number from an
      // earlier drag would silently come back the next time the axis was set.
      bend: route === DEFAULT_EDGE_ROUTE ? null : halfCell(e.bend),
      label: str(e.label) || '',
      style: EDGE_STYLES.has(e.style) ? e.style : 'solid',
      arrow: EDGE_ARROWS.has(e.arrow) ? e.arrow : 'end',
      color: color(e.color) || '#64748b',
      // A connection's caption is a flat rectangle like any other, so it hangs
      // on a plane too -- written on the ground along the line by default.
      labelPlane: isPlane(e.labelPlane) ? e.labelPlane : DEFAULT_PLANE,
      labelSize: clampInt(e.labelSize, 6, 96, DEFAULT_LABEL_SIZE),
      labelAlign: TEXT_ALIGNS.has(e.labelAlign) ? e.labelAlign : DEFAULT_LABEL_ALIGN,
      link: readLink(e.link),
    });
  }

  // --- text annotations -----------------------------------------------------
  for (const t of readCollection(raw, 'texts', warnings, where)) {
    // Leading and trailing whitespace is kept -- it may be deliberate
    // indentation -- but a note that is *only* whitespace renders as nothing
    // and would sit in the document as an invisible, unfindable entity.
    const raw = typeof t.text === 'string' ? t.text : str(t.label) ?? str(t.content);
    const body = raw?.trim() ? raw : null;
    if (!body) {
      warnings.push('Dropped a text annotation with no content.');
      continue;
    }
    doc.texts.push({
      id: takeId(t.id, body.split('\n')[0], usedIds, warnings, 'Text'),
      text: body,
      pos: readPair(t.pos ?? [t.x, t.y], [0, 0]),
      size: clampInt(t.size, 6, 200, TEXT_DEFAULTS.size),
      color: color(t.color) || TEXT_DEFAULTS.color,
      bold: t.bold === true,
      italic: t.italic === true,
      underline: t.underline === true,
      align: TEXT_ALIGNS.has(t.align) ? t.align : TEXT_DEFAULTS.align,
      link: readLink(t.link),
      ...readPlanar(t, TEXT_DEFAULTS.plane),
    });
  }

  // --- pictures -------------------------------------------------------------
  for (const im of readCollection(raw, 'images', warnings, where)) {
    const src = typeof im.src === 'string' ? im.src.trim() : '';
    if (!src) {
      warnings.push('Dropped an image with no src.');
      continue;
    }
    doc.images.push({
      id: takeId(im.id, str(im.label) || 'image', usedIds, warnings, 'Image'),
      src,
      label: str(im.label) || '',
      pos: readPair(im.pos ?? [im.x, im.y], [0, 0]),
      size: readPair(im.size ?? [im.w, im.h], IMAGE_DEFAULTS.size, 1),
      opacity: clamp(Number.isFinite(Number(im.opacity)) ? Number(im.opacity) : 1, 0.05, 1),
      link: readLink(im.link),
      ...readPlanar(im, IMAGE_DEFAULTS.plane),
    });
  }

}

/**
 * The entries of one collection, complaining about anything unusable.
 *
 * Skipping a malformed entry is right -- one bad block should not cost you the
 * other seventeen -- but skipping it *quietly* is how a file half-written by
 * hand opens missing most of itself with nothing said. Every skip is named,
 * with its index, because "nodes[4]" is what makes it findable in the file.
 */
function* readCollection(raw, key, warnings, where = '') {
  const value = raw[key];
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) {
    warnings.push(`"${where}${key}" is ${jsonKind(value)}, not a list; ignored it.`);
    return;
  }
  for (const [index, entry] of value.entries()) {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) yield entry;
    else warnings.push(`Dropped ${where}${key}[${index}]: it is ${jsonKind(entry)}, not an object.`);
  }
}

/** Parent chains must be a forest; snap any cycle back to a root. */
function breakGroupCycles(groups, warnings) {
  const byId = new Map(groups.map((g) => [g.id, g]));
  for (const start of groups) {
    const seen = new Set([start.id]);
    let cur = start;
    while (cur.parent) {
      if (seen.has(cur.parent)) {
        warnings.push(`Group "${start.id}" is part of a parent cycle; detached it.`);
        cur.parent = null;
        break;
      }
      seen.add(cur.parent);
      cur = byId.get(cur.parent);
    }
  }
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

/** Deterministic text form of a document. Always ends with a newline. */
export function serializeDoc(doc) {
  /*
   * A tabbed document writes its drawings under `tabs`; a plain one writes its
   * collections at the top exactly as it always has.
   *
   * One tab is written as a plain document rather than as a list of one, so a
   * file grows the wrapper only once it has something to wrap — and every
   * diagram written before tabs existed still round-trips byte for byte.
   */
  if (doc.tabs?.length > 1) {
    return stringify({
      version: FORMAT_VERSION,
      meta: { title: doc.meta.title },
      canvas: omitEmpty({ background: doc.canvas.background }),
      tabs: doc.tabs.map((tab) => ({ name: tab.name, ...bodyWire(doc, tab) })),
    }, 0) + '\n';
  }
  if (doc.tabs?.length === 1) return serializeDoc({ ...doc, ...doc.tabs[0], tabs: undefined });

  const wire = {
    version: FORMAT_VERSION,
    meta: { title: doc.meta.title },
    // An automatic background is written by *not* being written, or reopening
    // the file would turn "no opinion" into a preference for whatever theme
    // happened to be on when it was saved.
    canvas: omitEmpty({ background: doc.canvas.background }),
    groups: doc.groups.map((g) => omitEmpty({
      id: g.id,
      kind: g.kind,
      label: g.label,
      rect: g.rect,
      color: g.color,
      labelPlane: g.labelPlane === DEFAULT_ZONE_LABEL_PLANE ? null : g.labelPlane,
      labelSize: g.labelSize === DEFAULT_LABEL_SIZE ? null : g.labelSize,
      link: g.link,
      parent: g.parent,
    })),
    nodes: doc.nodes.map((n) => omitEmpty({
      id: n.id,
      type: n.type,
      label: n.label,
      pos: n.pos,
      size: n.size,
      height: n.height,
      color: n.color,
      labelPlane: n.labelPlane === DEFAULT_PLANE ? null : n.labelPlane,
      labelSize: n.labelSize === DEFAULT_LABEL_SIZE ? null : n.labelSize,
      labelAlign: n.labelAlign === DEFAULT_LABEL_ALIGN ? null : n.labelAlign,
      link: n.link,
      group: n.group,
      props: isEmpty(n.props) ? null : n.props,
    })),
    edges: doc.edges.map((e) => omitEmpty({
      id: e.id,
      from: e.from,
      to: e.to,
      label: e.label || null,
      style: e.style,
      arrow: e.arrow,
      route: e.route === DEFAULT_EDGE_ROUTE ? null : e.route,
      bend: e.bend,
      color: e.color,
      labelPlane: e.labelPlane === DEFAULT_PLANE ? null : e.labelPlane,
      labelSize: e.labelSize === DEFAULT_LABEL_SIZE ? null : e.labelSize,
      labelAlign: e.labelAlign === DEFAULT_LABEL_ALIGN ? null : e.labelAlign,
      link: e.link,
    })),
    // Styling flags are written only when set, so a plain note stays a plain
    // three-line object in the file.
    texts: doc.texts.map((t) => omitEmpty({
      id: t.id,
      text: t.text,
      pos: t.pos,
      size: t.size,
      color: t.color,
      bold: t.bold || null,
      italic: t.italic || null,
      underline: t.underline || null,
      align: t.align === TEXT_DEFAULTS.align ? null : t.align,
      link: t.link,
      ...planarWire(t, TEXT_DEFAULTS.plane),
    })),
    images: doc.images.map((im) => omitEmpty({
      id: im.id,
      src: im.src,
      label: im.label || null,
      pos: im.pos,
      size: im.size,
      opacity: im.opacity === 1 ? null : im.opacity,
      link: im.link,
      ...planarWire(im, IMAGE_DEFAULTS.plane),
    })),
    cells: doc.cells.map((c) => omitEmpty({
      id: c.id,
      label: c.label || null,
      pos: c.pos,
      cols: c.cols,
      rows: c.rows === CELLS_DEFAULTS.rows ? null : c.rows,
      slot: sameNumbers(c.slot, CELLS_DEFAULTS.slot) ? null : c.slot,
      items: c.items.length ? c.items : null,
      indices: c.indices || null,
      description: c.description || null,
      ends: c.ends[0] || c.ends[1] ? c.ends : null,
      flow: c.flow,
      marks: c.marks.length ? c.marks.map((m) => ({ text: m.text, at: m.at })) : null,
      height: c.height === CELLS_DEFAULTS.height ? null : c.height,
      color: c.color === CELLS_DEFAULTS.color ? null : c.color,
      labelSize: c.labelSize === CELLS_DEFAULTS.labelSize ? null : c.labelSize,
      labelPlane: c.labelPlane === CELLS_DEFAULTS.labelPlane ? null : c.labelPlane,
      link: c.link,
    })),
    shapes: doc.shapes.map((sh) => omitEmpty({
      id: sh.id,
      kind: sh.kind,
      label: sh.label || null,
      pos: sh.pos,
      size: sh.size,
      height: sh.height === SHAPE_DEFAULTS.height ? null : sh.height,
      color: sh.color === SHAPE_DEFAULTS.color ? null : sh.color,
      labelSize: sh.labelSize === SHAPE_DEFAULTS.labelSize ? null : sh.labelSize,
      labelPlane: sh.labelPlane === SHAPE_DEFAULTS.labelPlane ? null : sh.labelPlane,
      yes: sh.yes || null,
      no: sh.no || null,
      // Only worth writing beside a branch label that exists.
      yesAt: sh.yes && sh.yesAt !== SHAPE_DEFAULTS.yesAt ? sh.yesAt : null,
      noAt: sh.no && sh.noAt !== SHAPE_DEFAULTS.noAt ? sh.noAt : null,
      link: sh.link,
    })),
  };
  return stringify(wire, 0) + '\n';
}

/**
 * The collections of one tab, in wire form.
 *
 * Written by handing the tab to `serializeDoc` as though it were a whole
 * document and keeping the collections off the result. Roundabout, and the
 * point: every field's default, omission and key order is decided in exactly
 * one place, so a tab and a plain document cannot be written differently.
 *
 * `CONTENT_KEYS` rather than a list written out here, for the reason the last
 * two additions to it demonstrated: flowchart shapes and data structures were
 * hand-listed out of this function by omission, so a tabbed file silently threw
 * both away every time it was saved.
 */
function bodyWire(doc, tab) {
  const whole = JSON.parse(serializeDoc({
    meta: doc.meta,
    canvas: doc.canvas,
    ...emptyBody(),
    ...tab,
    tabs: undefined,
  }));
  // Filtered rather than mapped, so a tab's keys come out in the order
  // `serializeDoc` chose rather than in the order they happen to be listed in.
  return Object.fromEntries(
    Object.entries(whole).filter(([key]) => CONTENT_KEYS.includes(key))
  );
}

/**
 * JSON with short primitive arrays kept inline. `JSON.stringify` would spread
 * `"pos": [2, 2]` across five lines, which makes the file tedious to read and
 * to write by hand.
 */
function stringify(value, depth) {
  const pad = '  '.repeat(depth);
  const padIn = '  '.repeat(depth + 1);

  if (value === null || typeof value !== 'object') return JSON.stringify(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every((v) => v === null || typeof v !== 'object')) {
      return `[${value.map((v) => JSON.stringify(v)).join(', ')}]`;
    }
    const items = value.map((v) => padIn + stringify(v, depth + 1));
    return `[\n${items.join(',\n')}\n${pad}]`;
  }

  const keys = Object.keys(value);
  if (keys.length === 0) return '{}';
  const items = keys.map((k) => `${padIn}${JSON.stringify(k)}: ${stringify(value[k], depth + 1)}`);
  return `{\n${items.join(',\n')}\n${pad}}`;
}

/** Placement fields, written only when they differ from the default. */
function planarWire(el, defaultPlane) {
  return {
    z: el.z || null,
    plane: el.plane === defaultPlane ? null : el.plane,
    spin: el.spin || null,
    behind: el.behind || null,
  };
}

function omitEmpty(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/** URL-ish slug; ids are meant to be read and typed by humans. */
export function slugify(text) {
  const slug = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'item';
}

/** `base`, or `base-2`, `base-3`... until it is not in `taken`. */
export function uniqueId(base, taken) {
  const slug = slugify(base);
  if (!taken.has(slug)) return slug;
  for (let i = 2; ; i++) {
    const candidate = `${slug}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function takeId(raw, fallback, used, warnings, kind) {
  const wanted = slugify(str(raw) || fallback);
  const id = uniqueId(wanted, used);
  if (raw && id !== String(raw)) {
    warnings.push(`${kind} id "${raw}" was renamed to "${id}".`);
  }
  used.add(id);
  return id;
}

// ---------------------------------------------------------------------------
// Field coercion
// ---------------------------------------------------------------------------

function str(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * A caption that is allowed to be empty.
 *
 * An absent field and an empty one say different things: "nothing was
 * specified, name it after its type" versus "draw no caption here". `str`
 * collapses the two, which is why a label the user deleted used to grow back
 * the next time the file was opened. Blocks and zones are the only fields that
 * carry a non-empty default, so they are the only ones that needed this.
 */
function readLabel(raw, fallback) {
  return typeof raw === 'string' ? raw.trim() : fallback;
}

function color(v) {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim().toLowerCase() : null;
}

function int(v, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : fallback;
}

function readPair(v, fallback, min = -MAX_SPAN) {
  if (!Array.isArray(v)) return [...fallback];
  return [
    clampInt(v[0], min, MAX_SPAN, fallback[0]),
    clampInt(v[1], min, MAX_SPAN, fallback[1]),
  ];
}

/**
 * A coordinate on the half-cell grid, or null.
 *
 * Half rather than whole cells because a connection runs between block
 * *centres*, and a block of even width has its centre on a half cell -- snap a
 * dragged crossover to integers and it can never line up with the run it came
 * from.
 */
function halfCell(v) {
  // `Number(null)` is 0, not NaN, so "no crossover" would come back as a
  // crossover at zero -- and an edge with a pinned axis and no bend would jump
  // the first time its document was normalised again.
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return clamp(Math.round(n * 2) / 2, -MAX_SPAN, MAX_SPAN);
}

function readRect(v) {
  const a = Array.isArray(v) ? v : [];
  return [
    clampInt(a[0], -MAX_SPAN, MAX_SPAN, 0),
    clampInt(a[1], -MAX_SPAN, MAX_SPAN, 0),
    clampInt(a[2], 1, MAX_SPAN, 4),
    clampInt(a[3], 1, MAX_SPAN, 4),
  ];
}

/** Free-form annotations, restricted to flat string values. */
function plainProps(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (val === null || typeof val === 'object') continue;
    out[k] = String(val);
  }
  return out;
}

function isEmpty(obj) {
  return !obj || Object.keys(obj).length === 0;
}
