import { afterEach, describe, expect, test } from "bun:test";
import { FakeBins } from "./fakebin";
import { cleanupCiResources, listMachines, machineExec, waitSystemReady } from "./orb";

let fakes: FakeBins | undefined;
afterEach(() => fakes?.restore());

const machines = JSON.stringify([{ name: "aivcsd-amd64-build" }, { name: "ci-osc-boot-0" }, { name: "postgres" }]);

describe("cleanupCiResources", () => {
  test("deletes only ci-osc-* machines and containers, never the user's own", async () => {
    fakes = new FakeBins()
      .add("orb", [{ match: ["list", "-f", "json"], stdout: machines }])
      .add("docker", [{ match: ["ps", "-a"], stdout: "ci-osc-target\nmy-postgres\n\nci-osc-inotify\n" }])
      .activate();
    const removed = await cleanupCiResources(() => {});
    expect(removed).toEqual(["machine ci-osc-boot-0", "container ci-osc-target", "container ci-osc-inotify"]);
    const destructive = fakes.calls().filter((c) => c.includes("delete") || c.includes("rm"));
    expect(destructive).toEqual([
      ["orb", "delete", "-f", "ci-osc-boot-0"],
      ["docker", "rm", "-f", "ci-osc-target"],
      ["docker", "rm", "-f", "ci-osc-inotify"],
    ]);
  });
});

describe("machine helpers", () => {
  test("listMachines parses orb's JSON", async () => {
    fakes = new FakeBins().add("orb", [{ match: ["list", "-f", "json"], stdout: machines }]).activate();
    expect((await listMachines()).map((m) => m.name)).toEqual(["aivcsd-amd64-build", "ci-osc-boot-0", "postgres"]);
  });

  test("machineExec targets the machine and, when asked, root", async () => {
    fakes = new FakeBins().add("orb", []).activate();
    await machineExec("ci-osc-x", ["fstrim", "-av"], { root: true });
    expect(fakes.calls()[0]).toEqual(["orb", "-m", "ci-osc-x", "-u", "root", "fstrim", "-av"]);
  });

  test("waitSystemReady accepts running or degraded and rejects anything else", async () => {
    fakes = new FakeBins()
      .add("orb", [
        { match: ["-m", "ci-osc-ok"], stdout: "running\n" },
        { match: ["-m", "ci-osc-deg"], stdout: "degraded\n", code: 1 },
        { match: ["-m", "ci-osc-bad"], stdout: "maintenance\n", code: 1 },
      ])
      .activate();
    expect(await waitSystemReady("ci-osc-ok")).toBe("running");
    expect(await waitSystemReady("ci-osc-deg")).toBe("degraded");
    await expect(waitSystemReady("ci-osc-bad")).rejects.toThrow("maintenance");
  });
});
