/**
 * Reconciles OrbStackMachine CRs → `orb create` on the macOS host.
 * Run with KUBECONFIG pointing at OrbStack Kubernetes (out-of-cluster).
 */
import * as k8s from "@kubernetes/client-node";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const GROUP = "cloud.orbstack.io";
const VERSION = "v1alpha1";
const PLURAL = "orbstackmachines";

type OrbStackMachine = {
  metadata: { name?: string; namespace?: string };
  spec: {
    distro: string;
    hostname: string;
    cloudInit?: string;
    cloudInitConfigMapRef?: { name: string; key: string };
    isolated?: boolean;
    isolateNetwork?: boolean;
  };
  status?: { phase?: string; orbDomain?: string; message?: string };
};

const kc = new k8s.KubeConfig();
kc.loadFromDefault();
const custom = kc.makeApiClient(k8s.CustomObjectsApi);
const core = kc.makeApiClient(k8s.CoreV1Api);

async function loadCloudInit(ref?: { name: string; key: string }, ns?: string): Promise<string | undefined> {
  if (!ref?.name || !ns) return undefined;
  const cm = await core.readNamespacedConfigMap({ name: ref.name, namespace: ns });
  return cm.data?.[ref.key ?? "user-data"];
}

async function reconcileOne(name: string, namespace: string, body: OrbStackMachine): Promise<void> {
  const spec = body.spec;
  const cloudInit =
    spec.cloudInit ?? (await loadCloudInit(spec.cloudInitConfigMapRef, namespace));
  const tmpDir = join(tmpdir(), `orbstack-${namespace}-${name}`);
  await mkdir(tmpDir, { recursive: true });
  let cloudInitPath: string | undefined;
  if (cloudInit) {
    cloudInitPath = join(tmpDir, "user-data.yml");
    await writeFile(cloudInitPath, cloudInit, "utf8");
  }

  const args = ["create", spec.distro, spec.hostname];
  if (cloudInitPath) args.push("-c", cloudInitPath);
  if (spec.isolated) args.push("--isolated");
  if (spec.isolateNetwork) args.push("--isolate-network");

  const proc = spawnSync("orb", args, { encoding: "utf8" });
  const ok = proc.status === 0;
  const phase = ok ? "Ready" : "Failed";
  const orbDomain = `${spec.hostname}.orb.local`;
  const message = ok ? proc.stdout?.trim() : proc.stderr?.trim() || proc.stdout?.trim();

  await custom.patchNamespacedCustomObjectStatus({
    group: GROUP,
    version: VERSION,
    namespace,
    plural: PLURAL,
    name,
    body: {
      status: { phase, orbDomain, message: message?.slice(0, 500) },
    },
  });

  if (cloudInitPath) await rm(tmpDir, { recursive: true, force: true });
  console.log(JSON.stringify({ name, namespace, phase, orbDomain }));
}

async function listMachines(): Promise<Array<{ name: string; namespace: string; body: OrbStackMachine }>> {
  const res = await custom.listClusterCustomObject({
    group: GROUP,
    version: VERSION,
    plural: PLURAL,
  });
  const items = (res as { items?: OrbStackMachine[] }).items ?? [];
  return items.map((body) => ({
    name: body.metadata.name ?? "unknown",
    namespace: body.metadata.namespace ?? "default",
    body,
  }));
}

const intervalMs = Number(process.env.RECONCILE_INTERVAL_MS ?? 30_000);

async function tick(): Promise<void> {
  try {
    const machines = await listMachines();
    for (const m of machines) {
      if (m.body.status?.phase === "Ready") continue;
      await reconcileOne(m.name, m.namespace, m.body);
    }
  } catch (err) {
    console.error(err);
  }
}

console.log(`orbstack-controller watching ${GROUP}/${VERSION}/${PLURAL} every ${intervalMs}ms`);
await tick();
setInterval(tick, intervalMs);
