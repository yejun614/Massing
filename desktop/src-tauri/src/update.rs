//! Keeping the app current, without asking.
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

use std::sync::Arc;

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
/// Shared by the automatic check and the menu item, so the two cannot disagree
/// about what a working channel is.
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

/// Check because somebody clicked, and say so either way.
///
/// The automatic check is deliberately quiet when there is nothing to report —
/// an app that announced "no update" every launch would be a nuisance. That
/// leaves no way to tell a working channel from a broken one, which is exactly
/// the question a person asking this has. So this one always answers.
pub fn check_now(app: &AppHandle, bridge: Arc<Bridge>) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let updater = match updater(&handle) {
            Ok(updater) => updater,
            Err(why) => return bridge.notice(format!("Cannot check for updates: {why}.")),
        };
        match updater.check().await {
            Ok(Some(update)) => {
                let version = update.version.clone();
                bridge.notice(format!("Massing {version} found — downloading it now."));
                match update.download_and_install(|_, _| {}, || {}).await {
                    Ok(()) => bridge.notice(format!(
                        "Massing {version} is ready, and will be there next time you open it."
                    )),
                    Err(err) => bridge.notice(format!("That update would not install: {err}")),
                }
            }
            Ok(None) => bridge.notice(format!(
                "Massing {} is the latest version.",
                handle.package_info().version
            )),
            Err(err) => bridge.notice(format!("Could not reach the update channel: {err}")),
        }
    });
}

/// Check once at launch, and stay quiet unless there is something to say.
///
/// An app that announced "no update" on every start would be a nuisance, which
/// is why the silence is deliberate here and why `check_now` exists for the
/// person who wants to know.
pub fn start(app: &AppHandle, bridge: Arc<Bridge>) -> Updates {
    let built = match updater(app) {
        Ok(updater) => updater,
        Err(why) => return Updates::Off(why),
    };

    tauri::async_runtime::spawn(async move {
        let updater = built;
        match updater.check().await {
            Ok(Some(update)) => {
                let version = update.version.clone();
                match update.download_and_install(|_, _| {}, || {}).await {
                    // Announced, never applied under a running app: the version
                    // fetched today is the one started tomorrow, which is the
                    // right trade when somebody has a document open.
                    Ok(()) => bridge.notice(format!(
                        "Massing {version} is ready, and will be there next time you open it."
                    )),
                    Err(err) => eprintln!("massing: the update would not install: {err}"),
                }
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

/// Whether the config carries a non-empty `pubkey`.
fn has_key(config: &serde_json::Value) -> bool {
    config
        .get("pubkey")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|key| !key.trim().is_empty())
}
