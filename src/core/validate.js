/**
 * What is wrong with a diagram, as opposed to what is wrong with its JSON.
 *
 * The loader in `schema.js` answers the second question: it repairs what it can
 * and reports what it repaired. It says nothing about whether the drawing can
 * be read, because that is not a loader's business — a file with a block hidden
 * behind another one is a perfectly well-formed file.
 *
 * This module is the other half, and it exists twice over for one reason: it
 * used to live only as 337 lines of JavaScript quoted inside the authoring
 * prompt, which meant the in-editor assistant paid for it in tokens on every
 * single turn — a third of a 15,000-token system prompt — and could not run it.
 * As a module it is a tool the assistant calls, and the prompt it was cut from
 * gets shorter for the assistant while staying whole for anyone pasting it into
 * a chat window.
 *
 * Three levels, and the difference matters because it decides what a caller
 * does with each:
 *
 *   ERROR  the render is visibly broken — a hidden block, a dropped edge
 *   WARN   the drawing is uglier than it needs to be
 *   INFO   counts, for reference
 *
 * Everything here is pure and dependency-free, so it runs unchanged in the
 * browser, in a function and in a test. The one import is `link.js`, which is
 * pure for the same reason and holds the single definition of what a link means
 * — checking it against a second copy of those rules written out here is how
 * the validator and the editor come to disagree.
 */

import { parseLink, LINK_SYNTAX } from './link.js';

/** Footprint of a flat thing as [x0, y0, x1, y1]. */
const box = (o) => {
  const [w, h] = o.size ?? [2, 2];
  const [x, y] = o.pos ?? [0, 0];
  return [x, y, x + w, y + h];
};
const rectBox = (g) => [g.rect[0], g.rect[1], g.rect[0] + g.rect[2], g.rect[1] + g.rect[3]];
const rectsIntersect = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
/** Unset means the component type decides, and those run 1 to 3. */
const heightOf = (n) => (Number.isFinite(n.height) ? n.height : 2);

const LABEL_PLANES = new Set(['floor', 'screen', 'left', 'right']);

/** Every id in one drawing, for resolving links across a whole file. */
const idsIn = (view) =>
  ['nodes', 'groups', 'edges', 'texts', 'images', 'shapes', 'cells']
    .flatMap((key) => view?.[key] ?? [])
    .map((entity) => entity?.id)
    .filter(Boolean);

/**
 * A caption that names a group of things rather than one thing.
 *
 * Cannot be proved from the JSON, so it warns rather than fails — but the
 * false positives are rare and what it catches is severe: a single block
 * captioned "External APIs" is usually six components that never got drawn.
 */
const CATCH_ALL_CAPTION =
  /^(external|externals|other|others|etc|misc|infra|3rd[- ]party|third[- ]party|various|integrations?)\b|(apis|services|systems|clients|providers|externals|integrations)$/i;

/**
 * Exported because the assistant's tool result says this too, immediately,
 * without waiting to be asked. One regex, two places that speak up.
 */
export function isCatchAllCaption(label) {
  const text = String(label ?? '').trim();
  return Boolean(text) && CATCH_ALL_CAPTION.test(text);
}

/** Base64 to text, in a browser or in Node, without caring which. */
function decodeBase64(b64) {
  try {
    if (typeof atob === 'function') {
      const binary = atob(b64);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
    // eslint-disable-next-line no-undef
    return Buffer.from(b64, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

/** [hue in degrees, lightness 0-1] of a #rrggbb colour. */
function hsl(hex) {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return [(((h * 60) % 360) + 360) % 360, (max + min) / 2];
}

const hueGap = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** Does the segment p-q touch rectangle r? Liang-Barsky. */
function cuts([x0, y0], [x1, y1], [rx0, ry0, rx1, ry1]) {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  for (const [p, q] of [[-dx, x0 - rx0], [dx, rx1 - x0], [-dy, y0 - ry0], [dy, ry1 - y0]]) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

const side = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Whether a `tab:` link names one of the drawings in the file. */
function namesDrawing(link, names) {
  const wanted = link.name.trim().toLowerCase();
  if (names.some((name) => (name ?? '').trim().toLowerCase() === wanted)) return true;
  return link.index !== null && link.index >= 0 && link.index < names.length;
}

/**
 * Check one drawing.
 *
 * @param {object} view a document, or one tab out of one
 * @param {{ids: Set<string>, tabs: string[]} | null} file
 *   What the rest of the file holds, when there is a rest of the file to know
 *   about. Links are the only thing here that can reach outside one drawing, so
 *   they are the only thing that needs it: without it, an element link to a
 *   sibling drawing is unprovable and warns; with it, it is decidable and either
 *   passes or fails. Everything else — collisions, occlusion, zone membership —
 *   is true or false within one picture and ignores this entirely.
 * @returns {{errors: string[], warnings: string[], infos: string[]}}
 */
export function validateDrawing(view = {}, file = null) {
  const groups = view.groups ?? [];
  const nodes = view.nodes ?? [];
  const edges = view.edges ?? [];
  const texts = view.texts ?? [];
  const images = view.images ?? [];
  const shapes = view.shapes ?? [];
  const cells = view.cells ?? [];

  const errors = [];
  const warnings = [];
  const infos = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);
  const info = (m) => infos.push(m);

  // --- identifiers ---------------------------------------------------------
  const seen = new Set();
  for (const o of [...groups, ...nodes, ...edges, ...texts, ...images, ...shapes, ...cells]) {
    if (o.id == null) continue;
    if (seen.has(o.id)) err(`duplicate id "${o.id}" — the loader renames it with a suffix`);
    seen.add(o.id);
  }
  // A flowchart shape is as connectable as a block or a zone.
  const anchors = new Set([...groups, ...nodes, ...shapes, ...cells].map((o) => o.id));
  for (const e of edges) {
    for (const end of ['from', 'to']) {
      if (!anchors.has(e[end])) {
        err(`edge ${e.id ?? `${e.from}->${e.to}`} has ${end}="${e[end]}", which does not ` +
            'exist — this edge is dropped silently');
      }
    }
  }

  // --- coordinates ---------------------------------------------------------
  // Negative coordinates are fine — the origin is not a corner of the world —
  // but a fractional one is not, and the loader rounds it somewhere nobody
  // asked for.
  for (const o of [...nodes, ...texts, ...images, ...shapes, ...cells]) {
    const p = Array.isArray(o.pos) ? o.pos : [];
    if (p.some((v) => !Number.isInteger(v))) err(`${o.id} pos is not integral`);
    // A note's size is one number, a block's and a picture's is [w, h].
    if (Array.isArray(o.size) && o.size.some((v) => !Number.isInteger(v) || v <= 0)) {
      err(`${o.id} size must be positive integers`);
    }
  }
  for (const g of groups) {
    if (!g.rect?.every(Number.isInteger)) err(`zone ${g.id} rect is not integral`);
  }

  // --- block collisions ----------------------------------------------------
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (rectsIntersect(box(nodes[i]), box(nodes[j]))) {
        err(`blocks overlap: ${nodes[i].id} / ${nodes[j].id}`);
      }
    }
  }

  // --- zone membership, with a cell of margin all round --------------------
  for (const n of nodes) {
    if (!n.group) continue;
    const g = groups.find((x) => x.id === n.group);
    if (!g) {
      err(`${n.id} names group "${n.group}", which does not exist`);
      continue;
    }
    const [gx0, gy0, gx1, gy1] = rectBox(g);
    const [x0, y0, x1, y1] = box(n);
    if (!(x0 > gx0 && y0 > gy0 && x1 < gx1 && y1 < gy1)) {
      err(`${n.id} is not inside zone ${g.id} with a cell of margin — membership is geometric`);
    }
  }

  // --- sibling zones may nest, but must not half-overlap -------------------
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = rectBox(groups[i]);
      const b = rectBox(groups[j]);
      if (!rectsIntersect(a, b)) continue;
      const aInB = a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];
      const bInA = b[0] >= a[0] && b[1] >= a[1] && b[2] <= a[2] && b[3] <= a[3];
      if (!aInB && !bInA) {
        warn(`zones ${groups[i].id} and ${groups[j].id} partially overlap — nest fully or separate fully`);
      }
    }
  }

  // --- occlusion -----------------------------------------------------------
  for (const f of nodes) {
    for (const b of nodes) {
      if (f === b) continue;
      const [fx0, fy0, fx1, fy1] = box(f);
      const [bx0, by0, bx1, by1] = box(b);
      const fh = heightOf(f);
      const bh = heightOf(b);
      if (fh <= bh) continue; // no taller, so it can never hide it
      if (fx0 + fy0 <= bx0 + by0) continue; // not in front
      if (fx1 - fy0 < bx0 - by1 || bx1 - by0 < fx0 - fy1) continue; // side by side
      const slack = fx0 + fy0 - (bx1 + by1);
      const need = 2 * (fh - bh);
      if (slack < need) {
        err(`${f.id} hides ${b.id} — needs ${need} of x+y clearance, has ${slack}`);
      }
    }
  }

  // --- pictures ------------------------------------------------------------
  for (const im of images) {
    if ((im.plane ?? 'floor') === 'floor') {
      for (const n of nodes) {
        if (rectsIntersect(box(im), box(n))) warn(`image ${im.id} lies on top of block ${n.id}`);
      }
      info(`image ${im.id} lies flat; for a logo, left/right usually reads better`);
    }
    const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(im.src ?? '');
    if (!m) {
      if (im.src && !/^https?:\/\//.test(im.src)) {
        err(`image ${im.id} src is neither a data URL nor http`);
      }
      continue;
    }
    if (m[1] !== 'image/svg+xml') continue;
    const svg = decodeBase64(m[2]);
    if (!/<svg[\s>]/.test(svg)) {
      err(`image ${im.id} does not decode to SVG`);
      continue;
    }
    // A glyph-less plate is judged by path-data volume, not by shape count:
    // measured, an empty plate is ~125 characters and a real logo 450-700.
    const shapes = (svg.match(/<(path|polygon|circle|rect|polyline|ellipse)[\s>]/g) ?? []).length;
    const chars = [...svg.matchAll(/\sd="([^"]*)"/g)].reduce((s, x) => s + x[1].length, 0);
    if (shapes <= 2 && chars < 250) {
      warn(`image ${im.id} has ${shapes} shapes and ${chars} characters of path data — ` +
           'probably a glyph-less plate. Look at it');
    }
    if (/width="1em"/.test(svg)) {
      warn(`image ${im.id} says width="1em" — it renders blurry at 16px`);
    }
  }

  // --- captions ------------------------------------------------------------
  for (const n of nodes) {
    if (!n.labelPlane) warn(`${n.id} has no labelPlane — its caption lies skewed on the floor`);
    else if (!LABEL_PLANES.has(n.labelPlane)) {
      err(`${n.id} labelPlane "${n.labelPlane}" is not a known plane`);
    } else if (n.labelPlane === 'screen') {
      warn(`${n.id} has labelPlane "screen" — that sits on top of the picture, not in it. Use left or right`);
    }
    if (n.label && [...n.label].length > 12) {
      warn(`${n.id} caption is ${[...n.label].length} characters ("${n.label}") — ` +
           'cut it to a proper noun of ten or fewer');
    }
  }
  for (const g of groups) {
    if (!g.label?.trim()) {
      warn(`zone ${g.id} has no caption — the renderer prints its kind name instead`);
    }
  }

  // --- catch-alls, which is how a diagram loses two thirds of the system ---
  for (const n of nodes) {
    const label = (n.label ?? '').trim();
    if (label && CATCH_ALL_CAPTION.test(label)) {
      warn(`${n.id} is captioned "${label}" — that reads as several components folded into ` +
           'one. Draw each of them, named');
    }
  }

  // --- notes ---------------------------------------------------------------
  for (const t of texts) {
    if (t.plane === 'screen') {
      warn(`note ${t.id} is pinned to the viewer — a note belongs on the floor of the scene`);
    }
    // Floor text is foreshortened, so the 14px default is unreadable there.
    if ((t.plane ?? 'floor') === 'floor' && (t.size ?? 14) < 40) {
      warn(`note ${t.id} is ${t.size ?? 14}px on the floor — 50 is what it takes to read`);
    }
  }
  for (const e of edges) {
    if (e.label?.trim() && (e.labelSize ?? 12) < 24) {
      warn(`edge ${e.id ?? `${e.from}->${e.to}`} has a caption at ${e.labelSize ?? 12}px — raise it to 30`);
    }
  }

  // --- zone contrast -------------------------------------------------------
  for (const g of groups) {
    const parent = groups.find((p) => p.id === g.parent);
    if (!parent || !/^#[0-9a-f]{6}$/i.test(g.color ?? '') || !/^#[0-9a-f]{6}$/i.test(parent.color ?? '')) {
      continue;
    }
    const [gh, gl] = hsl(g.color);
    const [ph, pl] = hsl(parent.color);
    // A nested zone is painted over its parent and captioned in a shade of
    // itself, so a near hue makes both the slab edge and the caption vanish.
    if (hueGap(gh, ph) < 40 && Math.abs(gl - pl) < 0.25) {
      warn(`zone ${g.id} (${g.color}) is too close to its parent ${parent.id} (${parent.color}) — ` +
           `${Math.round(hueGap(gh, ph))}° of hue apart. Nested zones need a quarter turn`);
    }
  }

  // --- connections you can follow ------------------------------------------
  const anchorOf = (id) => {
    const n = nodes.find((x) => x.id === id);
    if (n) return box(n);
    const g = groups.find((x) => x.id === id);
    return g ? rectBox(g) : null;
  };
  const mid = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

  for (const e of edges) {
    const a = anchorOf(e.from);
    const b = anchorOf(e.to);
    if (!a || !b) continue;
    const [p, q] = [mid(a), mid(b)];
    // The two elbows the router chooses between: along x first, or along y.
    const elbows = [[p, [q[0], p[1]], q], [p, [p[0], q[1]], q]];
    const blockedBy = elbows.map((path) =>
      nodes
        .filter((n) => n.id !== e.from && n.id !== e.to &&
          (cuts(path[0], path[1], box(n)) || cuts(path[1], path[2], box(n))))
        .map((n) => n.id)
    );
    // Only when BOTH routes are obstructed is the line certain to vanish
    // behind something; the router takes whichever passes through fewer.
    if (blockedBy.every((hit) => hit.length)) {
      warn(`edge ${e.id ?? `${e.from}->${e.to}`} runs under ` +
           `${[...new Set(blockedBy.flat())].join(', ')} whichever way it turns — move a block`);
    }
  }

  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const [x, y] = [edges[i], edges[j]];
      // Meeting at a block is fine; only a genuine crossing is a problem.
      if ([x.from, x.to].some((id) => id === y.from || id === y.to)) continue;
      const [a, b, c, d] = [anchorOf(x.from), anchorOf(x.to), anchorOf(y.from), anchorOf(y.to)];
      if (!a || !b || !c || !d) continue;
      const [p, q, r, s] = [mid(a), mid(b), mid(c), mid(d)];
      const straddles =
        (side(p, q, r) > 0) !== (side(p, q, s) > 0) &&
        (side(r, s, p) > 0) !== (side(r, s, q) > 0);
      if (straddles) {
        warn(`edges ${x.id ?? `${x.from}->${x.to}`} and ${y.id ?? `${y.from}->${y.to}`} cross — ` +
             'at this density that means two blocks are in the wrong order');
      }
    }
  }

  for (const o of [...nodes, ...groups, ...edges]) {
    if (o.labelSize != null && (o.labelSize < 6 || o.labelSize > 96)) {
      err(`${o.id} labelSize ${o.labelSize} is outside the valid range, 6 to 96`);
    }
  }

  // --- uniformity, which is what the good diagrams have in common ----------
  const sizes = new Set(nodes.map((n) => (n.size ?? [2, 2]).join('x')));
  if (sizes.size > 2) warn(`${sizes.size} distinct block sizes — one uniform [2,2] reads better`);
  if (nodes.some((n) => heightOf(n) > 1)) {
    warn('heights above 1 in use — 0 and 1 alone remove occlusion entirely');
  }
  const labelSizes = new Set(nodes.map((n) => n.labelSize ?? 12));
  if (labelSizes.size > 2) {
    warn(`${labelSizes.size} distinct block labelSizes — peers should share one`);
  }
  const titles = groups.filter((g) => (g.labelSize ?? 12) >= 80).length;
  if (titles > 1) warn(`${titles} very large zone titles — they fight each other, so keep one`);

  // --- connection density --------------------------------------------------
  if (nodes.length) {
    const ratio = edges.length / nodes.length;
    if (ratio > 0.5) {
      warn(`${edges.length} edges over ${nodes.length} nodes = ${ratio.toFixed(2)} — ` +
           'aim for 0.33. Sharing a zone needs no edge');
    }
    const degree = {};
    for (const e of edges) {
      degree[e.from] = (degree[e.from] ?? 0) + 1;
      degree[e.to] = (degree[e.to] ?? 0) + 1;
    }
    for (const [id, d] of Object.entries(degree)) {
      if (d > 5) warn(`${id} has ${d} edges — a sign the grouping needs rework`);
    }
  }

  // --- links ---------------------------------------------------------------
  //
  // A link is the one property whose correctness is invisible in the render: a
  // typo in an id draws exactly like a link that works, and the first anyone
  // hears of it is a click that goes nowhere -- usually in front of a room. So
  // every one is resolved here.
  //
  // Only `#element` links can be checked within a drawing. A `tab:` link is
  // about the file rather than the drawing, so `validateDocument` below is where
  // it is answered; a web address is somebody else's server to answer for.
  const linked = [...nodes, ...groups, ...edges, ...texts, ...images, ...shapes, ...cells]
    .filter((o) => o.link);
  for (const o of linked) {
    const link = parseLink(o.link);
    if (!link) continue;

    if (link.kind === 'unknown') {
      err(`${o.id} has link "${o.link}", which is not one — write ${LINK_SYNTAX}`);
      continue;
    }

    if (link.kind === 'element') {
      if (seen.has(link.id)) continue;
      if (!file) {
        // Checked on its own, one drawing cannot know whether the id it names
        // lives in a sibling. Handed the whole file, it can, and does below.
        warn(`${o.id} links to "#${link.id}", which is not in this drawing — ` +
             'it has to be in another one, or the link goes nowhere');
      } else if (!file.ids.has(link.id)) {
        err(`${o.id} links to "#${link.id}", which is nowhere in this file`);
      }
      continue;
    }

    if (link.kind === 'tab' && file) {
      if (!file.tabs.length) {
        err(`${o.id} links to "tab:${link.name}", and this file holds one drawing`);
      } else if (!namesDrawing(link, file.tabs)) {
        err(`${o.id} links to "tab:${link.name}", and no drawing in this file is called that`);
      }
    }
  }
  if (linked.length) info(`${linked.length} linked element(s)`);

  info(`${nodes.length} blocks · ${edges.length} connections · ${groups.length} zones · ` +
       `${images.length} pictures · ${texts.length} notes`);

  return { errors, warnings, infos };
}

/**
 * Check a whole file, which may hold several drawings.
 *
 * Each tab is checked on its own and its findings prefixed with its name: ids
 * and coordinates only ever have to agree within one drawing, so merging them
 * would invent clashes nobody can see.
 */
export function validateDocument(doc = {}) {
  const tabbed = Array.isArray(doc.tabs) && doc.tabs.length;
  const drawings = tabbed
    ? doc.tabs.map((t, i) => [t, `${t.name ?? `tab ${i + 1}`}: `])
    : [[doc, '']];

  /*
   * What every drawing in the file may link to.
   *
   * Empty `tabs` for a plain file is the answer rather than a missing one: a
   * document with one drawing has nowhere to switch to, and a `tab:` link in it
   * is a link that cannot work however it is spelled.
   */
  const file = {
    ids: new Set(drawings.flatMap(([view]) => idsIn(view))),
    tabs: tabbed ? doc.tabs.map((t, i) => t.name ?? `tab ${i + 1}`) : [],
  };

  const errors = [];
  const warnings = [];
  const infos = [];
  for (const [view, where] of drawings) {
    const found = validateDrawing(view, file);
    errors.push(...found.errors.map((m) => where + m));
    warnings.push(...found.warnings.map((m) => where + m));
    infos.push(...found.infos.map((m) => where + m));
  }
  return { errors, warnings, infos };
}

/**
 * The findings as the text a model reads.
 *
 * Levels are labelled rather than merely ordered, because what a caller should
 * do about each differs and a flat list hides that. The closing line is a
 * verdict rather than a count: "PASSED with 3 warnings" is a different
 * instruction from "FAILED", and a model skimming the end of a tool result
 * should not have to add up the lines to find out which it got.
 */
export function formatReport({ errors, warnings, infos }) {
  const lines = [
    ...errors.map((m) => `ERROR  ${m}`),
    ...warnings.map((m) => `WARN   ${m}`),
    ...infos.map((m) => `INFO   ${m}`),
  ];
  lines.push(
    errors.length
      ? `FAILED: ${errors.length} error(s), ${warnings.length} warning(s). ` +
        'An ERROR means the picture is visibly broken — fix those and send the document again.'
      : `PASSED (${warnings.length} warning(s)). ` +
        'A WARN makes the diagram uglier rather than broken; fix unless you can name the reason.'
  );
  return lines.join('\n');
}
