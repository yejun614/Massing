//! Massing, as a desktop app.
//!
//! The shell is a Tauri window pointed at a loopback HTTP server that serves
//! the editor unchanged, plus the three things a browser cannot do: choose a
//! path with the operating system's own dialog, read and write that path, and
//! say when something else has changed it. A second server, on a fixed port,
//! is the MCP endpoint a coding agent connects to.

pub mod bridge;
pub mod files;
pub mod mcp;
pub mod server;
pub mod setup;
pub mod update;
pub mod window;

use std::net::{Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

use bridge::Bridge;

/// Where the editor's files are.
///
/// The repo in a dev run, so an edit is one reload away; the bundled resources
/// in a release one. Deciding by build profile rather than by probing means a
/// release can never quietly serve a developer's working tree.
fn assets(app: &tauri::AppHandle) -> PathBuf {
    if cfg!(debug_assertions) {
        // `src-tauri/` → repo root.
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
    } else {
        app.path()
            .resource_dir()
            .map(|dir| dir.join("editor"))
            .unwrap_or_else(|_| PathBuf::from("editor"))
    }
}

/// Base64, by hand.
///
/// One route needs it — an exported image arriving as text — and a crate for
/// forty lines of table lookup is not a trade this project makes.
pub fn base64_decode(text: &str) -> Option<Vec<u8>> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut lookup = [255u8; 256];
    for (i, c) in TABLE.iter().enumerate() {
        lookup[*c as usize] = i as u8;
    }
    let mut out = Vec::with_capacity(text.len() / 4 * 3);
    let mut buffer = 0u32;
    let mut bits = 0u32;
    for byte in text.bytes() {
        if byte == b'=' || byte.is_ascii_whitespace() {
            continue;
        }
        let value = lookup[byte as usize];
        if value == 255 {
            return None;
        }
        buffer = (buffer << 6) | value as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
        }
    }
    Some(out)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();
            let bridge = Bridge::new();
            let state = server::AppState {
                bridge: Arc::clone(&bridge),
                app: handle.clone(),
                assets: assets(&handle),
            };

            /*
             * The editor's server first, on whatever port is free, because the
             * window cannot be pointed anywhere until it is listening.
             */
            let editor = std::net::TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))?;
            let port = editor.local_addr()?.port();
            editor.set_nonblocking(true)?;

            let router = server::router(state);
            tauri::async_runtime::spawn(async move {
                let listener = tokio::net::TcpListener::from_std(editor)
                    .expect("the editor listener should convert");
                if let Err(err) = axum::serve(listener, router).await {
                    eprintln!("massing: the editor server stopped: {err}");
                }
            });
            eprintln!("massing: serving the editor on 127.0.0.1:{port}");

            /*
             * The MCP server second, on a port a CLI can be told about.
             *
             * Asked for rather than assumed: 7337 may be held by another copy
             * of this app or by anything else, and a desktop app that refuses
             * to start because a port is busy is a bad desktop app. The real
             * port is written where the setup instructions can find it.
             */
            if std::env::var("MASSING_MCP").as_deref() != Ok("off") {
                let wanted: u16 = std::env::var("MASSING_MCP_PORT")
                    .ok()
                    .and_then(|p| p.parse().ok())
                    .unwrap_or(mcp::DEFAULT_PORT);
                let listener =
                    std::net::TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, wanted)))
                        .or_else(|_| {
                            eprintln!(
                                "massing: {wanted} is taken, taking whatever is free instead"
                            );
                            std::net::TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
                        })?;
                let actual = listener.local_addr()?.port();
                listener.set_nonblocking(true)?;

                let url = format!("http://127.0.0.1:{actual}/mcp");
                *bridge.mcp_url.lock().unwrap() = Some(url.clone());
                window::record_port(&url);
                eprintln!("massing: MCP on {url}");

                let service = mcp::service(Arc::clone(&bridge));
                tauri::async_runtime::spawn(async move {
                    let listener = tokio::net::TcpListener::from_std(listener)
                        .expect("the MCP listener should convert");
                    let app = axum::Router::new().nest_service("/mcp", service);
                    if let Err(err) = axum::serve(listener, app).await {
                        eprintln!("massing: the MCP server stopped: {err}");
                    }
                });
            }

            match update::start(&handle, Arc::clone(&bridge)) {
                update::Updates::Watching => eprintln!("massing: checking for updates"),
                update::Updates::Off(why) => eprintln!("massing: updates off - {why}"),
            }

            let window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(format!("http://127.0.0.1:{port}/").parse()?),
            )
            .title("Massing — Isometric architecture diagrams")
            .inner_size(1180.0, 800.0)
            .min_inner_size(640.0, 480.0)
            .build()?;
            window::install_menu(&window, Arc::clone(&bridge))?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("massing failed to start");
}
