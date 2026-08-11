/**
 * Following a link.
 *
 * Three destinations, three quite different things to do, and the reason they
 * live together is that the click does not know which it is until the link has
 * been resolved against the file:
 *
 *   another element   the camera flies to it — see `commands.focusOn`
 *   another drawing   the tab is switched, framed by the tab machinery itself
 *   a website         a sheet asks first, then a new tab
 *
 * Only the third asks. Moving the camera and changing tab are both reversible
 * by looking, and a confirmation in front of either would make a diagram with
 * links in it tiresome to read — which is the failure mode that ends with
 * nobody adding any. Leaving for somewhere Massing cannot vouch for is not
 * reversible in the same way, so that one always asks.
 *
 * Nothing here mutates the document. Following a link is reading, and a click
 * that navigated *and* left an undo entry behind would be a click that changed
 * a file somebody was only looking at.
 */

import { entityById } from './doc.js';
import { readLink, resolveLink, describeLink, hostOf, LINK_SYNTAX } from './link.js';

/** How long the ring around a link's destination stays up. */
const LANDED_MS = 2600;

export function createNavigator({ store, tabs, commands, toaster, askExternal }) {
  let landedTimer = 0;

  /** The link written on an element, or null. */
  function linkOn(id) {
    const found = entityById(store.state.doc, id);
    return found ? readLink(found.entity.link) : null;
  }

  /** What that element is called, for a sheet that has to name what was clicked. */
  function labelOf(id) {
    const found = entityById(store.state.doc, id);
    if (!found) return '';
    const { entity } = found;
    return (entity.label || entity.text || '').split('\n')[0].trim() || id;
  }

  /** The file a link is resolved against: this drawing, and all the others. */
  function context() {
    return {
      doc: store.state.doc,
      tabs: tabs ? tabs.all() : null,
      activeTab: tabs ? tabs.active : 0,
    };
  }

  /** Where a link points, resolved against the whole file rather than one drawing. */
  function target(raw) {
    return resolveLink(raw, context());
  }

  /**
   * Ring the destination for a moment.
   *
   * Arriving is a camera move, and a camera move alone does not say which of
   * the things now on screen was the point — least of all when the destination
   * was already in frame and the camera barely travelled.
   */
  function land(id) {
    clearTimeout(landedTimer);
    store.setUI({ landed: id });
    landedTimer = setTimeout(() => store.setUI({ landed: null }), LANDED_MS);
  }

  /**
   * Follow the link on `id`, if it has one.
   *
   * @returns {boolean} whether anything was followed. False means the caller's
   *   click was an ordinary click and should carry on being one — which is why
   *   this reports rather than swallows.
   */
  function follow(id) {
    const raw = linkOn(id);
    if (!raw) return false;
    const where = target(raw);
    if (!where) return false;

    switch (where.kind) {
      case 'url':
        // Deliberately not awaited: the sheet is a conversation with a person,
        // and the click that opened it is long over by the time it is answered.
        askExternal(where.href, { label: labelOf(id) }).then((go) => {
          if (!go) return;
          /*
           * `noopener` is not optional here.
           *
           * Without it the page that opens keeps a handle on this one through
           * `window.opener` and can navigate it — so a diagram embedded in an
           * article could be made to replace the article. `noreferrer` goes
           * with it so the destination is not told which diagram sent them.
           */
          const opened = window.open(where.href, '_blank', 'noopener,noreferrer');
          if (!opened) {
            toaster?.warn(`The browser blocked a new tab for ${hostOf(where.href)}.`);
          }
        });
        return true;

      case 'tab':
        if (where.here) {
          toaster?.info(`"${where.name}" is the drawing you are on.`);
          return true;
        }
        // `select` frames the drawing it arrives at through `onSwitch`, so there
        // is nothing for the camera to do here.
        tabs.select(where.index);
        toaster?.info(`Opened "${where.name}".`);
        return true;

      case 'element':
        if (where.tab !== (tabs?.active ?? 0)) {
          const name = tabs.list[where.tab].name;
          tabs.select(where.tab);
          // Straight to the element rather than to the fitted drawing the switch
          // just produced: the fit is what a tab arrives at, and this arrival
          // was aimed at one thing in it.
          commands.focusOn(where.id);
          toaster?.info(`"${where.id}", in "${name}".`);
        } else {
          commands.focusOn(where.id);
        }
        land(where.id);
        // Selected, so the panel on the right describes what you arrived at.
        // Not while presenting: selection draws grips, and grips are editing.
        if (!store.state.presenting) store.select(where.id);
        return true;

      case 'missing':
        toaster?.warn(`That link goes nowhere: ${where.why}.`);
        return true;

      default:
        toaster?.warn(`"${raw}" is not a link. Write one of ${LINK_SYNTAX}.`);
        return true;
    }
  }

  return {
    follow,
    /** Whether a press on this element would follow something. */
    has: (id) => Boolean(id && linkOn(id)),
    /** One line saying what a link would do, for the panel that edits it. */
    explain: (raw) => describeLink(raw, context()),
  };
}
