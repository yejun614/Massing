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

/// The home directory, overridable so the tests can point at a temporary one.
///
/// Reading a variable rather than threading a parameter through every path
/// function: the override exists for the tests and for nothing else, and a
/// parameter would put it in the signature of code that never wants it.
fn home() -> PathBuf {
    std::env::var_os("MASSING_HOME")
        .map(PathBuf::from)
        .or_else(dirs::home_dir)
        .unwrap_or_default()
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

    let servers = document["mcp_servers"].or_insert(toml_edit::Item::Table(Default::default()));
    if let Some(table) = servers.as_table_mut() {
        // Implicit: `[mcp_servers]` is never written as a header of its own,
        // only as the prefix of the entries under it -- which is how every
        // example, and everybody's existing file, is laid out.
        table.set_implicit(true);
    }

    /*
     * Written as a table rather than by assigning to a path.
     *
     * `document["mcp_servers"][name]["url"] = value` produces
     * `massing = { url = "..." }`, which is correct TOML and looks nothing like
     * the `[mcp_servers.other]` sitting above it. A config file somebody opens
     * afterwards should not show which entry a program wrote.
     */
    let mut entry = toml_edit::Table::new();
    entry["url"] = toml_edit::value(url);
    servers[SERVER_NAME] = toml_edit::Item::Table(entry);

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

#[cfg(test)]
mod tests {
    use super::*;

    /// A temporary home, and the settings somebody would already have in it.
    ///
    /// `MASSING_HOME` is process-wide, so these run one at a time —
    /// `--test-threads=1`, which the npm script passes. Two tests setting it at
    /// once would each see the other's directory.
    ///
    /// The whole point of these is the *keeping*: this code edits files people
    /// have their own work in, and the failure worth testing for is not "did we
    /// write our entry" but "did everything else survive".
    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("massing-setup-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".codex")).unwrap();
        std::env::set_var("MASSING_HOME", &dir);
        std::fs::write(
            dir.join(".codex").join("config.toml"),
            "# my notes\nmodel = \"gpt-5\"\n\n[mcp_servers.other]\nurl = \"http://example.com/mcp\"\n",
        )
        .unwrap();
        std::fs::write(
            dir.join(".claude.json"),
            r#"{"numStartups":42,"mcpServers":{"other":{"type":"http","url":"http://x/"}}}"#,
        )
        .unwrap();
        dir
    }

    #[test]
    fn keeps_what_was_already_there() {
        let dir = scratch("keeps");
        let url = "http://127.0.0.1:7337/mcp";
        let done = register(
            &["claude".into(), "codex".into(), "antigravity".into()],
            url,
        );
        assert!(done.iter().all(|t| t.registered), "{:?}", done.iter().map(|t| &t.problem).collect::<Vec<_>>());

        let codex = std::fs::read_to_string(dir.join(".codex").join("config.toml")).unwrap();
        assert!(codex.contains("# my notes"), "comment lost:\n{codex}");
        assert!(codex.contains("model = \"gpt-5\""), "setting lost:\n{codex}");
        assert!(codex.contains("[mcp_servers.other]"), "other server lost:\n{codex}");
        assert!(codex.contains("[mcp_servers.massing]"), "ours missing:\n{codex}");
        assert!(codex.contains(url), "url missing:\n{codex}");

        let claude: Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join(".claude.json")).unwrap()).unwrap();
        assert_eq!(claude["numStartups"], 42, "unrelated state lost");
        assert!(claude["mcpServers"]["other"].is_object(), "other server lost");
        assert_eq!(claude["mcpServers"]["massing"]["type"], "http");
        assert_eq!(claude["mcpServers"]["massing"]["url"], url);

        let anti: Value = serde_json::from_str(
            &std::fs::read_to_string(dir.join(".gemini").join("config").join("mcp_config.json")).unwrap(),
        )
        .unwrap();
        // Antigravity reads `serverUrl` and documents `url` as ignored.
        assert_eq!(anti["mcpServers"]["massing"]["serverUrl"], url);
        assert!(anti["mcpServers"]["massing"]["url"].is_null());

        let backup =
            std::fs::read_to_string(dir.join(".codex").join("config.toml.massing-backup")).unwrap();
        assert!(backup.contains("# my notes"), "no backup of the original");
    }

    #[test]
    fn a_second_run_replaces_rather_than_duplicates() {
        // The normal case: the port changes between runs and the button is
        // pressed again.
        let dir = scratch("again");
        register(&["codex".into(), "claude".into()], "http://127.0.0.1:7337/mcp");
        register(&["codex".into(), "claude".into()], "http://127.0.0.1:9999/mcp");

        let codex = std::fs::read_to_string(dir.join(".codex").join("config.toml")).unwrap();
        assert_eq!(codex.matches("[mcp_servers.massing]").count(), 1, "duplicated:\n{codex}");
        assert!(codex.contains("9999"), "not updated:\n{codex}");
        assert!(codex.contains("[mcp_servers.other]"), "other server lost:\n{codex}");

        let claude: Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join(".claude.json")).unwrap()).unwrap();
        assert!(claude["mcpServers"]["massing"]["url"].as_str().unwrap().contains("9999"));

        assert_eq!(survey().iter().filter(|t| t.registered).count(), 2);
    }
}
