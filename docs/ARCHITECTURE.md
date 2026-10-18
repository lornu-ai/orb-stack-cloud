# OrbStack personal cloud — solution architecture (summary)

| Document | Role |
| --- | --- |
| [#1](https://github.com/lornu-ai/orb-stack-cloud/issues/1) | Full platform + workload architecture narrative |
| [#5](https://github.com/lornu-ai/orb-stack-cloud/issues/5) / [EXECUTION_PLAN.md](./EXECUTION_PLAN.md) | **Revised backlog** — Crossplane, Tailscale, Cloudflare (replaces Terraform in #2) |

## Two dimensions

1. **Platform engine (Track A, Epics 1–6)** — Shared-kernel micro-VM, `*.orb.local`, cloud-init,
   Rosetta, WireGuard/TUN for Tailscale, coexistence with Cloudflare WARP (issue #5 §3).
2. **Reference local cloud (Track B, Epic 7)** — Three tiers + **tri-path ingress**:
   local (`.orb.local`), mesh (`.ts.net`), edge (`*.dev.example.com` via Cloudflare Tunnel).

## Topology (issue #5 §1)

Crossplane runs **inside OrbStack Kubernetes** and composes:

- **Tier 1** — K8s microservices, Crossplane providers, `cloudflared`, Tailscale Operator
- **Tier 2** — Rosetta `amd64` Compose + LocalStack (S3/SQS claims via upjet-aws)
- **Tier 3** — Postgres/Vault Linux machines (`cloud-init`, Tailscale on `eth0`)

Public edge (Cloudflare Zero Trust) and remote teammates (Tailscale) attach **above** the
OrbStack virtual VPC; internal routing stays on `.orb.local`.

## IaC

**Crossplane only** — no Terraform state. See [CROSSPLANE.md](./CROSSPLANE.md) and
[IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md).
