//! WorkflowBlueprint → oxidizedgraph compiler types (locked architecture).
//!
//! Phase 1 binds these nodes to `oxidizedgraph::NodeExecutor` implementations.
//! Do not introduce a parallel petgraph runtime here.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use uuid::Uuid;

/// Declarative JSON emitted by the XYFlow frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowBlueprint {
    pub workflow_id: Uuid,
    pub nodes: Vec<BlueprintNode>,
    pub edges: Vec<BlueprintEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlueprintNode {
    pub id: String,
    pub runtime: RuntimeTarget,
    /// e.g. `core.http_request`, `bun.slack.postMessage`, `bun.code`
    pub node_type: String,
    pub parameters: Value,
    pub credential_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    /// Evaluated for cyclic loops / conditional routing
    pub condition_expr: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowEnvelope {
    pub execution_id: Uuid,
    /// node_id → JSON output
    pub outputs: HashMap<String, Value>,
    pub active_branch: Option<String>,
}

/// Unified executor wrapper for Rust native, Bun UDS, and MCP nodes.
#[async_trait]
pub trait WorkflowNodeExecutor: Send + Sync {
    async fn execute(&self, state: &mut WorkflowEnvelope) -> anyhow::Result<Option<String>>;
}

/// Validate blueprint shape before compile (Phase 1 fleshes out oxidizedgraph binding).
pub fn validate_blueprint(bp: &WorkflowBlueprint) -> anyhow::Result<()> {
    if bp.nodes.is_empty() {
        anyhow::bail!("blueprint has no nodes");
    }
    let ids: std::collections::HashSet<_> = bp.nodes.iter().map(|n| n.id.as_str()).collect();
    for e in &bp.edges {
        if !ids.contains(e.source.as_str()) || !ids.contains(e.target.as_str()) {
            anyhow::bail!("edge references unknown node {} → {}", e.source, e.target);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_blueprint() {
        let bp = WorkflowBlueprint {
            workflow_id: Uuid::nil(),
            nodes: vec![],
            edges: vec![],
        };
        assert!(validate_blueprint(&bp).is_err());
    }
}
