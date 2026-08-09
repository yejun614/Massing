//! Registering this app with the CLIs, so nobody has to read the docs.
//!
//! Three coding agents, three unrelated config formats, one of which is TOML
//! and one of which uses a key name nobody would guess.
//!
//! **Nothing here overwrites a file.** Each target is read, the one entry this
//! app owns is added or replaced, and everything else is written back as it
//! was — with a `.massing-backup` copy left beside it first. These are files
//! people keep their own work in; a setup button that flattened somebody's
//! Codex config would be a far worse bug than the instructions it replaced.

use std::path::PathBuf;

use serde::Serialize;
use serde_json::{json, Value};

/// The name this app registers itself under, everywhere.
const SERVER_NAME: &str = "massing";

#[derive(Serialize, Clone)]
pub struct Target {
    pub id: String,
    pub label: String,
    pub path: String,
    /// Present means the CLI has been run at least once.
    pub found: bool,
    /// Already pointing at a Massing server, whatever the port.
    pub registered: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub problem: Option<String>,
}

fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_default()
}

fn claude_path() -> PathBuf {
    home().join(".claude.json")
}
fn codex_path() -> PathBuf {
    home().join(".codex").join("config.toml")
}
fn antigravity_path() -> PathBuf {
    home().join(".gemini").join("config").join("mcp_config.json")
}

fn read(path: &PathBuf) -> Option<String> {
    std::fs::read_to_string(path).ok()
}

/// Write, having first put the old copy somewhere safe.
///
/// One backup, overwritten each time rather than accumulating: the point is to
/// be able to undo *this* button, and a directory filling with dated copies of
/// a config file is its own kind of mess.
fn write_safely(path: &PathBuf, text: &str) -> std::io::Result<()> {
    if let Some(previous) = read(path) {
        let mut backup = path.clone().into_os_string();
        backup.push(".massing-backup");
        std::fs::write(PathBuf::from(backup), previous)?;
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, text)
}

/// Claude Code's config is also its scratch state — projects, history, flags.
/// It is read, one key is set, and it goes back out whole.
fn claude_entry(url: &str) -> anyhow::Result<String> {
    let mut config: Value = read(&claude_path())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| json!({}));
    config["mcpServers"][SERVER_NAME] = json!({ "type": "http", "url": url });
    Ok(format!("{}\n", serde_json::to_string_pretty(&config)?))
}

/// TOML, edited with a format-preserving parser.
///
/// The previous shell did this as text manipulation, to avoid a library
/// reformatting a file somebody wrote by hand. `toml_edit` is the library that
/// does not: it keeps comments, ordering and spacing, and changes only the one
/// table this app owns. Same guarantee, without the string surgery.
fn codex_entry(url: &str) -> anyhow::Result<String> {
    let mut document = read(&codex_path())
        .unwrap_or_default()
        .parse::<toml_edit::DocumentMut>()
        .unwrap_or_default();
    document["mcp_servers"][SERVER_NAME]["url"] = toml_edit::value(url);
    // Without this the new table is written inline on one line, which is legal
    // TOML and not what anybody else's entries look like.
    if let Some(table) = document["mcp_servers"].as_table_mut() {
        table.set_implicit(true);
    }
    Ok(document.to_string())
}

/// `serverUrl`, not `url`: the other spellings are documented as not read.
fn antigravity_entry(url: &str) -> anyhow::Result<String> {
    let mut config: Value = read(&antigravity_path())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| json!({}));
    config["mcpServers"][SERVER_NAME] = json!({ "serverUrl": url });
    Ok(format!("{}\n", serde_json::to_string_pretty(&config)?))
}

struct Known {
    id: &'static str,
    label: &'static str,
    path: fn() -> PathBuf,
    build: fn(&str) -> anyhow::Result<String>,
}

const KNOWN: [Known; 3] = [
    Known { id: "claude", label: "Claude Code", path: claude_path, build: claude_entry },
    Known { id: "codex", label: "Codex", path: codex_path, build: codex_entry },
    Known { id: "antigravity", label: "Antigravity", path: antigravity_path, build: antigravity_entry },
];

/// What is on this machine, and what state it is in. Reads only.
pub fn survey() -> Vec<Target> {
    KNOWN
        .iter()
        .map(|known| {
            let path = (known.path)();
            let text = read(&path);
            Target {
                id: known.id.into(),
                label: known.label.into(),
                // A config file is the only evidence available that a CLI is
                // installed: the binary may be anywhere, and a GUI process does
                // not reliably inherit the shell's PATH to go looking.
                found: text.is_some() || path.parent().map(|p| p.exists()).unwrap_or(false),
                registered: text.as_deref().map(mentions_us).unwrap_or(false),
                problem: None,
                path: path.to_string_lossy().into_owned(),
            }
        })
        .collect()
}

fn mentions_us(text: &str) -> bool {
    // Good enough and deliberately loose: any spelling of our name as a key,
    // in JSON or TOML, at any port.
    text.contains(&format!("\"{SERVER_NAME}\"")) || text.contains(&format!(".{SERVER_NAME}]"))
}

/// Register with the chosen targets.
///
/// Each one is independent: a malformed Codex file must not stop Claude Code
/// being set up, so a failure is recorded against that target and the rest
/// carry on.
pub fn register(ids: &[String], url: &str) -> Vec<Target> {
    KNOWN
        .iter()
        .filter(|known| ids.iter().any(|id| id == known.id))
        .map(|known| {
            let path = (known.path)();
            let outcome = (known.build)(url).and_then(|text| Ok(write_safely(&path, &text)?));
            Target {
                id: known.id.into(),
                label: known.label.into(),
                path: path.to_string_lossy().into_owned(),
                found: true,
                registered: outcome.is_ok(),
                problem: outcome.err().map(|e| e.to_string()),
            }
        })
        .collect()
}
