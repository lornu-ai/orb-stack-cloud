import AjvDraft04 from "ajv-draft-04";
import addFormats from "ajv-formats";
import type { GateOutcome } from "../lib/gates";
import type { ManifestDoc } from "./manifests";

export type SchemaValidator = (doc: unknown) => string[];

export function compileCloudInitSchema(schema: Record<string, unknown>): SchemaValidator {
  const ajv = new AjvDraft04({ strict: false, allErrors: true });
  addFormats(ajv as unknown as Parameters<typeof addFormats>[0]);
  const validate = ajv.compile(schema);
  return (doc) => (validate(doc) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`));
}

/**
 * Upstream schema validation plus one repo rule: Tier 3 user-data must set
 * `final_message`, because the GCE parity gate waits for it on the serial console.
 */
export function checkCloudInit(d: ManifestDoc, validate: SchemaValidator): GateOutcome {
  const problems = validate(d.doc);
  if (typeof d.doc.final_message !== "string" || !d.doc.final_message.trim()) {
    problems.push("final_message is required (GCE parity watches the serial console for it)");
  }
  return problems.length
    ? { status: "fail", detail: `${d.file}: ${problems.join("; ")}` }
    : { status: "pass", detail: `${d.file}: valid cloud-config; final_message set` };
}
