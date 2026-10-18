import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { GateOutcome } from "../lib/gates";
import type { ManifestDoc } from "./manifests";

export function isKustomization(d: ManifestDoc): boolean {
  return d.kind === "k8s" && d.doc.kind === "Kustomization" && String(d.doc.apiVersion).startsWith("kustomize.config.k8s.io/");
}

/** Every `resources:` entry of a Kustomization must exist relative to it. */
export function checkKustomization(d: ManifestDoc, root: string, exists = existsSync): GateOutcome {
  const resources = (d.doc.resources ?? []) as string[];
  const base = dirname(join(root, d.file));
  const missing = resources.filter((r) => !/^[a-z]+:\/\//.test(r) && !exists(join(base, r)));
  return missing.length
    ? { status: "fail", detail: `${d.file}: missing resources ${missing.join(", ")}` }
    : { status: "pass", detail: `${d.file}: ${resources.length} resources resolve` };
}
