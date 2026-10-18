/**
 * Epic 7.3 AWS smoke — always `aws --profile lornu-ai` (override with AWS_PROFILE).
 * LocalStack: set LOCALSTACK_ENDPOINT or AWS_ENDPOINT_URL.
 * Real AWS: use ~/.aws/credentials [lornu-ai]; set AWS_SMOKE_READONLY=1 to skip creates.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { AWS_PROFILE, AWS_REGION, awsEndpoint, requireAws, runAws } from "./lib/run-aws.ts";

const bucket = process.env.TEST_S3_BUCKET ?? "invoices-archive";
const queueName = process.env.TEST_SQS_QUEUE ?? "billing-events";
const readonly = process.env.AWS_SMOKE_READONLY === "1" || process.env.AWS_SMOKE_READONLY === "true";

async function writeProfile(accessKeyId: string, secretAccessKey: string): Promise<void> {
  const credsDir = join(homedir(), ".aws");
  await mkdir(credsDir, { recursive: true });
  await writeFile(
    join(credsDir, "credentials"),
    `[${AWS_PROFILE}]\naws_access_key_id = ${accessKeyId}\naws_secret_access_key = ${secretAccessKey}\n`,
    "utf8",
  );
  await writeFile(
    join(credsDir, "config"),
    `[profile ${AWS_PROFILE}]\nregion = ${AWS_REGION}\noutput = json\n`,
    "utf8",
  );
}

async function bootstrapProfile(): Promise<void> {
  const key = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secret = process.env.AWS_SECRET_ACCESS_KEY?.trim();
  if (key && secret) {
    await writeProfile(key, secret);
    return;
  }
  const endpoint = awsEndpoint();
  if (endpoint?.includes("127.0.0.1") || endpoint?.includes("localhost")) {
    await writeProfile("test", "test");
  }
}

async function waitForLocalStack(maxMs = 120_000): Promise<void> {
  const endpoint = awsEndpoint();
  if (!endpoint) return;
  const health = `${endpoint.replace(/\/$/, "")}/_localstack/health`;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetch(health);
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await Bun.sleep(2000);
  }
  throw new Error(`LocalStack not healthy at ${health}`);
}

async function main(): Promise<void> {
  const which = runAws(["--version"]);
  if (!which.ok) {
    throw new Error("AWS CLI not found; install v2 (GHA: aws-actions/setup-aws-cli)");
  }

  await bootstrapProfile();
  await waitForLocalStack();

  const identity = requireAws(["sts", "get-caller-identity", "--output", "json"]);
  const who = JSON.parse(identity) as { Account?: string; Arn?: string };

  if (!readonly) {
    const mb = runAws(["s3", "mb", `s3://${bucket}`]);
    if (!mb.ok && !/BucketAlreadyOwnedByYou|BucketAlreadyExists/.test(mb.stderr)) {
      throw new Error(mb.stderr || mb.stdout);
    }
    const cq = runAws(["sqs", "create-queue", "--queue-name", queueName]);
    if (!cq.ok && !/QueueAlreadyExists|QueueNameExists/.test(cq.stderr)) {
      throw new Error(cq.stderr || cq.stdout);
    }
  }

  const bucketsJson = requireAws(["s3api", "list-buckets", "--output", "json"]);
  const buckets =
    (JSON.parse(bucketsJson || "{}") as { Buckets?: Array<{ Name?: string }> }).Buckets?.map(
      (b) => b.Name,
    ) ?? [];

  const queuesJson = requireAws(["sqs", "list-queues", "--output", "json"]);
  const queueUrls =
    (JSON.parse(queuesJson || "{}") as { QueueUrls?: string[] }).QueueUrls ?? [];

  if (!readonly) {
    if (!buckets.includes(bucket)) {
      throw new Error(`bucket ${bucket} missing; have: ${buckets.join(", ")}`);
    }
    if (!queueUrls.some((u) => u.includes(queueName))) {
      throw new Error(`queue ${queueName} missing; urls: ${queueUrls.join(", ")}`);
    }
  }

  console.log(
    JSON.stringify({
      ok: true,
      profile: AWS_PROFILE,
      endpoint: awsEndpoint() ?? "aws",
      region: AWS_REGION,
      readonly,
      caller: who,
      bucket: readonly ? null : bucket,
      queueName: readonly ? null : queueName,
      bucketCount: buckets.length,
      queueCount: queueUrls.length,
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
