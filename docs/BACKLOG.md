# Backlog alignment

Source: **[issue #2](https://github.com/lornu-ai/orb-stack-cloud/issues/2)** — revised for **Crossplane + Tailscale + Cloudflare** ([ISSUE-REVISIONS.md](ISSUE-REVISIONS.md)).

## In scope

| Epic | Stories | Delivery | Phase |
|------|---------|----------|-------|
| **7** | 7.1 Tier 3 cloud-init | `blueprint/tier3-cloudinit/`, `tools/bootstrap-tier3`, Crossplane claim | P0 |
| **7** | 7.2 Tier 2 Compose | `blueprint/tier2/docker-compose.yml` | P0 |
| **7** | 7.3 Tier 1 K8s | `blueprint/tier1/`, `LocalCloudBlueprintClaim` | P0 |
| **7** | 7.4 Mesh + edge IaC (proposed) | `spec.connectivity`, `crossplane/edge/` | P1–P2 |
| **8** | Hardening | Tailnet ACLs, CF Access, no public stateful ports | P3 |

## Explicitly retired from planning

- Terraform / OpenTofu modules and state
- Ansible playbooks as provisioning SoT
- Manual-only Cloudflare dashboard workflows for environments covered by this blueprint

## Personas

- **@CloudArch** — Crossplane Compositions (K8s, Cloudflare, Tailscale wiring).
- **@NetEng** — tailnet routes, Tunnel origins, Access policies.
- **@AppDev** — tier runbooks and [VALIDATION.md](VALIDATION.md).
- **Track A engineers** — OrbStack product (Epics 1–6); out of repo.
