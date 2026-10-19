# Edge and mesh — Cloudflare + Tailscale

Public ingress and remote collaboration **must not** rely on Terraform or manual Cloudflare dashboard clicks. Tailscale carries **private** connectivity; Cloudflare carries **authenticated public** edge where needed.

## Tailscale

### Use cases (Epic 7–8)

| Scenario | Pattern |
|----------|---------|
| Remote dev accesses Tier 1 on a teammate's Mac | Mac on tailnet; **Tailscale Serve** or K8s operator exposes `api-gateway` |
| CI runner on tailnet hits `postgres.orb.local` | Subnet router or **app connector** route to OrbStack bridge CIDR (document per tailnet) |
| SSH to Tier 3 machines | `tailscale ssh` / MagicDNS to machine node — replaces Ansible inventory over raw LAN IP |
| Cross-Mac Epic 7 demo | Same tailnet; no shared Terraform state |

### Kubernetes (OrbStack)

1. Install **Tailscale Kubernetes Operator** (Helm) — planned Flux path: `crossplane/edge/tailscale/` or dependency on org `tailscale-mesh` chart.
2. OAuth client credentials via **ExternalSecret** (`integrations/tailscale`).
3. `Connector` + `ProxyClass` (or Ingress annotation) publish `app.k8s.orb.local` equivalent on tailnet.

### Crossplane

- Phase P1: Composition patches `Service` annotations or creates operator CRs from `spec.connectivity.tailscale`.
- ACLs: document tailnet policy JSON in git (`blueprint/edge/tailscale/acls.json.example`) — applied via Tailscale admin API or operator, not Terraform.

## Cloudflare

### Use cases

| Scenario | Pattern |
|----------|---------|
| Share `https://osc-app.stevedores.org` externally | **Remote-managed Tunnel** + DNS CNAME; `cloudflared` on Mac or Deployment in `local-cloud` namespace |
| Protect `/api/v1/checkout` | **Access** application + reusable policies (Crossplane), IdP per org standard |
| LocalStack / billing demo URLs | Prefer OrbStack `dev.orbstack.domains` on Mac; optional CF **public hostname** only when demo leaves the machine |

### Hostnames

| Host | Use |
|------|-----|
| `osc.stevedores.org` | Public hub website, served from `infra-code-micro` ([PUBLIC-SITE.md](PUBLIC-SITE.md)) — not a tunnel |
| `osc-app.stevedores.org` | Stable Cloudflare Tunnel + Access host into the Mac's api-gateway |
| `osc-pr-<run_id>.stevedores.org` | Ephemeral tunnel per CI run, deleted by the run's cleanup step |

Public hosts stay **one label below `stevedores.org`**. The zone's Universal SSL certificate covers `stevedores.org` and `*.stevedores.org` only, so a deeper name such as `pr-42.ci.osc.stevedores.org` would fail TLS at the edge unless Advanced Certificate Manager is bought. Tier 1 validation rejects claims that break this rule.

Other `stevedores.org` records are owned by `infra-code-micro` (`crossplane/cloudflare/hub/infra/base/dns/stevedores.org/`). This repo's Crossplane manages only the `osc` and `osc-pr-*` names.

### Crossplane (planned)

Layout mirrors fleet repos:

```
crossplane/edge/cloudflare/
  compositions/
  xrds/
  examples/
```

Resources (indicative): `Tunnel`, `TunnelConfig`, `DNSRecord`, `AccessApplication`, `AccessPolicy` (Upjet types).

Secrets: ESO → `cloudflare-api-token` (scoped zone + Access + Tunnel).

### Traffic path

```
Internet → Cloudflare Access → Tunnel → cloudflared (tailnet or localhost) → Tier 1 Ingress / Tier 2 label
```

**Default for daily dev:** OrbStack DNS only (no Cloudflare). Enable CF when the acceptance test requires off-Mac browsers (Story 7.3 optional hardening).

## Interaction matrix

| From → To | On Mac | Remote (tailnet) | Public internet |
|-----------|--------|------------------|-----------------|
| Tier 1 | `*.k8s.orb.local` | Tailscale operator hostname | CF Tunnel + Access |
| Tier 2 | `*.orb.local` / compose labels | Tailscale to Mac | CF Tunnel to Mac |
| Tier 3 | `postgres.orb.local` | Tailscale subnet/route | **Deny** (Epic 8) |

## Validation additions

See [VALIDATION.md](VALIDATION.md#tailscale-and-cloudflare-optional-p1p2).
