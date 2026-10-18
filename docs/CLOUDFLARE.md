# Cloudflare — Zero Trust edge (issue #5)

Covers **Story 3.4** (WARP coexistence on macOS), **Story 4.1** (`cloudflared` in cloud-init),
and **Story 7.4** (`XCloudflareEdgeIngress` + tri-path public ingress).

## Roles

| Component | Role |
| --- | --- |
| **provider-cloudflare** | DNS for **`osc.stevedores.org`** (see [iac/domains/stevedores.yaml](../iac/domains/stevedores.yaml)) |
| **cloudflared** | Connector in K8s (Composition) or on Mac; routes to `api-gateway` Service |
| **Zero Trust** | Access policies for webhook testing without opening home ports |

## Story 7.4 acceptance (public path)

Given full stack on Apple Silicon, HTTPS checkout via **`https://app-<dev>.dev.example.com`**
must traverse: Cloudflare edge → Tunnel → K8s `api-gateway` → `vault.orb.local` →
`billing.internal.orb.local` (Rosetta amd64) → Crossplane-provisioned LocalStack SQS →
`postgres.orb.local` → **HTTP 200**.

## Crossplane composition (planned)

**`XCloudflareEdgeIngress`** (issue #5 name):

1. Tunnel + DNS via provider-cloudflare
2. `cloudflared` Deployment via provider-kubernetes or provider-helm
3. Parameter: `originUrl` → `http://api-gateway.local-cloud-apps.svc.cluster.local`

## Secrets

- `CF_API_TOKEN` in ProviderConfig Secret
- Tunnel credentials for cloudflared pod

Stub: `crossplane/install/provider-cloudflare.yaml`

## Tri-path summary

| Path | URL pattern |
| --- | --- |
| Local | `https://app.k8s.orb.local` |
| Tailnet | `https://orb-api-gateway.<tailnet>.ts.net` |
| Public | `https://osc.stevedores.org` · PR: `pr-<run>.osc.stevedores.org` |

See [TAILSCALE.md](./TAILSCALE.md) for mesh path and [EXECUTION_PLAN.md](./EXECUTION_PLAN.md) §6 NFR table.
