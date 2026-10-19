//! Tailscale MCP skill for OSC (`tailscale::*`).
//!
//! Exposes MCP JSON-RPC 2.0 over HTTP `POST /mcp` (default `127.0.0.1:9321`)
//! and single-shot stdio (`--stdio`) for local Podman fallback.
//!
//! Security posture (non-negotiable):
//! 1. Read-only in the initial slice (`status`, `whoami`, `serve_status`, `acl_lint`, `authkey_present`).
//! 2. Never returns `TS_AUTHKEY`, OAuth client secrets, or Keychain/ESO secret values —
//!    `authkey_present` returns `{ "present": bool }` only, and all CLI outputs are scrubbed.
//! 3. Does not mint auth keys, rewrite production ACLs, open Serve to arbitrary ports,
//!    or expose Gap `/ws` on a public Tunnel (blocked on LOR-545).

use axum::{extract::State, routing::post, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::process::Command;

pub const JSONRPC_VERSION: &str = "2.0";
pub const DEFAULT_BIND: ([u8; 4], u16) = ([127, 0, 0, 1], 9321);
pub const ACL_EXAMPLE_REL_PATH: &str = "blueprint/edge/tailscale/acls.json.example";

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
        let raw = serde_json::to_string_pretty(&payload).unwrap_or_else(|_| payload.to_string());
        Self {
            content: vec![ToolContentBlock {
                block_type: "text".to_string(),
                text: redact_secrets(&raw),
            }],
            is_error: None,
        }
    }

    pub fn json_err(payload: Value) -> Self {
        let raw = serde_json::to_string_pretty(&payload).unwrap_or_else(|_| payload.to_string());
        Self {
            content: vec![ToolContentBlock {
                block_type: "text".to_string(),
                text: redact_secrets(&raw),
            }],
            is_error: Some(true),
        }
    }
}

/// Redacts any Tailscale auth key (`tskey-auth-...`), API key (`tskey-api-...`),
/// or OAuth client secret (`tskey-client-...`) plus the current `TS_AUTHKEY` value
/// if present in the process environment so key material can never leak into tool outputs.
pub fn redact_secrets(input: &str) -> String {
    let mut scrubbed = input.to_string();
    for env_key in ["TS_AUTHKEY", "TAILSCALE_AUTHKEY", "TS_OAUTH_CLIENT_SECRET"] {
        if let Ok(secret) = std::env::var(env_key) {
            let trimmed = secret.trim();
            if !trimmed.is_empty() {
                scrubbed = scrubbed.replace(trimmed, "[REDACTED]");
            }
        }
    }

    for prefix in ["tskey-auth-", "tskey-api-", "tskey-client-"] {
        while let Some(idx) = scrubbed.find(prefix) {
            let end = scrubbed[idx..]
                .find(|c: char| {
                    c.is_whitespace() || matches!(c, '"' | '\'' | ',' | ';' | ')' | ']' | '}')
                })
                .map(|offset| idx + offset)
                .unwrap_or(scrubbed.len());
            scrubbed.replace_range(idx..end, "[REDACTED_TSKEY]");
        }
    }
    scrubbed
}

#[derive(Debug, Clone)]
pub struct TailscaleSkillConfig {
    pub tailscale_bin: String,
    pub security_bin: String,
    pub repo_root: PathBuf,
}

impl TailscaleSkillConfig {
    pub fn from_env() -> Self {
        let default_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(Path::parent)
            .and_then(Path::parent)
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));

        Self {
            tailscale_bin: std::env::var("TAILSCALE_BIN")
                .unwrap_or_else(|_| "tailscale".to_string()),
            security_bin: std::env::var("SECURITY_BIN").unwrap_or_else(|_| "security".to_string()),
            repo_root: std::env::var("OSC_REPO_ROOT")
                .map(PathBuf::from)
                .unwrap_or(default_root),
        }
    }
}

pub fn build_router(config: Arc<TailscaleSkillConfig>) -> Router {
    Router::new()
        .route("/mcp", post(handle_http))
        .with_state(config)
}

async fn handle_http(
    State(config): State<Arc<TailscaleSkillConfig>>,
    Json(req): Json<JsonRpcRequest>,
) -> Json<JsonRpcResponse> {
    Json(dispatch_request(&config, req).await)
}

pub fn tool_descriptors() -> Vec<ToolDescriptor> {
    vec![
        ToolDescriptor {
            name: "status".to_string(),
            description: "Inspect tailnet state (`tailscale status --json`): BackendState, Self node, MagicDNS suffix, and peer summary".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
        },
        ToolDescriptor {
            name: "whoami".to_string(),
            description: "Return the local tailnet node identity (DNSName, HostName, TailscaleIPs, User) without exposing keys".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
        },
        ToolDescriptor {
            name: "serve_status".to_string(),
            description: "Inspect `tailscale serve status --json` to verify whether Serve is publishing the local hub".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
        },
        ToolDescriptor {
            name: "acl_lint".to_string(),
            description: "Validate `blueprint/edge/tailscale/acls.json.example` structure, required tags (`tag:orbstack-k8s`, `tag:orbstack-mac`), and Tier 3 isolation rules".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
        },
        ToolDescriptor {
            name: "authkey_present".to_string(),
            description: "Check whether `TS_AUTHKEY` is present in the environment or macOS Keychain (`find-generic-password` without `-w`); returns boolean `present` only, never key material".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
        },
    ]
}

pub async fn dispatch_request(
    config: &TailscaleSkillConfig,
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
                "whoami" => tool_whoami(config).await,
                "serve_status" => tool_serve_status(config).await,
                "acl_lint" => tool_acl_lint(config).await,
                "authkey_present" => tool_authkey_present(config).await,
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
        Duration::from_secs(10),
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

async fn tool_status(config: &TailscaleSkillConfig) -> ToolCallResult {
    let out = match run_cmd(&config.tailscale_bin, &["status", "--json"]).await {
        Ok(o) => o,
        Err(err) => {
            return ToolCallResult::json_err(json!({
                "online": false,
                "error": err,
            }));
        }
    };

    if !out.success {
        return ToolCallResult::json_err(json!({
            "online": false,
            "exit_code": out.exit_code,
            "stderr": out.stderr,
        }));
    }

    match serde_json::from_str::<Value>(&out.stdout) {
        Ok(parsed) => {
            let backend_state = parsed
                .get("BackendState")
                .and_then(Value::as_str)
                .unwrap_or("Unknown");
            let online = backend_state == "Running";
            let magic_dns_suffix = parsed
                .get("MagicDNSSuffix")
                .and_then(Value::as_str)
                .unwrap_or("");
            let self_dns = parsed
                .pointer("/Self/DNSName")
                .and_then(Value::as_str)
                .unwrap_or("");
            let self_host = parsed
                .pointer("/Self/HostName")
                .and_then(Value::as_str)
                .unwrap_or("");
            let peer_count = parsed
                .get("Peer")
                .and_then(Value::as_object)
                .map(|m| m.len())
                .unwrap_or(0);

            ToolCallResult::json_ok(json!({
                "online": online,
                "backend_state": backend_state,
                "self_hostname": self_host,
                "self_dns_name": self_dns,
                "magic_dns_suffix": magic_dns_suffix,
                "peer_count": peer_count,
            }))
        }
        Err(e) => ToolCallResult::json_err(json!({
            "online": false,
            "error": format!("invalid JSON from `tailscale status --json`: {e}"),
        })),
    }
}

async fn tool_whoami(config: &TailscaleSkillConfig) -> ToolCallResult {
    let out = match run_cmd(&config.tailscale_bin, &["status", "--json"]).await {
        Ok(o) => o,
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

    match serde_json::from_str::<Value>(&out.stdout) {
        Ok(parsed) => {
            let self_node = parsed.get("Self").cloned().unwrap_or(Value::Null);
            let user_id = self_node
                .get("UserID")
                .and_then(Value::as_i64)
                .map(|id| id.to_string());
            let user_profile = user_id
                .as_deref()
                .and_then(|id| parsed.get("User")?.get(id))
                .cloned()
                .unwrap_or(Value::Null);

            ToolCallResult::json_ok(json!({
                "hostname": self_node.get("HostName").cloned().unwrap_or(Value::Null),
                "dns_name": self_node.get("DNSName").cloned().unwrap_or(Value::Null),
                "tailscale_ips": self_node.get("TailscaleIPs").cloned().unwrap_or(json!([])),
                "online": self_node.get("Online").cloned().unwrap_or(Value::Null),
                "tags": self_node.get("Tags").cloned().unwrap_or(json!([])),
                "user": {
                    "login_name": user_profile.get("LoginName").cloned().unwrap_or(Value::Null),
                    "display_name": user_profile.get("DisplayName").cloned().unwrap_or(Value::Null),
                }
            }))
        }
        Err(e) => ToolCallResult::json_err(json!({
            "error": format!("invalid JSON from `tailscale status --json`: {e}"),
        })),
    }
}

async fn tool_serve_status(config: &TailscaleSkillConfig) -> ToolCallResult {
    let out = match run_cmd(&config.tailscale_bin, &["serve", "status", "--json"]).await {
        Ok(o) => o,
        Err(err) => {
            return ToolCallResult::json_err(json!({
                "publishing": false,
                "error": err,
            }));
        }
    };

    if !out.success {
        return ToolCallResult::json_err(json!({
            "publishing": false,
            "exit_code": out.exit_code,
            "stderr": out.stderr,
        }));
    }

    match serde_json::from_str::<Value>(&out.stdout) {
        Ok(parsed) => {
            let has_tcp = parsed
                .get("TCP")
                .and_then(Value::as_object)
                .map(|m| !m.is_empty())
                .unwrap_or(false);
            let has_web = parsed
                .get("Web")
                .and_then(Value::as_object)
                .map(|m| !m.is_empty())
                .unwrap_or(false);
            let has_funnel = parsed
                .get("AllowFunnel")
                .and_then(Value::as_object)
                .map(|m| m.values().any(|v| v.as_bool() == Some(true)))
                .unwrap_or(false);

            ToolCallResult::json_ok(json!({
                "publishing": has_tcp || has_web,
                "funnel_enabled": has_funnel,
                "serve": parsed,
            }))
        }
        Err(e) => ToolCallResult::json_err(json!({
            "publishing": false,
            "error": format!("invalid JSON from `tailscale serve status --json`: {e}"),
        })),
    }
}

async fn tool_acl_lint(config: &TailscaleSkillConfig) -> ToolCallResult {
    let acl_path = config.repo_root.join(ACL_EXAMPLE_REL_PATH);
    let raw = match std::fs::read_to_string(&acl_path) {
        Ok(s) => s,
        Err(e) => {
            return ToolCallResult::json_err(json!({
                "valid": false,
                "path": acl_path.display().to_string(),
                "error": format!("failed to read {}: {e}", acl_path.display()),
            }));
        }
    };

    let parsed: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(e) => {
            return ToolCallResult::json_err(json!({
                "valid": false,
                "path": acl_path.display().to_string(),
                "error": format!("invalid JSON in {}: {e}", acl_path.display()),
            }));
        }
    };

    let mut errors: Vec<String> = Vec::new();

    let acls = match parsed.get("acls").and_then(Value::as_array) {
        Some(a) if !a.is_empty() => a.clone(),
        _ => {
            errors.push("missing or empty `acls` array".to_string());
            Vec::new()
        }
    };

    let tag_owners = match parsed.get("tagOwners").and_then(Value::as_object) {
        Some(t) => t.clone(),
        None => {
            errors.push("missing `tagOwners` object".to_string());
            serde_json::Map::new()
        }
    };

    for required_tag in ["tag:orbstack-k8s", "tag:orbstack-mac"] {
        if !tag_owners.contains_key(required_tag) {
            errors.push(format!("missing required tagOwner `{required_tag}`"));
        }
    }

    for (idx, rule) in acls.iter().enumerate() {
        let action = rule.get("action").and_then(Value::as_str).unwrap_or("");
        if action != "accept" {
            errors.push(format!("acls[{idx}]: unsupported action `{action}`"));
        }
        let src = rule.get("src").and_then(Value::as_array);
        let dst = rule.get("dst").and_then(Value::as_array);
        if src.map(|s| s.is_empty()).unwrap_or(true) {
            errors.push(format!("acls[{idx}]: missing or empty `src`"));
        }
        if dst.map(|d| d.is_empty()).unwrap_or(true) {
            errors.push(format!("acls[{idx}]: missing or empty `dst`"));
        }
        // Ensure no wildcard source (`*` or `autogroup:internet`) opens Tier 3 ports (5432 / 8200).
        if let (Some(srcs), Some(dsts)) = (src, dst) {
            let wildcard_src = srcs.iter().any(|s| {
                matches!(
                    s.as_str(),
                    Some("*") | Some("autogroup:internet") | Some("0.0.0.0/0")
                )
            });
            let touches_tier3 = dsts.iter().any(|d| {
                let s = d.as_str().unwrap_or("");
                s.ends_with(":5432") || s.ends_with(":8200")
            });
            if wildcard_src && touches_tier3 {
                errors.push(format!(
                    "acls[{idx}]: wildcard source cannot target Tier 3 ports (5432/8200)"
                ));
            }
        }
    }

    let valid = errors.is_empty();
    let payload = json!({
        "valid": valid,
        "path": ACL_EXAMPLE_REL_PATH,
        "rules_count": acls.len(),
        "tag_owners": tag_owners.keys().collect::<Vec<_>>(),
        "errors": errors,
    });

    if valid {
        ToolCallResult::json_ok(payload)
    } else {
        ToolCallResult::json_err(payload)
    }
}

async fn tool_authkey_present(config: &TailscaleSkillConfig) -> ToolCallResult {
    let env_present = std::env::var("TS_AUTHKEY")
        .ok()
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false);

    // Also probe macOS Keychain metadata (`security find-generic-password -s TS_AUTHKEY`
    // WITHOUT `-w`, so the secret value is never printed to stdout).
    let keychain_present = if cfg!(target_os = "macos") || std::env::var("SECURITY_BIN").is_ok() {
        run_cmd(
            &config.security_bin,
            &["find-generic-password", "-s", "TS_AUTHKEY"],
        )
        .await
        .map(|o| o.success)
        .unwrap_or(false)
    } else {
        false
    };

    ToolCallResult::json_ok(json!({
        "present": env_present || keychain_present,
    }))
}

async fn run_stdio(config: Arc<TailscaleSkillConfig>) -> anyhow::Result<()> {
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
    let config = Arc::new(TailscaleSkillConfig::from_env());
    if std::env::args().any(|a| a == "--stdio") {
        return run_stdio(config).await;
    }

    let default_addr = SocketAddr::from(DEFAULT_BIND);
    let addr = match std::env::var("TAILSCALE_SKILL_BIND") {
        Ok(raw) => match raw.parse::<SocketAddr>() {
            Ok(a) => a,
            Err(e) => {
                eprintln!(
                    "[osc-skill-tailscale] TAILSCALE_SKILL_BIND={raw:?} could not be parsed ({e}); falling back to {default_addr}"
                );
                default_addr
            }
        },
        Err(_) => default_addr,
    };

    eprintln!("[osc-skill-tailscale] listening on http://{addr}/mcp");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, build_router(config)).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Mutex;

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(1);
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn temp_dir(prefix: &str) -> PathBuf {
        let id = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "osc-skill-tailscale-{prefix}-{}-{id}",
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

    fn parse_tool_payload(res: &JsonRpcResponse) -> (bool, String, Value) {
        let result: ToolCallResult =
            serde_json::from_value(res.result.clone().expect("result present")).unwrap();
        let is_err = result.is_error.unwrap_or(false);
        let raw_text = result.content[0].text.clone();
        let payload: Value = serde_json::from_str(&raw_text).unwrap();
        (is_err, raw_text, payload)
    }

    #[tokio::test]
    async fn tools_list_exposes_only_allowlisted_tailscale_tools() {
        let dir = temp_dir("list");
        let cfg = TailscaleSkillConfig {
            tailscale_bin: "tailscale".to_string(),
            security_bin: "security".to_string(),
            repo_root: dir,
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
                "whoami",
                "serve_status",
                "acl_lint",
                "authkey_present"
            ]
        );
    }

    #[tokio::test]
    async fn status_whoami_and_serve_status_parse_tailscale_json() {
        let dir = temp_dir("cli");
        let ts_bin = write_script(
            &dir,
            "fake-tailscale",
            r#"#!/bin/sh
if [ "$1" = "status" ] && [ "$2" = "--json" ]; then
  cat <<'EOF'
{
  "BackendState": "Running",
  "MagicDNSSuffix": "tailnet-example.ts.net",
  "Self": {
    "HostName": "mac-a",
    "DNSName": "mac-a.tailnet-example.ts.net.",
    "TailscaleIPs": ["100.64.0.1"],
    "Online": true,
    "UserID": 42,
    "Tags": ["tag:orbstack-mac"]
  },
  "User": {
    "42": {
      "LoginName": "dev@stevedores.org",
      "DisplayName": "Dev Operator"
    }
  },
  "Peer": {
    "nodekey:1": { "HostName": "mac-b" },
    "nodekey:2": { "HostName": "orb-postgres" }
  }
}
EOF
  exit 0
fi
if [ "$1" = "serve" ] && [ "$2" = "status" ] && [ "$3" = "--json" ]; then
  cat <<'EOF'
{
  "TCP": { "443": { "HTTPS": true } },
  "Web": {
    "mac-a.tailnet-example.ts.net:443": {
      "Handlers": { "/": { "Proxy": "http://127.0.0.1:8080" } }
    }
  }
}
EOF
  exit 0
fi
exit 1
"#,
        );

        let cfg = TailscaleSkillConfig {
            tailscale_bin: ts_bin,
            security_bin: "security".to_string(),
            repo_root: dir,
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
        let (is_err, _, payload) = parse_tool_payload(&status_resp);
        assert!(!is_err);
        assert_eq!(payload["online"], true);
        assert_eq!(payload["self_hostname"], "mac-a");
        assert_eq!(payload["peer_count"], 2);

        let whoami_resp = dispatch_request(
            &cfg,
            JsonRpcRequest {
                jsonrpc: "2.0".to_string(),
                id: Some(json!(2)),
                method: "tools/call".to_string(),
                params: Some(json!({ "name": "whoami", "arguments": {} })),
            },
        )
        .await;
        let (is_err, _, payload) = parse_tool_payload(&whoami_resp);
        assert!(!is_err);
        assert_eq!(payload["hostname"], "mac-a");
        assert_eq!(payload["user"]["login_name"], "dev@stevedores.org");

        let serve_resp = dispatch_request(
            &cfg,
            JsonRpcRequest {
                jsonrpc: "2.0".to_string(),
                id: Some(json!(3)),
                method: "tools/call".to_string(),
                params: Some(json!({ "name": "serve_status", "arguments": {} })),
            },
        )
        .await;
        let (is_err, _, payload) = parse_tool_payload(&serve_resp);
        assert!(!is_err);
        assert_eq!(payload["publishing"], true);
        assert_eq!(payload["funnel_enabled"], false);
    }

    #[tokio::test]
    async fn acl_lint_validates_repo_acls_example_and_catches_wildcard_tier3() {
        let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(Path::parent)
            .and_then(Path::parent)
            .unwrap()
            .to_path_buf();
        let cfg = TailscaleSkillConfig {
            tailscale_bin: "tailscale".to_string(),
            security_bin: "security".to_string(),
            repo_root,
        };

        let ok_resp = dispatch_request(
            &cfg,
            JsonRpcRequest {
                jsonrpc: "2.0".to_string(),
                id: Some(json!(1)),
                method: "tools/call".to_string(),
                params: Some(json!({ "name": "acl_lint", "arguments": {} })),
            },
        )
        .await;
        let (is_err, _, payload) = parse_tool_payload(&ok_resp);
        assert!(!is_err, "repo acls.json.example should pass: {payload}");
        assert_eq!(payload["valid"], true);
        assert_eq!(payload["rules_count"], 2);

        // Now test against a broken ACL that opens Tier 3 port 5432 to `*`.
        let bad_dir = temp_dir("bad-acl");
        let bad_acl_path = bad_dir.join(ACL_EXAMPLE_REL_PATH);
        std::fs::create_dir_all(bad_acl_path.parent().unwrap()).unwrap();
        std::fs::write(
            &bad_acl_path,
            r#"{
              "acls": [{ "action": "accept", "src": ["*"], "dst": ["tag:orbstack-mac:5432"] }],
              "tagOwners": { "tag:orbstack-k8s": ["group:devs"], "tag:orbstack-mac": ["group:devs"] }
            }"#,
        )
        .unwrap();

        let bad_cfg = TailscaleSkillConfig {
            repo_root: bad_dir,
            ..cfg
        };
        let bad_resp = dispatch_request(
            &bad_cfg,
            JsonRpcRequest {
                jsonrpc: "2.0".to_string(),
                id: Some(json!(2)),
                method: "tools/call".to_string(),
                params: Some(json!({ "name": "acl_lint", "arguments": {} })),
            },
        )
        .await;
        let (is_err, _, payload) = parse_tool_payload(&bad_resp);
        assert!(is_err);
        assert_eq!(payload["valid"], false);
        assert!(payload["errors"][0]
            .as_str()
            .unwrap()
            .contains("wildcard source"));
    }

    #[test]
    fn authkey_present_returns_boolean_only_and_never_leaks_secret() {
        let _guard = ENV_LOCK.lock().unwrap();
        let rt = tokio::runtime::Runtime::new().unwrap();
        let dir = temp_dir("authkey");
        let cfg = TailscaleSkillConfig {
            tailscale_bin: "tailscale".to_string(),
            security_bin: "/nonexistent/security".to_string(),
            repo_root: dir,
        };

        let secret = "tskey-auth-k123456CNTRL-supersecretvalue999";
        std::env::set_var("TS_AUTHKEY", secret);

        let resp = rt.block_on(dispatch_request(
            &cfg,
            JsonRpcRequest {
                jsonrpc: "2.0".to_string(),
                id: Some(json!(1)),
                method: "tools/call".to_string(),
                params: Some(json!({ "name": "authkey_present", "arguments": {} })),
            },
        ));
        let (is_err, raw_text, payload) = parse_tool_payload(&resp);
        assert!(!is_err);
        assert_eq!(payload, json!({ "present": true }));
        assert!(
            !raw_text.contains(secret) && !raw_text.contains("tskey-auth-"),
            "tool output must never contain TS_AUTHKEY value: {raw_text}"
        );

        // Verify redaction helper also scrubs tskey-auth-* tokens from arbitrary strings.
        let leaked = format!("error authenticating with {secret} on node");
        let scrubbed = redact_secrets(&leaked);
        assert!(!scrubbed.contains("supersecretvalue999"));
        assert!(!scrubbed.contains("tskey-auth-"));

        std::env::remove_var("TS_AUTHKEY");

        let missing_resp = rt.block_on(dispatch_request(
            &cfg,
            JsonRpcRequest {
                jsonrpc: "2.0".to_string(),
                id: Some(json!(2)),
                method: "tools/call".to_string(),
                params: Some(json!({ "name": "authkey_present", "arguments": {} })),
            },
        ));
        let (is_err, _, payload) = parse_tool_payload(&missing_resp);
        assert!(!is_err);
        assert_eq!(payload, json!({ "present": false }));
    }
}
