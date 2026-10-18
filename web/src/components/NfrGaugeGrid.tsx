import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { NfrMetric } from "../types/telemetry";

type Props = { metrics: NfrMetric[] };

export function NfrGaugeGrid({ metrics }: Props) {
  return (
    <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {metrics.map((m) => (
        <div
          key={m.id}
          className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">{m.label}</span>
            {m.passed ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-400" />
            )}
          </div>
          <div className="my-3 font-mono text-2xl font-bold text-zinc-100">{m.value}</div>
          <div className="flex items-center justify-between font-mono text-xs text-zinc-500">
            <span>SLA: {m.slaTarget}</span>
            <span className="text-emerald-400">{m.delta}</span>
          </div>
        </div>
      ))}
    </section>
  );
}
