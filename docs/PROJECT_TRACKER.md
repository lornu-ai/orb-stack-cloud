# Project tracker — orb-stack-cloud

Central index for **architecture**, **delivery**, **CI**, and **open work** on
[github.com/stevedores-org/orb-stack-cloud](https://github.com/stevedores-org/orb-stack-cloud).

## Active pull request

| PR | Branch | Scope |
| --- | --- | --- |
| [#3](https://github.com/stevedores-org/orb-stack-cloud/pull/3) | `feat/crossplane-epic7` | Epic 7 Crossplane stack + docs + GHA CI |

> [#4](https://github.com/stevedores-org/orb-stack-cloud/pull/4) is a parallel blueprint branch — consolidate into #3 before merge.

## GitHub issues map

| Issue | Role | Repo artifacts |
| --- | --- | --- |
| [#1](https://github.com/stevedores-org/orb-stack-cloud/issues/1) | Solution architecture (OrbStack engine) | [ARCHITECTURE.md](./ARCHITECTURE.md) (summary) |
| [#2](https://github.com/stevedores-org/orb-stack-cloud/issues/2) | Original epics (Terraform era) | Superseded for IaC by **#5** |
| [#5](https://github.com/stevedores-org/orb-stack-cloud/issues/5) | **Canonical execution plan** (Crossplane, TS, CF) | [EXECUTION_PLAN.md](./EXECUTION_PLAN.md) |
| [#6](https://github.com/stevedores-org/orb-stack-cloud/issues/6) | Testing & verification architecture | [CI.md](./CI.md) (Tier 1 partial) |
| [#7](https://github.com/stevedores-org/orb-stack-cloud/issues/7) | Multi-cloud CI/CD build-out epics | GHA workflow; T1–T6 mostly planned |
| [#8](https://github.com/stevedores-org/orb-stack-cloud/issues/8) | Google Stitch init | [`web/`](../web/) · **`osc.stevedores.org`** in [`iac/`](../iac/) |

## Delivery status (Epic 7 — issue #5)

Detail: [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md)

| Story | Status |
| --- | --- |
| 7.1 Crossplane + XRDs | Partial |
| 7.2 Tier 3 + Tailscale cloud-init | Partial |
| 7.3 Tier 2 + LocalStack Crossplane | Partial (Compose + GHA LocalStack only) |
| 7.4 Tri-path ingress | Not started |

## CI status (issues #6–#7)

Detail: [CI.md](./CI.md) · Workflow: [ci.yml](../.github/workflows/ci.yml)

| Epic (issue #7) | Implemented in repo |
| --- | --- |
| **T2** Shift-left validate | Yes — `bun run ci:validate` |
| **T5.1** AWS parity smoke | Partial — LocalStack + optional live `lornu-ai` readonly |
| **T4.3** Cloudflare | Partial — token verify only |
| **T5.2** GCP | Partial — project get when secrets set |
| **T1** OIDC / Mac metal / T3–T6 | Planned per #6–#7 |

## Changelog

[CHANGELOG.md](../CHANGELOG.md)

## How to update this tracker

1. Merge or refresh [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md) when a story lands.
2. Append [CHANGELOG.md](../CHANGELOG.md) under `[Unreleased]`.
3. Comment on the linked GitHub issue with PR/commit SHA and checkboxes.
