# Continuous integration (GitHub Actions)

Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)

All AWS checks use the **AWS CLI v2** with a fixed profile:

```bash
aws --profile lornu-ai …
```

Default profile name is `lornu-ai` (`AWS_PROFILE` overrides). Implementation: [`scripts/test-aws-smoke.ts`](../scripts/test-aws-smoke.ts).

## Jobs

| Job | What it does |
| --- | --- |
| **validate** | Bun YAML / manifest checks |
| **aws-localstack** | Profile `lornu-ai` + `--endpoint-url` LocalStack → S3 bucket + SQS queue (Story 7.3) |
| **aws-profile** | Profile `lornu-ai` against **live AWS** (read-only) when repo secrets are set |
| **cloudflare** | Token verify (+ optional zone) |
| **gcp** | Optional project get |

## Local (your Mac)

Use the same profile as day-to-day AWS work:

```bash
bun install
bun run ci:validate

# Read-only smoke (caller identity + list buckets/queues):
AWS_SMOKE_READONLY=1 bun run ci:aws

# Or invoke CLI directly:
aws --profile lornu-ai sts get-caller-identity
aws --profile lornu-ai s3 ls
aws --profile lornu-ai sqs list-queues
```

**LocalStack** (matches GHA):

```bash
docker run --rm -d -p 4566:4566 -e SERVICES=s3,sqs --name orb-ls localstack/localstack:3
LOCALSTACK_ENDPOINT=http://127.0.0.1:4566 bun run ci:aws
```

## GitHub secrets (optional)

| Secret | Job |
| --- | --- |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Enables **aws-profile** (maps into `[lornu-ai]`; readonly smoke) |
| `CF_API_TOKEN` | Cloudflare |
| `GCP_PROJECT_ID` + `GOOGLE_APPLICATION_CREDENTIALS_JSON` | GCP |

Use IAM credentials for the same account you use locally under `lornu-ai`, or dedicated CI keys with minimal S3/SQS/STS read (live job is readonly).

## Crossplane

Point `provider-upjet-aws` at LocalStack in dev or at real AWS using credentials equivalent to `--profile lornu-ai` in staging.

See [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md).
