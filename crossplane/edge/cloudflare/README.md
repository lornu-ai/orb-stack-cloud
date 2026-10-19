# XCloudflareEdgeIngress (Story 7.4)

Composition resources (via **provider-cloudflare** + **provider-kubernetes**):

1. Cloudflare Tunnel (remote-managed token)
2. DNS CNAME `osc-app.stevedores.org` (per-run CI tunnels: `osc-pr-<run_id>.stevedores.org`; `osc.stevedores.org` is the public hub site, not a tunnel)
3. Zero Trust Access application (optional `accessRequired`)
4. Deployment: `cloudflared` → upstream `http://api-gateway.local-cloud.svc.cluster.local`

Pair with **Tailscale Kubernetes Operator** for the private path (`.ts.net`).

See `xrd-cloudflare-edge-ingress.yaml` and `examples/claim-cloudflare-edge.yaml`.
