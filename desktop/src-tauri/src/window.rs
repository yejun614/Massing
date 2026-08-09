//! The window itself: its menu, its theme, and where it writes its port down.
//!
//! All three were workarounds in the previous shell — a menu that could not
//! exist because there was no window object, a title bar coloured through
//! `DwmSetWindowAttribute` over FFI, and a title the backend refused to accept.
//! Here they are three ordinary calls, which is the reason for the move.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Theme, WebviewWindow, Wry};

/// Menu items that map to what the page already does.
///
/// Every one of these is a command the editor binds to a key, so the menu is a
/// second way in rather than a second implementation: the click is forwarded to
/// the page and the page runs the same code the shortcut does.
const ITEMS: [(&str, &str, &str); 6] = [
    ("new", "New", "CmdOrCtrl+N"),
    ("open", "Open…", "CmdOrCtrl+O"),
    ("save", "Save", "CmdOrCtrl+S"),
    ("saveAs", "Save As…", "CmdOrCtrl+Shift+S"),
    ("export", "Export image…", "CmdOrCtrl+E"),
    ("reload", "Reload from disk", "CmdOrCtrl+R"),
];

pub fn install_menu(window: &WebviewWindow) -> tauri::Result<()> {
    let app = window.app_handle();

    let mut file_items: Vec<MenuItem<Wry>> = Vec::new();
    for (id, label, accelerator) in ITEMS {
        file_items.push(MenuItem::with_id(app, id, label, true, Some(accelerator))?);
    }
    let file_refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> =
        file_items.iter().map(|i| i as &dyn tauri::menu::IsMenuItem<Wry>).collect();
    let file = Submenu::with_items(app, "File", true, &file_refs)?;

    // Undo, cut, copy and paste are the operating system's own; the editor
    // handles the first two itself, but the webview needs the roles for the
    // text fields inside it.
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let menu = Menu::with_items(app, &[&file, &edit])?;
    window.set_menu(menu)?;

    /*
     * Forwarded rather than handled.
     *
     * The shell has no idea what "Save" means — that lives in `core/io.js`
     * behind the same call the toolbar button makes. Emitting keeps the menu
     * and the keyboard one implementation, which is the only way they stay in
     * step.
     */
    let target = window.clone();
    app.on_menu_event(move |_app, event| {
        let _ = target.emit("massing:menu", event.id().0.clone());
    });
    Ok(())
}

/// Make the window frame match the editor inside it.
///
/// Reported by the page rather than read from the system, because the two
/// disagree on purpose: the theme button cycles system, light and dark, and
/// someone who forced the editor dark on a light desktop wants a dark frame.
pub fn set_theme(app: &AppHandle, dark: bool) {
    if let Some(window) = app.webview_windows().values().next() {
        let _ = window.set_theme(Some(if dark { Theme::Dark } else { Theme::Light }));
    }
}

/// Where the MCP port is written down.
///
/// The setup instructions name 7337, and usually that is what it is — but a
/// second copy of the app, or anything else holding the port, makes it
/// something else. "Which URL do I give Claude Code" should always have an
/// answer true of the copy actually running.
pub fn record_port(url: &str) {
    let Some(dir) = dirs::data_local_dir().map(|d| d.join("massing")) else {
        return;
    };
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let body = serde_json::json!({ "url": url, "pid": std::process::id() });
    let _ = std::fs::write(dir.join("mcp.json"), format!("{body:#}\n"));
}
