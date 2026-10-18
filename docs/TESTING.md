# Testing and verification

Implements the test architecture in [issue #6](https://github.com/stevedores-org/orb-stack-cloud/issues/6) and the stories in [issue #7](https://github.com/stevedores-org/orb-stack-cloud/issues/7). Every suite is Bun TypeScript under `tests/`; there is no Python, Bash, or `jq` in the harness.

| Tier | Command | Runs on | What it gates |
|---|---|---|---|
| 1 | `bun run verify:tier1` | any (CI: `ubuntu-latest`) | YAML, XRD/claim schemas, Composition → XRD and Function refs, `crossplane composition render` + `crossplane resource validate`, cloud-init schema, kubeconform, kustomize build, Compose labels and platforms, public edge hostnames |
| 2 | `bun run verify:engine` | Apple Silicon + OrbStack | idle CPU, machine boot, memory balloon, APFS TRIM, VirtioFS inotify latency, virtio-net throughput, Rosetta vs QEMU |
| 3 | `bun run verify:local-mesh` | the same Mac | path A: `.orb.local` endpoints with strict TLS (`bun --use-system-ca`) |
| 3 | `bun run verify:remote-probe` | Linux runner on the tailnet | path B: Tailscale ping, SSH, MagicDNS; path C: Cloudflare Access denies anonymous, admits the service token |
| 4 | `bun run verify:aws-parity` | Linux + LocalStack + AWS OIDC | billing S3/SQS contract identical on LocalStack and AWS |
| 4 | `bun run verify:gce` | Linux + GCP access token | each Tier 3 cloud-init file boots cleanly on GCE `t2a-standard-2` (ARM64) |
| 5 | `bun run verify:isolation` | Apple Silicon + OrbStack | `--isolated --isolate-network` machine cannot see host paths, the SSH agent, the host, other containers, ClusterIPs, or Tier 3 services |
| 5 | `bun run report:bigquery` | Linux + GCP access token | streams results into `orbstack_ci.nfr_gate_results` and `orbstack_ci.nfr_benchmarks` |

`bun run test:coverage` runs the unit tests (gate maths, parsers, validators, evaluators) with a 70% line and function threshold (`bunfig.toml`).

## Results and strictness

Each suite writes `results/<suite>.ndjson`, one row per gate. Tier 2 also writes `results/nfr-summary.ndjson`, one wide row per run in the issue #7 Story T6.2 column layout.

A gate is `pass`, `fail`, `skip`, or `error`. **A skip is never a pass.** With `--strict` (used in CI for every tier except Tier 1) any skip fails the run, so a gate cannot go quiet because its dependency disappeared. Tier 1 runs non-strict because four claims intentionally reference Compositions that are still `orbstack.lornu.ai/status: planning`; those show as visible skips.

Isolation probes run twice — from the isolated machine and from a normal control machine — and pass only when the control reaches the target and the isolated machine does not. A target that is down reports a skip instead of a false pass.

## Safety on a shared Mac

Everything the suites create is named `ci-osc-*`, and `bun run cleanup` removes only that prefix. Issues #6 and #7 specify `orb delete --all -f` and `docker system prune -af --volumes`; those are deliberately not used, because they would destroy machines and images the suite did not create. On a dedicated runner the workflow also tears down the reference stack it deployed.

The Rosetta gate is skipped unless `ORB_NFR_ALLOW_ENGINE_RESTART=1`, because toggling Rosetta can restart the OrbStack engine and stop every container, machine, and the Kubernetes cluster.

## Public hostnames

| Host | Use |
|---|---|
| `osc.stevedores.org` | stable public host |
| `osc-pr-<run_id>.stevedores.org` | per-run tunnel for path C |

Issue #6 and #7 use `pr-<run_id>.ci.example.com`. Names are kept one label below `stevedores.org` because Universal SSL covers only `*.stevedores.org`; Tier 1 rejects deeper names. See `docs/EDGE-NETWORK.md`.

## Deviations from issues #6 and #7

- **Measurement methods.** Host access to OrbStack's data image is blocked by macOS privacy controls, so APFS TRIM is measured as host volume free space around a guest write → delete → `fstrim` cycle. Memory reclamation is measured on the resident size of the `OrbStack Helper` process rather than `vm_stat`, which on a large host is dominated by unrelated activity. inotify latency uses in-guest event timestamps corrected by an NTP-style clock offset, reported with its error bound; timing the docker output stream added about 12 ms.
- **Crossplane CLI v2.** `crossplane beta render` / `beta validate` are now `crossplane composition render` and `crossplane resource validate` (pinned v2.5.0, checksum-verified).
- **cloud-init schema.** Validated against the upstream cloud-init 26.2 JSON schema in Bun instead of the Python `cloud-init schema` command.
- **GCE parity.** Uses the Compute REST API and the serial console instead of `gcloud` and SSH. Checking PostgreSQL, node-exporter, and `cloud-tuning.conf` inside the VM needs SSH through IAP or OS Login and is reported as a skip (`gce-service-state`) until that exists. Opening the blueprint's PostgreSQL to the internet to probe it was rejected.
- **AWS parity.** The same `XEventBus` claim cannot yet be reconciled against LocalStack and AWS because XEventBus has no Composition; the billing S3/SQS contract is compared directly with the AWS SDK, and the claim-level check is a visible skip.

## First measurements (2026-10-18, M4 Max, OrbStack 2.2.3)

Run on a developer Mac, not a dedicated runner: Kubernetes and about 60 containers were running, and Rosetta was not toggled.

| Gate | Result | Measured | Target |
|---|---|---|---|
| Idle CPU | fail | 39.6% of one core (61 containers running — not idle) | < 0.1% |
| Warm boot (`orb stop` → `orb start`) | pass | P50 236 ms, P95 248 ms | P95 < 300 ms |
| Cached-image create (`orb create`) | fail | P50 11.4 s, P95 12.6 s | P95 < 300 ms |
| Memory balloon | pass | 90% of a 3.5 GiB rise returned in 7.1 s | ≥ 90% in < 10 s |
| APFS TRIM | fail | nothing within 5 s; 3.18 of 3.22 GB by 23 s | ≥ 2.5 GB in < 5 s |
| VirtioFS inotify | fail | P50 58 ms, P95 62 ms (±14 ms clock error) | P95 < 10 ms |
| Virtio-net | pass | 56 Gbps single stream | ≥ 35 Gbps |
| Rosetta vs QEMU | skip | engine restart not allowed on a shared Mac | ≥ 3× |

Isolation (`--isolated --isolate-network`), each probe checked against a non-isolated control machine:

| Probe | Result |
|---|---|
| `~`, `/mnt/mac`, `/Volumes` | hidden |
| `SSH_AUTH_SOCK` | unset |
| `host.orb.internal` | blocked |
| Docker container on the OrbStack bridge | **reachable** — HTTP 200 with the probe's nonce, in every run |
| Kubernetes API ClusterIP | **reachable** — HTTP 401 from the API server, in every run |
| macOS LAN address | inconclusive — reachable in one suite run, blocked in three later runs, where even the control machine could not connect (macOS firewall state) |

A bare TCP connect reported the LAN address reachable when no application answered, so probes require an HTTP status or a PostgreSQL SSL response.

## Not built here

These are cloud or fleet infrastructure and belong in their owning IaC repos, not in this test harness:

- AWS IAM OIDC provider and `GHA-OrbStack-Parity-Role`; GCP Workload Identity provider and `ci-parity-sa`; the BigQuery dataset and tables (issue #7 T1.1, T6.2).
- The `mac2-m2pro.metal` dedicated-host runner fleet and its AMI (T1.2).
- The scheduled reaper for leaked tunnels, GCE VMs, and sandbox buckets (T1.3).
- Regression alerting on the 7-day moving average (T6.2).

The workflow jobs that need them are gated by repository variables (`ORB_MAC_RUNNER`, `CLOUD_PARITY_ENABLED`) so they stay off until the infrastructure exists. Repository variables used: `ORB_CI_SSH_PUBKEY`, `TS_TAILNET`, `AWS_SANDBOX_ACCOUNT_ID`, `GCP_WIF_PROVIDER`, `GCP_PROJECT_ID`. Secrets: `TS_EPHEMERAL_AUTHKEY`, `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`; no long-lived AWS or GCP keys.

## Governance

`.code-governance.toml` adopts `ci-enforcement-baseline`, which retires `.github/workflows` in favour of `propel.toml`. Issue #6 specifies GitHub Actions, and that was chosen for this repo; the workflow is therefore an exception to the adopted baseline until the Apple Silicon tiers have a propel target.
