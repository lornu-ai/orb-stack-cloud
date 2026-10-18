# Suggested backlog revisions (issue #2)

Paste or adapt into GitHub **issue #2** (and linked epics) so planning matches this repo.

## Global replacement

> **Infrastructure as Code:** Use **Crossplane** (Kubernetes + Cloudflare + in-cluster operators), **Tailscale** (private mesh), and **Cloudflare** (DNS, Tunnel, Zero Trust Access) — **not** Terraform, OpenTofu, or Ansible playbooks for provisioning.

## Story 7.1 (Tier 3)

**Replace technical tasks:**

- ~~Terraform/OpenTofu wrapper module~~ → **Crossplane** claim fields + `blueprint/tier3-cloudinit/`; bootstrap via `tools/bootstrap-tier3` (`orb create`).
- ~~Ansible over SSH~~ → **cloud-init** idempotency + **Tailscale** SSH/MagicDNS for admin access.

**Add acceptance (Epic 8 preview):**

- Postgres and Vault listen on tailnet or OrbStack bridge only; no public CF route to `:5432` / `:8200`.

## Story 7.2 (Tier 2)

**Add:**

- Document optional **Cloudflare Tunnel** origin to `billing.internal.orb.local` for off-Mac demos (P2).
- Billing DB URL remains `postgres.orb.local` or tailnet DNS name from claim.

## Story 7.3 (Tier 1)

**Replace / extend:**

- Ingress at `app.k8s.orb.local` (local) **and** optional `spec.connectivity.cloudflare.publicHost`.
- **Tailscale Operator** exposes gateway on tailnet for remote E2E.
- **Cloudflare Access** policy on public hostname before checkout route (P2).

## New Story 7.4 (proposed) — Mesh and edge IaC

**As a** `@CloudArch`  
**I want** Tailscale and Cloudflare resources declared alongside the local cloud claim  
**So that** remote devs and staged demos never depend on Terraform state or manual dashboard config.

**Tasks:**

- P1: Tailscale operator + `spec.connectivity.tailscale` in XRD.
- P2: Crossplane Cloudflare Tunnel + Access Compositions.
- ESO-backed API tokens only.

**Points:** 5 | **Priority:** P1
