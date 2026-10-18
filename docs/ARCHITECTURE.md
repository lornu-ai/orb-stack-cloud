# Reference local cloud architecture

Full platform-engine narrative (shared-kernel micro-VM, VirtioFS, `*.orb.local` DNS, Rosetta amd64) is maintained in GitHub **[issue #1](https://github.com/lornu-ai/orb-stack-cloud/issues/1)**. This document summarizes **Part 2 — workload topology** that this repository implements.

## Logical topology (Epic 7)

```
macOS (OrbStack control plane)
  │
  ├── Tier 3 — Linux machines (cloud-init)
  │     postgres.orb.local:5432
  │     vault.orb.local:8200
  │
  ├── Tier 2 — Containers (Compose or K8s mirror)
  │     billing.internal.orb.local  (linux/amd64 via Rosetta)
  │     s3.aws.orb.local / sqs.aws.orb.local  (LocalStack, arm64)
  │
  └── Tier 1 — Integrated Kubernetes
        app.k8s.orb.local → api-gateway → auth-service
        upstreams: Tier 2 HTTP, Tier 3 Postgres/Vault
```

Cross-runtime routing uses OrbStack’s unified bridge and scoped DNS (`/etc/resolver/orb.local`, `dev.orbstack.domains`, `*.k8s.orb.local`). No `localhost` port-forward matrix is required when labels and machine names are set correctly.

## IaC choice

The backlog mentions Terraform for Tier 3 provisioning. **This repo uses Crossplane + GitOps** for Tier 1 and for publishing Tier 3 cloud-init artifacts; OrbStack CLI remains the machine API for Tier 3 runtime (same as `orb create` in the issue acceptance criteria).
