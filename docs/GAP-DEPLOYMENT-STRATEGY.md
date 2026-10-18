# GAP — OrbStack Deployment Strategy

## Product constraints (non-negotiable)

Gap is **not** a Mac/web-only control plane. Deployment must keep these first-class:

1. **Native iOS client** — Dispatch / Issues / Agents / Gateway on iPhone ([LOR-568](https://linear.app/lornu-ai/issue/LOR-568)).
2. **Interactive voice play** — a real CallKit / `AVAudioSession` play-and-record session: mic up, agent audio down, barge-in, over one authenticated `wss://` to the gateway ([LOR-548](https://linear.app/lornu-ai/issue/LOR-548), [LOR-569](https://linear.app/lornu-ai/issue/LOR-569), [LOR-570](https://linear.app/lornu-ai/issue/LOR-570)).

OrbStack + Cloudflare exist to make that remote voice path reliable. A hub that only serves local `kubectl` smoke tests is incomplete.

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
GAP iOS (interactive voice) ──┐
GAP Web                       ─�```
GAP iOS (interactive voice) ──┐
GAP Web                       ─┼── Cloudflare Access ── gap.airesearches.app (Workers)
                               │         │
                               │         └── Tunnel / WSS → OrbStack gap-hub  (only after WS auth)
                               │
                               └── Tailscale / *.k8s.orb.local ──► OrbStack Mac fleet
                                     gap-hub · (later) GROW worker · persistent data
```

- **Public web + MCP:** Cloudflare Workers today ([Gap LOR-578](https://linear.app/lornu-ai/issue/LOR-578)).
- **Sync / voice gateway on Macs:** `blueprint/gap/` overlays (`mac-a` primary, `mac-b` / `mac-c` satellites).
- **iOS voice path:** authenticated full-duplex audio on `wss://` ([LOR-569](https://linear.app/lornu-ai/issue/LOR-569)); secure sessions [LOR-571](https://linear.app/lornu-ai/issue/LOR-571).
- **Do not** expose unauthenticated `/ws` on the internet ([LOR-545](https://linear.app/lornu-ai/issue/LOR-545)).

## P0 / P1 map

| Priority | Workstream | Where |
|----------|------------|--------|
| P0 | OrbStack start / restart / recover | Apply overlays; OrbStack autostart on primary Mac |
| P0 | Cloudflare routing | Workers for `gap.airesearches.app`; Tunnel→hub after auth |
| P0 | Gateway security | Gap WS/MCP auth (LOR-545) + voice session auth (LOR-571) |
| P0 | Persistent storage | PVC/hostPath for SQLite/outbox (LOR-593) |
| P0 | CI/CD | `lornu-ai/gap` image CI + this repo kustomize-validate |
| P1 | **iOS interactive voice play** | LOR-548 epic: LOR-568 shell, LOR-569 session, LOR-570 barge-in — needs deployed authenticated gateway |
| P1 | Agent delegation | Gap agent workforce epic (incl. voice-to-delegate LOR-561) |
| P1 | Monitoring | Health checks / alerts |

P0 gateway + Mac availability are on the **critical path** for P1 interactive voice. Do not treat iOS voice as optional polish after a Mac-only deploy.

## Host sleep / remote iOS voice

A sleeping Mac cannot serve an interactive voice call. Release 0:

- Treat **Mac A** as the stay-awake primary (OrbStack + gap-hub always up).
- Satellites may sleep; iOS prefers Mac A via Tailscale / (later) Tunnel.
- When the hub is down: Workers still serve web/MCP; voice reconnects when the hub returns ([LOR-573](https://linear.app/lornu-ai/issue/LOR-573)).
- Full HA failover across three Macs is follow-on work.

## Apply (once PR #12 is on a merged tree)

```bash
kubectl config use-context orbstack
kubectl apply -k blueprint/gap/overlays/mac-a
curl -fsS http://gap.k8s.orb.local:8080/healthz
```

Voice acceptance (after LOR-545 / LOR-571): iPhone holds a CallKit session to the Lead Agent with duplex audio — not only `/healthz`.

See [GAP-ON-ORBSTACK.md](GAP-ON-ORBSTACK.md).
