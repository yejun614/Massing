/**
 * Markdown, as far as a chat transcript needs it.
 *
 * The assistant answers in Markdown whether or not anybody asked it to — a
 * model writes `**this**` and a bulleted list the way it writes sentences — and
 * a panel that shows the asterisks is asking the reader to compile the answer
 * in their head. So the transcript renders it.
 *
 * Written here rather than pulled in, because the whole editor has no
 * dependencies and ships as one file: a Markdown library is several times the
 * size of everything in `src/util` put together, and what a chat bubble needs
 * of one is a paragraph, a list, a heading, a code block and four inline marks.
 *
 * Two halves on purpose. `parseMarkdown` is a pure function from text to a tree
 * of plain objects, so the parsing — which is all of the fiddly part — is
 * testable in Node with no DOM at all. `renderMarkdown` turns that tree into
 * elements, and is the only half that touches `document`.
 *
 * Nothing here ever builds HTML from a string. The tree is walked into real
 * nodes with `textContent`, so a model that replies with a `<script>` tag has
 * written five words about a script tag and not a script tag.
 */

import { h } from './dom.js';

/** An opening or closing code fence, and whatever language it was labelled. */
const MD_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const MD_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/;
const MD_RULE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const MD_QUOTE = /^ {0,3}> ?/;
/** A bullet or a number, its indentation, and the rest of the line. */
const MD_ITEM = /^( *)([-*+]|\d{1,9}[.)])( +|$)(.*)$/;
/** The `|---|:--:|` line, which is the only thing that makes a table a table. */
const MD_TABLE_RULE = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const MD_AUTOLINK = /^https?:\/\/[^\s<>[\]()]*[^\s<>[\]().,;:!?'"]/;
/** Punctuation a backslash may hide. */
const MD_ESCAPABLE = '\\`*_{}[]()#+-.!>~|';

/**
 * Text into blocks.
 *
 * @param {string} source
 * @returns {Array<object>} paragraph/heading/list/code/quote/table/rule nodes
 */
export function parseMarkdown(source) {
  return markdownBlocks(String(source ?? '').replace(/\r\n?/g, '\n').split('\n'));
}

function markdownBlocks(lines) {
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = MD_FENCE.exec(line);
    if (fence) {
      const body = [];
      i += 1;
      while (i < lines.length && !markdownClosesFence(lines[i], fence[1])) body.push(lines[i++]);
      // Past the closing fence — or past the end, for a block nobody closed.
      i += 1;
      blocks.push({ type: 'code', lang: fence[2].trim().split(/\s+/)[0] ?? '', text: body.join('\n') });
      continue;
    }

    const heading = MD_HEADING.exec(line);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        spans: markdownInline(heading[2] ?? ''),
      });
      i += 1;
      continue;
    }

    // Before the list, because `- - -` is a rule and `-` is a bullet.
    if (MD_RULE.test(line)) {
      blocks.push({ type: 'rule' });
      i += 1;
      continue;
    }

    if (MD_QUOTE.test(line)) {
      const inner = [];
      while (i < lines.length && MD_QUOTE.test(lines[i])) inner.push(lines[i++].replace(MD_QUOTE, ''));
      blocks.push({ type: 'quote', blocks: markdownBlocks(inner) });
      continue;
    }

    if (line.includes('|') && MD_TABLE_RULE.test(lines[i + 1] ?? '')) {
      const table = markdownTable(lines, i);
      blocks.push(table.block);
      i = table.next;
      continue;
    }

    if (MD_ITEM.test(line)) {
      const list = markdownList(lines, i);
      blocks.push(list.block);
      i = list.next;
      continue;
    }

    const paragraph = [];
    while (i < lines.length && !markdownInterrupts(lines, i)) paragraph.push(lines[i++]);
    blocks.push({ type: 'p', spans: markdownInline(paragraph.join('\n')) });
  }

  return blocks;
}

/** Whether a line ends the paragraph running into it. */
function markdownInterrupts(lines, i) {
  const line = lines[i];
  if (!line.trim()) return true;
  if (MD_FENCE.test(line) || MD_HEADING.test(line) || MD_RULE.test(line)) return true;
  if (MD_QUOTE.test(line) || MD_ITEM.test(line)) return true;
  return line.includes('|') && MD_TABLE_RULE.test(lines[i + 1] ?? '');
}

/** A fence closes on the same character, at least as long, and nothing else. */
function markdownClosesFence(line, open) {
  const trimmed = line.trim();
  return (
    trimmed.length >= open.length &&
    trimmed.split('').every((c) => c === open[0]) &&
    /^ {0,3}\S/.test(line)
  );
}

/**
 * A list, and everything nested under it.
 *
 * Nesting is not handled here at all: an item's continuation lines are the ones
 * indented past its marker, and those get their indentation removed and are
 * parsed as blocks in their own right. A sub-list is then just a list that
 * happened to be found inside an item, and the same code draws it.
 */
function markdownList(lines, start) {
  const head = markdownMarker(lines[start]);
  const items = [];
  let i = start;
  let loose = false;
  let blank = false;

  while (i < lines.length) {
    if (!lines[i].trim()) {
      blank = true;
      i += 1;
      continue;
    }

    const marker = markdownMarker(lines[i]);
    // A shallower marker, a switch from bullets to numbers, or anything that is
    // not an item at all: this list is over and the caller takes it from here.
    if (!marker || marker.indent > head.indent + 1 || marker.ordered !== head.ordered) break;
    // A blank line anywhere between two items makes the whole list loose, which
    // is Markdown's way of saying "these are paragraphs, space them out".
    if (blank && items.length) loose = true;
    blank = false;

    const body = [marker.text];
    const inside = marker.indent + marker.width;
    i += 1;
    while (i < lines.length) {
      const next = lines[i];
      if (!next.trim()) {
        // A blank line belongs to the item only if the item carries on after
        // it; otherwise it is the gap before whatever comes next.
        const after = lines[i + 1];
        if (after && after.trim() && markdownIndent(after) >= inside) {
          body.push('');
          i += 1;
          continue;
        }
        break;
      }
      if (markdownIndent(next) >= inside) {
        body.push(next.slice(inside));
        i += 1;
        continue;
      }
      // An under-indented line is still this item's paragraph running on —
      // unless it starts something, in which case the item has ended.
      if (markdownInterrupts(lines, i)) break;
      body.push(next.trim());
      i += 1;
    }
    items.push(markdownBlocks(body));
  }

  return {
    block: { type: 'list', ordered: head.ordered, start: head.start, loose, items },
    next: i,
  };
}

/** The bullet or number a line opens with, or null. */
function markdownMarker(line) {
  const m = MD_ITEM.exec(line);
  if (!m || MD_RULE.test(line)) return null;
  const ordered = /\d/.test(m[2]);
  return {
    indent: m[1].length,
    // An empty item has no space after its marker, but its content still starts
    // one column further in.
    width: m[2].length + (m[3].length || 1),
    ordered,
    start: ordered ? Number(m[2].slice(0, -1)) : 1,
    text: m[4],
  };
}

function markdownIndent(line) {
  return line.length - line.trimStart().length;
}

/**
 * A pipe table.
 *
 * Only the shape GitHub writes: a header row, the dashes that declare it one,
 * and rows until the pipes stop. Alignment is read because a column of numbers
 * that has asked to be right-aligned looks wrong any other way.
 */
function markdownTable(lines, start) {
  const head = markdownRow(lines[start]);
  const align = markdownRow(lines[start + 1]).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return left ? 'left' : null;
  });

  const rows = [];
  let i = start + 2;
  while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
    rows.push(markdownRow(lines[i]));
    i += 1;
  }

  return {
    block: {
      type: 'table',
      align,
      head: head.map(markdownInline),
      // Ragged rows are normalised to the header's width: a row with a cell
      // missing should lose the cell, not shift every column after it.
      rows: rows.map((row) => head.map((_, col) => markdownInline(row[col] ?? ''))),
    },
    next: i,
  };
}

/** One table row into cells, honouring `\|` as a pipe rather than a divider. */
function markdownRow(line) {
  const cells = [];
  let cell = '';
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && body[i + 1] === '|') {
      cell += '|';
      i += 1;
    } else if (body[i] === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += body[i];
    }
  }
  cells.push(cell.trim());
  return cells;
}

/**
 * One run of text into inline spans.
 *
 * A left-to-right scan rather than one large alternation, because the rules
 * that matter here are about what sits *next to* a marker — `_` in the middle
 * of `user_id` is a character and `_` after a space is emphasis — and a regex
 * that could express that could not be read afterwards.
 */
function markdownInline(text) {
  const spans = [];
  let plain = '';
  const flush = () => {
    if (plain) spans.push({ type: 'text', text: plain });
    plain = '';
  };

  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const rest = text.slice(i);

    if (c === '\\' && MD_ESCAPABLE.includes(text[i + 1])) {
      plain += text[i + 1];
      i += 2;
      continue;
    }

    // Every newline inside a paragraph is kept. This is not what Markdown says
    // — it folds them into spaces — but a chat message is typed with the line
    // breaks the writer meant, and losing them reflows their answer.
    if (c === '\n') {
      flush();
      spans.push({ type: 'break' });
      i += 1;
      continue;
    }

    if (c === '`') {
      const code = /^(`+)([^]+?)\1(?!`)/.exec(rest);
      if (code) {
        flush();
        spans.push({ type: 'code', text: markdownCodeText(code[2]) });
        i += code[0].length;
        continue;
      }
    }

    if (c === '[' || (c === '!' && text[i + 1] === '[')) {
      // The destination may hold one level of balanced parentheses, which is
      // what a Wikipedia address is made of and the only nesting worth reading.
      const link = /^!?\[([^\]]*)\]\([ \t]*<?((?:[^\s()<>]|\([^\s()]*\))*)>?(?:[ \t]+"[^"]*")?[ \t]*\)/.exec(rest);
      if (link) {
        const href = markdownHref(link[2]);
        const label = markdownInline(link[1] || link[2]);
        flush();
        // An image is shown as a link to it. The panel floats over the drawing
        // and a remote image would both reflow it and reach the network, which
        // is not something an answer should be able to decide.
        if (href) spans.push({ type: 'link', href, spans: label });
        else spans.push(...label);
        i += link[0].length;
        continue;
      }
    }

    if (c === 'h') {
      const bare = MD_AUTOLINK.exec(rest);
      if (bare) {
        flush();
        spans.push({ type: 'link', href: bare[0], spans: [{ type: 'text', text: bare[0] }] });
        i += bare[0].length;
        continue;
      }
    }

    if (c === '~' && text[i + 1] === '~') {
      const close = markdownClose(text, i + 2, '~~', false);
      if (close >= 0) {
        flush();
        spans.push({ type: 'strike', spans: markdownInline(text.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
    }

    if (c === '*' || c === '_') {
      // `_` only opens at a word boundary, so `snake_case_names` survive.
      if (c === '*' || markdownAtEdge(text[i - 1])) {
        const marker = text[i + 1] === c ? c + c : c;
        const close = markdownClose(text, i + marker.length, marker, c === '_');
        if (close >= 0) {
          flush();
          spans.push({
            type: marker.length === 2 ? 'strong' : 'em',
            spans: markdownInline(text.slice(i + marker.length, close)),
          });
          i = close + marker.length;
          continue;
        }
      }
    }

    plain += c;
    i += 1;
  }

  flush();
  return spans;
}

/**
 * Where the run opened at `from` closes, or -1.
 *
 * The two conditions are the ones that stop ordinary prose turning into italics
 * halfway through: a run may not open onto whitespace (`2 * 3 * 4`), and may
 * not close after it (`a *b `).
 */
function markdownClose(text, from, marker, wordSafe) {
  if (!text[from] || /\s/.test(text[from])) return -1;
  for (let j = from; j < text.length; j++) {
    if (text[j] === '\\') {
      j += 1;
      continue;
    }
    if (!text.startsWith(marker, j)) continue;
    if (/\s/.test(text[j - 1])) continue;
    // A single marker inside a doubled one belongs to the stronger run.
    if (marker.length === 1 && text[j + 1] === marker) continue;
    if (wordSafe && !markdownAtEdge(text[j + marker.length])) continue;
    return j;
  }
  return -1;
}

/** Start of the text, end of it, whitespace or punctuation — i.e. not a word. */
function markdownAtEdge(ch) {
  return ch === undefined || /[\s!-/:-@[-`{-~]/.test(ch);
}

/** ``` `` a ` b `` ``` holds "a ` b": one padding space each side comes off. */
function markdownCodeText(raw) {
  if (raw.length > 2 && raw.startsWith(' ') && raw.endsWith(' ') && raw.trim()) {
    return raw.slice(1, -1);
  }
  return raw;
}

/**
 * A link the panel is willing to follow.
 *
 * An allowlist rather than a blocklist: the text came from a model, `javascript:`
 * is a script the reader would run by clicking a word, and there is no scheme
 * beyond these three that an answer in a diagram editor needs.
 */
function markdownHref(href) {
  const url = String(href).trim();
  return /^(https?:|mailto:)/i.test(url) ? url : null;
}

/**
 * A parsed tree into elements.
 *
 * @param {string} text Markdown source
 * @returns {DocumentFragment}
 */
export function renderMarkdown(text) {
  const frag = document.createDocumentFragment();
  for (const block of parseMarkdown(text)) frag.append(markdownNode(block));
  return frag;
}

function markdownNode(block) {
  switch (block.type) {
    case 'heading':
      // Never `h1`: the panel is a section of a page that has its own heading
      // structure, and an answer cannot be allowed to outrank it.
      return h(`h${Math.min(6, block.level + 2)}`, {}, markdownSpans(block.spans));
    case 'code':
      return h('pre', { class: block.lang ? `md-code lang-${block.lang}` : 'md-code' }, [
        h('code', { text: block.text }),
      ]);
    case 'quote':
      return h('blockquote', {}, block.blocks.map(markdownNode));
    case 'rule':
      return h('hr');
    case 'list':
      return markdownListNode(block);
    case 'table':
      return markdownTableNode(block);
    default:
      return h('p', {}, markdownSpans(block.spans));
  }
}

function markdownListNode(block) {
  const list = h(block.ordered ? 'ol' : 'ul', {
    // Only when it differs, so the common case leaves no attribute behind.
    start: block.ordered && block.start !== 1 ? String(block.start) : null,
  });
  for (const item of block.items) {
    // A tight list drops the paragraph wrappers, which is the whole visible
    // difference between the two kinds: single-spaced lines rather than blocks.
    const content = block.loose
      ? item.map(markdownNode)
      : item.flatMap((child) => (child.type === 'p' ? markdownSpans(child.spans) : [markdownNode(child)]));
    list.append(h('li', {}, content));
  }
  return list;
}

function markdownTableNode(block) {
  const cell = (tag) => (spans, col) =>
    h(tag, { style: block.align[col] ? `text-align:${block.align[col]}` : null }, markdownSpans(spans));
  const table = h('table', {}, [
    h('thead', {}, [h('tr', {}, block.head.map(cell('th')))]),
    h('tbody', {}, block.rows.map((row) => h('tr', {}, row.map(cell('td'))))),
  ]);
  // A table is the one block that will not narrow to fit a 300px panel, so it
  // scrolls inside itself rather than widening everything around it.
  return h('div', { class: 'md-scroll' }, [table]);
}

function markdownSpans(spans) {
  return spans.map((span) => {
    switch (span.type) {
      case 'strong':
        return h('strong', {}, markdownSpans(span.spans));
      case 'em':
        return h('em', {}, markdownSpans(span.spans));
      case 'strike':
        return h('del', {}, markdownSpans(span.spans));
      case 'code':
        return h('code', { text: span.text });
      case 'link':
        // Opened away from the editor, and told nothing about it: a diagram
        // with unsaved edits must not be replaced by whatever was linked.
        return h('a', {
          href: span.href,
          target: '_blank',
          rel: 'noopener noreferrer',
        }, markdownSpans(span.spans));
      case 'break':
        return h('br');
      default:
        return span.text;
    }
  });
}
