//! `core.http_request`: one HTTP call. The output is `{ status, headers, body }`, with `body`
//! parsed as JSON when it is JSON. Non-2xx statuses are outputs, not failures, so a Switch can route on them.

use super::write_output;
use async_trait::async_trait;
use oxidizedgraph::error::NodeError;
use oxidizedgraph::graph::{NodeExecutor, NodeOutput};
use oxidizedgraph::state::SharedState;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::Method;
use serde::Deserialize;
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;
use url::Url;

pub const NODE_TYPE: &str = "core.http_request";

/// Limits set by the Host. A blueprint cannot change them.
#[derive(Clone, Debug)]
pub struct HttpPolicy {
    /// Allow loopback, private, link-local, CGNAT (tailnet), and other non-public addresses.
    /// Off in production, so a workflow cannot reach the metadata server or cluster services.
    pub allow_private_networks: bool,
    pub default_timeout: Duration,
    pub max_timeout: Duration,
    pub max_response_bytes: usize,
}

impl Default for HttpPolicy {
    fn default() -> Self {
        Self {
            allow_private_networks: false,
            default_timeout: Duration::from_secs(30),
            max_timeout: Duration::from_secs(120),
            max_response_bytes: 5 * 1024 * 1024,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Params {
    #[serde(default = "default_method")]
    method: String,
    url: String,
    #[serde(default)]
    headers: BTreeMap<String, String>,
    /// Sent as JSON.
    #[serde(default)]
    body: Option<Value>,
    #[serde(default)]
    timeout_ms: Option<u64>,
}

fn default_method() -> String {
    "GET".into()
}

pub struct HttpRequestNode {
    id: String,
    method: Method,
    url: Url,
    headers: HeaderMap,
    body: Option<Value>,
    timeout: Duration,
    policy: Arc<HttpPolicy>,
}

impl HttpRequestNode {
    pub fn from_params(
        id: &str,
        parameters: &Value,
        policy: Arc<HttpPolicy>,
    ) -> Result<Self, String> {
        let params: Params =
            serde_json::from_value(parameters.clone()).map_err(|e| format!("parameters: {e}"))?;
        let method = Method::from_bytes(params.method.to_ascii_uppercase().as_bytes())
            .map_err(|_| format!("method {:?} is not an HTTP method", params.method))?;
        let url = Url::parse(&params.url).map_err(|e| format!("url: {e}"))?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err(format!(
                "url scheme {:?} is not http or https",
                url.scheme()
            ));
        }
        if url.host_str().is_none() {
            return Err("url has no host".into());
        }
        if !url.username().is_empty() || url.password().is_some() {
            return Err("credentials do not belong in the url; use credential_id".into());
        }
        let mut headers = HeaderMap::new();
        for (name, value) in &params.headers {
            let name = HeaderName::from_bytes(name.as_bytes())
                .map_err(|_| format!("header name {name:?}"))?;
            let value = HeaderValue::from_str(value)
                .map_err(|_| format!("header {name} has an invalid value"))?;
            headers.insert(name, value);
        }
        let timeout = match params.timeout_ms {
            Some(ms) if Duration::from_millis(ms) > policy.max_timeout => {
                return Err(format!(
                    "timeout_ms {ms} is over the limit of {} ms",
                    policy.max_timeout.as_millis()
                ));
            }
            Some(0) => return Err("timeout_ms must be positive".into()),
            Some(ms) => Duration::from_millis(ms),
            None => policy.default_timeout,
        };
        Ok(Self {
            id: id.to_string(),
            method,
            url,
            headers,
            body: params.body,
            timeout,
            policy,
        })
    }

    /// Resolves the host once and checks every address, so the request cannot be rebound elsewhere by DNS.
    async fn resolve(&self) -> Result<(String, Vec<SocketAddr>), NodeError> {
        let host = self
            .url
            .host_str()
            .unwrap_or_default()
            .trim_start_matches('[')
            .trim_end_matches(']')
            .to_string();
        let port = self.url.port_or_known_default().unwrap_or(443);
        let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), port))
            .await
            .map_err(|e| NodeError::ExecutionFailed(format!("resolve {host}: {e}")))?
            .collect();
        if addrs.is_empty() {
            return Err(NodeError::ExecutionFailed(format!(
                "{host} has no addresses"
            )));
        }
        if !self.policy.allow_private_networks {
            if let Some(blocked) = addrs.iter().find(|a| !is_public(a.ip())) {
                return Err(NodeError::GovernanceViolation(format!(
                    "{host} resolves to non-public address {}",
                    blocked.ip()
                )));
            }
        }
        Ok((host, addrs))
    }
}

#[async_trait]
impl NodeExecutor for HttpRequestNode {
    fn id(&self) -> &str {
        &self.id
    }

    async fn execute(&self, state: SharedState) -> Result<NodeOutput, NodeError> {
        let (host, addrs) = self.resolve().await?;
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(self.timeout)
            .resolve_to_addrs(&host, &addrs)
            .build()?;
        let mut request = client
            .request(self.method.clone(), self.url.clone())
            .headers(self.headers.clone());
        if let Some(body) = &self.body {
            request = request.json(body);
        }
        let mut response = request.send().await?;

        let status = response.status().as_u16();
        let mut headers = Map::new();
        for (name, value) in response.headers() {
            if let Ok(value) = value.to_str() {
                headers.insert(name.as_str().to_string(), Value::String(value.to_string()));
            }
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            if bytes.len() + chunk.len() > self.policy.max_response_bytes {
                return Err(NodeError::ExecutionFailed(format!(
                    "response is over the limit of {} bytes",
                    self.policy.max_response_bytes
                )));
            }
            bytes.extend_from_slice(&chunk);
        }
        let body = serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned()));

        write_output(
            &state,
            &self.id,
            serde_json::json!({ "status": status, "headers": headers, "body": body }),
        )?;
        Ok(NodeOutput::cont())
    }

    fn description(&self) -> Option<&str> {
        Some("HTTP request")
    }
}

/// Whether an address is reachable on the public internet.
pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => is_public_v4(v4),
            None => is_public_v6(v6),
        },
    }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_multicast()
        || a == 0
        || (a == 100 && (64..128).contains(&b)) // CGNAT, including Tailscale
        || (a == 192 && b == 0 && c == 0)
        || (a == 198 && (b == 18 || b == 19)) // benchmarking
        || a >= 240)
}

fn is_public_v6(ip: Ipv6Addr) -> bool {
    let first = ip.segments()[0];
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_multicast()
        || ip.is_unique_local()
        || ip.is_unicast_link_local()
        || (first == 0x2001 && ip.segments()[1] == 0x0db8) // documentation
        || first == 0x0064) // NAT64 (64:ff9b::/96) can reach IPv4 private ranges
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(params: Value) -> Result<HttpRequestNode, String> {
        HttpRequestNode::from_params("h", &params, Arc::new(HttpPolicy::default()))
    }

    #[test]
    fn public_addresses() {
        for ip in ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"] {
            assert!(is_public(ip.parse().unwrap()), "{ip}");
        }
    }

    #[test]
    fn non_public_addresses() {
        for ip in [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.81.115.15",
            "0.0.0.0",
            "198.18.0.1",
            "::1",
            "fd00::1",
            "fe80::1",
            "::ffff:10.0.0.1",
            "64:ff9b::a00:1",
        ] {
            assert!(!is_public(ip.parse().unwrap()), "{ip}");
        }
    }

    #[test]
    fn parameters_are_checked_at_compile_time() {
        assert!(node(serde_json::json!({ "url": "https://example.com" })).is_ok());
        assert!(node(serde_json::json!({ "url": "file:///etc/passwd" })).is_err());
        assert!(node(serde_json::json!({ "url": "https://user:pw@example.com" })).is_err());
        assert!(
            node(serde_json::json!({ "url": "https://example.com", "method": "GET POST" }))
                .is_err()
        );
        assert!(
            node(serde_json::json!({ "url": "https://example.com", "timeout_ms": 600000 }))
                .is_err()
        );
        assert!(node(serde_json::json!({ "url": "https://example.com", "proxy": "x" })).is_err());
    }
}
