# Tier 3 — cloud-init (Story 7.1)

Provision Linux machines on OrbStack:

```bash
orb create ubuntu postgres -c postgres-userdata.yaml
orb create debian vault -c vault-userdata.yaml
```

Or use the Crossplane-backed bootstrap tool from repo root:

```bash
cd tools/bootstrap-tier3 && bun install && bun run bootstrap
```

Set `ORB_SSH_PUBKEY` and optional `TS_AUTHKEY` before bootstrap (Story 7.2 tailnet enrollment).

Acceptance: `postgres.orb.local:5432` (user `app`) and `http://vault.orb.local:8200/v1/sys/health`.
