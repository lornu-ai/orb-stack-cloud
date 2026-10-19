# Gap on OrbStack (Apple Silicon)

Deploys **gap-hub** from [`lornu-ai/gap`](https://github.com/lornu-ai/gap) into the OrbStack Kubernetes cluster on each Mac.

See [docs/GAP-ON-ORBSTACK.md](../../docs/GAP-ON-ORBSTACK.md) for the three-Mac fleet and [docs/GAP-DEPLOYMENT-STRATEGY.md](../../docs/GAP-DEPLOYMENT-STRATEGY.md) for product constraints.

**Success includes native iOS + interactive voice play** (LOR-548 / LOR-569): authenticated full-duplex `wss://` to this hub — not only `/healthz`.

## Apply (per Mac)

```bash
# Primary hub
kubectl apply -k blueprint/gap/overlays/mac-a

# Satellites
kubectl apply -k blueprint/gap/overlays/mac-b
kubectl apply -k blueprint/gap/overlays/mac-c
```

## Smoke

```bash
kubectl -n gap rollout status deploy/gap-hub
curl -fsS http://gap.k8s.orb.local:8080/healthz
```

## Image

Default image: `us-central1-docker.pkg.dev/inert-synergies-llc/gap/gap-hub:main`.

On a Mac without GAR pull access, load the Nix image locally (`docker load` / `orb`) and set:

```bash
kustomize edit set image us-central1-docker.pkg.dev/inert-synergies-llc/gap/gap-hub:main=gap-hub:local
```

Pin a **digest** from gap CI (LOR-550) before treating the hub as durable.

## Public edge

Do **not** expose `/ws` or `/sync` on Cloudflare until Gap LOR-545 (WS auth) is done. Local `*.k8s.orb.local` and Tailscale only. Voice sessions also need LOR-571.

## oxidizedMCP skills (`gap::*`, `orbstack::*`, `tailscale::*`)

Registry fragment: [`mcp/oxidized-skill.example.yaml`](mcp/oxidized-skill.example.yaml) (includes the Cloudflare Workers org MCP edge at `https://gap.airesearches.app/mcp` from LOR-578 plus local `orbstack` and `tailscale` skills).  
Skill implementations: [`tools/mcp-skills/`](../../tools/mcp-skills/README.md) ([docs/OSC-MCP-SKILLS.md](../../docs/OSC-MCP-SKILLS.md)).
