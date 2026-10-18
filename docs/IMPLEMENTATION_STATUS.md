# Implementation status vs [issue #5](https://github.com/lornu-ai/orb-stack-cloud/issues/5)

Living tracker for **Track B (Epic 7)** in this repository. Full program backlog:
[EXECUTION_PLAN.md](./EXECUTION_PLAN.md).

## Name mapping (plan → repo)

| Issue #5 term | Repository artifact |
| --- | --- |
| `XOrbMachine` / `OrbMachineClaim` | `XOrbStackMachine` / `OrbStackMachineClaim` (`cloud.orbstack.io/v1alpha1`) |
| `machines.cloud.orb.local` | `crossplane/install/xrd/xorbstackmachine.yaml` |
| Epic 4.2 host bridge | `packages/orbstack-controller` (interim; in-cluster Provider OrbStack TBD) |
| `tier3-stateful-claims.yaml` | `crossplane/examples/claim-local-cloud.yaml`, `claim-postgres-only.yaml` |
| `XEventBus` (LocalStack S3/SQS) | Planned — `provider-upjet-aws` + Composition |
| `XCloudflareEdgeIngress` | Planned — [CLOUDFLARE.md](./CLOUDFLARE.md) |
| Tailscale Operator / expose | Planned — [TAILSCALE.md](./TAILSCALE.md) |

## Epic 7 stories

| Story | Summary | Status | Paths |
| --- | --- | --- | --- |
| **7.1** | Crossplane + providers + XRDs | Partial | Crossplane install, `XOrbStackMachine`, `XLocalCloudStack`; CF/AWS/Helm providers stubbed |
| **7.2** | Tier 3 Postgres/Vault + Tailscale in cloud-init | Partial | `configmaps-cloud-init.yaml`; Tailscale in cloud-init not yet |
| **7.3** | Tier 2 Compose + LocalStack via Crossplane | Partial | `tier2/docker-compose.yml`; `XEventBus` not yet |
| **7.4** | Tier 1 + Tailscale Operator + Cloudflare Tunnel | Partial | `tier1/`; tri-path E2E not yet |

## NFR gates (issue #5 §6)

| Gate | Status |
| --- | --- |
| Crossplane IaC reconciliation (no Terraform) | In progress — local machines + tier1 |
| Tri-path ingress (`.orb.local`, `.ts.net`, CF tunnel) | Not started |
| Track A NFRs (idle CPU, iperf, Rosetta) | OrbStack product — out of repo scope |
