import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkCloudInit, type SchemaValidator } from "./cloudinit";
import { checkCompose, duplicateLabelKeys, orbDomains } from "./compose";
import { doc } from "./fixtures";
import { checkKustomization, isKustomization } from "./kustomize";
import { apiGroup, classify, labels, listYamlFiles, loadManifests, metaName, parseText, type ManifestDoc, type ParseProblem } from "./manifests";
import { composedResources, summarizeKubeconform } from "./tools";

describe("manifests", () => {
  test("classify distinguishes cloud-init, compose, and Kubernetes", () => {
    expect(classify("#cloud-config\nhostname: a", { hostname: "a" })).toBe("cloud-init");
    expect(classify("", { services: {} })).toBe("compose");
    expect(classify("", { apiVersion: "v1", kind: "Namespace" })).toBe("k8s");
    expect(classify("", { foo: 1 })).toBeUndefined();
  });

  test("parseText reports bad YAML, non-mappings, unknown shapes, and missing kind", () => {
    const docs: ManifestDoc[] = [];
    const problems: ParseProblem[] = [];
    parseText("bad.yaml", "a: [", docs, problems);
    parseText("list.yaml", "- 1\n- 2\n", docs, problems);
    parseText("other.yaml", "foo: 1\n", docs, problems);
    parseText("nokind.yaml", "apiVersion: v1\n", docs, problems);
    parseText("ok.yaml", "apiVersion: v1\nkind: Namespace\nmetadata: {name: a}\n---\n", docs, problems);
    expect(problems.map((p) => p.file)).toEqual(["bad.yaml", "list.yaml", "other.yaml", "nokind.yaml"]);
    expect(docs).toHaveLength(1);
  });

  test("loadManifests walks only the manifest roots and skips node_modules", () => {
    const root = mkdtempSync(join(tmpdir(), "orb-manifests-"));
    mkdirSync(join(root, "crossplane/node_modules"), { recursive: true });
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "crossplane/a.yaml"), "apiVersion: v1\nkind: Namespace\nmetadata: {name: a}\n");
    writeFileSync(join(root, "crossplane/node_modules/x.yaml"), "junk: [");
    writeFileSync(join(root, "docs/ignored.yaml"), "junk: [");
    expect(listYamlFiles(root)).toHaveLength(1);
    const { docs, problems } = loadManifests(root);
    expect(problems).toEqual([]);
    expect(docs[0]?.file).toBe("crossplane/a.yaml");
  });

  test("apiGroup, metaName, labels", () => {
    expect(apiGroup("apps/v1")).toEqual({ group: "apps", version: "v1" });
    expect(apiGroup("v1")).toEqual({ group: "", version: "v1" });
    expect(metaName({})).toBe("<unnamed>");
    expect(labels({ metadata: { labels: { a: "b" } } })).toEqual({ a: "b" });
  });
});

describe("compose", () => {
  test("finds duplicate list-form label keys", () => {
    expect(duplicateLabelKeys(["a=1", "a=2", "b=3"])).toEqual(["a"]);
    expect(duplicateLabelKeys({ a: "1" })).toEqual([]);
  });

  test("collects comma-separated OrbStack domains from either label form", () => {
    expect(orbDomains(["dev.orbstack.domains=s3.aws.orb.local,sqs.aws.orb.local"])).toEqual(["s3.aws.orb.local", "sqs.aws.orb.local"]);
    expect(orbDomains({ "dev.orbstack.domains": "billing.internal.orb.local" })).toEqual(["billing.internal.orb.local"]);
    expect(orbDomains(undefined)).toEqual([]);
  });

  test("requires image, pinned platform, and unique labels", () => {
    const bad = doc("compose.yml", { services: { a: { labels: ["k=1", "k=2"] } } }, "compose");
    const o = checkCompose(bad);
    expect(o.status).toBe("fail");
    expect(o.detail).toContain("no image or build");
    expect(o.detail).toContain("platform not pinned");
    expect(o.detail).toContain("set more than once");
    expect(checkCompose(doc("c.yml", { services: {} }, "compose")).detail).toContain("no services");
    expect(checkCompose(doc("c.yml", { services: { a: { image: "x", platform: "linux/arm64" } } }, "compose")).status).toBe("pass");
  });
});

describe("cloud-init", () => {
  const accept: SchemaValidator = () => [];

  test("requires final_message for the GCE parity gate", () => {
    expect(checkCloudInit(doc("u.yaml", { hostname: "a" }, "cloud-init"), accept).detail).toContain("final_message is required");
    expect(checkCloudInit(doc("u.yaml", { final_message: "done" }, "cloud-init"), accept).status).toBe("pass");
  });

  test("surfaces schema errors", () => {
    const reject: SchemaValidator = () => ["/packages must be array"];
    expect(checkCloudInit(doc("u.yaml", { final_message: "done" }, "cloud-init"), reject).detail).toContain("must be array");
  });
});

describe("kustomize", () => {
  const k = doc("blueprint/tier1/kustomization.yaml", {
    apiVersion: "kustomize.config.k8s.io/v1beta1",
    kind: "Kustomization",
    resources: ["a.yaml", "missing.yaml", "https://example.invalid/remote.yaml"],
  });

  test("only config.k8s.io Kustomizations count (not Flux)", () => {
    expect(isKustomization(k)).toBe(true);
    expect(isKustomization(doc("f.yaml", { apiVersion: "kustomize.toolkit.fluxcd.io/v1", kind: "Kustomization" }))).toBe(false);
  });

  test("reports missing local resources and ignores remote URLs", () => {
    const o = checkKustomization(k, "/repo", (p) => String(p).endsWith("a.yaml"));
    expect(o.status).toBe("fail");
    expect(o.detail).toBe("blueprint/tier1/kustomization.yaml: missing resources missing.yaml");
  });
});

describe("tool output parsing", () => {
  test("kubeconform counts come from summary; failures from resources", () => {
    const s = summarizeKubeconform(
      JSON.stringify({
        resources: [{ filename: "a.yaml", kind: "Service", name: "x", status: "statusInvalid", msg: "bad port" }],
        summary: { valid: 10, invalid: 2, errors: 0, skipped: 3 },
      }),
    );
    expect(s).toEqual({ valid: 10, skipped: 3, problems: ["a.yaml Service/x: bad port", "1 more invalid resources without detail"] });
  });

  test("composedResources drops the XR and function results", () => {
    const out = "apiVersion: a/v1\nkind: XWidget\n---\napiVersion: b/v1\nkind: Object\n---\napiVersion: render/v1\nkind: Result\n";
    expect(composedResources(out, "XWidget").map((r) => r.kind)).toEqual(["Object"]);
  });
});
