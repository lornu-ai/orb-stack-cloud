# Infrastructure as code — Crossplane (not Terraform)

Story 7.1 originally specified **Terraform/OpenTofu** and Ansible. **Crossplane is the only IaC engine** for this program track.

## Mapping

| Legacy (issue #2) | Crossplane |
|-------------------|------------|
| TF module variables | `LocalCloudBlueprintClaim.spec` (+ future `spec.connectivity`) |
| `terraform apply` | Claim reconcile + provider CRs |
| TF Cloudflare provider | `crossplane/edge/cloudflare/` Compositions (planned) |
| TF null_resource / local-exec | **Forbidden** — use Compositions or Bun tools that call stable APIs (`orb`, `tailscale`, CF API via providers) |
| Ansible post-config | Idempotent **cloud-init**; mesh/edge config via Crossplane |

## Installed today

| Resource | Purpose |
|----------|---------|
| `xlocalcloudblueprints.orbstack.lornu.ai` | Composite API |
| `reference-local-cloud` Composition | Tier 1 via **provider-kubernetes** `Object` |
| `ProviderConfig` `orbstack-local` | In-cluster identity |

## Planned providers (edge)

| Provider package | Scope |
|------------------|--------|
| `provider-kubernetes` | Tier 1, in-cluster operators (Tailscale, cloudflared) |
| `provider-cloudflare` (Upjet) | DNS, Tunnel, Access — mirror org `infra-code` layout |
| Tailscale CRDs via operator + optional Crossplane **Object** wrappers | Tailnet exposure for Services |

Secrets: **External Secrets Operator** + vault/GSM paths (same as `orb-code` / fleet); never commit API tokens.

## Tier 3 exception

OrbStack **`orb create`** is a **runtime API**, not a Crossplane provider. Flow:

1. Desired state in git (`blueprint/tier3-cloudinit/`).
2. Optional Claim field `spec.tier3` documents hostnames for mesh/edge.
3. `tools/bootstrap-tier3` renders user-data and invokes `orb create`.

This replaces a hypothetical `terraform-provider-orb` without pretending Terraform state tracks Linux machines.

## Optional: Tier 3 on Kubernetes

`spec.tier3.mode: kubernetes` — Postgres/Vault as in-cluster workloads (CI only). Fully Crossplane-managed when Composition branch lands.
