export type IngressPath = "orb-local" | "tailscale-mesh" | "cloudflare-zt";

export interface NfrMetric {
  id: string;
  label: string;
  value: string;
  slaTarget: string;
  passed: boolean;
  delta: string;
}

export interface CrossplaneClaim {
  name: string;
  kind: "XOrbMachine" | "XEventBus" | "XCloudflareEdgeIngress";
  arch: "arm64 (Native)" | "amd64 (Rosetta 2)";
  endpoint: string;
  synced: boolean;
  ready: boolean;
}

export interface IsolationCheck {
  vector: string;
  command: string;
  blocked: boolean;
}

export interface TelemetryLine {
  ts: string;
  source: "cloud-init" | "bigquery" | "crossplane" | "gha";
  message: string;
}
