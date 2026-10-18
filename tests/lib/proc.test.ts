import { describe, expect, test } from "bun:test";
import { CommandError, run, sleep, which } from "./proc";

describe("run", () => {
  test("captures stdout, passes stdin and env", async () => {
    const r = await run(["sh", "-c", 'read x; echo "$x-$OSC_TEST"'], { stdin: "hi\n", env: { OSC_TEST: "ok" } });
    expect(r).toMatchObject({ code: 0, stdout: "hi-ok\n", timedOut: false });
  });

  test("throws CommandError with the stderr tail on non-zero exit", async () => {
    const err = await run(["sh", "-c", "echo boom >&2; exit 3"]).catch((e) => e);
    expect(err).toBeInstanceOf(CommandError);
    expect((err as CommandError).message).toContain("exited 3");
    expect((err as CommandError).message).toContain("boom");
  });

  test("allowFailure returns the result instead", async () => {
    expect((await run(["sh", "-c", "exit 2"], { allowFailure: true })).code).toBe(2);
  });

  test("kills the process at the timeout", async () => {
    const r = await run(["sleep", "5"], { timeoutMs: 100, allowFailure: true });
    expect(r.timedOut).toBe(true);
  });
});

describe("which / sleep", () => {
  test("which finds sh and not a missing binary", async () => {
    expect(await which("sh")).toBeDefined();
    expect(await which("definitely-not-a-binary-osc")).toBeUndefined();
  });

  test("sleep waits", async () => {
    const t0 = performance.now();
    await sleep(20);
    expect(performance.now() - t0).toBeGreaterThanOrEqual(15);
  });
});
