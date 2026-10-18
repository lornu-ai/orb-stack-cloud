# Tier 2 — Compose (Story 7.2)

```bash
docker compose -f blueprint/tier2/docker-compose.yml up -d
```

Requires Tier 3 Postgres reachable at `postgres.orb.local` for full billing DB checks. The sample billing container exposes HTTP only; replace with your amd64 billing image when ready.

Optional Kubernetes mirror: `kubectl apply -k blueprint/tier2/k8s` (arm64 LocalStack + billing stub).
