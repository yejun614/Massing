/**
 * Component palette.
 *
 * Clicking a component arms placement mode: the next click on the canvas drops
 * it. Holding Shift while placing keeps the component armed for repeat drops.
 */

import { h, clear, setClass } from '../util/dom.js';
import { componentsByCategory, GROUP_KINDS } from '../data/components.js';
import { iconMarkup } from '../data/icons.js';

export function createPalette({ root, store, commands, onArm }) {
  const buttons = new Map();
  const zoneButtons = new Map();
  /** Every filterable entry: [button, haystack]. */
  const searchable = [];
  const sections = [];

  clear(root);

  const searchInput = h('input', {
    type: 'search',
    placeholder: 'Search components…',
    'aria-label': 'Search components',
    onInput: () => filter(searchInput.value),
    onKeyDown: (e) => {
      if (e.key !== 'Escape') return;
      searchInput.value = '';
      filter('');
      e.stopPropagation(); // Escape here clears the box, not the selection
    },
  });
  const empty = h('div', { class: 'palette-empty is-hidden', text: 'Nothing matches.' });
  root.append(h('div', { class: 'palette-search' }, [searchInput]), empty);

  for (const category of componentsByCategory()) {
    const grid = h('div', { class: 'palette-grid' });
    for (const item of category.items) {
      const button = h(
        'button',
        {
          class: 'palette-item',
          title: `${item.label} — click, then click the canvas`,
          onClick: () => arm(item.type),
        },
        [
          h('span', {
            class: 'palette-icon',
            style: `background:${item.color}`,
            html: `<svg viewBox="0 0 24 24">${iconMarkup(item.icon) ?? ''}</svg>`,
          }),
          h('span', { class: 'palette-label', text: item.label }),
        ]
      );
      buttons.set(item.type, button);
      searchable.push([button, `${item.label} ${item.type} ${category.label}`.toLowerCase()]);
      grid.append(button);
    }
    const sectionEl = h('section', { class: 'section' }, [
      h('h2', { class: 'section-title', text: category.label }),
      grid,
    ]);
    sections.push(sectionEl);
    root.append(sectionEl);
  }

  // --- zones ---------------------------------------------------------------
  const zoneGrid = h('div', { class: 'palette-grid' });
  for (const kind of GROUP_KINDS) {
    const button = h(
      'button',
      {
        class: 'palette-item',
        title: `${kind.label} — drag on the canvas to draw`,
        onClick: () => armZone(kind.kind),
      },
      [
        h('span', {
          class: 'palette-icon',
          style: `background:${kind.color}`,
          html: '<svg viewBox="0 0 24 24"><rect x="3.5" y="6" width="17" height="12" rx="2" stroke-dasharray="4 3"/></svg>',
        }),
        h('span', { class: 'palette-label', text: kind.label }),
      ]
    );
    zoneButtons.set(kind.kind, button);
    searchable.push([button, `${kind.label} ${kind.kind} zone group region`.toLowerCase()]);
    zoneGrid.append(button);
  }
  const zoneSection = h('section', { class: 'section' }, [
    h('h2', { class: 'section-title', text: 'Zones' }),
    zoneGrid,
  ]);
  sections.push(zoneSection);
  root.append(zoneSection);

  // --- annotations ---------------------------------------------------------
  const textButton = h(
    'button',
    {
      class: 'palette-item',
      title: 'Text — click, then click the canvas',
      onClick: () => {
        const already = store.state.tool === 'text';
        store.setUI({ tool: already ? 'select' : 'text', pendingType: null });
        if (!already) onArm?.();
      },
    },
    [
      h('span', {
        class: 'palette-icon',
        style: 'background:#334155',
        html: '<svg viewBox="0 0 24 24"><path d="M5 6.4V4.2h14v2.2M12 4.2v15.6M8.6 19.8h6.8"/></svg>',
      }),
      h('span', { class: 'palette-label', text: 'Text' }),
    ]
  );
  searchable.push([textButton, 'text note annotation label caption']);
  const textSection = h('section', { class: 'section' }, [
    h('h2', { class: 'section-title', text: 'Annotation' }),
    h('div', { class: 'palette-grid' }, [textButton]),
  ]);
  sections.push(textSection);
  root.append(textSection);

  /**
   * Hide non-matching entries, then hide any section left with nothing in it.
   * Filtering by display rather than by rebuilding keeps the armed component
   * highlighted and costs no DOM churn while typing.
   */
  function filter(query) {
    const needle = query.trim().toLowerCase();
    let shown = 0;
    for (const [button, haystack] of searchable) {
      const match = !needle || haystack.includes(needle);
      setClass(button, 'is-hidden', !match);
      if (match) shown++;
    }
    for (const section of sections) {
      const any = [...section.querySelectorAll('.palette-item')].some(
        (b) => !b.classList.contains('is-hidden')
      );
      setClass(section, 'is-hidden', !any);
    }
    setClass(empty, 'is-hidden', shown > 0);
  }

  function arm(type) {
    const already = store.state.pendingType === type && store.state.tool === 'place';
    store.setUI({ pendingType: already ? null : type, tool: already ? 'select' : 'place' });
    if (!already) onArm?.();
  }

  function armZone(kind) {
    const already = store.state.pendingGroupKind === kind && store.state.tool === 'group';
    store.setUI({
      pendingGroupKind: already ? null : kind,
      tool: already ? 'select' : 'group',
      pendingType: null,
    });
    if (!already) onArm?.();
  }

  function render(state) {
    for (const [type, button] of buttons) {
      setClass(button, 'is-active', state.tool === 'place' && state.pendingType === type);
    }
    for (const [kind, button] of zoneButtons) {
      setClass(button, 'is-active', state.tool === 'group' && state.pendingGroupKind === kind);
    }
    setClass(textButton, 'is-active', state.tool === 'text');
  }

  return { render };
}
