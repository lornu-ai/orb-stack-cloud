# AWS CLI convention

Use the **`lornu-ai`** profile for all `aws` commands in this blueprint (local validation and org-aligned credentials).

```bash
export AWS_PROFILE=lornu-ai
# or prefix each command:
aws --profile lornu-ai …
```

## LocalStack (Story 7.3)

OrbStack LocalStack keeps **`s3.aws.orb.local`** hostnames; pass the endpoint on each call:

```bash
aws --profile lornu-ai --endpoint-url=http://s3.aws.orb.local:4566 s3 ls
aws --profile lornu-ai --endpoint-url=http://sqs.aws.orb.local:4566 sqs list-queues
```

Configure the profile in `~/.aws/config` / `~/.aws/credentials` per your org standard. Crossplane **provider-upjet-aws** uses in-cluster secrets (`aws-localstack` ProviderConfig), not the host profile — keep CLI and controller creds separate unless ESO mirrors the same source.
