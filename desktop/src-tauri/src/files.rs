//! The disk, and the dialogs that choose where on it.
//!
//! Both of these were the previous shell's worst code. The dialogs were three
//! shelled-out scripts — PowerShell, `osascript`, `zenity` — writing their
//! answer to a temp file because the process had no usable stdout, and the
//! watcher had to match events by filename because the path separators
//! disagreed. One of those problems is gone entirely and the other is smaller.

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use notify::{Event, EventKind, RecursiveMode, Watcher};
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};

/// Long enough to swallow one editor's burst of events, short enough to feel
/// live. A single save routinely emits three or four.
const SETTLE: Duration = Duration::from_millis(120);
/// How long after our own write the file is not somebody else's change.
const OURS_FOR: Duration = Duration::from_millis(600);

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64
}

/// Ask the operating system where a file should go.
///
/// One plugin call per platform instead of a script per platform. It is
/// blocking-with-a-callback rather than async, so it is bounced onto a
/// oneshot; `blocking_pick_file` exists but deadlocks when called from the
/// thread the dialog needs.
pub async fn pick(app: &AppHandle, save: bool, suggested: Option<String>) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut builder = app
        .dialog()
        .file()
        .add_filter("Massing diagram", &["arch.json", "json"])
        .add_filter("All files", &["*"]);
    if let Some(name) = suggested {
        builder = builder.set_file_name(name);
    }

    if save {
        builder.save_file(move |chosen| {
            let _ = tx.send(chosen);
        });
    } else {
        builder.pick_file(move |chosen| {
            let _ = tx.send(chosen);
        });
    }

    match rx.await.ok().flatten() {
        // A dialog answers with its own path type; everything downstream of
        // here — the watcher, the MCP setup, the page — deals in plain strings.
        Some(FilePath::Path(path)) => Some(path.to_string_lossy().into_owned()),
        Some(other) => Some(other.to_string()),
        None => None,
    }
}

/// A watch on one file, and the suppression window around our own writes.
pub struct Watch {
    pub path: String,
    ours_until: Arc<AtomicU64>,
    // Dropping the watcher is what stops it, so it is held even though nothing
    // reads it.
    _watcher: notify::RecommendedWatcher,
    _stop: mpsc::Sender<()>,
}

impl Watch {
    pub fn ours(&self) {
        self.ours_until.store(now_ms() + OURS_FOR.as_millis() as u64, Ordering::Relaxed);
    }
}

/// Notice when something else edits the open file.
///
/// Watching the **directory** rather than the file is not an optimisation, it
/// is the only thing that works: an editor's atomic save writes a temp file and
/// renames it over the original, which replaces the inode the watcher holds. A
/// single-file watch then goes quiet for ever, and the symptom is that live
/// reload works exactly once.
///
/// Events are matched on the file name alone, because the separator in the path
/// we were given says nothing about the one the OS reports with.
pub fn watch<F>(path: String, on_change: F) -> notify::Result<Watch>
where
    F: Fn() + Send + 'static,
{
    let target = Path::new(&path).to_path_buf();
    let directory = target.parent().map(Path::to_path_buf).unwrap_or_default();
    let name = target.file_name().map(|n| n.to_os_string());

    let ours_until = Arc::new(AtomicU64::new(0));
    let (events_tx, events_rx) = mpsc::channel::<()>();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();

    let mut watcher = notify::recommended_watcher(move |event: notify::Result<Event>| {
        let Ok(event) = event else { return };
        if matches!(event.kind, EventKind::Access(_)) {
            return;
        }
        let hit = event
            .paths
            .iter()
            .any(|p| p.file_name().map(|n| Some(n.to_os_string()) == name).unwrap_or(false));
        if hit {
            let _ = events_tx.send(());
        }
    })?;
    watcher.watch(&directory, RecursiveMode::NonRecursive)?;

    // Coalescing thread: a burst of events becomes one call, and a call that
    // lands inside our own write window is dropped.
    let gate = Arc::clone(&ours_until);
    std::thread::spawn(move || loop {
        if stop_rx.try_recv().is_ok() {
            return;
        }
        match events_rx.recv_timeout(Duration::from_millis(250)) {
            Ok(()) => {
                // Drain whatever else arrived while we were being woken.
                while events_rx.recv_timeout(SETTLE).is_ok() {}
                if now_ms() >= gate.load(Ordering::Relaxed) {
                    on_change();
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        }
    });

    Ok(Watch { path, ours_until, _watcher: watcher, _stop: stop_tx })
}
