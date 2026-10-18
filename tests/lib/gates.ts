export type GateStatus = "pass" | "fail" | "skip" | "error";

export type Comparator = "<" | "<=" | ">" | ">=";

export interface Threshold {
  op: Comparator;
  limit: number;
  unit: string;
}

export interface GateOutcome {
  status: GateStatus;
  detail: string;
  measured?: number;
  threshold?: Threshold;
  /** Extra numbers worth keeping in the report (p95, raw samples, controls). */
  metrics?: Record<string, number | string | boolean>;
}

export interface GateResult extends GateOutcome {
  tier: number;
  gate: string;
  startedAt: string;
  durationMs: number;
}

export interface Gate {
  tier: number;
  name: string;
  run(): Promise<GateOutcome>;
}

export function compare(measured: number, threshold: Threshold): boolean {
  switch (threshold.op) {
    case "<":
      return measured < threshold.limit;
    case "<=":
      return measured <= threshold.limit;
    case ">":
      return measured > threshold.limit;
    case ">=":
      return measured >= threshold.limit;
  }
}

export function formatThreshold(t: Threshold): string {
  return `${t.op} ${t.limit}${t.unit ? ` ${t.unit}` : ""}`;
}

/** Build a pass/fail outcome from a measurement against a threshold. */
export function measuredOutcome(
  measured: number,
  threshold: Threshold,
  detail: string,
  metrics?: GateOutcome["metrics"],
): GateOutcome {
  const ok = compare(measured, threshold);
  return {
    status: ok ? "pass" : "fail",
    measured,
    threshold,
    metrics,
    detail: `${detail}: measured ${round(measured)} ${threshold.unit} (gate ${formatThreshold(threshold)})`,
  };
}

export function skip(detail: string): GateOutcome {
  return { status: "skip", detail };
}

export function round(n: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export async function runGates(
  gates: Gate[],
  log: (line: string) => void = console.log,
): Promise<GateResult[]> {
  const results: GateResult[] = [];
  for (const gate of gates) {
    const startedAt = new Date().toISOString();
    const t0 = performance.now();
    let outcome: GateOutcome;
    try {
      outcome = await gate.run();
    } catch (err) {
      outcome = { status: "error", detail: err instanceof Error ? err.message : String(err) };
    }
    const result: GateResult = {
      tier: gate.tier,
      gate: gate.name,
      startedAt,
      durationMs: Math.round(performance.now() - t0),
      ...outcome,
    };
    results.push(result);
    log(`[tier ${gate.tier}] ${result.status.toUpperCase().padEnd(5)} ${gate.name} — ${result.detail}`);
  }
  return results;
}

export interface Summary {
  pass: number;
  fail: number;
  skip: number;
  error: number;
  ok: boolean;
}

/**
 * A skipped gate is never a pass. In strict mode (CI) any skip fails the run, so a
 * gate cannot go quiet because its dependency disappeared.
 */
export function summarize(results: GateResult[], strict: boolean): Summary {
  const count = (s: GateStatus) => results.filter((r) => r.status === s).length;
  const summary = { pass: count("pass"), fail: count("fail"), skip: count("skip"), error: count("error") };
  const ok = summary.fail === 0 && summary.error === 0 && (!strict || summary.skip === 0);
  return { ...summary, ok };
}
