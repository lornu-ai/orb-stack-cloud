# Engineering execution plan (Crossplane · Tailscale · Cloudflare)

**Canonical backlog:** GitHub **[issue #5](https://github.com/stevedores-org/orb-stack-cloud/issues/5)** (replaces Terraform-centric **[issue #2](https://github.com/stevedores-org/orb-stack-cloud/issues/2)** for IaC and edge/mesh scope).

**Architecture narrative:** **[issue #1](https://github.com/stevedores-org/orb-stack-cloud/issues/1)**.

This file is the **repo implementation map** — what lives in git today vs OrbStack product (Track A) vs Phase 4 Crossplane extensions.

## Topology (summary)

Crossplane runs on the integrated OrbStack Kubernetes cluster. Claims provision:

- **Tier 3** — `XOrbMachine` + cloud-init (Postgres, Vault, `tailscaled`) — *host bridge Epic 4.2 pending*
- **Tier 2** — Docker Compose + `XEventBus` → LocalStack via **provider-upjet-aws**
- **Tier 1** — Gateway/auth + **Tailscale Operator** + **XCloudflareEdgeIngress** (`cloudflared`)

Public edge: Cloudflare Zero Trust → Tunnel → cluster. Private: Tailscale MagicDNS (`*.ts.net`). Local: `*.orb.local` / `*.k8s.orb.local`.

See the ASCII diagram in issue #5 §1.

## Implementation status

| Story | Summary | Repo path | Status |
|-------|---------|-----------|--------|
| **7.1** | Crossplane + providers + XRDs | `crossplane/providers/`, `crossplane/orbmachine/`, `crossplane/localstack/`, `crossplane/edge/cloudflare/` | **Partial** — kubernetes live; others scaffolded |
| **7.2** | Tier 3 Postgres/Vault + Tailscale | `blueprint/tier3-cloudinit/`, `examples/tier3-stateful-claims.yaml`, `tools/bootstrap-tier3` | **Partial** — bootstrap via `orb create` until `XOrbMachine` bridge |
| **7.3** | Tier 2 + LocalStack AWS CRs | `blueprint/tier2/`, `examples/tier2-event-bus-claim.yaml` | **Partial** — Compose live; AWS CRs scaffolded |
| **7.4** | Tier 1 + TS operator + CF edge | `blueprint/tier1/`, `LocalCloudBlueprintClaim`, `crossplane/edge/` | **Partial** — Tier 1 live; edge P1–P2 |
| **4.2** | Crossplane ↔ `orb create` bridge | OrbStack product + future provider | **Not in repo** |
| **Track A** | Epics 1–6 | OrbStack binary | **Out of repo** |

## Personas

Same as issue #5 §2: `@KernelEng`, `@NetEng`, `@RuntimeEng`, `@CloudArch`, `@AppDev`.

## Release phases

Issue #5 §5 — four phases from micro-VM/kernel through Crossplane blueprint. **This repo delivers Phase 4 artifacts** incrementally; Phases 1–3 are OrbStack engine prerequisites.

## Definition of Done

See [DOD.md](DOD.md) for program NFRs (idle CPU, boot time, tri-path ingress, Terraform-free reconciliation).

## Related docs

- [PLANNING.md](PLANNING.md) — three-pillar control plane
- [IAC.md](IAC.md) — Terraform replacement
- [EDGE-NETWORK.md](EDGE-NETWORK.md) — Tailscale + Cloudflare detail
- [VALIDATION.md](VALIDATION.md) — acceptance commands
