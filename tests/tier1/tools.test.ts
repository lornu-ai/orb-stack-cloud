import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileCloudInitSchema } from "./cloudinit";
import { kubeconform } from "./tools";

/** A stand-in kubeconform: a Bun script that prints a fixed report and exits with a fixed code. */
function fakeKubeconform(report: unknown, exitCode: number): string {
  const dir = mkdtempSync(join(tmpdir(), "orb-fake-kc-"));
  const bin = join(dir, "kubeconform");
  writeFileSync(bin, `#!/usr/bin/env bun\nconsole.log(${JSON.stringify(JSON.stringify(report))});\nprocess.exit(${exitCode});\n`);
  chmodSync(bin, 0o755);
  return bin;
}

const opts = { label: "blueprint", crdCatalog: true, cwd: tmpdir() };

describe("kubeconform gate", () => {
  test("passes with counts from the summary", async () => {
    const bin = fakeKubeconform({ resources: [], summary: { valid: 4, invalid: 0, errors: 0, skipped: 1 } }, 0);
    const o = await kubeconform(bin, ["a.yaml"], opts);
    expect(o.status).toBe("pass");
    expect(o.metrics).toEqual({ valid: 4, skipped: 1 });
  });

  test("fails with per-resource messages", async () => {
    const bin = fakeKubeconform(
      { resources: [{ filename: "a.yaml", kind: "Service", name: "x", status: "statusInvalid", msg: "bad port" }], summary: { valid: 0, invalid: 1 } },
      1,
    );
    expect((await kubeconform(bin, ["a.yaml"], opts)).detail).toContain("bad port");
  });

  test("validating nothing is a failure, and no files is a skip", async () => {
    const bin = fakeKubeconform({ resources: [], summary: { valid: 0, skipped: 3 } }, 0);
    expect((await kubeconform(bin, ["a.yaml"], opts)).status).toBe("fail");
    expect((await kubeconform(bin, [], opts)).status).toBe("skip");
  });

  test("a crash without a report is an error", async () => {
    const bin = fakeKubeconform({ summary: { valid: 1 } }, 2);
    expect((await kubeconform(bin, ["a.yaml"], opts)).status).toBe("error");
  });
});

describe("compileCloudInitSchema", () => {
  const validate = compileCloudInitSchema({
    $schema: "http://json-schema.org/draft-04/schema#",
    type: "object",
    properties: { packages: { type: "array" }, write_files: { type: "array", items: { properties: { source: { properties: { uri: { format: "uri" } } } } } } },
  });

  test("accepts a valid document and reports paths for invalid ones", () => {
    expect(validate({ packages: ["postgresql-16"] })).toEqual([]);
    expect(validate({ packages: "postgresql-16" })[0]).toContain("/packages");
  });

  test("enforces formats such as uri", () => {
    expect(validate({ write_files: [{ source: { uri: "not a uri" } }] })[0]).toContain("uri");
  });
});
