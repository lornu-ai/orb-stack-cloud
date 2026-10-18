import Ajv from "ajv";
import { skip, type GateOutcome } from "../lib/gates";
import { edgeHostProblem } from "../lib/hosts";
import { apiGroup, labels, metaName, type ManifestDoc } from "./manifests";

export const PLANNING_LABEL = "orbstack.lornu.ai/status";

export interface XrdVersion {
  name: string;
  schema: Record<string, unknown> | undefined;
}

export interface Xrd {
  name: string;
  group: string;
  kind: string;
  claimKind: string | undefined;
  versions: XrdVersion[];
  planning: boolean;
  file: string;
}

export function indexXrds(docs: ManifestDoc[]): Xrd[] {
  return docs
    .filter((d) => d.kind === "k8s" && d.doc.kind === "CompositeResourceDefinition")
    .map((d) => {
      const spec = d.doc.spec as {
        group: string;
        names: { kind: string };
        claimNames?: { kind: string };
        versions: { name: string; schema?: { openAPIV3Schema?: Record<string, unknown> } }[];
      };
      return {
        name: metaName(d.doc),
        group: spec.group,
        kind: spec.names.kind,
        claimKind: spec.claimNames?.kind,
        versions: spec.versions.map((v) => ({ name: v.name, schema: v.schema?.openAPIV3Schema })),
        planning: labels(d.doc)[PLANNING_LABEL] === "planning",
        file: d.file,
      };
    });
}

export function findXrd(xrds: Xrd[], apiVersion: string, kind: string): { xrd: Xrd; version: XrdVersion } | undefined {
  const { group, version } = apiGroup(apiVersion);
  for (const xrd of xrds) {
    if (xrd.group !== group || (xrd.kind !== kind && xrd.claimKind !== kind)) continue;
    const v = xrd.versions.find((x) => x.name === version);
    if (v) return { xrd, version: v };
  }
  return undefined;
}

export function compositions(docs: ManifestDoc[]): ManifestDoc[] {
  return docs.filter((d) => d.kind === "k8s" && d.doc.kind === "Composition");
}

export function functionNames(docs: ManifestDoc[]): Set<string> {
  return new Set(
    docs
      .filter((d) => d.kind === "k8s" && d.doc.kind === "Function" && String(d.doc.apiVersion).startsWith("pkg.crossplane.io/"))
      .map((d) => metaName(d.doc)),
  );
}

/** A Composition must target a declared XRD version and only call declared Functions. */
export function checkComposition(comp: ManifestDoc, xrds: Xrd[], functions: Set<string>): GateOutcome {
  const spec = comp.doc.spec as {
    compositeTypeRef?: { apiVersion?: string; kind?: string };
    mode?: string;
    pipeline?: { step: string; functionRef?: { name?: string } }[];
  };
  const problems: string[] = [];
  const ref = spec.compositeTypeRef;
  if (!ref?.apiVersion || !ref.kind) problems.push("spec.compositeTypeRef is incomplete");
  else if (!findXrd(xrds, ref.apiVersion, ref.kind)) problems.push(`no XRD serves ${ref.kind} ${ref.apiVersion}`);

  if (spec.mode === "Pipeline") {
    for (const step of spec.pipeline ?? []) {
      const fn = step.functionRef?.name;
      if (!fn) problems.push(`step ${step.step} has no functionRef`);
      else if (!functions.has(fn)) problems.push(`step ${step.step} calls Function '${fn}', which no manifest declares`);
    }
  }
  return problems.length
    ? { status: "fail", detail: `${comp.file}: ${problems.join("; ")}` }
    : { status: "pass", detail: `${comp.file}: targets a declared XRD; every pipeline Function is declared` };
}

export function isClaimOrXr(d: ManifestDoc, xrds: Xrd[]): boolean {
  if (d.kind !== "k8s") return false;
  const { group } = apiGroup(String(d.doc.apiVersion));
  return xrds.some((x) => x.group === group);
}

/**
 * Validate a claim against its XRD schema and check its compositionRef resolves. A
 * missing Composition for an XRD still labelled `planning` is reported as a skip so
 * the gap stays visible without failing the build.
 */
export function checkClaim(claim: ManifestDoc, xrds: Xrd[], compositionNames: Set<string>, ajv = newAjv()): GateOutcome {
  const label = `${claim.file} ${String(claim.doc.kind)}/${metaName(claim.doc)}`;
  const match = findXrd(xrds, String(claim.doc.apiVersion), String(claim.doc.kind));
  if (!match) return { status: "fail", detail: `${label}: no XRD serves this kind/version` };
  if (!match.version.schema) return { status: "fail", detail: `${label}: XRD ${match.xrd.name} has no openAPIV3Schema` };

  const validate = ajv.compile(match.version.schema);
  if (!validate(claim.doc)) {
    const errors = (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
    return { status: "fail", detail: `${label}: schema violation — ${errors}` };
  }

  const ref = (claim.doc.spec as { compositionRef?: { name?: string } } | undefined)?.compositionRef?.name;
  if (ref && !compositionNames.has(ref)) {
    const msg = `${label}: valid against ${match.xrd.name}, but Composition '${ref}' does not exist`;
    return match.xrd.planning
      ? skip(`${msg} (XRD is labelled ${PLANNING_LABEL}=planning)`)
      : { status: "fail", detail: msg };
  }
  return { status: "pass", detail: `${label}: valid against ${match.xrd.name}${ref ? `, Composition '${ref}' exists` : ""}` };
}

/** Public Cloudflare hosts a claim asks for, from either edge XRD shape. */
export function edgeHosts(doc: Record<string, unknown>): { zone: string; host: string }[] {
  const spec = (doc.spec ?? {}) as {
    zone?: string;
    publicHost?: string;
    connectivity?: { cloudflare?: { enabled?: boolean; zone?: string; publicHost?: string } };
  };
  const out: { zone: string; host: string }[] = [];
  if (spec.zone && spec.publicHost) out.push({ zone: spec.zone, host: spec.publicHost });
  const cf = spec.connectivity?.cloudflare;
  if (cf?.zone && cf.publicHost) out.push({ zone: cf.zone, host: cf.publicHost });
  return out;
}

export function checkEdgeHosts(claim: ManifestDoc): GateOutcome {
  const label = `${claim.file} ${String(claim.doc.kind)}/${metaName(claim.doc)}`;
  const hosts = edgeHosts(claim.doc);
  const problems = hosts.map(({ zone, host }) => edgeHostProblem(zone, host)).filter((p): p is string => !!p);
  return problems.length
    ? { status: "fail", detail: `${label}: ${problems.join("; ")}` }
    : { status: "pass", detail: `${label}: ${hosts.map((h) => h.host).join(", ")} covered by the zone's edge certificate` };
}

export function newAjv(): Ajv {
  return new Ajv({ strict: false, allErrors: true });
}

/** `crossplane composition render` takes a composite resource, not a claim. */
export function claimToXr(claim: Record<string, unknown>, xrd: Xrd): Record<string, unknown> {
  return {
    apiVersion: claim.apiVersion,
    kind: xrd.kind,
    metadata: { name: metaName(claim) },
    spec: { ...((claim.spec as Record<string, unknown>) ?? {}) },
  };
}
