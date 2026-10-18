import { dirname } from "node:path";
import type { Gate, GateOutcome } from "../lib/gates";
import { runGates } from "../lib/gates";
import { finish } from "../lib/report";
import { cloudInitSchema, ensureTool } from "../tools/fetch";
import { CROSSPLANE_CLI, KUBECONFORM } from "../tools/pins";
import { checkCloudInit, compileCloudInitSchema } from "./cloudinit";
import { checkCompose } from "./compose";
import {
  checkClaim,
  checkComposition,
  checkEdgeHosts,
  compositions,
  edgeHosts,
  findXrd,
  functionNames,
  indexXrds,
  isClaimOrXr,
  newAjv,
} from "./crossplane";
import { checkKustomization, isKustomization } from "./kustomize";
import { loadManifests, metaName, REPO_ROOT } from "./manifests";
import { composeConfig, kubeconform, kustomizeBuild, renderAndValidate } from "./tools";

const gate = (name: string, run: () => Promise<GateOutcome> | GateOutcome): Gate => ({ tier: 1, name, run: async () => run() });

const { docs, problems } = loadManifests(REPO_ROOT);
const xrds = indexXrds(docs);
const comps = compositions(docs);
const compositionNames = new Set(comps.map((c) => metaName(c.doc)));
const fns = functionNames(docs);
const ajv = newAjv();
const claims = docs.filter((d) => isClaimOrXr(d, xrds));
const k8sFiles = (prefix: string) =>
  [...new Set(docs.filter((d) => d.kind === "k8s" && d.file.startsWith(prefix) && !isKustomization(d) && !isClaimOrXr(d, xrds)).map((d) => d.file))];

const gates: Gate[] = [
  gate("yaml-parse", () =>
    problems.length
      ? { status: "fail", detail: problems.map((p) => `${p.file}: ${p.message}`).join("; ") }
      : { status: "pass", detail: `${docs.length} documents parse and classify` },
  ),
  ...comps.map((c) => gate(`composition:${metaName(c.doc)}`, () => checkComposition(c, xrds, fns))),
  ...claims.map((c) => gate(`claim:${String(c.doc.kind)}/${metaName(c.doc)}`, () => checkClaim(c, xrds, compositionNames, ajv))),
  ...claims
    .filter((c) => edgeHosts(c.doc).length)
    .map((c) => gate(`edge-host:${String(c.doc.kind)}/${metaName(c.doc)}`, () => checkEdgeHosts(c))),
  ...docs.filter(isKustomization).map((k) => gate(`kustomization:${k.file}`, () => checkKustomization(k, REPO_ROOT))),
  ...docs.filter(isKustomization).map((k) => gate(`kustomize-build:${dirname(k.file)}`, () => kustomizeBuild(dirname(k.file), REPO_ROOT))),
  ...docs.filter((d) => d.kind === "compose").map((d) => gate(`compose:${d.file}`, () => checkCompose(d))),
  ...docs.filter((d) => d.kind === "compose").map((d) => gate(`compose-config:${d.file}`, () => composeConfig(d.file, REPO_ROOT))),
];

const cloudInitDocs = docs.filter((d) => d.kind === "cloud-init");
if (cloudInitDocs.length) {
  const validate = compileCloudInitSchema(await cloudInitSchema());
  gates.push(...cloudInitDocs.map((d) => gate(`cloud-init:${d.file}`, () => checkCloudInit(d, validate))));
}

const kubeconformBin = await ensureTool(KUBECONFORM);
gates.push(
  gate("kubeconform:blueprint", () => kubeconform(kubeconformBin, k8sFiles("blueprint/"), { label: "blueprint", crdCatalog: false, cwd: REPO_ROOT })),
  gate("kubeconform:crossplane", () =>
    kubeconform(kubeconformBin, [...k8sFiles("crossplane/"), ...k8sFiles("clusters/")], { label: "crossplane+clusters", crdCatalog: true, cwd: REPO_ROOT }),
  ),
);

const crossplaneBin = await ensureTool(CROSSPLANE_CLI);
const functionDocs = docs.filter((d) => d.doc.kind === "Function");
const extensions = docs.filter((d) => d.doc.kind === "CompositeResourceDefinition" || d.doc.kind === "Provider");
for (const claim of claims) {
  const ref = (claim.doc.spec as { compositionRef?: { name?: string } } | undefined)?.compositionRef?.name;
  const composition = comps.find((c) => metaName(c.doc) === ref);
  const match = findXrd(xrds, String(claim.doc.apiVersion), String(claim.doc.kind));
  if (!composition || !match) continue;
  gates.push(
    gate(`render:${String(claim.doc.kind)}/${metaName(claim.doc)}`, () =>
      renderAndValidate(crossplaneBin, { claim, xrd: match.xrd, composition, functions: functionDocs, extensions }),
    ),
  );
}

finish("tier1-static", await runGates(gates));
