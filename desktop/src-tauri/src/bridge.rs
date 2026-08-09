//! How the page and the shell talk.
//!
//! Tauri has a perfectly good IPC — `invoke` and `emit` — and this does not use
//! it, on purpose. The editor is served over loopback HTTP so that the
//! file-picker shim can be injected as a module script *ahead of* the app's
//! own; that ordering is the whole mechanism by which `src/core/io.js` needs no
//! desktop code path at all. Once there is a served document there is also a
//! server, and one channel is better than two.
//!
//! It also means `desktop/web/` came across from the previous shell unchanged,
//! and that every interaction can still be driven with `curl` against a running
//! app — which is how the tests check it.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{broadcast, oneshot};

/// How long a tool waits on the window.
///
/// Long enough for a large document to be parsed, laid out and rendered; short
/// enough that a CLI blocked on a window that has stopped answering finds out
/// inside one turn rather than one coffee.
const CALL_TIMEOUT: Duration = Duration::from_secs(15);

/// Everything the shell knows that the page or a tool might ask for.
pub struct Bridge {
    /// Fan-out to every open `EventSource`. A reload opens a second before the
    /// first is torn down, so this is deliberately a broadcast rather than one
    /// slot.
    pub events: broadcast::Sender<String>,
    /// Calls the shell has made into the page and is waiting on.
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<String, String>>>>,
    next_id: Mutex<u64>,
    /// The file being followed, and the watcher following it.
    pub watching: Mutex<Option<crate::files::Watch>>,
    /// Where a CLI should point to reach the MCP server.
    pub mcp_url: Mutex<Option<String>>,
}

#[derive(Deserialize)]
pub struct CallResult {
    pub id: u64,
    pub ok: bool,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub error: String,
}

#[derive(Serialize)]
struct Call<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
    id: u64,
    name: &'a str,
    args: Value,
}

impl Bridge {
    pub fn new() -> Arc<Self> {
        let (events, _) = broadcast::channel(64);
        Arc::new(Self {
            events,
            pending: Mutex::new(HashMap::new()),
            next_id: Mutex::new(0),
            watching: Mutex::new(None),
            mcp_url: Mutex::new(None),
        })
    }

    /// True when at least one window is listening.
    pub fn connected(&self) -> bool {
        self.events.receiver_count() > 0
    }

    pub fn push(&self, event: Value) {
        // An error here only means nobody is listening, which is normal while
        // the window is starting and not worth reporting.
        let _ = self.events.send(event.to_string());
    }

    /// Ask the window to do something, and wait for the answer.
    ///
    /// Refusing when no window is listening is the important case rather than
    /// an edge one: it is what a CLI sees when the app is closed, and "the
    /// window is not listening" is an answer a model can act on where a request
    /// that hangs for ever is not.
    pub async fn ask(&self, name: &str, args: Value) -> Result<String, String> {
        if !self.connected() {
            return Err("The Massing window is not listening. Is the app open?".into());
        }
        let id = {
            let mut next = self.next_id.lock().unwrap();
            *next += 1;
            *next
        };
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);

        self.push(serde_json::to_value(Call { kind: "call", id, name, args }).unwrap());

        match tokio::time::timeout(CALL_TIMEOUT, rx).await {
            Ok(Ok(answer)) => answer,
            Ok(Err(_)) => Err("the window dropped the call".into()),
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                Err(format!("The window did not answer {name} in time."))
            }
        }
    }

    /// The other half of `ask`: the page handing back what it got.
    pub fn settle(&self, result: CallResult) -> bool {
        let Some(tx) = self.pending.lock().unwrap().remove(&result.id) else {
            return false;
        };
        let answer = if result.ok {
            Ok(result.value)
        } else {
            Err(if result.error.is_empty() {
                "the window did not say what went wrong".into()
            } else {
                result.error
            })
        };
        tx.send(answer).is_ok()
    }

    /// Follow one file, and only one.
    ///
    /// The app has a single open document, so a second call replaces the first
    /// rather than adding to it — otherwise opening ten files in a session
    /// leaves ten watchers running and every one of them reporting.
    pub fn watch(self: &Arc<Self>, path: Option<String>) {
        let mut slot = self.watching.lock().unwrap();
        if slot.as_ref().map(|w| w.path.as_str()) == path.as_deref() {
            return;
        }
        *slot = match path {
            None => None,
            Some(path) => {
                let me = Arc::clone(self);
                let announce = path.clone();
                crate::files::watch(path, move || {
                    me.push(json!({ "type": "file-changed", "path": announce }))
                })
                .ok()
            }
        };
    }

    /// Called around our own writes, so a save does not read as somebody else's
    /// edit and bounce back through reload.
    pub fn ours(&self) {
        if let Some(watch) = self.watching.lock().unwrap().as_ref() {
            watch.ours();
        }
    }
}
