# XEventBus — LocalStack AWS (Story 7.3)

Crossplane Composition using **provider-upjet-aws** with `ProviderConfig` `aws-localstack`:

- S3 bucket `invoices-archive`
- SQS queue `billing-events`

Endpoints (from Tier 2 Compose):

- `http://s3.aws.orb.local:4566`
- `http://sqs.aws.orb.local:4566`

Configure provider runtime env (planned `DeploymentRuntimeConfig`):

- `AWS_ACCESS_KEY_ID=test`
- `AWS_SECRET_ACCESS_KEY=test`
- `AWS_S3_FORCE_PATH_STYLE=true`
- Custom endpoint URLs for S3/SQS services

See `xrd-event-bus.yaml` and `examples/tier2-event-bus-claim.yaml`.
