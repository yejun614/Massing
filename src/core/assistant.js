/**
 * Talking to a model about the diagram on screen.
 *
 * The conversation is the browser's. `/api/chat` is a proxy that keeps the key
 * off the client and puts the authoring rules in front of every turn; it holds
 * nothing between calls. What that buys is the important part: when the model
 * asks to change the diagram, the change is applied *here*, to the document
 * actually open, through the same store and the same undo history as a change
 * made by hand. Undo works on it. Reload does not lose it. The model is another
 * editor of the document, not the owner of a copy.
 *
 * A turn is therefore a loop rather than a request: send, and if the answer is
 * a tool call, run it, append the result, and send again. It ends when the
 * model replies with words, or when the loop has gone round enough times that
 * something is clearly wrong.
 */

import { serializeDoc, normalizeDoc } from './schema.js';
import { validateDocument, formatReport, isCatchAllCaption } from './validate.js';
import { DEFAULT_TIER, isTier, tierFor } from '../data/models.js';

const SESSIONS_KEY = 'massing:chat:v1';

/**
 * Which of the three models to ask.
 *
 * Kept apart from the conversations and outside any of them, because it is a
 * preference about the tool rather than a property of a chat: someone who
 * turned the model up did so because of the work they are doing that
 * afternoon, and having it drop back to Light on the next conversation would
 * be the wrong half of the guess.
 */
const MODEL_KEY = 'massing:chat:model:v1';

/**
 * How many tool calls one question may make.
 *
 * Read, write, read again to check, write again is four, and that is a model
 * working carefully. Past about eight it is a model stuck in a loop, and the
 * cost of finding out is a real bill, so the loop stops and says so.
 */
const MAX_STEPS = 8;

/** Sessions kept, newest first. Old conversations are not worth a quota crash. */
const MAX_SESSIONS = 20;

/**
 * How many drawings the assistant may leave in one file.
 *
 * Not a rule about files — somebody clicking `+` can have as many tabs as they
 * like, and that is their file to fill. It is a rule about a model in a loop:
 * `add_tab` is the one tool here that *accumulates*, and eight is already more
 * drawings than any one question has ever needed.
 */
const MAX_TABS = 8;

/**
 * The house rule the loader cannot enforce, said back in the tool result.
 *
 * Written into the prompt, it is advice a model agrees with and then overspends
 * anyway — measured against the live model, six diagrams out of six came back
 * over the limit, averaging a connection per block instead of one per three.
 * Said *here* it is feedback inside the loop, arriving after the mistake with
 * the arithmetic already done, which the model is told to fix and send again.
 *
 * Advisory, not a refusal: the edit is applied either way. Someone may have
 * asked for exactly those connections, and a style rule is not grounds for
 * throwing away a document that loads.
 *
 * It says which way to cut, because the first version did not and the model
 * found the other one: asked for a load balancer, two web servers and a
 * database, it came back under budget by drawing a single web server. Losing a
 * block someone asked for is a worse answer than the tangle this prevents.
 *
 * The threshold is the validator's, not a second opinion — over one per two
 * complains, one per three is the target it names.
 */
export function overConnected(doc) {
  const blocks = doc.nodes.length;
  const lines = doc.edges.length;
  if (!blocks || lines / blocks <= 0.5) return null;
  const budget = Math.max(1, Math.floor(blocks / 3));
  return (
    `Too many connections: ${lines} for ${blocks} blocks. The budget is one per ` +
    `three, so cut it to ${budget}. Delete connections, never blocks: every block ` +
    `stays exactly as it is. What to remove is whatever repeats something the ` +
    `grouping already says — a load balancer's second arm, two servers reaching ` +
    `the same database. Send the document again with those lines gone.`
  );
}

/**
 * The other half of that budget, and the failure it turned out to cause.
 *
 * `overConnected` says "you drew too many lines", and the prompt says it a
 * dozen more ways. Measured against the live model, that lands as "draw less"
 * full stop: asked for a Spring Boot service with MySQL, Redis, S3, a vector
 * store, an LLM, a payment gateway and an OCR API behind it, six runs out of
 * six came back with three to six blocks and one of them captioned
 * "External APIs". Tidy, and wrong about most of the system.
 *
 * So the loop says this one too, for the same reason it says the other: prose
 * in the prompt is advice a model agrees with and then ignores, and a sentence
 * in the tool result is feedback arriving after the mistake with the counting
 * already done.
 *
 * The two halves are deliberately asymmetric. A plural caption is a real
 * defect in any document, so it is named whenever it appears. A thin diagram
 * is only suspicious when the model has just drawn a whole system from
 * nothing — on an edit, three blocks is three blocks someone asked for, and
 * nagging about it would make "make these blue" grow the drawing.
 */
/**
 * Where a first draft stops being plausible as a whole system.
 *
 * Not a number picked for feel: the prompt's own defaults table says 12 to 20
 * blocks, measured off a diagram that was hand-tuned until it read well. A
 * first draft in single figures is therefore below the project's own stated
 * target, and worth one question.
 */
const THIN_FIRST_DRAFT = 10;

export function underDrawn(doc, { fromScratch = false } = {}) {
  const said = [];

  const vague = doc.nodes
    .map((n) => String(n.label ?? '').trim())
    .filter((label) => isCatchAllCaption(label));
  if (vague.length) {
    said.push(
      `${vague.length} block(s) are captioned as a group of things rather than as one ` +
        `thing: ${vague.map((l) => `"${l}"`).join(', ')}. A plural caption is several ` +
        `components that never got named, and it is how a diagram loses most of the ` +
        `system it was meant to show. Draw one block for each, named for the vendor or ` +
        `the product, and send the document again.`
    );
  }

  // Only on a first draft, and against the target the prompt already names.
  // Twelve to twenty blocks is what a system diagram is said to be, so a first
  // draft in single figures is worth one question — which a genuinely small
  // system can wave away, at the cost of a sentence.
  if (fromScratch && doc.nodes.length < THIN_FIRST_DRAFT) {
    said.push(
      `Only ${doc.nodes.length} block(s) for a whole system. Before you answer, go back ` +
        `over the inventory: every running process, every datastore, every external ` +
        `service the code calls, every client that calls it. If the system really is ` +
        `that small, ignore this line — but if anything was left out to keep the ` +
        `picture tidy, put it back. The budget is on connections, never on components.`
    );
  }

  return said.length ? said.join('\n') : null;
}

/**
 * Blocks that name a zone they are not standing in.
 *
 * The loader checks that a \`group\` exists and stops there, which is right for
 * a loader — where the block is drawn is a question about the picture, not
 * about whether the file is well formed. But it leaves the assistant with no
 * way to hear about the one defect that most obviously breaks a diagram:
 * membership here is geometric, so a block whose \`pos\` puts it outside the
 * rectangle is simply drawn outside it, orphaned next to a slab that was meant
 * to contain it. The validator in the authoring guide calls this an ERROR;
 * this is that check, in the loop, where the model can act on it.
 *
 * It arrived with the coverage rules, and that is not a coincidence. A model
 * drawing six blocks places them all correctly; the same model drawing nine
 * starts pushing one off the edge, so the fix for one failure surfaced the
 * next one.
 */
export function misplaced(doc) {
  const rects = new Map((doc.groups ?? []).map((g) => [g.id, g.rect]));
  const strays = [];

  for (const node of doc.nodes ?? []) {
    if (!node.group) continue;
    const rect = rects.get(node.group);
    // A group that does not exist is the loader's complaint, already made.
    if (!rect) continue;
    const [gx, gy, gw, gh] = rect;
    const [x, y] = node.pos ?? [0, 0];
    const [w, h] = node.size ?? [2, 2];
    if (x > gx && y > gy && x + w < gx + gw && y + h < gy + gh) continue;
    strays.push(
      `"${node.id}" covers [${x}, ${y}]–[${x + w}, ${y + h}] but zone "${node.group}" ` +
        `covers [${gx}, ${gy}]–[${gx + gw}, ${gy + gh}]`
    );
  }

  if (!strays.length) return null;
  return (
    `${strays.length} block(s) name a zone they are not inside: ${strays.join('; ')}. ` +
    `Membership is geometric — the block is drawn where its pos puts it, outside the ` +
    `slab, and the zone does not move to collect it. Move the block inside with a cell ` +
    `of margin on every side, or make the zone big enough to hold it, and send the ` +
    `document again.`
  );
}

/** How long a change stays lit after the assistant makes it. */
const HIGHLIGHT_MS = 3200;

/**
 * What actually changed between two documents, by id.
 *
 * The assistant replaces the whole document every time, so "what did it do"
 * cannot be read off the call — it has to be worked out by comparing. Anything
 * new, and anything whose contents differ, is something to point at; everything
 * else was carried across unchanged and pointing at it would be noise.
 */
export function touchedIds(before, after) {
  const index = (doc) => {
    const map = new Map();
    for (const kind of ['nodes', 'groups', 'edges', 'texts', 'images']) {
      for (const entity of doc?.[kind] ?? []) map.set(entity.id, JSON.stringify(entity));
    }
    return map;
  };
  const was = index(before);
  const now = index(after);
  const changed = [];
  for (const [id, shape] of now) {
    if (was.get(id) !== shape) changed.push(id);
  }
  // A document rewritten from nothing is entirely new, and lighting every
  // block up says less than lighting none of them.
  return changed.length === now.size && was.size === 0 ? [] : changed;
}

/**
 * The selection, described for a model that cannot see the screen.
 *
 * Sent with the question rather than fetched by a tool call: "make these three
 * blue" is unanswerable without it, and a round trip to ask which ones were
 * meant is a round trip the person is waiting through.
 */
export function describeSelection(doc, selection) {
  if (!selection?.length) return null;
  const find = (id) => {
    for (const [kind, list] of [
      ['block', doc.nodes], ['zone', doc.groups], ['connection', doc.edges],
      ['note', doc.texts], ['picture', doc.images],
    ]) {
      const found = list?.find((e) => e.id === id);
      if (found) return `${id} (${kind}${found.label ? `, "${found.label}"` : ''})`;
    }
    return id;
  };
  return selection.map(find).join(', ');
}

/**
 * A whole diagram typed into the reply instead of passed through the tool.
 *
 * Not a rare mishap — it is what the authoring guide's own first line asks
 * for: *reply with the JSON document and nothing else*. That instruction is
 * right for the model in a chat window pasting into the editor by hand, and
 * the addendum a few thousand words later tells the assistant to use the tool
 * instead. A model that weighs the opening line more heavily is not
 * malfunctioning, it is obeying the louder of two instructions, and the
 * lighter the model the more often it does.
 *
 * Left unhandled it is the worst failure in the panel: the person sees a wall
 * of JSON, the diagram does not change, and nothing says why. So the document
 * is taken from wherever it arrives. A fenced block counts — models add the
 * fence back however often they are told not to.
 *
 * @returns {string | null} the JSON text, or null if this is just a reply.
 */
export function documentInReply(content) {
  const text = String(content ?? '').trim();
  if (!text) return null;
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(text);
  const body = (fenced ? fenced[1] : text).trim();
  // Cheap gate first: parsing every chat reply as JSON to find out it is prose
  // is work done on every turn to catch a minority of them.
  if (!body.startsWith('{') || !body.endsWith('}')) return null;
  try {
    JSON.parse(body);
  } catch {
    return null;
  }
  return body;
}

/** A short, stable id without pulling in anything to generate one. */
function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * A name for a conversation, taken from how it opened.
 *
 * The first thing someone types is almost always what the conversation is
 * about, which beats numbering them and beats asking a model to name it.
 */
function titleFrom(text) {
  const line = String(text ?? '').trim().split('\n')[0];
  return line.length > 48 ? `${line.slice(0, 47)}…` : line || 'New conversation';
}

// ---------------------------------------------------------------------------
// Stored sessions
// ---------------------------------------------------------------------------

export function readSessions() {
  try {
    const raw = JSON.parse(localStorage.getItem(SESSIONS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((s) => s?.id && Array.isArray(s.messages)) : [];
  } catch {
    return [];
  }
}

/**
 * The remembered model choice, checked against what this build offers.
 *
 * A tier that no longer exists — a stored `"turbo"` from a build that had one —
 * reads as the default rather than as an error, and the next write cleans it
 * up. Storage that outlives a release has to be read that way.
 */
export function readTier() {
  try {
    const stored = localStorage.getItem(MODEL_KEY);
    return isTier(stored) ? stored : DEFAULT_TIER;
  } catch {
    return DEFAULT_TIER;
  }
}

export function writeTier(tier) {
  try {
    localStorage.setItem(MODEL_KEY, tier);
    return true;
  } catch {
    return false;
  }
}

export function writeSessions(sessions) {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
    return true;
  } catch {
    // Quota, or storage walled off. The conversation on screen still works; it
    // just will not be there tomorrow.
    return false;
  }
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

/**
 * @param {{store: object, commands?: object, tabs?: object}} deps
 *   `tabs` is the file the open drawing belongs to. Absent, `add_tab` refuses
 *   and the assistant works on the one document, which is what it always did.
 */
export function createAssistant({ store, commands, library, tabs, fetchImpl = fetch } = {}) {
  let sessions = readSessions();
  /**
   * Conversations belong to the diagram they were about.
   *
   * A chat that says "move the database left" is meaningless against a
   * different document, and a flat list of every conversation ever held is a
   * list you scroll rather than one you use. Sessions carry the library entry
   * they were started against, and the panel only offers that diagram's.
   */
  const mine = () => sessions.filter((s) => !library || s.diagramId === library.currentId);
  let currentId = mine()[0]?.id ?? null;
  let tier = readTier();
  /**
   * Notes made before there was a conversation to put them in.
   *
   * Not persisted: they describe a choice whose record, once a conversation
   * exists, lives in that conversation. `startSession` moves them across.
   */
  let preface = [];
  let busy = false;
  const listeners = new Set();

  const announce = () => {
    for (const listener of listeners) listener();
  };

  function current() {
    return sessions.find((s) => s.id === currentId) ?? null;
  }

  /** Follow the open diagram: its conversations, and none of anyone else's. */
  function retarget() {
    const belongs = current()?.diagramId;
    if (belongs !== undefined && belongs === library?.currentId) return;
    currentId = mine()[0]?.id ?? null;
    announce();
  }
  library?.subscribe?.(retarget);

  function persist() {
    writeSessions(sessions);
    announce();
  }

  /**
   * Point at what just changed, then stop pointing at it.
   *
   * The assistant replaces the whole document, so without this the diagram
   * simply *is* different and finding out how is on the reader. The timer is
   * replaced rather than stacked: two edits in a row should leave the second
   * one lit for its full time, not the remainder of the first one's.
   */
  let highlightTimer = 0;
  function highlight(ids) {
    clearTimeout(highlightTimer);
    store.setUI({ aiTouched: ids });
    if (!ids.length) return;
    highlightTimer = setTimeout(() => store.setUI({ aiTouched: [] }), HIGHLIGHT_MS);
  }

  /**
   * A question waiting on the person, and the promise the loop is parked on.
   *
   * Not persisted. A question is only meaningful while the turn that asked it
   * is still running, and a turn does not survive a reload — so a conversation
   * reopened tomorrow shows the question that was asked and the answer that was
   * given, both of which are in `messages`, and nothing left hanging.
   */
  let pending = null;

  function askPerson(question, options) {
    return new Promise((resolve) => {
      pending = {
        question,
        options,
        settle(reply) {
          pending = null;
          resolve(reply);
          announce();
        },
      };
      announce();
    });
  }

  function startSession(firstMessage) {
    const session = {
      id: newId(),
      title: titleFrom(firstMessage),
      at: Date.now(),
      diagramId: library?.currentId ?? null,
      // Whatever was noted before there was anywhere to note it.
      messages: preface.splice(0),
    };
    sessions = [session, ...sessions].slice(0, MAX_SESSIONS);
    currentId = session.id;
    return session;
  }

  /**
   * A drawing the model sent, parsed and put through the loader — or a refusal.
   *
   * Both tools that take a document share this, because the ways one arrives
   * wrong have nothing to do with where it is going: the same JSON, the same
   * wrapper mistake, the same loader. Only the sentence about the wrapper
   * differs, since the way out of it depends on which tool was called.
   *
   * @returns {{doc?: object, warnings?: string[], refusal?: string}}
   */
  function readDocument(incoming, wrapped) {
    /*
     * The document arrives as JSON text, because that is the only way to ask
     * for "a document of the shape you were taught" through a function schema
     * that cannot express it. An object is accepted too: a model that sends
     * one has done nothing wrong, and refusing it would be pedantry.
     */
    if (typeof incoming === 'string') {
      try {
        incoming = JSON.parse(incoming);
      } catch (err) {
        return { refusal: `Refused: \`document\` is not valid JSON — ${err.message}` };
      }
    }
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return { refusal: 'Refused: `document` must be a complete .arch.json document.' };
    }
    /*
     * A whole file where a drawing was asked for.
     *
     * The editor holds one drawing at a time, so a document wrapped in `tabs`
     * would put a file where the renderer expects a picture. It is refused
     * rather than unwrapped: unwrapping would silently discard every tab but
     * one, and the model is the only thing here that knows which it meant.
     */
    if (Array.isArray(incoming.tabs)) {
      return { refusal: `Refused: \`document\` is wrapped in \`tabs\`. ${wrapped}` };
    }
    const parsed = normalizeDoc(incoming);
    if (parsed.rejection) return { refusal: `Refused: that is not a diagram — ${parsed.rejection}` };
    return { doc: parsed.doc, warnings: parsed.warnings };
  }

  /**
   * What the model reads after a document lands somewhere.
   *
   * The repairs first, because they are problems in what it sent and it is
   * about to write a reply saying the edit worked; then the counts, so a
   * drawing that lost half its blocks to a typo is visible without asking for
   * it back; then the house rules the loader cannot enforce.
   */
  function documentReport(doc, { opening, subject, warnings, fromScratch }) {
    const lines = [];
    if (warnings.length) {
      lines.push(
        `${opening}, with ${warnings.length} thing(s) the loader had to repair.`,
        'These are problems in what you sent. Fix them and send the document again:',
        ...warnings.map((w) => `- ${w}`)
      );
    } else {
      lines.push(`${opening}.`);
    }
    lines.push(
      `${subject} has ${doc.nodes.length} blocks, ${doc.groups.length} zones, ` +
      `${doc.edges.length} connections, ${doc.texts.length} notes.`
    );
    const overspent = overConnected(doc);
    if (overspent) lines.push(overspent);
    const thin = underDrawn(doc, { fromScratch });
    if (thin) lines.push(thin);
    const strays = misplaced(doc);
    if (strays) lines.push(strays);
    return lines.join('\n');
  }

  /**
   * Carry out one tool call against the open document.
   *
   * The result string is what the model reads next, so it is written for a
   * reader rather than as a status code: a refusal says what was wrong with
   * what it sent, and an acceptance names what the loader had to repair, so the
   * next turn can fix it instead of reporting success.
   */
  async function runTool(name, args) {
    if (name === 'get_diagram') {
      return serializeDoc(store.state.doc);
    }

    /*
     * Run against the document on screen, never against one passed in.
     *
     * The point of checking is to find out about the drawing the person is
     * looking at. A model that could hand over its own copy would be checking
     * what it believes it sent, which is the belief in question — and the
     * loader may have repaired what it sent on the way in.
     */
    if (name === 'validate_diagram') {
      return formatReport(validateDocument(store.state.doc));
    }

    /*
     * The one tool whose result comes from the person rather than the document.
     *
     * It exists because the assistant cannot see anything the person has not
     * typed — not a repository, not a URL, not a disk. Without a way to ask, a
     * model handed a GitHub link draws what the name suggests, and what comes
     * back is a picture that says AWS about a service on Oracle Cloud. Being
     * able to ask turns that into a question, which is the honest answer.
     *
     * The loop simply stops here until it is answered. That is the point: the
     * model is mid-turn, the tool result it is waiting for is what somebody
     * clicks, and everything else about the turn carries on unchanged.
     */
    if (name === 'ask_user') {
      const question = String(args?.question ?? '').trim();
      if (!question) return 'Refused: `question` is required.';
      const options = (Array.isArray(args?.options) ? args.options : [])
        .map((o) => String(o ?? '').trim())
        .filter(Boolean)
        .slice(0, 6);
      return askPerson(question, options);
    }

    if (name === 'replace_diagram') {
      const read = readDocument(
        args?.document,
        'Send the one drawing that is open, as a plain document with `nodes` at ' +
          'the top level. To put a second drawing beside it, call `add_tab`.'
      );
      if (read.refusal) return read.refusal;
      // Worked out before the swap, or there is nothing left to compare with.
      const touched = touchedIds(store.state.doc, read.doc);
      // Read before the swap too: whether this was a whole system drawn from
      // nothing is what decides if a thin result is worth remarking on.
      const fromScratch = store.state.doc.nodes.length === 0;
      // Through the store, so it is one undo away like any other edit.
      store.replaceDoc(read.doc, 'Assistant edit');
      commands?.zoomFit?.();
      highlight(touched);
      return documentReport(read.doc, {
        opening: 'Applied',
        subject: 'The diagram now',
        warnings: read.warnings,
        fromScratch,
      });
    }

    /*
     * A second drawing, beside the first, in the file already open.
     *
     * This exists because of what a model does without it. Asked for a system
     * too big for one picture — the case the authoring rules answer with "two
     * diagrams" — it writes a whole new *file*: both drawings wrapped in
     * `tabs`, handed over as a replacement for what the person had. That is not
     * its call to make. The file may be on disk, it may hold drawings the model
     * has never seen, and swapping it for a two-drawing copy loses them without
     * anybody being asked.
     *
     * A tab is the same intention at a size that fits: the file stays theirs,
     * every other drawing in it is untouched, and the way to undo it is to
     * close the tab. So the wrapper stays refused and this is the way through.
     */
    if (name === 'add_tab') {
      if (!tabs) return 'Refused: this editor holds one drawing and cannot add another.';
      const label = String(args?.name ?? '').trim();
      if (!label) {
        return 'Refused: `name` is required — name the tab after what it shows, ' +
          'such as "Write path" or "Failover".';
      }
      if (tabs.count >= MAX_TABS) {
        return `Refused: the file already holds ${tabs.count} drawings, which is as ` +
          'many as this tool will add. Work in one of them, or ask the person to ' +
          'make room.';
      }
      const read = readDocument(
        args?.document,
        'Send the one new drawing, as a plain document with `nodes` at the top level.'
      );
      if (read.refusal) return read.refusal;
      /*
       * Whether this tab is the system or a view of it — read before the swap,
       * while the store still holds the drawing they were looking at.
       *
       * It decides whether a thin result is worth remarking on. A second tab
       * beside a drawn system is a failover path or a write path, and four
       * blocks is the right size for one; telling it to go back over the
       * inventory would be pushing the whole system into every view.
       */
      const firstDrawing = store.state.doc.nodes.length === 0;
      tabs.add(read.doc);
      tabs.rename(tabs.active, label);
      // No `zoomFit` here, unlike the edit above: arriving at a tab already
      // frames what is on it, and asking twice would fight the animation.
      //
      // Nothing here was *changed*, and the highlight from the last edit points
      // at ids in the drawing they have just been moved away from.
      highlight([]);
      return documentReport(read.doc, {
        opening: `Added "${label}" as a new tab, and switched to it`,
        subject: 'The new tab',
        warnings: read.warnings,
        fromScratch: firstDrawing,
      });
    }

    return `Refused: there is no tool called "${name}".`;
  }

  /** One exchange with the proxy. Throws with a readable message on failure. */
  async function callModel(messages) {
    const response = await fetchImpl('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // The tier, never a model id: which model a tier means is the server's
      // to decide, and a deployment may have pinned it to something else.
      body: JSON.stringify({ messages, model: tier }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? `The assistant failed (${response.status}).`);
    return body;
  }

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get busy() {
      return busy;
    },
    /** Which of the three models the next question goes to. */
    get tier() {
      return tier;
    },
    /**
     * Change it. Mid-turn is refused rather than queued: the turn already in
     * flight would finish on the old model, and a control that lies about
     * which model is answering is worse than one that waits.
     */
    setTier(next) {
      if (!isTier(next) || next === tier || busy) return false;
      tier = next;
      writeTier(tier);
      /*
       * Say in the transcript what was chosen, and what it means.
       *
       * Three words on a button cannot carry the difference between these
       * models, and the difference is the entire reason to have the control:
       * one of them will not draw a system from a description and the label
       * "Light" does not say so. It goes in the log rather than in a tooltip
       * because the log is where the consequences will show up, and because
       * scrolling back to find where the answers changed character is exactly
       * the question this line answers.
       */
      const chosen = tierFor(tier);
      const note = { role: 'note', content: `${chosen.label} — ${chosen.hint}` };
      const session = current();
      if (session) {
        session.messages.push(note);
        persist();
      } else {
        // Nothing to append to yet. Held until a conversation starts, so
        // choosing a model before typing still leaves a record of the choice.
        preface.push(note);
        announce();
      }
      return true;
    },
    /** The question the turn is parked on, or null. */
    get pending() {
      return pending && { question: pending.question, options: pending.options };
    },
    /**
     * Answer it, and let the turn carry on.
     *
     * An empty answer is still an answer — someone dismissing the question is
     * telling the model to get on with it, and the model needs to hear that as
     * words rather than as silence, or it asks again.
     */
    answer(text) {
      if (!pending) return false;
      const said = String(text ?? '').trim();
      pending.settle(
        said || 'The person did not answer. Choose the most reasonable default, say which way you went, and carry on.'
      );
      return true;
    },
    get sessions() {
      return mine();
    },
    get currentId() {
      return currentId;
    },
    /**
     * Only the turns worth showing: what was said, not the plumbing.
     *
     * `ask_user` is the exception that makes this more than a filter. Its
     * question lives inside a tool call and its answer inside a tool result —
     * both plumbing by the rule above, and both plainly part of the
     * conversation. A transcript that dropped them would show an assistant
     * changing its mind for no stated reason.
     */
    get visible() {
      const out = [];
      const asked = new Map();
      // Before the first question there is no conversation, and the notes
      // about which model will answer it are still waiting to be housed.
      for (const message of current()?.messages ?? preface) {
        if (message.role === 'note') {
          out.push(message);
          continue;
        }
        if (message.role === 'tool') {
          const question = asked.get(message.tool_call_id);
          if (question && message.content?.trim()) {
            out.push({ role: 'answer', content: message.content });
          }
          continue;
        }
        if (message.content?.trim()) out.push({ role: message.role, content: message.content });
        for (const call of message.tool_calls ?? []) {
          if (call.function?.name !== 'ask_user') continue;
          let question = '';
          try {
            question = JSON.parse(call.function.arguments || '{}').question ?? '';
          } catch {
            question = '';
          }
          if (!question) continue;
          asked.set(call.id, question);
          out.push({ role: 'ask', content: question });
        }
      }
      return out;
    },

    select(id) {
      if (mine().some((s) => s.id === id)) {
        currentId = id;
        announce();
      }
    },
    startNew() {
      currentId = null;
      announce();
    },
    remove(id) {
      sessions = sessions.filter((s) => s.id !== id);
      if (currentId === id) currentId = mine()[0]?.id ?? null;
      persist();
    },

    /**
     * Ask something, and run whatever the answer asks for.
     *
     * @returns {Promise<{ok: boolean, error?: string}>}
     */
    /**
     * @param {{selection?: string[]}} context  what was selected when asked.
     */
    async ask(text, { selection } = {}) {
      const question = String(text ?? '').trim();
      if (!question || busy) return { ok: false };
      busy = true;

      const attached = describeSelection(store.state.doc, selection);
      const session = current() ?? startSession(question);
      // Appended to the question rather than sent as its own turn: it is part
      // of what was asked, and a conversation reloaded tomorrow should still
      // show why the answer was about those particular blocks.
      session.messages.push({
        role: 'user',
        content: attached ? `${question}\n\n[Selected in the editor: ${attached}]` : question,
      });
      session.at = Date.now();
      persist();

      try {
        for (let step = 0; step < MAX_STEPS; step++) {
          const { message } = await callModel(session.messages);
          session.messages.push(message);
          persist();

          const calls = message.tool_calls ?? [];
          if (!calls.length) {
            /*
             * A turn that ends in words is normally the end of the turn — but
             * a model that wrote the whole document into those words meant to
             * change the diagram, and dropping it on the floor would leave the
             * person reading JSON at an unchanged drawing. Applied through the
             * same tool, so it lands in the same store with the same undo.
             */
            const typed = documentInReply(message.content);
            if (typed) {
              const outcome = await runTool('replace_diagram', { document: typed });
              // The reply becomes what happened, because the JSON is now on the
              // canvas and reprinting it in the transcript says nothing.
              message.content = outcome.startsWith('Refused')
                ? `${outcome}\n\nThe document was in the reply rather than sent through the tool, and it could not be applied.`
                : outcome;
              persist();
            }
            return { ok: true };
          }

          for (const call of calls) {
            let args = {};
            try {
              args = JSON.parse(call.function.arguments || '{}');
            } catch {
              // Malformed arguments are the model's mistake to correct, so they
              // come back as a tool result rather than as an exception here.
              session.messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: 'Refused: the arguments were not valid JSON.',
              });
              continue;
            }
            session.messages.push({
              role: 'tool',
              tool_call_id: call.id,
              // Awaited, because `ask_user` parks here until somebody clicks.
              content: await runTool(call.function.name, args),
            });
          }
          persist();
        }
        const stuck = 'The assistant kept working without finishing. Stopped it there.';
        session.messages.push({ role: 'assistant', content: stuck });
        persist();
        return { ok: false, error: stuck };
      } catch (err) {
        return { ok: false, error: err.message };
      } finally {
        busy = false;
        announce();
      }
    },
  };
}
