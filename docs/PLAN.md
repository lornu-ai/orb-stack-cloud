# Execution plan index

The **authoritative program backlog** (Crossplane, Tailscale, Cloudflare — no Terraform) is
**[EXECUTION_PLAN.md](./EXECUTION_PLAN.md)**, mirrored from
[issue #5](https://github.com/stevedores-org/orb-stack-cloud/issues/5).

| Document | Purpose |
| --- | --- |
| [EXECUTION_PLAN.md](./EXECUTION_PLAN.md) | Full revised epics, stories, roadmap, NFR gates |
| [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) | What exists in *this repo* vs Epic 7.1–7.4 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Short topology summary + links |
| [CROSSPLANE.md](./CROSSPLANE.md) | Install Crossplane and provider matrix |
| [TAILSCALE.md](./TAILSCALE.md) | Tailnet + Operator plan (Story 7.4) |
| [CLOUDFLARE.md](./CLOUDFLARE.md) | Zero Trust Tunnel / DNS plan (Story 7.4) |

## Issue lineage

- **[#1](https://github.com/stevedores-org/orb-stack-cloud/issues/1)** — Platform engine + local cloud architecture narrative.
- **[#2](https://github.com/stevedores-org/orb-stack-cloud/issues/2)** — Original Agile epics (Terraform/OpenTofu in Track B).
- **[#5](https://github.com/stevedores-org/orb-stack-cloud/issues/5)** — **Supersedes #2 for IaC and ingress** (Crossplane + Tailscale + Cloudflare).

Track A (Epics 1–6) is OrbStack product work. Track B (Epic 7) is implemented declaratively in this repository.

## Phase 4 delivery focus (repo)

From issue #5 §5, Phase 4 stories map to repository work:

| Story | Focus |
| --- | --- |
| 7.1 | Providers: kubernetes, helm, upjet-aws→LocalStack, cloudflare; XRDs |
| 7.2 | Tier 3 cloud-init + Tailscale enrollment on machines |
| 7.3 | `tier2/docker-compose.yml` + `XEventBus` Composition |
| 7.4 | `tier1/` + Tailscale Operator + `XCloudflareEdgeIngress` + tri-path E2E |

See [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) for current completion.
