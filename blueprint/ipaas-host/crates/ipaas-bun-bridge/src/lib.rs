//! Warm Bun UDS pool — Option 1 (locked).
//!
//! Frame: 4-byte big-endian length + JSON body.
//! Option 3 (`bun:ffi`) is rejected. Option 2 (`Bun.spawn`) is for untrusted
//! Code nodes only and lives outside this warm pool.

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;
use tokio::process::{Child, Command};
use tokio::time::timeout;

#[derive(Serialize)]
pub struct BunRpcRequest<'a> {
    pub execution_id: &'a str,
    pub node_id: &'a str,
    /// `execute_connector` | `eval_code` | `export_schemas`
    pub action: &'a str,
    pub target: &'a str,
    pub input: &'a Value,
    pub credentials: &'a Value,
}

#[derive(Deserialize, Debug)]
pub struct BunRpcResponse {
    pub ok: bool,
    pub data: Option<Value>,
    pub error: Option<String>,
}

pub struct BunWorker {
    child: Child,
    pub socket_path: PathBuf,
}

impl BunWorker {
    pub async fn spawn(worker_id: usize, runner_script: &str) -> Result<Self> {
        let socket_path = PathBuf::from(format!("/tmp/oxidized_bun_{worker_id}.sock"));
        let _ = std::fs::remove_file(&socket_path);

        let child = Command::new("bun")
            .arg("run")
            .arg(runner_script)
            .env("RUNNER_SOCKET", &socket_path)
            .kill_on_drop(true)
            .spawn()
            .context("Failed to spawn Bun worker process")?;

        for _ in 0..25 {
            if socket_path.exists() {
                return Ok(Self { child, socket_path });
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        Err(anyhow!("Bun worker timed out binding UDS socket"))
    }

    pub async fn invoke(&mut self, req: &BunRpcRequest<'_>, max_duration: Duration) -> Result<Value> {
        let payload = serde_json::to_vec(req)?;
        let len_bytes = (payload.len() as u32).to_be_bytes();

        let fut = async {
            let mut stream = UnixStream::connect(&self.socket_path).await?;
            stream.write_all(&len_bytes).await?;
            stream.write_all(&payload).await?;

            let mut resp_len_buf = [0u8; 4];
            stream.read_exact(&mut resp_len_buf).await?;
            let resp_len = u32::from_be_bytes(resp_len_buf) as usize;

            let mut resp_buf = vec![0u8; resp_len];
            stream.read_exact(&mut resp_buf).await?;

            let resp: BunRpcResponse = serde_json::from_slice(&resp_buf)?;
            if resp.ok {
                Ok(resp.data.unwrap_or(Value::Null))
            } else {
                Err(anyhow!(
                    "Bun Execution Error: {}",
                    resp.error.unwrap_or_default()
                ))
            }
        };

        match timeout(max_duration, fut).await {
            Ok(result) => result,
            Err(_) => {
                let _ = self.child.kill().await;
                Err(anyhow!(
                    "Bun execution exceeded timeout of {:?}",
                    max_duration
                ))
            }
        }
    }
}
