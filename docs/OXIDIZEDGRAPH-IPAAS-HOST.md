# Locked architecture: oxidizedgraph Execution Plane + axum Host + Bun UDS pool

**Status:** architectural verdict — locked. Do not rebuild petgraph traversal, and do not let Bun own the host process.

This document wraps the Gap / OSC / WebMCP mix in the production iPaaS control path:

| Layer | Technology | Owns |
|-------|------------|------|
| **Execution Plane** | [oxidizedgraph](https://github.com/stevedores-org/oxidizedgraph) | Graph run, Tokio branch parallelism, `conditional_edge`, checkpoints, A2A JSON-RPC worker dispatch |
| **Host Control Plane** | axum service (`ipaas-control-plane`) | XYFlow persistence, webhooks, OAuth2 refresh, AES-256-GCM vault, `SKIP LOCKED` Postgres job queue, WS telemetry |
| **Warm SDK plane** | Bun worker pool over **Unix Domain Sockets** | SaaS connectors + expression eval; length-prefixed JSON-RPC (MessagePack optional) |
| **In-tab agents** | WebMCP + chrome-devtools-mcp | [WEBMCP-CHROMEOS-AGENTS.md](WEBMCP-CHROMEOS-AGENTS.md) — browser QA / in-page tools |
| **Skill mesh** | oxidizedMCP | Optional attach of `chrome-devtools-mcp` and other MCP skills |

Blueprint scaffold: [`blueprint/ipaas-host/`](../blueprint/ipaas-host/). Linear: [LOR-597](https://linear.app/lornu-ai/issue/LOR-597).

---

## 1. Architectural verdict (locked)

| Decision | Chosen path | Why |
|----------|-------------|-----|
| Execution Plane | **oxidizedgraph** Runtime + JSON Graph Compiler | Multi-core Tokio, cyclic agent edges, checkpointing, JSON-RPC A2A already exist. Do **not** greenfield a petgraph state machine. |
| Control Plane | **Separate axum Host** | Keeps oxidizedgraph a pure execution runtime. Host owns XYFlow docs, webhooks, OAuth refresh, AES-256-GCM vault, Postgres `SKIP LOCKED` queue. |
| Rust ↔ Bun | **Option 1: Warm Bun pool over UDS** (Option 2 fallback) | **Reject Option 3 (`bun:ffi`)**: JS segfault / JSC OOM must not kill the Rust supervisor. Option 1 ≈0.2ms IPC for registered connectors. Option 2 (`Bun.spawn`) **only** for untrusted/ad-hoc code nodes needing ephemeral npm installs. |
| Schema / UI | **Zod v4** `z.toJSONSchema(schema, { io: "input" })` | Legacy `zod-to-json-schema` deprecated. Bun exports Draft 2020-12 for `@xyflow` / RJSF sidebars. |
| Connectors | **3-tier hybrid** | Rust: Webhook, HttpRequest, Router/Switch, Merge, McpClient. Bun: SaaS SDKs (Slack, Stripe, …) + Code nodes. Native MCP client unlocks hundreds of servers without 400 wrappers. |

---

## 2. System diagram (wraps WebMCP)

```
┌────────────────────────── XYFlow canvas (@xyflow) ──────────────────────────┐
│  WorkflowBlueprint JSON  →  GET /api/v1/nodes/catalog (Zod→JSON Schema)      │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   │ persist / activate
                                   ▼
┌────────────────── axum Host Control Plane (ipaas-control-plane) ────────────┐
│  Auth · webhooks · cron · WS telemetry · AES-256-GCM vault · SKIP LOCKED    │
│  ipaas-compiler: WorkflowBlueprint → oxidizedgraph GraphBuilder             │
└───────────────┬───────────────────────────────┬─────────────────────────────┘
                │                               │
                ▼                               ▼
┌── oxidizedgraph Execution Plane ──┐   ┌── Warm Bun UDS Pool (Option 1) ──┐
│  NodeExecutor · conditional_edge  │   │  /tmp/oxidized_bun_{n}.sock      │
│  CheckpointStore · A2A /rpc       │◄─►│  length-prefixed frames          │
│  RustNative: HTTP, Switch, Merge  │   │  execute_connector · export_schemas│
│  McpServer: MCP JSON-RPC client   │   │  eval_code → Option 2 spawn only │
└───────────────────────────────────┘   └──────────────────────────────────┘
                │
                ▼
     Gap / OSC edges: Workers MCP · gap-hub · WebMCP (ChromeOS QA loop)
```

WebMCP / chrome-devtools-mcp remain the **browser** dual loop ([LOR-594](https://linear.app/lornu-ai/issue/LOR-594)). They do not replace this host; they validate and invoke Gap surfaces that workflows and agents also touch.

---

## 3. WorkflowBlueprint → oxidizedgraph

Frontend `@xyflow` saves a declarative `WorkflowBlueprint`. On activate/run, the Host compiles JSON into an oxidizedgraph `CompiledGraph` by binding each node id to an oxidizedgraph `NodeExecutor` (native Rust, Bun UDS, or MCP) from a `NodeRegistry`. Branches are `core.switch` nodes whose edges carry XYFlow's `source_handle`; oxidizedgraph routes on that key, so edges take no expression strings.

```rust
// Declarative JSON from XYFlow — see blueprint/ipaas-host/crates/ipaas-compiler
pub struct WorkflowBlueprint {
    pub workflow_id: Uuid,
    pub nodes: Vec<BlueprintNode>,
    pub edges: Vec<BlueprintEdge>,
}

pub enum RuntimeTarget {
    RustNative,
    BunUdsPool,
    McpServer,
}
```

Compile rules:

- `RustNative` → zero-overhead Rust executors (`HttpRequest`, `WebhookTrigger`, `ConditionalSwitch`, `Merge`, `McpClient`).
- `BunUdsPool` → `BunBridgeExecutor` holding `Arc<BunSocketPool>`; decrypt `credential_id` JIT with AES-256-GCM **in Rust memory**; stream request over UDS.
- `McpServer` → JSON-RPC 2.0 over stdio or SSE to `bunx @modelcontextprotocol/server-*` (or oxidizedMCP hub).

Envelope: `execution_id`, `outputs: HashMap<node_id, Value>`, `active_branch`.

---

## 4. Bun UDS supervisor (Option 1)

**Frame format:** 4-byte big-endian length prefix + JSON (or MessagePack) payload. Do **not** use raw newline-delimited JSON (payloads/stack traces break it).

Rust supervisor responsibilities:

1. Spawn warm `bun run` workers with `RUNNER_SOCKET=/tmp/oxidized_bun_{id}.sock` and `kill_on_drop(true)`.
2. `invoke` with `tokio::time::timeout`; on timeout **hard-kill** the child so it cannot poison the pool.
3. Recycle workers after N invocations or on transport error.

Bun worker responsibilities:

1. Bind Unix socket; registry of Zod-v4 `ConnectorDef`s.
2. Actions: `export_schemas` | `execute_connector` | `eval_code` (ad-hoc → prefer Option 2 sandbox).
3. `export_schemas` uses `z.toJSONSchema(inputSchema, { io: "input" })` for the Host catalog cache.

Reference implementations live under [`blueprint/ipaas-host/`](../blueprint/ipaas-host/) (`bun_bridge` sketch + `bun-sdk/daemon.ts` sketch). Treat them as the locked protocol, not as production-hardened crypto/sandboxing.

### Option 2 (fallback only)

`Bun.spawn` for **untrusted / ad-hoc** Code nodes that need ephemeral npm installs. Separate process, stricter timeout, no shared warm pool sockets.

### Rejected: Option 3 (`bun:ffi`)

In-process JSC/V8 failure kills the axum/oxidizedgraph supervisor. Never ship this for user JS.

---

## 5. Three-tier connectors

| Tier | Runtime | Examples |
|------|---------|----------|
| 1 | Rust native | Webhook, HttpRequest, Router/Switch, Merge, **McpClient** |
| 2 | Bun UDS pool | Slack, Stripe, Xero, other SaaS SDKs |
| 3 | MCP servers | Any MCP server via Rust `McpToolExecutor` (stdio/SSE) |

Gap org MCP (`gap.airesearches.app/mcp`) and WebMCP tools are **consumers/producers** in this graph — not a second orchestration runtime.

---

## 6. Four-milestone roadmap

### Phase 1 — Control Plane + JSON adapter (Week 1)

- Cargo workspace: `ipaas-control-plane` (axum + sqlx Postgres), `ipaas-compiler` (Blueprint → oxidizedgraph). oxidizedgraph's `Checkpointer` ships with memory and SurrealDB stores only; Postgres checkpoints need a `Checkpointer` implementation in the Host.
- Native executors: `WebhookTrigger`, `HttpRequestExecutor` (reqwest), `ConditionalSwitchExecutor`.

### Phase 2 — Warm Bun UDS pool + Zod v4 registry (Week 2)

- Drop in `BunWorker` UDS bridge.
- On axum startup: `action: "export_schemas"` → cache → `GET /api/v1/nodes/catalog`.

### Phase 3 — Native MCP client node (Week 3)

- `McpToolExecutor` JSON-RPC 2.0 stdio/SSE.
- Wire oxidizedMCP / chrome-devtools-mcp / Gap MCP as first-class graph tools.

### Phase 4 — XYFlow + KEDA package (Week 4)

- `@xyflow/react` + `@rjsf/core` against `/nodes/catalog`.
- Ship Rust static binary + `oven/bun:alpine`; KEDA on Postgres pending jobs or Redis stream.
- Deploy path: OSC OrbStack / GKE overlays (see oxidizedgraph `deploy/`).

---

## 7. Repo split

| Concern | Home |
|---------|------|
| Locked architecture (this doc) | `stevedores-org/orb-stack-cloud` |
| Workspace scaffold | `blueprint/ipaas-host/` |
| Execution runtime | `stevedores-org/oxidizedgraph` (do not fork petgraph) |
| Skill mesh | `stevedores-org/oxidizedMCP` |
| Gap product + WebMCP | `lornu-ai/gap` + [WEBMCP-CHROMEOS-AGENTS.md](WEBMCP-CHROMEOS-AGENTS.md) |
| Mac gap-hub | `blueprint/gap/` |

---

## 8. Security gates

- Credentials decrypt only in Rust Host memory; never persist plaintext to Bun logs.
- UDS sockets under `/tmp/oxidized_bun_*.sock` with restrictive permissions; no LAN bind.
- `eval_code` is not the default connector path — Option 2 sandbox for untrusted JS.
- WebMCP / CDP remain owned-origin only ([LOR-594](https://linear.app/lornu-ai/issue/LOR-594)).
- No secrets, vault keys, or OAuth tokens in git.

---

## Related

- [WEBMCP-CHROMEOS-AGENTS.md](WEBMCP-CHROMEOS-AGENTS.md)
- [GAP-DEPLOYMENT-STRATEGY.md](GAP-DEPLOYMENT-STRATEGY.md)
- oxidizedgraph [WORKER_ORCHESTRATION.md](https://github.com/stevedores-org/oxidizedgraph/blob/main/docs/WORKER_ORCHESTRATION.md) (A2A Jobs — complementary, not a substitute for the UDS Bun pool)
