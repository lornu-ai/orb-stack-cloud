/**
 * CI: parse Crossplane/K8s YAML and kustomization resource lists (no cluster required).
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { parse, parseAllDocuments } from "yaml";

const ROOT = join(import.meta.dir, "..");
const K8S_DIRS = ["crossplane", "tier1", "k8s", "iac"];
const REQUIRED_DOCS = [
  "docs/EXECUTION_PLAN.md",
  "docs/IMPLEMENTATION_STATUS.md",
  "crossplane/examples/tier3-stateful-claims.yaml",
];

async function collectYamlFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: { name: string; isDirectory: () => boolean }[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.name === "node_modules") continue;
    if (e.isDirectory()) out.push(...(await collectYamlFiles(p)));
    else if (/\.(ya?ml)$/i.test(e.name)) out.push(p);
  }
  return out;
}

function assertK8sObject(doc: unknown, file: string, index: number): void {
  if (doc === null || typeof doc !== "object") return;
  const o = doc as Record<string, unknown>;
  if (!o.apiVersion || !o.kind) {
    throw new Error(`${file}: document ${index} missing apiVersion/kind`);
  }
}

async function main(): Promise<void> {
  for (const rel of REQUIRED_DOCS) {
    await readFile(join(ROOT, rel), "utf8");
  }

  const files: string[] = [];
  for (const d of K8S_DIRS) {
    files.push(...(await collectYamlFiles(join(ROOT, d))));
  }

  let docCount = 0;
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const list = parseAllDocuments(text, { prettyErrors: true }).map((d) => d.toJSON());
    for (let i = 0; i < list.length; i++) {
      const doc = list[i];
      if (doc === null || doc === undefined) continue;
      assertK8sObject(doc, relative(ROOT, file), i);
      docCount++;
    }
  }

  const composePath = join(ROOT, "tier2/docker-compose.yml");
  const compose = parseAllDocuments(await readFile(composePath, "utf8"))[0]?.toJSON() as {
    services?: Record<string, unknown>;
  };
  if (!compose.services?.["localstack-aws"]) {
    throw new Error("tier2/docker-compose.yml must define localstack-aws service");
  }

  console.log(JSON.stringify({ ok: true, yamlFiles: files.length, k8sDocuments: docCount }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
