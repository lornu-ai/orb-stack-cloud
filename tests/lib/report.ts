import { mkdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { summarize, type GateResult } from "./gates";
import { nfrSummaryRow } from "./summary";

export interface RunMeta {
  suite: string;
  runId: string;
  gitSha: string;
  host: string;
  ciProvider: string;
}

export function runMeta(suite: string, env: Record<string, string | undefined> = process.env): RunMeta {
  return {
    suite,
    runId: env.GITHUB_RUN_ID ?? `local-${Date.now()}`,
    gitSha: env.GITHUB_SHA ?? "local",
    host: env.RUNNER_NAME ?? hostname(),
    ciProvider: env.GITHUB_ACTIONS === "true" ? "github-actions" : "local",
  };
}

/** One flat row per gate, shaped for BigQuery `orbstack_ci.nfr_benchmarks`. */
export interface ReportRow {
  suite: string;
  run_id: string;
  git_sha: string;
  host: string;
  ci_provider: string;
  tier: number;
  gate: string;
  status: string;
  measured: number | null;
  unit: string | null;
  threshold_op: string | null;
  threshold_limit: number | null;
  detail: string;
  metrics_json: string | null;
  started_at: string;
  duration_ms: number;
}

export function toRows(meta: RunMeta, results: GateResult[]): ReportRow[] {
  return results.map((r) => ({
    suite: meta.suite,
    run_id: meta.runId,
    git_sha: meta.gitSha,
    host: meta.host,
    ci_provider: meta.ciProvider,
    tier: r.tier,
    gate: r.gate,
    status: r.status,
    measured: r.measured ?? null,
    unit: r.threshold?.unit ?? null,
    threshold_op: r.threshold?.op ?? null,
    threshold_limit: r.threshold?.limit ?? null,
    detail: r.detail,
    metrics_json: r.metrics ? JSON.stringify(r.metrics) : null,
    started_at: r.startedAt,
    duration_ms: r.durationMs,
  }));
}

export function toNdjson(rows: ReportRow[]): string {
  return rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
}

export function writeReport(dir: string, meta: RunMeta, results: GateResult[]): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${meta.suite}.ndjson`);
  writeFileSync(path, toNdjson(toRows(meta, results)));
  return path;
}

/**
 * Shared tail for every suite entrypoint: write NDJSON, print summary, set exit code.
 * `nfrSummary` also writes the one-row-per-run `nfr-summary.ndjson` for BigQuery.
 */
export function finish(suite: string, results: GateResult[], opts: { nfrSummary?: boolean } = {}, argv: string[] = process.argv): void {
  const strict = argv.includes("--strict") || process.env.ORB_VERIFY_STRICT === "1";
  const meta = runMeta(suite);
  const dir = process.env.ORB_RESULTS_DIR ?? "results";
  const path = writeReport(dir, meta, results);
  if (opts.nfrSummary) writeFileSync(join(dir, "nfr-summary.ndjson"), `${JSON.stringify(nfrSummaryRow(meta, results))}\n`);
  const s = summarize(results, strict);
  console.log(
    `\n${suite}: ${s.pass} pass, ${s.fail} fail, ${s.skip} skip, ${s.error} error${strict ? " (strict)" : ""} → ${path}`,
  );
  process.exitCode = s.ok ? 0 : 1;
}
