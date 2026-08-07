/** Tiny DOM/SVG construction helpers -- the whole of our "view layer". */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Create an SVG element. `attrs` values of null/undefined/false are skipped. */
export function svg(tag, attrs = {}, children = []) {
  const el = document.createElementNS(SVG_NS, tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}

/** Create an HTML element. `class`, `text` and `html` are handled specially. */
export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}

export function setAttrs(el, attrs) {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) {
      el.removeAttribute(key);
      continue;
    }
    if (key === 'text') el.textContent = String(value);
    else if (key === 'html') el.innerHTML = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else el.setAttribute(key, value === true ? '' : String(value));
  }
  return el;
}

function append(el, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' || typeof child === 'number' ? String(child) : child);
  }
}

/**
 * Copy text to the clipboard.
 *
 * The async Clipboard API is blocked in plenty of ordinary situations -- a
 * denied permission, a document that lost focus, some `file://` contexts --
 * and the single-file bundle is meant to run from `file://`. So there is a
 * fallback through a throwaway textarea, which needs no permission at all.
 *
 * @returns {Promise<boolean>} whether the text actually reached the clipboard
 */
export async function copyText(text) {
  // `writeText` rejects with NotAllowedError whenever the document is not
  // focused -- which is exactly the state the page is in for a moment after a
  // native file dialog closes, i.e. right when an IO error toast appears.
  try {
    window.focus();
  } catch {
    // Not focusable (an embedded frame, say); the write may still succeed.
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Blocked or unavailable; try the legacy path below.
  }

  // The textarea has to be genuinely selectable: `opacity: 0` and
  // `display: none` both defeat execCommand, so it is merely tiny and dull.
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:none;' +
    'outline:none;box-shadow:none;background:transparent;';
  document.body.append(area);
  area.focus();
  area.select();
  area.setSelectionRange(0, text.length);

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

/** Trigger a browser download of a Blob. */
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

/** Toggle a class only when it needs to change. */
export function setClass(el, name, on) {
  el.classList.toggle(name, !!on);
}

/** Set an attribute only when the value actually differs. */
export function setAttr(el, name, value) {
  const next = String(value);
  if (el.getAttribute(name) !== next) el.setAttribute(name, next);
}

export function setText(el, value) {
  const next = String(value);
  if (el.textContent !== next) el.textContent = next;
}
