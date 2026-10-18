# Tier 3 on Kubernetes (optional)

When `LocalCloudBlueprintClaim.spec.tier3.mode` is `kubernetes`, run dev-grade Postgres/Vault inside the cluster instead of `orb create` machines. Suitable for CI without Linux machine support.

Manifests are intentionally minimal; production-like tuning belongs in Tier 3 cloud-init machines.

Future: extend `composition-local-cloud.yaml` with a Pipeline branch keyed on `spec.tier3.mode`.
