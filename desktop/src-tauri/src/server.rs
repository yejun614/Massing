//! Serving the editor to its own window, and the API under it.
//!
//! The app runs the same files the browser does — `index.html` loading
//! `src/main.js` as native ES modules — rather than a bundle. The bundle exists
//! so a diagram editor can be emailed as one file, which is not a problem the
//! desktop app has, and running the tree means an edit is one reload away.

use std::convert::Infallible;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::body::Body;
use axum::extract::State;
use axum::http::{header, StatusCode, Uri};
use axum::response::sse::{Event, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

use crate::bridge::{Bridge, CallResult};
use crate::files;
use crate::setup;

/// Everything the routes need.
#[derive(Clone)]
pub struct AppState {
    pub bridge: Arc<Bridge>,
    pub app: AppHandle,
    /// Where the editor's files are: the repo in a dev run, the bundled
    /// resources in a release one.
    pub assets: PathBuf,
}

/// Everything the window is allowed to load, relative to the assets root.
const SERVED: [&str; 4] = ["src", "styles", "examples", "schema"];

fn content_type(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
}

/// The two lines that turn the web app into the desktop one.
///
/// The meta tag is a third gate beside the two in `core/features.js`. The shim
/// is loaded **before** the app's own script, which is what makes it work at
/// all: `io.js` decides once, at construction, whether a file picker exists, so
/// anything installing one has to have finished before `main.js` starts. Module
/// scripts run in document order, and that is the entire mechanism.
fn desktopify(html: &str) -> String {
    html.replace(
        "</head>",
        "<meta name=\"massing-desktop\" content=\"1\">\n</head>",
    )
    .replace(
        "<script type=\"module\" src=\"src/main.js\"></script>",
        "<script type=\"module\" src=\"/__massing/shim.js\"></script>\n\
             <script type=\"module\" src=\"src/main.js\"></script>",
    )
}

fn no_store(kind: &str, body: Vec<u8>) -> Response {
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, kind.to_string()),
            // The window is the only client and lives as long as the process.
            // Caching would mean editing a source file and reloading to nothing.
            (header::CACHE_CONTROL, "no-store".to_string()),
        ],
        Body::from(body),
    )
        .into_response()
}

fn not_found() -> Response {
    (StatusCode::NOT_FOUND, "Not found").into_response()
}

/// Read a file under the assets root, refusing anything that climbs out of it.
async fn send(root: &Path, relative: &str) -> Response {
    let mut full = root.to_path_buf();
    for part in relative.split('/') {
        // `..` never reaches the filesystem; there is no legitimate request
        // here that needs it, so it is refused rather than resolved.
        if part.is_empty() || part == "." || part == ".." {
            return not_found();
        }
        full.push(part);
    }
    match tokio::fs::read(&full).await {
        Ok(bytes) => no_store(content_type(relative), bytes),
        Err(_) => not_found(),
    }
}

async fn editor(State(state): State<AppState>, uri: Uri) -> Response {
    let path = uri.path();

    if path == "/" || path == "/index.html" {
        let file = state.assets.join("index.html");
        return match tokio::fs::read_to_string(file).await {
            Ok(html) => no_store("text/html; charset=utf-8", desktopify(&html).into_bytes()),
            Err(_) => not_found(),
        };
    }

    // The shell's own browser code, from a path the editor does not use.
    if let Some(name) = path.strip_prefix("/__massing/") {
        if name.ends_with(".js") {
            return send(&state.assets, &format!("desktop/web/{name}")).await;
        }
        return not_found();
    }

    let relative = path.trim_start_matches('/');
    match relative.split('/').next() {
        Some(top) if SERVED.contains(&top) => send(&state.assets, relative).await,
        _ => not_found(),
    }
}

// ---------------------------------------------------------------------------
// The bridge
// ---------------------------------------------------------------------------

async fn events(
    State(state): State<AppState>,
) -> Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>> {
    let stream = BroadcastStream::new(state.bridge.events.subscribe())
        .filter_map(|line| line.ok().map(|data| Ok(Event::default().data(data))));
    Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::default())
}

async fn dialog(State(state): State<AppState>, uri: Uri, Json(body): Json<Value>) -> Json<Value> {
    let save = uri.path().ends_with("save");
    let suggested = body
        .get("suggested")
        .and_then(Value::as_str)
        .map(str::to_owned);
    match files::pick(&state.app, save, suggested).await {
        // A dismissed dialog and one that could not be shown are the same
        // answer; the page falls back to what a browser would do.
        Some(path) => {
            let name = base_name(&path);
            Json(json!({ "path": path, "name": name }))
        }
        None => Json(json!({ "path": Value::Null })),
    }
}

pub fn base_name(path: &str) -> String {
    path.rsplit(['/', '\\']).next().unwrap_or(path).to_string()
}

async fn read(Json(body): Json<Value>) -> Response {
    let Some(path) = body.get("path").and_then(Value::as_str) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "read needs a path" })),
        )
            .into_response();
    };
    match tokio::fs::read_to_string(path).await {
        Ok(text) => Json(json!({ "text": text, "name": base_name(path) })).into_response(),
        Err(err) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": err.to_string() })),
        )
            .into_response(),
    }
}

async fn write(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    let Some(path) = body.get("path").and_then(Value::as_str) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "write needs a path" })),
        )
            .into_response();
    };
    let text = body.get("text").and_then(Value::as_str).unwrap_or("");
    // Announced before the write, not after: the events can arrive while the
    // write is still returning, and a window that opens afterwards has already
    // missed them.
    state.bridge.ours();
    match tokio::fs::write(path, text).await {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": err.to_string() })),
        )
            .into_response(),
    }
}

/// An exported image, which is bytes rather than text.
async fn export(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    let suggested = body
        .get("suggested")
        .and_then(Value::as_str)
        .unwrap_or("diagram.png")
        .to_string();
    let Some(path) = files::pick(&state.app, true, Some(suggested)).await else {
        return Json(json!({ "path": Value::Null })).into_response();
    };
    let encoded = body.get("base64").and_then(Value::as_str).unwrap_or("");
    match crate::base64_decode(encoded) {
        Some(bytes) => match tokio::fs::write(&path, bytes).await {
            Ok(()) => Json(json!({ "path": path, "name": base_name(&path) })).into_response(),
            Err(err) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": err.to_string() })),
            )
                .into_response(),
        },
        None => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "not base64" })),
        )
            .into_response(),
    }
}

async fn watch(State(state): State<AppState>, Json(body): Json<Value>) -> Json<Value> {
    let path = body
        .get("path")
        .and_then(Value::as_str)
        .filter(|p| !p.is_empty());
    state.bridge.watch(path.map(str::to_owned));
    Json(json!({ "watching": path }))
}

async fn result(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    let settled = serde_json::from_value::<CallResult>(body)
        .map(|answer| state.bridge.settle(answer))
        .unwrap_or(false);
    if settled {
        Json(json!({ "ok": true })).into_response()
    } else {
        (
            StatusCode::CONFLICT,
            Json(json!({ "error": "no call is waiting on that id" })),
        )
            .into_response()
    }
}

/// Which way the editor is themed.
///
/// Kept even though Tauri titles and themes its own window, because the theme
/// button cycles system, light and dark and the forced settings are where the
/// window and the page would otherwise disagree.
async fn theme(State(state): State<AppState>, Json(body): Json<Value>) -> Json<Value> {
    let dark = body.get("dark").and_then(Value::as_bool).unwrap_or(false);
    crate::window::set_theme(&state.app, dark);
    Json(json!({ "ok": true }))
}

async fn mcp_targets(State(state): State<AppState>) -> Json<Value> {
    let url = state.bridge.mcp_url.lock().unwrap().clone();
    let targets = if url.is_some() {
        setup::survey()
    } else {
        vec![]
    };
    Json(json!({ "url": url, "targets": targets }))
}

async fn mcp_register(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    let Some(url) = state.bridge.mcp_url.lock().unwrap().clone() else {
        return (
            StatusCode::CONFLICT,
            Json(json!({ "error": "the MCP server is switched off" })),
        )
            .into_response();
    };
    let ids: Vec<String> = body
        .get("ids")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    if ids.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "nothing chosen" })),
        )
            .into_response();
    }
    Json(json!({ "url": url, "targets": setup::register(&ids, &url) })).into_response()
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/__massing/events", get(events))
        .route("/__massing/dialog/open", post(dialog))
        .route("/__massing/dialog/save", post(dialog))
        .route("/__massing/read", post(read))
        .route("/__massing/write", post(write))
        .route("/__massing/export", post(export))
        .route("/__massing/watch", post(watch))
        .route("/__massing/result", post(result))
        .route("/__massing/theme", post(theme))
        .route("/__massing/mcp/targets", post(mcp_targets))
        .route("/__massing/mcp/register", post(mcp_register))
        .fallback(editor)
        .with_state(state)
}
