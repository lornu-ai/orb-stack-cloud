# Planning — Crossplane, Tailscale, Cloudflare (no Terraform)

**Execution plan:** **[issue #5](https://github.com/lornu-ai/orb-stack-cloud/issues/5)**  
**Implementation map:** [EXECUTION-PLAN.md](EXECUTION-PLAN.md)

Crossplane on OrbStack Kubernetes is the **IaC control plane**. Tailscale provides **zero-trust mesh** (tailnet, operator, machine `tailscaled`). Cloudflare provides **public edge** (Tunnel, Zero Trust Access, DNS).

| Pillar | Role | Replaces |
|--------|------|----------|
| **Crossplane** | XRDs/Claims: Tier 1, `XOrbMachine`, `XEventBus`, `XCloudflareEdgeIngress`, LocalStack AWS | Terraform/OpenTofu, Ansible |
| **Tailscale** | MagicDNS, SSH, K8s operator expose, Tier 3 enrollment | Ad-hoc VPN, public DB ports |
| **Cloudflare** | `cloudflared`, Access, CNAME to tunnel | Manual dashboard + TF CF provider |

On-box DNS remains OrbStack **`*.orb.local`** / **`*.k8s.orb.local`** (issue #1).

## Control plane APIs (Story 7.1)

| XRD | Group | Purpose |
|-----|-------|---------|
| `XLocalCloudBlueprint` | `orbstack.lornu.ai` | Tier 1 bundle (implemented) |
| `XOrbMachine` | `machines.cloud.orb.local` | Tier 3 Linux machines (planning) |
| `XEventBus` | `localstack.cloud.orb.local` | S3 + SQS on LocalStack (planning) |
| `XCloudflareEdgeIngress` | `edge.cloud.orb.local` | Tunnel + DNS + cloudflared (planning) |

## Phases (issue #5 §5)

| Phase | Focus | Owner |
|-------|--------|-------|
| 1–3 | Micro-VM, K8s, DNS, Epic 4 cloud-init/bridge | OrbStack Track A |
| **4** | Epic 7 Crossplane blueprint + edge/mesh | **This repo** |

## Related

- [IAC.md](IAC.md) · [EDGE-NETWORK.md](EDGE-NETWORK.md) · [DOD.md](DOD.md) · [VALIDATION.md](VALIDATION.md)
