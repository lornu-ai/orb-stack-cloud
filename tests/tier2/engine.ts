import { isOrbStackProcess, percentile, type PsRow } from "../lib/parse";

/** Gate limits from issue #7 (Epic T3), which tightens issue #6 Tier 2. */
export const LIMITS = {
  idleCpuPercent: 0.1,
  bootIterations: 5,
  bootP95Ms: 300,
  balloonBytes: 4 * 1024 ** 3,
  balloonFraction: 0.9,
  balloonSeconds: 10,
  trimWriteBytes: 3 * 1024 ** 3,
  trimReclaimBytes: 2.5e9,
  trimSeconds: 5,
  inotifyWrites: 50,
  inotifyP95Ms: 10,
  netGbps: 35,
  rosettaSpeedup: 3,
};

export interface IdleCpu {
  /** Percent of one core (how Activity Monitor reports %CPU). This is what the gate uses. */
  singleCorePercent: number;
  /** Percent of the whole host (all logical CPUs). */
  hostPercent: number;
  cpuSeconds: number;
}

/** CPU consumed by OrbStack processes between two `ps` snapshots. */
export function idleCpu(before: PsRow[], after: PsRow[], wallSeconds: number, logicalCpus: number): IdleCpu {
  const start = new Map(before.filter((r) => isOrbStackProcess(r.command)).map((r) => [r.pid, r.cpuSeconds]));
  let cpuSeconds = 0;
  for (const r of after) {
    if (!isOrbStackProcess(r.command)) continue;
    cpuSeconds += r.cpuSeconds - (start.get(r.pid) ?? 0);
  }
  const singleCorePercent = (cpuSeconds / wallSeconds) * 100;
  return { singleCorePercent, hostPercent: singleCorePercent / logicalCpus, cpuSeconds };
}

/** The process holding guest memory is the largest-RSS OrbStack process (OrbStack Helper). */
export function vmProcess(rows: PsRow[]): PsRow | undefined {
  return rows.filter((r) => isOrbStackProcess(r.command)).sort((a, b) => b.rssKiB - a.rssKiB)[0];
}

export interface RssSample {
  /** Seconds since the workload exited. Negative while it was still running. */
  t: number;
  rssKiB: number;
}

export interface BalloonResult {
  grewKiB: number;
  /** Fraction of the growth returned to macOS by the end of the window. */
  fraction: number;
  /** Seconds after exit until 90% of the growth was returned; undefined if never. */
  secondsTo90: number | undefined;
}

export function balloonReclaim(baselineKiB: number, samples: RssSample[]): BalloonResult {
  if (samples.length === 0) throw new Error("no RSS samples");
  const peak = Math.max(...samples.map((s) => s.rssKiB));
  const grew = peak - baselineKiB;
  if (grew <= 0) return { grewKiB: grew, fraction: 0, secondsTo90: undefined };
  const after = samples.filter((s) => s.t >= 0);
  const last = after[after.length - 1] ?? samples[samples.length - 1]!;
  const reclaimed = (s: RssSample) => (peak - s.rssKiB) / grew;
  const hit = after.find((s) => reclaimed(s) >= LIMITS.balloonFraction);
  return { grewKiB: grew, fraction: reclaimed(last), secondsTo90: hit?.t };
}

/** Host free-space deltas around a guest write → delete → fstrim cycle. */
export function trimReclaim(freeBefore: number, freeAfterWrite: number, freeAfterTrim: number): {
  consumedBytes: number;
  reclaimedBytes: number;
  fraction: number;
} {
  const consumed = freeBefore - freeAfterWrite;
  const reclaimed = freeAfterTrim - freeAfterWrite;
  return { consumedBytes: consumed, reclaimedBytes: reclaimed, fraction: consumed > 0 ? reclaimed / consumed : 0 };
}

export function latencyStats(samplesMs: number[]): { p50: number; p95: number; max: number; n: number } {
  return { p50: percentile(samplesMs, 50), p95: percentile(samplesMs, 95), max: Math.max(...samplesMs), n: samplesMs.length };
}

export interface ClockSample {
  /** Host epoch ms immediately before and after asking the guest for its clock. */
  hostBeforeMs: number;
  hostAfterMs: number;
  guestMs: number;
}

/**
 * NTP-style offset (guest − host) from the lowest round-trip sample. Half that
 * round trip bounds the error of every latency computed with it.
 */
export function clockOffset(samples: ClockSample[]): { offsetMs: number; uncertaintyMs: number } {
  if (samples.length === 0) throw new Error("no clock samples");
  const best = samples.reduce((a, b) => (b.hostAfterMs - b.hostBeforeMs < a.hostAfterMs - a.hostBeforeMs ? b : a));
  return {
    offsetMs: best.guestMs - (best.hostBeforeMs + best.hostAfterMs) / 2,
    uncertaintyMs: (best.hostAfterMs - best.hostBeforeMs) / 2,
  };
}

/** Watcher output line: "<guest epoch ns> <file>". */
export function parseWatchLine(line: string): { guestMs: number; file: string } | undefined {
  const m = line.trim().match(/^(\d{16,})\s+(.+)$/);
  return m?.[1] && m[2] ? { guestMs: Number(m[1]) / 1e6, file: m[2] } : undefined;
}
