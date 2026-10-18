# Edge & mesh (Story 7.4)

| Path | Technology | Repo |
|------|------------|------|
| Local | OrbStack Ingress `*.k8s.orb.local` | `blueprint/tier1/` |
| Private | **Tailscale Kubernetes Operator** | `blueprint/edge/tailscale/`, claim `spec.connectivity.tailscale` |
| Public | **Cloudflare Tunnel + Access** | `edge/cloudflare/` — `XCloudflareEdgeIngress` |

Planning XRD: `cloudflare/xrd-cloudflare-edge-ingress.yaml`.

Do not apply planning XRDs until `provider-cloudflare` and compositions are wired — see [docs/EXECUTION-PLAN.md](../../docs/EXECUTION-PLAN.md).
