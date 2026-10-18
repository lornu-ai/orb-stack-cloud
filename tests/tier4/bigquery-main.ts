import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BQ, insertAllBody, insertAllUrl, insertErrors, parseNdjson } from "./bigquery";

/**
 * Streams per-gate rows (results/*.ndjson) and the per-run summary row into BigQuery.
 * The dataset and tables are cloud infrastructure and must already exist.
 */
const project = process.env.GCP_PROJECT_ID;
const token = process.env.GCP_ACCESS_TOKEN;
if (!project || !token) throw new Error("GCP_PROJECT_ID and GCP_ACCESS_TOKEN are required");
const dir = process.env.ORB_RESULTS_DIR ?? "results";

async function insert(table: string, rows: Record<string, unknown>[], idOf: (r: Record<string, unknown>) => string): Promise<void> {
  if (rows.length === 0) return;
  const res = await fetch(insertAllUrl(project!, BQ.dataset, table), {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(insertAllBody(rows, idOf)),
  });
  const body = (await res.json()) as Parameters<typeof insertErrors>[0] & { error?: unknown };
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status} ${JSON.stringify(body.error)}`);
  const errors = insertErrors(body);
  if (errors.length) throw new Error(`${table}: ${errors.join("; ")}`);
  console.log(`${table}: inserted ${rows.length} rows`);
}

const files = readdirSync(dir).filter((f) => f.endsWith(".ndjson"));
const gateRows = files.filter((f) => f !== "nfr-summary.ndjson").flatMap((f) => parseNdjson(readFileSync(join(dir, f), "utf8")));
const summaryRows = files.includes("nfr-summary.ndjson") ? parseNdjson(readFileSync(join(dir, "nfr-summary.ndjson"), "utf8")) : [];

await insert(BQ.gateTable, gateRows, (r) => `${r.run_id}:${r.suite}:${r.gate}`);
await insert(BQ.summaryTable, summaryRows, (r) => `${r.run_id}:${r.host}`);
