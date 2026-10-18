import type { GateOutcome } from "../lib/gates";
import type { ManifestDoc } from "./manifests";

interface ComposeService {
  image?: string;
  build?: unknown;
  platform?: string;
  labels?: string[] | Record<string, string>;
}

/** Keys repeated in a list-form `labels:` block; Compose keeps only the last value. */
export function duplicateLabelKeys(labels: ComposeService["labels"]): string[] {
  if (!Array.isArray(labels)) return [];
  const seen = new Map<string, number>();
  for (const entry of labels) {
    const key = String(entry).split("=")[0] ?? "";
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen].filter(([, n]) => n > 1).map(([k]) => k);
}

export function orbDomains(labels: ComposeService["labels"]): string[] {
  const values: string[] = [];
  if (Array.isArray(labels)) {
    for (const entry of labels) {
      const [k, v] = String(entry).split(/=(.*)/s);
      if (k === "dev.orbstack.domains" && v) values.push(...v.split(","));
    }
  } else if (labels?.["dev.orbstack.domains"]) {
    values.push(...labels["dev.orbstack.domains"].split(","));
  }
  return values.map((v) => v.trim()).filter(Boolean);
}

/**
 * Tier 2 is the cross-architecture tier: every service must pin its platform, and
 * each `.orb.local` name a probe depends on must survive label de-duplication.
 */
export function checkCompose(d: ManifestDoc): GateOutcome {
  const services = (d.doc.services ?? {}) as Record<string, ComposeService>;
  const problems: string[] = [];
  if (Object.keys(services).length === 0) problems.push("defines no services");
  for (const [name, svc] of Object.entries(services)) {
    if (!svc.image && !svc.build) problems.push(`${name}: no image or build`);
    if (!svc.platform) problems.push(`${name}: platform not pinned (linux/arm64 or linux/amd64)`);
    for (const key of duplicateLabelKeys(svc.labels)) {
      problems.push(`${name}: label '${key}' is set more than once, so Compose keeps only the last value`);
    }
  }
  return problems.length
    ? { status: "fail", detail: `${d.file}: ${problems.join("; ")}` }
    : { status: "pass", detail: `${d.file}: ${Object.keys(services).length} services, platforms pinned, labels unique` };
}
