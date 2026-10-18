# Backlog alignment

| Document | Role |
|----------|------|
| **[Issue #5](https://github.com/lornu-ai/orb-stack-cloud/issues/5)** | **Current** execution plan (Crossplane, Tailscale, Cloudflare) |
| [Issue #2](https://github.com/lornu-ai/orb-stack-cloud/issues/2) | Original Terraform-centric plan (superseded for IaC) |
| [Issue #1](https://github.com/lornu-ai/orb-stack-cloud/issues/1) | Solution architecture |

## Track B — in this repository

| Epic | Stories | Repo |
|------|---------|------|
| **7** | 7.1 Crossplane + XRDs | `crossplane/` |
| **7** | 7.2 Tier 3 + Tailscale | `blueprint/tier3-cloudinit/`, `examples/tier3-stateful-claims.yaml` |
| **7** | 7.3 Tier 2 + LocalStack CRs | `blueprint/tier2/`, `examples/tier2-event-bus-claim.yaml` |
| **7** | 7.4 Tier 1 + edge/mesh | `blueprint/tier1/`, `crossplane/edge/`, claim `spec.connectivity` |

## Track A — OrbStack product (Epics 1–6)

Kernel, VirtioFS, Rosetta, DNS mesh, Epic **4.2** host provisioning bridge, menu bar — **not implemented in git**. Required before full **7.1 `XOrbMachine`** reconciliation.

## Retired

- Terraform / OpenTofu / Ansible as provisioning SoT

See [EXECUTION-PLAN.md](EXECUTION-PLAN.md) for story-level status.
