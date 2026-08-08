/**
 * Asking before loading the measurement scripts.
 *
 * They are not on the page. A build that carries them carries a `<meta>`
 * naming them instead, and nothing is fetched until someone says yes —
 * consent that arrives after the request has already gone out is not consent,
 * it is a notification.
 *
 * The tag names a list, because there is more than one script and they are one
 * decision: how many visits, and how quickly the page came up, are different
 * questions to answer and the same question to be asked.
 *
 * The answer is remembered, so the question is asked once and not on every
 * visit. Both answers are remembered: "no" is an answer, and re-asking someone
 * who has already declined is the behaviour that makes these banners hated.
 *
 * Nothing here runs in a build without the meta tag, which is every build
 * except the one deliberately made with `MASSING_VERCEL_FEATURES=1`.
 */

import { h } from '../util/dom.js';

const KEY = 'massing:analytics-consent';
const META = 'massing-analytics';
const GRANTED = 'granted';
const DENIED = 'denied';

/** The scripts this build was made with; empty for every other build. */
export function analyticsSources(doc = document) {
  const content = doc.querySelector(`meta[name="${META}"]`)?.getAttribute('content') ?? '';
  return content.split(/\s+/).filter(Boolean);
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
  const sources = analyticsSources(doc);
  if (!sources.length) return { destroy() {} }; // nothing in this build to ask about

  const answered = readConsent(storage);
  if (answered === GRANTED) {
    sources.forEach(loadScript);
    return { destroy() {} };
  }
  if (answered === DENIED) return { destroy() {} };

  let banner = null;

  const decide = (value) => {
    writeConsent(storage, value);
    if (value === GRANTED) sources.forEach(loadScript);
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
        'Page views and how quickly the page loaded. No cookies, nothing that identifies you, ' +
        'and nothing is fetched unless you say yes.' }),
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
  // Matched on the value rather than through a selector, so a path with
  // anything awkward in it needs no escaping.
  const already = [...document.querySelectorAll('script[data-analytics]')]
    .some((el) => el.dataset.analytics === src);
  if (already) return;
  const el = document.createElement('script');
  el.defer = true;
  el.src = src;
  el.setAttribute('data-analytics', src);
  document.head.append(el);
}
