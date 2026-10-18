import type { CrossplaneClaim } from "../types/telemetry";

type Props = { claims: CrossplaneClaim[] };

export function CrossplaneTopology({ claims }: Props) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
      <div className="border-b border-zinc-800 px-5 py-3 flex items-center justify-between">
        <h2 className="font-mono text-sm font-semibold text-zinc-200">Crossplane 3-Tier Claims & Mesh Endpoints</h2>
        <span className="font-mono text-xs text-zinc-400">provider-upjet-aws / cloudflare</span>
      </div>
      <table className="w-full text-left border-collapse font-mono text-xs">
        <thead>
          <tr className="border-b border-zinc-800 text-zinc-400 bg-zinc-950/40">
            <th className="py-3 px-4">Claim Name</th>
            <th className="py-3 px-4">XRD Kind</th>
            <th className="py-3 px-4">Architecture</th>
            <th className="py-3 px-4">Mesh Route</th>
            <th className="py-3 px-4">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/60 text-zinc-200">
          {claims.map((c) => (
            <tr key={c.name} className="hover:bg-zinc-800/30">
              <td className="py-3 px-4 font-semibold">{c.name}</td>
              <td className="py-3 px-4 text-zinc-400">{c.kind}</td>
              <td className="py-3 px-4">{c.arch}</td>
              <td className="py-3 px-4 text-emerald-400">{c.endpoint}</td>
              <td className="py-3 px-4">
                {c.ready && c.synced ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-emerald-400 border border-emerald-500/20">
                    READY & SYNCED
                  </span>
                ) : (
                  <span className="inline-flex rounded-full bg-amber-500/10 px-2.5 py-0.5 text-amber-400 border border-amber-500/20">
                    RECONCILING
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
