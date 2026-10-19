//! OrbStack / kubectl MCP skill for OSC Gap overlays (`orbstack::*`).
//!
//! Exposes MCP JSON-RPC 2.0 over HTTP `POST /mcp` (default `127.0.0.1:9320`)
//! and single-shot stdio (`--stdio`) for local Podman fallback.
//!
//! Security posture (non-negotiable):
//! 1. Default read-only. `apply_overlay` defaults to server-side dry-run and requires
//!    `confirm: true` when `dry_run: false`.
//! 2. Strict allowlist of commands and overlays (`mac-a`, `gap` namespace) — no free-form shell,
//!    no `orb create`, no machine deletion, no cloud-init secret rendering.
//! 3. Never returns secret material in tool outputs.

use axum::{extract::State, routing::post, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::process::Command;

pub const JSONRPC_VERSION: &str = "2.0";
pub const DEFAULT_BIND: ([u8; 4], u16) = ([127, 0, 0, 1], 9320);
pub const DEFAULT_GAP_HEALTHZ_URL: &str = "http://gap.k8s.orb.local:8080/healthz";
pub const ALLOWED_OVERLAY: &str = "mac-a";
pub const ALLOWED_OVERLAY_REL_PATH: &str = "blueprint/gap/overlays/mac-a";
pub const ALLOWED_NAMESPACE: &str = "gap";
pub const EXPECTED_K8S_CONTEXT: &str = "orbstack";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    #[serde(default)]
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDescriptor {
    pub name: String,
    pub description: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolsListResult {
    pub tools: Vec<ToolDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallParams {
    pub name: String,
    #[serde(default)]
    pub arguments: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallResult {
    pub content: Vec<ToolContentBlock>,
    #[serde(rename = "isError", skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolContentBlock {
    #[serde(rename = "type")]
    pub block_type: String,
    pub text: String,
}

impl JsonRpcResponse {
    pub fn ok(id: Option<Value>, result: Value) -> Self {
        Self {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id,
            result: Some(result),
            error: None,
        }
    }

    pub fn err(id: Option<Value>, code: i32, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: JSONRPC_VERSION.to_string(),
            id,
            result: None,
            error: Some(JsonRpcError {
                code,
                message: message.into(),
            }),
        }
    }
}

impl ToolCallResult {
    pub fn json_ok(payload: Value) -> Self {
        Self {
            content: vec![ToolContentBlock {
                block_type: "text".to_string(),
                text: serde_json::to_string_pretty(&payload)
                    .unwrap_or_else(|_| payload.to_string()),
            }],
            is_error: None,
        }
    }

    pub fn json_err(payload: Value) -> Self {
        Self {
            content: vec![ToolContentBlock {
                block_type: "text".to_string(),
                text: serde_json::to_string_pretty(&payload)
                    .unwrap_or_else(|_| payload.to_string()),
            }],
            is_error: Some(true),
        }
    }
}

#[derive(Debug, Clone)]
pub struct OrbstackSkillConfig {
    pub orb_bin: String,
    pub kubectl_bin: String,
    pub repo_root: PathBuf,
    pub gap_healthz_url: String,
}

impl OrbstackSkillConfig {
    pub fn from_env() -> Self {
        let default_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(Path::parent)
            .and_then(Path::parent)
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));

        Self {
            orb_bin: std::env::var("ORB_BIN").unwrap_or_else(|_| "orb".to_string()),
            kubectl_bin: std::env::var("KUBECTL_BIN").unwrap_or_else(|_| "kubectl".to_string()),
            repo_root: std::env::var("OSC_REPO_ROOT")
                .map(PathBuf::from)
                .unwrap_or(default_root),
            gap_healthz_url: std::env::var("GAP_HEALTHZ_URL")
                .unwrap_or_else(|_| DEFAULT_GAP_HEALTHZ_URL.to_string()),
        }
    }
}

pub fn build_router(config: Arc<OrbstackSkillConfig>) -> Router {
    Router::new()
        .route("/mcp", post(handle_http))
        .with_state(config)
}

async fn handle_http(
    State(config): State<Arc<OrbstackSkillConfig>>,
    Json(req): Json<JsonRpcRequest>,
) -> Json<JsonRpcResponse> {
    Json(dispatch_request(&config, req).await)
}

pub fn tool_descriptors() -> Vec<ToolDescriptor> {
    vec![
        ToolDescriptor {
            name: "status".to_string(),
            description: "Check whether OrbStack daemon and local runtime are up (`orb status` / `orb version`)".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
        },
        ToolDescriptor {
            name: "k8s_context".to_string(),
            description: "Inspect the current kubectl context and verify whether `orbstack` is selected".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
        },
        ToolDescriptor {
            name: "machines_list".to_string(),
            description: "List OrbStack Linux machines (`orb list`) to check Tier 3 machine enrollment (read-only)".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
        },
        ToolDescriptor {
            name: "gap_healthz".to_string(),
            description: "Probe `gap-hub` `/healthz` on Mac A (`http://gap.k8s.orb.local:8080/healthz` or configured loopback/ClusterIP)".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
        },
        ToolDescriptor {
            name: "apply_overlay".to_string(),
            description: "Apply the allowlisted `mac-a` Gap kustomize overlay in the `gap` namespace (`dry_run: true` by default; `dry_run: false` requires `confirm: true`)".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "overlay": {
                        "type": "string",
                        "enum": ["mac-a"],
                        "default": "mac-a",
                        "description": "Allowlisted Gap overlay (only `mac-a` is permitted in the initial slice)"
                    },
                    "dry_run": {
                        "type": "boolean",
                        "default": true,
                        "description": "Run `kubectl apply --dry-run=server` by default; set to false only with `confirm: true`"
                    },
                    "confirm": {
                        "type": "boolean",
                        "default": false,
                        "description": "Must be true when `dry_run` is false"
                    }
                },
                "additionalProperties": false
            }),
        },
    ]
}

pub async fn dispatch_request(
    config: &OrbstackSkillConfig,
    req: JsonRpcRequest,
) -> JsonRpcResponse {
    match req.method.as_str() {
        "tools/list" => JsonRpcResponse::ok(
            req.id,
            serde_json::to_value(ToolsListResult {
                tools: tool_descriptors(),
            })
            .expect("serialize ToolsListResult"),
        ),
        "tools/call" => {
            let params: ToolCallParams =
                match req.params.and_then(|p| serde_json::from_value(p).ok()) {
                    Some(p) => p,
                    None => {
                        return JsonRpcResponse::err(req.id, -32602, "invalid tools/call params");
                    }
                };

            let result = match params.name.as_str() {
                "status" => tool_status(config).await,
                "k8s_context" => tool_k8s_context(config).await,
                "machines_list" => tool_machines_list(config).await,
                "gap_healthz" => tool_gap_healthz(config).await,
                "apply_overlay" => tool_apply_overlay(config, &params.arguments).await,
                other => {
                    return JsonRpcResponse::err(req.id, -32601, format!("unknown tool: {other}"));
                }
            };

            JsonRpcResponse::ok(
                req.id,
                serde_json::to_value(result).expect("serialize ToolCallResult"),
            )
        }
        other => JsonRpcResponse::err(req.id, -32601, format!("method not found: {other}")),
    }
}

struct CmdOutput {
    success: bool,
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
}

async fn run_cmd(bin: &str, args: &[&str]) -> Result<CmdOutput, String> {
    let output = tokio::time::timeout(
        Duration::from_secs(15),
        Command::new(bin)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output(),
    )
    .await
    .map_err(|_| format!("command timed out: {bin}"))?
    .map_err(|e| format!("failed to spawn `{bin}`: {e}"))?;

    Ok(CmdOutput {
        success: output.status.success(),
        exit_code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).trim().to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
    })
}

async fn tool_status(config: &OrbstackSkillConfig) -> ToolCallResult {
    let status_out = match run_cmd(&config.orb_bin, &["status"]).await {
        Ok(o) => o,
        Err(err) => {
            return ToolCallResult::json_err(json!({
                "running": false,
                "error": err,
            }));
        }
    };

    let version_out = run_cmd(&config.orb_bin, &["version"]).await.ok();
    let running = status_out.success
        && !status_out.stdout.to_ascii_lowercase().contains("stopped")
        && !status_out
            .stdout
            .to_ascii_lowercase()
            .contains("not running");

    let payload = json!({
        "running": running,
        "status": status_out.stdout,
        "version": version_out.as_ref().map(|v| v.stdout.clone()).unwrap_or_default(),
        "exit_code": status_out.exit_code,
        "stderr": status_out.stderr,
    });

    if status_out.success {
        ToolCallResult::json_ok(payload)
    } else {
        ToolCallResult::json_err(payload)
    }
}

async fn tool_k8s_context(config: &OrbstackSkillConfig) -> ToolCallResult {
    let out = match run_cmd(&config.kubectl_bin, &["config", "current-context"]).await {
        Ok(o) => o,
        Err(err) => {
            return ToolCallResult::json_err(json!({
                "is_orbstack": false,
                "expected_context": EXPECTED_K8S_CONTEXT,
                "error": err,
            }));
        }
    };

    let current = out.stdout.trim();
    let is_orbstack = out.success && current == EXPECTED_K8S_CONTEXT;
    let payload = json!({
        "current_context": current,
        "expected_context": EXPECTED_K8S_CONTEXT,
        "is_orbstack": is_orbstack,
        "stderr": out.stderr,
    });

    if out.success {
        ToolCallResult::json_ok(payload)
    } else {
        ToolCallResult::json_err(payload)
    }
}

async fn tool_machines_list(config: &OrbstackSkillConfig) -> ToolCallResult {
    let out = match run_cmd(&config.orb_bin, &["list", "--format", "json"]).await {
        Ok(o) if o.success => o,
        Ok(_) => match run_cmd(&config.orb_bin, &["list"]).await {
            Ok(fallback) => fallback,
            Err(err) => {
                return ToolCallResult::json_err(json!({
                    "error": err,
                }));
            }
        },
        Err(err) => {
            return ToolCallResult::json_err(json!({
                "error": err,
            }));
        }
    };

    if !out.success {
        return ToolCallResult::json_err(json!({
            "exit_code": out.exit_code,
            "stderr": out.stderr,
        }));
    }

    let parsed_machines: Value = match serde_json::from_str::<Value>(&out.stdout) {
        Ok(v) => v,
        Err(_) => {
            let lines: Vec<Value> = out
                .stdout
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty() && !l.starts_with("NAME"))
                .map(|line| {
                    let cols: Vec<&str> = line.split_whitespace().collect();
                    json!({
                        "name": cols.first().copied().unwrap_or(""),
                        "state": cols.get(1).copied().unwrap_or(""),
                        "distro": cols.get(2).copied().unwrap_or(""),
                        "raw": line,
                    })
                })
                .collect();
            Value::Array(lines)
        }
    };

    ToolCallResult::json_ok(json!({
        "machines": parsed_machines,
    }))
}

fn parse_http_url(raw: &str) -> Result<(String, u16, String), String> {
    let rest = raw
        .strip_prefix("http://")
        .ok_or_else(|| "GAP_HEALTHZ_URL must start with http://".to_string())?;
    let (authority, path) = match rest.find('/') {
        Some(idx) => (&rest[..idx], &rest[idx..]),
        None => (rest, "/"),
    };
    if authority.contains('@') {
        return Err("credentials in URL are not allowed".to_string());
    }
    let (host, port) = match authority.split_once(':') {
        Some((h, p)) => {
            let port_num: u16 = p
                .parse()
                .map_err(|_| format!("invalid port '{p}' in GAP_HEALTHZ_URL"))?;
            (h.to_string(), port_num)
        }
        None => (authority.to_string(), 80),
    };
    if host.is_empty() {
        return Err("empty host in GAP_HEALTHZ_URL".to_string());
    }
    Ok((host, port, path.to_string()))
}

async fn tool_gap_healthz(config: &OrbstackSkillConfig) -> ToolCallResult {
    let url = config.gap_healthz_url.trim();
    let (host, port, path) = match parse_http_url(url) {
        Ok(parts) => parts,
        Err(e) => {
            return ToolCallResult::json_err(json!({
                "healthy": false,
                "url": url,
                "error": e,
            }));
        }
    };

    let allowed_host = host == "gap.k8s.orb.local"
        || host == "127.0.0.1"
        || host == "localhost"
        || host.ends_with(".orb.local");
    if !allowed_host {
        return ToolCallResult::json_err(json!({
            "healthy": false,
            "url": url,
            "error": format!("host '{host}' is not in the allowlisted Gap healthz hosts (gap.k8s.orb.local, *.orb.local, localhost, 127.0.0.1)"),
        }));
    }

    let probe = tokio::time::timeout(Duration::from_secs(5), async {
        let mut stream = TcpStream::connect((host.as_str(), port))
            .await
            .map_err(|e| e.to_string())?;
        let req_bytes = format!(
            "GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\nUser-Agent: osc-skill-orbstack/0.1\r\n\r\n"
        );
        stream
            .write_all(req_bytes.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        let mut buf = Vec::with_capacity(1024);
        stream
            .read_to_end(&mut buf)
            .await
            .map_err(|e| e.to_string())?;
        Ok::<String, String>(String::from_utf8_lossy(&buf).into_owned())
    })
    .await;

    let raw_resp = match probe {
        Ok(Ok(r)) => r,
        Ok(Err(e)) => {
            return ToolCallResult::json_err(json!({
                "healthy": false,
                "url": url,
                "error": e,
            }));
        }
        Err(_) => {
            return ToolCallResult::json_err(json!({
                "healthy": false,
                "url": url,
                "error": "healthz request timed out after 5s",
            }));
        }
    };

    let (head, body) = raw_resp
        .split_once("\r\n\r\n")
        .unwrap_or((raw_resp.as_str(), ""));
    let status_line = head.lines().next().unwrap_or("");
    let status_code: u16 = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let ok = (200..300).contains(&status_code);
    let truncated_body: String = body.chars().take(512).collect();

    let payload = json!({
        "healthy": ok,
        "status_code": status_code,
        "url": url,
        "body": truncated_body.trim(),
    });
    if ok {
        ToolCallResult::json_ok(payload)
    } else {
        ToolCallResult::json_err(payload)
    }
}

async fn tool_apply_overlay(config: &OrbstackSkillConfig, arguments: &Value) -> ToolCallResult {
    let overlay = arguments
        .get("overlay")
        .and_then(Value::as_str)
        .unwrap_or(ALLOWED_OVERLAY);

    if overlay != ALLOWED_OVERLAY {
        return ToolCallResult::json_err(json!({
            "applied": false,
            "overlay": overlay,
            "error": format!(
                "overlay '{overlay}' is not allowlisted; only '{ALLOWED_OVERLAY}' ({ALLOWED_OVERLAY_REL_PATH}) in namespace '{ALLOWED_NAMESPACE}' is permitted"
            ),
        }));
    }

    let dry_run = arguments
        .get("dry_run")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let confirm = arguments
        .get("confirm")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    if !dry_run && !confirm {
        return ToolCallResult::json_err(json!({
            "applied": false,
            "overlay": overlay,
            "dry_run": false,
            "confirm": false,
            "error": "live mutation requires explicit `confirm: true` when `dry_run: false`",
        }));
    }

    // Verify kubectl context is `orbstack` before applying (even in dry-run) so agents never
    // accidentally target a remote GKE / production cluster.
    let ctx_out = match run_cmd(&config.kubectl_bin, &["config", "current-context"]).await {
        Ok(o) => o,
        Err(err) => {
            return ToolCallResult::json_err(json!({
                "applied": false,
                "overlay": overlay,
                "error": err,
            }));
        }
    };
    let current_ctx = ctx_out.stdout.trim();
    if !ctx_out.success || current_ctx != EXPECTED_K8S_CONTEXT {
        return ToolCallResult::json_err(json!({
            "applied": false,
            "overlay": overlay,
            "current_context": current_ctx,
            "expected_context": EXPECTED_K8S_CONTEXT,
            "error": format!("refusing to apply overlay: current kubectl context is '{current_ctx}', expected '{EXPECTED_K8S_CONTEXT}'"),
        }));
    }

    let overlay_path = config.repo_root.join(ALLOWED_OVERLAY_REL_PATH);
    if !overlay_path.exists() {
        return ToolCallResult::json_err(json!({
            "applied": false,
            "overlay": overlay,
            "overlay_path": overlay_path.display().to_string(),
            "error": "overlay directory does not exist under OSC_REPO_ROOT",
        }));
    }

    let overlay_str = overlay_path.to_string_lossy().into_owned();
    let mut args = vec![
        "--context",
        EXPECTED_K8S_CONTEXT,
        "-n",
        ALLOWED_NAMESPACE,
        "apply",
        "-k",
        &overlay_str,
    ];
    if dry_run {
        args.push("--dry-run=server");
    }

    match run_cmd(&config.kubectl_bin, &args).await {
        Ok(out) => {
            let payload = json!({
                "applied": out.success && !dry_run,
                "dry_run": dry_run,
                "confirm": confirm,
                "overlay": overlay,
                "namespace": ALLOWED_NAMESPACE,
                "context": EXPECTED_K8S_CONTEXT,
                "stdout": out.stdout,
                "stderr": out.stderr,
                "exit_code": out.exit_code,
            });
            if out.success {
                ToolCallResult::json_ok(payload)
            } else {
                ToolCallResult::json_err(payload)
            }
        }
        Err(err) => ToolCallResult::json_err(json!({
            "applied": false,
            "overlay": overlay,
            "dry_run": dry_run,
            "error": err,
        })),
    }
}

async fn run_stdio(config: Arc<OrbstackSkillConfig>) -> anyhow::Result<()> {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let resp = match serde_json::from_str::<JsonRpcRequest>(&line) {
            Ok(req) => dispatch_request(&config, req).await,
            Err(e) => JsonRpcResponse::err(None, -32700, format!("parse error: {e}")),
        };
        let encoded = serde_json::to_string(&resp)?;
        writeln!(stdout, "{encoded}")?;
        stdout.flush()?;
    }
    Ok(())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = Arc::new(OrbstackSkillConfig::from_env());
    if std::env::args().any(|a| a == "--stdio") {
        return run_stdio(config).await;
    }

    let default_addr = SocketAddr::from(DEFAULT_BIND);
    let addr = match std::env::var("ORBSTACK_SKILL_BIND") {
        Ok(raw) => match raw.parse::<SocketAddr>() {
            Ok(a) => a,
            Err(e) => {
                eprintln!(
                    "[osc-skill-orbstack] ORBSTACK_SKILL_BIND={raw:?} could not be parsed ({e}); falling back to {default_addr}"
                );
                default_addr
            }
        },
        Err(_) => default_addr,
    };

    eprintln!("[osc-skill-orbstack] listening on http://{addr}/mcp");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, build_router(config)).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(1);

    fn temp_dir(prefix: &str) -> PathBuf {
        let id = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "osc-skill-orbstack-{prefix}-{}-{id}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_script(dir: &Path, name: &str, body: &str) -> String {
        let path = dir.join(name);
        std::fs::write(&path, body).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path.to_string_lossy().into_owned()
    }

    fn parse_tool_payload(res: &JsonRpcResponse) -> (bool, Value) {
        let result: ToolCallResult =
            serde_json::from_value(res.result.clone().expect("result present")).unwrap();
        let is_err = result.is_error.unwrap_or(false);
        let payload: Value = serde_json::from_str(&result.content[0].text).unwrap();
        (is_err, payload)
    }

    #[tokio::test]
    async fn tools_list_exposes_only_allowlisted_orbstack_tools() {
        let dir = temp_dir("list");
        let cfg = OrbstackSkillConfig {
            orb_bin: "orb".to_string(),
            kubectl_bin: "kubectl".to_string(),
            repo_root: dir,
            gap_healthz_url: DEFAULT_GAP_HEALTHZ_URL.to_string(),
        };

        let resp = dispatch_request(
            &cfg,
            JsonRpcRequest {
                jsonrpc: "2.0".to_string(),
                id: Some(json!(1)),
                method: "tools/list".to_string(),
                params: None,
            },
        )
        .await;

        let list: ToolsListResult = serde_json::from_value(resp.result.unwrap()).unwrap();
        let names: Vec<&str> = list.tools.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(
            names,
            vec![
                "status",
                "k8s_context",
                "machines_list",
                "gap_healthz",
                "apply_overlay"
            ]
        );
    }

    #[tokio::test]
    async fn status_and_machines_list_parse_orb_cli_output() {
        let dir = temp_dir("orb");
        let orb_bin = write_script(
            &dir,
            "fake-orb",
            r#"#!/bin/sh
case "$1" in
  status)
    echo "Running"
    ;;
  version)
    echo "OrbStack 1.8.0"
    ;;
  list)
    echo '[{"name":"postgres","state":"running","distro":"ubuntu"},{"name":"vault","state":"running","distro":"debian"}]'
    ;;
  *)
    exit 1
    ;;
esac
"#,
        );

        let cfg = OrbstackSkillConfig {
            orb_bin,
            kubectl_bin: "kubectl".to_string(),
            repo_root: dir,
            gap_healthz_url: DEFAULT_GAP_HEALTHZ_URL.to_string(),
        };

        let status_resp = dispatch_request(
            &cfg,
            JsonRpcRequest {
                jsonrpc: "2.0".to_string(),
                id: Some(json!(1)),
                method: "tools/call".to_string(),
                params: Some(json!({ "name": "status", "arguments": {} })),
            },
        )
        .await;
        let (is_err, payload) = parse_tool_payload(&status_resp);
        assert!(!is_err);
        assert_eq!(payload["running"], true);
        assert_eq!(payload["version"], "OrbStack 1.8.0");

        let list_resp = dispatch_request(
            &cfg,
            JsonRpcRequest {
                jsonrpc: "2.0".to_string(),
                id: Some(json!(2)),
                method: "tools/call".to_string(),
                params: Some(json!({ "name": "machines_list", "arguments": {} })),
            },
        )
        .await;
        let (is_err, payload) = parse_tool_payload(&list_resp);
        assert!(!is_err);
        assert_eq!(payload["machines"].as_array().unwrap().len(), 2);
        assert_eq!(payload["machines"][0]["name"], "postgres");
    }

    #[tokio::test]
    async fn k8s_context_checks_orbstack_selection() {
        let dir = temp_dir("ctx");
        let kubectl_bin = write_script(
            &dir,
            "fake-kubectl",
            r#"#!/bin/sh
if [ "$1" = "config" ] && [ "$2" = "current-context" ]; then
  echo "orbstack"
  exit 0
fi
exit 1
"#,
        );

        let cfg = OrbstackSkillConfig {
            orb_bin: "orb".to_string(),
            kubectl_bin,
            repo_root: dir,
            gap_healthz_url: DEFAULT_GAP_HEALTHZ_URL.to_string(),
        };

        let resp = dispatch_request(
            &cfg,
            JsonRpcRequest {
                jsonrpc: "2.0".to_string(),
                id: Some(json!(1)),
                method: "tools/call".to_string(),
                params: Some(json!({ "name": "k8s_context", "arguments": {} })),
            },
        )
        .await;
        let (is_err, payload) = parse_tool_payload(&resp);
        assert!(!is_err);
        assert_eq!(payload["is_orbstack"], true);
        assert_eq!(payload["current_context"], "orbstack");
    }

    #[tokio::test]
    async fn apply_overlay_enforces_allowlist_and_confirmation_gate() {
        let dir = temp_dir("apply");
        let overlay_dir = dir.join(ALLOWED_OVERLAY_REL_PATH);
        std::fs::create_dir_all(&overlay_dir).unwrap();

        let kubectl_bin = write_script(
            &dir,
            "fake-kubectl",
            r#"#!/bin/sh
if [ "$1" = "config" ] && [ "$2" = "current-context" ]; then
  echo "orbstack"
  exit 0
fi
echo "kubectl args: $*"
exit 0
"#,
        );

        let cfg = OrbstackSkillConfig {
            orb_bin: "orb".to_string(),
            kubectl_bin,
            repo_root: dir,
            gap_healthz_url: DEFAULT_GAP_HEALTHZ_URL.to_string(),
        };

        // 1. Disallowed overlay is rejected.
        let bad_overlay = dispatch_request(
            &cfg,
            JsonRpcRequest {
                jsonrpc: "2.0".to_string(),
                id: Some(json!(1)),
                method: "tools/call".to_string(),
                params: Some(json!({
                    "name": "apply_overlay",
                    "arguments": { "overlay": "mac-b" }
                })),
            },
        )
        .await;
        let (is_err, payload) = parse_tool_payload(&bad_overlay);
        assert!(is_err);
        assert!(payload["error"]
            .as_str()
            .unwrap()
            .contains("not allowlisted"));

        // 2. dry_run: false without confirm: true is rejected.
        let unconfirmed = dispatch_request(
            &cfg,
            JsonRpcRequest {
                jsonrpc: "2.0".to_string(),
                id: Some(json!(2)),
                method: "tools/call".to_string(),
                params: Some(json!({
                    "name": "apply_overlay",
                    "arguments": { "overlay": "mac-a", "dry_run": false }
                })),
            },
        )
        .await;
        let (is_err, payload) = parse_tool_payload(&unconfirmed);
        assert!(is_err);
        assert!(payload["error"].as_str().unwrap().contains("confirm: true"));

        // 3. Default call runs server-side dry-run.
        let dry_run_resp = dispatch_request(
            &cfg,
            JsonRpcRequest {
                jsonrpc: "2.0".to_string(),
                id: Some(json!(3)),
                method: "tools/call".to_string(),
                params: Some(json!({
                    "name": "apply_overlay",
                    "arguments": {}
                })),
            },
        )
        .await;
        let (is_err, payload) = parse_tool_payload(&dry_run_resp);
        assert!(!is_err);
        assert_eq!(payload["dry_run"], true);
        assert_eq!(payload["applied"], false);
        assert!(payload["stdout"]
            .as_str()
            .unwrap()
            .contains("--dry-run=server"));

        // 4. Explicit dry_run: false + confirm: true applies.
        let confirmed_resp = dispatch_request(
            &cfg,
            JsonRpcRequest {
                jsonrpc: "2.0".to_string(),
                id: Some(json!(4)),
                method: "tools/call".to_string(),
                params: Some(json!({
                    "name": "apply_overlay",
                    "arguments": { "overlay": "mac-a", "dry_run": false, "confirm": true }
                })),
            },
        )
        .await;
        let (is_err, payload) = parse_tool_payload(&confirmed_resp);
        assert!(!is_err);
        assert_eq!(payload["dry_run"], false);
        assert_eq!(payload["applied"], true);
        assert!(!payload["stdout"]
            .as_str()
            .unwrap()
            .contains("--dry-run=server"));
    }

    #[tokio::test]
    async fn gap_healthz_probes_local_http_and_rejects_non_allowlisted_hosts() {
        let app = Router::new().route("/healthz", axum::routing::get(|| async { "ok" }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let dir = temp_dir("healthz");
        let cfg = OrbstackSkillConfig {
            orb_bin: "orb".to_string(),
            kubectl_bin: "kubectl".to_string(),
            repo_root: dir.clone(),
            gap_healthz_url: format!("http://127.0.0.1:{}/healthz", addr.port()),
        };

        let ok_resp = dispatch_request(
            &cfg,
            JsonRpcRequest {
                jsonrpc: "2.0".to_string(),
                id: Some(json!(1)),
                method: "tools/call".to_string(),
                params: Some(json!({ "name": "gap_healthz", "arguments": {} })),
            },
        )
        .await;
        let (is_err, payload) = parse_tool_payload(&ok_resp);
        assert!(!is_err);
        assert_eq!(payload["healthy"], true);
        assert_eq!(payload["status_code"], 200);

        // Non-allowlisted host is rejected.
        let bad_cfg = OrbstackSkillConfig {
            gap_healthz_url: "http://example.com/healthz".to_string(),
            ..cfg
        };
        let bad_resp = dispatch_request(
            &bad_cfg,
            JsonRpcRequest {
                jsonrpc: "2.0".to_string(),
                id: Some(json!(2)),
                method: "tools/call".to_string(),
                params: Some(json!({ "name": "gap_healthz", "arguments": {} })),
            },
        )
        .await;
        let (is_err, payload) = parse_tool_payload(&bad_resp);
        assert!(is_err);
        assert_eq!(payload["healthy"], false);
        assert!(payload["error"]
            .as_str()
            .unwrap()
            .contains("not in the allowlisted Gap healthz hosts"));
    }
}
