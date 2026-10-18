# XOrbMachine (Story 7.1, Epic 4.2)

**API group:** `machines.cloud.orb.local`

Reconciles OrbStack Linux machines via the host provisioning bridge (`orb create` / `orb delete` with cloud-init). Until Epic **4.2** ships in OrbStack, use `tools/bootstrap-tier3` and treat Claims as **desired-state documentation**.

## Claims

- `examples/tier3-stateful-claims.yaml` — `postgres-db`, `vault-kms`

## Composition (planned)

1. Read `spec.cloudInit` ConfigMap ref or inline hash.
2. Call host bridge: `POST /v1/machines` or equivalent.
3. Poll readiness; write `status.machineId`, `status.ready`.
4. On delete, `DELETE /v1/machines/{name}`.

## XRD

`xrd-orbmachine.yaml` — schema only; do not apply until bridge + provider exist.
