# orb-stack-cloud

Reference **Personal Cloud** workload blueprint for [OrbStack](https://orbstack.dev) on Apple Silicon — implementing [Track B / Epic 7](https://github.com/lornu-ai/orb-stack-cloud/issues/2) from the program backlog, with **Crossplane** (and GitOps) instead of Terraform/OpenTofu.

Solution architecture context lives in [issue #1](https://github.com/lornu-ai/orb-stack-cloud/issues/1); execution stories in [issue #2](https://github.com/lornu-ai/orb-stack-cloud/issues/2). Track A (OrbStack engine) is product scope; **this repo is Track B only**.

## Three tiers

| Tier | Issue story | This repo |
|------|-------------|-----------|
| **3** | Postgres + Vault Linux machines (`*.orb.local`) | `blueprint/tier3-cloudinit/` + Crossplane bundle; bootstrap via `tools/bootstrap-tier3` (replaces `terraform apply` / TF wrapper) |
| **2** | amd64 billing + arm64 LocalStack (Compose) | `blueprint/tier2/docker-compose.yml`; optional K8s mirror under `blueprint/tier2/k8s/` |
| **1** | api-gateway + auth-service on integrated K8s | `blueprint/tier1/` + Crossplane `LocalCloudBlueprintClaim` |

## Crossplane vs Terraform

Story 7.1 originally specified Terraform/OpenTofu around `orb create`. Here:

- **`LocalCloudBlueprintClaim`** (`orbstack.lornu.ai/v1alpha1`) drives a **Composition** that materializes Tier 1 on the cluster and publishes Tier 3 **cloud-init** bundles as in-cluster ConfigMaps.
- **Tier 3 machines** are still created with `orb create … -c <userdata>` (OrbStack API); a Bun CLI reads the same YAML the claim syncs. See [docs/CROSSPLANE.md](docs/CROSSPLANE.md).

## Prerequisites

- OrbStack with Kubernetes enabled (`kubectl config use-context orbstack`).
- Crossplane on the cluster — either bootstrap [lornu-ai/orb-code](https://github.com/lornu-ai/orb-code) `clusters/orbstack-local` (recommended) or install core + `crossplane/providers` from this repo.
- **provider-kubernetes** (included under `crossplane/providers/`).

## Quick start

```bash
# Tier 3 Linux machines (after cloud-init YAML is on disk)
cd tools/bootstrap-tier3 && bun install && bun run bootstrap

# Tier 2
docker compose -f blueprint/tier2/docker-compose.yml up -d

# Tier 1 via kubectl
kubectl apply -k blueprint/tier1

# Or declarative Crossplane claim (Tier 1 + Tier 3 bundle sync)
kubectl apply -f examples/claim-reference-local-cloud.yaml
kubectl wait --for=condition=Ready localcloudblueprintclaims/reference-local-cloud --timeout=5m
```

End-to-end validation: [docs/VALIDATION.md](docs/VALIDATION.md).

## GitOps (Flux on OrbStack)

`clusters/orbstack-local/` holds Flux `Kustomization` stubs meant to be wired when this repo is the Flux source (same pattern as `orb-code`). Compositions live in `crossplane/local-cloud/`.

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — condensed Part 2 topology from issue #1
- [docs/BACKLOG.md](docs/BACKLOG.md) — Epic 7 scope and out-of-repo Track A
- [docs/CROSSPLANE.md](docs/CROSSPLANE.md) — IaC mapping (TF → Crossplane)

Governed by [lornu-ai/code-governance](https://github.com/lornu-ai/code-governance) (see `.code-governance.toml`).
