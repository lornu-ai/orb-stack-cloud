# Reference local cloud architecture

- **Engine / platform:** [issue #1](https://github.com/lornu-ai/orb-stack-cloud/issues/1)
- **Execution plan & topology diagram:** [issue #5](https://github.com/lornu-ai/orb-stack-cloud/issues/5) §1

## Tiers + control plane

```
Cloudflare (public)          Tailscale (private mesh)
         \                           /
          v                         v
    Tier 1: K8s + Crossplane + cloudflared + Tailscale Operator
         |         api-gateway / auth (*.k8s.orb.local)
         +---------+------------------+
                   v
    Tier 2: Compose — billing (amd64), LocalStack (arm64)
                   |
                   v
    Tier 3: Linux machines — postgres / vault (cloud-init, tailscaled)
```

Crossplane reconciles Claims against LocalStack, Cloudflare APIs, Kubernetes, and (when available) the OrbStack machine bridge.

Details: [PLANNING.md](PLANNING.md), [EDGE-NETWORK.md](EDGE-NETWORK.md).
