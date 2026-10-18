# iPaaS Host — oxidizedgraph + axum + Bun UDS

**Locked architecture:** [docs/OXIDIZEDGRAPH-IPAAS-HOST.md](../../docs/OXIDIZEDGRAPH-IPAAS-HOST.md)

Scaffold for the Host Control Plane that **wraps** oxidizedgraph (Execution Plane) and bridges a warm Bun worker pool over Unix Domain Sockets. WebMCP / ChromeOS agents ([../webmcp-chromeos](../webmcp-chromeos/)) sit beside this stack for browser QA — they are not the host process.

## Workspace layout (Phase 1 target)

```
blueprint/ipaas-host/
├── Cargo.toml                 # workspace
├── crates/
│   ├── ipaas-control-plane/   # axum Host (webhooks, vault, queue, catalog API)
│   ├── ipaas-compiler/        # WorkflowBlueprint → oxidizedgraph
│   └── ipaas-bun-bridge/      # length-prefixed UDS supervisor
└── bun-sdk/
    ├── package.json
    ├── daemon.ts              # warm worker (Zod v4 registry)
    └── connectors/            # Slack etc. (Phase 2)
```

## Locked choices (do not reopen)

1. Execution = **oxidizedgraph** (not greenfield petgraph).
2. Host = **axum** separate from the graph crate.
3. Bun = **UDS Option 1** warm pool; Option 2 spawn only for untrusted Code nodes; **no bun:ffi**.
4. Schemas = **Zod v4** `z.toJSONSchema(..., { io: "input" })`.
5. Connectors = Rust primitives + Bun SDKs + Rust **McpClient**.

## Local smoke (after Phase 1–2 land)

```bash
# Terminal A — Host (compiles blueprint, opens UDS pool)
cargo run -p ipaas-control-plane

# Catalog for XYFlow
curl -fsS http://127.0.0.1:8088/api/v1/nodes/catalog | jq '.[0]'
```

## Relation to Gap / OSC

| Piece | Role here |
|-------|-----------|
| `blueprint/gap/` | gap-hub on Mac OrbStack — sync/voice plane |
| `blueprint/webmcp-chromeos/` | Browser dual-MCP loop |
| This blueprint | Workflow Execution + Host Control for agent graphs |
| oxidizedMCP | Optional mesh in front of MCP nodes / chrome-devtools |

## Status

Scaffold + protocol sketches only. Phase implementation tracked in Linear (iPaaS Host epic).
