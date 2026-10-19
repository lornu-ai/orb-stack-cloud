//! axum Host Control Plane stub (Phase 1).
//!
//! Owns XYFlow persistence, webhooks, OAuth refresh, AES-256-GCM vault,
//! SKIP LOCKED Postgres queue, and WS telemetry — oxidizedgraph stays pure execution.

use anyhow::Result;
use ipaas_compiler::{validate_blueprint, WorkflowBlueprint};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_stub("ipaas-control-plane scaffold — wire axum in Phase 1");
    // Placeholder: load a minimal blueprint and validate shape.
    let sample = r#"{
      "workflow_id": "00000000-0000-0000-0000-000000000001",
      "nodes": [{"id":"a","runtime":"rust_native","node_type":"core.http_request","parameters":{}}],
      "edges": []
    }"#;
    let bp: WorkflowBlueprint = serde_json::from_str(sample)?;
    validate_blueprint(&bp)?;
    println!("ok: blueprint {} ({} nodes)", bp.workflow_id, bp.nodes.len());
    println!("next: axum routes + oxidizedgraph compile + Bun UDS export_schemas");
    Ok(())
}

fn tracing_stub(msg: &str) {
    eprintln!("[ipaas-control-plane] {msg}");
}
