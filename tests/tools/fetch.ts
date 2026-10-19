import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { run } from "../lib/proc";
import { CLOUD_INIT_SCHEMA, currentPlatform, type PinnedArtifact } from "./pins";

export const CACHE_DIR = process.env.ORB_CACHE_DIR ?? join(import.meta.dir, "../../.cache");
export const BIN_DIR = join(CACHE_DIR, "bin");

export function sha256(data: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(data).digest("hex");
}

export function verifyChecksum(data: Uint8Array, expected: string, label: string): void {
  const actual = sha256(data);
  if (actual !== expected) throw new Error(`${label}: sha256 ${actual} does not match pinned ${expected}`);
}

async function download(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Fetch a file once into the cache, verified against its pinned sha256. */
export async function cachedFile(path: string, url: string, expectedSha: string): Promise<Uint8Array> {
  if (existsSync(path)) {
    const data = new Uint8Array(readFileSync(path));
    if (sha256(data) === expectedSha) return data;
  }
  const data = await download(url);
  verifyChecksum(data, expectedSha, url);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  return data;
}

/** Install a pinned binary into `<cacheDir>/bin` and return its path. */
export async function ensureTool(artifact: PinnedArtifact, cacheDir = CACHE_DIR): Promise<string> {
  const pin = artifact.platforms[currentPlatform()];
  if (!pin) throw new Error(`${artifact.name}: no pin for ${currentPlatform()}`);
  const binDir = join(cacheDir, "bin");
  const target = join(binDir, `${artifact.name}-${artifact.version}`);
  const marker = `${target}.sha256`;
  if (existsSync(target) && existsSync(marker) && readFileSync(marker, "utf8") === pin.sha256) return target;

  const downloaded = join(cacheDir, "downloads", `${artifact.name}-${artifact.version}${pin.archiveMember ? ".tar.gz" : ""}`);
  await cachedFile(downloaded, pin.url, pin.sha256);
  mkdirSync(binDir, { recursive: true });
  if (pin.archiveMember) {
    const extractDir = join(cacheDir, "extract", `${artifact.name}-${artifact.version}`);
    mkdirSync(extractDir, { recursive: true });
    await run(["tar", "-xzf", downloaded, "-C", extractDir, pin.archiveMember]);
    writeFileSync(target, readFileSync(join(extractDir, pin.archiveMember)));
  } else {
    writeFileSync(target, readFileSync(downloaded));
  }
  chmodSync(target, 0o755);
  writeFileSync(marker, pin.sha256);
  return target;
}

export async function cloudInitSchema(): Promise<Record<string, unknown>> {
  const path = join(CACHE_DIR, `cloud-init-schema-${CLOUD_INIT_SCHEMA.version}.json`);
  const data = await cachedFile(path, CLOUD_INIT_SCHEMA.url, CLOUD_INIT_SCHEMA.sha256);
  return JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>;
}
