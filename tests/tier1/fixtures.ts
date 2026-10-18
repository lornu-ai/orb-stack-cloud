import type { ManifestDoc } from "./manifests";

export const doc = (file: string, d: Record<string, unknown>, kind: ManifestDoc["kind"] = "k8s"): ManifestDoc => ({
  file,
  index: 0,
  kind,
  doc: d,
});

export const XRD = doc("crossplane/xrd.yaml", {
  apiVersion: "apiextensions.crossplane.io/v1",
  kind: "CompositeResourceDefinition",
  metadata: { name: "xwidgets.example.orb.local", labels: { "orbstack.lornu.ai/status": "planning" } },
  spec: {
    group: "example.orb.local",
    names: { kind: "XWidget" },
    claimNames: { kind: "WidgetClaim" },
    versions: [
      {
        name: "v1alpha1",
        schema: {
          openAPIV3Schema: {
            type: "object",
            properties: {
              spec: {
                type: "object",
                properties: { size: { type: "string", enum: ["s", "m"] }, zone: { type: "string" }, publicHost: { type: "string" } },
                required: ["size"],
              },
            },
            required: ["spec"],
          },
        },
      },
    ],
  },
});

export const claim = (spec: Record<string, unknown>, name = "w1") =>
  doc("examples/claim.yaml", { apiVersion: "example.orb.local/v1alpha1", kind: "WidgetClaim", metadata: { name }, spec });

export const COMPOSITION = doc("crossplane/composition.yaml", {
  apiVersion: "apiextensions.crossplane.io/v1",
  kind: "Composition",
  metadata: { name: "widget" },
  spec: {
    compositeTypeRef: { apiVersion: "example.orb.local/v1alpha1", kind: "XWidget" },
    mode: "Pipeline",
    pipeline: [{ step: "pt", functionRef: { name: "function-patch-and-transform" } }],
  },
});

export const FUNCTION = doc("crossplane/functions/fn.yaml", {
  apiVersion: "pkg.crossplane.io/v1beta1",
  kind: "Function",
  metadata: { name: "function-patch-and-transform" },
});
