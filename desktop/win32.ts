/**
 * The one window fault that can be fixed from outside: the light title bar.
 *
 * On Windows the frame around the page is drawn by the system, not by the
 * webview, so it stays light while the editor inside it goes dark. Asking it
 * to match means `DwmSetWindowAttribute`, which means a window handle, and
 * `Deno.BrowserWindow` — the thing that would hand one over — blocks for ever
 * (see `bridge.ts`). So the handle is found the only way left: by the name the
 * window already has.
 *
 * That name is wrong, which is what makes it usable. Deno Desktop titles the
 * window from `desktop.app.name` through something that reads a UTF-16 string
 * as a C string, so `Massing` arrives as `M` — one character, deterministic,
 * and ours.
 *
 * **The title itself is not fixed here, and not for want of trying.**
 * `SetWindowTextW` on this handle returns 1, and reading the title straight
 * back returns the old one: the backend's window proc takes the message and
 * discards it. Measured, not assumed. The title needs the `cef` backend or an
 * upstream fix; `docs/DESKTOP.md` has the table.
 */

const IS_WINDOWS = Deno.build.os === 'windows';

/**
 * `DWMWA_USE_IMMERSIVE_DARK_MODE`, as of Windows 10 build 18985. Older builds
 * used 19 and answer a non-zero HRESULT to this one, which is handled by
 * treating any non-zero result as "this Windows cannot".
 */
const DARK_MODE = 20;

/** A null-terminated UTF-16LE string, which is what the `W` functions take. */
function wide(text: string): Uint8Array {
  const buffer = new Uint8Array((text.length + 1) * 2);
  const view = new DataView(buffer.buffer);
  for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), true);
  return buffer;
}

let handle: Deno.PointerValue = null;
let dwm:
  | Deno.DynamicLibrary<{
    DwmSetWindowAttribute: { parameters: ['pointer', 'u32', 'buffer', 'u32']; result: 'i32' };
  }>
  | null = null;
let wanted: boolean | null = null;

/**
 * Find the window, once.
 *
 * Polled because the runtime creates it after this module has finished and
 * there is no event that says when. Ten seconds is far longer than it takes
 * and still terminates.
 *
 * Skipped entirely under `MASSING_FRAME=off`, which `deno task dev` sets:
 * these same calls, in a build made with `--hmr`, took the process down hard
 * enough that the window left behind said "Application Error". In an ordinary
 * build they are fine — proven by running them there — but a dev task that
 * crashes is not worth a matching title bar.
 */
export async function followWindowsTheme(names: string[]) {
  if (!IS_WINDOWS || Deno.env.get('MASSING_FRAME') === 'off') return;

  let user32;
  try {
    user32 = Deno.dlopen('user32.dll', {
      FindWindowW: { parameters: ['pointer', 'buffer'], result: 'pointer' },
    });
    dwm = Deno.dlopen('dwmapi.dll', {
      DwmSetWindowAttribute: {
        parameters: ['pointer', 'u32', 'buffer', 'u32'],
        result: 'i32',
      },
    });
  } catch (err) {
    // No FFI permission, or a Windows without these. A light title bar is not
    // worth failing to start over.
    console.error('massing: the title bar will not follow the theme -', err);
    return;
  }

  /*
   * More than one name to try, because the two backends title the window
   * differently: `webview` truncates to `M` and `cef` uses the whole thing.
   * Switching backend is one line in `deno.json` and should not quietly turn
   * this off.
   */
  for (let attempt = 0; attempt < 40 && !handle; attempt++) {
    for (const name of names) {
      handle = user32.symbols.FindWindowW(null, wide(name));
      if (handle) break;
    }
    if (!handle) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!handle) {
    console.error('massing: could not find the window to theme its title bar');
    return;
  }
  // The page may have said which way it wants before the window existed.
  if (wanted !== null) setDarkFrame(wanted);
}

/**
 * Make the frame match the editor inside it.
 *
 * Remembered rather than dropped when the window is not found yet, because the
 * page reports its theme as soon as it loads and that is usually a second or
 * two before the polling above succeeds.
 */
export function setDarkFrame(dark: boolean) {
  wanted = dark;
  if (!handle || !dwm) return false;
  const value = new Uint8Array(4);
  new DataView(value.buffer).setInt32(0, dark ? 1 : 0, true);
  const applied = dwm.symbols.DwmSetWindowAttribute(handle, DARK_MODE, value, 4) === 0;
  // Once, and only the first time: a non-zero HRESULT means this Windows does
  // not know the attribute, and that is worth saying rather than leaving
  // somebody to wonder why the frame never changes.
  if (!said) {
    said = true;
    console.error(
      applied
        ? 'massing: the title bar follows the editor theme'
        : 'massing: this Windows will not theme the title bar',
    );
  }
  return applied;
}

let said = false;
