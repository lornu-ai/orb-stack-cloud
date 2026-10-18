import { CreateBucketCommand, DeleteBucketCommand, DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { CreateQueueCommand, DeleteQueueCommand, ReceiveMessageCommand, SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { runGates, skip, type Gate } from "../lib/gates";
import { finish } from "../lib/report";
import { compareContracts, resourceNames, type StepResult } from "./contract";

/**
 * Runs the billing service's S3 + SQS contract against LocalStack and real AWS, then
 * compares outcomes step by step. Real AWS uses the default credential chain, which in
 * CI is the OIDC role from aws-actions/configure-aws-credentials.
 */
interface Target {
  name: "localstack" | "aws";
  region: string;
  endpoint?: string;
}

const runId = process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`;
const localstack: Target = { name: "localstack", region: "us-east-1", endpoint: process.env.LOCALSTACK_ENDPOINT ?? "http://s3.aws.orb.local:4566" };
const aws: Target = { name: "aws", region: process.env.AWS_REGION ?? "us-west-2" };

async function contract(t: Target): Promise<StepResult[]> {
  const creds = t.endpoint ? { credentials: { accessKeyId: "test", secretAccessKey: "test" } } : {};
  const s3 = new S3Client({ region: t.region, endpoint: t.endpoint, forcePathStyle: !!t.endpoint, ...creds });
  const sqs = new SQSClient({ region: t.region, endpoint: t.endpoint, ...creds });
  const { bucket, queue } = resourceNames(`${runId}-${t.name}`);
  const invoice = JSON.stringify({ id: `inv-${runId}`, amount: 99, item: "orbstack-pro" });
  const results: StepResult[] = [];
  const step = async (name: string, fn: () => Promise<string | void>) => {
    try {
      results.push({ step: name, ok: true, detail: (await fn()) ?? "" });
      return true;
    } catch (err) {
      results.push({ step: name, ok: false, detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
      return false;
    }
  };
  let queueUrl: string | undefined;
  try {
    (await step("create-bucket", async () => {
      await s3.send(new CreateBucketCommand({ Bucket: bucket, ...(t.region === "us-east-1" ? {} : { CreateBucketConfiguration: { LocationConstraint: t.region as never } }) }));
    })) &&
      (await step("put-invoice", async () => void (await s3.send(new PutObjectCommand({ Bucket: bucket, Key: "invoice.json", Body: invoice, ContentType: "application/json" }))))) &&
      (await step("get-invoice", async () => {
        const got = await (await s3.send(new GetObjectCommand({ Bucket: bucket, Key: "invoice.json" }))).Body?.transformToString();
        if (got !== invoice) throw new Error("object body differs from what was written");
      }));
    (await step("create-queue", async () => {
      queueUrl = (await sqs.send(new CreateQueueCommand({ QueueName: queue }))).QueueUrl;
    })) &&
      (await step("send-event", async () => void (await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: invoice }))))) &&
      (await step("receive-event", async () => {
        const msgs = (await sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl, WaitTimeSeconds: 10, MaxNumberOfMessages: 1 }))).Messages ?? [];
        if (msgs[0]?.Body !== invoice) throw new Error(`received ${msgs.length} messages; body ${msgs[0]?.Body === undefined ? "missing" : "differs"}`);
      }));
  } finally {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: "invoice.json" })).catch(() => {});
    await s3.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => {});
    if (queueUrl) await sqs.send(new DeleteQueueCommand({ QueueUrl: queueUrl })).catch(() => {});
  }
  return results;
}

const targets = (process.env.ORB_PARITY_TARGETS ?? "localstack,aws").split(",");
const gates: Gate[] = [
  {
    tier: 4,
    name: "aws-parity:billing-contract",
    async run() {
      const local = targets.includes("localstack") ? await contract(localstack) : [];
      if (!targets.includes("aws")) {
        const failed = local.filter((s) => !s.ok);
        return failed.length
          ? { status: "fail", detail: `LocalStack contract failed: ${failed.map((s) => `${s.step}: ${s.detail}`).join("; ")}` }
          : skip(`LocalStack contract passed all ${local.length} steps; real AWS not requested (ORB_PARITY_TARGETS)`);
      }
      const cloud = await contract(aws);
      const r = compareContracts(local, cloud);
      return r.ok
        ? { status: "pass", detail: `billing S3/SQS contract identical on LocalStack and AWS ${aws.region}` }
        : { status: "fail", detail: r.differences.join("; ") };
    },
  },
  {
    tier: 4,
    name: "aws-parity:xeventbus-claim",
    run: async () => skip("XEventBus has no Composition yet (crossplane/localstack/ is planning), so the same claim cannot be reconciled against both ProviderConfigs"),
  },
];
finish("tier4-aws-parity", await runGates(gates));
