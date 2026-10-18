# orb-stack-cloud

Reference **Personal Cloud** workload blueprint for [OrbStack](https://orbstack.dev) on Apple Silicon — [Track B / Epic 7](https://github.com/lornu-ai/orb-stack-cloud/issues/2), with **Crossplane**, **Tailscale**, and **Cloudflare** instead of Terraform/OpenTofu.

Architecture context: [issue #1](https://github.com/lornu-ai/orb-stack-cloud/issues/1). **Planning SoT:** [docs/PLANNING.md](docs/PLANNING.md).

## Control plane (no Terraform)

| Pillar | Purpose |
|--------|---------|
| **Crossplane** | Declarative Tier 1 + planned Cloudflare/Tailscale Compositions |
| **Tailscale** | Private mesh to Mac, K8s, and Tier 3 admin |
| **Cloudflare** | Optional public DNS, Tunnel, Zero Trust Access |

On-box routing stays OrbStack **`*.orb.local`** / **`*.k8s.orb.local`** (issue #1).

## Three tiers

| Tier | Issue story | This repo |
|------|-------------|-----------|
| **3** | Postgres + Vault Linux machines | `blueprint/tier3-cloudinit/` + `tools/bootstrap-tier3` |
| **2** | amd64 billing + arm64 LocalStack | `blueprint/tier2/docker-compose.yml` |
| **1** | api-gateway + auth-service | `blueprint/tier1/` + `LocalCloudBlueprintClaim` |

## Prerequisites

- OrbStack Kubernetes (`kubectl config use-context orbstack`).
- Crossplane (+ **provider-kubernetes** from this repo; **orb-code** bootstrap recommended).
- Tailscale on the Mac (tailnet); Cloudflare account optional until P2.

## Quick start

```bash
cd tools/bootstrap-tier3 && bun install && ORB_SSH_PUBKEY='…' bun run bootstrap
docker compose -f blueprint/tier2/docker-compose.yml up -d
kubectl apply -k blueprint/tier1
# Or: kubectl apply -f examples/claim-reference-local-cloud.yaml
```

Validation: [docs/VALIDATION.md](docs/VALIDATION.md).

## Docs

- [docs/PLANNING.md](docs/PLANNING.md) — Crossplane + Tailscale + Cloudflare phases
- [docs/IAC.md](docs/IAC.md) — Terraform replacement mapping
- [docs/EDGE-NETWORK.md](docs/EDGE-NETWORK.md) — mesh and public edge
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — tier topology
- [docs/BACKLOG.md](docs/BACKLOG.md) — Epic 7–8 scope
- [docs/ISSUE-REVISIONS.md](docs/ISSUE-REVISIONS.md) — suggested issue #2 edits

Governed by [lornu-ai/code-governance](https://github.com/lornu-ai/code-governance).
