# Infrastructure as code — Crossplane only

Canonical stories: **[issue #5](https://github.com/lornu-ai/orb-stack-cloud/issues/5)** Epic 7.

## Terraform → Crossplane

| Legacy | Crossplane |
|--------|------------|
| TF modules / state | Claims + Compositions |
| `terraform apply` (VMs) | `OrbMachineClaim` → Epic 4.2 bridge → `orb create` |
| TF AWS provider | `EventBusClaim` + `provider-upjet-aws` → LocalStack |
| TF Cloudflare | `CloudflareEdgeIngressClaim` + `provider-cloudflare` |
| Ansible | cloud-init + operator reconciliation |

## Provider matrix (Story 7.1)

See [crossplane/providers/README.md](../crossplane/providers/README.md).

## Implemented vs planning

| Resource | Status |
|----------|--------|
| `LocalCloudBlueprintClaim` + `reference-local-cloud` | Active |
| `OrbMachineClaim` | Planning — use `tools/bootstrap-tier3` |
| `EventBusClaim` | Planning — LocalStack + AWS providers |
| `CloudflareEdgeIngressClaim` | Planning |

Active kustomize: `crossplane/local-cloud`, `crossplane/providers/provider-kubernetes.yaml` only. Planning XRDs are **not** in root `crossplane/kustomization.yaml` until reconcilers exist.

## Tier 3 interim

```bash
ORB_SSH_PUBKEY='…' TS_AUTHKEY='…' bun run bootstrap   # tools/bootstrap-tier3
```

`TS_AUTHKEY` enrolls machines on the tailnet (Story 7.2).
