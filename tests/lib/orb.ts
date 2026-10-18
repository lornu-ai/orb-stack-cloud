import { run, type RunOptions, type RunResult } from "./proc";

/** Every machine and container the suite creates carries this prefix; cleanup touches nothing else. */
export const CI_PREFIX = "ci-osc-";

export function ciName(suffix: string): string {
  return `${CI_PREFIX}${suffix}`;
}

export function isCiResource(name: string): boolean {
  return name.startsWith(CI_PREFIX);
}

export interface OrbMachine {
  name: string;
  state?: string;
  config?: { isolated?: boolean; isolate_network?: boolean };
}

export function parseMachineList(json: string): OrbMachine[] {
  const parsed = JSON.parse(json || "[]") as OrbMachine[] | null;
  return parsed ?? [];
}

export async function listMachines(): Promise<OrbMachine[]> {
  return parseMachineList((await run(["orb", "list", "-f", "json"])).stdout);
}

export interface CreateOptions {
  isolated?: boolean;
  isolateNetwork?: boolean;
  userData?: string;
  memory?: string;
  cpus?: number;
}

export function createArgs(distro: string, name: string, opts: CreateOptions = {}): string[] {
  if (!isCiResource(name)) throw new Error(`refusing to create '${name}': suite machines must start with ${CI_PREFIX}`);
  const args = ["orb", "create"];
  if (opts.isolated) args.push("--isolated");
  if (opts.isolateNetwork) args.push("--isolate-network");
  if (opts.userData) args.push("--user-data", opts.userData);
  if (opts.memory) args.push("--memory", opts.memory);
  if (opts.cpus) args.push("--cpus", String(opts.cpus));
  args.push(distro, name);
  return args;
}

export async function createMachine(distro: string, name: string, opts: CreateOptions = {}): Promise<RunResult> {
  return run(createArgs(distro, name, opts), { timeoutMs: 600_000 });
}

export async function deleteMachine(name: string): Promise<void> {
  if (!isCiResource(name)) throw new Error(`refusing to delete '${name}': not a suite machine`);
  await run(["orb", "delete", "-f", name], { allowFailure: true, timeoutMs: 120_000 });
}

export function machineExec(name: string, cmd: string[], opts: RunOptions & { root?: boolean } = {}): Promise<RunResult> {
  const args = ["orb", "-m", name];
  if (opts.root) args.push("-u", "root");
  return run([...args, ...cmd], opts);
}

/** Block until systemd finishes booting. "degraded" still means boot completed. */
export async function waitSystemReady(name: string): Promise<string> {
  const res = await machineExec(name, ["systemctl", "is-system-running", "--wait"], { allowFailure: true, timeoutMs: 120_000 });
  const state = res.stdout.trim().split("\n").pop() ?? "";
  if (state !== "running" && state !== "degraded") {
    throw new Error(`${name}: systemd state '${state || res.stderr.trim()}' after boot`);
  }
  return state;
}

export async function removeContainer(name: string): Promise<void> {
  if (!isCiResource(name)) throw new Error(`refusing to remove container '${name}': not a suite container`);
  await run(["docker", "rm", "-f", name], { allowFailure: true, timeoutMs: 60_000 });
}

/** Remove only suite-created machines and containers, never the user's own. */
export async function cleanupCiResources(log: (l: string) => void = console.log): Promise<string[]> {
  const removed: string[] = [];
  for (const m of await listMachines()) {
    if (!isCiResource(m.name)) continue;
    await deleteMachine(m.name);
    removed.push(`machine ${m.name}`);
  }
  const ps = await run(["docker", "ps", "-a", "--format", "{{.Names}}"], { allowFailure: true });
  for (const name of ps.stdout.split("\n").map((s) => s.trim())) {
    if (!name || !isCiResource(name)) continue;
    await removeContainer(name);
    removed.push(`container ${name}`);
  }
  for (const r of removed) log(`cleanup: removed ${r}`);
  return removed;
}
