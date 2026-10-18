import { describe, expect, test } from "bun:test";
import { answered, evaluateAgentSocket, evaluatePath, evaluateReachability, evaluateTmutil, firstIpv4, probeCommand } from "./isolation";

const target = { label: "postgres", host: "192.168.138.5", port: 5432, kind: "postgres" as const };

describe("evaluateReachability", () => {
  test("pass only when the control connects and the attacker does not", () => {
    expect(evaluateReachability(target, true, false).status).toBe("pass");
  });

  test("any attacker connection fails, even if the control could not connect", () => {
    expect(evaluateReachability(target, true, true).status).toBe("fail");
    expect(evaluateReachability(target, false, true).status).toBe("fail");
  });

  test("an unreachable target is a skip, not a pass", () => {
    expect(evaluateReachability(target, false, false).status).toBe("skip");
  });
});

describe("evaluatePath", () => {
  test("pass, fail, and skip", () => {
    expect(evaluatePath("/Users", true, false).status).toBe("pass");
    expect(evaluatePath("/Users", true, true).status).toBe("fail");
    expect(evaluatePath("/mnt/mac", false, false).status).toBe("skip");
  });
});

describe("evaluateAgentSocket", () => {
  test("any value fails", () => {
    expect(evaluateAgentSocket("/opt/orbstack-guest/run/host-ssh-agent.sock\n").status).toBe("fail");
    expect(evaluateAgentSocket("\n").status).toBe("pass");
  });
});

describe("evaluateTmutil", () => {
  test("parses excluded, included, missing permission, and unexpected output", () => {
    expect(evaluateTmutil("[Excluded]    /Users/me/Library/Group Containers/x.dev.orbstack").status).toBe("pass");
    expect(evaluateTmutil("[Included]    /path").status).toBe("fail");
    expect(evaluateTmutil("tmutil: isexcluded requires Full Disk Access privileges.").status).toBe("skip");
    expect(evaluateTmutil("").status).toBe("error");
  });
});

describe("application-level probes", () => {
  test("HTTP targets use curl and count any real status code as answered", () => {
    const http = { label: "api", host: "10.0.0.1", port: 443, kind: "https" as const };
    expect(probeCommand(http, 2)).toEqual(["curl", "-sk", "-m", "2", "-o", "/dev/null", "-w", "%{http_code}", "https://10.0.0.1:443/"]);
    expect(answered(http, "401")).toBe(true);
    expect(answered(http, "000")).toBe(false);
  });

  test("PostgreSQL answers its SSLRequest with S or N", () => {
    expect(probeCommand(target).join(" ")).toContain("/dev/tcp/192.168.138.5/5432");
    expect(answered(target, "N")).toBe(true);
    expect(answered(target, "")).toBe(false);
  });
});

describe("helpers", () => {

  test("firstIpv4 picks the first IPv4 address from getent output", () => {
    expect(firstIpv4("fd07::1   host.orb.internal\n0.250.250.254   host.orb.internal\n")).toBe("0.250.250.254");
    expect(firstIpv4("fd07::1 x\n")).toBeUndefined();
  });
});
