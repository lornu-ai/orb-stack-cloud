# orb-stack-cloud

**Home:** [stevedores-org/orb-stack-cloud](https://github.com/stevedores-org/orb-stack-cloud) · [docs/REPOSITORY.md](docs/REPOSITORY.md)

Reference **OrbStack “personal cloud”** using **Crossplane** (IaC), **Tailscale** (tailnet),
and **Cloudflare** (Tunnels / Zero Trust / DNS) — **not Terraform/OpenTofu**.

## Issues & docs

| Item | Link |
| --- | --- |
| Solution architecture | [#1](https://github.com/stevedores-org/orb-stack-cloud/issues/1) |
| Original epics (superseded for IaC) | [#2](https://github.com/stevedores-org/orb-stack-cloud/issues/2) |
| **Revised execution plan (canonical)** | [#5](https://github.com/stevedores-org/orb-stack-cloud/issues/5) → [docs/EXECUTION_PLAN.md](docs/EXECUTION_PLAN.md) |
| Implementation status | [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) |
| Project tracker & changelog | [docs/PROJECT_TRACKER.md](docs/PROJECT_TRACKER.md) · [CHANGELOG.md](CHANGELOG.md) |
| Testing / CI (#6–#7) | [docs/CI.md](docs/CI.md) |

Track A (Epics 1–6) is OrbStack product engineering. **Track B Epic 7** (three-tier stack +
mesh + edge) is built here via Crossplane claims and compositions.

## Stack

| Concern | Tool |
| --- | --- |
| Declarative IaC | **Crossplane** on OrbStack Kubernetes |
| Tier 3 machines | `XOrbStackMachine` + `orbstack-controller` → `orb create` + cloud-init |
| Tier 2 | Docker Compose + **provider-upjet-aws** → LocalStack (planned) |
| Tier 1 | Kubernetes manifests + Ingress |
| Private access | **Tailscale** Operator / MagicDNS |
| Public edge | **Cloudflare** Tunnel (`cloudflared`) + DNS |

## Quick start (Phase 1 — local)

1. OrbStack: Kubernetes, Docker, Machines (`orb` CLI).
2. [docs/CROSSPLANE.md](docs/CROSSPLANE.md) — install Crossplane + function-patch-and-transform.
3. Apply packages:

```bash
kubectl apply -f crossplane/install/function-patch-and-transform.yaml
kubectl apply -k crossplane/install/crd
kubectl apply -k crossplane/install/xrd
kubectl apply -k crossplane/compositions
kubectl apply -k tier1
```

4. Host controller: `cd packages/orbstack-controller && bun install && bun run start`
5. Claims: `kubectl apply -f crossplane/examples/tier3-stateful-claims.yaml`
6. Compose: `docker compose -f tier2/docker-compose.yml up -d`

Phases 2–4 (Tailscale enrollment, LocalStack XRDs, Cloudflare edge, tri-path E2E) are defined in
[docs/EXECUTION_PLAN.md](docs/EXECUTION_PLAN.md).

**CI:** GitHub Actions validates manifests and runs **LocalStack (AWS)**, **Cloudflare**, and **GCP** smoke tests — [docs/CI.md](docs/CI.md).

**OSC UI (Stitch):** [web/](web/) · prod edge **`osc.stevedores.org`** — [iac/](iac/) · [k8s/overlays/prod-stevedores](k8s/overlays/prod-stevedores) · local [orbstack-local](k8s/overlays/orbstack-local).
