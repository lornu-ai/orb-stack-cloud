import { describe, expect, test } from "bun:test";
import type { PsRow } from "../lib/parse";
import { balloonReclaim, clockOffset, idleCpu, latencyStats, parseWatchLine, trimReclaim, vmProcess } from "./engine";

const HELPER = "/Applications/OrbStack.app/Contents/Frameworks/OrbStack Helper.app/Contents/MacOS/OrbStack Helper";
const row = (pid: number, cpuSeconds: number, rssKiB: number, command = HELPER): PsRow => ({ pid, cpuSeconds, rssKiB, command });

describe("idleCpu", () => {
  test("sums OrbStack CPU deltas and ignores other processes", () => {
    const before = [row(1, 10, 0), row(2, 5, 0, "/usr/bin/other")];
    const after = [row(1, 10.06, 0), row(2, 50, 0, "/usr/bin/other")];
    const r = idleCpu(before, after, 60, 16);
    expect(r.cpuSeconds).toBeCloseTo(0.06, 6);
    expect(r.singleCorePercent).toBeCloseTo(0.1, 6);
    expect(r.hostPercent).toBeCloseTo(0.1 / 16, 6);
  });

  test("a process that appears mid-window counts from zero", () => {
    expect(idleCpu([], [row(9, 0.6, 0)], 60, 1).cpuSeconds).toBeCloseTo(0.6, 6);
  });
});

describe("vmProcess", () => {
  test("picks the largest OrbStack process", () => {
    expect(vmProcess([row(1, 0, 100), row(2, 0, 9000), row(3, 0, 99999, "/sbin/launchd")])?.pid).toBe(2);
  });
});

describe("balloonReclaim", () => {
  test("measures fraction returned and time to 90%", () => {
    const r = balloonReclaim(1000, [
      { t: -1, rssKiB: 7000 },
      { t: 0, rssKiB: 7000 },
      { t: 2, rssKiB: 3000 },
      { t: 4, rssKiB: 1500 },
      { t: 6, rssKiB: 1200 },
    ]);
    expect(r.grewKiB).toBe(6000);
    expect(r.secondsTo90).toBe(4);
    expect(r.fraction).toBeCloseTo(5800 / 6000, 6);
  });

  test("a workload that never grew memory reclaims nothing", () => {
    expect(balloonReclaim(5000, [{ t: 0, rssKiB: 4000 }])).toEqual({ grewKiB: -1000, fraction: 0, secondsTo90: undefined });
  });

  test("rejects an empty sample set", () => {
    expect(() => balloonReclaim(0, [])).toThrow("no RSS samples");
  });
});

describe("trimReclaim", () => {
  test("fraction of consumed space returned after fstrim", () => {
    expect(trimReclaim(100, 60, 96)).toEqual({ consumedBytes: 40, reclaimedBytes: 36, fraction: 0.9 });
  });

  test("no consumption means nothing to reclaim", () => {
    expect(trimReclaim(100, 100, 100).fraction).toBe(0);
  });
});

describe("latency helpers", () => {
  test("latencyStats", () => {
    expect(latencyStats([1, 2, 3, 4, 100])).toMatchObject({ p50: 3, max: 100, n: 5 });
  });

  test("parseWatchLine", () => {
    expect(parseWatchLine("1792332121123456789 probe.txt\n")).toEqual({ guestMs: 1792332121123.4568, file: "probe.txt" });
    expect(parseWatchLine("READY")).toBeUndefined();
  });

  test("clockOffset uses the lowest round-trip sample", () => {
    const r = clockOffset([
      { hostBeforeMs: 1000, hostAfterMs: 1040, guestMs: 1100 },
      { hostBeforeMs: 2000, hostAfterMs: 2010, guestMs: 2017 },
    ]);
    expect(r).toEqual({ offsetMs: 12, uncertaintyMs: 5 });
    expect(() => clockOffset([])).toThrow("no clock samples");
  });
});
