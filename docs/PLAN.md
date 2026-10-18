# Execution plan (Crossplane track)

Maps [issue #2](https://github.com/lornu-ai/orb-stack-cloud/issues/2) to this repository.
**Track A** (Epics 1–6) is OrbStack product engineering — architecture only in
[ARCHITECTURE.md](./ARCHITECTURE.md). **Track B Epic 7** is implemented here with
Crossplane.

## Phase 1 — Crossplane foundation (this repo)

| Story | Deliverable | Status |
| --- | --- | --- |
| 7.1 Tier 3 Postgres/Vault | `XOrbStackMachine` + cloud-init templates + controller | In repo |
| 7.2 Tier 2 Compose | `tier2/docker-compose.yml` + Crossplane ConfigMap composition | In repo |
| 7.3 Tier 1 K8s | `tier1/` manifests + `XLocalCloudStack` composition | In repo |

## Phase 2 — Hardening (follow-ups)

- Crossplane **Provider** for OrbStack API (replace host `orbstack-controller`).
- Epic 6 isolation: `--isolated` flags on `OrbStackMachine` spec.
- Automated E2E: `https://app.k8s.orb.local/api/v1/checkout` (issue #2 AC).

## Personas → owners

| Persona | Focus in this repo |
| --- | --- |
| `@CloudArch` | XRD/Composition design, cloud-init, claims |
| `@AppDev` | Tier 1/2 app manifests, compose labels |
| `@RuntimeEng` | `orbstack-controller` reconciler |
| `@NetEng` | `.orb.local` DNS assumptions (OrbStack platform) |

## NFR gates (Epic 7 E2E)

When the full stack is up, verify:

- `postgres.orb.local:5432` accepts connections after cloud-init.
- `https://vault.orb.local:8200` (or HTTP dev mode) responds.
- `https://billing.internal.orb.local/health` and LocalStack health URLs return 200.
- `https://app.k8s.orb.local` routes through Tier 1 Ingress (manual until AC automated).
