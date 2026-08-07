/**
 * Asking before loading the analytics script.
 *
 * The script is not on the page. A build that carries analytics carries a
 * `<meta>` naming the script instead, and nothing is fetched until someone
 * says yes — consent that arrives after the request has already gone out is
 * not consent, it is a notification.
 *
 * The answer is remembered, so the question is asked once and not on every
 * visit. Both answers are remembered: "no" is an answer, and re-asking someone
 * who has already declined is the behaviour that makes these banners hated.
 *
 * Nothing here runs in a build without the meta tag, which is every build
 * except the one deliberately made with `MASSING_ANALYTICS=1`.
 */

import { h } from '../util/dom.js';

const KEY = 'massing:analytics-consent';
const META = 'massing-analytics';
const GRANTED = 'granted';
const DENIED = 'denied';

/** The analytics script this build was made with, or null for every other build. */
export function analyticsSource(doc = document) {
  const content = doc.querySelector(`meta[name="${META}"]`)?.getAttribute('content');
  return content?.trim() || null;
}

/** @returns {'granted' | 'denied' | null} null when nobody has been asked yet. */
export function readConsent(storage) {
  try {
    const value = storage?.getItem(KEY);
    return value === GRANTED || value === DENIED ? value : null;
  } catch {
    return null; // storage walled off; treated as never asked
  }
}

export function writeConsent(storage, value) {
  try {
    storage?.setItem(KEY, value);
    return true;
  } catch {
    return false; // private mode, quota, a blocked origin
  }
}

/**
 * Storage that cannot throw.
 *
 * Reading `localStorage` at all raises in a few real configurations, and a
 * privacy banner that breaks the page when privacy settings are strict would
 * be a poor joke. When it is unavailable the answer lives for the session
 * only: asking once per visit is worse than asking once, and better than
 * asking twice in the same one.
 */
function safeStorage() {
  try {
    const probe = window.localStorage;
    probe.getItem(KEY);
    return probe;
  } catch {
    const memory = new Map();
    return {
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => memory.set(k, v),
    };
  }
}

export function createConsent({ root = document.body, storage = safeStorage(), doc = document } = {}) {
  const src = analyticsSource(doc);
  if (!src) return { destroy() {} }; // no analytics in this build; nothing to ask

  const answered = readConsent(storage);
  if (answered === GRANTED) {
    loadScript(src);
    return { destroy() {} };
  }
  if (answered === DENIED) return { destroy() {} };

  let banner = null;

  const decide = (value) => {
    writeConsent(storage, value);
    if (value === GRANTED) loadScript(src);
    banner?.remove();
    banner = null;
  };

  banner = h('div', {
    class: 'consent',
    role: 'dialog',
    // Not modal on purpose. The question is worth asking; it is not worth
    // holding the diagram hostage over, and a banner that traps focus on
    // arrival is the other thing people hate about them.
    'aria-modal': 'false',
    'aria-label': 'Analytics',
  }, [
    h('p', { class: 'consent-text' }, [
      'Count this visit? ',
      h('span', { class: 'consent-detail', text:
        'Page views only, no cookies and nothing that identifies you. The script is not loaded unless you say yes.' }),
    ]),
    h('div', { class: 'consent-actions' }, [
      h('button', { class: 'btn', type: 'button', text: 'No thanks', onClick: () => decide(DENIED) }),
      h('button', { class: 'btn btn-primary', type: 'button', text: 'Allow', onClick: () => decide(GRANTED) }),
    ]),
  ]);
  root.append(banner);

  return {
    destroy() {
      banner?.remove();
      banner = null;
    },
  };
}

function loadScript(src) {
  if (document.querySelector(`script[data-analytics]`)) return;
  const el = document.createElement('script');
  el.defer = true;
  el.src = src;
  el.setAttribute('data-analytics', '');
  document.head.append(el);
}
