# Crossplane providers (Story 7.1)

Target provider set on OrbStack Kubernetes — **no Terraform**.

| Provider | Package (indicative) | Purpose | Status |
|----------|----------------------|---------|--------|
| **provider-kubernetes** | `crossplane-contrib/provider-kubernetes` | Tier 1 Objects, operators | In repo |
| **provider-helm** | `crossplane-contrib/provider-helm` | Tailscale operator, cloudflared chart | Planned |
| **provider-upjet-aws** | `upbound/provider-aws-*` | S3/SQS on LocalStack endpoints | Planned — see `providerconfig/aws-localstack.yaml` |
| **provider-cloudflare** | `upbound/provider-cloudflare` | Tunnel, DNS, Access | Planned — see `../edge/cloudflare/` |
| **provider-orb** (custom) | TBD | Epic 4.2 `orb create` bridge → `XOrbMachine` | Blocked on OrbStack API |

Install order: Crossplane core → functions (`patch-and-transform`) → providers → `ProviderConfig` → XRDs/Compositions.

Secrets: ESO only (`cloudflare-api-token`, `tailscale-oauth`, `TS_AUTHKEY` for cloud-init — never in git).

**AWS CLI (developers):** `aws --profile lornu-ai` — see [docs/AWS.md](../../docs/AWS.md).
