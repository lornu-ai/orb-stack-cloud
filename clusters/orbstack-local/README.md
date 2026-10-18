# Flux wiring (OrbStack)

Point a Flux `GitRepository` at **this repo** (or add these paths as extra `Kustomization` resources alongside [orb-code](https://github.com/lornu-ai/orb-code)).

Order:

1. Crossplane core (from orb-code `ks-crossplane-core` or upstream Helm)
2. `crossplane/providers` + `crossplane/providerconfig` from this repo
3. `ks-crossplane-local-cloud.yaml` — XRD + Composition
4. `ks-local-cloud-blueprint.yaml` — optional direct Tier 1/2 K8s manifests

Then apply `examples/claim-reference-local-cloud.yaml` or rely on plain kustomize under `blueprint/`.
