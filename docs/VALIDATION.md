# Validation (Epic 7 — issue #5)

Program DoD: [DOD.md](DOD.md) (tri-path ingress, Terraform-free reconciliation).

## Tier 3

```bash
# Interim until OrbMachineClaim reconciles:
cd tools/bootstrap-tier3 && bun install
ORB_SSH_PUBKEY='…' TS_AUTHKEY='…' bun run bootstrap

psql "postgresql://app:localcloud@postgres.orb.local:5432/microservices" -c 'select 1'
curl -sk http://vault.orb.local:8200/v1/sys/health
tailscale status   # expect orb-postgres / orb-vault when TS_AUTHKEY set
```

## Tier 2 + LocalStack CRs

```bash
docker compose -f blueprint/tier2/docker-compose.yml up -d
curl -sk https://billing.internal.orb.local/health
curl -sk https://s3.aws.orb.local/_localstack/health

# After EventBusClaim reconciles (Story 7.3):
aws --profile lornu-ai --endpoint-url=http://s3.aws.orb.local:4566 s3 ls
```

## Tier 1

```bash
kubectl apply -k blueprint/tier1
curl -sk https://app.k8s.orb.local/healthz
curl -sk https://app.k8s.orb.local/api/v1/checkout
```

## Crossplane

```bash
kubectl apply -f examples/claim-reference-local-cloud.yaml
kubectl get localcloudblueprintclaims
```

## Tri-path ingress (Story 7.4 — full DoD)

| Path | URL |
|------|-----|
| Local | `https://app.k8s.orb.local/api/v1/checkout` |
| Tailnet | `https://<gateway>.<tailnet>.ts.net/api/v1/checkout` |
| Cloudflare | `https://osc-app.stevedores.org/api/v1/checkout` |

All should return **HTTP 200** with Tier 2 + Tier 3 up and vault reachable.
