/**
 * Light and dark.
 *
 * Three states, not two: `system` follows the OS and is the default, while
 * `light` and `dark` are explicit overrides. Storing "system" rather than
 * resolving it once means a machine that switches at dusk takes the editor
 * with it.
 *
 * Only the interface changes. The canvas background belongs to the *document*,
 * not to the viewer's preference -- flipping the theme must never edit someone's
 * diagram. The scene keeps itself readable on any background by deriving its
 * ink from that background's luminance instead (see `sceneInk`).
 */

const THEME_KEY = 'massing:theme';
const ORDER = ['system', 'light', 'dark'];

const LABELS = {
  system: 'Theme: follow the system',
  light: 'Theme: light',
  dark: 'Theme: dark',
};

export function createTheme(onChange) {
  let mode = readTheme();
  applyTheme(mode);

  // Only meaningful while following the system, but harmless otherwise.
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener?.('change', () => {
    if (mode === 'system') onChange?.(current());
  });

  function current() {
    return {
      mode,
      label: LABELS[mode],
      dark: mode === 'dark' || (mode === 'system' && media.matches),
    };
  }

  return {
    current,
    /** Step system -> light -> dark -> system. */
    cycle() {
      mode = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
      applyTheme(mode);
      try {
        localStorage.setItem(THEME_KEY, mode);
      } catch {
        // Storage disabled; the choice simply will not survive a reload.
      }
      onChange?.(current());
      return current();
    },
  };
}

function readTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return ORDER.includes(saved) ? saved : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(mode) {
  if (mode === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', mode);
}
