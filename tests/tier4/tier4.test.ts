import { describe, expect, test } from "bun:test";
import { insertAllBody, insertAllUrl, insertErrors, parseNdjson } from "./bigquery";
import { compareContracts, CONTRACT_STEPS, resourceNames } from "./contract";
import { evaluateSerial, instanceBody, instanceName, renderUserData, serialOutcome } from "./gce";

describe("gce", () => {
  test("renderUserData substitutes the bootstrap placeholders, blank when unset", () => {
    expect(renderUserData("k: ${ORB_SSH_PUBKEY}\nt: ${TS_AUTHKEY}", { ORB_SSH_PUBKEY: "ssh-ed25519 AAA" })).toBe("k: ssh-ed25519 AAA\nt: ");
  });

  test("instanceName is a valid GCE name derived from the file", () => {
    expect(instanceName("1234", "blueprint/tier3-cloudinit/postgres-userdata.yaml")).toBe("gce-parity-1234-postgres");
    expect(instanceName("Local_9", "vault-userdata.yaml")).toBe("gce-parity-local-9-vault");
  });

  test("instanceBody targets ARM64 Ubuntu and carries the user-data verbatim", () => {
    const body = instanceBody("gce-parity-1-postgres", "#cloud-config\n", "1") as {
      machineType: string;
      metadata: { items: { key: string; value: string }[] };
      labels: Record<string, string>;
    };
    expect(body.machineType).toEndWith("t2a-standard-2");
    expect(body.metadata.items[0]).toEqual({ key: "user-data", value: "#cloud-config\n" });
    expect(body.labels.purpose).toBe("osc-parity");
  });

  test("evaluateSerial detects completion and cloud-init failures", () => {
    const ok = evaluateSerial("[  42.1] cloud-init[812]: postgres.orb.local tier3 cloud-init complete\n", "postgres.orb.local tier3 cloud-init complete");
    expect(ok).toEqual({ done: true, failures: [] });
    const bad = evaluateSerial("cloud-init[812]: 2026 - util.py[WARNING]: Failed to run module scripts_user\n", "complete");
    expect(bad.failures).toHaveLength(1);
  });

  test("serialOutcome", () => {
    expect(serialOutcome("p.yaml", { done: true, failures: [] }, 95).status).toBe("pass");
    expect(serialOutcome("p.yaml", { done: false, failures: [] }, 900).detail).toContain("not seen");
    expect(serialOutcome("p.yaml", { done: true, failures: ["x"] }, 1).status).toBe("fail");
  });
});

describe("billing contract parity", () => {
  const all = (ok: boolean) => CONTRACT_STEPS.map((step) => ({ step, ok, detail: ok ? "" : "AccessDenied" }));

  test("identical success is parity", () => {
    expect(compareContracts(all(true), all(true))).toEqual({ ok: true, differences: [] });
  });

  test("a failing or missing step on either side is a difference", () => {
    const r = compareContracts(all(true), all(true).slice(0, 2));
    expect(r.ok).toBe(false);
    expect(r.differences[0]).toContain("aws=not run");
    expect(compareContracts(all(false), all(true)).differences[0]).toContain("localstack=AccessDenied");
  });

  test("resourceNames are run-scoped", () => {
    expect(resourceNames("Run_42")).toEqual({ bucket: "invoices-archive-run-42", queue: "billing-events-run-42" });
  });
});

describe("bigquery", () => {
  test("insertAll body keys each row with a stable insertId", () => {
    const body = insertAllBody([{ run_id: "1", gate: "boot" }], (r) => `${r.run_id}:${r.gate}`);
    expect(body.rows[0]).toEqual({ insertId: "1:boot", json: { run_id: "1", gate: "boot" } });
  });

  test("parseNdjson skips blank lines; insertErrors flattens", () => {
    expect(parseNdjson('{"a":1}\n\n{"a":2}\n')).toEqual([{ a: 1 }, { a: 2 }]);
    expect(insertErrors({ insertErrors: [{ index: 0, errors: [{ message: "no such field" }] }] })).toEqual(["row 0: no such field"]);
    expect(insertErrors({})).toEqual([]);
  });

  test("insertAllUrl", () => {
    expect(insertAllUrl("p", "d", "t")).toBe("https://bigquery.googleapis.com/bigquery/v2/projects/p/datasets/d/tables/t/insertAll");
  });
});
