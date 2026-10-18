# Gap on OrbStack Cloud — 3× Apple Silicon Macs

**Decision:** Gap’s personal-cloud runtime (gap-hub) deploys on OrbStack on our Macs. Overlay: [`blueprint/gap/`](../blueprint/gap/). Epic: Linear **LOR-591**.

## Why here (not GKE-first)

- Apple Silicon OrbStack is the daily personal cloud (this repo).
- Gap clients (web / iOS / macOS) talk to a nearby hub with low latency.
- Cloudflare Workers (`gap.airesearches.app`) remain the **public** web + MCP edge (LOR-578).
- GKE manifests in `infra-code-gke-inert` stay optional / later; Macs are the Release 0 sync plane.

## Fleet topology

```
        ┌─────────────────────────────────────────┐
        │ Tailscale tailnet (private)             │
        │                                         │
  Mac A │  OrbStack K8s ── gap-hub (primary)      │◄── iOS / web clients
  (hub) │  gap.k8s.orb.local:8080                 │
        │                                         │
  Mac B │  OrbStack K8s ── gap-hub (satellite)    │── Tailscale → Mac A
        │                                         │
  Mac C │  OrbStack K8s ── gap-hub (satellite)    │── Tailscale → Mac A
        └─────────────────────────────────────────┘
```

| Overlay | Role | ConfigMap |
|---------|------|-----------|
| `blueprint/gap/overlays/mac-a` | **primary** hub | `mac_id=mac-a` |
| `blueprint/gap/overlays/mac-b` | satellite | `mac_id=mac-b` |
| `blueprint/gap/overlays/mac-c` | satellite | `mac_id=mac-c` |

Rename `mac-a/b/c` to real hostnames in a private follow-up if needed; keep overlays stable in git.

## Connectivity matrix

| From → To | Path | Notes |
|-----------|------|--------|
| Same Mac UI → hub | `http://gap.k8s.orb.local:8080` | OrbStack local DNS |
| Other Mac → primary | Tailscale Serve / operator hostname | See [EDGE-NETWORK.md](EDGE-NETWORK.md) |
| Internet → hub `/ws` | **Denied** until LOR-545 | No Cloudflare Tunnel for Gap WS yet |
| Internet → web/MCP | `gap.airesearches.app` | Cloudflare Access (LOR-578) |

## Apply order (each Mac)

1. OrbStack running with Kubernetes enabled (Apple Silicon).
2. `kubectl config use-context orbstack`.
3. Pull or load `gap-hub` image (GAR digest or local Nix).
4. `kubectl apply -k blueprint/gap/overlays/mac-<a|b|c>`.
5. `curl -fsS http://gap.k8s.orb.local:8080/healthz`.
6. On satellites: verify Tailscale path to Mac A hub (document hostname in the Mac’s private notes).

## Relation to Epic 7 blueprint

Gap is an **app workload** on the OrbStack cluster. It does not replace Tier 1 api-gateway / LocalStack. Coexist:

```bash
kubectl apply -k blueprint/tier1          # optional reference stack
kubectl apply -k blueprint/gap/overlays/mac-a
```

## Security

- Non-root UID `65532` (matches gap-hub image).
- No Linear/Slack tokens in these manifests — clients keep secrets on device (LOR-546 Keychain).
- Public Tunnel for Gap sync waits on LOR-545.
