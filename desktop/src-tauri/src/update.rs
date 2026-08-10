//! Keeping the app current, once somebody has said so.
//!
//! Tauri checks a manifest, downloads a signed bundle and installs it. Unlike
//! the shell this replaced, that works on Windows as well as macOS and Linux —
//! it was the one thing the previous updater could not do, and the reason its
//! docs had to carry a paragraph of apology.
//!
//! **Signed or not at all.** Tauri will not run an unsigned update and neither
//! will this: without a public key, anything that can answer for the release
//! host — a redirect, a stale CDN entry, a hostile network — could hand the app
//! a bundle to install. An update channel nobody can forge is worth more than
//! one that merely exists.
//!
//! **Found is not the same as wanted.** Checking and installing used to be one
//! step: the launch check downloaded and installed whatever it found. On
//! Windows that is not a background task at all — the plugin hands the bundle
//! to `ShellExecute` and calls `exit(0)`, so the app someone had just opened
//! disappeared and an installer they had not asked for appeared in its place.
//! Nothing after that point is Massing's any more, which also means nothing
//! after that point could be reported by Massing when it went wrong. So the
//! check now only ever *offers*, and the three answers to that offer live in
//! `desktop/web/update-ui.js`.

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::json;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::bridge::Bridge;

/// Reported back so the caller can say, once, why nothing will happen.
pub enum Updates {
    Watching,
    Off(String),
}

/// Build the updater, or say why not.
///
/// Shared by the automatic check, the menu item and the install, so none of the
/// three can disagree about what a working channel is.
///
/// The endpoint and the key come from `tauri.conf.json`, because that is what a
/// released build carries. `MASSING_RELEASES` overrides the endpoint so a build
/// can be pointed at a staging channel without a rebuild; the key is never
/// overridden, since being fixed at build time is the whole point of it.
fn updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    if !app.config().plugins.0.get("updater").is_some_and(has_key) {
        return Err("this build is not signed for updates".into());
    }
    let mut builder = app.updater_builder();
    if let Some(url) = std::env::var("MASSING_RELEASES")
        .ok()
        .and_then(|u| u.parse().ok())
    {
        builder = builder.endpoints(vec![url]).map_err(|e| e.to_string())?;
    }
    builder.build().map_err(|e| e.to_string())
}

/// Tell the window there is something to install, and let it ask.
///
/// `hold` rather than `push`: the launch check finishes on network time, which
/// is usually before the page has opened its `EventSource`, and an offer
/// broadcast to nobody is how "there is no update UI" looked from the outside.
///
/// `restarts` is the honest half of the question. Installing means two
/// different things: on Windows the installer takes over and the app is closed
/// and reopened around it, and everywhere else the bundle is swapped underneath
/// and the new version is what starts next time. A dialog that promised one on
/// a platform that does the other would be lying to exactly the person who
/// stopped to read it.
fn offer(bridge: &Bridge, version: &str, current: &str) {
    bridge.hold(json!({
        "type": "update",
        "version": version,
        "current": current,
        "restarts": cfg!(target_os = "windows"),
    }));
}

/// Check because somebody clicked, and say so either way.
///
/// The automatic check is deliberately quiet when there is nothing to report —
/// an app that announced "no update" every launch would be a nuisance. That
/// leaves no way to tell a working channel from a broken one, which is exactly
/// the question a person asking this has. So this one always answers.
///
/// A skipped version is offered again here. Skipping is an answer to being
/// interrupted, not a decision never to have that version, and somebody who has
/// just gone to the Help menu is not being interrupted.
pub fn check_now(app: &AppHandle, bridge: Arc<Bridge>) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let updater = match updater(&handle) {
            Ok(updater) => updater,
            Err(why) => return bridge.notice(format!("Cannot check for updates: {why}.")),
        };
        let current = handle.package_info().version.to_string();
        match updater.check().await {
            Ok(Some(update)) => offer(&bridge, &update.version, &current),
            Ok(None) => bridge.notice(format!("Massing {current} is the latest version.")),
            Err(err) => bridge.notice(format!("Could not reach the update channel: {err}")),
        }
    });
}

/// Check once at launch, and stay quiet unless there is something to offer.
///
/// An app that announced "no update" on every start would be a nuisance, which
/// is why the silence is deliberate here and why `check_now` exists for the
/// person who wants to know.
pub fn start(app: &AppHandle, bridge: Arc<Bridge>) -> Updates {
    let built = match updater(app) {
        Ok(updater) => updater,
        Err(why) => return Updates::Off(why),
    };
    let current = app.package_info().version.to_string();

    tauri::async_runtime::spawn(async move {
        let updater = built;
        match updater.check().await {
            Ok(Some(update)) => {
                // The one place the skip list is read. It exists to stop this
                // check asking the same question at every launch, and it has no
                // business silencing anything a person went looking for.
                if skipped().as_deref() == Some(update.version.as_str()) {
                    eprintln!("massing: {} is available and was skipped", update.version);
                    return;
                }
                offer(&bridge, &update.version, &current);
            }
            Ok(None) => {}
            /*
             * A failed check is two different events wearing one error type.
             *
             * Not reaching the channel is a network on a train, and belongs on
             * stderr. A manifest that *arrives and does not verify* means this
             * install can never update again — the usual cause being a release
             * signed with a key this build does not carry, which is what
             * happens after a lost private key. Left on stderr it is silent,
             * and silence is the worst possible handling: the app goes on
             * looking healthy for ever while being permanently stranded.
             *
             * Told apart by the text, because the crate's error taxonomy is
             * not something to depend on. Getting this wrong costs one toast
             * too many, which is the right side to be wrong on.
             */
            Err(err) => {
                let text = err.to_string();
                let unverifiable = text.to_lowercase().contains("signature")
                    || text.to_lowercase().contains("verify")
                    || text.to_lowercase().contains("minisign");
                eprintln!("massing: could not check for updates: {text}");
                if unverifiable {
                    bridge.notice(
                        "This copy cannot verify updates any more, so it will not receive \
                         them. Reinstall from the releases page to start getting them again.",
                    );
                }
            }
        }
    });

    Updates::Watching
}

/// Somebody said yes.
///
/// The channel is asked again rather than an `Update` being held from the check
/// that offered it. The manifest is a few hundred bytes, the answer may come
/// minutes later, and what should be installed is whatever is being published
/// *now* — not what was published when the dialog opened.
///
/// On Windows this call does not return: the plugin hands the installer to the
/// operating system and ends the process. That is why the dialog says so before
/// anyone presses the button.
pub fn install(app: &AppHandle, bridge: Arc<Bridge>) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let updater = match updater(&handle) {
            Ok(updater) => updater,
            Err(why) => return bridge.notice(format!("Cannot install the update: {why}.")),
        };
        match updater.check().await {
            Ok(Some(update)) => {
                let version = update.version.clone();
                bridge.notice(format!("Downloading Massing {version}…"));
                match update.download_and_install(|_, _| {}, || {}).await {
                    // Only reached where installing is a swap rather than a
                    // handover: on Windows the process is already gone.
                    Ok(()) => bridge.notice(format!(
                        "Massing {version} is ready, and will be there next time you open it."
                    )),
                    Err(err) => bridge.notice(format!("That update would not install: {err}")),
                }
            }
            // Both of these mean the thing that was offered is no longer on
            // offer, which is worth saying to somebody who just pressed Update.
            Ok(None) => bridge.notice(format!(
                "Massing {} is the latest version after all.",
                handle.package_info().version
            )),
            Err(err) => bridge.notice(format!("Could not reach the update channel: {err}")),
        }
    });
}

// --- the one version that is not to be mentioned again ----------------------

/// Beside the MCP port file, in the directory the shell keeps its state in.
fn skip_file() -> Option<PathBuf> {
    crate::state_dir().map(|d| d.join("updates.json"))
}

/// The version somebody asked not to be told about again, if there is one.
///
/// Every failure here — no state directory, no file, a file somebody edited
/// into nonsense — means the same thing: nothing has been skipped. Being told
/// about an update twice is a smaller harm than never being told again because
/// a JSON file lost a brace.
pub fn skipped() -> Option<String> {
    let text = std::fs::read_to_string(skip_file()?).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    value
        .get("skipped")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
}

/// Remember that this one was refused.
///
/// One version, not a list. The question this answers is "stop asking me about
/// *this* release", and a newer one is a different question — so the file holds
/// the last refusal and nothing else, and a version that has been superseded
/// stops mattering on its own.
pub fn skip(version: &str) {
    let Some(dir) = crate::state_dir() else {
        return;
    };
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let body = json!({ "skipped": version });
    let _ = std::fs::write(dir.join("updates.json"), format!("{body:#}\n"));
}

/// Whether the config carries a non-empty `pubkey`.
fn has_key(config: &serde_json::Value) -> bool {
    config
        .get("pubkey")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|key| !key.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `MASSING_STATE` is process-wide, so these run one at a time —
    /// `--test-threads=1`, which the npm script passes.
    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("massing-update-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::env::set_var("MASSING_STATE", &dir);
        dir
    }

    #[test]
    fn nothing_is_skipped_before_anything_is_skipped() {
        scratch("empty");
        assert_eq!(skipped(), None);
    }

    #[test]
    fn a_skipped_version_survives_a_restart() {
        let dir = scratch("roundtrip");
        skip("0.1.4");
        assert!(dir.join("updates.json").exists());
        assert_eq!(skipped().as_deref(), Some("0.1.4"));

        // One refusal at a time: skipping a later one forgets the earlier, so a
        // superseded version cannot go on silencing anything.
        skip("0.1.5");
        assert_eq!(skipped().as_deref(), Some("0.1.5"));
    }

    #[test]
    fn a_damaged_state_file_means_nothing_was_skipped() {
        let dir = scratch("damaged");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("updates.json"), "{not json").unwrap();
        // Not an error and not a refusal to update: the offer simply comes
        // back, which is the safe way round to be wrong.
        assert_eq!(skipped(), None);
    }
}
