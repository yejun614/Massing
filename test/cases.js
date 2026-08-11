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
import {
  createCamera,
  screenToGrid,
  gridToScreen,
  zoomAt,
  rotate,
  fitToBox,
  lerpCamera,
} from '../src/render/camera.js';
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
  MAX_TAB_NAME,
} from '../src/core/schema.js';
import {
  nodeBox,
  rotatedBox,
  docBounds,
  containingGroup,
  endpointBox,
  canConnect,
  cellsBox,
} from '../src/core/doc.js';
import { tidy, autoLayout, countOccluded } from '../src/core/arrange.js';
import { estimateTextBox, estimateLineWidth, textAnchorFor } from '../src/util/text.js';
import { parseMarkdown } from '../src/util/markdown.js';
import {
  planeTransform,
  planeAxes,
  planeVector,
  effectivePlane,
  PLANES,
  normaliseSpin,
} from '../src/geom/plane.js';
import { handlesFor, resizeFootprint } from '../src/render/handles.js';
import { heightFromDrag, axisStep, entitiesInRect } from '../src/input/pointer.js';
import { SHAPE_KINDS, shapeContains, shapeKindFor, outlinePath } from '../src/data/shapes.js';
import { edgeRoute } from '../src/render/edge.js';
import { encodeGif } from '../src/core/gif.js';
import { splitTitle } from '../src/ui/tooltip.js';
import { COMPONENTS, GROUP_KINDS, componentFor, groupKindFor, isKnownType } from '../src/data/components.js';
import { iconMarkup } from '../src/data/icons.js';
import { LLM_PROMPT, ASSISTANT_PROMPT } from '../src/data/prompt.js';
import { validateDrawing, validateDocument, formatReport } from '../src/core/validate.js';
import { THREE_TIER } from '../src/data/samples.js';
import { overConnected, underDrawn, misplaced, documentInReply } from '../src/core/assistant.js';
import { MODEL_TIERS, DEFAULT_TIER, isTier, modelForTier, tiersPinned } from '../src/data/models.js';
import { clampBox, KEEP_VISIBLE, HANDLE_HEIGHT } from '../src/ui/movable.js';
import { splitTabs, joinTabs, createTabs } from '../src/core/tabs.js';
import { createStore } from '../src/core/store.js';
import {
  createLibrary,
  withinBudget,
  writeLibrary,
  readLibrary,
  MAX_TOTAL_BYTES,
  MAX_ENTRIES,
} from '../src/core/library.js';
import { createEmptyDoc as emptyDoc } from '../src/core/schema.js';
import { readLink, parseLink, resolveLink, describeLink, MAX_LINK } from '../src/core/link.js';
import { entityBox } from '../src/core/doc.js';
import { PLATFORMS, detectPlatform, platformFiles } from '../src/data/downloads.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

/** @param {(name: string, ok: boolean, detail?: string) => void} check */
export function runCases(check) {
  rotationCases(check);
  projectionCases(check);
  cameraCases(check);
  depthCases(check);
  documentCases(check);
  densityCases(check);
  coverageCases(check);
  modelCases(check);
  movableCases(check);
  validateCases(check);
  assistantPromptCases(check);
  heightCases(check);
  axisDragCases(check);
  marqueeCases(check);
  tabCases(check);
  linkCases(check);
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

/*
 * Height is the one measurement on this grid that is not whole cells. Half a
 * cell reads as a deliberate difference; a footprint of 2.3 does not, so
 * everything else stays integral.
 */
/**
 * Dragging a block along one grid axis, which is what Alt asks for.
 *
 * The hysteresis is the half worth testing. Without it the axis is re-decided
 * every frame, and along the diagonal — where the two components are within a
 * hair of each other — a wobble of one pixel swaps it, teleporting the block
 * between two quite different places several times a second.
 */
function axisDragCases(check) {
  const step = (gx, gy, axis = null, locked = true) => axisStep(gx, gy, axis, locked);

  check('a free drag keeps both axes, rounded to cells', (() => {
    const s = step(3.4, -2.6, null, false);
    return s.dx === 3 && s.dy === -3 && s.axis === null;
  })());

  check('a locked drag takes the axis it is mostly along', (() => {
    const along = step(4.2, 0.9);
    const across = step(0.8, -5.1);
    return along.dx === 4 && along.dy === 0 && along.axis === 'x'
      && across.dx === 0 && across.dy === -5 && across.axis === 'y';
  })());

  check('a drag straight down the screen picks the nearer axis', (() => {
    // Screen-vertical is (+x, +y) in equal parts, so it is an exact tie; the
    // answer only has to be the same one every time.
    const a = step(3, 3);
    const b = step(3.0001, 3);
    return a.axis === 'x' && b.axis === 'x' && a.dy === 0;
  })());

  check('nothing is committed before half a cell is asked for', (() => {
    const s = step(0.3, -0.4);
    return s.dx === 0 && s.dy === 0 && s.axis === null;
  })());

  check('an axis already chosen survives a wobble past the diagonal', (() => {
    // Committed to x, then the pointer strays a little the other way.
    const s = step(4, 4.4, 'x');
    return s.axis === 'x' && s.dx === 4 && s.dy === 0;
  })());

  check('and hands over when the other axis clearly wins', (() => {
    const s = step(4, 7, 'x');
    return s.axis === 'y' && s.dx === 0 && s.dy === 7;
  })());

  check('the hand-over is symmetric', (() => {
    const held = step(4.4, 4, 'y');
    const given = step(7, 4, 'y');
    return held.axis === 'y' && given.axis === 'x';
  })());

  check('letting go of the lock forgets the axis', (() => {
    // So taking Alt again later in the same drag chooses from where the pointer
    // now is, rather than resuming an axis picked before it was released.
    const s = step(4, 7, 'x', false);
    return s.axis === null && s.dx === 4 && s.dy === 7;
  })());

  check('a locked drag never moves along both axes at once', (() => {
    let ok = true;
    for (let gx = -6; gx <= 6; gx += 0.5) {
      for (let gy = -6; gy <= 6; gy += 0.5) {
        for (const axis of [null, 'x', 'y']) {
          const s = step(gx, gy, axis);
          if (s.dx !== 0 && s.dy !== 0) ok = false;
        }
      }
    }
    return ok;
  })());
}

/**
 * What a marquee sweeps.
 *
 * The rectangle is a patch of *ground*, so the camera has no vote in this at
 * all — which is most of the point. The screen-space version it replaced gave
 * different answers for the same drag over the same blocks at different
 * rotations, and put the region that selected a tall block a couple of cells up
 * the screen from the region that looked like it should.
 */
function marqueeCases(check) {
  const doc = normalizeDoc({
    groups: [
      { id: 'small', kind: 'vpc', rect: [0, 0, 6, 6] },
      { id: 'huge', kind: 'vpc', rect: [-40, -40, 200, 200] },
    ],
    nodes: [
      { id: 'near', type: 'ec2', pos: [1, 1], size: [2, 2], height: 3 },
      { id: 'far', type: 'ec2', pos: [40, 40], size: [2, 2] },
    ],
    shapes: [{ id: 'step', kind: 'process', pos: [1, 10], size: [4, 2] }],
    cells: [{ id: 'array', pos: [1, 20], cols: 3, rows: 1 }],
    texts: [{ id: 'note', text: 'hi', pos: [2, 30] }],
    images: [{ id: 'pic', src: 'https://example.com/a.png', pos: [2, 40], size: [6, 4] }],
  }).doc;
  const swept = (x0, y0, x1, y1) => entitiesInRect(doc, { x0, y0, x1, y1 });

  check('a sweep over a footprint catches what stands on it',
    swept(0, 0, 4, 4).includes('near'));
  check('a sweep beside it catches nothing of it',
    !swept(20, 20, 24, 24).includes('near'));
  check('touching is enough for a block', swept(2.5, 2.5, 9, 9).includes('near'));

  check('a zone is caught only when the sweep holds all of it', (() => {
    const clipped = swept(0, 0, 3, 3);
    const whole = swept(-1, -1, 7, 7);
    return !clipped.includes('small') && whole.includes('small');
  })());
  check('a sweep inside a huge zone does not drag the whole diagram in',
    !swept(0, 0, 4, 4).includes('huge'));

  /*
   * Both of these were unreachable by a marquee: the screen-space version had
   * no loop for them at all, so a flowchart or an array could only ever be
   * selected one click at a time.
   */
  check('a flowchart step is caught', swept(0, 9, 6, 13).includes('step'));
  check('a data structure is caught', swept(0, 19, 8, 23).includes('array'));

  check('a note is caught by the point it hangs from', (() => {
    return swept(0, 29, 4, 31).includes('note') && !swept(0, 32, 4, 34).includes('note');
  })());
  check('so is a picture, which may be standing on a wall', (() => {
    // Its anchor, not its extent: a picture on a wall covers a rectangle in
    // that plane and has no footprint on the ground to test.
    return swept(0, 39, 4, 41).includes('pic') && !swept(0, 42, 8, 44).includes('pic');
  })());

  check('a sweep dragged the other way is the same sweep', (() => {
    const forward = swept(0, 0, 4, 4).join();
    const back = swept(4, 4, 0, 0).join();
    return forward === back && forward.includes('near');
  })());

  check('a sweep of nothing selects nothing', swept(30, 5, 34, 9).length === 0);

  check('a block is caught by its footprint, not by how tall it stands', (() => {
    /*
     * `near` is three cells tall, so its drawn cube reaches well up the screen
     * from the ground it stands on. The patch it belongs to is the patch its
     * base covers, which is what the parallelogram on screen is showing.
     */
    const onItsGround = swept(0.5, 0.5, 3.5, 3.5);
    const whereItsTopLooks = swept(-3, -3, -0.5, -0.5);
    return onItsGround.includes('near') && !whereItsTopLooks.includes('near');
  })());
}

function heightCases(check) {
  const heightOf = (raw) => normalizeDoc({
    nodes: [{ id: 'n', type: 'ec2', pos: [0, 0], height: raw }],
  }).doc.nodes[0].height;

  check('a tenth of a cell survives the loader', heightOf(1.5) === 1.5 && heightOf(0.3) === 0.3);
  check('finer than a tenth is rounded to one', heightOf(1.15) === 1.2 && heightOf(2.04) === 2);
  check('a tenth survives the round trip through a file', (() => {
    const doc = normalizeDoc({ nodes: [{ id: 'n', type: 'ec2', pos: [0, 0], height: 1.5 }] }).doc;
    const text = serializeDoc(doc);
    return text.includes('"height": 1.5') && parseDoc(text).doc.nodes[0].height === 1.5;
  })());
  check('a tenth does not arrive with a tail of nines', (() => {
    // 1.1 + 0.1 is not 1.2 in binary; the loader counts in tenths so a file
    // never ends up carrying 1.2000000000000002.
    const text = serializeDoc(normalizeDoc({
      nodes: [{ id: 'n', type: 'ec2', pos: [0, 0], height: 1.1 + 0.1 }],
    }).doc);
    return text.includes('"height": 1.2');
  })());
  check('height is still bounded', heightOf(-4) === 0 && heightOf(400) === 40);
  check('nonsense still falls back to the type default', (() => {
    const def = componentFor('ec2').height;
    return heightOf('tall') === def && heightOf(undefined) === def;
  })());
  check('footprints stay whole cells', (() => {
    const doc = normalizeDoc({
      nodes: [{ id: 'n', type: 'ec2', pos: [0, 0], size: [2.4, 1.7] }],
    }).doc;
    return doc.nodes[0].size.every(Number.isInteger);
  })());
  check('positions stay whole cells', (() => {
    const doc = normalizeDoc({ nodes: [{ id: 'n', type: 'ec2', pos: [1.5, 2.5] }] }).doc;
    return doc.nodes[0].pos.every(Number.isInteger);
  })());
}

/**
 * Several drawings in one file.
 *
 * The rule the whole design rests on is that a one-drawing file is written
 * exactly as it always was, so most of these are about the wrapper *not*
 * appearing rather than about it working.
 */
function tabCases(check) {
  const node = (id, x = 0) => ({ id, type: 'ec2', pos: [x, 0] });
  const twoTabs = () => normalizeDoc({
    meta: { title: 'Both' },
    tabs: [
      { name: 'Overview', nodes: [node('a')] },
      { name: 'Detail', nodes: [node('b'), node('c', 4)] },
    ],
  }).doc;

  check('a tabbed file loads its drawings separately', (() => {
    const doc = twoTabs();
    return doc.tabs.length === 2 && doc.tabs[0].nodes.length === 1 && doc.tabs[1].nodes.length === 2;
  })());
  check('a tabbed file keeps nothing at the top level', (() => {
    const doc = twoTabs();
    return CONTENT_KEYS.every((key) => doc[key] === undefined);
  })());
  check('an unnamed tab is numbered from one', (() => {
    const doc = normalizeDoc({ tabs: [{ nodes: [node('a')] }, { nodes: [node('b')] }] }).doc;
    return doc.tabs[0].name === 'Tab 1' && doc.tabs[1].name === 'Tab 2';
  })());
  check('a tabbed file round-trips unchanged', (() => {
    const text = serializeDoc(twoTabs());
    return serializeDoc(parseDoc(text).doc) === text;
  })());
  check('ids may repeat between tabs', (() => {
    // Each drawing stands alone, so the same name in two of them is not a
    // clash and must not be renamed to `a-2` behind the author's back.
    const doc = normalizeDoc({
      tabs: [{ nodes: [node('a')] }, { nodes: [node('a')] }],
    }).doc;
    return doc.tabs[0].nodes[0].id === 'a' && doc.tabs[1].nodes[0].id === 'a';
  })());
  check('one drawing is written without a wrapper', (() => {
    const doc = normalizeDoc({ tabs: [{ name: 'Only', nodes: [node('a')] }] }).doc;
    const text = serializeDoc(doc);
    return !text.includes('tabs') && text.includes('"nodes"');
  })());
  check('a plain file is still refused when it holds no diagram',
    docRejection({ tabs: [] }) !== null && docRejection({ tabs: [{ nodes: [] }] }) === null);

  // --- splitting and joining ------------------------------------------------
  check('a plain document splits into one drawing', (() => {
    const doc = normalizeDoc({ nodes: [node('a')] }).doc;
    const parts = splitTabs(doc);
    return parts.length === 1 && parts[0].doc === doc;
  })());
  check('a split drawing carries the file title and canvas', (() => {
    const doc = normalizeDoc({
      meta: { title: 'Shared' },
      canvas: { background: '#123456' },
      tabs: [{ name: 'One', nodes: [node('a')] }, { name: 'Two', nodes: [node('b')] }],
    }).doc;
    return splitTabs(doc).every((t) => t.doc.meta.title === 'Shared' && t.doc.canvas.background === '#123456');
  })());
  check('splitting and joining is a round trip', (() => {
    const doc = twoTabs();
    return serializeDoc(joinTabs(splitTabs(doc))) === serializeDoc(doc);
  })());
  check('joining one drawing produces a plain document', (() => {
    const doc = normalizeDoc({ nodes: [node('a')] }).doc;
    return joinTabs(splitTabs(doc)).tabs === undefined;
  })());

  /*
   * Every collection survives the wrapper.
   *
   * Both the join and the write used to name the collections one by one, so the
   * two kinds added since -- flowchart shapes and data structures -- were
   * dropped from a tabbed file on every save, silently, because nothing about a
   * missing name in a list of them fails. Both read `CONTENT_KEYS` now, and this
   * is what says so when the next kind is added.
   */
  check('a tabbed file keeps every kind of content', (() => {
    const rich = normalizeDoc({
      tabs: [
        { name: 'One', nodes: [node('a')] },
        {
          name: 'Two',
          nodes: [node('b')],
          groups: [{ id: 'g', rect: [0, 0, 6, 6] }],
          shapes: [{ id: 's', kind: 'decision', pos: [10, 0] }],
          cells: [{ id: 'c', pos: [0, 10] }],
          texts: [{ id: 't', text: 'note', pos: [4, 4] }],
        },
      ],
    }).doc;
    const back = normalizeDoc(JSON.parse(serializeDoc(rich))).doc;
    const two = back.tabs[1];
    return CONTENT_KEYS.filter((key) => key !== 'edges' && key !== 'images')
      .every((key) => two[key].length === 1);
  })());

  // --- the controller -------------------------------------------------------
  const controller = () => {
    const parts = splitTabs(twoTabs());
    const store = createStore(parts[0].doc);
    return { store, tabs: createTabs({ store, initial: parts }) };
  };

  check('the store holds one drawing at a time', (() => {
    const { store, tabs } = controller();
    return store.state.doc.nodes.length === 1 && tabs.count === 2;
  })());
  check('switching swaps the drawing on screen', (() => {
    const { store, tabs } = controller();
    tabs.select(1);
    return store.state.doc.nodes.length === 2 && tabs.active === 1;
  })());
  check('an edit made in one tab is still there after visiting another', (() => {
    const { store, tabs } = controller();
    store.commit('Add', (doc) => doc.nodes.push(node('z', 8)));
    tabs.select(1);
    tabs.select(0);
    return store.state.doc.nodes.some((n) => n.id === 'z');
  })());
  check('undo does not reach across a switch', (() => {
    // The stacks hold whole documents, so a shared one would undo an edit made
    // in a drawing you are no longer looking at — by replacing the one you are.
    const { store, tabs } = controller();
    store.commit('Add', (doc) => doc.nodes.push(node('z', 8)));
    tabs.select(1);
    const before = store.state.doc.nodes.length;
    return store.canUndo() === false && before === 2;
  })());
  check('each tab keeps its own history across a switch', (() => {
    const { store, tabs } = controller();
    store.commit('Add', (doc) => doc.nodes.push(node('z', 8)));
    tabs.select(1);
    tabs.select(0);
    return store.canUndo() && store.undo() && !store.state.doc.nodes.some((n) => n.id === 'z');
  })());
  check('the file is every tab, not the one on screen', (() => {
    const { store, tabs } = controller();
    store.commit('Add', (doc) => doc.nodes.push(node('z', 8)));
    const whole = tabs.document();
    return whole.tabs.length === 2 && whole.tabs[0].nodes.some((n) => n.id === 'z');
  })());
  /*
   * Re-reading the file you are already in should leave you in it.
   *
   * Being bounced to the first drawing is a shrug when you pressed `R`. It is
   * lost work when something else wrote the file while you were drawing in
   * tab three — which is the ordinary case once a watcher, or a model, is
   * doing the writing.
   */
  check('a reload keeps the drawing you were looking at', (() => {
    const { store, tabs } = controller();
    tabs.select(1);
    tabs.load(twoTabs(), { label: 'Reload', keepActive: true });
    return tabs.active === 1 && store.state.doc.nodes.length === 2;
  })());
  check('opening a file still starts at its first drawing', (() => {
    const { tabs } = controller();
    tabs.select(1);
    tabs.load(twoTabs());
    return tabs.active === 0;
  })());
  check('a reload into a shorter file lands on the last drawing, not off the end', (() => {
    const { store, tabs } = controller();
    tabs.select(1);
    tabs.load(normalizeDoc({ nodes: [node('only')] }).doc, { keepActive: true });
    return tabs.active === 0 && tabs.count === 1 && store.state.doc.nodes.length === 1;
  })());

  check('adding a tab shows it, empty', (() => {
    const { store, tabs } = controller();
    tabs.add();
    return tabs.count === 3 && tabs.active === 2 && store.state.doc.nodes.length === 0;
  })());
  check('a duplicated tab is a copy, not a second reference', (() => {
    const { store, tabs } = controller();
    tabs.duplicate(0);
    store.commit('Add', (doc) => doc.nodes.push(node('z', 8)));
    return tabs.all()[0].doc.nodes.length === 1 && tabs.all()[1].doc.nodes.length === 2;
  })());
  check('the last tab cannot be deleted', (() => {
    const { tabs } = controller();
    return Boolean(tabs.remove(0)) && tabs.remove(0) === null && tabs.count === 1;
  })());
  check('a deleted tab comes back where it was, with its history', (() => {
    const { store, tabs } = controller();
    tabs.select(1);
    store.commit('Add', (doc) => doc.nodes.push(node('z', 8)));
    const gone = tabs.remove(1);
    tabs.insert(1, gone);
    return tabs.count === 2 && tabs.active === 1 &&
      store.state.doc.nodes.some((n) => n.id === 'z') && store.canUndo();
  })());
  check('deleting the tab before the open one keeps the open one', (() => {
    const { store, tabs } = controller();
    tabs.select(1);
    tabs.remove(0);
    return tabs.active === 0 && store.state.doc.nodes.length === 2;
  })());
  check('a drawing can be moved along the strip', (() => {
    const { tabs } = controller();
    tabs.rename(0, 'One');
    tabs.rename(1, 'Two');
    return tabs.move(0, 1) && tabs.list.map((t) => t.name).join(',') === 'Two,One';
  })());
  check('moving a drawing does not change the one on screen', (() => {
    const { store, tabs } = controller();
    const showing = store.state.doc;
    tabs.move(0, 1);
    // The tab that was open is still the open one, at its new index.
    return store.state.doc === showing && tabs.active === 1 && store.canUndo() === false;
  })());
  check('the open tab is chased across when another moves past it', (() => {
    const { tabs } = controller();
    tabs.add(); // three drawings, the third showing
    tabs.select(1);
    tabs.move(2, 0);
    return tabs.active === 2;
  })(), 'a moved tab must not take the highlight with it');
  check('a move that goes nowhere is refused', (() => {
    const { tabs } = controller();
    return tabs.move(0, 0) === false && tabs.move(0, 5) === false && tabs.move(-1, 0) === false;
  })());
  check('the file is written in the order the strip shows', (() => {
    const { tabs } = controller();
    tabs.rename(0, 'One');
    tabs.rename(1, 'Two');
    tabs.move(1, 0);
    return tabs.document().tabs.map((t) => t.name).join(',') === 'Two,One';
  })());
  check('a deleted tab takes its history with it', (() => {
    const { store, tabs } = controller();
    store.commit('Add', (doc) => doc.nodes.push(node('z', 8)));
    tabs.remove(0);
    // Undoing here would put the closed drawing back on top of this one.
    return store.canUndo() === false && store.state.doc.nodes.length === 2;
  })());
  check('deleting another tab leaves this one and its history alone', (() => {
    const { store, tabs } = controller();
    tabs.select(1);
    store.commit('Add', (doc) => doc.nodes.push(node('z', 8)));
    tabs.remove(0);
    return tabs.active === 0 && store.canUndo() && store.state.doc.nodes.length === 3;
  })());
  check('loading a file replaces every tab', (() => {
    const { store, tabs } = controller();
    tabs.load(normalizeDoc({ nodes: [node('solo')] }).doc);
    return tabs.count === 1 && store.state.doc.nodes[0].id === 'solo';
  })());
  check('a renamed tab keeps its name in the file', (() => {
    const { tabs } = controller();
    tabs.rename(1, '  Write path  ');
    return tabs.document().tabs[1].name === 'Write path';
  })());
  check('a name has an upper bound', (() => {
    const { tabs } = controller();
    tabs.rename(1, 'x'.repeat(200));
    return tabs.list[1].name.length === MAX_TAB_NAME;
  })());
  check('a name is cut in characters, not in code units', (() => {
    // Half a surrogate pair would be a lone replacement character on screen.
    const { tabs } = controller();
    tabs.rename(1, '🙂'.repeat(50));
    const name = tabs.list[1].name;
    return [...name].length === MAX_TAB_NAME && !name.includes('�') &&
      [...name].every((c) => c === '🙂');
  })());
  check('a file carrying an over-long name is shortened, and says so', (() => {
    const { doc, warnings } = normalizeDoc({
      tabs: [{ name: 'A'.repeat(90), nodes: [node('a')] }, { name: 'Two', nodes: [node('b')] }],
    });
    return doc.tabs[0].name.length === MAX_TAB_NAME &&
      warnings.some((w) => w.includes('tabs[0].name'));
  })());
  check('a name at the bound is left alone', (() => {
    const name = 'A'.repeat(MAX_TAB_NAME);
    const { doc, warnings } = normalizeDoc({
      tabs: [{ name, nodes: [node('a')] }, { name: 'Two', nodes: [node('b')] }],
    });
    return doc.tabs[0].name === name && !warnings.length;
  })());
  check('a name erased falls back to its number', (() => {
    const { tabs } = controller();
    tabs.rename(1, '   ');
    return tabs.document().tabs[1].name === 'Tab 2';
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

/**
 * The other direction, which is the one the light models actually fail in.
 *
 * These matter more than they look. Every other rule in the project pushes
 * towards drawing less, and this pair is the only thing pushing back — so a
 * regression here is silent, and shows up as diagrams that are tidy and wrong.
 */
function coverageCases(check) {
  const doc = (...labels) => ({
    nodes: labels.map((label, i) => ({ id: `n${i}`, label })),
    edges: [],
  });
  // Ten named components: the diagram the whole exercise is trying to reach.
  const full = doc('Spring', 'MySQL', 'Redis', 'S3', 'Toss', 'Clova', 'OpenAI',
    'Pinecone', 'SMTP', 'Client');

  check('a diagram that covers its system is left alone',
    underDrawn(full, { fromScratch: true }) === null);
  check('a plural caption is named even in a diagram big enough to pass', (() => {
    const said = underDrawn(doc('Spring', 'MySQL', 'Redis', 'S3', 'Toss', 'Clova',
      'OpenAI', 'Pinecone', 'SMTP', 'External APIs'), { fromScratch: true });
    return said?.includes('"External APIs"') && !said.includes('for a whole system');
  })());
  check('the catch-all check does not need a first draft to fire',
    underDrawn(doc('Spring', 'MySQL', 'Redis', 'S3', 'Ext Services'), { fromScratch: false }) !== null,
    'a block named for a group of things is wrong in an edit too');
  check('real product names are not mistaken for catch-alls',
    underDrawn(full, { fromScratch: false }) === null,
    'a false positive here tells the model to split a block that is already one thing');
  check('a thin first draft is questioned', (() => {
    const said = underDrawn(doc('Client', 'API', 'DB'), { fromScratch: true });
    return said?.includes('3 block(s)');
  })());
  check('the question is asked against the target the prompt names', (() => {
    // Nine is below the 12-20 the defaults table calls usual; ten is not.
    const nine = doc(...Array.from({ length: 9 }, (_, i) => `Thing${i}`));
    return underDrawn(nine, { fromScratch: true }) !== null &&
           underDrawn(full, { fromScratch: true }) === null;
  })());
  check('a thin diagram that was edited rather than drawn is not questioned',
    underDrawn(doc('Client', 'API', 'DB'), { fromScratch: false }) === null,
    'otherwise "make these blue" on a small diagram becomes a demand to grow it');
  check('both complaints arrive together when both apply', (() => {
    const said = underDrawn(doc('API', 'External APIs'), { fromScratch: true });
    return said.includes('External APIs') && said.includes('2 block(s) for a whole system');
  })(), underDrawn(doc('API', 'External APIs'), { fromScratch: true }));

  // --- blocks standing outside the zone they claim --------------------------
  const zoned = (pos, rect = [0, 0, 20, 20]) => ({
    groups: [{ id: 'z', rect }],
    nodes: [{ id: 'n', group: 'z', pos, size: [2, 2] }],
  });

  check('a block well inside its zone is not remarked on',
    misplaced(zoned([4, 4])) === null);
  check('a block outside its zone is caught', (() => {
    const said = misplaced(zoned([30, 4]));
    return said?.includes('"n"') && said.includes('"z"');
  })(), misplaced(zoned([30, 4])));
  check('flush against the boundary counts as outside',
    misplaced(zoned([0, 0])) !== null,
    'the validator wants a cell of margin, and the two must not disagree');
  check('the complaint carries both rectangles, so the fix can be computed',
    misplaced(zoned([30, 4])).includes('[30, 4]–[32, 6]') &&
      misplaced(zoned([30, 4])).includes('[0, 0]–[20, 20]'));
  check('a block in no zone at all is not a stray',
    misplaced({ groups: [], nodes: [{ id: 'n', pos: [99, 99], size: [2, 2] }] }) === null);
  check('a zone that does not exist is left to the loader',
    misplaced({ groups: [], nodes: [{ id: 'n', group: 'gone', pos: [0, 0], size: [2, 2] }] }) === null,
    'two complaints about one mistake is one complaint too many');
}

/**
 * The checks that used to be 337 lines quoted in the prompt.
 *
 * They were never tested before, because they were a string. That is most of
 * the reason for moving them: the assistant now calls them as a tool, and a
 * check that silently stops firing is worse than no check — it reports PASSED
 * on a broken drawing.
 */
/**
 * Links: what one means, where it points, and what refuses to be one.
 *
 * The security half is the part worth having tests for at all. Everything else
 * here fails visibly the moment anyone clicks it; a `javascript:` link that
 * quietly became clickable would work perfectly for whoever wrote it.
 */
function linkCases(check) {
  // --- reading --------------------------------------------------------------
  check('a blank link is no link', readLink('   ') === null && readLink(null) === null);
  check('a link is stored as typed, trimmed',
    readLink('  https://example.com/a  ') === 'https://example.com/a');
  check('a link is bounded', readLink('h'.repeat(MAX_LINK + 500)).length === MAX_LINK);

  // --- what a form means ----------------------------------------------------
  check('a hash names an element', (() => {
    const link = parseLink('#api-gateway');
    return link.kind === 'element' && link.id === 'api-gateway';
  })());
  check('a tab prefix names a drawing', (() => {
    const link = parseLink('tab:Network detail');
    return link.kind === 'tab' && link.name === 'Network detail' && link.index === null;
  })());
  check('a numbered tab link counts from one', (() => {
    const link = parseLink('tab:2');
    return link.kind === 'tab' && link.index === 1;
  })());
  check('an address is an address', parseLink('https://example.com').kind === 'url');
  check('a bare host is read as https', parseLink('example.com/x').href === 'https://example.com/x');
  check('mail is a link too', parseLink('mailto:a@b.com').kind === 'url');
  check('a bare word is not a host',
    parseLink('notes').kind === 'unknown' && parseLink('todo later').kind === 'unknown');
  check('a lone hash names nothing', parseLink('#').kind === 'unknown');

  /*
   * The one that matters. A diagram travels -- published to a URL, embedded in
   * an article, mailed as a file -- so a scheme that runs code in the reader's
   * page must never survive as far as being followed.
   */
  for (const hostile of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox',
    'file:///etc/passwd',
  ]) {
    check(`"${hostile.slice(0, 22)}" is not a link`, parseLink(hostile).kind === 'unknown');
  }

  // --- where a link points --------------------------------------------------
  const node = (id) => ({ id, type: 'ec2', pos: [0, 0] });
  const one = normalizeDoc({ nodes: [node('api'), node('db')] }).doc;
  const file = [
    { name: 'Overview', doc: one },
    { name: 'Detail', doc: normalizeDoc({ nodes: [node('cache')] }).doc },
  ];
  const at = (raw, activeTab = 0) =>
    resolveLink(raw, { doc: file[activeTab].doc, tabs: file, activeTab });

  check('an element link finds an element here', (() => {
    const found = at('#db');
    return found.kind === 'element' && found.id === 'db' && found.tab === 0;
  })());
  check('an element link reaches into another drawing', (() => {
    const found = at('#cache');
    return found.kind === 'element' && found.tab === 1;
  })());
  check('an element link prefers the drawing you are on', (() => {
    // Both drawings get an `api`; standing in the second must find the second.
    const both = [file[0], { name: 'Detail', doc: normalizeDoc({ nodes: [node('api')] }).doc }];
    const found = resolveLink('#api', { doc: both[1].doc, tabs: both, activeTab: 1 });
    return found.kind === 'element' && found.tab === 1;
  })());
  check('an element link to nothing says so', at('#nope').kind === 'missing');

  check('a tab link finds a drawing by name', (() => {
    const found = at('tab:Detail');
    return found.kind === 'tab' && found.index === 1 && found.here === false;
  })());
  check('a tab link ignores case', at('tab:  detail ').index === 1);
  check('a tab link falls back to the number', at('tab:2').index === 1);
  check('a name beats a number', (() => {
    // A drawing genuinely called "2" is found by its name, not counted to.
    const odd = [{ name: 'One', doc: one }, { name: 'x', doc: one }, { name: '2', doc: one }];
    return resolveLink('tab:2', { doc: one, tabs: odd, activeTab: 0 }).index === 2;
  })());
  check('a tab link to the drawing you are on knows it', at('tab:Overview').here === true);
  check('a tab link to no drawing says so', at('tab:Ghost').kind === 'missing');

  check('every kind of link explains itself', (() => {
    const said = ['#db', 'tab:Detail', 'https://example.com', '#nope', 'notes']
      .map((raw) => describeLink(raw, { doc: one, tabs: file, activeTab: 0 }));
    return said.every((line) => line.length > 10) && new Set(said).size === said.length;
  })());

  // --- the document ---------------------------------------------------------
  check('a link survives a round trip', (() => {
    const doc = normalizeDoc({
      nodes: [{ ...node('api'), link: '#db' }, node('db')],
      texts: [{ id: 't', text: 'see also', pos: [0, 0], link: 'https://example.com' }],
    }).doc;
    const text = serializeDoc(doc);
    return text.includes('"link": "#db"') && serializeDoc(parseDoc(text).doc) === text;
  })());
  check('no link is written when there is none', (() => {
    const doc = normalizeDoc({ nodes: [node('api')] }).doc;
    return !serializeDoc(doc).includes('link');
  })());
  check('a link that is not one is kept rather than eaten', (() => {
    // The author has to be able to see what they wrote to find out why nothing
    // happens; a loader that deleted it would hide the mistake, not fix it.
    const doc = normalizeDoc({ nodes: [{ ...node('api'), link: 'javascript:alert(1)' }] }).doc;
    return doc.nodes[0].link === 'javascript:alert(1)';
  })());

  // --- what a link may hang off --------------------------------------------
  check('anything with a place on the grid can be flown to', (() => {
    const doc = normalizeDoc({
      nodes: [node('n')],
      groups: [{ id: 'g', rect: [0, 0, 4, 4] }],
      shapes: [{ id: 's', kind: 'process', pos: [8, 0] }],
      cells: [{ id: 'c', pos: [0, 8] }],
      texts: [{ id: 't', text: 'hi', pos: [4, 4] }],
      images: [{ id: 'i', src: 'https://example.com/a.png', pos: [6, 6] }],
    }).doc;
    return ['n', 'g', 's', 'c', 't', 'i'].every((id) => entityBox(doc, id) !== null);
  })());
  check('a note is a point rather than a footprint', (() => {
    const doc = normalizeDoc({ texts: [{ id: 't', text: 'hi', pos: [3, 4] }] }).doc;
    const box = entityBox(doc, 't');
    return box.x === 3 && box.y === 4 && box.w === 0 && box.h === 0;
  })());

  // --- the flight -----------------------------------------------------------
  const viewport = { width: 800, height: 600 };
  check('flying to one small thing does not fill the screen with it', (() => {
    const box = { x0: 0, y0: 0, x1: 2, y1: 2, zmax: 1 };
    return fitToBox(createCamera(), box, viewport, 40, 1.6).zoom === 1.6;
  })());
  check('a flight ends exactly where it was aimed', (() => {
    const from = { ...createCamera(), tx: 0, ty: 0, zoom: 0.4 };
    const to = { ...createCamera(), tx: -300, ty: 120, zoom: 1.6 };
    const end = lerpCamera(from, to, 1, viewport);
    return near(end.tx, to.tx, 1e-6) && near(end.ty, to.ty, 1e-6) && near(end.zoom, to.zoom, 1e-6);
  })());
  check('a flight starts exactly where it was', (() => {
    const from = { ...createCamera(), tx: 40, ty: -20, zoom: 0.4 };
    const to = { ...createCamera(), tx: -300, ty: 120, zoom: 1.6 };
    const start = lerpCamera(from, to, 0, viewport);
    return near(start.tx, from.tx, 1e-6) && near(start.ty, from.ty, 1e-6);
  })());
  check('a flight keeps its destination in the middle the whole way', (() => {
    /*
     * The reason the interpolation follows the centre point rather than the
     * three camera numbers: interpolating `tx` and `ty` linearly while the zoom
     * changes swings the subject out of frame and back, because the translation
     * that centres a point depends on the zoom it is centred at.
     */
    const from = { ...createCamera(), tx: 0, ty: 0, zoom: 0.35 };
    const to = { ...createCamera(), tx: -400, ty: -250, zoom: 1.6 };
    // Where `to` puts the middle of the screen, in scene coordinates.
    const target = { x: (400 - to.tx) / to.zoom, y: (300 - to.ty) / to.zoom };
    const away = (t) => {
      const cam = lerpCamera(from, to, t, viewport);
      return Math.hypot((400 - cam.tx) / cam.zoom - target.x, (300 - cam.ty) / cam.zoom - target.y);
    };
    // Strictly closing, every frame. Naively interpolating tx and ty gives a
    // curve that sails past the destination and comes back, which is what this
    // is here to catch.
    let closing = true;
    for (let i = 1; i <= 20; i++) {
      if (away(i / 20) > away((i - 1) / 20) + 1e-9) closing = false;
    }
    return closing;
  })());

  // --- validation -----------------------------------------------------------
  check('a broken element link is an error in a whole file', (() => {
    const { errors } = validateDocument({ nodes: [{ ...node('api'), link: '#ghost' }] });
    return errors.some((m) => m.includes('#ghost'));
  })());
  check('an element link across drawings passes', (() => {
    const { errors } = validateDocument({
      tabs: [
        { name: 'One', nodes: [{ ...node('api'), link: '#cache' }] },
        { name: 'Two', nodes: [node('cache')] },
      ],
    });
    return !errors.some((m) => m.includes('cache'));
  })());
  check('one drawing alone only warns about a link it cannot check', (() => {
    const found = validateDrawing({ nodes: [{ ...node('api'), link: '#elsewhere' }] });
    return found.errors.length === 0 && found.warnings.some((m) => m.includes('elsewhere'));
  })());
  check('a tab link to no such drawing is an error', (() => {
    const { errors } = validateDocument({
      tabs: [{ name: 'One', nodes: [{ ...node('api'), link: 'tab:Ghost' }] }, { name: 'Two', nodes: [node('b')] }],
    });
    return errors.some((m) => m.includes('tab:Ghost'));
  })());
  check('a link that is not a link is an error', (() => {
    const { errors } = validateDocument({ nodes: [{ ...node('api'), link: 'javascript:alert(1)' }] });
    return errors.some((m) => m.includes('not one'));
  })());
  check('a sound link is quiet', (() => {
    const found = validateDocument({
      nodes: [{ ...node('api'), link: 'https://example.com' }, node('db')],
    });
    return !found.errors.some((m) => m.includes('link'));
  })());
}

function validateCases(check) {
  const clean = {
    groups: [{ id: 'z', kind: 'vpc', label: 'Prod', rect: [0, 0, 20, 20], color: '#eab308' }],
    nodes: [
      { id: 'a', label: 'API', pos: [2, 2], size: [2, 2], height: 1, labelPlane: 'right', group: 'z' },
      { id: 'b', label: 'DB', pos: [8, 2], size: [2, 2], height: 1, labelPlane: 'right', group: 'z' },
    ],
    edges: [],
  };

  check('a sound drawing produces no errors', (() => {
    const { errors } = validateDrawing(clean);
    return errors.length === 0;
  })(), validateDrawing(clean).errors.join(' | '));
  check('the shipped sample passes its own validator',
    validateDrawing(normalizeDoc(THREE_TIER).doc).errors.length === 0,
    validateDrawing(normalizeDoc(THREE_TIER).doc).errors.join(' | '));

  check('a duplicate id is an error', (() => {
    const doc = { nodes: [{ id: 'a', pos: [0, 0] }, { id: 'a', pos: [4, 0] }] };
    return validateDrawing(doc).errors.some((m) => m.includes('duplicate id'));
  })());
  check('an edge to nothing is an error', (() => {
    const doc = { nodes: [{ id: 'a', pos: [0, 0] }], edges: [{ id: 'e', from: 'a', to: 'ghost' }] };
    return validateDrawing(doc).errors.some((m) => m.includes('does not exist'));
  })());
  check('overlapping blocks are an error', (() => {
    const doc = { nodes: [{ id: 'a', pos: [0, 0] }, { id: 'b', pos: [1, 1] }] };
    return validateDrawing(doc).errors.some((m) => m.includes('blocks overlap'));
  })());
  check('a block outside the zone it names is an error', (() => {
    const doc = {
      groups: [{ id: 'z', rect: [0, 0, 8, 8] }],
      nodes: [{ id: 'a', pos: [30, 30], size: [2, 2], group: 'z' }],
    };
    return validateDrawing(doc).errors.some((m) => m.includes('not inside zone'));
  })());
  check('a tall block in front hiding a short one behind is an error', (() => {
    const doc = {
      nodes: [
        { id: 'back', pos: [0, 0], size: [2, 2], height: 0 },
        { id: 'front', pos: [3, 3], size: [2, 2], height: 3 },
      ],
    };
    return validateDrawing(doc).errors.some((m) => m.includes('hides'));
  })());
  check('a fractional coordinate is an error',
    validateDrawing({ nodes: [{ id: 'a', pos: [1.5, 0] }] }).errors.some((m) => m.includes('not integral')));

  check('a caption naming a group of things warns',
    validateDrawing({ nodes: [{ id: 'x', label: 'External APIs', pos: [0, 0], labelPlane: 'right' }] })
      .warnings.some((m) => m.includes('several components folded')));
  check('a caption left on the floor warns',
    validateDrawing({ nodes: [{ id: 'x', label: 'API', pos: [0, 0] }] })
      .warnings.some((m) => m.includes('no labelPlane')));
  check('too many connections warns', (() => {
    const doc = {
      nodes: Array.from({ length: 4 }, (_, i) => ({ id: `n${i}`, pos: [i * 4, 0], labelPlane: 'right' })),
      edges: Array.from({ length: 3 }, (_, i) => ({ id: `e${i}`, from: 'n0', to: `n${i + 1}` })),
    };
    return validateDrawing(doc).warnings.some((m) => m.includes('aim for 0.33'));
  })());

  check('every drawing in a tabbed file is checked, and says which', (() => {
    const bad = { nodes: [{ id: 'a', pos: [0, 0] }, { id: 'a', pos: [9, 0] }] };
    const { errors } = validateDocument({ tabs: [{ name: 'Overview', ...clean }, { name: 'Detail', ...bad }] });
    return errors.length === 1 && errors[0].startsWith('Detail: ');
  })(), JSON.stringify(validateDocument({ tabs: [{ name: 'Overview', ...clean }, { name: 'Detail', ...{ nodes: [{ id: 'a', pos: [0, 0] }, { id: 'a', pos: [9, 0] }] } }] }).errors));
  check('a flat document is not treated as a tab', (() => {
    const { infos } = validateDocument(clean);
    return infos.some((m) => m.startsWith('2 blocks'));
  })());

  check('the report says PASSED or FAILED, not only a count', (() => {
    const passed = formatReport(validateDrawing(clean));
    const failed = formatReport(validateDrawing({ nodes: [{ id: 'a', pos: [1.5, 0] }] }));
    return passed.includes('PASSED') && failed.includes('FAILED') && failed.startsWith('ERROR');
  })());
}

/**
 * The prompt the editor's assistant is actually sent.
 *
 * It is `LLM_PROMPT` with the validator cut out, and the cut is worth a test
 * because nothing about it is visible: get it wrong and the endpoint keeps
 * working, just at a third more tokens on every turn for a script the model
 * cannot run.
 */
function assistantPromptCases(check) {
  check('the assistant prompt drops the quoted validator',
    !ASSISTANT_PROMPT.includes('readFileSync') && LLM_PROMPT.includes('readFileSync'),
    'the script is for a reader with a shell, and the assistant has tools instead');
  check('it points at the tool that replaced it',
    ASSISTANT_PROMPT.includes('validate_diagram'));
  check('the saving is the size it is meant to be',
    LLM_PROMPT.length - ASSISTANT_PROMPT.length > 12_000,
    `saved ${LLM_PROMPT.length - ASSISTANT_PROMPT.length} characters`);
  check('nothing but that section was cut', (() => {
    // The headings either side of the cut have to survive, and so does the
    // section after it -- an off-by-one in the slice would eat the rest.
    return ASSISTANT_PROMPT.includes('## Then look at the render') &&
      ASSISTANT_PROMPT.includes('## Common failures') &&
      ASSISTANT_PROMPT.includes('## Drawing a codebase') &&
      ASSISTANT_PROMPT.startsWith('You write Massing diagrams');
  })());
  check('the component catalogue survives the cut',
    COMPONENTS.every((c) => ASSISTANT_PROMPT.includes('`' + c.type + '`')),
    'a prompt that offers a type the loader does not know is worse than useless');
}

/**
 * Keeping a moved panel on screen.
 *
 * Every way the assistant panel gets lost runs through `clampBox`: a window
 * narrowed since the geometry was stored, a laptop unplugged from the monitor
 * the panel was dragged onto, a phone rotated. None of those is reproducible
 * by hand, and all of them end with a card the person cannot reach.
 */
function movableCases(check) {
  const view = { width: 1000, height: 800 };
  const min = { width: 300, height: 260 };
  const box = (left, top, width = 380, height = 520) => ({ left, top, width, height });

  check('a box already on screen is left where it is', (() => {
    const same = clampBox(box(100, 50), view, min);
    return same.left === 100 && same.top === 50 && same.width === 380 && same.height === 520;
  })());

  // --- most of it may hang off, a handle may not ---------------------------
  check('a panel may be pushed off the right edge', (() => {
    // Only KEEP_VISIBLE has to remain, not the whole card: leaving a strip of
    // title showing is half the reason for moving one in the first place.
    const pushed = clampBox(box(2000, 50), view, min);
    return pushed.left === view.width - KEEP_VISIBLE;
  })(), JSON.stringify(clampBox(box(2000, 50), view, min)));
  check('a panel may be pushed off the left edge', (() => {
    const pushed = clampBox(box(-2000, 50), view, min);
    return pushed.left === KEEP_VISIBLE - 380;
  })(), JSON.stringify(clampBox(box(-2000, 50), view, min)));
  check('a strip of it is always still on screen', (() => {
    for (const at of [-5000, -381, -100, 0, 999, 5000]) {
      const { left, width } = clampBox(box(at, 10), view, min);
      const onScreen = Math.min(left + width, view.width) - Math.max(left, 0);
      if (onScreen < KEEP_VISIBLE) return false;
    }
    return true;
  })());
  check('the ask for a visible strip never exceeds the panel itself', (() => {
    // A panel narrower than the strip would otherwise be clamped to a range
    // whose lower bound sat above its upper one.
    const narrow = clampBox({ left: -500, top: 0, width: 60, height: 300 },
      { width: 1000, height: 800 }, { width: 40, height: 40 });
    return narrow.left === 0 && narrow.width === 60;
  })(), JSON.stringify(clampBox({ left: -500, top: 0, width: 60, height: 300 },
    { width: 1000, height: 800 }, { width: 40, height: 40 })));

  check('it never goes above the top edge', (() => {
    // Off the top the header is the first thing gone, and what is left cannot
    // be dragged at all — so this one stays a hard floor.
    return clampBox(box(10, -400), view, min).top === 0;
  })());
  check('the header stays reachable at the bottom',
    clampBox(box(10, 5000), view, min).top === view.height - HANDLE_HEIGHT,
    'past this the title bar is off screen and there is nothing to grab');
  check('the bottom rule allows hanging below, unlike the old whole-card rule',
    clampBox(box(10, 700), view, min).top === 700,
    'a 520-tall panel at y=700 in an 800 window used to be dragged back up');

  // --- size ----------------------------------------------------------------
  check('a box wider than the window is shrunk to it',
    clampBox(box(0, 0, 2000, 3000), view, min).width === 1000);
  check('shrinking happens before moving', (() => {
    // The order is visible on the left bound, which is `keep - width`. Clamped
    // the other way round, this box keeps the -1500 that a 2000-wide panel was
    // allowed, then shrinks to 1000 — and ends up entirely off screen.
    const fixed = clampBox(box(-1500, 10, 2000, 400), view, min);
    return fixed.width === 1000 && fixed.left === KEEP_VISIBLE - 1000;
  })(), JSON.stringify(clampBox(box(-1500, 10, 2000, 400), view, min)));
  check('a box smaller than the minimum is grown to it',
    clampBox(box(10, 10, 40, 30), view, min).width === 300 &&
      clampBox(box(10, 10, 40, 30), view, min).height === 260);
  check('a window smaller than the minimum wins over the minimum', (() => {
    // Otherwise the clamp hands back a box larger than the screen it is
    // clamping to, which is the one thing it exists to prevent.
    const tiny = clampBox(box(0, 0, 380, 520), { width: 200, height: 150 }, min);
    return tiny.width === 200 && tiny.height === 150;
  })());
  check('a window shorter than the handle still yields a reachable top',
    clampBox(box(0, 300), { width: 400, height: 20 }, min).top === 0,
    'the bottom bound would go negative and pin the panel above the window');
}

/**
 * Which model a choice resolves to.
 *
 * Worth testing because every one of these is a promise to somebody who is not
 * looking: a deployment that pinned a model, a page cached before the picker
 * existed, and a browser holding a tier this build no longer has.
 */
function modelCases(check) {
  check('every tier names a distinct model', (() => {
    const ids = MODEL_TIERS.map((t) => t.model);
    return new Set(ids).size === ids.length && ids.length === 3;
  })());
  check('the default tier is one of the tiers', isTier(DEFAULT_TIER));
  check('the default is what the deployment ran before the picker existed',
    modelForTier(DEFAULT_TIER, {}) === 'gemini-flash-lite-latest',
    'shipping a control must not change the answer for someone who ignores it');
  check('the two upper rungs float rather than pinning a version',
    MODEL_TIERS.filter((t) => t.model.endsWith('-latest')).length === 2,
    'a pinned id can be retired underneath a deployment nobody is watching');
  check('no rung is a Pro model', (() => {
    // A free key has no Pro quota at all, and this project has no billing
    // behind it. A rung that answers 429 for everyone is not a rung.
    return MODEL_TIERS.every((t) => !/pro/.test(t.model));
  })());
  check('every tier carries a label and a hint',
    MODEL_TIERS.every((t) => t.label && t.hint && t.id));

  check('a tier resolves to its own model',
    modelForTier('strong', {}) === 'gemini-flash-latest');
  check('an unknown tier falls back rather than throwing',
    modelForTier('turbo', {}) === modelForTier(DEFAULT_TIER, {}),
    'a stored preference outlives the build that wrote it');
  check('a per-tier variable swaps one rung', (() => {
    // The documented way to put Pro back where there is quota for it.
    const env = { MASSING_AI_MODEL_STRONG: 'gemini-pro-latest' };
    return modelForTier('strong', env) === 'gemini-pro-latest' &&
      modelForTier('light', env) === 'gemini-3.1-flash-lite';
  })());
  check('a pinned deployment ignores the picker entirely', (() => {
    const env = { MASSING_AI_MODEL: 'gemini-2.0-flash' };
    return MODEL_TIERS.every((t) => modelForTier(t.id, env) === 'gemini-2.0-flash') &&
      tiersPinned(env) && !tiersPinned({});
  })(), 'setting it has always meant "this deployment uses this model"');
  // --- a document typed into the reply instead of passed to the tool --------
  check('prose is not mistaken for a document',
    documentInReply('I moved the database to the left.') === null);
  check('an empty reply is not a document', documentInReply('') === null &&
    documentInReply(null) === null);
  check('a document in the reply is found',
    documentInReply('{"nodes":[]}') === '{"nodes":[]}');
  check('a fenced document is unwrapped', (() => {
    const said = '```json\n{"nodes":[{"id":"a"}]}\n```';
    return documentInReply(said) === '{"nodes":[{"id":"a"}]}';
  })());
  check('a bare fence with no language is unwrapped too',
    documentInReply('```\n{"nodes":[]}\n```') === '{"nodes":[]}');
  check('JSON that does not parse is left alone',
    documentInReply('{"nodes": [,]}') === null,
    'half a document is not something to apply to somebody\'s drawing');
  check('prose that merely mentions braces is not parsed',
    documentInReply('Set it to {"color": "#fff"} and it works') === null);

  check('an empty variable is not a pin',
    modelForTier('light', { MASSING_AI_MODEL: '   ' }) === 'gemini-3.1-flash-lite',
    'an unset variable arrives as an empty string often enough to matter');
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


  // --- flowchart shapes ------------------------------------------------------

  check('a shape survives a round trip through the file', (() => {
    const { doc } = normalizeDoc({
      version: 1,
      shapes: [{ id: 'q', kind: 'decision', label: 'b = 0 ?', pos: [2, 3], size: [6, 4],
                 yes: 'yes', no: 'no', noAt: 'left' }],
    });
    const again = normalizeDoc(JSON.parse(serializeDoc(doc))).doc;
    const a = doc.shapes[0];
    const b = again.shapes[0];
    return (
      a.kind === 'decision' && b.kind === 'decision' && b.label === 'b = 0 ?' &&
      b.pos[0] === 2 && b.size[1] === 4 && b.yes === 'yes' && b.noAt === 'left' &&
      serializeDoc(doc) === serializeDoc(again)
    );
  })());

  check('an unknown shape kind degrades to a process', (() => {
    const { doc, warnings } = normalizeDoc({
      version: 1,
      shapes: [{ id: 's', kind: 'trapezoid', pos: [0, 0] }],
    });
    return doc.shapes[0].kind === 'process' && warnings.some((w) => /trapezoid/.test(w));
  })());

  check('a connection may name a shape at either end', (() => {
    const { doc } = normalizeDoc({
      version: 1,
      nodes: [{ id: 'n', type: 'ec2', pos: [0, 0] }],
      shapes: [{ id: 's', kind: 'process', pos: [10, 0] }],
      edges: [{ id: 'e', from: 'n', to: 's' }, { id: 'e2', from: 's', to: 'nope' }],
    });
    // The first joins a block to a shape; the second names nothing and goes.
    return doc.edges.length === 1 && doc.edges[0].to === 's' && canConnect(doc, 's');
  })());

  check('a shape is an endpoint that carries its silhouette', (() => {
    const { doc } = normalizeDoc({
      version: 1,
      shapes: [{ id: 'd', kind: 'decision', pos: [0, 0], size: [4, 4] }],
    });
    const box = endpointBox(doc, 'd');
    return box.shape === 'decision' && box.w === 4 && box.ht === 0.5;
  })());

  check('a diamond claims its middle and not its corners', () =>
    shapeContains('decision', 0.5, 0.5, 4, 4) &&
    !shapeContains('decision', 0.02, 0.02, 4, 4) &&
    !shapeContains('decision', 0.98, 0.02, 4, 4));

  check('a rectangular kind claims the whole box', () =>
    ['process', 'subroutine'].every((kind) =>
      [[0, 0], [1, 1], [0.5, 0.5], [1, 0]].every(([u, v]) => shapeContains(kind, u, v, 5, 2))));

  check('a connector claims a circle', () =>
    shapeContains('connector', 0.5, 0.5, 2, 2) &&
    !shapeContains('connector', 0.05, 0.05, 2, 2));

  check('an I/O box leans one way and keeps its area', () =>
    // The lean takes the top-left and bottom-right corners off, not the others.
    !shapeContains('io', 0.01, 0.01, 5, 2) &&
    !shapeContains('io', 0.99, 0.99, 5, 2) &&
    shapeContains('io', 0.99, 0.01, 5, 2) &&
    shapeContains('io', 0.01, 0.99, 5, 2));

  check('every kind rings itself with usable points at any size', () =>
    SHAPE_KINDS.every((kind) =>
      [[1, 1], [5, 2], [2, 9], [40, 40]].every(([w, h]) => {
        const pts = kind.points(w * 40, h * 40);
        return (
          Array.isArray(pts) && pts.length >= 3 &&
          pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y) &&
            x >= -0.01 && y >= -0.01 && x <= w * 40 + 0.01 && y <= h * 40 + 0.01)
        );
      })));

  check('a ring turns into a path that starts where it ends', () => {
    const d = outlinePath(shapeKindFor('decision').points(200, 120));
    return d.startsWith('M') && d.endsWith('Z') && !/NaN/.test(d);
  });

  check('a shape stands up by default and may be laid flat', (() => {
    const { doc } = normalizeDoc({
      version: 1,
      shapes: [
        { id: 'a', kind: 'process', pos: [0, 0] },
        { id: 'b', kind: 'process', pos: [8, 0], height: 0 },
        { id: 'c', kind: 'process', pos: [16, 0], height: 99 },
      ],
    });
    const [a, b, c] = doc.shapes;
    return a.height === 0.5 && b.height === 0 && c.height === 40 &&
      endpointBox(doc, 'a').ht === 0.5;
  })());

  check('a shape counts towards what the camera has to fit', (() => {
    const { doc } = normalizeDoc({
      version: 1,
      shapes: [{ id: 's', kind: 'process', pos: [10, 4], size: [6, 2] }],
    });
    const b = docBounds(doc);
    return b.x0 === 10 && b.y0 === 4 && b.x1 === 16 && b.y1 === 6;
  })());


  // --- data structures -------------------------------------------------------

  check('a structure survives a round trip, values and pointers alike', (() => {
    const { doc } = normalizeDoc({
      version: 1,
      cells: [{ id: 'a', label: 'a', pos: [2, 3], cols: 5, rows: 2, slot: [3, 2],
                items: ['3', '', '4'], indices: true, marks: [{ text: 'i', at: 2 }] }],
    });
    const again = normalizeDoc(JSON.parse(serializeDoc(doc))).doc;
    const c = again.cells[0];
    return (
      c.cols === 5 && c.rows === 2 && c.items.length === 3 && c.items[1] === '' &&
      c.indices === true && c.marks[0].text === 'i' && c.marks[0].at === 2 &&
      serializeDoc(doc) === serializeDoc(again)
    );
  })());

  check('a structure measures itself from its slots', (() => {
    const { doc } = normalizeDoc({
      version: 1,
      cells: [{ id: 'a', pos: [4, 1], cols: 5, rows: 3, slot: [3, 2] }],
    });
    const box = cellsBox(doc.cells[0]);
    const bounds = docBounds(doc);
    return box.w === 15 && box.h === 6 && bounds.x1 === 19 && bounds.y1 === 7;
  })());

  check('a connection may name a structure', (() => {
    const { doc } = normalizeDoc({
      version: 1,
      shapes: [{ id: 's', kind: 'process', pos: [0, 0] }],
      cells: [{ id: 'a', pos: [10, 0] }],
      edges: [{ id: 'e', from: 's', to: 'a' }],
    });
    return doc.edges.length === 1 && canConnect(doc, 'a');
  })());

  check('a structure with no columns asked for takes its length from its values', (() => {
    const { doc } = normalizeDoc({
      version: 1,
      cells: [{ id: 'a', pos: [0, 0], items: ['1', '2', '3'] }],
    });
    return doc.cells[0].cols === 3;
  })());

  check('a queue keeps the names of its ends and which way it runs', (() => {
    const { doc } = normalizeDoc({
      version: 1,
      cells: [{ id: 'q', pos: [0, 0], cols: 5, ends: ['Front', 'Back'], flow: 'back' }],
    });
    const again = normalizeDoc(JSON.parse(serializeDoc(doc))).doc.cells[0];
    return (
      again.ends[0] === 'Front' && again.ends[1] === 'Back' && again.flow === 'back' &&
      // An unknown direction is no direction rather than a broken one.
      normalizeDoc({ version: 1, cells: [{ id: 'q', pos: [0, 0], flow: 'sideways' }] })
        .doc.cells[0].flow === null
    );
  })());

  check('a pointer beyond the run is kept but bounded', (() => {
    const { doc } = normalizeDoc({
      version: 1,
      cells: [{ id: 'a', pos: [0, 0], cols: 3, marks: [{ text: 'x', at: -5 }, { at: 2 }] }],
    });
    // The negative index clamps; the one with no text is not a pointer at all.
    return doc.cells[0].marks.length === 1 && doc.cells[0].marks[0].at === 0;
  })());

  // --- the height a drag produces ------------------------------------------
  //
  // The mouse moves a block by whole storeys and by nothing else. Tenths are a
  // thing to type, and the inspector's field is where they are typed.

  check('a drag too small to mean a storey means nothing',
    heightFromDrag(1, 0, 1) === 1 &&
    heightFromDrag(1, CELL / 3, 1) === 1 &&
    heightFromDrag(1, -CELL / 3, 1) === 1);

  check('half a cell of travel is one storey',
    heightFromDrag(1, CELL * 0.6, 1) === 2 && heightFromDrag(3, -CELL * 0.6, 1) === 2);

  check('a drag never writes a fraction',
    [0.2, 0.49, 0.5, 0.8, 1.1, 1.49, 2.7, 5.3].every((cells) =>
      Number.isInteger(heightFromDrag(1, CELL * cells, 1))
    ));

  check('a fraction that was typed survives being dragged',
    heightFromDrag(1.5, CELL * 2, 1) === 3.5 && heightFromDrag(0.4, -CELL, 1) === 0);

  check('the same pixels are fewer storeys the further in the camera is',
    heightFromDrag(1, CELL * 3, 1) === 4 &&
    heightFromDrag(1, CELL * 3, 2) === 3 &&
    heightFromDrag(1, CELL * 3, 0.5) === 7);

  check('a height drag stays inside the bounds',
    heightFromDrag(2, -CELL * 9, 1) === 0 && heightFromDrag(1, CELL * 99, 1) === 40);
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

  /*
   * The Markdown the transcript renders.
   *
   * Only the parser is checked, which is deliberate: it is the half with all
   * the rules in it, and keeping it a pure function from text to a tree is what
   * lets the suite run here rather than in a browser.
   */

  /** Every piece of text in a span tree, concatenated. */
  const spanText = (spans) =>
    spans.map((s) => (s.type === 'text' ? s.text : s.spans ? spanText(s.spans) : s.text ?? '')).join('');
  /** The first span of a given type, anywhere in the tree. */
  const findSpan = (spans, type) => {
    for (const span of spans) {
      if (span.type === type) return span;
      const inner = span.spans && findSpan(span.spans, type);
      if (inner) return inner;
    }
    return null;
  };

  check('plain prose is one paragraph', (() => {
    const blocks = parseMarkdown('Just a sentence.');
    return blocks.length === 1 && blocks[0].type === 'p' && spanText(blocks[0].spans) === 'Just a sentence.';
  })());

  check('a blank line separates paragraphs', (() =>
    parseMarkdown('one\n\ntwo').length === 2)());

  check('a single newline stays a break rather than becoming a space', (() => {
    const [p] = parseMarkdown('one\ntwo');
    return p.spans.some((s) => s.type === 'break') && spanText(p.spans) === 'onetwo';
  })());

  check('emphasis nests inside strong', (() => {
    const [p] = parseMarkdown('a **bold *and italic* here**');
    const strong = findSpan(p.spans, 'strong');
    return !!strong && !!findSpan(strong.spans, 'em') && spanText(strong.spans) === 'bold and italic here';
  })());

  check('underscores inside a word are left alone', (() => {
    const [p] = parseMarkdown('the field user_id_value stays');
    return !findSpan(p.spans, 'em') && spanText(p.spans) === 'the field user_id_value stays';
  })());

  check('a lone asterisk between numbers is not emphasis', (() => {
    const [p] = parseMarkdown('2 * 3 * 4');
    return !findSpan(p.spans, 'em') && spanText(p.spans) === '2 * 3 * 4';
  })());

  check('a backslash hides a marker', (() => {
    const [p] = parseMarkdown('a \\*literal\\* star');
    return !findSpan(p.spans, 'em') && spanText(p.spans) === 'a *literal* star';
  })());

  check('inline code keeps its markers as text', (() => {
    const [p] = parseMarkdown('use `a **b** c` here');
    const code = findSpan(p.spans, 'code');
    return code?.text === 'a **b** c' && !findSpan(p.spans, 'strong');
  })());

  check('a fenced block keeps its language and its lines', (() => {
    const [block] = parseMarkdown('```json\n{\n  "a": 1\n}\n```');
    return block.type === 'code' && block.lang === 'json' && block.text === '{\n  "a": 1\n}';
  })());

  check('an unclosed fence still ends at the end of the text', (() => {
    const [block] = parseMarkdown('```\nleft open');
    return block.type === 'code' && block.text === 'left open';
  })());

  check('a heading carries its level', (() => {
    const [block] = parseMarkdown('### Third');
    return block.type === 'heading' && block.level === 3 && spanText(block.spans) === 'Third';
  })());

  check('a hash with no space is not a heading', (() =>
    parseMarkdown('#tag').every((b) => b.type === 'p'))());

  check('bullets become a tight list', (() => {
    const [list] = parseMarkdown('- one\n- two\n- three');
    return list.type === 'list' && !list.ordered && !list.loose && list.items.length === 3;
  })());

  check('a blank line between items makes the list loose', (() => {
    const [list] = parseMarkdown('- one\n\n- two');
    return list.loose && list.items.length === 2;
  })());

  check('an indented bullet nests inside the item above it', (() => {
    const [list] = parseMarkdown('- one\n  - inner\n- two');
    const nested = list.items[0].find((b) => b.type === 'list');
    return list.items.length === 2 && !!nested && spanText(nested.items[0][0].spans) === 'inner';
  })());

  check('a numbered list keeps where it started', (() => {
    const [list] = parseMarkdown('3. three\n4. four');
    return list.ordered && list.start === 3 && list.items.length === 2;
  })());

  check('three dashes are a rule, not a bullet', (() =>
    parseMarkdown('---')[0].type === 'rule')());

  check('a quote holds blocks of its own', (() => {
    const [quote] = parseMarkdown('> quoted\n>\n> - a bullet');
    return quote.type === 'quote' && quote.blocks.some((b) => b.type === 'list');
  })());

  check('a pipe table reads its cells and its alignment', (() => {
    const [table] = parseMarkdown('| a | b |\n| --- | ---: |\n| 1 | 2 |');
    return (
      table.type === 'table' &&
      table.align[1] === 'right' &&
      spanText(table.head[0]) === 'a' &&
      spanText(table.rows[0][1]) === '2'
    );
  })());

  check('a short table row is padded rather than shifted', (() => {
    const [table] = parseMarkdown('| a | b |\n| --- | --- |\n| 1 |');
    return table.rows[0].length === 2 && spanText(table.rows[0][1]) === '';
  })());

  check('pipes without the dashed line are just text', (() =>
    parseMarkdown('a | b | c')[0].type === 'p')());

  check('a link keeps its label and its target', (() => {
    const [p] = parseMarkdown('see [the docs](https://example.com/x) for more');
    const link = findSpan(p.spans, 'link');
    return link?.href === 'https://example.com/x' && spanText(link.spans) === 'the docs';
  })());

  check('a bare URL becomes a link', (() => {
    const [p] = parseMarkdown('at https://example.com/a.');
    const link = findSpan(p.spans, 'link');
    // The trailing full stop is a sentence ending, not part of the address.
    return link?.href === 'https://example.com/a' && spanText(p.spans).endsWith('.');
  })());

  check('a javascript: link is dropped to its label', (() => {
    const [p] = parseMarkdown('[click me](javascript:alert(1))');
    return !findSpan(p.spans, 'link') && spanText(p.spans) === 'click me';
  })());

  check('markup in the source never becomes markup in the tree', (() => {
    // The renderer builds text nodes, so the angle brackets have to survive
    // parsing as characters -- this is the half of that promise a test can see.
    const [p] = parseMarkdown('<script>alert(1)</script>');
    return p.type === 'p' && spanText(p.spans) === '<script>alert(1)</script>';
  })());

  check('empty and missing text parse to nothing', (() =>
    parseMarkdown('').length === 0 && parseMarkdown(null).length === 0)());

  // --- the desktop download ------------------------------------------------

  /*
   * The asset names a real release actually had.
   *
   * The point of the table in `data/downloads.js` is that it matches what the
   * bundler produces, and the only way that stays true is by checking it
   * against the real thing: a Tauri upgrade that renames `_x64-setup.exe` would
   * otherwise turn every Windows row into "not in this release", on a page
   * nobody tests by hand.
   */
  const RELEASE_ASSETS = [
    'latest.json',
    'Massing-0.1.3-1.aarch64.rpm',
    'Massing-0.1.3-1.aarch64.rpm.sig',
    'Massing-0.1.3-1.x86_64.rpm',
    'Massing-0.1.3-1.x86_64.rpm.sig',
    'Massing_0.1.3_aarch64.AppImage',
    'Massing_0.1.3_aarch64.AppImage.sig',
    'Massing_0.1.3_aarch64.dmg',
    'Massing_0.1.3_amd64.AppImage',
    'Massing_0.1.3_amd64.AppImage.sig',
    'Massing_0.1.3_amd64.deb',
    'Massing_0.1.3_amd64.deb.sig',
    'Massing_0.1.3_arm64-setup.exe',
    'Massing_0.1.3_arm64-setup.exe.sig',
    'Massing_0.1.3_arm64.deb',
    'Massing_0.1.3_arm64.deb.sig',
    'Massing_0.1.3_x64-setup.exe',
    'Massing_0.1.3_x64-setup.exe.sig',
    'Massing_0.1.3_x64.dmg',
    'Massing_aarch64.app.tar.gz',
    'Massing_aarch64.app.tar.gz.sig',
    'Massing_x64.app.tar.gz',
    'Massing_x64.app.tar.gz.sig',
  ].map((name) => ({ name, browser_download_url: `https://example.test/${name}` }));

  for (const platform of PLATFORMS) {
    const files = platformFiles(platform, RELEASE_ASSETS);
    check(
      `every ${platform.label} download is on a real release`,
      files.length > 0 && files.every((f) => f.url),
      files.filter((f) => !f.url).map((f) => `${f.label} (${f.note})`).join(', ')
    );
    check(
      `no ${platform.label} download is a signature file`,
      files.every((f) => !f.url?.endsWith('.sig'))
    );
  }

  check('a release missing a file offers no link for it', (() => {
    const windows = PLATFORMS.find((p) => p.id === 'windows');
    const only64 = RELEASE_ASSETS.filter((a) => !a.name.includes('arm64-setup'));
    const files = platformFiles(windows, only64);
    return files.filter((f) => f.url).length === 1 && files.some((f) => f.url === null);
  })());

  check('the system is read from what a browser reports', (() =>
    detectPlatform('Windows') === 'windows' &&
    detectPlatform('macOS') === 'macos' &&
    detectPlatform('Linux') === 'linux' &&
    detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)') === 'macos' &&
    detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)') === 'windows' &&
    detectPlatform('Mozilla/5.0 (X11; Linux x86_64)') === 'linux')());

  /*
   * A phone reports itself as Linux, and would otherwise be handed an arm64
   * AppImage it can download and never run.
   */
  check('a phone is not offered a desktop build', (() =>
    detectPlatform('Android') === null &&
    detectPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8)') === null &&
    detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)') === null &&
    detectPlatform('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)') === null)());

  check('an unrecognised system preselects nothing', (() =>
    detectPlatform('') === null && detectPlatform('SomeFutureOS') === null)());
}
