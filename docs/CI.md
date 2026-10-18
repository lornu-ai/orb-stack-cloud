# Continuous integration (GitHub Actions)

OrbStack and Crossplane reconciliation **cannot run on GitHub-hosted runners** (no macOS
OrbStack / Apple Silicon VM in standard GHA). CI validates Git manifests and exercises
**AWS (LocalStack)**, **Cloudflare**, and **GCP** APIs the same way Epic 7.3–7.4 will at runtime.

Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)

## Jobs

| Job | Always runs? | What it proves |
| --- | --- | --- |
| **validate** | Yes | YAML parse, K8s `apiVersion`/`kind`, docker-compose LocalStack service |
| **aws-localstack** | Yes | Creates `invoices-archive` S3 + `billing-events` SQS (issue #5 Story 7.3 AC) |
| **cloudflare** | Yes (skips if no token) | `CF_API_TOKEN` verify + optional zone lookup |
| **gcp** | Yes (skips if no creds) | Service account JWT + `projects.get` read-only |

## Repository secrets & variables

Configure under **Settings → Secrets and variables → Actions**.

| Name | Type | Required | Purpose |
| --- | --- | --- | --- |
| `CF_API_TOKEN` | Secret | Optional | Cloudflare API token (`Zone:Read`, `Account:Read` minimum for smoke test) |
| `CF_ZONE_NAME` | Variable | Optional | e.g. `example.com` — validates token can read zone |
| `GCP_PROJECT_ID` | Secret | Optional | GCP project id |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Secret | Optional | Service account JSON; workflow uses `google-github-actions/auth` → read-only project get |

Fork PRs without secrets: **cloudflare** and **gcp** jobs exit 0 with `skipped: true`.

## Local commands

```bash
bun install
bun run ci:validate

# With LocalStack (matches GHA service):
docker run --rm -d -p 4566:4566 -e SERVICES=s3,sqs localstack/localstack:3
LOCALSTACK_ENDPOINT=http://127.0.0.1:4566 bun run ci:aws-localstack

CF_API_TOKEN=... CF_ZONE_NAME=dev.example.com bun run ci:cloudflare
GCP_PROJECT_ID=... GCP_ACCESS_TOKEN=... bun run ci:gcp
```

## Real AWS / GCP / Cloudflare in Crossplane

CI does **not** apply Crossplane providers to a cluster. After OrbStack K8s is up locally:

- **AWS:** point `provider-upjet-aws` at LocalStack (dev) or real AWS (staging) via `ProviderConfig`.
- **Cloudflare:** `provider-cloudflare` + `CF_API_TOKEN` Secret.
- **GCP:** optional future `provider-gcp`; CI only proves credentials are valid.

See [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md).
