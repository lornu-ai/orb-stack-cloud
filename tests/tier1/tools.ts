import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseAllDocuments, stringify } from "yaml";
import { skip, type GateOutcome } from "../lib/gates";
import { run, which } from "../lib/proc";
import { claimToXr, type Xrd } from "./crossplane";
import { metaName, type ManifestDoc } from "./manifests";

export const CRD_CATALOG =
  "https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json";

interface KubeconformResource {
  filename: string;
  kind: string;
  name: string;
  status: "statusValid" | "statusInvalid" | "statusError" | "statusSkipped" | "statusEmpty";
  msg?: string;
}

/**
 * kubeconform's JSON lists only resources that did not validate (unless -verbose), so
 * counts come from `summary`; `resources` supplies the failure messages.
 */
export function summarizeKubeconform(json: string): { valid: number; skipped: number; problems: string[] } {
  const doc = JSON.parse(json) as {
    resources?: KubeconformResource[];
    summary?: { valid?: number; invalid?: number; errors?: number; skipped?: number };
  };
  const problems = (doc.resources ?? [])
    .filter((r) => r.status === "statusInvalid" || r.status === "statusError")
    .map((r) => `${r.filename} ${r.kind}/${r.name}: ${r.msg ?? r.status}`);
  const invalid = (doc.summary?.invalid ?? 0) + (doc.summary?.errors ?? 0);
  if (invalid > problems.length) problems.push(`${invalid - problems.length} more invalid resources without detail`);
  return { valid: doc.summary?.valid ?? 0, skipped: doc.summary?.skipped ?? 0, problems };
}

export async function kubeconform(
  bin: string,
  files: string[],
  opts: { label: string; crdCatalog: boolean; cwd: string },
): Promise<GateOutcome> {
  if (files.length === 0) return skip(`${opts.label}: no files`);
  const args = [bin, "-strict", "-summary", "-output", "json", "-schema-location", "default"];
  if (opts.crdCatalog) args.push("-schema-location", CRD_CATALOG, "-ignore-missing-schemas");
  const res = await run([...args, ...files], { cwd: opts.cwd, allowFailure: true, timeoutMs: 120_000 });
  const { valid, skipped, problems } = summarizeKubeconform(res.stdout);
  if (problems.length) return { status: "fail", detail: `${opts.label}: ${problems.join("; ")}` };
  if (res.code !== 0) return { status: "error", detail: `${opts.label}: kubeconform exited ${res.code}: ${res.stderr.trim()}` };
  if (valid === 0) return { status: "fail", detail: `${opts.label}: kubeconform validated nothing (${skipped} skipped)` };
  return {
    status: "pass",
    detail: `${opts.label}: ${valid} resources valid${skipped ? `, ${skipped} without a published schema` : ""}`,
    metrics: { valid, skipped },
  };
}

export async function kustomizeBuild(dir: string, cwd: string): Promise<GateOutcome> {
  const kubectl = await which("kubectl");
  if (!kubectl) return skip(`${dir}: kubectl not installed`);
  const res = await run([kubectl, "kustomize", dir], { cwd, allowFailure: true, timeoutMs: 60_000 });
  if (res.code !== 0) return { status: "fail", detail: `${dir}: kubectl kustomize failed — ${res.stderr.trim()}` };
  const count = parseAllDocuments(res.stdout).filter((d) => d.toJSON()).length;
  return { status: "pass", detail: `${dir}: builds ${count} objects`, metrics: { objects: count } };
}

export async function composeConfig(file: string, cwd: string): Promise<GateOutcome> {
  const docker = await which("docker");
  if (!docker) return skip(`${file}: docker CLI not installed`);
  const res = await run([docker, "compose", "-f", file, "config", "--quiet"], { cwd, allowFailure: true, timeoutMs: 60_000 });
  return res.code === 0
    ? { status: "pass", detail: `${file}: docker compose config accepts it` }
    : { status: "fail", detail: `${file}: ${res.stderr.trim()}` };
}

/**
 * The Crossplane CLI talks to Docker through DOCKER_HOST, not the docker CLI's active
 * context, so OrbStack's socket (~/.orbstack/run/docker.sock) must be passed through.
 */
export async function dockerEnv(): Promise<Record<string, string> | undefined> {
  if (process.env.DOCKER_HOST) return {};
  const docker = await which("docker");
  if (!docker) return undefined;
  const res = await run([docker, "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { allowFailure: true });
  const host = res.stdout.trim();
  if (res.code !== 0 || !host) return undefined;
  const info = await run([docker, "info", "--format", "{{.ServerVersion}}"], { allowFailure: true, env: { DOCKER_HOST: host } });
  return info.code === 0 ? { DOCKER_HOST: host } : undefined;
}

export interface RenderInput {
  claim: ManifestDoc;
  xrd: Xrd;
  composition: ManifestDoc;
  functions: ManifestDoc[];
  extensions: ManifestDoc[];
}

/** Rendered output minus the XR itself: the managed resources the Composition produces. */
export function composedResources(renderOutput: string, xrKind: string): Record<string, unknown>[] {
  return parseAllDocuments(renderOutput)
    .map((d) => d.toJSON() as Record<string, unknown> | null)
    .filter((d): d is Record<string, unknown> => !!d && d.kind !== xrKind && d.kind !== "Result");
}

/** Offline `crossplane composition render`, then `crossplane resource validate` on the output. */
export async function renderAndValidate(bin: string, input: RenderInput): Promise<GateOutcome> {
  const label = `${input.claim.file} ${String(input.claim.doc.kind)}/${metaName(input.claim.doc)}`;
  const env = await dockerEnv();
  if (!env) return skip(`${label}: render runs Functions in Docker, and no Docker daemon is reachable`);

  const work = mkdtempSync(join(tmpdir(), "orb-render-"));
  const write = (name: string, docs: Record<string, unknown>[]) => {
    const path = join(work, name);
    writeFileSync(path, docs.map((d) => stringify(d)).join("---\n"));
    return path;
  };
  const xr = write("xr.yaml", [claimToXr(input.claim.doc, input.xrd)]);
  const comp = write("composition.yaml", [input.composition.doc]);
  const fns = write("functions.yaml", input.functions.map((f) => f.doc));

  const rendered = await run([bin, "composition", "render", xr, comp, fns], { allowFailure: true, timeoutMs: 300_000, env });
  if (rendered.code !== 0) return { status: "fail", detail: `${label}: render failed — ${rendered.stderr.trim()}` };
  const resources = composedResources(rendered.stdout, input.xrd.kind);
  if (resources.length === 0) return { status: "fail", detail: `${label}: render produced no composed resources` };

  // render prints only metadata.name and status of the XR, so validating that stub
  // would fail on required spec fields; only composed resources are validated.
  const renderedPath = write("rendered.yaml", resources);
  const extensionsDir = dirname(write("extensions.yaml", input.extensions.map((e) => e.doc)));
  const validated = await run(
    [bin, "resource", "validate", "--cache-dir", join(work, "cache"), join(extensionsDir, "extensions.yaml"), renderedPath],
    { allowFailure: true, timeoutMs: 300_000 },
  );
  if (validated.code !== 0) {
    return { status: "fail", detail: `${label}: rendered ${resources.length} resources; validate failed — ${(validated.stdout + validated.stderr).trim()}` };
  }
  return {
    status: "pass",
    detail: `${label}: renders ${resources.length} resources that validate against provider schemas`,
    metrics: { composed: resources.length },
  };
}
