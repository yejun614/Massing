//! The point of the desktop app: an MCP server on the diagram you are looking at.
//!
//! The editor has an assistant and it works, but it answers to a Gemini key you
//! pay for on top of the Claude Code, Codex or Antigravity subscription you
//! already have. This is the same four tools offered to the CLI you are already
//! paying for, driving the same document.
//!
//! **The tools act on the open window, not on a file.** So they work on a
//! diagram that has never been saved, they land in the same undo stack as a
//! change made by hand, and the result is on screen before the tool returns.
//! Each one is a round trip through `Bridge::ask` into the page, where the
//! implementations sit beside the editor's own loader — the same
//! `normalizeDoc` and `validateDocument` the panel uses, so a document written
//! by Claude Code meets the same rules and the same complaints.

use std::sync::Arc;

use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{CallToolResult, ContentBlock, Implementation, ServerCapabilities, ServerInfo};
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
};
use rmcp::{tool, tool_handler, tool_router, ErrorData as McpError, ServerHandler};
use serde_json::json;

use crate::bridge::Bridge;

/// The port a CLI is told to use. Not sacred, but it has to be guessable.
pub const DEFAULT_PORT: u16 = 7337;

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ReplaceArgs {
    /// A complete .arch.json document as JSON text.
    pub document: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct AddTabArgs {
    /// What the tab is called, after what it shows.
    pub name: String,
    /// The new drawing as a complete .arch.json document.
    pub document: String,
}

#[derive(Clone)]
pub struct Massing {
    bridge: Arc<Bridge>,
    /// Built by `#[tool_router]` and read by `#[tool_handler]`, both of which
    /// expand after the lint runs — so it looks unread and is not.
    #[allow(dead_code)]
    tool_router: ToolRouter<Massing>,
}

#[tool_router]
impl Massing {
    pub fn new(bridge: Arc<Bridge>) -> Self {
        Self {
            bridge,
            tool_router: Self::tool_router(),
        }
    }

    /// Every tool is the same shape: ask the window, hand back what it said.
    ///
    /// A refusal comes back as content rather than as an error, because a model
    /// that hears "the window is not open" can say so, where a transport
    /// failure is something it can only retry.
    async fn ask(&self, name: &str, args: serde_json::Value) -> Result<CallToolResult, McpError> {
        let said = match self.bridge.ask(name, args).await {
            Ok(answer) => answer,
            Err(why) => format!("Refused: {why}"),
        };
        Ok(CallToolResult::success(vec![ContentBlock::text(said)]))
    }

    #[tool(
        description = "Read the diagram open in the Massing editor, as a .arch.json document. \
        Call this before any edit so you are changing what is actually on screen, and so you \
        keep the ids that already exist."
    )]
    async fn get_diagram(&self) -> Result<CallToolResult, McpError> {
        self.ask("get_diagram", json!({})).await
    }

    #[tool(
        description = "Replace what is open in the editor with a complete .arch.json document. \
        Send the whole document, never a fragment: anything left out is deleted. The result \
        reports whatever the loader had to repair, so read it and fix what it names rather than \
        assuming the edit landed as written. The change is undoable in the editor."
    )]
    async fn replace_diagram(
        &self,
        Parameters(ReplaceArgs { document }): Parameters<ReplaceArgs>,
    ) -> Result<CallToolResult, McpError> {
        self.ask("replace_diagram", json!({ "document": document }))
            .await
    }

    #[tool(
        description = "Add a new drawing to the open file as a tab, beside the one already open, \
        and switch to it. Use it when one picture genuinely will not hold the answer — a system \
        past about 25 blocks, or a second view the person asked for alongside the first. Never \
        use it to tidy one diagram into several, and never to avoid editing what is open. You \
        cannot create files: the file belongs to the person."
    )]
    async fn add_tab(
        &self,
        Parameters(AddTabArgs { name, document }): Parameters<AddTabArgs>,
    ) -> Result<CallToolResult, McpError> {
        self.ask("add_tab", json!({ "name": name, "document": document }))
            .await
    }

    #[tool(
        description = "Check the diagram on screen for the faults that make one unreadable: a \
        block hidden behind a taller one, a connection that vanishes under a block, blocks \
        overlapping, a block outside the zone it claims, captions written as sentences, too many \
        connections for the number of blocks. Call it after every edit — none of this is visible \
        in the JSON. ERROR means the picture is visibly broken. Act on the report rather than \
        summarising it back."
    )]
    async fn validate_diagram(&self) -> Result<CallToolResult, McpError> {
        self.ask("validate_diagram", json!({})).await
    }
}

#[tool_handler]
impl ServerHandler for Massing {
    fn get_info(&self) -> ServerInfo {
        // `from_build_env` reads the *SDK's* crate name, so a client asking
        // who it is talking to hears "rmcp". Corrected by hand; the struct is
        // non-exhaustive, so the fields are set rather than constructed.
        let mut who = Implementation::from_build_env();
        who.name = "massing".into();
        who.version = env!("CARGO_PKG_VERSION").into();
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build()).with_server_info(who)
    }
}

/// Build the tower service the HTTP server mounts.
pub fn service(bridge: Arc<Bridge>) -> StreamableHttpService<Massing, LocalSessionManager> {
    StreamableHttpService::new(
        move || Ok(Massing::new(Arc::clone(&bridge))),
        LocalSessionManager::default().into(),
        StreamableHttpServerConfig::default(),
    )
}
