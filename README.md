# orb-stack-cloud

Reference **OrbStack “personal cloud”** workload topology (Track B) using **Crossplane**
compositions instead of Terraform. Platform engine work (Track A, Epics 1–6) is
documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); this repo implements
**Epic 7** — three-tier local cloud on OrbStack Kubernetes + Machines + Compose.

## Issues

| Issue | Content |
| --- | --- |
| [#1](https://github.com/lornu-ai/orb-stack-cloud/issues/1) | Solution architecture (OrbStack engine + local cloud topology) |
| [#2](https://github.com/lornu-ai/orb-stack-cloud/issues/2) | Epics / user stories — **Epic 7 delivered here via Crossplane** |

## Crossplane vs Terraform (Epic 7.1)

| Terraform (original plan) | This repo |
| --- | --- |
| `terraform-provider-local` / `orb create` wrapper | **XRD + Composition** → `OrbStackMachine` CRs |
| `terraform apply` | `kubectl apply` **claims**; Crossplane composes child resources |
| Ansible over SSH post-provision | **cloud-init** in machine spec; optional Ansible unchanged |
| K8s manifests in TF | **provider-kubernetes** `Object` resources in Compositions |

## Quick start

1. OrbStack: enable Kubernetes, Docker, Machines (`orb` CLI).
2. Install Crossplane on the OrbStack cluster — [docs/CROSSPLANE.md](docs/CROSSPLANE.md).
3. Install package CRDs + compositions:

```bash
kubectl apply -f crossplane/install/function-patch-and-transform.yaml
kubectl apply -k crossplane/install/crd
kubectl apply -k crossplane/install/xrd
kubectl apply -k crossplane/compositions
kubectl apply -k tier1
```

4. Run the **host controller** (reconciles `OrbStackMachine` → `orb create`):

```bash
cd packages/orbstack-controller && bun install && bun run start
```

5. Claim a full reference stack:

```bash
kubectl apply -f crossplane/examples/claim-local-cloud.yaml
```

6. Tier 2 (Compose) on the Mac host:

```bash
docker compose -f tier2/docker-compose.yml up -d
```

See [docs/PLAN.md](docs/PLAN.md) for phased delivery mapped to issue #2.
