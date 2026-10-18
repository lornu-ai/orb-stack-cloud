import { describe, expect, test } from "bun:test";
import {
  checkClaim,
  checkComposition,
  checkEdgeHosts,
  claimToXr,
  edgeHosts,
  findXrd,
  functionNames,
  indexXrds,
  isClaimOrXr,
} from "./crossplane";
import { claim, COMPOSITION, doc, FUNCTION, XRD } from "./fixtures";

const xrds = indexXrds([XRD]);
const fns = functionNames([FUNCTION]);

describe("indexXrds / findXrd", () => {
  test("indexes kind, claim kind, versions, and the planning label", () => {
    expect(xrds[0]).toMatchObject({ group: "example.orb.local", kind: "XWidget", claimKind: "WidgetClaim", planning: true });
  });

  test("matches both the XR kind and the claim kind, and only served versions", () => {
    expect(findXrd(xrds, "example.orb.local/v1alpha1", "XWidget")).toBeDefined();
    expect(findXrd(xrds, "example.orb.local/v1alpha1", "WidgetClaim")).toBeDefined();
    expect(findXrd(xrds, "example.orb.local/v2", "WidgetClaim")).toBeUndefined();
  });
});

describe("checkComposition", () => {
  test("passes when the XRD and every Function exist", () => {
    expect(checkComposition(COMPOSITION, xrds, fns).status).toBe("pass");
  });

  test("fails on an undeclared Function", () => {
    const o = checkComposition(COMPOSITION, xrds, new Set());
    expect(o.status).toBe("fail");
    expect(o.detail).toContain("which no manifest declares");
  });

  test("fails on an unknown composite type and a step with no functionRef", () => {
    const bad = doc("c.yaml", {
      kind: "Composition",
      spec: { compositeTypeRef: { apiVersion: "nope.io/v1", kind: "X" }, mode: "Pipeline", pipeline: [{ step: "s" }] },
    });
    const o = checkComposition(bad, xrds, fns);
    expect(o.detail).toContain("no XRD serves X");
    expect(o.detail).toContain("step s has no functionRef");
  });

  test("fails when compositeTypeRef is missing", () => {
    expect(checkComposition(doc("c.yaml", { kind: "Composition", spec: {} }), xrds, fns).detail).toContain("incomplete");
  });
});

describe("checkClaim", () => {
  const compositions = new Set(["widget"]);

  test("passes when valid and its Composition exists", () => {
    expect(checkClaim(claim({ size: "s", compositionRef: { name: "widget" } }), xrds, compositions).status).toBe("pass");
  });

  test("reports schema violations with paths", () => {
    const o = checkClaim(claim({ size: "xl" }), xrds, compositions);
    expect(o.status).toBe("fail");
    expect(o.detail).toContain("/spec/size");
  });

  test("a missing Composition behind a planning XRD is a visible skip", () => {
    const o = checkClaim(claim({ size: "m", compositionRef: { name: "absent" } }), xrds, compositions);
    expect(o.status).toBe("skip");
    expect(o.detail).toContain("does not exist");
  });

  test("a missing Composition behind a released XRD fails", () => {
    const released = indexXrds([doc(XRD.file, { ...XRD.doc, metadata: { name: "x" } })]);
    expect(checkClaim(claim({ size: "m", compositionRef: { name: "absent" } }), released, compositions).status).toBe("fail");
  });

  test("fails when no XRD serves the kind, or the XRD has no schema", () => {
    expect(checkClaim(doc("c.yaml", { apiVersion: "x.io/v1", kind: "Nope" }), xrds, compositions).status).toBe("fail");
    const schemaless = indexXrds([
      doc("x.yaml", {
        kind: "CompositeResourceDefinition",
        metadata: { name: "bare" },
        spec: { group: "example.orb.local", names: { kind: "XWidget" }, claimNames: { kind: "WidgetClaim" }, versions: [{ name: "v1alpha1" }] },
      }),
    ]);
    expect(checkClaim(claim({ size: "s" }), schemaless, compositions).detail).toContain("no openAPIV3Schema");
  });
});

describe("edge hosts", () => {
  test("collects both edge XRD shapes", () => {
    expect(
      edgeHosts({
        spec: { zone: "stevedores.org", publicHost: "osc.stevedores.org", connectivity: { cloudflare: { zone: "stevedores.org", publicHost: "b.stevedores.org" } } },
      }),
    ).toHaveLength(2);
  });

  test("passes for one label below the zone and fails deeper", () => {
    expect(checkEdgeHosts(claim({ size: "s", zone: "stevedores.org", publicHost: "osc.stevedores.org" })).status).toBe("pass");
    expect(checkEdgeHosts(claim({ size: "s", zone: "stevedores.org", publicHost: "pr-1.ci.osc.stevedores.org" })).status).toBe("fail");
  });
});

describe("claimToXr / isClaimOrXr", () => {
  test("converts a claim into a cluster-scoped XR for render", () => {
    const xr = claimToXr(claim({ size: "s" }).doc, xrds[0]!);
    expect(xr).toEqual({ apiVersion: "example.orb.local/v1alpha1", kind: "XWidget", metadata: { name: "w1" }, spec: { size: "s" } });
  });

  test("recognizes documents in an XRD-owned group only", () => {
    expect(isClaimOrXr(claim({}), xrds)).toBe(true);
    expect(isClaimOrXr(doc("d.yaml", { apiVersion: "apps/v1", kind: "Deployment" }), xrds)).toBe(false);
    expect(isClaimOrXr(doc("c.yaml", {}, "compose"), xrds)).toBe(false);
  });
});
