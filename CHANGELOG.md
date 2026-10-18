# Changelog

All notable changes to [stevedores-org/orb-stack-cloud](https://github.com/stevedores-org/orb-stack-cloud) are tracked here.
Program backlog: [issue #5](https://github.com/stevedores-org/orb-stack-cloud/issues/5). CI/testing: [issues #6–#7](https://github.com/stevedores-org/orb-stack-cloud/issues/6).

## [Unreleased] — branch `feat/crossplane-epic7` ([PR #3](https://github.com/stevedores-org/orb-stack-cloud/pull/3))

### Added
- **Google Stitch UI** — `web/` React control plane (`osc.k8s.orb.local` / **`osc.stevedores.org`**).
- **IaC** — `iac/domains/stevedores.yaml` + Crossplane `osc-stevedores-edge-claim.yaml`.
- **Kustomize** — `k8s/base` + overlays `orbstack-local` and `prod-stevedores` (HTTPRoute + CF edge claim).
- Crossplane Epic 7 reference stack: XRDs, compositions, cloud-init ConfigMaps, `OrbStackMachine` CRD.
- Bun `orbstack-controller` reconciling machines via `orb create`.
- Tier 1 K8s manifests (`api-gateway`, `auth-service`) and Tier 2 `docker-compose.yml` (Rosetta amd64 + LocalStack).
- Docs: `EXECUTION_PLAN.md` (mirrors #5), `ARCHITECTURE.md`, `PLAN.md`, `CROSSPLANE.md`, `TAILSCALE.md`, `CLOUDFLARE.md`.
- GitHub Actions [`.github/workflows/ci.yml`](.github/workflows/ci.yml): manifest validation, AWS (`aws --profile lornu-ai` + LocalStack), optional live AWS readonly, Cloudflare token smoke, GCP project smoke.
- `docs/CI.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/PROJECT_TRACKER.md`.
- Examples: `tier3-stateful-claims.yaml`, provider install stubs (helm, cloudflare, upjet-aws).

### Changed
- IaC direction: **Crossplane + Tailscale + Cloudflare** replaces Terraform/OpenTofu ([issue #5](https://github.com/stevedores-org/orb-stack-cloud/issues/5) supersedes #2 Track B IaC).
- AWS CI uses **`aws --profile lornu-ai`** for all CLI smoke tests.

### Not yet (see [IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md))
- `XEventBus`, `XCloudflareEdgeIngress`, Tailscale Operator manifests, tri-path E2E, mac2 metal self-hosted runners (#6–#7).

## [0.1.0] — 2026-10-18

### Changed
- Repository canonical URL: **stevedores-org/orb-stack-cloud** (migrated from `lornu-ai/orb-stack-cloud`).

## [0.0.0] — 2026-10-18

- Initial repository (LICENSE only on `main`).
