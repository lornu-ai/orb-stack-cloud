import { lookup } from "node:dns/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { runGates, type Gate, type GateOutcome } from "../lib/gates";
import { ciName, cleanupCiResources, createMachine, machineExec, waitSystemReady } from "../lib/orb";
import { run } from "../lib/proc";
import { finish } from "../lib/report";
import { answered, evaluateAgentSocket, evaluatePath, evaluateReachability, evaluateTmutil, firstIpv4, probeCommand, type Target } from "./isolation";

const UBUNTU = "ubuntu:noble";
const ATTACKER = ciName("attacker");
const CONTROL = ciName("control");
const TARGET_CONTAINER = ciName("target");

async function probe(machine: string, t: Target): Promise<{ reached: boolean; output: string }> {
  const res = await machineExec(machine, probeCommand(t), { allowFailure: true, timeoutMs: 15_000 });
  return { reached: answered(t, res.stdout), output: `exit ${res.code}: ${(res.stdout || res.stderr).trim().slice(0, 80)}` };
}

async function lateral(t: Target): Promise<GateOutcome> {
  const control = await probe(CONTROL, t);
  const attacker = await probe(ATTACKER, t);
  return { ...evaluateReachability(t, control.reached, attacker.reached), metrics: { control: control.output, attacker: attacker.output } };
}
const sees = async (machine: string, path: string) =>
  (await machineExec(machine, ["test", "-e", path], { allowFailure: true, timeoutMs: 15_000 })).code === 0;

async function resolveInControl(name: string): Promise<string | undefined> {
  const res = await machineExec(CONTROL, ["getent", "ahostsv4", name], { allowFailure: true, timeoutMs: 15_000 });
  return firstIpv4(res.stdout);
}

async function optionalTarget(label: string, name: string, port: number, kind: Target["kind"]): Promise<Target | undefined> {
  try {
    const { address } = await lookup(name, 4);
    return { label, host: address, port, kind };
  } catch {
    return undefined;
  }
}

async function clusterIp(): Promise<Target | undefined> {
  const res = await run(["kubectl", "--context", "orbstack", "get", "svc", "kubernetes", "-n", "default", "-o", "jsonpath={.spec.clusterIP}"], {
    allowFailure: true,
    timeoutMs: 15_000,
  });
  const ip = res.stdout.trim();
  return res.code === 0 && ip ? { label: "Kubernetes ClusterIP (kubernetes.default)", host: ip, port: 443, kind: "https" } : undefined;
}

const host = Bun.serve({ hostname: "0.0.0.0", port: 0, fetch: () => new Response("ok") });

try {
  await run(["docker", "run", "-d", "--name", TARGET_CONTAINER, "hashicorp/http-echo:1.0.0", "-listen=:5678", "-text=ok"], { timeoutMs: 120_000 });
  await createMachine(UBUNTU, CONTROL);
  await createMachine(UBUNTU, ATTACKER, { isolated: true, isolateNetwork: true });
  await Promise.all([waitSystemReady(CONTROL), waitSystemReady(ATTACKER)]);

  const containerIp = (await run(["docker", "inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", TARGET_CONTAINER])).stdout.trim();
  const hostInternal = await resolveInControl("host.orb.internal");
  const lanIp = (await run(["ipconfig", "getifaddr", "en0"], { allowFailure: true })).stdout.trim();

  const port = host.port!;
  const targets: Target[] = [
    { label: "container on the OrbStack bridge", host: containerIp, port: 5678, kind: "http" },
    ...(hostInternal ? [{ label: "macOS host via host.orb.internal", host: hostInternal, port, kind: "http" as const }] : []),
    ...(lanIp ? [{ label: "macOS host LAN address", host: lanIp, port, kind: "http" as const }] : []),
  ];
  for (const t of [
    await clusterIp(),
    await optionalTarget("postgres.orb.local", "postgres.orb.local", 5432, "postgres"),
    await optionalTarget("vault.orb.local", "vault.orb.local", 8200, "http"),
  ]) {
    if (t) targets.push(t);
  }

  const gate = (name: string, fn: () => Promise<GateOutcome>): Gate => ({ tier: 5, name, run: fn });
  const gates: Gate[] = [
    gate("machine-flags", async () => {
      const cfg = (await run(["orb", "list", "-f", "json"])).stdout;
      const m = (JSON.parse(cfg) as { name: string; config?: { isolated?: boolean; isolate_network?: boolean } }[]).find((x) => x.name === ATTACKER);
      return m?.config?.isolated && m.config.isolate_network
        ? { status: "pass", detail: `${ATTACKER} reports isolated=true, isolate_network=true` }
        : { status: "fail", detail: `${ATTACKER} config is ${JSON.stringify(m?.config)}` };
    }),
    ...[homedir(), "/mnt/mac", "/Volumes"].map((p) => gate(`host-path:${p === homedir() ? "~" : p}`, async () => evaluatePath(p, await sees(CONTROL, p), await sees(ATTACKER, p)))),
    gate("ssh-agent", async () => evaluateAgentSocket((await machineExec(ATTACKER, ["printenv", "SSH_AUTH_SOCK"], { allowFailure: true })).stdout)),
    ...targets.map((t) => gate(`lateral:${t.label}`, () => lateral(t))),
    gate("time-machine-exclusion", async () => {
      const dir = join(homedir(), "Library/Group Containers/HUAQ24HBR6.dev.orbstack");
      const res = await run(["tmutil", "isexcluded", dir], { allowFailure: true });
      return evaluateTmutil(res.stdout + res.stderr);
    }),
  ];
  finish("tier5-isolation", await runGates(gates));
} finally {
  host.stop(true);
  await cleanupCiResources();
}
