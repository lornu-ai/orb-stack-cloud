# Validation (Epic 7 acceptance)

Run on a single Mac with OrbStack Kubernetes and Docker enabled.

## Tier 3

After `bun run bootstrap` in `tools/bootstrap-tier3`:

```bash
psql "postgresql://app:localcloud@postgres.orb.local:5432/microservices" -c 'select 1'
curl -sk https://vault.orb.local:8200/v1/sys/health
```

## Tier 2

```bash
docker compose -f blueprint/tier2/docker-compose.yml up -d
curl -sk https://billing.internal.orb.local/health
curl -sk https://s3.aws.orb.local/_localstack/health
```

## Tier 1

```bash
kubectl apply -k blueprint/tier1
curl -sk https://app.k8s.orb.local/healthz
curl -sk https://app.k8s.orb.local/api/v1/checkout
```

Story 7.3 target: checkout returns **200** when Tier 2 and Tier 3 are up and gateway ConfigMap upstreams resolve.

## Crossplane claim

```bash
kubectl apply -f examples/claim-reference-local-cloud.yaml
kubectl get localcloudblueprintclaims,localcloudblueprints
```
