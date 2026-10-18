import type { GateResult } from "./gates";
import type { RunMeta } from "./report";

/** One wide row per run, in the `orbstack_ci.nfr_benchmarks` layout from issue #7 (Story T6.2). */
export interface NfrSummaryRow {
  timestamp: string;
  run_id: string;
  git_sha: string;
  host: string;
  boot_ms: number | null;
  idle_cpu_pct: number | null;
  ram_reclaim_pct: number | null;
  trim_reclaimed_kb: number | null;
  virtio_net_gbps: number | null;
  rosetta_speedup_x: number | null;
  passed: boolean;
}

/** Gate name → summary column, with the conversion from the gate's measured unit. */
const COLUMNS: Record<string, [keyof NfrSummaryRow, (measured: number) => number]> = {
  "machine-boot": ["boot_ms", (ms) => ms],
  "idle-cpu": ["idle_cpu_pct", (pct) => pct],
  "memory-balloon": ["ram_reclaim_pct", (fraction) => fraction * 100],
  "apfs-trim": ["trim_reclaimed_kb", (gb) => (gb * 1e9) / 1024],
  "virtio-net": ["virtio_net_gbps", (gbps) => gbps],
  "rosetta-vs-qemu": ["rosetta_speedup_x", (x) => x],
};

/** Only measured gates fill a column; skipped or errored gates leave it null. */
export function nfrSummaryRow(meta: RunMeta, results: GateResult[], now = new Date()): NfrSummaryRow {
  const row: NfrSummaryRow = {
    timestamp: now.toISOString(),
    run_id: meta.runId,
    git_sha: meta.gitSha,
    host: meta.host,
    boot_ms: null,
    idle_cpu_pct: null,
    ram_reclaim_pct: null,
    trim_reclaimed_kb: null,
    virtio_net_gbps: null,
    rosetta_speedup_x: null,
    passed: results.every((r) => r.status === "pass"),
  };
  for (const r of results) {
    const column = COLUMNS[r.gate];
    if (!column || r.measured === undefined || (r.status !== "pass" && r.status !== "fail")) continue;
    const [key, convert] = column;
    (row as unknown as Record<string, number>)[key] = Math.round(convert(r.measured) * 1000) / 1000;
  }
  return row;
}
