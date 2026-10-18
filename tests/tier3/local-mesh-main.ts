import { runGates, skip, type Gate } from "../lib/gates";
import { finish } from "../lib/report";
import { evaluateHttp, hostOf, localMeshProbes, observe, resolves, tcpConnect } from "./probes";

const strict = process.argv.includes("--strict") || process.env.ORB_VERIFY_STRICT === "1";

const gates: Gate[] = localMeshProbes().map((p) => ({
  tier: 3,
  name: `path-a:${p.label}`,
  async run() {
    if (!(await resolves(hostOf(p.url)))) return skip(`${hostOf(p.url)} does not resolve; that tier is not deployed`);
    return evaluateHttp(p, await observe(p));
  },
}));

gates.push({
  tier: 3,
  name: "path-a:tier3-postgres",
  async run() {
    if (!(await resolves("postgres.orb.local"))) return skip("postgres.orb.local does not resolve; Tier 3 is not deployed");
    const r = await tcpConnect("postgres.orb.local", 5432);
    return r.ok
      ? { status: "pass", measured: r.ms, detail: `postgres.orb.local:5432 accepts TCP in ${Math.round(r.ms)}ms` }
      : { status: "fail", detail: `postgres.orb.local:5432: ${r.error}` };
  },
});

if (strict) console.log("strict: a tier that is not deployed fails the run");
finish("tier3-local-mesh", await runGates(gates));
