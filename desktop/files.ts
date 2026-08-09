/**
 * The disk, as the desktop app is allowed to touch it.
 *
 * Three jobs the browser cannot do: ask the operating system where to put a
 * file, read and write that path directly, and notice when something else
 * changes it.
 */

/**
 * A native file dialog, by subprocess.
 *
 * Deno Desktop does not expose a file picker — its dialogs page documents
 * `alert`, `confirm` and `prompt` and lists pickers as roadmap — and the
 * webview backend cannot fall back on the browser's own, because WKWebView on
 * macOS and WebKitGTK on Linux do not implement the File System Access API at
 * all. So the app brings its own by asking each OS for the dialog it already
 * ships.
 *
 * The answer comes back through a temp file rather than through stdout. A Deno
 * Desktop binary on Windows is a GUI-subsystem process with no console
 * handles, and a subprocess spawned with anything other than `"null"` on all
 * three streams is reported to fail outright — so there is no stdout to read.
 * Writing the chosen path to a file is the channel that works on every
 * platform, and it costs one temp file per dialog.
 *
 * All of this is replaced by four lines the day Deno ships the real API.
 */

/** Shell-quote for PowerShell single-quoted strings. */
const ps = (s: string) => s.replaceAll("'", "''");
/** Shell-quote for AppleScript / POSIX single-quoted strings. */
const sh = (s: string) => s.replaceAll("'", "'\\''");

type Dialog = { mode: 'open' | 'save'; suggested?: string };

function windowsScript({ mode, suggested }: Dialog, out: string): string {
  const kind = mode === 'save' ? 'SaveFileDialog' : 'OpenFileDialog';
  const name = suggested ? `$d.FileName = '${ps(suggested)}'` : '';
  return `
Add-Type -AssemblyName PresentationFramework
$d = New-Object Microsoft.Win32.${kind}
${name}
$d.Filter = 'Massing diagram (*.arch.json;*.json)|*.arch.json;*.json|All files (*.*)|*.*'
if ($d.ShowDialog()) { Set-Content -LiteralPath '${ps(out)}' -Value $d.FileName -Encoding utf8 -NoNewline }
`;
}

function macScript({ mode, suggested }: Dialog, out: string): string {
  const ask = mode === 'save'
    ? `choose file name with prompt "Save diagram" default name "${sh(suggested ?? 'diagram.arch.json')}"`
    : 'choose file with prompt "Open diagram"';
  // `POSIX path of` turns the HFS-style alias AppleScript returns into a path
  // the rest of this program can use.
  return `set f to ${ask}
set p to POSIX path of f
do shell script "printf '%s' " & quoted form of p & " > " & quoted form of "${sh(out)}"`;
}

/** The command for this platform, or null where we have no dialog to offer. */
function dialogCommand(spec: Dialog, out: string): Deno.Command | null {
  const quiet = { stdin: 'null', stdout: 'null', stderr: 'null' } as const;
  if (Deno.build.os === 'windows') {
    return new Deno.Command('powershell.exe', {
      // -STA because the WPF dialog needs a single-threaded apartment.
      args: ['-NoProfile', '-STA', '-NonInteractive', '-Command', windowsScript(spec, out)],
      ...quiet,
    });
  }
  if (Deno.build.os === 'darwin') {
    return new Deno.Command('osascript', { args: ['-e', macScript(spec, out)], ...quiet });
  }
  // Linux: zenity is on most desktops; kdialog is the KDE one. Tried in turn
  // by the caller, because "not installed" is a spawn error rather than a
  // non-zero exit.
  const args = spec.mode === 'save'
    ? ['--file-selection', '--save', '--confirm-overwrite', `--filename=${spec.suggested ?? ''}`]
    : ['--file-selection'];
  return new Deno.Command('zenity', { args: [...args, `--title=${spec.mode === 'save' ? 'Save diagram' : 'Open diagram'}`], ...quiet });
}

/**
 * Show a dialog and return the chosen absolute path, or null if it was
 * dismissed.
 *
 * Cancelling and failing are the same answer on purpose. A dialog that could
 * not be shown at all — no `zenity` on a bare Linux box — must not become an
 * exception in the middle of someone pressing Save; it reads as "nothing was
 * chosen", and the caller falls back to the browser's own download.
 */
export async function pickPath(spec: Dialog): Promise<string | null> {
  const out = await Deno.makeTempFile({ prefix: 'massing-dialog-' });
  try {
    const command = dialogCommand(spec, out);
    if (!command) return null;
    await command.spawn().status;
    const picked = (await Deno.readTextFile(out)).trim();
    return picked || null;
  } catch (err) {
    console.error(`massing: the ${spec.mode} dialog could not be shown —`, err);
    return null;
  } finally {
    await Deno.remove(out).catch(() => {});
  }
}

export function readFile(path: string): Promise<string> {
  return Deno.readTextFile(path);
}

export async function writeFile(path: string, text: string): Promise<void> {
  await Deno.writeTextFile(path, text);
}

export async function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  await Deno.writeFile(path, bytes);
}

/**
 * Notice when something else edits the open file.
 *
 * Watching the **directory** rather than the file is not an optimisation, it
 * is the only thing that works. An editor's atomic save writes a temp file and
 * renames it over the original, which replaces the inode the watcher is
 * holding — a single-file watch then goes silent for ever, and the symptom is
 * that live reload works exactly once. Deno's own watch mode documents this
 * failure. So: watch the directory, filter by name.
 *
 * Two filters sit on top of that. One save can emit three or four events, so
 * they are coalesced on a short timer; and our own writes are ignored for a
 * moment afterwards, because the app saving a file should not read as somebody
 * else changing it.
 */
export function watchFile(path: string, onChange: () => void) {
  /*
   * Split on whichever separator comes last, not on "the Windows one".
   *
   * Paths arrive from more than one place — a native dialog gives
   * `C:\a\b.json`, and anything assembled in the page or a test gives
   * `C:\a/b.json`. Picking a single separator up front reads the second as one
   * long filename in the wrong directory, and the watcher then follows a
   * directory nothing is happening in and reports nothing, for ever.
   *
   * The events are then matched on the filename alone, because the separator
   * in the path we were *given* says nothing about the one the OS reports
   * with: Windows hands back `C:\a\b.json` however the path was spelled here.
   */
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const directory = at > 0 ? path.slice(0, at) : '.';
  const name = path.slice(at + 1);
  const named = (p: string) => p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1) === name;

  let watcher: Deno.FsWatcher | null = null;
  // `ReturnType`, not `number`: Deno types `setTimeout` as Node's, which hands
  // back a `Timeout` object rather than the browser's integer.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ignoreUntil = 0;
  let stopped = false;

  (async () => {
    try {
      watcher = Deno.watchFs(directory, { recursive: false });
    } catch (err) {
      console.error(`massing: cannot watch ${directory} —`, err);
      return;
    }
    for await (const event of watcher) {
      if (stopped) break;
      if (event.kind === 'access') continue;
      if (!event.paths.some(named)) continue;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (stopped || Date.now() < ignoreUntil) return;
        onChange();
      }, SETTLE_MS);
    }
  })();

  return {
    /** Called around our own writes, so a save does not look like an edit. */
    mine() {
      ignoreUntil = Date.now() + MINE_MS;
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      try {
        watcher?.close();
      } catch {
        // Already closed with the iterator; nothing to do.
      }
    },
  };
}

/** Long enough to swallow one editor's burst of events, short enough to feel live. */
const SETTLE_MS = 120;
/** How long after our own write the file is not somebody else's change. */
const MINE_MS = 600;
