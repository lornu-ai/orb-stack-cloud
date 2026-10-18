import { describe, expect, test } from "bun:test";
import type { GateResult } from "./gates";
import { runMeta } from "./report";
import { nfrSummaryRow } from "./summary";

const r = (gate: string, status: GateResult["status"], measured?: number): GateResult => ({
  tier: 2,
  gate,
  status,
  measured,
  detail: "",
  startedAt: "",
  durationMs: 0,
});

describe("nfrSummaryRow", () => {
  const meta = runMeta("tier2-engine", { GITHUB_RUN_ID: "7", GITHUB_SHA: "abc", RUNNER_NAME: "mac" });
  const now = new Date("2026-10-18T14:00:00Z");

  test("maps measured gates to columns with unit conversion", () => {
    const row = nfrSummaryRow(
      meta,
      [r("machine-boot", "pass", 210), r("memory-balloon", "pass", 0.95), r("apfs-trim", "fail", 2.048), r("virtio-net", "pass", 41.2)],
      now,
    );
    expect(row).toMatchObject({
      timestamp: "2026-10-18T14:00:00.000Z",
      run_id: "7",
      git_sha: "abc",
      boot_ms: 210,
      ram_reclaim_pct: 95,
      trim_reclaimed_kb: 2000000,
      virtio_net_gbps: 41.2,
      rosetta_speedup_x: null,
      passed: false,
    });
  });

  test("skipped and errored gates leave their column null", () => {
    const row = nfrSummaryRow(meta, [r("rosetta-vs-qemu", "skip"), r("idle-cpu", "error", 5)], now);
    expect(row.rosetta_speedup_x).toBeNull();
    expect(row.idle_cpu_pct).toBeNull();
  });

  test("passed is true only when every gate passed", () => {
    expect(nfrSummaryRow(meta, [r("machine-boot", "pass", 1)], now).passed).toBe(true);
    expect(nfrSummaryRow(meta, [r("unknown-gate", "pass", 1)], now).passed).toBe(true);
  });
});
