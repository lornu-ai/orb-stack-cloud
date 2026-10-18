# OrbStack personal cloud — solution architecture (summary)

Canonical narrative: [issue #1](https://github.com/lornu-ai/orb-stack-cloud/issues/1).

## Two dimensions

1. **Platform engine (Track A)** — Shared-kernel micro-VM on Apple Silicon,
   Virtio networking, `*.orb.local` DNS, cloud-init machines, Rosetta `amd64`.
2. **Reference local cloud (Track B)** — Three tiers on that engine:
   - **Tier 1:** Kubernetes (`*.k8s.orb.local`)
   - **Tier 2:** Docker Compose (Rosetta `amd64` + native `arm64`)
   - **Tier 3:** Stateful Linux machines (`postgres.orb.local`, `vault.orb.local`)

## Track B topology (Epic 7)

```
macOS (OrbStack)
├── Tier 3: orb machines + cloud-init
├── Tier 2: docker compose (*.orb.local labels)
└── Tier 1: K8s Ingress app.k8s.orb.local
         └── Crossplane control plane (this repo)
```

**IaC:** Crossplane compositions replace Terraform modules for declaring the
reference stack; cloud-init replaces most post-provision Ansible for Tier 3.

See [PLAN.md](./PLAN.md) and [../crossplane/](../crossplane/).
