# Program Definition of Done & NFR gateways

From **[issue #5](https://github.com/lornu-ai/orb-stack-cloud/issues/5)** §6. Verification ownership split between **OrbStack product** (Track A) and **this repo** (Track B / Epic 7).

| Metric / capability | Target | Verified by | Owner |
| :--- | :--- | :--- | :--- |
| Idle background CPU (VM only) | `< 0.1%` host CPU | 15m `powermetrics` idle sample | Track A |
| Linux machine boot time | `< 300ms` warm rootfs | `XOrbMachine` / `orb create` → `systemctl is-system-running` | Track A + 7.2 |
| Memory reclamation | `> 90%` pages in `< 10s` after 6 GB workload stop | macOS `vm_stat` | Track A |
| Virtual network throughput | `> 35 Gbps` (target 45) | `iperf3` macOS ↔ guest | Track A |
| Cross-arch vs QEMU | `>= 3x` Rosetta vs QEMU | amd64 billing benchmark | Track A / 7.3 |
| **Crossplane IaC reconciliation** | **100% Terraform-free** | Claims → `READY=True` / `SYNCED=True` | **This repo** |
| **Tri-path ingress** | Local + Tailnet + CF edge | E2E HTTPS checkout | **This repo** (7.4) |

### Tri-path ingress (Story 7.4)

All must succeed for Epic 7 DoD:

1. **Local:** `https://app.k8s.orb.local/api/v1/checkout`
2. **Tailnet:** `https://<api-gateway>.<tailnet>.ts.net/...` (operator expose)
3. **Public:** `https://osc.stevedores.org/...` (Cloudflare Tunnel + Access; CI uses `osc-pr-<run_id>.stevedores.org`)

Flow under test: Ingress/`cloudflared` → api-gateway → auth → vault.orb.local → billing.internal.orb.local (amd64) → LocalStack SQS → postgres.orb.local.

Automated suite: `tests/` — see [TESTING.md](TESTING.md) for the per-tier gates and how the NFRs above are measured.
