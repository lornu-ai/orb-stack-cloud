import type { GateOutcome } from "../lib/gates";

export const GCE = {
  zone: "us-central1-a",
  machineType: "t2a-standard-2",
  image: "projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-arm64",
  bootTimeoutMs: 15 * 60_000,
};

/** Same substitution as tools/bootstrap-tier3, so GCE boots the exact bytes OrbStack does. */
export function renderUserData(text: string, vars: Record<string, string | undefined>): string {
  return text.replaceAll("${ORB_SSH_PUBKEY}", vars.ORB_SSH_PUBKEY ?? "").replaceAll("${TS_AUTHKEY}", vars.TS_AUTHKEY ?? "");
}

export function instanceName(runId: string, file: string): string {
  const base = file.split("/").pop()!.replace(/\.ya?ml$/, "").replace(/-userdata$/, "");
  return `gce-parity-${runId}-${base}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 63).replace(/-+$/, "");
}

export function instanceBody(name: string, userData: string, runId: string, zone = GCE.zone): Record<string, unknown> {
  return {
    name,
    machineType: `zones/${zone}/machineTypes/${GCE.machineType}`,
    labels: { purpose: "osc-parity", run: runId.toLowerCase().replace(/[^a-z0-9_-]/g, "-") },
    disks: [{ boot: true, autoDelete: true, initializeParams: { sourceImage: GCE.image, diskSizeGb: "20" } }],
    networkInterfaces: [{ network: "global/networks/default", accessConfigs: [{ type: "ONE_TO_ONE_NAT", name: "External NAT" }] }],
    metadata: { items: [{ key: "user-data", value: userData }] },
  };
}

const FAILURE = /Failed to run module|Traceback \(most recent call last\)|cloud-init\[\d+\]:.*\bERROR\b|Failed to start .+\.service/;

/** Read cloud-init's outcome from the serial console. */
export function evaluateSerial(output: string, finalMessage: string): { done: boolean; failures: string[] } {
  const lines = output.split("\n");
  return {
    done: lines.some((l) => l.includes(finalMessage)),
    failures: lines.filter((l) => FAILURE.test(l)).map((l) => l.trim()),
  };
}

export function serialOutcome(file: string, result: { done: boolean; failures: string[] }, seconds: number): GateOutcome {
  if (result.failures.length) return { status: "fail", detail: `${file}: cloud-init reported ${result.failures.length} failures — ${result.failures.slice(0, 3).join(" | ")}` };
  if (!result.done) return { status: "fail", detail: `${file}: final_message not seen on the serial console within ${Math.round(seconds)}s` };
  return { status: "pass", measured: seconds, detail: `${file}: cloud-init finished cleanly on GCE ${GCE.machineType} in ${Math.round(seconds)}s` };
}
