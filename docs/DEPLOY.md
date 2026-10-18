# Deploy OSC on production Kubernetes

## Fleet cluster (current)

| Field | Value |
| --- | --- |
| **EKS cluster** | `community-stevedores-org` |
| **Region** | `us-east-2` |
| **AWS account** | `035409784196` |
| **AWS profile** | `community-stevedores-org` |
| **Namespace** | `stevedores` |
| **Public hostname** | `osc.stevedores.org` |
| **Container registry (preferred)** | `035409784196.dkr.ecr.us-east-2.amazonaws.com/osc-web` |

Local OrbStack dev: `k8s/overlays/orbstack-local` → `osc.k8s.orb.local`.

### Prerequisites on EKS

- **Worker nodes** schedulable (`kubectl get nodes` must list Ready nodes). If all workloads are `Pending`, scale the node group / Karpenter pool first.
- **AWS Load Balancer Controller** running in `kube-system` (webhook `aws-load-balancer-webhook-service` must have endpoints). Ingress creation fails when the controller pod is Pending.

## Quick deploy (EKS, static assets — no Docker on laptop)

Builds the Stitch UI and applies manifests plus a ConfigMap of `web/dist`:

```bash
export AWS_PROFILE=community-stevedores-org
kubectl config use-context arn:aws:eks:us-east-2:035409784196:cluster/community-stevedores-org

bun run deploy:eks
```

## Image-based deploy (ECR)

When Docker/Podman is available:

```bash
cd web
docker build -f Containerfile -t 035409784196.dkr.ecr.us-east-2.amazonaws.com/osc-web:v0.1.0 .
aws ecr get-login-password --region us-east-2 --profile community-stevedores-org \
  | docker login --username AWS --password-stdin 035409784196.dkr.ecr.us-east-2.amazonaws.com
docker push 035409784196.dkr.ecr.us-east-2.amazonaws.com/osc-web:v0.1.0
```

Use overlay `k8s/overlays/prod-stevedores` (Gateway API HTTPRoute) when `gateway-system/shared-multi-tenant-gateway` exists, or `k8s/overlays/prod-eks-community` (ALB Ingress) on this cluster.

## DNS (Cloudflare)

1. Wait for ALB: `kubectl get ingress -n stevedores osc-stevedores`
2. Add **CNAME** `osc` → ALB hostname (proxied), **or** patch and apply [iac/cloudflare/osc-stevedores-org-cname.yaml](../iac/cloudflare/osc-stevedores-org-cname.yaml) once `zoneId` is set on the Upbound provider.

Existing site records (`www.stevedores.org`) target `k8s-gateways-aivcs-*.elb.amazonaws.com`; OSC uses its own ALB via the Ingress above.

## Deploy another containerized app on OSC

1. Add `Deployment` + `Service` under `k8s/apps/<your-app>/` or a new overlay.
2. Reuse namespace `stevedores` or create a dedicated namespace and ReferenceGrant if using Gateway API.
3. Expose via additional Ingress rule or HTTPRoute hostname (e.g. `myapp.stevedores.org`).
4. Optional: Tier 2 Compose / Crossplane claims per [EXECUTION_PLAN.md](./EXECUTION_PLAN.md).

Crossplane `XCloudflareEdgeIngress` (`cloud.lornu.ai/v1alpha1`) is **not** installed on the fleet cluster yet; use Upbound `Record` or dashboard DNS until that CRD lands.
