import { connect } from "node:net";
import { lookup } from "node:dns/promises";
import type { GateOutcome } from "../lib/gates";

export interface HttpProbe {
  label: string;
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  /** Acceptable status codes. */
  expect: number[];
  /** Optional latency ceiling, e.g. the < 50 ms checkout target in issue #7 T4.1. */
  maxMs?: number;
}

export interface HttpObservation {
  status?: number;
  ms: number;
  error?: string;
  /** Location header, to confirm an Access login redirect. */
  location?: string | null;
}

export function evaluateHttp(probe: HttpProbe, obs: HttpObservation): GateOutcome {
  const where = `${probe.method ?? "GET"} ${probe.url}`;
  if (obs.error) return { status: "fail", detail: `${where}: ${obs.error}` };
  if (obs.status === undefined || !probe.expect.includes(obs.status)) {
    return { status: "fail", detail: `${where}: HTTP ${obs.status} (expected ${probe.expect.join(" or ")})` };
  }
  if (probe.maxMs !== undefined && obs.ms > probe.maxMs) {
    return {
      status: "fail",
      measured: obs.ms,
      threshold: { op: "<", limit: probe.maxMs, unit: "ms" },
      detail: `${where}: HTTP ${obs.status} but took ${Math.round(obs.ms)}ms (limit ${probe.maxMs}ms)`,
    };
  }
  return {
    status: "pass",
    measured: obs.ms,
    detail: `${where}: HTTP ${obs.status} in ${Math.round(obs.ms)}ms${obs.location ? ` → ${obs.location}` : ""}`,
  };
}

/** Strict TLS: callers must not disable verification; local CAs come from `bun --use-system-ca`. */
export async function observe(probe: HttpProbe, timeoutMs = 10_000): Promise<HttpObservation> {
  const t0 = performance.now();
  try {
    const res = await fetch(probe.url, {
      method: probe.method ?? "GET",
      headers: probe.headers,
      body: probe.body,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    await res.arrayBuffer();
    return { status: res.status, ms: performance.now() - t0, location: res.headers.get("location") };
  } catch (err) {
    return { ms: performance.now() - t0, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function resolves(host: string): Promise<boolean> {
  try {
    await lookup(host);
    return true;
  } catch {
    return false;
  }
}

export function tcpConnect(host: string, port: number, timeoutMs = 3000): Promise<{ ok: boolean; ms: number; error?: string }> {
  const t0 = performance.now();
  return new Promise((resolve) => {
    const sock = connect({ host, port });
    const done = (ok: boolean, error?: string) => {
      sock.destroy();
      resolve({ ok, ms: performance.now() - t0, error });
    };
    sock.setTimeout(timeoutMs, () => done(false, "timeout"));
    sock.once("connect", () => done(true));
    sock.once("error", (e) => done(false, e.message));
  });
}

export function hostOf(url: string): string {
  return new URL(url).hostname;
}

/** Path A endpoints on the Mac (issue #7 T4.1). */
export function localMeshProbes(): HttpProbe[] {
  return [
    { label: "tier1-healthz", url: "https://app.k8s.orb.local/healthz", expect: [200] },
    { label: "tier1-checkout", url: "https://app.k8s.orb.local/api/v1/checkout", expect: [200], maxMs: 50 },
    { label: "tier2-billing", url: "https://billing.internal.orb.local/", expect: [200] },
    { label: "tier2-localstack-s3", url: "https://s3.aws.orb.local/_localstack/health", expect: [200] },
    { label: "tier3-vault", url: "http://vault.orb.local:8200/v1/sys/health", expect: [200, 429, 472, 473, 501, 503] },
  ];
}

export const ACCESS_DENIED = [302, 401, 403];

/** Path C: the Access policy must refuse anonymous requests and admit the CI service token. */
export function edgeProbes(host: string, token?: { id: string; secret: string }): HttpProbe[] {
  const url = `https://${host}/api/v1/checkout`;
  const body = JSON.stringify({ item: "orbstack-pro", amount: 99 });
  const probes: HttpProbe[] = [
    { label: "edge-anonymous-denied", url, method: "POST", body, headers: { "content-type": "application/json" }, expect: ACCESS_DENIED },
  ];
  if (token) {
    probes.push({
      label: "edge-service-token",
      url,
      method: "POST",
      body,
      headers: { "content-type": "application/json", "CF-Access-Client-Id": token.id, "CF-Access-Client-Secret": token.secret },
      expect: [200],
    });
  }
  return probes;
}
