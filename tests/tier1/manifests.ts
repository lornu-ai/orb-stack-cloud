import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseAllDocuments } from "yaml";

export const REPO_ROOT = join(import.meta.dir, "../..");
export const MANIFEST_ROOTS = ["crossplane", "blueprint", "examples", "clusters"];

export type DocKind = "k8s" | "cloud-init" | "compose";

export interface ManifestDoc {
  file: string;
  index: number;
  kind: DocKind;
  doc: Record<string, unknown>;
}

export interface ParseProblem {
  file: string;
  message: string;
}

export function listYamlFiles(root: string, dirs: string[] = MANIFEST_ROOTS): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.ya?ml$/i.test(e.name)) out.push(p);
    }
  };
  for (const d of dirs) walk(join(root, d));
  return out.sort();
}

export function classify(text: string, doc: Record<string, unknown>): DocKind | undefined {
  if (text.trimStart().startsWith("#cloud-config")) return "cloud-init";
  if ("services" in doc && !("apiVersion" in doc)) return "compose";
  if ("apiVersion" in doc || "kind" in doc) return "k8s";
  return undefined;
}

/** Parse every YAML document under the manifest roots, classifying each one. */
export function loadManifests(root = REPO_ROOT): { docs: ManifestDoc[]; problems: ParseProblem[] } {
  const docs: ManifestDoc[] = [];
  const problems: ParseProblem[] = [];
  for (const path of listYamlFiles(root)) {
    const file = relative(root, path);
    const text = readFileSync(path, "utf8");
    parseText(file, text, docs, problems);
  }
  return { docs, problems };
}

export function parseText(file: string, text: string, docs: ManifestDoc[], problems: ParseProblem[]): void {
  parseAllDocuments(text, { prettyErrors: true }).forEach((d, index) => {
    if (d.errors.length) {
      problems.push({ file, message: d.errors.map((e) => e.message).join("; ") });
      return;
    }
    const doc = d.toJSON() as unknown;
    if (doc === null || doc === undefined) return;
    if (typeof doc !== "object" || Array.isArray(doc)) {
      problems.push({ file, message: `document ${index} is not a mapping` });
      return;
    }
    const record = doc as Record<string, unknown>;
    const kind = classify(index === 0 ? text : "", record);
    if (!kind) {
      problems.push({ file, message: `document ${index} is neither Kubernetes, cloud-init, nor Compose` });
      return;
    }
    if (kind === "k8s" && (typeof record.apiVersion !== "string" || typeof record.kind !== "string")) {
      problems.push({ file, message: `document ${index} missing apiVersion/kind` });
      return;
    }
    docs.push({ file, index, kind, doc: record });
  });
}

export function apiGroup(apiVersion: string): { group: string; version: string } {
  const slash = apiVersion.lastIndexOf("/");
  return slash === -1
    ? { group: "", version: apiVersion }
    : { group: apiVersion.slice(0, slash), version: apiVersion.slice(slash + 1) };
}

export function metaName(doc: Record<string, unknown>): string {
  const meta = doc.metadata as { name?: unknown } | undefined;
  return typeof meta?.name === "string" ? meta.name : "<unnamed>";
}

export function labels(doc: Record<string, unknown>): Record<string, string> {
  const meta = doc.metadata as { labels?: Record<string, string> } | undefined;
  return meta?.labels ?? {};
}
