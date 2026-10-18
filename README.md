# orb-stack-cloud

Reference **Personal Cloud** blueprint for [OrbStack](https://orbstack.dev) on Apple Silicon.

| Doc | Link |
|-----|------|
| Solution architecture | [Issue #1](https://github.com/lornu-ai/orb-stack-cloud/issues/1) |
| **Execution plan (Crossplane · Tailscale · Cloudflare)** | **[Issue #5](https://github.com/lornu-ai/orb-stack-cloud/issues/5)** |
| Repo implementation map | [docs/EXECUTION-PLAN.md](docs/EXECUTION-PLAN.md) |

**No Terraform.** Crossplane on OrbStack K8s is the IaC control plane; Tailscale is the private mesh; Cloudflare is optional public edge (Tunnel / Zero Trust).

## Tiers (Epic 7)

| Tier | Content | Repo |
|------|---------|------|
| **1** | api-gateway, auth, Crossplane, cloudflared, TS operator | `blueprint/tier1/`, `crossplane/local-cloud/` |
| **2** | amd64 billing + LocalStack; `XEventBus` | `blueprint/tier2/` |
| **3** | Postgres/Vault via `XOrbMachine` + cloud-init + tailscale | `blueprint/tier3-cloudinit/`, `crossplane/orbmachine/` |

## Quick start (interim)

```bash
cd tools/bootstrap-tier3 && bun install
ORB_SSH_PUBKEY='…' TS_AUTHKEY='…' bun run bootstrap
docker compose -f blueprint/tier2/docker-compose.yml up -d
kubectl apply -k blueprint/tier1
```

Claims: [examples/](examples/README.md). Validation: [docs/VALIDATION.md](docs/VALIDATION.md). AWS CLI: **`aws --profile lornu-ai`** ([docs/AWS.md](docs/AWS.md)).

## Docs

- [docs/PLANNING.md](docs/PLANNING.md) · [docs/IAC.md](docs/IAC.md) · [docs/DOD.md](docs/DOD.md) · [docs/EDGE-NETWORK.md](docs/EDGE-NETWORK.md)

Governed by [code-governance](https://github.com/lornu-ai/code-governance) (`.code-governance.toml`).
