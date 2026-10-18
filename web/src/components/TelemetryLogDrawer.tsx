import type { TelemetryLine } from "../types/telemetry";

type Props = { lines: TelemetryLine[]; open: boolean; onToggle: () => void };

export function TelemetryLogDrawer({ lines, open, onToggle }: Props) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-5 py-3 flex items-center justify-between font-mono text-sm text-zinc-200 hover:bg-zinc-900/60"
      >
        Live telemetry (cloud-init · BigQuery sink · GHA)
        <span className="text-zinc-500 text-xs">{open ? "collapse" : "expand"}</span>
      </button>
      {open && (
        <div className="max-h-48 overflow-y-auto px-5 pb-4 font-mono text-[11px] space-y-1 text-zinc-400">
          {lines.map((line, i) => (
            <div key={`${line.ts}-${i}`} className="flex gap-2">
              <span className="text-zinc-600 shrink-0">{line.ts}</span>
              <span className="text-emerald-600/80 shrink-0">[{line.source}]</span>
              <span className="text-zinc-300">{line.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
