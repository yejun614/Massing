/**
 * Geometry and document assertions.
 *
 * Written as a single exported function so the same suite runs in Node (fast,
 * scriptable) and in the browser (`iso.test.html`, which also proves the
 * modules load unbundled). Everything under test is deliberately DOM-free.
 */

import {
  isoProjection,
  flatProjection,
  rotatePoint,
  unrotatePoint,
  rotateRect,
  CELL,
} from '../src/geom/iso.js';
import { sortForPaint } from '../src/geom/depth.js';
import { createCamera, screenToGrid, gridToScreen, zoomAt, rotate } from '../src/render/camera.js';
import {
  normalizeDoc,
  serializeDoc,
  parseDoc,
  DEFAULT_PLANE,
  DEFAULT_ZONE_LABEL_PLANE,
  DEFAULT_LABEL_ALIGN,
  CANVAS_BACKGROUNDS,
  canvasBackground,
  createEmptyDoc,
  docRejection,
  CONTENT_KEYS,
} from '../src/core/schema.js';
import { nodeBox, rotatedBox, docBounds, containingGroup } from '../src/core/doc.js';
import { tidy, autoLayout, countOccluded } from '../src/core/arrange.js';
import { estimateTextBox, estimateLineWidth, textAnchorFor } from '../src/util/text.js';
import {
  planeTransform,
  planeAxes,
  planeVector,
  effectivePlane,
  PLANES,
  normaliseSpin,
} from '../src/geom/plane.js';
import { handlesFor, resizeFootprint } from '../src/render/handles.js';
import { edgeRoute } from '../src/render/edge.js';
import { encodeGif } from '../src/core/gif.js';
import { splitTitle } from '../src/ui/tooltip.js';
import { COMPONENTS, GROUP_KINDS, componentFor, groupKindFor, isKnownType } from '../src/data/components.js';
import { iconMarkup } from '../src/data/icons.js';
import { LLM_PROMPT } from '../src/data/prompt.js';
import { THREE_TIER } from '../src/data/samples.js';
import { overConnected } from '../src/core/assistant.js';
import {
  createLibrary,
  withinBudget,
  writeLibrary,
  readLibrary,
  MAX_TOTAL_BYTES,
  MAX_ENTRIES,
} from '../src/core/library.js';
import { createEmptyDoc as emptyDoc } from '../src/core/schema.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

/** @param {(name: string, ok: boolean, detail?: string) => void} check */
export function runCases(check) {
  rotationCases(check);
  projectionCases(check);
  cameraCases(check);
  depthCases(check);
  documentCases(check);
  densityCases(check);
  libraryCases(check);
  textCases(check);
  arrangeCases(check);
  planarCases(check);
  edgeCases(check);
  handleCases(check);
  gifCases(check);
  tooltipCases(check);
  registryCases(check);
  textMetricCases(check);
}

// ---------------------------------------------------------------------------

function rotationCases(check) {
  for (let rot = 0; rot < 4; rot++) {
    let ok = true;
    for (let x = -6; x <= 6; x++) {
      for (let y = -6; y <= 6; y++) {
        const r = rotatePoint(x, y, rot);
        const back = unrotatePoint(r.x, r.y, rot);
        if (back.x !== x || back.y !== y) ok = false;
      }
    }
    check(`rotatePoint/unrotatePoint invert each other (rot=${rot})`, ok);
  }

  const wrapped = rotatePoint(3, -5, 4);
  check('rotatePoint wraps at four quarter-turns', wrapped.x === 3 && wrapped.y === -5);

  const negative = rotatePoint(3, -5, -1);
  const equivalent = rotatePoint(3, -5, 3);
  check(
    'negative rotations are normalised',
    negative.x === equivalent.x && negative.y === equivalent.y
  );

  const odd = rotateRect(2, 1, 4, 2, 1);
  check('rotateRect swaps w/h on odd turns', odd.w === 2 && odd.h === 4);

  check(
    'rotateRect keeps area and re-anchors at the minimum corner',
    (() => {
      for (let rot = 0; rot < 4; rot++) {
        const r = rotateRect(-3, 5, 4, 7, rot);
        if (r.w * r.h !== 28) return false;
        const corners = [[-3, 5], [1, 5], [1, 12], [-3, 12]].map(([x, y]) => rotatePoint(x, y, rot));
        if (r.x !== Math.min(...corners.map((c) => c.x))) return false;
        if (r.y !== Math.min(...corners.map((c) => c.y))) return false;
      }
      return true;
    })()
  );
}

function projectionCases(check) {
  for (const proj of [isoProjection, flatProjection]) {
    let worst = 0;
    for (let x = -20; x <= 20; x += 0.5) {
      for (let y = -20; y <= 20; y += 0.5) {
        const s = proj.project(x, y, 0);
        const back = proj.unproject(s.x, s.y, 0);
        worst = Math.max(worst, Math.abs(back.x - x), Math.abs(back.y - y));
      }
    }
    check(`${proj.kind}: unproject(project(p)) === p on the ground plane`, worst < 1e-9, `worst=${worst}`);
  }

  check(
    'iso: unproject compensates for height',
    [0, 1, 2.5, 7].every((z) => {
      const s = isoProjection.project(3, -4, z);
      const back = isoProjection.unproject(s.x, s.y, z);
      return near(back.x, 3) && near(back.y, -4);
    })
  );

  const a = isoProjection.project(2, 3, 0);
  const b = isoProjection.project(2, 3, 1);
  check('iso: +z is straight up on screen', near(a.x, b.x) && near(b.y, a.y - CELL));

  const o = isoProjection.project(0, 0, 0);
  const px = isoProjection.project(1, 0, 0);
  const py = isoProjection.project(0, 1, 0);
  check(
    'iso: +x goes right and down, +y goes left and down',
    px.x > o.x && px.y > o.y && py.x < o.x && py.y > o.y
  );
  check('iso: a unit cell edge measures CELL px', near(Math.hypot(px.x - o.x, px.y - o.y), CELL));

  const fx = flatProjection.project(1, 0, 5);
  check('flat: height is ignored', near(fx.y, 0) && near(fx.x, CELL));
}

function cameraCases(check) {
  for (let rot = 0; rot < 4; rot++) {
    for (const mode of ['iso', 'flat']) {
      const cam = { ...createCamera(), rot, mode, tx: 137, ty: -64, zoom: 1.73 };
      let worst = 0;
      for (const [x, y] of [[0, 0], [5, 3], [-8, 12], [21, -4]]) {
        const s = gridToScreen(cam, x, y, 0);
        const g = screenToGrid(cam, s.x, s.y, 0);
        worst = Math.max(worst, Math.abs(g.x - x), Math.abs(g.y - y));
      }
      check(`camera ${mode}/rot=${rot}: screen<->grid round-trip`, worst < 1e-9, `worst=${worst}`);
    }
  }

  const cam = { ...createCamera(), tx: 40, ty: 90, zoom: 1 };
  const before = screenToGrid(cam, 300, 220, 0);
  const after = screenToGrid(zoomAt(cam, 300, 220, 1.6), 300, 220, 0);
  check(
    'zoomAt keeps the point under the cursor fixed',
    near(before.x, after.x, 1e-9) && near(before.y, after.y, 1e-9)
  );

  let spun = createCamera();
  for (let i = 0; i < 4; i++) spun = rotate(spun, 1);
  check('four rotations return to the original orientation', spun.rot === 0);

  check(
    'camera rotation matches the rotation applied to boxes',
    (() => {
      const node = { pos: [4, 1], size: [3, 2], height: 2 };
      for (let rot = 0; rot < 4; rot++) {
        const box = rotatedBox(nodeBox(node), rot);
        const corner = rotatePoint(node.pos[0], node.pos[1], rot);
        const far = rotatePoint(node.pos[0] + 3, node.pos[1] + 2, rot);
        if (box.x !== Math.min(corner.x, far.x)) return false;
        if (box.y !== Math.min(corner.y, far.y)) return false;
      }
      return true;
    })()
  );
}

function depthCases(check) {
  // The case a naive `x + y` key gets wrong: the long block ends at x=1, so it
  // is entirely behind the small one at x=2, yet its corner sum is larger.
  const long = { id: 'a', x: 0, y: 0, w: 1, h: 6, z: 0, ht: 2 };
  const small = { id: 'b', x: 2, y: 1, w: 1, h: 1, z: 0, ht: 2 };
  check(
    'depth: a long block behind a small one is painted first',
    sortForPaint([small, long]).map((v) => v.id).join(',') === 'a,b'
  );

  const low = { id: 'low', x: 0, y: 0, w: 2, h: 2, z: 0, ht: 1 };
  const high = { id: 'high', x: 0, y: 0, w: 2, h: 2, z: 1, ht: 1 };
  check(
    'depth: stacked blocks sort by height',
    sortForPaint([high, low]).map((v) => v.id).join(',') === 'low,high'
  );

  check(
    'depth: a block further along +y is painted later',
    (() => {
      const back = { id: 'back', x: 0, y: 0, w: 2, h: 2, z: 0, ht: 2 };
      const front = { id: 'front', x: 0, y: 4, w: 2, h: 2, z: 0, ht: 2 };
      return sortForPaint([front, back]).map((v) => v.id).join(',') === 'back,front';
    })()
  );

  check(
    'depth: every input box appears exactly once',
    (() => {
      const boxes = [];
      for (let i = 0; i < 40; i++) {
        boxes.push({ id: `n${i}`, x: (i * 7) % 20, y: (i * 3) % 15, w: 2, h: 2, z: 0, ht: 2 });
      }
      const order = sortForPaint(boxes);
      return order.length === boxes.length && new Set(order.map((b) => b.id)).size === boxes.length;
    })()
  );

  check(
    'depth: distant boxes that cannot overlap never deadlock the sort',
    (() => {
      // These two produce contradictory pairwise rules but do not overlap on
      // screen, which is exactly the case the screen-bounds guard exists for.
      const a = { id: 'a', x: 0, y: 20, w: 2, h: 2, z: 0, ht: 2 };
      const b = { id: 'b', x: 20, y: 0, w: 2, h: 2, z: 0, ht: 2 };
      return sortForPaint([a, b]).length === 2;
    })()
  );
}

/*
 * The one house rule the loader cannot enforce, and the only one the assistant
 * was measurably ignoring: written into the prompt it agreed and overspent
 * anyway, six diagrams out of six. Said back in the tool result -- after the
 * mistake, with the arithmetic done -- it fixes it and sends again.
 */
/*
 * The library lives in a five-megabyte box shared with the chat sessions, and a
 * diagram with a screenshot pasted into it is megabytes on its own. What it
 * does when it runs out is the whole design, so it is the part under test.
 */
function libraryCases(check) {
  const entry = (id, at, textBytes) => ({
    id,
    at,
    title: id,
    text: textBytes ? 'x'.repeat(textBytes) : null,
    fileName: `${id}.arch.json`,
  });

  check('entries come back newest first', (() => {
    const kept = withinBudget([entry('a', 10, 100), entry('b', 30, 100), entry('c', 20, 100)]);
    return kept.map((e) => e.id).join('') === 'bca';
  })());

  check('the list is capped', withinBudget(
    Array.from({ length: MAX_ENTRIES + 12 }, (_, i) => entry(`e${i}`, i, 10))
  ).length === MAX_ENTRIES);

  // Six diagrams of 400 kB: each is under the per-diagram cap, together they
  // are over the total. Age is what decides.
  const crowded = () => Array.from({ length: 6 }, (_, i) => entry(`e${i}`, i, 400_000));

  check('text is dropped before records are', (() => {
    const kept = withinBudget(crowded());
    return kept.length === 6 && kept.filter((e) => e.text).length < 6;
  })());

  check('the newest keeps its text longest', (() => {
    const kept = withinBudget(crowded());
    const byId = Object.fromEntries(kept.map((e) => [e.id, e]));
    // Whatever had to go, it was not the one opened most recently.
    return Boolean(byId.e5.text) && !byId.e0.text;
  })());

  check('an evicted entry says so, and keeps the way back', (() => {
    const gone = withinBudget(crowded()).find((e) => !e.text);
    return gone.evicted === true && typeof gone.fileName === 'string';
  })());

  check('a diagram past the per-diagram cap never keeps its text', (() => {
    // Even with the whole budget free: the same rule `remember` applies on the
    // way in, so the two cannot disagree about what is stored.
    const kept = withinBudget([entry('huge', 1, 900_000)]);
    return kept.length === 1 && kept[0].text === null && kept[0].evicted === true;
  })());

  check('records go only once every text already has', (() => {
    // Forty entries with no text at all still fit; nothing should be dropped.
    const kept = withinBudget(Array.from({ length: 20 }, (_, i) => entry(`e${i}`, i, 0)));
    return kept.length === 20;
  })());

  check('one diagram cannot fill the whole budget', (() => {
    const kept = withinBudget([entry('huge', 5, MAX_TOTAL_BYTES * 2), entry('small', 4, 100)]);
    return kept.find((e) => e.id === 'small')?.text !== null;
  })(), 'a pasted screenshot must not evict everything else');

  // Storage that refuses everything, which is a real configuration.
  const broken = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  check('storage that throws reads as an empty library', readLibrary(broken).length === 0);
  check('storage that throws does not take the editor down with it', (() => {
    writeLibrary([entry('a', 1, 100)], broken);
    return true;
  })());

  const map = new Map();
  const fake = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
  check('what is written is what comes back', (() => {
    writeLibrary([entry('a', 2, 50), entry('b', 1, 50)], fake);
    const back = readLibrary(fake);
    return back.length === 2 && back[0].id === 'a' && back[0].text.length === 50;
  })());
  /*
   * The round trip, through the real thing rather than its parts.
   *
   * Every unit below passed while the library did not survive a reload at all:
   * a patch spread `id: undefined` over the id it had just been given, and
   * `readLibrary` drops anything without one. Nothing that tested a single
   * function could see it.
   */
  check('diagrams persist, and stay separate', (() => {
    const shelf = new Map();
    const store = {
      getItem: (k) => shelf.get(k) ?? null,
      setItem: (k, v) => shelf.set(k, String(v)),
      removeItem: (k) => shelf.delete(k),
    };
    const lib = createLibrary({ storage: store });
    const first = lib.remember(emptyDoc('First'));
    lib.startFresh();
    const second = lib.remember(emptyDoc('Second'));

    if (typeof first.id !== 'string' || typeof second.id !== 'string') return false;
    if (first.id === second.id) return false;
    // The proof: a second library reading the same storage sees both.
    const reopened = createLibrary({ storage: store });
    const titles = reopened.entries.map((e) => e.title).sort().join(',');
    return titles === 'First,Second';
  })(), 'the library has to outlive the page it was built on');

  check('editing the open diagram updates it rather than duplicating it', (() => {
    const shelf = new Map();
    const store = {
      getItem: (k) => shelf.get(k) ?? null,
      setItem: (k, v) => shelf.set(k, String(v)),
      removeItem: (k) => shelf.delete(k),
    };
    const lib = createLibrary({ storage: store });
    lib.remember(emptyDoc('Draft'));
    lib.remember(emptyDoc('Draft, renamed'));
    return lib.entries.length === 1 && lib.entries[0].title === 'Draft, renamed';
  })());

  check('a file is matched by its name, not by its contents', (() => {
    const shelf = new Map();
    const store = {
      getItem: (k) => shelf.get(k) ?? null,
      setItem: (k, v) => shelf.set(k, String(v)),
      removeItem: (k) => shelf.delete(k),
    };
    const lib = createLibrary({ storage: store });
    lib.remember(emptyDoc('A'), { fileName: 'a.arch.json' });
    lib.startFresh();
    lib.remember(emptyDoc('B'), { fileName: 'b.arch.json' });
    return lib.matching({ fileName: 'a.arch.json' })?.title === 'A' &&
      lib.matching({ fileName: 'nope.arch.json' }) === null;
  })());

  check('anything that is not a list of entries reads as empty', (() => {
    fake.setItem('massing:library:v1', '{"not":"a list"}');
    const a = readLibrary(fake).length === 0;
    fake.setItem('massing:library:v1', 'not json at all');
    return a && readLibrary(fake).length === 0;
  })());
}

function densityCases(check) {
  const doc = (blocks, lines) => ({
    nodes: Array.from({ length: blocks }, (_, i) => ({ id: `n${i}` })),
    edges: Array.from({ length: lines }, (_, i) => ({ id: `e${i}` })),
  });

  check('a diagram inside its budget is not told anything',
    overConnected(doc(12, 4)) === null && overConnected(doc(6, 3)) === null);
  check('the complaint starts past one connection per two blocks',
    overConnected(doc(6, 3)) === null && overConnected(doc(6, 4)) !== null,
    'the threshold has to match the validator, or the project holds two opinions');
  check('it names the budget rather than only the breach', (() => {
    const said = overConnected(doc(12, 9));
    return said.includes('9 for 12 blocks') && said.includes('cut it to 4');
  })(), overConnected(doc(12, 9)));
  check('a small diagram is still asked for at least one', (() => {
    // Four blocks over budget is a budget of one, not of zero: floor(4 / 3).
    return overConnected(doc(4, 4)).includes('cut it to 1');
  })(), overConnected(doc(4, 4)));
  check('an empty diagram is not scolded for having no connections',
    overConnected(doc(0, 0)) === null);

}

function documentCases(check) {
  const { doc: sample, warnings } = normalizeDoc(THREE_TIER);
  check('sample document loads without warnings', warnings.length === 0, warnings.join(' | '));
  check('sample keeps all of its nodes', sample.nodes.length === THREE_TIER.nodes.length);

  const once = serializeDoc(sample);
  const twice = serializeDoc(parseDoc(once).doc);
  check('serialize -> parse -> serialize is byte-identical', once === twice);
  check(
    'normalisation is idempotent',
    JSON.stringify(normalizeDoc(sample).doc) === JSON.stringify(sample)
  );
  check('reloading a saved file produces no warnings', parseDoc(once).warnings.length === 0);

  // --- captions may be deliberately empty -----------------------------------
  // Absent and empty are different answers. Reading them as the same is what
  // made a deleted label grow back the next time the file was opened.

  check('a label that was deleted stays deleted', (() => {
    const doc = normalizeDoc({
      groups: [{ id: 'vpc', kind: 'vpc', label: 'Production', rect: [0, 0, 10, 10] }],
      nodes: [{ id: 'api', type: 'ec2', label: 'API', pos: [1, 1] }],
    }).doc;
    doc.groups[0].label = '';
    doc.nodes[0].label = '';

    const saved = serializeDoc(doc);
    const back = parseDoc(saved).doc;
    return back.groups[0].label === '' && back.nodes[0].label === '' &&
      // ...and survives a second trip, which is where a re-defaulted label
      // would show up as a file that changes every time it is opened.
      serializeDoc(back) === saved;
  })());

  check('an absent label still falls back to the type name', (() => {
    const doc = normalizeDoc({
      groups: [{ id: 'g', kind: 'vpc', rect: [0, 0, 4, 4] }],
      nodes: [{ id: 'n', type: 'ec2', pos: [0, 0] }],
    }).doc;
    return doc.groups[0].label === groupKindFor('vpc').label &&
      doc.nodes[0].label === componentFor('ec2').label;
  })());

  check('an empty label does not fall through to the name alias', (() => {
    const doc = normalizeDoc({
      nodes: [
        { id: 'a', type: 'ec2', name: 'From the alias', pos: [0, 0] },
        { id: 'b', type: 'ec2', label: '', name: 'Ignored', pos: [2, 0] },
      ],
    }).doc;
    return doc.nodes[0].label === 'From the alias' && doc.nodes[1].label === '';
  })());

  check('a whitespace-only label counts as empty', (() => {
    const doc = normalizeDoc({
      groups: [{ id: 'g', kind: 'vpc', label: '  ', rect: [0, 0, 4, 4] }],
      nodes: [{ id: 'n', type: 'ec2', label: '\t\n', pos: [0, 0] }],
    }).doc;
    return doc.groups[0].label === '' && doc.nodes[0].label === '';
  })());

  check('an unlabelled entity still gets a readable id', (() => {
    const doc = normalizeDoc({
      groups: [{ kind: 'vpc', label: '', rect: [0, 0, 4, 4] }],
      nodes: [{ type: 'ec2', label: '', pos: [0, 0] }],
    }).doc;
    // Not "item": the slug falls back to what the thing *is*.
    return doc.groups[0].id === 'vpc' && doc.nodes[0].id === 'ec2';
  })());

  // --- the canvas colour ----------------------------------------------------
  // A document either names a background or has no opinion. Only the second
  // kind follows the theme, and the difference has to survive the file.

  check('a document that names no colour follows the theme', (() => {
    const doc = normalizeDoc({ nodes: [], canvas: {} }).doc;
    return doc.canvas.background === null &&
      canvasBackground(doc, false) === CANVAS_BACKGROUNDS.light &&
      canvasBackground(doc, true) === CANVAS_BACKGROUNDS.dark;
  })());

  check('a new diagram has no opinion either', (() => {
    const doc = normalizeDoc(createEmptyDoc()).doc;
    return doc.canvas.background === null && canvasBackground(doc, true) === CANVAS_BACKGROUNDS.dark;
  })());

  check('a colour someone chose is honoured whatever the theme is doing', (() => {
    const light = normalizeDoc({ nodes: [], canvas: { background: '#ffffff' } }).doc;
    const dark = normalizeDoc({ nodes: [], canvas: { background: '#0f172a' } }).doc;
    return canvasBackground(light, true) === '#ffffff' &&
      canvasBackground(dark, false) === '#0f172a';
  })());

  check('a colour nobody can read is no opinion, not a broken one',
    normalizeDoc({ nodes: [], canvas: { background: 'chartreuse' } }).doc.canvas.background === null);

  check('"no opinion" is written by not being written', (() => {
    // Writing the resolved colour would turn whatever theme happened to be on
    // at save time into a preference the file then carries forever.
    const doc = normalizeDoc({ nodes: [], canvas: {} }).doc;
    const text = serializeDoc(doc);
    return !text.includes('background') &&
      parseDoc(text).doc.canvas.background === null &&
      serializeDoc(parseDoc(text).doc) === text;
  })());

  check('a chosen colour survives the round trip', (() => {
    const doc = normalizeDoc({ nodes: [], canvas: { background: '#e2e8f0' } }).doc;
    const text = serializeDoc(doc);
    return text.includes('"background": "#e2e8f0"') &&
      parseDoc(text).doc.canvas.background === '#e2e8f0' &&
      serializeDoc(parseDoc(text).doc) === text;
  })());

  check('the sample opens with no opinion, so a first visit follows the theme',
    normalizeDoc(THREE_TIER).doc.canvas.background === null,
    'the built-in diagram would be a white rectangle in a dark room');

  // --- caption alignment ----------------------------------------------------

  check('a pinned axis with no crossover stays uncrossed', (() => {
    // `Number(null)` is 0, so reading a null bend back used to invent a
    // crossover at zero and the connection moved on the second normalisation.
    const once = normalizeDoc({
      nodes: [
        { id: 'a', type: 'ec2', pos: [0, 0] },
        { id: 'b', type: 'rds', pos: [6, 6] },
      ],
      edges: [{ id: 'e', from: 'a', to: 'b', route: 'x' }],
    }).doc;
    return once.edges[0].bend === null && normalizeDoc(once).doc.edges[0].bend === null;
  })());

  check('a caption alignment round-trips on blocks and connections', (() => {
    const doc = normalizeDoc({
      nodes: [
        { id: 'a', type: 'ec2', pos: [0, 0], labelAlign: 'left' },
        { id: 'b', type: 'rds', pos: [5, 0], labelAlign: 'right' },
      ],
      edges: [{ id: 'e', from: 'a', to: 'b', label: '5432', labelAlign: 'left' }],
    }).doc;
    const saved = serializeDoc(doc);
    const back = parseDoc(saved).doc;
    return back.nodes[0].labelAlign === 'left' && back.nodes[1].labelAlign === 'right' &&
      back.edges[0].labelAlign === 'left' && serializeDoc(back) === saved;
  })());

  check('captions centre unless told otherwise', (() => {
    const doc = normalizeDoc({
      nodes: [{ id: 'a', type: 'ec2', pos: [0, 0] }, { id: 'b', type: 'rds', pos: [5, 0] }],
      edges: [{ id: 'e', from: 'a', to: 'b' }],
    }).doc;
    return doc.nodes.every((n) => n.labelAlign === DEFAULT_LABEL_ALIGN) &&
      doc.edges[0].labelAlign === DEFAULT_LABEL_ALIGN;
  })());

  check('the default alignment is not written to the file', (() => {
    const doc = normalizeDoc({
      nodes: [{ id: 'a', type: 'ec2', pos: [0, 0], labelAlign: DEFAULT_LABEL_ALIGN }],
    }).doc;
    return !serializeDoc(doc).includes('labelAlign');
  })());

  check('a nonsense alignment falls back rather than reaching the renderer', (() => {
    const doc = normalizeDoc({
      nodes: [{ id: 'a', type: 'ec2', pos: [0, 0], labelAlign: 'justify' }, { id: 'b', type: 'rds', pos: [5, 0] }],
      edges: [{ id: 'e', from: 'a', to: 'b', labelAlign: 7 }],
    }).doc;
    return doc.nodes[0].labelAlign === DEFAULT_LABEL_ALIGN &&
      doc.edges[0].labelAlign === DEFAULT_LABEL_ALIGN;
  })());

  check('every alignment maps to an SVG text-anchor', (() =>
    textAnchorFor('left') === 'start' &&
    textAnchorFor('center') === 'middle' &&
    textAnchorFor('right') === 'end' &&
    // Anything unrecognised has to land somewhere sane rather than emit an
    // attribute the browser will ignore.
    textAnchorFor(undefined) === 'start')());

  check('clearing every caption produces no warnings', (() => {
    const doc = normalizeDoc(THREE_TIER).doc;
    doc.nodes.forEach((n) => (n.label = ''));
    doc.groups.forEach((g) => (g.label = ''));
    doc.edges.forEach((e) => (e.label = ''));
    doc.images.forEach((im) => (im.label = ''));
    const round = parseDoc(serializeDoc(doc));
    return round.warnings.length === 0 &&
      round.doc.nodes.every((n) => n.label === '') &&
      round.doc.groups.every((g) => g.label === '');
  })());
  check('short numeric arrays stay on one line', once.includes('"pos": ['), 'pos should be inline');
  check('no array element sits alone on its own line', !/\[\n\s+-?\d+,\n/.test(once));
  check('serialised output ends with a newline', once.endsWith('\n'));
  check('output is indented with two spaces', once.includes('\n  "version": 1'));

  const missing = normalizeDoc({ nodes: [{ type: 'ec2' }, { type: 'nonsense' }] });
  check(
    'a document with missing fields still loads',
    missing.doc.nodes.length === 2 &&
      missing.doc.nodes[1].type === 'generic' &&
      missing.warnings.length > 0
  );

  const dupes = normalizeDoc({ nodes: [{ id: 'a', type: 'ec2' }, { id: 'a', type: 'ec2' }] });
  check('duplicate ids are made unique', dupes.doc.nodes[0].id !== dupes.doc.nodes[1].id);

  const dangling = normalizeDoc({
    nodes: [{ id: 'a', type: 'ec2' }],
    edges: [{ from: 'a', to: 'ghost' }],
  });
  check(
    'edges with a missing endpoint are dropped, not fatal',
    dangling.doc.edges.length === 0 && dangling.warnings.some((w) => w.includes('ghost'))
  );

  const cyclic = normalizeDoc({
    groups: [
      { id: 'a', kind: 'vpc', rect: [0, 0, 4, 4], parent: 'b' },
      { id: 'b', kind: 'vpc', rect: [0, 0, 6, 6], parent: 'a' },
    ],
  });
  check(
    'group parent cycles are broken',
    cyclic.doc.groups.filter((g) => g.parent === null).length >= 1
  );

  const junk = normalizeDoc('not a document');
  check(
    'a non-object root is rejected rather than opened',
    junk.doc.nodes.length === 0 && /top level is text/.test(junk.rejection ?? '')
  );

  // --- JSON that is not a diagram -------------------------------------------
  // Normalisation reads any object at all, so without a gate in front of it
  // opening a package.json threw the drawing away for a blank canvas and said
  // nothing. Recognition has to happen before the repairing starts.

  check('JSON that describes something else is rejected', (() => {
    const foreign = normalizeDoc({
      name: 'massing',
      version: '1.0.0',
      scripts: { build: 'node build.js' },
      dependencies: {},
    });
    // The keys it does have belong in the message: told only "not a diagram",
    // the first thing anyone does is go and open the file to see what it is.
    return foreign.rejection?.includes('name, version, scripts, dependencies') === true;
  })());

  check('every collection on its own is enough to be recognised', () =>
    CONTENT_KEYS.every((key) => docRejection({ [key]: [] }) === null));

  check('a saved empty diagram still opens', (() => {
    // It writes all five collections as [], and refusing to reopen the file
    // you have just saved would be its own bug.
    const text = serializeDoc(createEmptyDoc());
    return parseDoc(text).rejection === null;
  })());

  check('a diagram is rejected whole, never half-read', (() => {
    const rejected = normalizeDoc({ meta: { title: 'Looks promising' }, version: 1 });
    return rejected.rejection !== null && rejected.doc.meta.title === 'Untitled diagram';
  })());

  check('a collection written as something other than a list is reported', (() => {
    const wrong = normalizeDoc({ nodes: [], edges: { from: 'a', to: 'b' } });
    return wrong.rejection === null && wrong.warnings.some((w) => w.includes('"edges" is an object'));
  })());

  check('an entry that is not an object is dropped by name and index', (() => {
    const ragged = normalizeDoc({ nodes: [{ id: 'a', type: 'ec2', pos: [0, 0] }, null, 7] });
    return ragged.doc.nodes.length === 1 &&
      ragged.warnings.some((w) => w.includes('nodes[1]')) &&
      ragged.warnings.some((w) => w.includes('nodes[2]'));
  })());

  check('a block that forgot where it goes says so', (() => {
    // Not a neutral default: every block that omits pos lands on the same cell
    // and the diagram opens as one lump.
    const placeless = normalizeDoc({ nodes: [{ id: 'a', type: 'ec2' }] });
    return placeless.warnings.some((w) => w.includes('no pos'));
  })());

  const loose = normalizeDoc({
    nodes: [{ id: 'w', type: 'ec2', x: 3, y: 4, w: 3, h: 2, name: 'Web' }],
  });
  check(
    'shorthand x/y/w/h and name are accepted',
    loose.doc.nodes[0].pos[0] === 3 &&
      loose.doc.nodes[0].size[0] === 3 &&
      loose.doc.nodes[0].label === 'Web'
  );

  check(
    'containingGroup picks the innermost zone',
    (() => {
      const inner = containingGroup(sample, nodeBox(sample.nodes.find((n) => n.id === 'web-1')));
      return inner?.id === 'private-subnet';
    })()
  );

  // Derived from the sample rather than written out, so redrawing the starter
  // diagram cannot quietly turn this into an assertion about nothing.
  const bounds = docBounds(sample);
  check('docBounds covers every entity', (() => {
    const inside = (x, y) => x >= bounds.x0 && y >= bounds.y0 && x <= bounds.x1 && y <= bounds.y1;
    return sample.nodes.every((n) =>
      inside(n.pos[0], n.pos[1]) && inside(n.pos[0] + n.size[0], n.pos[1] + n.size[1]) &&
      bounds.zmax >= n.height) &&
      sample.groups.every((g) => inside(g.rect[0], g.rect[1]) &&
        inside(g.rect[0] + g.rect[2], g.rect[1] + g.rect[3])) &&
      sample.texts.every((t) => inside(t.pos[0], t.pos[1]));
  })());
}

function textCases(check) {
  const { doc, warnings } = normalizeDoc({
    nodes: [{ id: 'a', type: 'ec2', pos: [0, 0] }],
    texts: [
      { id: 'note', text: 'line one\nline two', pos: [2, 3], size: 20, bold: true, align: 'center' },
      { text: 'no id here', pos: [1, 1] },
      { id: 'blank', text: '   ' },
      { id: 'wild', text: 'x', pos: [4, 4], size: 9999, align: 'sideways', color: 'nope' },
    ],
  });

  check('texts load with their styling intact', (() => {
    const note = doc.texts.find((t) => t.id === 'note');
    return note?.text === 'line one\nline two' && note.size === 20 && note.bold === true &&
      note.align === 'center';
  })());

  check('a text without an id gets one from its content', (() => {
    const derived = doc.texts.find((t) => t.text === 'no id here');
    return !!derived && /^[a-z0-9-]+$/.test(derived.id);
  })());

  check('an empty text is dropped with a warning', (() => {
    return !doc.texts.some((t) => t.id === 'blank') &&
      warnings.some((w) => w.includes('no content'));
  })());

  check('out-of-range text styling is clamped to something usable', (() => {
    const wild = doc.texts.find((t) => t.id === 'wild');
    return wild.size <= 200 && wild.align === 'left' && /^#[0-9a-f]{6}$/.test(wild.color);
  })());

  check('text ids share the namespace with nodes', (() => {
    const clash = normalizeDoc({
      nodes: [{ id: 'thing', type: 'ec2' }],
      texts: [{ id: 'thing', text: 'hello' }],
    });
    return clash.doc.texts[0].id !== 'thing';
  })());

  check('texts survive a serialise round-trip byte-identically', (() => {
    const once = serializeDoc(doc);
    return once === serializeDoc(parseDoc(once).doc);
  })());

  check('unstyled text stays terse in the file', (() => {
    const plain = normalizeDoc({ texts: [{ id: 'p', text: 'hi', pos: [0, 0] }] }).doc;
    const out = serializeDoc(plain);
    return !out.includes('"bold"') && !out.includes('"italic"') && !out.includes('"align"');
  })());

  /*
   * Anything flat lies on the ground unless it says otherwise, and captions
   * follow the same rule. This went untested once and the JSON Schema's prose
   * drifted to claim the opposite for `texts` — which is the copy a language
   * model reads, so it emitted screen-facing notes for months.
   */
  check('flat content defaults to the ground', (() => {
    const doc = normalizeDoc({
      texts: [{ id: 't', text: 'hi', pos: [0, 0] }],
      images: [{ id: 'i', src: 'data:image/png;base64,iVBORw0KGgo=', pos: [0, 0] }],
    }).doc;
    return doc.texts[0].plane === DEFAULT_PLANE && doc.images[0].plane === DEFAULT_PLANE;
  })());

  check('captions default to the ground, except a zone’s', (() => {
    const doc = normalizeDoc({
      nodes: [{ id: 'a', type: 'ec2' }, { id: 'b', type: 'rds' }],
      edges: [{ from: 'a', to: 'b' }],
      groups: [{ id: 'z', kind: 'vpc', rect: [0, 0, 8, 8] }],
    }).doc;
    return (
      doc.nodes[0].labelPlane === DEFAULT_PLANE &&
      doc.edges[0].labelPlane === DEFAULT_PLANE &&
      doc.groups[0].labelPlane === DEFAULT_ZONE_LABEL_PLANE
    );
  })());

  check('the sample document includes annotations', (() => {
    const sample = normalizeDoc(THREE_TIER);
    return sample.doc.texts.length === 2 && sample.warnings.length === 0;
  })());

  check('docBounds covers annotations placed outside the blocks', (() => {
    const only = normalizeDoc({ texts: [{ id: 'far', text: 'x', pos: [50, 60] }] }).doc;
    const b = docBounds(only);
    return b.x1 >= 50 && b.y1 >= 60;
  })());
}

function arrangeCases(check) {
  /** A tall block parked directly in front of a short one: the reported bug. */
  const hidden = () => normalizeDoc({
    nodes: [
      { id: 'small', type: 'lambda', pos: [0, 0], height: 1 },
      { id: 'tall', type: 'rds', pos: [3, 3], height: 3 },
    ],
  }).doc;

  check('the occlusion detector sees a tall block hiding a short one',
    countOccluded(hidden(), 0) >= 1);

  check('the detector counts a covered caption, not just a covered block', (() => {
    // Identical geometry; only the caption plane differs. A blank label is not
    // a fair control -- the loader fills it in from the component type.
    const onScreen = normalizeDoc({
      nodes: [
        { id: 'small', type: 'lambda', pos: [0, 0], height: 1, labelPlane: 'screen' },
        { id: 'tall', type: 'rds', pos: [3, 3], height: 3, labelPlane: 'screen' },
      ],
    }).doc;
    return countOccluded(hidden(), 0) > countOccluded(onScreen, 0);
  })());

  check('a caption on the screen plane cannot be hidden, so it is not counted', (() => {
    const doc = normalizeDoc({
      nodes: [
        { id: 'small', type: 'lambda', pos: [0, 0], height: 1, labelPlane: 'screen' },
        { id: 'tall', type: 'rds', pos: [3, 3], height: 3, labelPlane: 'screen' },
      ],
    }).doc;
    return countOccluded(doc, 0) === 1; // the short block, and nothing else
  })());

  check('tidy clears a note that a single block was sitting on', (() => {
    // One block and one note: there is no second block to sort against, which
    // is exactly the case the old two-item guard skipped.
    const doc = normalizeDoc({
      nodes: [{ id: 'b', type: 'rds', pos: [3, 3], height: 3, labelPlane: 'screen' }],
      texts: [{ id: 'n', text: 'behind the database', pos: [0, 0], plane: 'floor' }],
    }).doc;
    const before = countOccluded(doc, 0);
    tidy(doc, { rot: 0 });
    return before > 0 && countOccluded(doc, 0) === 0;
  })());

  check('tidy clears it', (() => {
    const doc = hidden();
    const moved = tidy(doc, { rot: 0 });
    return moved > 0 && countOccluded(doc, 0) === 0;
  })());

  check('tidy only pushes along depth, never sideways', (() => {
    const doc = hidden();
    const before = doc.nodes.map((n) => n.pos[0] - n.pos[1]);
    tidy(doc, { rot: 0 });
    const after = doc.nodes.map((n) => n.pos[0] - n.pos[1]);
    return before.every((v, i) => v === after[i]);
  })());

  check('tidy is idempotent', (() => {
    const doc = hidden();
    tidy(doc, { rot: 0 });
    const once = JSON.stringify(doc.nodes.map((n) => n.pos));
    const moved = tidy(doc, { rot: 0 });
    return moved === 0 && once === JSON.stringify(doc.nodes.map((n) => n.pos));
  })());

  check('a short block in front of a tall one is left alone', (() => {
    const doc = normalizeDoc({
      nodes: [
        { id: 'tall', type: 'rds', pos: [0, 0], height: 3 },
        { id: 'small', type: 'lambda', pos: [3, 3], height: 1 },
      ],
    }).doc;
    return countOccluded(doc, 0) === 0 && tidy(doc, { rot: 0 }) === 0;
  })());

  check('tidy keeps the diagram anchored where it was', (() => {
    const doc = hidden();
    const x0 = Math.min(...doc.nodes.map((n) => n.pos[0]));
    const y0 = Math.min(...doc.nodes.map((n) => n.pos[1]));
    tidy(doc, { rot: 0 });
    return Math.min(...doc.nodes.map((n) => n.pos[0])) === x0 &&
      Math.min(...doc.nodes.map((n) => n.pos[1])) === y0;
  })());

  for (const rot of [0, 1, 2, 3]) {
    check(`tidy clears occlusion at rotation ${rot}`, (() => {
      const doc = normalizeDoc(THREE_TIER).doc;
      tidy(doc, { rot });
      return countOccluded(doc, rot) === 0;
    })());
  }

  check('tidy never overlaps two footprints', (() => {
    const doc = normalizeDoc(THREE_TIER).doc;
    tidy(doc, { rot: 0 });
    for (let i = 0; i < doc.nodes.length; i++) {
      for (let j = i + 1; j < doc.nodes.length; j++) {
        if (boxesOverlapLocal(doc.nodes[i], doc.nodes[j])) return false;
      }
    }
    return true;
  })());

  check('auto layout clears occlusion on the sample', (() => {
    const doc = normalizeDoc(THREE_TIER).doc;
    autoLayout(doc, { rot: 0 });
    return countOccluded(doc, 0) === 0;
  })());

  check('auto layout puts connected blocks in flow order', (() => {
    const doc = normalizeDoc({
      nodes: [
        { id: 'c', type: 'rds', pos: [0, 0] },
        { id: 'a', type: 'elb', pos: [5, 5] },
        { id: 'b', type: 'ec2', pos: [9, 1] },
      ],
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
    }).doc;
    autoLayout(doc, { rot: 0 });
    const at = (id) => doc.nodes.find((n) => n.id === id).pos;
    // Ranks advance along (+1,-1), so screen-x is (x - y) and must increase.
    const sx = (id) => at(id)[0] - at(id)[1];
    return sx('a') < sx('b') && sx('b') < sx('c');
  })());

  check('auto layout keeps ranks at equal depth so none can hide another', (() => {
    const doc = normalizeDoc({
      nodes: [
        { id: 'a', type: 'elb', pos: [0, 0] },
        { id: 'b', type: 'rds', pos: [4, 0], height: 3 },
      ],
      edges: [{ from: 'a', to: 'b' }],
    }).doc;
    autoLayout(doc, { rot: 0 });
    const depth = (id) => {
      const n = doc.nodes.find((x) => x.id === id);
      return n.pos[0] + n.pos[1];
    };
    return depth('a') === depth('b');
  })());

  check('auto layout keeps blocks inside their own zone', (() => {
    const doc = normalizeDoc(THREE_TIER).doc;
    autoLayout(doc, { rot: 0 });
    return doc.nodes.every((n) => {
      if (!n.group) return true;
      const g = doc.groups.find((x) => x.id === n.group);
      return g && n.pos[0] >= g.rect[0] && n.pos[1] >= g.rect[1] &&
        n.pos[0] + n.size[0] <= g.rect[0] + g.rect[2] &&
        n.pos[1] + n.size[1] <= g.rect[1] + g.rect[3];
    });
  })());

  check('a nested zone stays inside its parent after arranging', (() => {
    for (const fn of [tidy, autoLayout]) {
      const doc = normalizeDoc(THREE_TIER).doc;
      fn(doc, { rot: 0 });
      for (const child of doc.groups) {
        if (!child.parent) continue;
        const p = doc.groups.find((g) => g.id === child.parent);
        if (!p) continue;
        const inside =
          child.rect[0] >= p.rect[0] &&
          child.rect[1] >= p.rect[1] &&
          child.rect[0] + child.rect[2] <= p.rect[0] + p.rect[2] &&
          child.rect[1] + child.rect[3] <= p.rect[1] + p.rect[3];
        if (!inside) return false;
      }
    }
    return true;
  })());

  check('sibling zones do not overlap after auto layout', (() => {
    const doc = normalizeDoc(THREE_TIER).doc;
    autoLayout(doc, { rot: 0 });
    const siblings = doc.groups.filter((g) => g.parent === 'prod-vpc');
    for (let i = 0; i < siblings.length; i++) {
      for (let j = i + 1; j < siblings.length; j++) {
        const a = siblings[i].rect;
        const b = siblings[j].rect;
        if (a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]) {
          return false;
        }
      }
    }
    return true;
  })());

  check('arranging never puts anything off the integer grid', (() => {
    // Caption boxes have fractional edges; none of that may reach the document.
    for (const fn of [tidy, autoLayout]) {
      for (const rot of [0, 1, 2, 3]) {
        const doc = normalizeDoc(THREE_TIER).doc;
        fn(doc, { rot });
        const whole = (v) => Number.isInteger(v);
        if (!doc.nodes.every((n) => n.pos.every(whole))) return false;
        if (!doc.groups.every((g) => g.rect.every(whole))) return false;
      }
    }
    return true;
  })());

  check('arranging leaves the document loadable and round-trippable', (() => {
    const doc = normalizeDoc(THREE_TIER).doc;
    autoLayout(doc, { rot: 0 });
    const text = serializeDoc(doc);
    const again = parseDoc(text);
    return again.warnings.length === 0 && serializeDoc(again.doc) === text;
  })());

  check('arranging an empty diagram is a no-op, not a crash', (() => {
    const doc = normalizeDoc({}).doc;
    return tidy(doc, { rot: 0 }) === 0 && autoLayout(doc, { rot: 0 }) === 0;
  })());

  check('a cyclic connection graph still terminates', (() => {
    const doc = normalizeDoc({
      nodes: [
        { id: 'a', type: 'ec2', pos: [0, 0] },
        { id: 'b', type: 'ec2', pos: [4, 0] },
        { id: 'c', type: 'ec2', pos: [8, 0] },
      ],
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }],
    }).doc;
    autoLayout(doc, { rot: 0 });
    return doc.nodes.every((n) => Number.isFinite(n.pos[0]) && Number.isFinite(n.pos[1]));
  })());
}

function edgeCases(check) {
  const build = (edges) => normalizeDoc({
    groups: [
      { id: 'vpc', kind: 'vpc', rect: [10, 0, 8, 8] },
      { id: 'lan', kind: 'lan', rect: [10, 12, 8, 6] },
    ],
    nodes: [
      { id: 'api', type: 'ec2', pos: [0, 0], size: [2, 2] },
      { id: 'db', type: 'rds', pos: [0, 12], size: [2, 2] },
    ],
    edges,
  });

  // --- what a connection may attach to --------------------------------------

  check('a connection can hang off a zone at either end', (() => {
    const { doc, warnings } = build([
      { id: 'n2n', from: 'api', to: 'db' },
      { id: 'n2z', from: 'api', to: 'vpc' },
      { id: 'z2n', from: 'vpc', to: 'db' },
      { id: 'z2z', from: 'vpc', to: 'lan' },
    ]);
    return doc.edges.length === 4 && warnings.length === 0 &&
      doc.edges.every((e) => edgeRoute(doc, e) !== null);
  })());

  check('an endpoint that is neither a block nor a zone is still dropped', (() => {
    const { doc, warnings } = build([{ from: 'api', to: 'nowhere' }]);
    return doc.edges.length === 0 && warnings.length === 1;
  })());

  check('a zone connection survives a save and a reload', (() => {
    const doc = build([{ id: 'z2z', from: 'vpc', to: 'lan', label: 'peering' }]).doc;
    const saved = serializeDoc(doc);
    const back = parseDoc(saved);
    return back.warnings.length === 0 && back.doc.edges[0].from === 'vpc' &&
      back.doc.edges[0].to === 'lan' && serializeDoc(back.doc) === saved;
  })());

  // --- the route, and the one number a drag writes --------------------------

  const pathOf = (doc, edge) => edgeRoute(doc, edge).points.map((p) => `${p.x},${p.y}`).join(' ');

  check('an untouched connection routes exactly as it always did', (() => {
    // The three-segment path collapses to the plain elbow at the default
    // crossover, so adding a bend parameter changed no existing drawing.
    const doc = build([{ id: 'e', from: 'api', to: 'db' }]).doc;
    const route = edgeRoute(doc, doc.edges[0]);
    // api centre (1,1) -> db centre (1,13): they line up on x, so it is a
    // straight run and there is nothing to turn.
    return route.points.length === 2 && route.axis === 'y';
  })());

  check('a bend moves the run it names, and nothing else', (() => {
    const doc = build([{ id: 'e', from: 'api', to: 'vpc' }]).doc;
    const edge = doc.edges[0];
    const before = pathOf(doc, edge);
    edge.route = 'x';
    edge.bend = 6;
    const after = pathOf(doc, edge);
    const route = edgeRoute(doc, edge);
    // Every corner sits on the crossover, and the ends are where they were.
    return after !== before &&
      route.points.some((p) => near(p.x, 6, 1e-9)) &&
      near(route.points[0].y, 1, 1e-9);
  })());

  check('the grip always sits on the line as drawn', (() => {
    const doc = build([
      { id: 'a', from: 'api', to: 'vpc' },
      { id: 'b', from: 'vpc', to: 'lan' },
      { id: 'c', from: 'api', to: 'db' },
    ]).doc;
    const onSegment = (p, q, g) => {
      const cross = (q.x - p.x) * (g.y - p.y) - (q.y - p.y) * (g.x - p.x);
      if (Math.abs(cross) > 1e-6) return false;
      const dot = (g.x - p.x) * (q.x - p.x) + (g.y - p.y) * (q.y - p.y);
      const len = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
      return dot >= -1e-6 && dot <= len + 1e-6;
    };
    for (const edge of doc.edges) {
      for (const bend of [null, 4, 7, 20]) {
        edge.route = bend === null ? 'auto' : 'x';
        edge.bend = bend;
        const r = edgeRoute(doc, edge);
        let hit = false;
        for (let i = 1; i < r.points.length; i++) {
          if (onSegment(r.points[i - 1], r.points[i], r.grip)) hit = true;
        }
        if (!hit) return false;
      }
    }
    return true;
  })());

  check('two ends that line up offer the axis that can actually bend them', (() => {
    const doc = build([
      { id: 'v', from: 'api', to: 'db' }, // same x: a vertical run
      { id: 'd', from: 'api', to: 'vpc' }, // neither: a real elbow
    ]).doc;
    const [vertical, diagonal] = doc.edges.map((e) => edgeRoute(doc, e));
    return vertical.axis === 'y' && vertical.dragAxis === 'x' &&
      diagonal.dragAxis === diagonal.axis;
  })());

  check('dragging a straight connection bends it into a detour', (() => {
    const doc = build([{ id: 'e', from: 'api', to: 'db' }]).doc;
    const edge = doc.edges[0];
    const straight = edgeRoute(doc, edge);
    edge.route = straight.dragAxis;
    edge.bend = -6;
    const bent = edgeRoute(doc, edge);
    return straight.points.length === 2 && bent.points.length === 4 &&
      bent.points.some((p) => near(p.x, -6, 1e-9));
  })());

  check('a route that is automatic never carries a stale crossover', (() => {
    const doc = normalizeDoc({
      nodes: [{ id: 'a', type: 'ec2', pos: [0, 0] }, { id: 'b', type: 'rds', pos: [8, 6] }],
      edges: [{ from: 'a', to: 'b', bend: 3 }], // no route: bend means nothing
    }).doc;
    return doc.edges[0].route === 'auto' && doc.edges[0].bend === null &&
      !serializeDoc(doc).includes('bend');
  })());

  check('a dragged crossover round-trips on the half-cell grid', (() => {
    const doc = build([{ id: 'e', from: 'api', to: 'vpc', route: 'x', bend: 6.37 }]).doc;
    const saved = serializeDoc(doc);
    return doc.edges[0].bend === 6.5 && parseDoc(saved).doc.edges[0].bend === 6.5 &&
      serializeDoc(parseDoc(saved).doc) === saved;
  })());

  check('auto layout ignores connections that touch a zone', (() => {
    // Ranking is about blocks; a zone has no rank, and feeding one in would
    // put an undefined into the arithmetic.
    const doc = build([
      { id: 'n2n', from: 'api', to: 'db' },
      { id: 'n2z', from: 'api', to: 'vpc' },
    ]).doc;
    autoLayout(doc, { rot: 0 });
    return doc.nodes.every((n) => Number.isFinite(n.pos[0]) && Number.isFinite(n.pos[1]));
  })());
}

function handleCases(check) {
  const doc = normalizeDoc({
    nodes: [{ id: 'a', type: 'ec2', pos: [2, 3], size: [4, 5], height: 2 }],
    groups: [{ id: 'z', kind: 'vpc', rect: [0, 0, 10, 10] }],
    images: [{ id: 'pic', src: 'x.png', pos: [0, 0], size: [8, 6] }],
  }).doc;
  const camAt = (over = {}) => ({ ...createCamera(), ...over });
  const state = (over = {}) => ({
    doc,
    camera: createCamera(),
    selection: ['a'],
    tool: 'select',
    pendingType: null,
    ...over,
  });

  check(
    'grips are offered for exactly one selected entity, with the select tool',
    handlesFor(state()).length > 0 &&
      handlesFor(state({ selection: [] })).length === 0 &&
      handlesFor(state({ selection: ['a', 'z'] })).length === 0 &&
      handlesFor(state({ tool: 'connect' })).length === 0 &&
      handlesFor(state({ pendingType: 'ec2' })).length === 0
  );

  check('every corner grip sits on a corner of the block it resizes', (() => {
    // Rotation reorders the corners, so the assertion is that the four corner
    // grips land on the four corners -- not on any particular one of them.
    for (let rot = 0; rot < 4; rot++) {
      const camera = camAt({ rot });
      const grips = handlesFor(state({ camera })).filter((g) => g.role === 'size');
      const corners = [[2, 3], [6, 3], [6, 8], [2, 8]].map(([x, y]) =>
        gridToScreen(camera, x, y, 2)
      );
      const hits = grips.filter((g) =>
        corners.some((c) => near(c.x, g.x, 0.01) && near(c.y, g.y, 0.01))
      );
      if (hits.length !== 4) return false;
    }
    return true;
  })());

  check('grips sit on the top face, not on the ground under it', (() => {
    const raised = handlesFor(state()).find((g) => g.role === 'size');
    const ground = gridToScreen(createCamera(), 2, 3, 0);
    // The block is two cells tall, so its top face is two cells up the screen.
    return raised && !near(raised.y, ground.y, 1) && raised.y < ground.y;
  })());

  check('height is grippable in 3D, where there is a height to see', (() => {
    const iso = handlesFor(state()).filter((g) => g.role === 'height');
    const flat = handlesFor(state({ camera: camAt({ mode: 'flat' }) })).filter(
      (g) => g.role === 'height'
    );
    return iso.length === 1 && flat.length === 0;
  })());

  check('the height grip stays clear of the grips already on the block', (() => {
    // A fixed lift off the centre of the top face lands on the back corner as
    // soon as the block is small, which is exactly when it matters.
    for (const zoom of [0.2, 0.3, 0.6, 1, 2]) {
      const grips = handlesFor(state({ camera: camAt({ zoom }) }));
      const height = grips.find((g) => g.role === 'height');
      if (!height) return false;
      const crowded = grips.some(
        (g) => g !== height && Math.hypot(g.x - height.x, g.y - height.y) < 14
      );
      if (crowded) return false;
    }
    return true;
  })());

  check('a shape too small on screen sheds its grips rather than burying itself', (() => {
    const roomy = handlesFor(state()); // 4 corners + 4 edges + height
    const cramped = handlesFor(state({ camera: camAt({ zoom: 0.2 }) })); // corners + height
    const tiny = handlesFor(state({ camera: camAt({ zoom: 0.05 }) }));
    return roomy.length === 9 && cramped.length === 5 && tiny.length === 0;
  })());

  check('a zone is gripped on the ground', (() => {
    const grips = handlesFor(state({ selection: ['z'] }));
    const corner = gridToScreen(createCamera(), 0, 0, 0);
    return (
      grips.length === 8 &&
      grips.every((g) => g.role === 'size') &&
      grips.some((g) => near(g.x, corner.x, 0.01) && near(g.y, corner.y, 0.01))
    );
  })());

  check('a picture is gripped only on the edges that grow it', (() => {
    const grips = handlesFor(state({ selection: ['pic'] }));
    return grips.length === 3 && grips.every((g) => g.ax === 1 || g.ay === 1);
  })());

  // --- the rectangle a drag produces ---------------------------------------

  const start = { x: 2, y: 3, w: 4, h: 5 };
  const same = (r) => r.x === start.x && r.y === start.y && r.w === start.w && r.h === start.h;

  check('dropping a grip back where it was changes nothing', (() =>
    [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]].every(([ax, ay]) =>
      same(resizeFootprint(start, ax, ay, { x: start.x + ax * start.w, y: start.y + ay * start.h }))
    ))());

  check('a grip moves its own edge and leaves the opposite one', (() => {
    const grown = resizeFootprint(start, 0, 0, { x: -1, y: 0 });
    return grown.x === -1 && grown.x + grown.w === 6 && grown.y === 0 && grown.y + grown.h === 8;
  })());

  check('an edge grip leaves the other axis alone', (() => {
    const wider = resizeFootprint(start, 1, 0.5, { x: 20, y: 20 });
    return wider.w === 18 && wider.y === 3 && wider.h === 5;
  })());

  check('a resize never turns a shape inside out', (() => {
    const crushed = resizeFootprint(start, 1, 1, { x: -20, y: -20 });
    const pushed = resizeFootprint(start, 0, 0, { x: 99, y: 99 });
    return (
      crushed.w === 1 && crushed.h === 1 && crushed.x === 2 && crushed.y === 3 &&
      pushed.w === 1 && pushed.h === 1 && pushed.x === 5 && pushed.y === 7
    );
  })());

  check('a resize reads the same at every camera rotation', (() => {
    // Pulling the far grip two and three cells further out has to grow the
    // block by two and three cells whichever way the camera is facing -- along
    // whichever document axis this rotation happens to have put them.
    const rect = [2, 3, 4, 5];
    for (let rot = 0; rot < 4; rot++) {
      const r = rotateRect(rect[0], rect[1], rect[2], rect[3], rot);
      const next = resizeFootprint(r, 1, 1, { x: r.x + r.w + 2, y: r.y + r.h + 3 });
      const back = rotateRect(next.x, next.y, next.w, next.h, -rot);
      const grew = [back.w - rect[2], back.h - rect[3]].sort((a, b) => a - b);
      if (grew[0] !== 2 || grew[1] !== 3) return false;
      // Growing outwards can only ever add to the original footprint.
      if (back.x > rect[0] || back.y > rect[1]) return false;
      if (back.x + back.w < rect[0] + rect[2]) return false;
      if (back.y + back.h < rect[1] + rect[3]) return false;
    }
    return true;
  })());
}

/**
 * A GIF decoder, for the tests only.
 *
 * The encoder is hand-written because no browser will make a GIF, so nothing
 * else in the pipeline would notice if it produced a plausible-looking file
 * that decodes to the wrong picture. Reading it back is the only way to know.
 */
function decodeGif(bytes) {
  let p = 0;
  const u8 = () => bytes[p++];
  const u16 = () => {
    const v = bytes[p] | (bytes[p + 1] << 8);
    p += 2;
    return v;
  };

  const magic = String.fromCharCode(...bytes.slice(0, 6));
  p = 6;
  const width = u16();
  const height = u16();
  const packed = u8();
  u8(); // background index
  u8(); // aspect ratio
  const palette = [];
  if (packed & 0x80) {
    const size = 1 << ((packed & 7) + 1);
    for (let i = 0; i < size; i++) palette.push([u8(), u8(), u8()]);
  }
  while (bytes[p] === 0x21) {
    p += 2;
    while (bytes[p]) p += bytes[p] + 1;
    p++;
  }
  if (u8() !== 0x2c) throw new Error('no image descriptor');
  u16();
  u16();
  const iw = u16();
  const ih = u16();
  u8(); // local flags
  const minCodeSize = u8();

  const data = [];
  for (;;) {
    const n = u8();
    if (!n) break;
    for (let i = 0; i < n; i++) data.push(u8());
  }

  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let dict = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < clear; i++) dict.push([i]);
    dict.push(null, null); // clear and EOI hold no string
    codeSize = minCodeSize + 1;
  };
  reset();

  let acc = 0;
  let bits = 0;
  let at = 0;
  const nextCode = () => {
    while (bits < codeSize) {
      if (at >= data.length) return eoi;
      acc |= data[at++] << bits;
      bits += 8;
    }
    const code = acc & ((1 << codeSize) - 1);
    acc >>>= codeSize;
    bits -= codeSize;
    return code;
  };

  const indices = [];
  let previous = null;
  for (;;) {
    const code = nextCode();
    if (code === eoi) break;
    if (code === clear) {
      reset();
      previous = null;
      continue;
    }
    let entry;
    if (code < dict.length && dict[code]) entry = dict[code];
    else if (previous) entry = [...previous, previous[0]];
    else throw new Error(`undecodable code ${code}`);
    indices.push(...entry);
    if (previous) {
      dict.push([...previous, entry[0]]);
      // Grow *after* adding, not before. A decoder learns each code one step
      // later than the encoder assigned it, and this is the offset that puts
      // the two back on the same beat -- get it wrong and the bit stream
      // desynchronises a few codes in, which reads as plausible garbage.
      if (dict.length >= 1 << codeSize && codeSize < 12) codeSize++;
    }
    previous = entry;
  }

  return { magic, width, height, iw, ih, palette, indices, trailer: bytes.at(-1) };
}

function gifCases(check) {
  /** An image of `colours`, laid out in vertical bands with a noisy column. */
  const image = (width, height, colours) => {
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const c = colours[(x + y * 7) % colours.length];
        const i = (y * width + x) * 4;
        rgba[i] = c[0];
        rgba[i + 1] = c[1];
        rgba[i + 2] = c[2];
        rgba[i + 3] = 255;
      }
    }
    return rgba;
  };

  const FLAT = [[237, 113, 0], [37, 99, 235], [255, 255, 255], [15, 23, 42], [22, 163, 74]];

  check('a GIF is a GIF89a with a trailer on the end', (() => {
    const bytes = encodeGif(image(16, 9, FLAT), 16, 9);
    const gif = decodeGif(bytes);
    return gif.magic === 'GIF89a' && gif.trailer === 0x3b &&
      gif.width === 16 && gif.height === 9 && gif.iw === 16 && gif.ih === 9;
  })());

  check('a few flat colours survive the round trip exactly', (() => {
    const [w, h] = [40, 24];
    const rgba = image(w, h, FLAT);
    const gif = decodeGif(encodeGif(rgba, w, h));
    if (gif.indices.length !== w * h) return false;
    for (let i = 0; i < w * h; i++) {
      const want = [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]];
      const got = gif.palette[gif.indices[i]];
      if (want.some((v, c) => v !== got[c])) return false;
    }
    return true;
  })());

  check('more colours than the palette holds still come back close', (() => {
    // 2000 distinct colours through a 256-entry table: the point is that the
    // picture survives, not that it is identical.
    const many = Array.from({ length: 2000 }, (_, i) => [
      (i * 37) % 256, (i * 91) % 256, (i * 173) % 256,
    ]);
    const [w, h] = [64, 48];
    const rgba = image(w, h, many);
    const gif = decodeGif(encodeGif(rgba, w, h));
    if (gif.indices.length !== w * h) return false;
    if (gif.palette.length > 256) return false;
    let worst = 0;
    for (let i = 0; i < w * h; i++) {
      const got = gif.palette[gif.indices[i]];
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(rgba[i * 4 + c] - got[c]));
    }
    // A 5-bit histogram bounds the error at 8 per channel before median cut
    // has to choose at all; anything much past that means the mapping is wrong.
    return worst <= 24;
  })());

  check('a single-colour image is still a legal file', (() => {
    const [w, h] = [8, 8];
    const rgba = image(w, h, [[10, 20, 30]]);
    const gif = decodeGif(encodeGif(rgba, w, h));
    return gif.palette.length >= 2 && gif.indices.length === w * h &&
      gif.indices.every((i) => i === gif.indices[0]) &&
      gif.palette[gif.indices[0]].join() === '10,20,30';
  })());

  check('an image long enough to fill the code table keeps decoding', (() => {
    // Enough varied data to force the LZW table past 4096 and reset, which is
    // where a width that grows on the wrong beat stops being decodable.
    const noisy = Array.from({ length: 240 }, (_, i) => [i, (i * 13) % 256, (i * 29) % 256]);
    const [w, h] = [200, 150];
    const rgba = image(w, h, noisy);
    const gif = decodeGif(encodeGif(rgba, w, h));
    return gif.indices.length === w * h;
  })());

  check('a GIF too large to describe is refused rather than truncated', (() => {
    try {
      encodeGif(new Uint8ClampedArray(4), 70000, 1);
      return false;
    } catch (err) {
      return /65535/.test(err.message);
    }
  })());
}

function tooltipCases(check) {
  const at = (text) => {
    const t = splitTitle(text);
    return `${t.head}|${t.key ?? ''}|${t.body}`;
  };

  check('a name, a shortcut and an explanation come apart', () => true &&
    at('Tidy (A) — nudge blocks apart until nothing is hidden') ===
      'Tidy|A|nudge blocks apart until nothing is hidden');

  check('a shortcut with no explanation still reads as a shortcut',
    at('Open… (Ctrl+O)') === 'Open…|Ctrl+O|');

  check('a plain title stays whole', at('Copy diagram JSON to clipboard') ===
    'Copy diagram JSON to clipboard||');

  check('an explanation with no shortcut keeps its em dash intact',
    at('Copy a shareable link — the whole diagram travels inside the URL') ===
      'Copy a shareable link||the whole diagram travels inside the URL');

  check('an aside in brackets is not mistaken for a key', (() =>
    // The one case that tells the two apart: a shortcut has no spaces.
    at('Source on GitHub (opens in a new tab)') === 'Source on GitHub (opens in a new tab)||')());

  check('punctuation keys survive', at('Show or hide the component panel ([)') ===
    'Show or hide the component panel|[|');

  check('a second em dash belongs to the explanation, not to the split',
    at('Pan tool (H) — Space + drag — from any tool') ===
      'Pan tool|H|Space + drag — from any tool');

  check('every toolbar title this app writes parses to something usable', (() => {
    // Titles the toolbar actually sets, so a reworded button cannot quietly
    // start rendering its shortcut as part of the name.
    const titles = [
      ['New diagram (Ctrl+N)', 'New diagram', 'Ctrl+N'],
      ['Save (Ctrl+S)', 'Save', 'Ctrl+S'],
      ['Reload demo.arch.json from disk (R) — picks up edits made outside this page',
        'Reload demo.arch.json from disk', 'R'],
      ['Export an image (Ctrl+E) — format, projection, grid and size', 'Export an image', 'Ctrl+E'],
      ['Auto layout (Shift+A) — re-flow the diagram from its connections', 'Auto layout', 'Shift+A'],
      ['Toggle 2D / 3D (2)', 'Toggle 2D / 3D', '2'],
      ['Zoom out (-)', 'Zoom out', '-'],
      ['Keyboard shortcuts', 'Keyboard shortcuts', null],
    ];
    return titles.every(([text, head, key]) => {
      const t = splitTitle(text);
      return t.head === head && t.key === key;
    });
  })());
}

function boxesOverlapLocal(a, b) {
  return a.pos[0] < b.pos[0] + b.size[0] && b.pos[0] < a.pos[0] + a.size[0] &&
    a.pos[1] < b.pos[1] + b.size[1] && b.pos[1] < a.pos[1] + a.size[1];
}

/** Pull the six numbers out of an SVG `matrix(...)` transform. */
function matrixOf(transform) {
  const m = /matrix\(([^)]+)\)/.exec(transform);
  return m ? m[1].split(',').map(Number) : null;
}

function planarCases(check) {
  const at = (plane, spin = 0) =>
    planeTransform(isoProjection, 0, { pos: [0, 0], z: 0, plane, spin });

  check('every plane produces a usable matrix', PLANES.every((p) => matrixOf(at(p))?.length === 6));

  check('the screen plane is the identity', (() => {
    const [a, b, c, d] = matrixOf(at('screen'));
    return a === 1 && b === 0 && c === 0 && d === 1;
  })());

  check('the floor plane is the isometric ground', (() => {
    const [a, b, c, d] = matrixOf(at('floor'));
    // u runs along +x (right and down), v along +y (left and down).
    return a > 0 && b > 0 && c < 0 && d > 0 && near(a, -c, 1e-6) && near(b, d, 1e-6);
  })());

  check('wall planes have a vertical second axis', (() => {
    for (const plane of ['right', 'left']) {
      const [, , c, d] = matrixOf(at(plane));
      if (!near(c, 0, 1e-6) || !near(d, 1, 1e-6)) return false; // v points straight down
    }
    return true;
  })());

  check('no plane mirrors its content, at any camera rotation', (() => {
    // A negative determinant flips the plane, which renders text backwards.
    for (let rot = 0; rot < 4; rot++) {
      for (const plane of PLANES) {
        const [a, b, c, d] = matrixOf(planeTransform(isoProjection, rot, { pos: [0, 0], plane }));
        if (a * d - b * c <= 0) return false;
      }
    }
    return true;
  })());

  check('the two walls are distinct planes', (() => {
    const right = matrixOf(at('right')).slice(0, 4).join();
    const left = matrixOf(at('left')).slice(0, 4).join();
    return right !== left;
  })());

  check('both walls read left-to-right on screen', (() => {
    // u must carry content rightwards, or the text runs backwards visually.
    return matrixOf(at('right'))[0] > 0 && matrixOf(at('left'))[0] > 0;
  })());

  check('the readability flip never moves an element off its anchor', (() => {
    // Correcting a back-facing wall mirrors the content about its own centre.
    // That must leave the rectangle exactly where it was, which shows up as
    // the anchor still coinciding with one of its four corners.
    const w = 160;
    const h = 120;
    for (const plane of ['right', 'left', 'floor']) {
      for (let rot = 0; rot < 4; rot++) {
        const t = planeTransform(isoProjection, rot, { pos: [3, -2], plane }, [w / 2, h / 2]);
        const [a, b, c, d, e, f] = matrixOf(t);
        const corners = [[0, 0], [w, 0], [w, h], [0, h]]
          .map(([x, y]) => [e + a * x + c * y, f + b * x + d * y]);

        const r = rotatePoint(3, -2, rot);
        const anchor = isoProjection.project(r.x, r.y, 0);
        // The matrix translation is rounded to the hundredth of a pixel on
        // purpose, so the tolerance has to allow for that -- not 1e-6.
        const hit = corners.some(
          ([x, y]) => near(x, anchor.x, 0.02) && near(y, anchor.y, 0.02)
        );
        if (!hit) return false;
      }
    }
    return true;
  })());

  check('a unit along any plane axis is one screen pixel', (() => {
    for (const plane of PLANES) {
      const [a, b, c, d] = matrixOf(at(plane));
      if (!near(Math.hypot(a, b), 1, 1e-6)) return false;
      if (!near(Math.hypot(c, d), 1, 1e-6)) return false;
    }
    return true;
  })());

  check('rotating the camera rotates world planes but not the screen plane', (() => {
    const screen = new Set();
    const floor = new Set();
    for (let rot = 0; rot < 4; rot++) {
      screen.add(matrixOf(planeTransform(isoProjection, rot, { pos: [0, 0], plane: 'screen' })).join());
      floor.add(matrixOf(planeTransform(isoProjection, rot, { pos: [0, 0], plane: 'floor' })).join());
    }
    return screen.size === 1 && floor.size === 4;
  })());

  check('a spin is emitted as a rotation about the given centre', (() => {
    const t = planeTransform(isoProjection, 0, { pos: [0, 0], plane: 'floor', spin: 90 }, [10, 20]);
    return /rotate\(90 10 20\)/.test(t);
  })());

  check('spins normalise into 0-359', (() => {
    return normaliseSpin(-90) === 270 && normaliseSpin(450) === 90 && normaliseSpin('180') === 180;
  })());

  check('walls fall back to facing the viewer in 2D, but the floor does not', (() => {
    return effectivePlane('right', flatProjection) === 'screen' &&
      effectivePlane('left', flatProjection) === 'screen' &&
      effectivePlane('floor', flatProjection) === 'floor' &&
      effectivePlane('right', isoProjection) === 'right';
  })());

  check('plane axes reproduce the very matrix the renderer emits', (() => {
    // Grips are placed from `planeAxes` and pictures are drawn from
    // `planeTransform`. If those two ever disagree, a grip sits somewhere the
    // picture's corner is not -- so they are checked against each other for
    // every plane, spin and camera angle, with the spin folded in by hand.
    const w = 240;
    const h = 160;
    for (const plane of PLANES) {
      for (const spin of [0, 90, 180, 270]) {
        for (let rot = 0; rot < 4; rot++) {
          const el = { pos: [3, -2], z: 1, plane, spin };
          const axes = planeAxes(isoProjection, rot, el, [w / 2, h / 2]);
          const [a, b, c, d, e, f] = matrixOf(
            planeTransform(isoProjection, rot, el, [w / 2, h / 2])
          );
          const rad = (spin * Math.PI) / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          for (const [lx, ly] of [[0, 0], [w, 0], [0, h], [w, h]]) {
            // rotate(spin cx cy), applied in the element's own pixel space.
            const px = w / 2 + (lx - w / 2) * cos - (ly - h / 2) * sin;
            const py = h / 2 + (lx - w / 2) * sin + (ly - h / 2) * cos;
            const wanted = { x: e + a * px + c * py, y: f + b * px + d * py };
            const got = {
              x: axes.origin.x + axes.u.x * lx + axes.v.x * ly,
              y: axes.origin.y + axes.u.y * lx + axes.v.y * ly,
            };
            if (!near(wanted.x, got.x, 1e-6) || !near(wanted.y, got.y, 1e-6)) return false;
          }
        }
      }
    }
    return true;
  })());

  check('a plane vector inverts the axes it was measured against', (() => {
    for (const plane of PLANES) {
      for (let rot = 0; rot < 4; rot++) {
        const axes = planeAxes(isoProjection, rot, { pos: [0, 0], plane, spin: 90 });
        for (const [lx, ly] of [[12, 0], [0, -7], [30, 45]]) {
          const scene = {
            x: axes.u.x * lx + axes.v.x * ly,
            y: axes.u.y * lx + axes.v.y * ly,
          };
          const back = planeVector(axes, scene.x, scene.y);
          if (!near(back.x, lx, 1e-6) || !near(back.y, ly, 1e-6)) return false;
        }
      }
    }
    return true;
  })());

  check('elevation lifts a plane straight up the screen', (() => {
    const ground = matrixOf(planeTransform(isoProjection, 0, { pos: [3, 3], z: 0, plane: 'floor' }));
    const raised = matrixOf(planeTransform(isoProjection, 0, { pos: [3, 3], z: 2, plane: 'floor' }));
    return near(ground[4], raised[4], 1e-6) && raised[5] < ground[5];
  })());

  // --- documents -----------------------------------------------------------

  const doc = normalizeDoc({
    images: [
      { id: 'logo', src: 'data:image/png;base64,AAAA', pos: [2, 3], size: [8, 5], plane: 'right', spin: 90 },
      { id: 'bad', pos: [0, 0] },
      { id: 'wild', src: 'x.png', plane: 'sideways', spin: 45, opacity: 9, z: -3 },
    ],
    texts: [{ id: 'note', text: 'hi', pos: [0, 0], plane: 'floor', spin: 180 }],
  });

  check('images load with their placement', (() => {
    const logo = doc.doc.images.find((i) => i.id === 'logo');
    return logo?.plane === 'right' && logo.spin === 90 && logo.size[0] === 8;
  })());

  check('an image with no src is dropped and reported', (() =>
    !doc.doc.images.some((i) => i.id === 'bad') &&
    doc.warnings.some((w) => w.includes('no src')))());

  check('nonsense placement falls back to the defaults', (() => {
    const wild = doc.doc.images.find((i) => i.id === 'wild');
    return wild.plane === 'floor' && wild.spin === 0 && wild.opacity === 1 && wild.z === 0;
  })());

  check('flat content defaults to lying on the ground', (() => {
    const d = normalizeDoc({
      nodes: [{ id: 'n', type: 'ec2', pos: [0, 0] }],
      texts: [{ id: 't', text: 'hi', pos: [0, 0] }],
      images: [{ id: 'i', src: 'a.png', pos: [0, 0] }],
    }).doc;
    return d.nodes[0].labelPlane === 'floor' && d.texts[0].plane === 'floor' &&
      d.images[0].plane === 'floor';
  })());

  check('a zone caption stands on the right wall by default', (() => {
    const d = normalizeDoc({ groups: [{ id: 'g', kind: 'vpc', rect: [0, 0, 6, 6] }] }).doc;
    // A zone is large and usually full, so a caption written flat inside it
    // would compete with its own contents.
    return d.groups[0].labelPlane === 'right';
  })());

  check('captions carry their own size, defaulting to 12', (() => {
    const d = normalizeDoc({
      nodes: [{ id: 'n', type: 'ec2', pos: [0, 0] }, { id: 'b', type: 'ec2', pos: [4, 0], labelSize: 28 }],
      groups: [{ id: 'g', kind: 'vpc', rect: [0, 0, 6, 6], labelSize: 40 }],
    }).doc;
    return d.nodes[0].labelSize === 12 && d.nodes[1].labelSize === 28 &&
      d.groups[0].labelSize === 40;
  })());

  check('an out-of-range caption size is clamped', (() => {
    const d = normalizeDoc({
      nodes: [{ id: 'n', type: 'ec2', pos: [0, 0], labelSize: 9999 }],
      groups: [{ id: 'g', kind: 'vpc', rect: [0, 0, 6, 6], labelSize: -4 }],
    }).doc;
    return d.nodes[0].labelSize === 96 && d.groups[0].labelSize === 6;
  })());

  check('a default caption size is not written to the file', (() => {
    const d = normalizeDoc({
      nodes: [{ id: 'n', type: 'ec2', pos: [0, 0] }],
      groups: [{ id: 'g', kind: 'vpc', rect: [0, 0, 6, 6] }],
    }).doc;
    return !serializeDoc(d).includes('"labelSize"');
  })());

  check('captions accept a plane, and reject nonsense', (() => {
    const d = normalizeDoc({
      nodes: [{ id: 'n', type: 'ec2', pos: [0, 0], labelPlane: 'right' }],
      groups: [
        { id: 'g', kind: 'vpc', rect: [0, 0, 6, 6], labelPlane: 'floor' },
        { id: 'h', kind: 'vpc', rect: [0, 0, 6, 6], labelPlane: 'sideways' },
      ],
    }).doc;
    return d.nodes[0].labelPlane === 'right' && d.groups[0].labelPlane === 'floor' &&
      d.groups[1].labelPlane === 'right';
  })());

  check('a default caption plane is not written to the file', (() => {
    const d = normalizeDoc({
      nodes: [{ id: 'n', type: 'ec2', pos: [0, 0] }],
      groups: [{ id: 'g', kind: 'vpc', rect: [0, 0, 6, 6] }],
    }).doc;
    return !serializeDoc(d).includes('"labelPlane"');
  })());

  check('a connection caption carries a plane and a size, defaulting to floor/12', (() => {
    const d = normalizeDoc({
      nodes: [{ id: 'a', type: 'ec2', pos: [0, 0] }, { id: 'b', type: 'ec2', pos: [6, 0] }],
      edges: [
        { id: 'plain', from: 'a', to: 'b', label: '443' },
        { id: 'dressed', from: 'a', to: 'b', label: '5432', labelPlane: 'screen', labelSize: 20 },
        { id: 'wild', from: 'a', to: 'b', label: 'x', labelPlane: 'sideways', labelSize: 9999 },
      ],
    }).doc;
    const [plain, dressed, wild] = d.edges;
    return plain.labelPlane === 'floor' && plain.labelSize === 12 &&
      dressed.labelPlane === 'screen' && dressed.labelSize === 20 &&
      wild.labelPlane === 'floor' && wild.labelSize === 96;
  })());

  check('a connection writes its caption fields only when they differ', (() => {
    const nodes = [{ id: 'a', type: 'ec2', pos: [0, 0] }, { id: 'b', type: 'ec2', pos: [6, 0] }];
    const plain = serializeDoc(normalizeDoc({
      nodes,
      edges: [{ from: 'a', to: 'b', label: '443' }],
    }).doc);
    const dressed = serializeDoc(normalizeDoc({
      nodes,
      edges: [{ from: 'a', to: 'b', label: '443', labelPlane: 'right', labelSize: 18 }],
    }).doc);
    return !plain.includes('"labelPlane"') && !plain.includes('"labelSize"') &&
      dressed.includes('"labelPlane": "right"') && dressed.includes('"labelSize": 18');
  })());

  check('caption planes survive a round-trip', (() => {
    const d = normalizeDoc({
      nodes: [{ id: 'n', type: 'ec2', pos: [0, 0], labelPlane: 'left' }],
      groups: [{ id: 'g', kind: 'vpc', rect: [0, 0, 6, 6], labelPlane: 'floor' }],
    }).doc;
    const once = serializeDoc(d);
    return once === serializeDoc(parseDoc(once).doc) &&
      once.includes('"labelPlane": "left"') && once.includes('"labelPlane": "floor"');
  })());

  check('facing the viewer is still reachable, just not the default', (() => {
    const d = normalizeDoc({ texts: [{ id: 'p', text: 'hi', pos: [0, 0], plane: 'screen' }] }).doc;
    const out = serializeDoc(d);
    return d.texts[0].plane === 'screen' && out.includes('"plane": "screen"');
  })());

  check('planar documents round-trip byte-identically', (() => {
    const once = serializeDoc(doc.doc);
    return once === serializeDoc(parseDoc(once).doc);
  })());

  check('default placement is not written to the file', (() => {
    const plain = normalizeDoc({ texts: [{ id: 'p', text: 'hi', pos: [0, 0] }] }).doc;
    const out = serializeDoc(plain);
    return !out.includes('"plane"') && !out.includes('"spin"') && !out.includes('"behind"');
  })());

  check('image ids share the namespace with everything else', (() => {
    const clash = normalizeDoc({
      nodes: [{ id: 'thing', type: 'ec2' }],
      images: [{ id: 'thing', src: 'a.png' }],
    });
    return clash.doc.images[0].id !== 'thing';
  })());

  check('docBounds covers an image footprint', (() => {
    const only = normalizeDoc({ images: [{ id: 'i', src: 'a.png', pos: [10, 10], size: [9, 7] }] }).doc;
    const b = docBounds(only);
    return b.x1 >= 19 && b.y1 >= 17;
  })());
}

function registryCases(check) {
  check('every component type resolves to real icon markup', (() => {
    const missing = COMPONENTS.filter((c) => !iconMarkup(c.icon));
    return missing.length === 0;
  })());

  check('component types are unique', (() => {
    const seen = new Set(COMPONENTS.map((c) => c.type));
    return seen.size === COMPONENTS.length;
  })());

  check('zone kinds are unique', (() => {
    const seen = new Set(GROUP_KINDS.map((k) => k.kind));
    return seen.size === GROUP_KINDS.length;
  })());

  check('every type slugifies to itself, so ids stay predictable', (() =>
    COMPONENTS.every((c) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.type)))());

  check('every registered type actually loads', (() =>
    COMPONENTS.every((c) => {
      if (!isKnownType(c.type)) return false;
      const doc = normalizeDoc({ nodes: [{ id: 'n', type: c.type, pos: [0, 0] }] });
      return doc.doc.nodes[0].type === c.type && doc.warnings.length === 0;
    }))());

  check('every zone kind actually loads', (() =>
    GROUP_KINDS.every((k) => {
      const doc = normalizeDoc({ groups: [{ id: 'g', kind: k.kind, rect: [0, 0, 4, 4] }] });
      return doc.doc.groups[0].kind === k.kind && doc.warnings.length === 0;
    }))());

  check('the generated prompt lists every type', (() => {
    const missing = COMPONENTS.filter((c) => !LLM_PROMPT.includes('`' + c.type + '`'));
    return missing.length === 0;
  })());

  check('the generated prompt lists every zone kind', (() =>
    GROUP_KINDS.every((k) => LLM_PROMPT.includes('`' + k.kind + '`')))());

  check('icon markup is well-formed enough to render', (() => {
    // Not a parser -- just the mistakes that hand-authored SVG actually makes:
    // an unclosed tag, or a path that never starts with a move command.
    for (const c of COMPONENTS) {
      const markup = iconMarkup(c.icon);
      const opens = (markup.match(/</g) ?? []).length;
      const closes = (markup.match(/>/g) ?? []).length;
      if (opens !== closes) return false;
      for (const d of markup.matchAll(/\sd="([^"]*)"/g)) {
        if (!/^[Mm]/.test(d[1].trim())) return false;
      }
    }
    return true;
  })());

  check('the observability and realtime stacks are present', (() => {
    const need = ['prometheus', 'grafana', 'loki', 'alloy', 'node-exporter',
                  'nginx', 'webrtc', 'websocket', 'zeromq', 'stun', 'turn', 'p2p'];
    return need.every((t) => isKnownType(t));
  })());

  check('machine-scale zone kinds exist alongside the cloud ones', (() => {
    const kinds = GROUP_KINDS.map((k) => k.kind);
    return ['host', 'docker-network', 'desktop-machine', 'lan'].every((k) => kinds.includes(k));
  })());

  check('a type keeps its own colour rather than a shared default', (() => {
    const colours = new Set(COMPONENTS.map((c) => c.color));
    return colours.size >= 10 && COMPONENTS.every((c) => /^#[0-9a-f]{6}$/.test(c.color));
  })());
}

function textMetricCases(check) {
  check('a wider caption is estimated wider', (() =>
    estimateLineWidth('AAAAAAAAAA', 12) > estimateLineWidth('AAA', 12))());

  check('estimated width scales with the font size', (() => {
    const small = estimateLineWidth('Payments API', 12);
    const large = estimateLineWidth('Payments API', 24);
    return near(large, small * 2, 1e-9);
  })());

  check('CJK is measured as full-width, Latin as narrower', (() => {
    // Five Hangul syllables must estimate wider than five Latin letters, or
    // Korean labels get too little room reserved on the ground.
    return estimateLineWidth('가나다라마', 12) > estimateLineWidth('abcde', 12);
  })());

  check('a multi-line caption is as wide as its longest line', (() => {
    const box = estimateTextBox('short\na much longer line', 12);
    return near(box.width, estimateLineWidth('a much longer line', 12), 1e-9) && box.lines === 2;
  })());

  check('height grows with the line count', (() => {
    const one = estimateTextBox('a', 12).height;
    const three = estimateTextBox('a\nb\nc', 12).height;
    return near(three, one * 3, 1e-9);
  })());

  check('an empty caption has no width', (() =>
    estimateTextBox('', 12).width === 0 && estimateTextBox(null, 12).width === 0)());
}
