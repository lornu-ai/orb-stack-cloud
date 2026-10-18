# orb-stack-cloud

Reference **Personal Cloud** blueprint for [OrbStack](https://orbstack.dev) on Apple Silicon.

| Doc | Link |
|-----|------|
| **Public hub** | **https://osc.stevedores.org** ([IaC](docs/PUBLIC-SITE.md)) |
| Solution architecture | [Issue #1](https://github.com/stevedores-org/orb-stack-cloud/issues/1) |
| **Execution plan (Crossplane · Tailscale · Cloudflare)** | **[Issue #5](https://github.com/stevedores-org/orb-stack-cloud/issues/5)** |
| Repo implementation map | [docs/EXECUTION-PLAN.md](docs/EXECUTION-PLAN.md) |
| **Gap on 3× Apple Silicon Macs** | **[docs/GAP-ON-ORBSTACK.md](docs/GAP-ON-ORBSTACK.md)** |
| **WebMCP + ChromeOS agents** | **[docs/WEBMCP-CHROMEOS-AGENTS.md](docs/WEBMCP-CHROMEOS-AGENTS.md)** |

**No Terraform.** Crossplane on OrbStack K8s is the IaC control plane; Tailscale is the private mesh; Cloudflare is optional public edge (Tunnel / Zero Trust).

## Gap app (Release 0)

Gap (`lornu-ai/gap`) **gap-hub** deploys on this OrbStack cluster on each of the three Macs:

```bash
kubectl apply -k blueprint/gap/overlays/mac-a   # primary hub
kubectl apply -k blueprint/gap/overlays/mac-b   # satellite
kubectl apply -k blueprint/gap/overlays/mac-c   # satellite
```

Private: `gap.k8s.orb.local`. Public `/ws` stays off until Gap LOR-545.

### WebMCP + ChromeOS (browser-native agents)

Complementary to Mac OrbStack and iOS voice: Gap web exposes **WebMCP** in-tab tools; ChromeOS Crostini runs **chrome-devtools-mcp** for the CDP QA loop. Blueprint: [`blueprint/webmcp-chromeos/`](blueprint/webmcp-chromeos/). Skill mesh attach: [stevedores-org/oxidizedMCP](https://github.com/stevedores-org/oxidizedMCP). Linear: [LOR-594](https://linear.app/lornu-ai/issue/LOR-594).

## Tiers (Epic 7)

| Tier | Content | Repo |
|------|---------|------|
| **1** | api-gateway, auth, Crossplane, cloudflared, TS operator | `blueprint/tier1/`, `crossplane/local-cloud/` |
| **2** | amd64 billing + LocalStack; `XEventBus` | `blueprint/tier2/` |
| **3** | Postgres/Vault via `XOrbMachine` + cloud-init + tailscale | `blueprint/tier3-cloudinit/`, `crossplane/orbmachine/` |
| **Gap** | gap-hub sync plane | `blueprint/gap/` |
| **WebMCP** | ChromeOS / browser agents (docs + Crostini bridge) | `blueprint/webmcp-chromeos/` |

## Quick start (interim)

```bash
cd tools/bootstrap-tier3 && bun install
ORB_SSH_PUBKEY='…' TS_AUTHKEY='…' bun run bootstrap
docker compose -f blueprint/tier2/docker-compose.yml up -d
kubectl apply -k blueprint/tier1
kubectl apply -k blueprint/gap/overlays/mac-a
```

Claims: [examples/](examples/README.md). Validation: [docs/VALIDATION.md](docs/VALIDATION.md). AWS CLI: **`aws --profile lornu-ai`** ([docs/AWS.md](docs/AWS.md)).

## Docs

- [docs/PLANNING.md](docs/PLANNING.md) · [docs/IAC.md](docs/IAC.md) · [docs/GAP-ON-ORBSTACK.md](docs/GAP-ON-ORBSTACK.md) · [docs/WEBMCP-CHROMEOS-AGENTS.md](docs/WEBMCP-CHROMEOS-AGENTS.md) · [docs/DOD.md](docs/DOD.md) · [docs/EDGE-NETWORK.md](docs/EDGE-NETWORK.md)

Governed by [code-governance](https://github.com/lornu-ai/code-governance) (`.code-governance.toml`).
