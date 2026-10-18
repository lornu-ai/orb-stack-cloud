# Reference local cloud architecture

Full platform-engine narrative: **[issue #1](https://github.com/lornu-ai/orb-stack-cloud/issues/1)**.  
Control-plane planning: **[PLANNING.md](PLANNING.md)** (Crossplane, Tailscale, Cloudflare — no Terraform).

## Logical topology (Epic 7)

```
                    ┌──────────────── Cloudflare (optional P2) ────────────────┐
                    │  DNS · Tunnel · Access                                  │
                    └───────────────────────────┬─────────────────────────────┘
                                                │
                    ┌──────────────── Tailscale tailnet (P1+) ─────────────────┐
                    │  Mac · K8s operator · remote CI                          │
                    └───────────────────────────┬─────────────────────────────┘
                                                │
macOS (OrbStack) ───────────────────────────────┴──────────────────────────────
  │
  ├── Tier 3 — Linux machines (cloud-init)
  │     postgres.orb.local:5432 · vault.orb.local:8200
  │
  ├── Tier 2 — Containers
  │     billing.internal.orb.local · s3.aws.orb.local (LocalStack)
  │
  └── Tier 1 — Integrated Kubernetes
        app.k8s.orb.local → api-gateway → auth-service
```

**Crossplane** reconciles desired state (Tier 1 today; edge/mesh Compositions in P1–P2). **Tailscale** extends tiers to remote actors without public DB ports. **Cloudflare** terminates HTTPS and policy for optional public hostnames.

Local-only dev uses OrbStack DNS (`/etc/resolver/orb.local`, `dev.orbstack.domains`, `*.k8s.orb.local`) with no edge enabled.

## IaC

No Terraform in this track. See [IAC.md](IAC.md) and [EDGE-NETWORK.md](EDGE-NETWORK.md).
