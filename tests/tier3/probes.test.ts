import { describe, expect, test } from "bun:test";
import { ACCESS_DENIED, edgeProbes, evaluateHttp, hostOf, localMeshProbes, observe, resolves, tcpConnect } from "./probes";

const probe = { label: "p", url: "https://app.k8s.orb.local/api/v1/checkout", expect: [200], maxMs: 50 };

describe("evaluateHttp", () => {
  test("pass within status and latency", () => {
    expect(evaluateHttp(probe, { status: 200, ms: 12 }).status).toBe("pass");
  });

  test("fails on a transport error, an unexpected status, or slowness", () => {
    expect(evaluateHttp(probe, { ms: 1, error: "certificate has expired" }).detail).toContain("certificate");
    expect(evaluateHttp(probe, { status: 502, ms: 1 }).detail).toContain("HTTP 502");
    expect(evaluateHttp(probe, { status: 200, ms: 80 }).status).toBe("fail");
  });

  test("records an Access redirect target", () => {
    const o = evaluateHttp({ label: "x", url: "https://osc.stevedores.org/", expect: ACCESS_DENIED }, { status: 302, ms: 5, location: "https://x.cloudflareaccess.com/" });
    expect(o.detail).toContain("cloudflareaccess.com");
  });
});

describe("probe sets", () => {
  test("local mesh covers all three tiers over .orb.local", () => {
    expect(localMeshProbes().every((p) => hostOf(p.url).endsWith(".orb.local"))).toBe(true);
  });

  test("edge probes always include the anonymous denial check", () => {
    expect(edgeProbes("osc-pr-1.stevedores.org").map((p) => p.label)).toEqual(["edge-anonymous-denied"]);
    const withToken = edgeProbes("osc-pr-1.stevedores.org", { id: "id", secret: "s" });
    expect(withToken[1]?.headers?.["CF-Access-Client-Id"]).toBe("id");
  });
});

describe("network helpers", () => {
  test("observe and tcpConnect against a local server", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    try {
      const o = await observe({ label: "l", url: `http://127.0.0.1:${server.port}/`, expect: [200] });
      expect(o.status).toBe(200);
      expect((await tcpConnect("127.0.0.1", server.port!)).ok).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("observe reports connection errors; tcpConnect reports refusals", async () => {
    expect((await observe({ label: "l", url: "http://127.0.0.1:1/", expect: [200] }, 2000)).error).toBeDefined();
    expect((await tcpConnect("127.0.0.1", 1, 1000)).ok).toBe(false);
  });

  test("resolves", async () => {
    expect(await resolves("localhost")).toBe(true);
    expect(await resolves("no-such-host.invalid")).toBe(false);
  });
});
