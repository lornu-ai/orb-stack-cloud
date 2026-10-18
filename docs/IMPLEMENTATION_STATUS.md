# Implementation status

**Tracker hub:** [PROJECT_TRACKER.md](./PROJECT_TRACKER.md) · **Changelog:** [CHANGELOG.md](../CHANGELOG.md)

| Source | Document |
| --- | --- |
| [Issue #5](https://github.com/stevedores-org/orb-stack-cloud/issues/5) Epic 7 | [EXECUTION_PLAN.md](./EXECUTION_PLAN.md) |
| [Issues #6–#7](https://github.com/stevedores-org/orb-stack-cloud/issues/6) CI/testing | [CI.md](./CI.md) |

## Name mapping (plan → repo)

| Issue #5 term | Repository artifact |
| --- | --- |
| `XOrbMachine` / `OrbMachineClaim` | `XOrbStackMachine` / `OrbStackMachineClaim` |
| Epic 4.2 host bridge | `packages/orbstack-controller` |
| `tier3-stateful-claims.yaml` | `crossplane/examples/tier3-stateful-claims.yaml` |
| `XEventBus` | Planned |
| `XCloudflareEdgeIngress` | Planned — [CLOUDFLARE.md](./CLOUDFLARE.md) |
| Tailscale Operator | Planned — [TAILSCALE.md](./TAILSCALE.md) |

## Epic 7 (issue #5)

| Story | Status | Evidence |
| --- | --- | --- |
| **7.1** Crossplane + providers | Partial | `crossplane/install/*`, compositions, provider stubs |
| **7.2** Tier 3 + Tailscale | Partial | `configmaps-cloud-init.yaml`; no `tailscale` in cloud-init yet |
| **7.3** Tier 2 + LocalStack | Partial | `tier2/docker-compose.yml`; GHA LocalStack + `aws --profile lornu-ai` |
| **7.4** Tri-path ingress | Not started | `tier1/` only |

## Testing epics (issues #6–#7)

| Story | Status | Evidence |
| --- | --- | --- |
| **T2.1–T2.2** Shift-left | Partial | `scripts/validate-manifests.ts`, GHA `validate` job |
| **T5.1** AWS (LocalStack vs live) | Partial | GHA `aws-localstack` + optional `aws-profile` (readonly) |
| **T4.3 / CF** | Partial | GHA `cloudflare` token verify |
| **T5.2 / GCP** | Partial | GHA `gcp` when secrets set |
| **T1, T3, T4.1–T4.2, T6** | Not started | Requires mac2 metal runner, Crossplane E2E, Tailscale probe |

## NFR gates (issue #5 §6)

| Gate | Status |
| --- | --- |
| Crossplane IaC (no Terraform) | In progress |
| Tri-path ingress | Not started |
| Track A hardware NFRs | OrbStack product / #6 Tier 2 |

*Last updated: 2026-10-18 — PR [#3](https://github.com/stevedores-org/orb-stack-cloud/pull/3) @ `feat/crossplane-epic7`.*
