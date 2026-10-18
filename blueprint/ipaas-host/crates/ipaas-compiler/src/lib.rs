//! WorkflowBlueprint → oxidizedgraph compiler.
//!
//! The XYFlow canvas saves a [`WorkflowBlueprint`]. [`compile`] binds each node to an
//! `oxidizedgraph` `NodeExecutor` from a [`NodeRegistry`] and returns a `CompiledGraph`
//! that oxidizedgraph's `GraphRunner` executes. Do not introduce a parallel petgraph runtime here.

pub mod compile;
pub mod nodes;

pub use compile::{
    compile, validate_blueprint, CompileError, CompiledNode, NodeFactory, NodeRegistry,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

/// Declarative JSON emitted by the XYFlow frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowBlueprint {
    pub workflow_id: Uuid,
    /// Node the run starts at. When absent, the one node with no incoming edge.
    #[serde(default)]
    pub entry: Option<String>,
    pub nodes: Vec<BlueprintNode>,
    pub edges: Vec<BlueprintEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlueprintNode {
    pub id: String,
    pub runtime: RuntimeTarget,
    /// e.g. `core.http_request`, `core.switch`, `bun.slack.postMessage`
    pub node_type: String,
    #[serde(default)]
    pub parameters: Value,
    #[serde(default)]
    pub credential_id: Option<Uuid>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeTarget {
    RustNative,
    BunUdsPool,
    McpServer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlueprintEdge {
    pub source: String,
    pub target: String,
    /// XYFlow `sourceHandle`: which output of a multi-output node (such as a Switch) this edge leaves from.
    #[serde(default)]
    pub source_handle: Option<String>,
    /// Not supported: oxidizedgraph routes with Rust closures, not expression strings.
    /// Branch with a `core.switch` node and `source_handle` instead.
    #[serde(default)]
    pub condition_expr: Option<String>,
}
