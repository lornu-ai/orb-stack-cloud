import { describe, expect, test } from "bun:test";
import {
  isOrbStackProcess,
  parseIperf3Bps,
  parsePsRows,
  parsePsTime,
  parseSysbenchEventsPerSecond,
  parseVmStat,
  percentile,
  vmStatFreeBytes,
} from "./parse";

const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                              100000.
Pages active:                            2000000.
Pages speculative:                         5000.
"Translation faults":                  123456789.
`;

describe("parseVmStat", () => {
  test("reads page size and counts, including quoted labels", () => {
    const v = parseVmStat(VM_STAT);
    expect(v.pageSize).toBe(16384);
    expect(v.pages["Pages free"]).toBe(100000);
    expect(v.pages["Translation faults"]).toBe(123456789);
  });

  test("free bytes include speculative pages", () => {
    expect(vmStatFreeBytes(parseVmStat(VM_STAT))).toBe(105000 * 16384);
  });

  test("rejects output without a page-size header", () => {
    expect(() => parseVmStat("Pages free: 1.")).toThrow("page size");
  });
});

describe("parseIperf3Bps", () => {
  test("returns received bits per second", () => {
    expect(parseIperf3Bps(JSON.stringify({ end: { sum_received: { bits_per_second: 4.2e10 } } }))).toBe(4.2e10);
  });

  test("surfaces iperf3's own error field", () => {
    expect(() => parseIperf3Bps(JSON.stringify({ error: "unable to connect" }))).toThrow("unable to connect");
  });

  test("rejects reports without a receive summary", () => {
    expect(() => parseIperf3Bps("{}")).toThrow("bits_per_second");
  });
});

describe("parseSysbenchEventsPerSecond", () => {
  test("extracts the CPU speed line", () => {
    expect(parseSysbenchEventsPerSecond("CPU speed:\n    events per second:  1234.56\n")).toBe(1234.56);
  });

  test("rejects unrelated output", () => {
    expect(() => parseSysbenchEventsPerSecond("nope")).toThrow("events per second");
  });
});

describe("parsePsTime", () => {
  test.each([
    ["3:43.11", 223.11],
    ["01:02:03", 3723],
    ["2-00:00:01", 172801],
  ])("%s → %d seconds", (input, expected) => {
    expect(parsePsTime(input)).toBeCloseTo(expected, 5);
  });

  test("rejects garbage", () => {
    expect(() => parsePsTime("a:b")).toThrow("cannot parse");
  });
});

describe("parsePsRows", () => {
  test("keeps commands containing spaces and skips blank lines", () => {
    const rows = parsePsRows(
      "18470   3:43.11 7743568 /Applications/OrbStack.app/Contents/Frameworks/OrbStack Helper.app/Contents/MacOS/OrbStack Helper\n\n  1 0:01.00 100 /sbin/launchd\n",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      pid: 18470,
      cpuSeconds: 223.11,
      rssKiB: 7743568,
      command: "/Applications/OrbStack.app/Contents/Frameworks/OrbStack Helper.app/Contents/MacOS/OrbStack Helper",
    });
  });

  test("identifies OrbStack processes only", () => {
    const rows = parsePsRows(
      "1 0:01.00 1 /Applications/OrbStack.app/Contents/MacOS/OrbStack\n2 0:01.00 1 /usr/libexec/trustd\n",
    );
    expect(rows.filter((r) => isOrbStackProcess(r.command)).map((r) => r.pid)).toEqual([1]);
  });
});

describe("percentile", () => {
  test("interpolates between ranks", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([5, 1, 3], 100)).toBe(5);
    expect(percentile([7], 95)).toBe(7);
  });

  test("rejects empty samples", () => {
    expect(() => percentile([], 50)).toThrow("empty");
  });
});
