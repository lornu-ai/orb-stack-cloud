import { describe, expect, test } from "bun:test";
import { edgeHostProblem, HUB_HOST, prTunnelHost, TUNNEL_HOST } from "./hosts";

describe("edgeHostProblem", () => {
  test("accepts the apex and one label below it", () => {
    expect(edgeHostProblem("stevedores.org", "stevedores.org")).toBeUndefined();
    expect(edgeHostProblem("stevedores.org", HUB_HOST)).toBeUndefined();
    expect(edgeHostProblem("stevedores.org", TUNNEL_HOST)).toBeUndefined();
  });

  test("rejects names Universal SSL does not cover", () => {
    expect(edgeHostProblem("stevedores.org", "pr-42.ci.osc.stevedores.org")).toContain("3 labels below");
  });

  test("rejects hosts outside the zone, uppercase, and invalid labels", () => {
    expect(edgeHostProblem("stevedores.org", "osc.example.com")).toContain("not inside zone");
    expect(edgeHostProblem("stevedores.org", "OSC.stevedores.org")).toContain("lowercase");
    expect(edgeHostProblem("stevedores.org", "-bad.stevedores.org")).toContain("not a valid DNS name");
  });
});

describe("prTunnelHost", () => {
  test("is one label below the zone", () => {
    expect(prTunnelHost("1234567890")).toBe("osc-pr-1234567890.stevedores.org");
  });

  test("sanitizes characters that are not valid in a DNS label", () => {
    expect(prTunnelHost("Local_17")).toBe("osc-pr-local-17.stevedores.org");
  });
});
