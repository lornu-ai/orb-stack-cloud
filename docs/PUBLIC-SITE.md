# Public site — osc.stevedores.org

| | |
|---|---|
| **URL** | https://osc.stevedores.org |
| **Source repo** | https://github.com/stevedores-org/orb-stack-cloud |
| **IaC (forge)** | `aivcs://aivcs/infra-code-micro@main` |

## Forge paths

- **DNS (Crossplane):** `crossplane/cloudflare/hub/infra/base/dns/stevedores.org/osc-cname.yaml`
- **Workload:** `apps/orb-stack-cloud/base/` (HTTPRoute host `osc.stevedores.org`)
- **Reconciler:** `reconcilers/aivcs-platform/oxidizedflux-orb-stack-cloud.yaml`

Edge HTML is a lightweight hub until CI publishes docs from this repository; Cloudflare Tunnel claims in `examples/claim-cloudflare-edge.yaml` may use other hostnames under your zone.
