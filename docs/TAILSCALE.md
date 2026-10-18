# Tailscale — zero-trust mesh (issue #5)

Covers **Track A** Story 3.4 (MagicDNS/WARP coexistence), **Story 4.1** (cloud-init `tailscale up`),
**Story 7.2** (Tier 3 machine enrollment), and **Story 7.4** (Kubernetes Operator).

## Roles

| Layer | Mechanism |
| --- | --- |
| macOS host | Tailscale app; MagicDNS for `*.ts.net`; no RFC6598 collision with OrbStack bridge |
| Tier 3 VMs | `cloud-init` installs `tailscaled`; `tailscale up --authkey=... --ssh --hostname=orb-postgres` |
| Tier 1 K8s | **Tailscale Kubernetes Operator** — `tailscale.com/expose: "true"` on Service/Ingress |
| Crossplane | `provider-kubernetes` or **provider-helm** to install Operator and expose Services |

## Story 7.2 acceptance

After `kubectl apply -f crossplane/examples/tier3-stateful-claims.yaml`:

- `postgres.orb.local:5432` and `vault.orb.local:8200` online in `< 25s`
- Nodes visible in Tailscale admin with **Tailscale SSH** enabled
- Remote access via MagicDNS (e.g. `postgres.<tailnet>.ts.net`)

## Story 7.4 acceptance (private path)

HTTPS checkout must succeed via **Tailscale MagicDNS URL** to `api-gateway`, same backend chain as local `.orb.local`.

## Planned repo artifacts

- `tailscale/` — Operator install + sample Ingress (see README there)
- cloud-init templates: extend `crossplane/compositions/configmaps-cloud-init.yaml` with Tailscale packages (auth key from Secret reference TBD)

## Security

- Epic 6 **`--isolate-network`** machines must not receive tailnet routes unless ACL explicitly allows.
- Prefer Cloudflare for intentional public webhooks; use Funnel only with ACL review.

See [EXECUTION_PLAN.md](./EXECUTION_PLAN.md) and [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md).
