import { describe, expect, test } from "bun:test";
import { compare, measuredOutcome, runGates, skip, summarize, type Gate, type GateResult } from "./gates";

describe("compare", () => {
  test.each([
    [1, "<", 2, true],
    [2, "<", 2, false],
    [2, "<=", 2, true],
    [3, ">", 2, true],
    [2, ">=", 2, true],
    [1, ">=", 2, false],
  ] as const)("%d %s %d → %p", (measured, op, limit, expected) => {
    expect(compare(measured, { op, limit, unit: "" })).toBe(expected);
  });
});

describe("measuredOutcome", () => {
  test("passes and records the threshold", () => {
    const o = measuredOutcome(120, { op: "<", limit: 300, unit: "ms" }, "boot");
    expect(o.status).toBe("pass");
    expect(o.measured).toBe(120);
    expect(o.detail).toContain("gate < 300 ms");
  });

  test("fails when the limit is exceeded", () => {
    expect(measuredOutcome(301, { op: "<", limit: 300, unit: "ms" }, "boot").status).toBe("fail");
  });
});

describe("runGates", () => {
  test("converts a thrown error into an error result and keeps going", async () => {
    const gates: Gate[] = [
      {
        tier: 2,
        name: "explodes",
        run: async () => {
          throw new Error("boom");
        },
      },
      { tier: 2, name: "skips", run: async () => skip("no iperf3") },
    ];
    const lines: string[] = [];
    const results = await runGates(gates, (l) => lines.push(l));
    expect(results.map((r) => r.status)).toEqual(["error", "skip"]);
    expect(results[0]?.detail).toBe("boom");
    expect(lines[1]).toContain("SKIP");
  });
});

describe("summarize", () => {
  const result = (status: GateResult["status"]): GateResult => ({
    tier: 1,
    gate: status,
    status,
    detail: "",
    startedAt: "",
    durationMs: 0,
  });

  test("a skip is not a failure outside strict mode", () => {
    expect(summarize([result("pass"), result("skip")], false).ok).toBe(true);
  });

  test("a skip fails the run in strict mode", () => {
    expect(summarize([result("pass"), result("skip")], true).ok).toBe(false);
  });

  test("errors and failures always fail", () => {
    expect(summarize([result("error")], false).ok).toBe(false);
    expect(summarize([result("fail")], false)).toMatchObject({ fail: 1, ok: false });
  });
});
