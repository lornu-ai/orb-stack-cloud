import { ShieldOff } from "lucide-react";
import type { IsolationCheck } from "../types/telemetry";

type Props = { checks: IsolationCheck[] };

export function SecurityIsolationCard({ checks }: Props) {
  const passed = checks.every((c) => c.blocked);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-mono text-sm font-semibold text-zinc-200 flex items-center gap-2">
          <ShieldOff className="h-4 w-4 text-zinc-400" />
          Tier 5 — Isolation Fuzzing
        </h2>
        <span
          className={`font-mono text-xs px-2 py-0.5 rounded border ${
            passed
              ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
              : "text-amber-400 border-amber-500/30 bg-amber-500/10"
          }`}
        >
          {passed ? "ALL VECTORS BLOCKED" : "REGRESSION"}
        </span>
      </div>
      <ul className="space-y-2 font-mono text-xs">
        {checks.map((c) => (
          <li key={c.vector} className="flex justify-between gap-4 text-zinc-300 border-b border-zinc-800/60 pb-2">
            <span className="text-zinc-400">{c.vector}</span>
            <code className="text-zinc-500 truncate max-w-[50%]">{c.command}</code>
            <span className={c.blocked ? "text-emerald-400" : "text-red-400"}>{c.blocked ? "blocked" : "leak"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
