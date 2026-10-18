# IaC — orb-stack-cloud

Infrastructure-as-code for [stevedores-org/orb-stack-cloud](https://github.com/stevedores-org/orb-stack-cloud) lives in this repo (Crossplane + Kustomize + edge claims). **No Terraform.**

## Production edge — `osc.stevedores.org`

| Artifact | Path |
| --- | --- |
| Domain constants | [domains/stevedores.yaml](./domains/stevedores.yaml) |
| K8s overlay | [k8s/overlays/prod-stevedores](../k8s/overlays/prod-stevedores/) |
| Crossplane edge claim | [crossplane/examples/osc-stevedores-edge-claim.yaml](../crossplane/examples/osc-stevedores-edge-claim.yaml) |
| Local OrbStack | [k8s/overlays/orbstack-local](../k8s/overlays/orbstack-local/) → `osc.k8s.orb.local` |

## Apply order (production)

**EKS fleet (`community-stevedores-org`, us-east-2):**

```bash
bun run deploy:eks
# Then CNAME osc.stevedores.org → ALB (see docs/DEPLOY.md)
```

**Gateway API + Crossplane edge (when `gateway-system` exists):**

```bash
kubectl apply -f iac/domains/stevedores.yaml
kubectl apply -k k8s/overlays/prod-stevedores
kubectl apply -f crossplane/examples/osc-stevedores-edge-claim.yaml
```

Crossplane `provider-cloudflare` reconciles DNS + Tunnel per claim parameters (`zoneName: stevedores.org`, `hostname: osc.stevedores.org`).

See [docs/CLOUDFLARE.md](../docs/CLOUDFLARE.md) and [docs/CROSSPLANE.md](../docs/CROSSPLANE.md).
