# XEventBus — LocalStack AWS (Story 7.3)

Crossplane Composition using **provider-upjet-aws** with `ProviderConfig` `aws-localstack`:

- S3 bucket `invoices-archive`
- SQS queue `billing-events`

Endpoints (from Tier 2 Compose):

- `http://s3.aws.orb.local:4566`
- `http://sqs.aws.orb.local:4566`

**CLI validation:** always `aws --profile lornu-ai` (see [docs/AWS.md](../../docs/AWS.md)). Example:

```bash
aws --profile lornu-ai --endpoint-url=http://s3.aws.orb.local:4566 s3 ls
```

Configure provider runtime env (planned `DeploymentRuntimeConfig`) for in-cluster Upjet — endpoint overrides and path-style S3; credentials from ESO/`aws-localstack-creds`, not the host `lornu-ai` profile unless explicitly synced.

See `xrd-event-bus.yaml` and `examples/tier2-event-bus-claim.yaml`.
