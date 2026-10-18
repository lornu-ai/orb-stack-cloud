//! Native Rust primitives. Each node stores its output in `AgentState::context` under [`output_key`].

pub mod http;
pub mod switch;

use oxidizedgraph::error::NodeError;
use oxidizedgraph::state::SharedState;
use serde_json::Value;

/// Context key holding a node's output.
pub fn output_key(node_id: &str) -> String {
    format!("node:{node_id}")
}

/// The state lock is a `std::sync::RwLock`: take it only between awaits, never across one.
pub(crate) fn write_output(
    state: &SharedState,
    node_id: &str,
    value: Value,
) -> Result<(), NodeError> {
    let mut guard = state
        .write()
        .map_err(|e| NodeError::ExecutionFailed(e.to_string()))?;
    guard.context.insert(output_key(node_id), value);
    Ok(())
}

pub(crate) fn read_output(state: &SharedState, node_id: &str) -> Result<Option<Value>, NodeError> {
    let guard = state
        .read()
        .map_err(|e| NodeError::ExecutionFailed(e.to_string()))?;
    Ok(guard.context.get(&output_key(node_id)).cloned())
}
