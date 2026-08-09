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

/// Where releases live, and the key they are signed with.
///
/// Environment rather than config so a build can be pointed at a staging
/// channel without a rebuild, and so a fork does not inherit an endpoint it
/// does not own.
pub fn start(app: &AppHandle, bridge: Arc<Bridge>) -> Updates {
    let Ok(endpoint) = std::env::var("MASSING_RELEASES") else {
        return Updates::Off("no release URL is configured".into());
    };
    let key = std::env::var("MASSING_RELEASE_KEY").unwrap_or_default();
    if key.is_empty() {
        return Updates::Off("no release key is configured".into());
    }
    let Ok(url) = endpoint.parse() else {
        return Updates::Off(format!("{endpoint} is not a URL"));
    };

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let built = handle
            .updater_builder()
            .endpoints(vec![url])
            .and_then(|b| b.pubkey(key).build());
        let updater = match built {
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
