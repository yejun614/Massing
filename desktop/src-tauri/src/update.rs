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

use serde_json::json;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::bridge::Bridge;

/// Reported back so the caller can say, once, why nothing will happen.
pub enum Updates {
    Watching,
    Off(String),
}

/// Start checking, if this build has a channel to check.
///
/// The endpoint and the key normally come from `tauri.conf.json`, because that
/// is what a released build carries. `MASSING_RELEASES` overrides the endpoint
/// so a build can be pointed at a staging channel without a rebuild — the key
/// is never overridden, since the whole point of it is that it is fixed at
/// build time.
///
/// An empty `pubkey` in the config means the plugin itself refuses to run, and
/// that is the signal used here: no key, no channel, said once and plainly
/// rather than checking silently for ever.
pub fn start(app: &AppHandle, bridge: Arc<Bridge>) -> Updates {
    if !app.config().plugins.0.get("updater").is_some_and(has_key) {
        return Updates::Off("this build is not signed for updates".into());
    }
    let staging = std::env::var("MASSING_RELEASES").ok();

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut builder = handle.updater_builder();
        if let Some(url) = staging.and_then(|u| u.parse().ok()) {
            builder = match builder.endpoints(vec![url]) {
                Ok(b) => b,
                Err(err) => {
                    eprintln!("massing: that staging URL will not do: {err}");
                    return;
                }
            };
        }
        let updater = match builder.build() {
            Ok(updater) => updater,
            Err(err) => {
                eprintln!("massing: the updater would not start: {err}");
                return;
            }
        };
        match updater.check().await {
            Ok(Some(update)) => {
                let version = update.version.clone();
                match update.download_and_install(|_, _| {}, || {}).await {
                    // Announced, never applied under a running app: the version
                    // fetched today is the one started tomorrow, which is the
                    // right trade when somebody has a document open.
                    Ok(()) => bridge.push(json!({
                        "type": "notice",
                        "message": format!(
                            "Massing {version} is ready, and will be there next time you open it."
                        ),
                    })),
                    Err(err) => eprintln!("massing: the update would not install: {err}"),
                }
            }
            Ok(None) => {}
            Err(err) => eprintln!("massing: could not check for updates: {err}"),
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
