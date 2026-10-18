import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { runGates, skip, type Gate } from "../lib/gates";
import { sleep } from "../lib/proc";
import { finish } from "../lib/report";
import { REPO_ROOT } from "../tier1/manifests";
import { evaluateSerial, GCE, instanceBody, instanceName, renderUserData, serialOutcome } from "./gce";

/**
 * Boots each Tier 3 cloud-init file, byte-for-byte as OrbStack receives it, on an
 * ephemeral GCE ARM64 VM via the Compute REST API (no gcloud). Auth: an access token
 * from google-github-actions/auth (token_format: access_token).
 */
const project = process.env.GCP_PROJECT_ID;
const token = process.env.GCP_ACCESS_TOKEN;
const runId = process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`;
const zone = process.env.GCE_ZONE ?? GCE.zone;
const FILES = ["blueprint/tier3-cloudinit/postgres-userdata.yaml", "blueprint/tier3-cloudinit/vault-userdata.yaml"];

const api = `https://compute.googleapis.com/compute/v1/projects/${project}/zones/${zone}`;
async function gce(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await fetch(`${api}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → HTTP ${res.status}: ${JSON.stringify(body.error ?? body).slice(0, 300)}`);
  return body;
}

async function waitOperation(op: Record<string, unknown>): Promise<void> {
  for (let i = 0; i < 120; i++) {
    const cur = await gce(`/operations/${op.name}`);
    if (cur.status === "DONE") {
      if (cur.error) throw new Error(`operation ${op.name}: ${JSON.stringify(cur.error)}`);
      return;
    }
    await sleep(5000);
  }
  throw new Error(`operation ${op.name} did not finish`);
}

function parityGate(file: string): Gate {
  return {
    tier: 4,
    name: `gce-cloud-init:${file.split("/").pop()}`,
    async run() {
      if (!project || !token) return skip("GCP_PROJECT_ID and GCP_ACCESS_TOKEN are required");
      const text = readFileSync(join(REPO_ROOT, file), "utf8");
      const finalMessage = String((parse(text) as { final_message?: string }).final_message);
      const name = instanceName(runId, file);
      const t0 = performance.now();
      await waitOperation(await gce("/instances", { method: "POST", body: JSON.stringify(instanceBody(name, renderUserData(text, process.env), runId, zone)) }));
      try {
        let result = { done: false, failures: [] as string[] };
        while ((performance.now() - t0) < GCE.bootTimeoutMs && !result.done && result.failures.length === 0) {
          await sleep(10_000);
          const serial = (await gce(`/instances/${name}/serialPort?port=1`)) as { contents?: string };
          result = evaluateSerial(serial.contents ?? "", finalMessage);
        }
        return serialOutcome(file, result, (performance.now() - t0) / 1000);
      } finally {
        await waitOperation(await gce(`/instances/${name}`, { method: "DELETE" })).catch((e) => console.error(`cleanup ${name}: ${e}`));
      }
    },
  };
}

const gates: Gate[] = FILES.map(parityGate);
gates.push({
  tier: 4,
  name: "gce-service-state",
  run: async () =>
    skip("PostgreSQL :5432, node-exporter :9100, and cloud-tuning.conf checks need SSH through IAP or OS Login, which this pipeline does not configure yet"),
});
finish("tier4-gce", await runGates(gates));
