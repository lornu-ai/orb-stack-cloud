use async_trait::async_trait;
use ipaas_compiler::nodes::{http::HttpPolicy, output_key};
use ipaas_compiler::{
    compile, CompileError, CompiledNode, NodeRegistry, RuntimeTarget, WorkflowBlueprint,
};
use oxidizedgraph::error::{NodeError, RuntimeError};
use oxidizedgraph::graph::{NodeExecutor, NodeOutput};
use oxidizedgraph::runner::{GraphRunner, RunnerConfig};
use oxidizedgraph::state::{AgentState, SharedState};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// Marks that the run reached it.
struct Mark(String);

#[async_trait]
impl NodeExecutor for Mark {
    fn id(&self) -> &str {
        &self.0
    }

    async fn execute(&self, state: SharedState) -> Result<NodeOutput, NodeError> {
        let mut guard = state
            .write()
            .map_err(|e| NodeError::ExecutionFailed(e.to_string()))?;
        guard
            .context
            .insert(output_key(&self.0), json!({ "reached": true }));
        Ok(NodeOutput::cont())
    }
}

fn registry(policy: HttpPolicy) -> NodeRegistry {
    let mut registry = NodeRegistry::with_core_nodes(policy);
    registry.register(
        "test.mark",
        RuntimeTarget::RustNative,
        Arc::new(|node| {
            Ok(CompiledNode {
                executor: Arc::new(Mark(node.id.clone())),
                output_handles: None,
                reads: vec![],
            })
        }),
    );
    registry
}

fn local() -> HttpPolicy {
    HttpPolicy {
        allow_private_networks: true,
        ..HttpPolicy::default()
    }
}

fn blueprint(value: Value) -> WorkflowBlueprint {
    let mut value = value;
    value["workflow_id"] = json!("00000000-0000-0000-0000-000000000001");
    serde_json::from_value(value).unwrap()
}

/// Health check, then branch on the status: the shape of most webhook-to-alert workflows.
fn health_check(url: &str) -> WorkflowBlueprint {
    blueprint(json!({
        "nodes": [
            { "id": "check", "runtime": "rust_native", "node_type": "core.http_request", "parameters": { "url": url } },
            { "id": "route", "runtime": "rust_native", "node_type": "core.switch", "parameters": {
                "rules": [{ "handle": "up", "node": "check", "pointer": "/status", "op": "eq", "value": 200 }],
                "fallback": "down"
            }},
            { "id": "healthy", "runtime": "rust_native", "node_type": "test.mark" },
            { "id": "alert", "runtime": "rust_native", "node_type": "test.mark" }
        ],
        "edges": [
            { "source": "check", "target": "route" },
            { "source": "route", "source_handle": "up", "target": "healthy" },
            { "source": "route", "source_handle": "down", "target": "alert" }
        ]
    }))
}

/// Answers `/up` with 200, `/down` with 503, and `/big` with 64 KiB.
async fn serve() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            tokio::spawn(async move {
                let mut buf = vec![0u8; 4096];
                let n = socket.read(&mut buf).await.unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]);
                let (status, body) = if request.starts_with("GET /up ") {
                    ("200 OK", r#"{"ok":true}"#.to_string())
                } else if request.starts_with("GET /big ") {
                    ("200 OK", "x".repeat(64 * 1024))
                } else {
                    ("503 Service Unavailable", r#"{"ok":false}"#.to_string())
                };
                let response = format!(
                    "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = socket.write_all(response.as_bytes()).await;
            });
        }
    });
    format!("http://{addr}")
}

async fn run(bp: &WorkflowBlueprint, policy: HttpPolicy) -> Result<AgentState, RuntimeError> {
    let graph = compile(bp, &registry(policy)).unwrap();
    GraphRunner::new(graph, RunnerConfig::default().max_iterations(20))
        .invoke(AgentState::new())
        .await
}

#[tokio::test]
async fn routes_on_the_http_status() {
    let base = serve().await;

    let state = run(&health_check(&format!("{base}/up")), local())
        .await
        .unwrap();
    assert_eq!(state.context[&output_key("check")]["status"], 200);
    assert_eq!(
        state.context[&output_key("check")]["body"],
        json!({ "ok": true })
    );
    assert_eq!(
        state.context[&output_key("route")],
        json!({ "handle": "up" })
    );
    assert!(state.context.contains_key(&output_key("healthy")));
    assert!(!state.context.contains_key(&output_key("alert")));

    let state = run(&health_check(&format!("{base}/down")), local())
        .await
        .unwrap();
    assert_eq!(state.context[&output_key("check")]["status"], 503);
    assert!(state.context.contains_key(&output_key("alert")));
    assert!(!state.context.contains_key(&output_key("healthy")));
}

#[tokio::test]
async fn private_addresses_are_refused_by_default() {
    let base = serve().await;
    for url in [
        format!("{base}/up"),
        "http://169.254.169.254/computeMetadata/v1/".to_string(),
        "http://localhost/".into(),
    ] {
        let err = run(&health_check(&url), HttpPolicy::default())
            .await
            .unwrap_err();
        assert!(err.to_string().contains("non-public"), "{url}: {err}");
    }
}

#[tokio::test]
async fn responses_over_the_limit_fail() {
    let base = serve().await;
    let policy = HttpPolicy {
        max_response_bytes: 1024,
        ..local()
    };
    let err = run(&health_check(&format!("{base}/big")), policy)
        .await
        .unwrap_err();
    assert!(err.to_string().contains("over the limit"), "{err}");
}

#[tokio::test]
async fn timeouts_fail_the_node() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let (_socket, _) = listener.accept().await.unwrap();
        tokio::time::sleep(Duration::from_secs(30)).await;
    });
    let mut bp = health_check(&format!("http://{addr}/up"));
    bp.nodes[0].parameters["timeout_ms"] = json!(200);
    assert!(run(&bp, local()).await.is_err());
}

#[tokio::test]
async fn a_switch_with_no_match_and_no_fallback_fails() {
    let base = serve().await;
    let mut bp = health_check(&format!("{base}/down"));
    bp.nodes[1].parameters = json!({ "rules": [{ "handle": "up", "node": "check", "pointer": "/status", "op": "eq", "value": 200 }] });
    bp.edges
        .retain(|e| e.source_handle.as_deref() != Some("down"));
    bp.nodes.retain(|n| n.id != "alert");
    let err = run(&bp, local()).await.unwrap_err();
    assert!(err.to_string().contains("no rule matched"), "{err}");
}

#[tokio::test]
async fn cycles_run_until_the_switch_exits() {
    // Poll /down, retry through the switch, and stop at the runner's iteration limit.
    let base = serve().await;
    let mut bp = health_check(&format!("{base}/down"));
    bp.entry = Some("check".into());
    bp.edges
        .retain(|e| e.source_handle.as_deref() != Some("down"));
    bp.edges.push(
        serde_json::from_value(
            json!({ "source": "route", "source_handle": "down", "target": "check" }),
        )
        .unwrap(),
    );
    let err = run(&bp, local()).await.unwrap_err();
    assert!(matches!(err, RuntimeError::RecursionLimit(20)), "{err}");
}

fn compile_err(bp: &WorkflowBlueprint) -> CompileError {
    compile(bp, &registry(HttpPolicy::default()))
        .err()
        .expect("compile should fail")
}

#[test]
fn rejects_blueprints_that_cannot_run() {
    let url = "https://example.com/health";

    assert!(matches!(
        compile_err(&blueprint(json!({ "nodes": [], "edges": [] }))),
        CompileError::Empty
    ));

    let mut bp = health_check(url);
    bp.nodes.push(bp.nodes[3].clone());
    assert!(matches!(compile_err(&bp), CompileError::DuplicateNode(id) if id == "alert"));

    let mut bp = health_check(url);
    bp.nodes[2].node_type = "core.nope".into();
    assert!(matches!(
        compile_err(&bp),
        CompileError::UnknownNodeType { .. }
    ));

    let mut bp = health_check(url);
    bp.nodes[0].runtime = RuntimeTarget::BunUdsPool;
    assert!(matches!(
        compile_err(&bp),
        CompileError::RuntimeMismatch { .. }
    ));

    let mut bp = health_check(url);
    bp.nodes[0].parameters = json!({ "url": "ftp://example.com" });
    assert!(
        matches!(compile_err(&bp), CompileError::InvalidParameters { node, .. } if node == "check")
    );

    let mut bp = health_check(url);
    bp.nodes[1].parameters["rules"][0]["node"] = json!("missing");
    assert!(matches!(
        compile_err(&bp),
        CompileError::UnknownReference { .. }
    ));

    let mut bp = health_check(url);
    bp.edges[1].source_handle = Some("sideways".into());
    assert!(
        matches!(compile_err(&bp), CompileError::UnknownHandle { handle, .. } if handle == "sideways")
    );

    let mut bp = health_check(url);
    bp.edges[1].source_handle = None;
    assert!(matches!(
        compile_err(&bp),
        CompileError::MissingHandle { .. }
    ));

    let mut bp = health_check(url);
    bp.edges[0].source_handle = Some("up".into());
    assert!(matches!(
        compile_err(&bp),
        CompileError::UnexpectedHandle { .. }
    ));

    let mut bp = health_check(url);
    bp.edges
        .push(serde_json::from_value(json!({ "source": "check", "target": "alert" })).unwrap());
    assert!(matches!(
        compile_err(&bp),
        CompileError::FanOutUnsupported { .. }
    ));

    let mut bp = health_check(url);
    bp.edges[0].condition_expr = Some("$.status == 200".into());
    assert!(matches!(
        compile_err(&bp),
        CompileError::ConditionExprUnsupported { .. }
    ));

    let mut bp = health_check(url);
    bp.nodes.push(bp.nodes[3].clone());
    bp.nodes[4].id = "orphan".into();
    assert!(
        matches!(compile_err(&bp), CompileError::AmbiguousEntry(roots) if roots == ["check", "orphan"])
    );

    let mut bp = health_check(url);
    bp.entry = Some("nowhere".into());
    assert!(matches!(compile_err(&bp), CompileError::UnknownEntry(_)));
}

#[test]
fn compiles_to_the_oxidizedgraph_shape() {
    let graph = compile(
        &health_check("https://example.com/health"),
        &registry(HttpPolicy::default()),
    )
    .unwrap();
    assert_eq!(graph.entry_point(), "check");
    let state = AgentState::new();
    assert_eq!(
        graph.get_next_node("check", &state).as_deref(),
        Some("route")
    );
    assert_eq!(
        graph
            .get_next_node_for_transition("route", &state, "up")
            .as_deref(),
        Some("healthy")
    );
    assert_eq!(
        graph
            .get_next_node_for_transition("route", &state, "down")
            .as_deref(),
        Some("alert")
    );
    assert_eq!(
        graph.get_next_node("alert", &state).as_deref(),
        Some("__end__")
    );
}
