import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cachedFile, sha256 } from "./fetch";

const payload = new TextEncoder().encode("pinned artifact");
let hits = 0;
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      hits++;
      return new URL(req.url).pathname === "/missing" ? new Response("nope", { status: 404 }) : new Response(payload);
    },
  });
});
afterAll(() => server.stop(true));

describe("cachedFile", () => {
  const dir = mkdtempSync(join(tmpdir(), "orb-cache-"));

  test("downloads, verifies, and caches; a second call is served from disk", async () => {
    const path = join(dir, "a.bin");
    const url = `http://127.0.0.1:${server.port}/a`;
    const before = hits;
    expect(await cachedFile(path, url, sha256(payload))).toEqual(payload);
    expect(existsSync(path)).toBe(true);
    await cachedFile(path, url, sha256(payload));
    expect(hits - before).toBe(1);
  });

  test("a corrupted cache entry is re-downloaded", async () => {
    const path = join(dir, "b.bin");
    writeFileSync(path, "tampered");
    expect(await cachedFile(path, `http://127.0.0.1:${server.port}/b`, sha256(payload))).toEqual(payload);
  });

  test("rejects a checksum mismatch and does not cache it", async () => {
    const path = join(dir, "c.bin");
    await expect(cachedFile(path, `http://127.0.0.1:${server.port}/c`, "0".repeat(64))).rejects.toThrow("does not match pinned");
    expect(existsSync(path)).toBe(false);
  });

  test("surfaces HTTP errors", async () => {
    await expect(cachedFile(join(dir, "d.bin"), `http://127.0.0.1:${server.port}/missing`, sha256(payload))).rejects.toThrow("HTTP 404");
  });
});
