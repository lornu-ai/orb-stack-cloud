# Edge Compositions (planned)

Crossplane-managed **Cloudflare** and **Tailscale** resources for orb-stack-cloud. No Terraform.

| Directory | Phase | Contents |
|-----------|-------|----------|
| `cloudflare/` | P2 | XRDs/Compositions: Tunnel, DNS, Access (Upjet provider-cloudflare) |
| `tailscale/` | P1 | Operator install + Composition wiring from `spec.connectivity.tailscale` |

Until P1/P2 land, use [docs/EDGE-NETWORK.md](../../docs/EDGE-NETWORK.md) for manual tailnet + optional `cloudflared` bootstrap.

Secrets: External Secrets Operator only — see `orb-code` ESO patterns.
