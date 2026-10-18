export interface StepResult {
  step: string;
  ok: boolean;
  detail: string;
}

export const CONTRACT_STEPS = ["create-bucket", "put-invoice", "get-invoice", "create-queue", "send-event", "receive-event"] as const;

/**
 * Parity means the billing contract behaves identically: every step succeeds on both
 * targets, in the same order. Differences are reported step by step.
 */
export function compareContracts(local: StepResult[], cloud: StepResult[]): { ok: boolean; differences: string[] } {
  const differences: string[] = [];
  for (const step of CONTRACT_STEPS) {
    const a = local.find((s) => s.step === step);
    const b = cloud.find((s) => s.step === step);
    if (!a?.ok || !b?.ok) {
      differences.push(`${step}: localstack=${a ? (a.ok ? "ok" : a.detail) : "not run"}, aws=${b ? (b.ok ? "ok" : b.detail) : "not run"}`);
    }
  }
  return { ok: differences.length === 0, differences };
}

export function resourceNames(runId: string): { bucket: string; queue: string } {
  const id = runId.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return { bucket: `invoices-archive-${id}`.slice(0, 63), queue: `billing-events-${id}`.slice(0, 80) };
}
