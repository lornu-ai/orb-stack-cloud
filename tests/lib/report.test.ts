import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GateResult } from "./gates";
import { runMeta, toNdjson, toRows, writeReport } from "./report";

const results: GateResult[] = [
  {
    tier: 2,
    gate: "boot",
    status: "pass",
    measured: 210,
    threshold: { op: "<", limit: 300, unit: "ms" },
    metrics: { restartMs: 90 },
    detail: "ok",
    startedAt: "2026-10-18T00:00:00.000Z",
    durationMs: 5,
  },
  { tier: 2, gate: "net", status: "skip", detail: "no iperf3", startedAt: "2026-10-18T00:00:01.000Z", durationMs: 0 },
];

describe("runMeta", () => {
  test("uses GitHub Actions identifiers when present", () => {
    const meta = runMeta("engine", {
      GITHUB_RUN_ID: "42",
      GITHUB_SHA: "abc",
      RUNNER_NAME: "mac-1",
      GITHUB_ACTIONS: "true",
    });
    expect(meta).toEqual({ suite: "engine", runId: "42", gitSha: "abc", host: "mac-1", ciProvider: "github-actions" });
  });

  test("falls back to a local run id", () => {
    expect(runMeta("engine", {}).runId).toStartWith("local-");
  });
});

describe("toRows", () => {
  test("flattens thresholds and serializes metrics", () => {
    const [boot, net] = toRows(runMeta("engine", { GITHUB_RUN_ID: "1" }), results);
    expect(boot).toMatchObject({ gate: "boot", measured: 210, unit: "ms", threshold_op: "<", threshold_limit: 300 });
    expect(boot?.metrics_json).toBe('{"restartMs":90}');
    expect(net).toMatchObject({ measured: null, unit: null, metrics_json: null });
  });
});

describe("writeReport", () => {
  test("writes one JSON object per line", () => {
    const dir = mkdtempSync(join(tmpdir(), "orb-report-"));
    const path = writeReport(dir, runMeta("engine", {}), results);
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1] as string).status).toBe("skip");
  });

  test("an empty result set produces an empty file", () => {
    expect(toNdjson([])).toBe("");
  });
});
