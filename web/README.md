# OSC web — Stitch control plane UI

Google Stitch export: tri-path ingress switcher, NFR gauges, Crossplane topology, isolation checks, telemetry drawer.

| Environment | Hostname | Kustomize |
| --- | --- | --- |
| OrbStack local | `osc.k8s.orb.local` | `k8s/overlays/orbstack-local` |
| Production / CF edge | `osc.stvedores.org` | `k8s/overlays/prod-stvedores` |

## Dev

```bash
cd web && bun install && bun run dev
```

## Build & container

```bash
cd web && bun run build
podman build -f Containerfile -t osc-web:local .
# Load into OrbStack K8s: docker tag + imagePullPolicy: Never on overlay
```

## Deploy

```bash
kubectl kustomize k8s/overlays/orbstack-local
kubectl apply -k k8s/overlays/orbstack-local

kubectl kustomize k8s/overlays/prod-stvedores
kubectl apply -k k8s/overlays/prod-stvedores
```

Local overlay includes `ingress-orb-local` LoadBalancer for clusters without Gateway API; `httproute-local` targets `osc.k8s.orb.local` when `orbstack-gateway` exists.
