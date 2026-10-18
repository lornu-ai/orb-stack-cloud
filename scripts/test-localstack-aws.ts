/**
 * CI: Epic 7.3 smoke — S3 bucket + SQS queue on LocalStack (mirrors future XEventBus AC).
 */
const endpoint = process.env.LOCALSTACK_ENDPOINT ?? "http://127.0.0.1:4566";
const region = process.env.AWS_DEFAULT_REGION ?? "us-east-1";
const bucket = process.env.TEST_S3_BUCKET ?? "invoices-archive";
const queueName = process.env.TEST_SQS_QUEUE ?? "billing-events";

async function waitForLocalStack(maxMs = 120_000): Promise<void> {
  const start = Date.now();
  while Date.now() - start < maxMs) {
    try {
      const r = await fetch(`${endpoint}/_localstack/health`);
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await Bun.sleep(2000);
  }
  throw new Error(`LocalStack not healthy at ${endpoint} within ${maxMs}ms`);
}

async function createBucket(): Promise<void> {
  const url = `${endpoint}/${bucket}`;
  const r = await fetch(url, {
    method: "PUT",
    headers: { Authorization: "AWS4-HMAC-SHA256 Credential=test/20260101/us-east-1/s3/aws4_request" },
  });
  if (!r.ok && r.status !== 409) {
    const t = await r.text();
    throw new Error(`S3 create bucket failed: ${r.status} ${t}`);
  }
}

async function listBuckets(): Promise<string[]> {
  const r = await fetch(endpoint, { method: "GET" });
  const text = await r.text();
  if (!r.ok) throw new Error(`S3 list buckets: ${r.status} ${text}`);
  const names = [...text.matchAll(/<Name>([^<]+)<\/Name>/g)].map((m) => m[1]!);
  return names;
}

async function createQueue(): Promise<void> {
  const params = new URLSearchParams({ Action: "CreateQueue", QueueName: queueName, Version: "2012-11-05" });
  const r = await fetch(`${endpoint}/?${params}`, { method: "POST" });
  const text = await r.text();
  if (!r.ok && !text.includes("QueueAlreadyExists")) {
    throw new Error(`SQS create queue: ${r.status} ${text}`);
  }
}

async function listQueues(): Promise<string[]> {
  const params = new URLSearchParams({ Action: "ListQueues", Version: "2012-11-05" });
  const r = await fetch(`${endpoint}/?${params}`, { method: "POST" });
  const text = await r.text();
  if (!r.ok) throw new Error(`SQS list queues: ${r.status} ${text}`);
  return [...text.matchAll(/<QueueUrl>([^<]+)<\/QueueUrl>/g)].map((m) => m[1]!);
}

async function main(): Promise<void> {
  await waitForLocalStack();
  await createBucket();
  await createQueue();
  const buckets = await listBuckets();
  const queues = await listQueues();
  if (!buckets.includes(bucket)) throw new Error(`bucket ${bucket} not in list: ${buckets.join(",")}`);
  if (!queues.some((q) => q.includes(queueName))) {
    throw new Error(`queue ${queueName} not found in ${queues.join(",")}`);
  }
  console.log(JSON.stringify({ ok: true, endpoint, region, bucket, queueName, buckets, queues }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
