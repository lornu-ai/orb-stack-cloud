# OSC MCP Skills in the oxidizedMCP Mesh (`orbstack` + `tailscale`)

**Decision:** OrbStack and Tailscale agent helpers belong **as skills in the mesh**, not as new features inside the `oxidized-mcp` proxy.

`oxidizedMCP` ([stevedores-org/oxidizedMCP](https://github.com/stevedores-org/oxidizedMCP)) is one IDE entrypoint with registry-routed `skill::tool` backends. OSC already uses that pattern for `chrome-devtools` ([WEBMCP-CHROMEOS-AGENTS.md](WEBMCP-CHROMEOS-AGENTS.md)). OrbStack and Tailscale follow the same pattern as `infra-code` and `gke-fleets` — keeping `oxidized-mcp-core` dumb and domain-agnostic.

## Why it belongs

Agents building and operating OSC repeatedly need deterministic answers to:

- Is OrbStack up? Is the `orbstack` Kubernetes context selected?
- Is `gap-hub` healthy on Mac A (`http://gap.k8s.orb.local:8080/healthz`)?
- Is Tailscale online? Is `tailscale serve` publishing the hub?
- Are Tier 3 machines (`postgres`, `vault`) enrolled? Is `TS_AUTHKEY` present (without printing it)?

Without dedicated skills, every agent reinvents ad-hoc shell glue and drifts from [EDGE-NETWORK.md](EDGE-NETWORK.md) and the [`blueprint/gap/`](../blueprint/gap/) overlays.

## Two local OSC skills + the Gap org MCP edge

We ship **two separate local OSC skills** (`orbstack::*` and `tailscale::*`) rather than a single monolithic `osc::*` binary so ChromeOS / Crostini agents can enable `tailscale` (alongside `chrome-devtools`) without requiring the macOS `orb` CLI. Alongside them, the **Gap org MCP server** (`gap` at `https://gap.airesearches.app/mcp`, [LOR-578](https://linear.app/lornu-ai/issue/LOR-578)) provides org-wide agent coordination on Cloudflare Workers (`gap-web` + `GapOrg` SQLite Durable Object behind Cloudflare Access).

| Skill | Endpoint | Tools (read-heavy first) | Do **not** expose yet |
|-------|----------|--------------------------|------------------------|
| `gap` (`gap::*` / direct Access OAuth) | `https://gap.airesearches.app/mcp` ([LOR-578](https://linear.app/lornu-ai/issue/LOR-578)) | `whoami`, `register_agent`, `heartbeat`, `list_agents`, `delegate_task`, `respond_to_task`, `update_task_status`, `attach_evidence`, `list_tasks`, `get_task`, `verify_audit` | Unauthenticated `/ws` gateway bypass ([LOR-545](https://linear.app/lornu-ai/issue/LOR-545)) |
| `orbstack` (`orbstack::*`) | `http://127.0.0.1:9320/mcp` | `status`, `k8s_context`, `machines_list`, `gap_healthz`, `apply_overlay` (`mac-a` only, `dry_run: true` default) | Arbitrary `orb create`, delete machines, write cloud-init with secrets |
| `tailscale` (`tailscale::*`) | `http://127.0.0.1:9321/mcp` | `status`, `whoami`, `serve_status`, `acl_lint` (against [`blueprint/edge/tailscale/acls.json.example`](../blueprint/edge/tailscale/acls.json.example)), `authkey_present` (boolean only) | Mint/print auth keys, rewrite production ACLs, open Serve to arbitrary ports, Tunnel/`/ws` public expose |
| `chrome-devtools` (`chrome-devtools::*`) | `http://127.0.0.1:9310/mcp` ([LOR-594](https://linear.app/lornu-ai/issue/LOR-594)) | CDP inspection of console, network, performance, and WebMCP (`document.modelContext`) | Cross-origin credential scraping |

## Where each piece lives

| Concern | Home |
|---------|------|
| Proxy / discovery / `skill::tool` routing | [`stevedores-org/oxidizedMCP`](https://github.com/stevedores-org/oxidizedMCP) (unchanged — do **not** put OrbStack/Tailscale logic into `oxidized-mcp-core`) |
| Gap org MCP server (`https://gap.airesearches.app/mcp`) | [`lornu-ai/gap`](https://github.com/lornu-ai/gap) (`gap-web` Cloudflare Worker + `GapOrg` Durable Object behind Cloudflare Access, [LOR-578](https://linear.app/lornu-ai/issue/LOR-578)) |
| Local OSC skill implementations (`orb` / `kubectl` / `tailscale` wrappers) | **OSC** — [`tools/mcp-skills/orbstack/`](../tools/mcp-skills/orbstack/) and [`tools/mcp-skills/tailscale/`](../tools/mcp-skills/tailscale/) (HTTP `POST /mcp` + `--stdio` / `dockworker.toml` Podman fallback) |
| Registry fragments | OSC [`blueprint/gap/mcp/oxidized-skill.example.yaml`](../blueprint/gap/mcp/oxidized-skill.example.yaml) and [`blueprint/webmcp-chromeos/mcp/oxidized-skill.example.yaml`](../blueprint/webmcp-chromeos/mcp/oxidized-skill.example.yaml) + pointer in oxidizedMCP `registry/skills.example.yaml` |
| Secrets | macOS Keychain / External Secrets Operator (ESO) / Cloudflare Access only; local tools return `"present": true | false`, never key material |

## Security posture (non-negotiable)

`orb`, `kubectl`, and `tailscale` can create VMs, join the tailnet, and publish HTTPS endpoints. Treat these skills with the same guardrails as `infra-code`:

1. **Default read-only.** Mutations require confirmation / explicit `confirm: true` (and `orbstack::apply_overlay` defaults to `dry_run: true` / `--dry-run=server`).
2. **Allowlist commands and overlays** (`mac-a`, `gap` namespace, `orbstack` context) — no free-form shell execution.
3. **Never return `TS_AUTHKEY` or OAuth client secrets** in tool results (`tailscale::authkey_present` returns `{ "present": bool }` only; all outputs scrub `tskey-*` tokens).
4. **Deny tools that open Cloudflare Tunnel to Gap `/ws`** until [LOR-545](https://linear.app/lornu-ai/issue/LOR-545) closes.
5. **Run skill processes as the Mac / ChromeOS user** with host CLI access; do not bake auth keys or kubeconfigs into OCI images.

## Priority vs Gap MVP

1. **Manual first:** host Tailscale + `tailscale serve` + `gap-hub` `/healthz` on Mac A ([GAP-ON-ORBSTACK.md](GAP-ON-ORBSTACK.md)).
2. **Then:** `orbstack` + `tailscale` skills (`status`, `gap_healthz`, `serve_status` first; `apply_overlay` dry-run/confirmed next) so agents can verify and redeploy that path deterministically.
3. **Later:** Tailscale Kubernetes Operator install helpers and Tier 3 bootstrap wrappers (still no key echo).
4. **Parallel:** keep `chrome-devtools` for Gap web QA ([WEBMCP-CHROMEOS-AGENTS.md](WEBMCP-CHROMEOS-AGENTS.md)).

## Registry fragment

```yaml
# OSC + Gap registry fragment → oxidizedMCP
skills:
  - name: gap
    description: Gap org MCP server on Cloudflare Workers behind Cloudflare Access (LOR-578)
    endpoint: https://gap.airesearches.app/mcp
    enabled: true
  - name: orbstack
    description: OrbStack / kubectl helpers for OSC Gap overlays (read + allowlisted apply)
    endpoint: http://127.0.0.1:9320/mcp
    enabled: true
  - name: tailscale
    description: Tailnet status, Serve status, ACL lint; no secret exfil
    endpoint: http://127.0.0.1:9321/mcp
    enabled: true
```

For interactive IDE clients (Cursor, Claude, Codex) that use Cloudflare Access managed OAuth with dynamic client registration directly, you can also register `gap` alongside `oxidized-mcp` in `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "gap": { "url": "https://gap.airesearches.app/mcp" }
  }
}
```

## Related

- [GAP-ON-ORBSTACK.md](GAP-ON-ORBSTACK.md)
- [EDGE-NETWORK.md](EDGE-NETWORK.md)
- [WEBMCP-CHROMEOS-AGENTS.md](WEBMCP-CHROMEOS-AGENTS.md)
- [OXIDIZEDGRAPH-IPAAS-HOST.md](OXIDIZEDGRAPH-IPAAS-HOST.md)
