import { runGates, skip, type Gate } from "../lib/gates";
import { prTunnelHost, TUNNEL_HOST } from "../lib/hosts";
import { run, which } from "../lib/proc";
import { finish } from "../lib/report";
import { edgeProbes, evaluateHttp, observe } from "./probes";

/**
 * Runs on a Linux runner outside the Mac: Path B over the tailnet, Path C through the
 * Cloudflare edge. ORB_RUN_ID selects the per-run names; ORB_PUBLIC_HOST overrides the
 * edge host (defaults to the per-run tunnel, or osc-app.stevedores.org with no run id).
 */
const runId = process.env.ORB_RUN_ID ?? process.env.GITHUB_RUN_ID;
const edgeHost = process.env.ORB_PUBLIC_HOST ?? (runId ? prTunnelHost(runId) : TUNNEL_HOST);
const tailnet = process.env.TS_TAILNET;
const token =
  process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET
    ? { id: process.env.CF_ACCESS_CLIENT_ID, secret: process.env.CF_ACCESS_CLIENT_SECRET }
    : undefined;

const gates: Gate[] = [];

const suffix = runId ? `-${runId}` : "";
gates.push(
  {
    tier: 3,
    name: "path-b:tailscale-ping",
    async run() {
      const ts = await which("tailscale");
      if (!ts) return skip("tailscale CLI not installed on this runner");
      const node = `orb-postgres${suffix}`;
      const r = await run([ts, "ping", "--c", "3", node], { allowFailure: true, timeoutMs: 60_000 });
      return r.code === 0 ? { status: "pass", detail: `tailscale ping ${node}: ${r.stdout.trim().split("\n").pop()}` } : { status: "fail", detail: `tailscale ping ${node}: ${(r.stderr || r.stdout).trim()}` };
    },
  },
  {
    tier: 3,
    name: "path-b:tailscale-ssh",
    async run() {
      const ts = await which("tailscale");
      if (!ts) return skip("tailscale CLI not installed on this runner");
      const node = `orb-postgres${suffix}`;
      const r = await run([ts, "ssh", `postgres@${node}`, "systemctl", "is-active", "postgresql"], { allowFailure: true, timeoutMs: 60_000 });
      return r.stdout.trim() === "active"
        ? { status: "pass", detail: `tailscale ssh ${node}: postgresql active` }
        : { status: "fail", detail: `tailscale ssh ${node}: ${(r.stdout + r.stderr).trim()}` };
    },
  },
  {
    tier: 3,
    name: "path-b:gateway-health",
    async run() {
      if (!tailnet) return skip("TS_TAILNET is not set");
      const probe = { label: "gateway", url: `https://orb-api-gateway${suffix}.${tailnet}.ts.net/healthz`, expect: [200] };
      return evaluateHttp(probe, await observe(probe));
    },
  },
);

for (const p of edgeProbes(edgeHost, token)) {
  gates.push({ tier: 3, name: `path-c:${p.label}`, run: async () => evaluateHttp(p, await observe(p)) });
}
if (!token) gates.push({ tier: 3, name: "path-c:edge-service-token", run: async () => skip("CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET not set") });

finish("tier3-remote-probe", await runGates(gates));
