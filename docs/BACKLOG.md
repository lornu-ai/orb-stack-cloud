# Backlog alignment

Source of truth: **[issue #2](https://github.com/lornu-ai/orb-stack-cloud/issues/2)**.

## In scope (this repository)

| Epic | Stories | Status |
|------|---------|--------|
| **7** | 7.1 Tier 3 cloud-init Postgres/Vault | `blueprint/tier3-cloudinit/`, Crossplane Tier 3 bundle, `tools/bootstrap-tier3` |
| **7** | 7.2 Tier 2 Compose + domains | `blueprint/tier2/docker-compose.yml` |
| **7** | 7.3 Tier 1 K8s gateway/auth | `blueprint/tier1/`, Crossplane claim |
| **8** | Hardening / isolation | Documented guardrails only (initial); no OrbStack `--isolated` engine changes |

## Out of scope (Track A / OrbStack product)

Epics **1–6** (hypervisor, kernel, networking engine, Rosetta integration, menu bar) are implemented inside OrbStack itself, not in this Git repository. Stories there inform acceptance tests but do not produce IaC here.

## Personas

- **@CloudArch** — owns Crossplane XRD/Composition and cloud-init in this repo.
- **@AppDev** — runs Compose/K8s tiers and E2E checks in [VALIDATION.md](VALIDATION.md).
- **@RuntimeEng / @KernelEng / @NetEng** — Track A; consult issue #2 for story ownership.
