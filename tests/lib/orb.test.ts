import { describe, expect, test } from "bun:test";
import { ciName, createArgs, createMachine, deleteMachine, isCiResource, parseMachineList, removeContainer } from "./orb";

describe("suite resource naming", () => {
  test("ciName prefixes and isCiResource recognizes only suite resources", () => {
    expect(ciName("boot")).toBe("ci-osc-boot");
    expect(isCiResource("ci-osc-boot")).toBe(true);
    expect(isCiResource("aivcsd-amd64-build")).toBe(false);
  });

  test("createArgs refuses names outside the suite prefix", () => {
    expect(() => createArgs("ubuntu", "postgres")).toThrow("refusing to create");
  });

  test("delete and remove refuse anything the suite did not create", async () => {
    await expect(deleteMachine("aivcsd-amd64-build")).rejects.toThrow("not a suite machine");
    await expect(removeContainer("postgres")).rejects.toThrow("not a suite container");
    await expect(createMachine("ubuntu", "postgres")).rejects.toThrow("refusing to create");
  });

  test("createArgs maps isolation and sizing flags", () => {
    expect(createArgs("ubuntu:noble", "ci-osc-x", { isolated: true, isolateNetwork: true, memory: "2G", cpus: 2, userData: "/tmp/u.yaml" })).toEqual([
      "orb",
      "create",
      "--isolated",
      "--isolate-network",
      "--user-data",
      "/tmp/u.yaml",
      "--memory",
      "2G",
      "--cpus",
      "2",
      "ubuntu:noble",
      "ci-osc-x",
    ]);
  });
});

describe("parseMachineList", () => {
  test("reads names and isolation config", () => {
    const list = parseMachineList(JSON.stringify([{ name: "ci-osc-a", config: { isolated: true, isolate_network: true } }]));
    expect(list[0]?.config?.isolate_network).toBe(true);
  });

  test("treats empty or null output as no machines", () => {
    expect(parseMachineList("")).toEqual([]);
    expect(parseMachineList("null")).toEqual([]);
  });
});
