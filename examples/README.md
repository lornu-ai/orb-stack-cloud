# Crossplane claim examples (issue #5)

| File | Story | Apply when |
|------|-------|------------|
| `claim-reference-local-cloud.yaml` | 7.4 (Tier 1 baseline) | `crossplane/local-cloud` installed |
| `tier3-stateful-claims.yaml` | 7.2 | `XOrbMachine` + Epic 4.2 bridge — else use `tools/bootstrap-tier3` |
| `tier2-event-bus-claim.yaml` | 7.3 | LocalStack up + `provider-aws` + `aws-localstack` ProviderConfig |
| `claim-cloudflare-edge.yaml` | 7.4 edge | `provider-cloudflare` + compositions |

Planning XRDs under `crossplane/orbmachine/`, `crossplane/localstack/`, `crossplane/edge/cloudflare/` are labeled `orbstack.lornu.ai/status: planning` — not wired into active kustomize until implementations land.
