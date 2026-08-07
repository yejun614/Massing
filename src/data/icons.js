/**
 * Icon registry.
 *
 * Each entry is raw SVG markup for a 24x24 viewBox, drawn as children of a
 * group that sets `fill: none; stroke: currentColor`. Elements that need to be
 * filled opt out locally. Keeping icons as markup strings (rather than files)
 * means the whole set survives the single-file bundle with no asset loading.
 */

const GLOBE =
  '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><ellipse cx="12" cy="12" rx="4" ry="8.5"/>';

const CYLINDER =
  '<ellipse cx="12" cy="6" rx="7.5" ry="3"/>' +
  '<path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/>' +
  '<path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>';

const SHIELD = 'M12 3 4.5 6v6c0 4.5 3.2 7.9 7.5 9.5 4.3-1.6 7.5-5 7.5-9.5V6Z';

const ICONS = {
  // --- compute -------------------------------------------------------------
  chip:
    '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>' +
    '<path d="M9.5 3v3.5M14.5 3v3.5M9.5 17.5V21M14.5 17.5V21' +
    'M3 9.5h3.5M3 14.5h3.5M17.5 9.5H21M17.5 14.5H21"/>',
  lambda: '<path d="M8 4.5 16.5 19.5"/><path d="M12.7 12.6 7 19.5"/>',
  containers:
    '<rect x="3" y="13" width="7" height="6.5" rx="1.2"/>' +
    '<rect x="12" y="13" width="7" height="6.5" rx="1.2"/>' +
    '<rect x="7.5" y="4.5" width="7" height="6.5" rx="1.2"/>',
  hexnode:
    '<path d="M12 2.8 20.4 7.4v9.2L12 21.2 3.6 16.6V7.4Z"/>' +
    '<circle cx="12" cy="12" r="2.4"/>' +
    '<path d="M12 9.6V6.4M14.3 13.4 17 15.2M9.7 13.4 7 15.2"/>',
  bolt: '<path d="M13.8 2.8 6 13.8h5.2L10.2 21.2 18 10.2h-5.2Z"/>',
  list:
    '<rect x="3" y="4.5" width="18" height="4.2" rx="1.2"/>' +
    '<rect x="3" y="10.9" width="18" height="4.2" rx="1.2"/>' +
    '<rect x="3" y="17.3" width="12" height="4.2" rx="1.2"/>',

  // --- storage -------------------------------------------------------------
  bucket:
    '<path d="M4.6 6.6h14.8l-1.4 12.5a2 2 0 0 1-2 1.7H8a2 2 0 0 1-2-1.7Z"/>' +
    '<path d="M3 6.6h18M9 3.4h6"/>',
  disk: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.4"/>',
  folder:
    '<path d="M3.5 6.6A1.6 1.6 0 0 1 5.1 5h3.7l2.1 2.6H19a1.6 1.6 0 0 1 1.6 1.6v8.2A1.6 1.6 0 0 1 19 19H5.1a1.6 1.6 0 0 1-1.6-1.6Z"/>',
  snowflake:
    '<path d="M12 2.5v19M3.8 7.25l16.4 9.5M20.2 7.25 3.8 16.75"/>' +
    '<path d="M12 6.4 9.4 4.2M12 6.4l2.6-2.2M12 17.6 9.4 19.8M12 17.6l2.6 2.2"/>',

  // --- database ------------------------------------------------------------
  cylinder: CYLINDER,
  bars: '<path d="M5 20.5V12.5M11 20.5V4.5M17 20.5V9M21 20.5v-6"/>',

  // --- network -------------------------------------------------------------
  globe: GLOBE,
  balancer:
    '<circle cx="12" cy="4.4" r="2"/><circle cx="4.6" cy="19.6" r="2"/>' +
    '<circle cx="12" cy="19.6" r="2"/><circle cx="19.4" cy="19.6" r="2"/>' +
    '<path d="M12 6.4v4.4M4.6 17.6v-6.8h14.8v6.8M12 10.8v6.8"/>',
  gateway:
    '<rect x="3" y="7.5" width="18" height="9" rx="2.2"/>' +
    '<path d="M7 12h9M13.5 9 16.5 12l-3 3"/>',
  cloud:
    '<path d="M7.2 18.8a4.7 4.7 0 0 1 .3-9.4 5.6 5.6 0 0 1 10.4 1.7 3.9 3.9 0 0 1-.5 7.7Z"/>',
  braces:
    '<path d="M9.2 4.4c-2.6 0-2.4 6-4.7 7.6 2.3 1.6 2.1 7.6 4.7 7.6"/>' +
    '<path d="M14.8 4.4c2.6 0 2.4 6 4.7 7.6-2.3 1.6-2.1 7.6-4.7 7.6"/>',

  // --- integration ---------------------------------------------------------
  broadcast:
    '<circle cx="12" cy="12" r="2"/>' +
    '<path d="M8.3 8.3a5.3 5.3 0 0 0 0 7.4M15.7 8.3a5.3 5.3 0 0 1 0 7.4"/>' +
    '<path d="M5.5 5.5a9.2 9.2 0 0 0 0 13M18.5 5.5a9.2 9.2 0 0 1 0 13"/>',
  hub:
    '<circle cx="12" cy="12" r="3"/>' +
    '<path d="M12 3v6M12 15v6M3 12h6M15 12h6"/>' +
    '<path d="m6 6 3.2 3.2M18 6l-3.2 3.2M6 18l3.2-3.2M18 18l-3.2-3.2"/>',
  waves: '<path d="M3 8.5c3-3.2 6 3.2 9 0s6-3.2 9 0M3 15.5c3-3.2 6 3.2 9 0s6-3.2 9 0"/>',
  layers:
    '<path d="M12 2.8 21 7.4l-9 4.6-9-4.6Z"/>' +
    '<path d="m3 12.2 9 4.6 9-4.6M3 16.6l9 4.6 9-4.6"/>',

  // --- security ------------------------------------------------------------
  shield: `<path d="${SHIELD}"/><path d="m8.9 12 2.2 2.2 4-4.4"/>`,
  shieldLock:
    `<path d="${SHIELD}"/><circle cx="12" cy="10.8" r="1.9"/><path d="M12 12.7v3.4"/>`,
  key: '<circle cx="8" cy="12" r="3.6"/><path d="M11.6 12H21M18 12v3.2M14.8 12v2.4"/>',
  userCircle:
    '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="9.8" r="2.7"/>' +
    '<path d="M6.7 18.6a6 6 0 0 1 10.6 0"/>',

  // --- generic -------------------------------------------------------------
  server:
    '<rect x="3.5" y="4" width="17" height="6.6" rx="1.6"/>' +
    '<rect x="3.5" y="13.4" width="17" height="6.6" rx="1.6"/>' +
    '<circle cx="7.2" cy="7.3" r="1" fill="currentColor" stroke="none"/>' +
    '<circle cx="7.2" cy="16.7" r="1" fill="currentColor" stroke="none"/>',
  cube:
    '<path d="M12 2.8 20.5 7.3v9.4L12 21.2 3.5 16.7V7.3Z"/>' +
    '<path d="M3.5 7.3 12 11.8l8.5-4.5M12 11.8v9.4"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.6 20.2a7.4 7.4 0 0 1 14.8 0"/>',
  box: '<rect x="4" y="4" width="16" height="16" rx="2.4"/>',
  code: '<path d="m9 8.5-4 3.5 4 3.5M15 8.5l4 3.5-4 3.5"/>',

  // --- languages and runtimes ----------------------------------------------
  // Simplified geometric marks, not reproductions of the projects' logos.
  java:
    '<path d="M9.6 13.2c-2 1.2-1 2.4 1.2 2.7 2.7.4 5.6.1 7.4-.9"/>' +
    '<path d="M10.6 10c-1.6 1-.7 1.9 1 2.1"/>' +
    '<path d="M12.6 2.8c1.6 1.9.4 3-1 4.3-1.5 1.4-1.7 2.4.5 3.6"/>' +
    '<path d="M6.6 17.4c-1.4 1 .4 2.1 5.4 2.1s6.4-1.2 5-2.1"/>',
  kotlin: '<path d="M3.6 3.6h16.8L12 12l8.4 8.4H3.6Z"/><path d="M3.6 3.6 12 12l-8.4 8.4"/>',
  python:
    '<path d="M12 3.2c-3 0-3.6 1.2-3.6 2.6v2.1h3.7"/>' +
    '<path d="M8.4 7.9H5.6c-1.5 0-2.4 1.4-2.4 3.6s.9 3.6 2.4 3.6h1.9v-2.5c0-1.5.9-2.6 2.6-2.6h4"/>' +
    '<path d="M12 20.8c3 0 3.6-1.2 3.6-2.6v-2.1h-3.7"/>' +
    '<path d="M15.6 16.1h2.8c1.5 0 2.4-1.4 2.4-3.6s-.9-3.6-2.4-3.6h-1.9v2.5c0 1.5-.9 2.6-2.6 2.6h-4"/>',
  rust:
    '<circle cx="12" cy="12" r="7.6"/><circle cx="12" cy="12" r="3.2"/>' +
    '<path d="M12 4.4V2.2M12 21.8v-2.2M4.4 12H2.2M21.8 12h-2.2"/>' +
    '<path d="m6.6 6.6-1.5-1.5M18.9 18.9l-1.5-1.5M6.6 17.4l-1.5 1.5M18.9 5.1l-1.5 1.5"/>',
  js: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M10.4 9.6v5.2a1.7 1.7 0 0 1-3.2.7"/><path d="M17 10.2a2 2 0 0 0-3.3 1.4c0 2 3.3 1.4 3.3 3.3a2 2 0 0 1-3.4 1.3"/>',
  ts: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M6.6 10h5M9.1 10v7"/><path d="M18 11a2 2 0 0 0-3.3 1.3c0 1.9 3.3 1.3 3.3 3.1a2 2 0 0 1-3.4 1.2"/>',

  // --- frameworks -----------------------------------------------------------
  spring:
    '<path d="M18.6 4.4A9 9 0 1 0 20 12"/>' +
    '<path d="M20.4 3.2c-.6 2.4-2 3.6-4.6 4.4-2.9.9-4.4 1.9-4.4 3.6a2.4 2.4 0 0 0 2.5 2.3c1.9 0 3-1.2 3.3-3"/>',
  react:
    '<circle cx="12" cy="12" r="2.1"/>' +
    '<ellipse cx="12" cy="12" rx="9.4" ry="3.6"/>' +
    '<ellipse cx="12" cy="12" rx="9.4" ry="3.6" transform="rotate(60 12 12)"/>' +
    '<ellipse cx="12" cy="12" rx="9.4" ry="3.6" transform="rotate(120 12 12)"/>',
  vue: '<path d="M2.4 4.6h4L12 14l5.6-9.4h4L12 20.6Z"/><path d="M7.6 4.6h3L12 7l1.4-2.4h3"/>',
  svelte:
    '<path d="M16.6 4.6a4.6 4.6 0 0 1 1.5 6.4l-4.6 7.2a4.6 4.6 0 0 1-7.7-4.9"/>' +
    '<path d="M7.4 19.4a4.6 4.6 0 0 1-1.5-6.4l4.6-7.2a4.6 4.6 0 0 1 7.7 4.9"/>',
  vite: '<path d="M2.6 5.2 12 21.4l9.4-16.2L12 7.6Z"/><path d="M13.4 2.6 10.2 9l3.6-.5-1.4 5.4 3.4-6.2-3.6.5Z"/>',
  tauri:
    '<ellipse cx="12" cy="12" rx="9" ry="4.4" transform="rotate(-30 12 12)"/>' +
    '<ellipse cx="12" cy="12" rx="9" ry="4.4" transform="rotate(30 12 12)"/>' +
    '<circle cx="8.6" cy="9.4" r="1.2" fill="currentColor" stroke="none"/>' +
    '<circle cx="15.4" cy="14.6" r="1.2" fill="currentColor" stroke="none"/>',

  // --- data stores ----------------------------------------------------------
  mysql:
    '<ellipse cx="12" cy="6" rx="7.5" ry="3"/>' +
    '<path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/>' +
    '<path d="M7 11.6l2 3.4 2-3.4M13 15v-3.4l2 2 2-2V15"/>',
  postgres:
    '<ellipse cx="12" cy="6" rx="7.5" ry="3"/>' +
    '<path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/>' +
    '<path d="M9.2 15.4V11h2.6a1.7 1.7 0 0 1 0 3.4H9.2"/>',
  erd:
    '<rect x="2.6" y="3.4" width="7.4" height="6" rx="1"/>' +
    '<rect x="14" y="14.6" width="7.4" height="6" rx="1"/>' +
    '<path d="M2.6 6.2h7.4M14 17.4h7.4"/>' +
    '<path d="M10 8.2h4.6a1.4 1.4 0 0 1 1.4 1.4v5"/>' +
    '<path d="M13.4 15.6 16 17.6l2.6-2"/>',
  redis:
    '<path d="M3 7.4 12 4l9 3.4-9 3.4Z"/>' +
    '<path d="M3 12.2 12 15.6l9-3.4M3 16.8 12 20.2l9-3.4"/>',
  rabbitmq:
    '<path d="M3.4 3.6h4.2v7.2h3.6V3.6h4.2v7.2h2.6a1.6 1.6 0 0 1 1.6 1.6v7.8H3.4Z"/>' +
    '<circle cx="16.4" cy="15.8" r="1.3" fill="currentColor" stroke="none"/>',

  // --- devops ---------------------------------------------------------------
  docker:
    '<path d="M3 11.4h15.2c1.6 0 2.8-.9 2.8-2.4-1.4-.9-2.7-.6-3.3-.2"/>' +
    '<path d="M3 11.4c0 4.4 2.7 7.4 7.4 7.4 5.4 0 8.8-3.2 9.4-7.6"/>' +
    '<path d="M5.6 11.4V8.8h2.6v2.6M9.4 11.4V8.8H12v2.6M13.2 11.4V8.8h2.6v2.6M9.4 8V5.4H12V8"/>',
  kubernetes:
    '<path d="M12 2.6 20 6.6v8.8L12 21.4 4 15.4V6.6Z"/>' +
    '<circle cx="12" cy="12" r="2.6"/>' +
    '<path d="M12 9.4V5.6M14.4 13.4l3.2 2.2M9.6 13.4l-3.2 2.2M14.3 10.7l3.4-1.3M9.7 10.7 6.3 9.4"/>',
  jenkins:
    '<circle cx="12" cy="8.4" r="4.4"/>' +
    '<path d="M6.6 20.8c0-3.4 2.4-5.6 5.4-5.6s5.4 2.2 5.4 5.6"/>' +
    '<path d="M10.2 7.6h.01M13.8 7.6h.01"/>',
  gitBranch:
    '<circle cx="7" cy="5.4" r="2.2"/><circle cx="7" cy="18.6" r="2.2"/><circle cx="17" cy="9.6" r="2.2"/>' +
    '<path d="M7 7.6v8.8M17 11.8c0 3.2-2.6 4.2-5.6 4.6"/>',

  // --- ai and numerics ------------------------------------------------------
  pytorch:
    '<path d="M12 2.6 17.4 8a7.6 7.6 0 1 1-10.8 0Z"/>' +
    '<circle cx="14.8" cy="7.4" r="1.2" fill="currentColor" stroke="none"/>',
  tensorflow: '<path d="M12 2.6 20.4 7.4v3.4L15 7.7v11.2l-3 1.7V4.4Z"/><path d="M12 8.6 8.6 6.6v4.2L12 12.8"/>',
  numpy:
    '<path d="M12 2.8 20.4 7.4v9.2L12 21.2 3.6 16.6V7.4Z"/>' +
    '<path d="M8.4 15.4V9l7.2 6V8.6"/>',
  pandas:
    '<rect x="4.4" y="2.8" width="15.2" height="18.4" rx="1.6"/>' +
    '<path d="M4.4 8.2h15.2M9.6 8.2v13M14.4 8.2v13"/>',
  brain:
    '<path d="M12 4.4a3 3 0 0 0-5.6 1.5A3.1 3.1 0 0 0 4.6 12a3.1 3.1 0 0 0 2 5.4A3 3 0 0 0 12 19.6Z"/>' +
    '<path d="M12 4.4a3 3 0 0 1 5.6 1.5A3.1 3.1 0 0 1 19.4 12a3.1 3.1 0 0 1-2 5.4A3 3 0 0 1 12 19.6Z"/>' +
    '<path d="M12 4.4v15.2"/>',
  gpu:
    '<rect x="2.4" y="6.6" width="19.2" height="10.4" rx="1.6"/>' +
    '<rect x="5.4" y="9.4" width="5.4" height="4.8" rx="1"/>' +
    '<circle cx="16.4" cy="11.8" r="2.4"/>' +
    '<path d="M6.4 17v2.4M17.6 17v2.4"/>',

  // --- packaging ------------------------------------------------------------
  npm: '<rect x="2.4" y="6.4" width="19.2" height="11.2" rx="1"/><path d="M6 17.6V10h3.4v7.6M9.4 10h3.2v7.6M12.6 10H16v5.2M16 10h2v5.2"/>',
  pip: '<path d="M6 20.4V6.4h4.4a3.4 3.4 0 0 1 0 6.8H6"/><path d="M14.6 8.4v9M18.4 8.4v9"/>',
  uv: '<path d="M4.4 5.6v8a3.8 3.8 0 0 0 7.6 0v-8"/><path d="M13.4 5.6l3.4 12 3.4-12"/>',

  // --- observability --------------------------------------------------------
  prometheus:
    '<circle cx="12" cy="12" r="8.6"/>' +
    '<path d="M12 5.6c2.2 2.4 1 3.8 0 4.9-1 1.1-.7 2.6.9 2.6 1.3 0 2-1 1.8-2.1"/>' +
    '<path d="M7.6 15.4h8.8v2.4H7.6z"/>',
  grafana:
    '<rect x="2.4" y="4" width="19.2" height="16" rx="1.8"/><path d="M2.4 8.4h19.2"/>' +
    '<path d="m5.6 16.6 3.4-4.2 2.8 2.4 4.6-5.4"/>',
  logs:
    '<path d="M4.4 4.6h11l4.2 4.2v10.6H4.4z"/><path d="M15.4 4.6v4.2h4.2"/>' +
    '<path d="M7.4 11.8h8M7.4 15h8M7.4 18.2h4.6"/>',
  collector:
    '<path d="M3.4 4.4h17.2l-6.4 7.6v6.6l-4.4 2.8v-9.4Z"/>' +
    '<path d="M9.8 12h4.4"/>',
  gauge:
    '<rect x="2.6" y="6.4" width="18.8" height="11.2" rx="1.8"/>' +
    '<path d="M6.6 14.6a4.6 4.6 0 0 1 8.6-2.2"/><path d="m10.9 14.6 3-3.4"/>' +
    '<circle cx="18.4" cy="12" r="1.1" fill="currentColor" stroke="none"/>',
  heartbeat:
    '<rect x="2.4" y="5" width="19.2" height="14" rx="2"/>' +
    '<path d="M5.4 12.2h2.8l1.8-3.8 2.8 7.6 2-4 1.2 2h2.6"/>',

  // --- realtime transport ---------------------------------------------------
  peers:
    '<circle cx="5.2" cy="12" r="2.6"/><circle cx="18.8" cy="12" r="2.6"/>' +
    '<path d="M8 10.4c2-2.6 6-2.6 8 0M8 13.6c2 2.6 6 2.6 8 0"/>',
  duplex: '<path d="M6.4 4.6 3 8.2l3.4 3.6M2.6 8.2h18M17.6 19.4l3.4-3.6-3.4-3.6M21.4 15.8h-18"/>',
  zeromq:
    '<circle cx="12" cy="12" r="9"/>' +
    '<path d="M7.4 8h9.2l-9.2 8h9.2"/>',
  beacon:
    '<path d="M12 21.4s6.4-6.2 6.4-10.6a6.4 6.4 0 1 0-12.8 0C5.6 15.2 12 21.4 12 21.4Z"/>' +
    '<circle cx="12" cy="10.6" r="2.4"/>',
  relay:
    '<rect x="8.8" y="8.8" width="6.4" height="6.4" rx="1.2"/>' +
    '<path d="M2.6 6.4h4.8a1.4 1.4 0 0 1 1.4 1.4v1"/>' +
    '<path d="M21.4 17.6h-4.8a1.4 1.4 0 0 1-1.4-1.4v-1"/>' +
    '<path d="M5 4 2.6 6.4 5 8.8M19 15.2l2.4 2.4-2.4 2.4"/>',
  mesh:
    '<circle cx="5.6" cy="6.4" r="2.6"/><circle cx="18.4" cy="6.4" r="2.6"/>' +
    '<circle cx="12" cy="18" r="2.6"/>' +
    '<path d="M8.2 6.4h7.6M6.9 8.9l3.9 6.9M17.1 8.9l-3.9 6.9"/>',
  packets:
    '<rect x="2.4" y="9" width="4.6" height="6" rx="1"/>' +
    '<rect x="9.7" y="9" width="4.6" height="6" rx="1"/>' +
    '<rect x="17" y="9" width="4.6" height="6" rx="1"/>' +
    '<path d="M7 12h2.7M14.3 12H17"/>',
  boundary:
    '<path d="M12 2.6v18.8"/>' +
    '<path d="M2.6 8h7.4M7.6 5.6 10 8l-2.4 2.4"/>' +
    '<path d="M21.4 16h-7.4M16.4 13.6 14 16l2.4 2.4"/>',
  nginx: '<path d="M12 2.6 20.4 7.4v9.2L12 21.4 3.6 16.6V7.4Z"/><path d="M8.8 16.2V8l6.4 8V7.8"/>',
  fanout:
    '<path d="M2.6 12h5.6"/><rect x="8.4" y="8.6" width="4.4" height="6.8" rx="1.2"/>' +
    '<path d="M12.8 12h2.8"/><path d="M15.6 12 19 6.6M15.6 12h3.8M15.6 12 19 17.4"/>',

  // --- build and delivery ---------------------------------------------------
  gradle:
    '<path d="M3.2 15.6c4.2-6.4 9.8-8.8 17.6-8.8"/>' +
    '<path d="M5.6 18.8c3.6-5.2 8.2-7.2 14.2-7.2"/>' +
    '<path d="M8.8 21c2.6-3.6 6-5 10.6-5"/>',
  crate:
    '<rect x="2.8" y="5.6" width="18.4" height="12.8" rx="1.4"/>' +
    '<path d="M2.8 9.4h18.4M2.8 14.6h18.4"/><path d="M8.9 5.6v12.8M15.1 5.6v12.8"/>',
  gitlab:
    '<path d="M12 21 3 10.8l1.9-6.6 2.6 6.6h9l2.6-6.6L21 10.8Z"/>' +
    '<path d="M7.5 10.8 12 21l4.5-10.2"/>',
  registry:
    '<path d="M7.4 17.8a4.3 4.3 0 0 1 .4-8.6 5.1 5.1 0 0 1 9.5 1.4 3.5 3.5 0 0 1-.4 7.2"/>' +
    '<path d="M12 21v-8.6M9.2 15.2 12 12.4l2.8 2.8"/>',
  installer:
    '<rect x="3.4" y="3.4" width="17.2" height="17.2" rx="2"/>' +
    '<path d="M12 6.8v7.4M8.8 11l3.2 3.2L15.2 11"/><path d="M7.6 17.4h8.8"/>',
  certificate:
    '<rect x="2.6" y="4.4" width="18.8" height="12.2" rx="1.6"/>' +
    '<path d="M6.4 8.6h6.2M6.4 12h4"/><circle cx="16.6" cy="11" r="2.4"/>' +
    '<path d="m14.9 13.2-.7 5.6 2.4-1.5 2.4 1.5-.7-5.6"/>',
  webhook:
    '<circle cx="8" cy="6.8" r="2.6"/><circle cx="17.6" cy="14.2" r="2.6"/>' +
    '<circle cx="7.2" cy="17.4" r="2.6"/>' +
    '<path d="M9.6 8.6 15.2 13M15 15.8h-5M9.4 15.2 12.6 9.2"/>',
  worker:
    '<rect x="2.8" y="6" width="18.4" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/>' +
    '<path d="M12 7.2v1.6M12 15.2v1.6M7.2 12h1.6M15.2 12h1.6"/>',
  terminal:
    '<rect x="2.4" y="4" width="19.2" height="16" rx="1.8"/>' +
    '<path d="m6.4 9.4 3 2.6-3 2.6M12.4 15.4h5.2"/>',
  swagger:
    '<circle cx="12" cy="12" r="9"/>' +
    '<path d="M8.8 7.6c-1.7 0-1.5 3.4-3 4.4 1.5 1 1.3 4.4 3 4.4"/>' +
    '<path d="M15.2 7.6c1.7 0 1.5 3.4 3 4.4-1.5 1-1.3 4.4-3 4.4"/>',
  mattermost:
    '<path d="M12 3c4.9 0 8.8 3.6 8.8 8.3 0 4.4-3.7 7.7-8.4 7.7-1.2 0-2.3-.2-3.4-.6L4.2 20.4l1.3-3.8A8.1 8.1 0 0 1 3.2 11C3.2 6.4 7.1 3 12 3Z"/>' +
    '<path d="M13.8 7.2v6.4a2.5 2.5 0 1 1-2.5-2.5"/>',
  jira:
    '<path d="M11.6 2.8 20.8 12l-9.2 9.2"/>' +
    '<path d="M5.8 6.6 11.2 12l-5.4 5.4"/><path d="M2.6 12h8.6"/>',

  // --- identity and secrets -------------------------------------------------
  oauth:
    '<path d="M12 3.4a8.6 8.6 0 1 1-6.4 2.9"/><path d="M5.4 2.6v3.8h3.8"/>' +
    '<rect x="8.8" y="11" width="6.4" height="5.2" rx="1.1"/>' +
    '<path d="M10.4 11V9.4a1.6 1.6 0 0 1 3.2 0V11"/>',
  token:
    '<rect x="2.4" y="7.4" width="19.2" height="9.2" rx="1.8"/>' +
    '<path d="M8.8 7.4v9.2M15.2 7.4v9.2"/>' +
    '<path d="M5 12h1.2M11.4 12h1.2M17.8 12H19"/>',
  google:
    '<path d="M20.4 12.2c0 4.9-3.5 8.4-8.4 8.4a8.6 8.6 0 1 1 5.8-15l-2.5 2.4A5.1 5.1 0 1 0 12 17.1a4.8 4.8 0 0 0 4.8-3.6H12v-3.3h8.2c.1.6.2 1.3.2 2Z"/>',
  kakao:
    '<path d="M12 3.6c-4.9 0-8.8 3.1-8.8 6.9 0 2.5 1.7 4.7 4.2 5.9l-1 3.9 4.4-2.9c.4 0 .8.1 1.2.1 4.9 0 8.8-3.1 8.8-6.9S16.9 3.6 12 3.6Z"/>',

  // --- data at rest ---------------------------------------------------------
  volume:
    '<ellipse cx="12" cy="6.2" rx="7.6" ry="2.8"/>' +
    '<path d="M4.4 6.2v11.6c0 1.5 3.4 2.8 7.6 2.8s7.6-1.3 7.6-2.8V6.2"/>' +
    '<path d="M8.8 11.4h6.4M8.8 15.2h6.4"/>',
  filetree:
    '<rect x="2.8" y="4" width="7" height="4.4" rx="1"/>' +
    '<path d="M6.3 8.4v9.4h3.6M6.3 13.4h3.6"/>' +
    '<rect x="9.9" y="11.4" width="7" height="4" rx="1"/>' +
    '<rect x="9.9" y="15.8" width="7" height="4" rx="1"/>',
  migration:
    '<ellipse cx="10.6" cy="5.6" rx="7" ry="2.6"/>' +
    '<path d="M3.6 5.6v6c0 1.4 3.1 2.6 7 2.6"/>' +
    '<path d="M12.6 20.4h2.8v-3h2.8v-3h2.6"/>',

  // --- media and models -----------------------------------------------------
  sparkle4:
    '<path d="M12 2.4c0 5.3 4.3 9.6 9.6 9.6-5.3 0-9.6 4.3-9.6 9.6 0-5.3-4.3-9.6-9.6-9.6 5.3 0 9.6-4.3 9.6-9.6Z"/>',
  stems:
    '<path d="M2.6 12h4"/>' +
    '<path d="M6.6 12c3.2 0 3.4-5.4 6.8-5.4h3.4M6.6 12h10.2M6.6 12c3.2 0 3.4 5.4 6.8 5.4h3.4"/>' +
    '<circle cx="19.4" cy="6.6" r="1.6"/><circle cx="19.4" cy="12" r="1.6"/>' +
    '<circle cx="19.4" cy="17.4" r="1.6"/>',
  filmstrip:
    '<rect x="2.4" y="5.4" width="19.2" height="13.2" rx="1.6"/>' +
    '<path d="M2.4 9h19.2M2.4 15h19.2"/>' +
    '<path d="M6 5.4v3.6M6 15v3.6M18 5.4v3.6M18 15v3.6"/>' +
    '<path d="m10.4 10.4 4.2 1.6-4.2 1.6Z"/>',

  // --- audio ----------------------------------------------------------------
  microphone:
    '<rect x="9" y="2.6" width="6" height="11" rx="3"/>' +
    '<path d="M5.6 11.4a6.4 6.4 0 0 0 12.8 0"/><path d="M12 17.8v3.6M9 21.4h6"/>',
  headphone:
    '<path d="M4.4 15.2v-3a7.6 7.6 0 0 1 15.2 0v3"/>' +
    '<rect x="2.4" y="13.4" width="4.6" height="6.6" rx="2.2"/>' +
    '<rect x="17" y="13.4" width="4.6" height="6.6" rx="2.2"/>',
  speaker:
    '<path d="M3.6 9h3.6L12 4.8v14.4L7.2 15H3.6Z"/>' +
    '<path d="M15.4 9.4a4 4 0 0 1 0 5.2M18.2 6.8a7.6 7.6 0 0 1 0 10.4"/>',
  webcam:
    '<circle cx="12" cy="10.2" r="6.6"/><circle cx="12" cy="10.2" r="2.6"/>' +
    '<path d="M6.4 18.2a10 10 0 0 0 11.2 0"/><path d="M12 16.8v3.6"/>',
  lowlatency:
    '<rect x="2.8" y="6.4" width="18.4" height="11.2" rx="1.8"/>' +
    '<path d="M13.2 8.4 9.6 13h3l-.6 3.6 3.6-4.8h-3Z"/>',
  winaudio:
    '<path d="M3.4 6 10 5.2v5.4H3.4ZM11.6 5 20.6 4v6.6h-9Z"/>' +
    '<path d="M3.4 14.4h17.2"/>' +
    '<path d="M5 17.6c1.6-2.6 3.2 2.6 4.8 0s3.2 2.6 4.8 0 3.2 2.6 4.8 0"/>',
  audiointerface:
    '<rect x="2.4" y="6" width="19.2" height="12" rx="1.8"/>' +
    '<circle cx="7" cy="12" r="2.2"/><circle cx="12.8" cy="12" r="2.2"/>' +
    '<path d="M7 10.2v1.8M12.8 10.2v1.8"/>' +
    '<circle cx="18.4" cy="9.8" r="1.4"/><circle cx="18.4" cy="14.6" r="1.4"/>',
  waveform: '<path d="M2.6 12h1.8M7 8.2v7.6M11.4 5.4v13.2M15.8 8.8v6.4M20.2 10.4v3.2"/>',
  codec:
    '<rect x="2.6" y="6.4" width="18.8" height="11.2" rx="2.4"/>' +
    '<path d="M6.2 12h1.6M9.4 9.6v4.8M12.4 7.6v8.8M15.4 10.2v3.6M18.2 12h1.6"/>',
  videocodec:
    '<rect x="2.6" y="5.4" width="18.8" height="13.2" rx="1.8"/>' +
    '<path d="M6.6 9.4v5.2M6.6 12H10M10 9.4v5.2"/>' +
    '<path d="m14.2 10.2 4.4 1.8-4.4 1.8Z"/>',
  pianokeys:
    '<rect x="2.4" y="7" width="19.2" height="10" rx="1.4"/>' +
    '<path d="M7.2 7v10M12 7v10M16.8 7v10"/>' +
    '<path d="M5.6 7h2.4v5.4H5.6zM10.4 7h2.4v5.4h-2.4zM15.2 7h2.4v5.4h-2.4z"/>',
  pads:
    '<rect x="2.6" y="2.6" width="18.8" height="18.8" rx="2"/>' +
    '<rect x="5.4" y="5.4" width="5.6" height="5.6" rx="1"/>' +
    '<rect x="13" y="5.4" width="5.6" height="5.6" rx="1"/>' +
    '<rect x="5.4" y="13" width="5.6" height="5.6" rx="1"/>' +
    '<rect x="13" y="13" width="5.6" height="5.6" rx="1"/>',
  metronome:
    '<path d="M9.4 3.4h5.2l4 17.2H5.4Z"/><path d="M11.6 18.6 16.6 6.2"/>' +
    '<circle cx="14.6" cy="10.8" r="1.2" fill="currentColor" stroke="none"/>',
  musicnote:
    '<path d="M9.4 17.8V5.2l9.2-2v12.6"/>' +
    '<ellipse cx="6.8" cy="17.8" rx="2.6" ry="2.2"/>' +
    '<ellipse cx="16" cy="15.8" rx="2.6" ry="2.2"/>',
  record:
    '<circle cx="12" cy="12" r="9"/>' +
    '<circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none"/>',
  mixer:
    '<path d="M6 3.4v17.2M12 3.4v17.2M18 3.4v17.2"/>' +
    '<rect x="3.6" y="7" width="4.8" height="2.8" rx="1.2" fill="currentColor" stroke="none"/>' +
    '<rect x="9.6" y="13.4" width="4.8" height="2.8" rx="1.2" fill="currentColor" stroke="none"/>' +
    '<rect x="15.6" y="9.6" width="4.8" height="2.8" rx="1.2" fill="currentColor" stroke="none"/>',
  ringbuffer:
    '<circle cx="12" cy="12" r="7.6"/><circle cx="12" cy="12" r="3.4"/>' +
    '<path d="M12 4.4v3.4M19.6 12h-3.4M12 19.6v-3.4M4.4 12h3.4"/>' +
    '<path d="m17.2 5.2 2.6-1 .6 2.6"/>',

  // --- client platforms -----------------------------------------------------
  windows: '<path d="M3 5.8 10.4 4.8v6.4H3ZM12 4.6 21 3.4v7.8h-9ZM3 12.8h7.4v6.4L3 18.2ZM12 12.8h9v7.8L12 19.4Z"/>',
  desktopapp:
    '<rect x="2.4" y="4" width="19.2" height="13" rx="1.8"/><path d="M2.4 8h19.2"/>' +
    '<circle cx="5.4" cy="6" r=".8" fill="currentColor" stroke="none"/>' +
    '<circle cx="7.9" cy="6" r=".8" fill="currentColor" stroke="none"/>' +
    '<path d="M8.6 20.6h6.8M12 17v3.6"/>',
  webview:
    '<rect x="2.4" y="4.4" width="19.2" height="15.2" rx="1.8"/><path d="M2.4 8.6h19.2"/>' +
    '<circle cx="12" cy="14" r="3.6"/>' +
    '<path d="M8.4 14h7.2M12 10.4c1.7 1.9 1.7 5.3 0 7.2-1.7-1.9-1.7-5.3 0-7.2"/>',
  tailwind:
    '<path d="M7.4 6.6c-2.6 0-4.2 1.3-4.8 3.9 1-1.3 2.1-1.8 3.4-1.5.7.2 1.3.7 1.9 1.4 1 1 2.1 2.2 4.5 2.2 2.6 0 4.2-1.3 4.8-3.9-1 1.3-2.1 1.8-3.4 1.5-.7-.2-1.3-.7-1.9-1.4-1-1-2.1-2.2-4.5-2.2Z"/>' +
    '<path d="M12.4 12.4c-2.6 0-4.2 1.3-4.8 3.9 1-1.3 2.1-1.8 3.4-1.5.7.2 1.3.7 1.9 1.4 1 1 2.1 2.2 4.5 2.2 2.6 0 4.2-1.3 4.8-3.9-1 1.3-2.1 1.8-3.4 1.5-.7-.2-1.3-.7-1.9-1.4-1-1-2.1-2.2-4.5-2.2Z"/>',
};

/** Semantic name -> glyph. Several component types share a glyph. */
const ALIASES = {
  ec2: 'chip',
  ecs: 'containers',
  eks: 'hexnode',
  fargate: 'containers',
  batch: 'list',
  s3: 'bucket',
  ebs: 'disk',
  efs: 'folder',
  glacier: 'snowflake',
  rds: 'cylinder',
  aurora: 'cylinder',
  dynamodb: 'cylinder',
  elasticache: 'bolt',
  redshift: 'bars',
  elb: 'balancer',
  cloudfront: 'globe',
  route53: 'globe',
  apigateway: 'braces',
  natgw: 'gateway',
  igw: 'gateway',
  sqs: 'layers',
  sns: 'broadcast',
  eventbridge: 'hub',
  kinesis: 'waves',
  iam: 'shieldLock',
  waf: 'shield',
  cognito: 'userCircle',
  kms: 'key',
  database: 'cylinder',
  queue: 'layers',
  storage: 'bucket',
  internet: 'globe',
  container: 'cube',
  vpc: 'cloud',
  subnet: 'box',
  group: 'box',

  springboot: 'spring',
  nodejs: 'js',
  typescript: 'ts',
  javascript: 'js',
  mariadb: 'mysql',
  postgresql: 'postgres',
  mongodb: 'cylinder',
  k8s: 'kubernetes',
  git: 'gitBranch',
  githubactions: 'gitBranch',
  gitlabci: 'gitBranch',
  scikit: 'brain',
  llm: 'brain',
  cuda: 'gpu',
};

/** Resolve a name through aliases; returns `null` when unknown. */
export function iconMarkup(name) {
  if (!name) return null;
  return ICONS[name] || ICONS[ALIASES[name]] || null;
}

export function hasIcon(name) {
  return iconMarkup(name) !== null;
}

/**
 * Extension point for third-party packs (e.g. official AWS artwork), which we
 * deliberately do not ship. Entries are `{ name: '<svg markup>' }` for a
 * 24x24 viewBox.
 */
export function registerIconPack(pack) {
  for (const [name, markup] of Object.entries(pack)) {
    if (typeof markup === 'string') ICONS[name] = markup;
  }
}
