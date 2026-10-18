# Crossplane instead of Terraform (Story 7.1)

## Original design

Story 7.1 called for:

- Terraform/OpenTofu wrapper around `orb create`
- Ansible over `ssh postgres@orb` / `ssh vault@orb`
- cloud-init user-data for Postgres 16 and Vault/Consul on Debian

## Replacement model

| Terraform / Ansible role | Crossplane / repo equivalent |
|--------------------------|----------------------------|
| Module inputs (env, names) | `LocalCloudBlueprintClaim.spec` |
| `terraform apply` creates resources | Claim reconciles **Kubernetes Object** resources (Tier 1) via **provider-kubernetes** |
| User-data templates in module | `blueprint/tier3-cloudinit/*.yaml` + Composition-synced **ConfigMap** `local-cloud/tier3-cloudinit` |
| Provision Linux VMs | **`orb create`** (CLI) — Crossplane does not replace OrbStack’s machine API; `tools/bootstrap-tier3` applies the same user-data the claim publishes |
| Ansible post-config | Idempotent **cloud-init** + optional future Crossplane **Composition** patches on in-cluster Tier 3 **if** Tier 3 runs as Pods (`spec.tier3.mode: kubernetes`) |

## Resources

- **XRD:** `xlocalcloudblueprints.orbstack.lornu.ai`
- **Claim:** `LocalCloudBlueprintClaim`
- **Composition:** `reference-local-cloud` (Pipeline + patch-and-transform + kubernetes `Object`)

## Provider

**provider-kubernetes** with `ProviderConfig` `orbstack-local` (`InjectedIdentity`) targets the integrated OrbStack cluster — the same cluster where Tier 1 runs.

## Optional: Tier 3 on Kubernetes

Set `spec.tier3.mode: kubernetes` on the claim to deploy dev Postgres/Vault Helm-style manifests from `blueprint/tier3-k8s/` (no `orb create`). DNS then uses in-cluster Services + ExternalName patterns; use for CI without Linux machines.
