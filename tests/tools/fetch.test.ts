import { describe, expect, test } from "bun:test";
import { sha256, verifyChecksum } from "./fetch";
import { currentPlatform, CROSSPLANE_CLI, KUBECONFORM } from "./pins";

describe("checksums", () => {
  const data = new TextEncoder().encode("orbstack");

  test("sha256 is lowercase hex", () => {
    expect(sha256(data)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a mismatched pin is rejected", () => {
    expect(() => verifyChecksum(data, "0".repeat(64), "tool")).toThrow("does not match pinned");
  });

  test("a matching pin is accepted", () => {
    expect(() => verifyChecksum(data, sha256(data), "tool")).not.toThrow();
  });
});

describe("pins", () => {
  test("every pinned tool covers the macOS runner and the Linux runner", () => {
    for (const artifact of [CROSSPLANE_CLI, KUBECONFORM]) {
      expect(Object.keys(artifact.platforms).sort()).toEqual(["darwin-arm64", "linux-amd64"]);
      for (const pin of Object.values(artifact.platforms)) expect(pin?.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("platform detection", () => {
    expect(currentPlatform("darwin", "arm64")).toBe("darwin-arm64");
    expect(currentPlatform("linux", "x64")).toBe("linux-amd64");
    expect(() => currentPlatform("win32", "x64")).toThrow("no pinned tools");
  });
});
