# GAP — OrbStack Deployment Strategy

## What this repository is

**`stevedores-org/orb-stack-cloud` is a new infrastructure project we are building.**

It is the **infrastructure reference** for OrbStack on Apple Silicon (Crossplane · Tailscale · Cloudflare) and the home for Gap’s Mac deploy overlays. It is **not yet** a mature, production-proven automation stack for a long-running host.

| Git ref | Reality |
|---------|---------|
| `main` | `.gitignore` + `LICENSE` only — default-branch README **404** until Epic 7 merges |
| `feat/crossplane-epic7-blueprint` (PR #4) | Personal-cloud blueprint (Tiers 1–3, docs, kustomize CI) |
| `feat/gap-on-orbstack` (PR #12) | Gap app overlay `blueprint/gap/` for 3× Macs |

**Implication:** Gap is added to a stack we are defining now (host, pipeline, Tailscale, later Tunnel) — not dropped into an already-established OrbStack product.

## Target topology

```
GAP iOS (voice) ──┐
GAP Web          ─┼── Cloudflare Access ── gap.airesearches.app (Workers)
                  │         │
                  │         └── Tunnel / WSS → OrbStack gap-hub  (only after WS auth)
                  │
                  └── Tailscale / *.k8s.orb.local ──► OrbStack Mac fleet
                        gap-hub · (later) GROW worker · persistent data
```

- **Public web + MCP:** Cloudflare Workers today ([Gap LOR-578](https://linear.app/lornu-ai/issue/LOR-578)).
- **Sync / gateway on Macs:** `blueprint/gap/` overlays (`mac-a` primary, `mac-b` / `mac-c` satellites).
- **Do not** expose unauthenticated `/ws` on the internet ([LOR-545](https://linear.app/lornu-ai/issue/LOR-545)).

## P0 / P1 map

| Priority | Workstream | Where |
|----------|------------|--------|
| P0 | OrbStack start / restart / recover | Apply overlays; OrbStack autostart on primary Mac |
| P0 | Cloudflare routing | Workers for `gap.airesearches.app`; Tunnel→hub after auth |
| P0 | Gateway security | Gap WS/MCP auth (LOR-545) |
| P0 | Persistent storage | PVC/hostPath for SQLite/outbox (open Linear child) |
| P0 | CI/CD | `lornu-ai/gap` image CI + this repo kustomize-validate |
| P1 | iOS voice | Gap Release 1 voice epic |
| P1 | Agent delegation | Gap agent workforce epic |
| P1 | Monitoring | Health checks / alerts |

## Host sleep / remote iOS

A sleeping Mac cannot serve the hub. Release 0: treat **Mac A** as the stay-awake primary; satellites may sleep; remote clients use Workers when the hub is down and reconnect when it returns. Full HA failover across three Macs is follow-on work.

## Apply (once PR #12 is on a merged tree)

```bash
kubectl config use-context orbstack
kubectl apply -k blueprint/gap/overlays/mac-a
curl -fsS http://gap.k8s.orb.local:8080/healthz
```

See [GAP-ON-ORBSTACK.md](GAP-ON-ORBSTACK.md).
