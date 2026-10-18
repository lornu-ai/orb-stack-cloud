import { Radio, ShieldCheck } from "lucide-react";
import type { IngressPath } from "../types/telemetry";

type Props = {
  activePath: IngressPath;
  onSelectPath: (path: IngressPath) => void;
  runId: string;
};

export function TopNavHeader({ activePath, onSelectPath, runId }: Props) {
  const paths: { id: IngressPath; label: string; host: string }[] = [
    { id: "orb-local", label: "Path A: Orb Local", host: "osc.k8s.orb.local" },
    { id: "tailscale-mesh", label: "Path B: Tailnet", host: "orb-api.ts.net" },
    { id: "cloudflare-zt", label: "Path C: CF Zero Trust", host: "osc.stvedores.org" },
  ];

  return (
    <header className="border-b border-zinc-800 bg-zinc-950 px-6 py-4 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse" />
        <span className="font-mono text-lg font-bold tracking-tight text-zinc-100">osc.stvedores.org</span>
        <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-400">run #{runId}</span>
      </div>

      <div className="flex items-center rounded-lg bg-zinc-900 p-1 border border-zinc-800">
        {paths.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelectPath(p.id)}
            className={`px-3 py-1.5 rounded-md font-mono text-xs transition-colors ${
              activePath === p.id
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <div>{p.label}</div>
            <div className="text-[10px] opacity-75">{p.host}</div>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-4 font-mono text-xs">
        <span className="flex items-center gap-1.5 text-emerald-400">
          <Radio className="h-3.5 w-3.5" /> Tailscale: Connected
        </span>
        <span className="flex items-center gap-1.5 text-emerald-400">
          <ShieldCheck className="h-3.5 w-3.5" /> CF Access: Active
        </span>
      </div>
    </header>
  );
}
