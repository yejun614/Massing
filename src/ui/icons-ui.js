/** 16x16 interface icons for toolbar buttons, as raw SVG markup. */

const wrap = (body) =>
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" ` +
  `stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

/** A filled glyph. A logo cannot be drawn as a single 1.4px stroke. */
const solid = (body) => `<svg viewBox="0 0 16 16" fill="currentColor">${body}</svg>`;

export const UI_ICONS = {
  file: wrap('<path d="M9 1.5H4.2a1.2 1.2 0 0 0-1.2 1.2v10.6a1.2 1.2 0 0 0 1.2 1.2h7.6a1.2 1.2 0 0 0 1.2-1.2V5.5Z"/><path d="M9 1.5V5.5H13"/>'),
  open: wrap('<path d="M1.8 12.8V4.2A1.2 1.2 0 0 1 3 3h3.3l1.4 1.8H13a1.2 1.2 0 0 1 1.2 1.2v6.8A1.2 1.2 0 0 1 13 14H3a1.2 1.2 0 0 1-1.2-1.2Z"/>'),
  save: wrap('<path d="M2.6 3.8A1.2 1.2 0 0 1 3.8 2.6h6.6L13.4 5.6v6.6a1.2 1.2 0 0 1-1.2 1.2H3.8a1.2 1.2 0 0 1-1.2-1.2Z"/><path d="M5.2 2.6v3.6h5.2V2.6M5.2 13.4V9.6h5.6v3.8"/>'),
  clipboard: wrap('<rect x="4.2" y="2.6" width="7.6" height="11" rx="1.2"/><path d="M6.4 2.6V1.8h3.2v.8"/><path d="M6.6 6.6h2.8M6.6 9.2h2.8"/>'),
  image: wrap('<rect x="2" y="3" width="12" height="10" rx="1.4"/><circle cx="5.8" cy="6.4" r="1.1"/><path d="m2.6 11.6 3.2-3.1 2.4 2.2 2.4-2.4 3 3"/>'),
  vector: wrap('<path d="M4.6 4.6h6.8v6.8H4.6z"/><rect x="2.2" y="2.2" width="2.4" height="2.4" rx=".5"/><rect x="11.4" y="2.2" width="2.4" height="2.4" rx=".5"/><rect x="2.2" y="11.4" width="2.4" height="2.4" rx=".5"/><rect x="11.4" y="11.4" width="2.4" height="2.4" rx=".5"/>'),
  sparkle: wrap('<path d="M6 1.8 7 4.6l2.8 1-2.8 1-1 2.8-1-2.8-2.8-1 2.8-1Z"/><path d="M11.6 7.6 13 11l3.4 1.4-3.4 1.4-1.4 3.4-1.4-3.4L6.8 12.4l3.4-1.4Z"/>'),
  tidy: wrap('<rect x="2.2" y="2.4" width="5" height="5" rx="1"/><rect x="8.8" y="8.6" width="5" height="5" rx="1"/><path d="M9.6 4.9h4.2M9.6 4.9l-1.6-1.6M9.6 4.9 8 6.5"/>'),
  layout: wrap('<rect x="1.8" y="5.6" width="4" height="4.8" rx="1"/><rect x="10.2" y="2.2" width="4" height="4.8" rx="1"/><rect x="10.2" y="9" width="4" height="4.8" rx="1"/><path d="M5.8 7.4h2.2a1 1 0 0 1 1 1v-.8M5.8 8.6h2.2a1 1 0 0 0 1-1v3.8"/>'),
  picture: wrap('<rect x="1.8" y="3.4" width="12.4" height="9.2" rx="1.4"/><circle cx="5.4" cy="6.6" r="1.1"/><path d="m2.4 11.4 3.2-3 2.4 2.2 2.6-2.6 3.2 3.1"/>'),
  themeSystem: wrap('<rect x="1.8" y="3" width="12.4" height="8.6" rx="1.2"/><path d="M5.4 14.2h5.2M8 11.6v2.6"/>'),
  themeLight: wrap('<circle cx="8" cy="8" r="3.2"/><path d="M8 1.4v1.8M8 12.8v1.8M1.4 8h1.8M12.8 8h1.8M3.3 3.3l1.3 1.3M11.4 11.4l1.3 1.3M12.7 3.3l-1.3 1.3M4.6 11.4l-1.3 1.3"/>'),
  themeDark: wrap('<path d="M13.4 9.4A5.8 5.8 0 0 1 6.6 2.6a5.8 5.8 0 1 0 6.8 6.8Z"/>'),
  undo: wrap('<path d="M3 7.4h6.6a3.4 3.4 0 0 1 0 6.8H6"/><path d="M5.6 4.4 2.6 7.4l3 3"/>'),
  redo: wrap('<path d="M13 7.4H6.4a3.4 3.4 0 0 0 0 6.8H10"/><path d="M10.4 4.4l3 3-3 3"/>'),
  trash: wrap('<path d="M2.8 4.4h10.4M6 4.4V2.9h4v1.5M4.2 4.4l.6 8.6a1.2 1.2 0 0 0 1.2 1.1h4a1.2 1.2 0 0 0 1.2-1.1l.6-8.6"/>'),
  zoomIn: wrap('<circle cx="7.2" cy="7.2" r="4.6"/><path d="m10.6 10.6 3 3M5.4 7.2h3.6M7.2 5.4v3.6"/>'),
  zoomOut: wrap('<circle cx="7.2" cy="7.2" r="4.6"/><path d="m10.6 10.6 3 3M5.4 7.2h3.6"/>'),
  fit: wrap('<path d="M2.4 5.8V3.4a1 1 0 0 1 1-1h2.4M10.2 2.4h2.4a1 1 0 0 1 1 1v2.4M13.6 10.2v2.4a1 1 0 0 1-1 1h-2.4M5.8 13.6H3.4a1 1 0 0 1-1-1v-2.4"/>'),
  rotateLeft: wrap('<path d="M3.2 6.6h4V2.6"/><path d="M3.5 6.5A5.2 5.2 0 1 1 3 10.2"/>'),
  rotateRight: wrap('<path d="M12.8 6.6h-4V2.6"/><path d="M12.5 6.5A5.2 5.2 0 1 0 13 10.2"/>'),
  cube: wrap('<path d="M8 1.8 14 5v6l-6 3.2L2 11V5Z"/><path d="M2 5l6 3.2L14 5M8 8.2v6"/>'),
  square: wrap('<rect x="2.4" y="2.4" width="11.2" height="11.2" rx="1.4"/>'),
  cursor: wrap('<path d="M3.4 2.2 12.6 7.8l-4 1.1-1.7 3.9Z"/>'),
  link: wrap('<path d="M6.6 9.4a2.6 2.6 0 0 0 3.9.3l2-2a2.6 2.6 0 0 0-3.7-3.7l-1.1 1.1"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.9-.3l-2 2a2.6 2.6 0 0 0 3.7 3.7l1.1-1.1"/>'),
  zone: wrap('<rect x="1.8" y="4" width="12.4" height="8" rx="1.2" stroke-dasharray="2.6 2"/>'),
  help: wrap('<circle cx="8" cy="8" r="6"/><path d="M6.3 6.2a1.8 1.8 0 1 1 2.5 1.7c-.5.2-.8.6-.8 1.1v.4"/><path d="M8 11.6h.01"/>'),
  panelLeft: wrap('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.4"/><path d="M6.4 2.8v10.4"/>'),
  panelRight: wrap('<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.4"/><path d="M9.6 2.8v10.4"/>'),
  share: wrap('<circle cx="11.8" cy="3.6" r="1.9"/><circle cx="11.8" cy="12.4" r="1.9"/><circle cx="4.2" cy="8" r="1.9"/><path d="m5.9 7.1 4.2-2.5M5.9 8.9l4.2 2.5"/>'),
  // GitHub's own mark, from Octicons (MIT, © GitHub, Inc.). Kept as the real
  // mark rather than a redrawing: it labels a link to GitHub, which is the use
  // their brand guidelines allow, and a home-made octocat helps nobody.
  github: solid('<path d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656"/>'),
};
