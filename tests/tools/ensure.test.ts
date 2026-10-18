import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../lib/proc";
import { ensureTool, sha256 } from "./fetch";
import { currentPlatform, type PinnedArtifact } from "./pins";

const binary = new TextEncoder().encode("#!/bin/sh\necho fake-tool\n");
let tarball: Uint8Array;
let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "orb-tar-"));
  writeFileSync(join(dir, "faketool"), binary);
  await run(["tar", "-czf", join(dir, "faketool.tar.gz"), "-C", dir, "faketool"]);
  tarball = new Uint8Array(readFileSync(join(dir, "faketool.tar.gz")));
  server = Bun.serve({ port: 0, fetch: (req) => new Response(new URL(req.url).pathname.endsWith(".tar.gz") ? tarball : binary) });
});
afterAll(() => server.stop(true));

const artifact = (name: string, archive: boolean): PinnedArtifact => ({
  name,
  version: `test-${Date.now()}`,
  platforms: {
    [currentPlatform()]: {
      url: `http://127.0.0.1:${server.port}/${name}${archive ? ".tar.gz" : ""}`,
      sha256: sha256(archive ? tarball : binary),
      archiveMember: archive ? "faketool" : undefined,
    },
  },
});

describe("ensureTool", () => {
  test("installs a plain binary as executable and reuses it", async () => {
    const a = artifact("osc-plain", false);
    const path = await ensureTool(a);
    expect(readFileSync(path)).toEqual(Buffer.from(binary));
    expect(statSync(path).mode & 0o111).not.toBe(0);
    expect(await ensureTool(a)).toBe(path);
  });

  test("extracts the pinned member from a tarball", async () => {
    const path = await ensureTool(artifact("osc-archive", true));
    expect(readFileSync(path, "utf8")).toContain("fake-tool");
  });

  test("an artifact without a pin for this platform is rejected", async () => {
    await expect(ensureTool({ name: "osc-none", version: "v0", platforms: {} })).rejects.toThrow("no pin");
  });
});
