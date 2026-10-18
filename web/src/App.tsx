import { useState } from "react";
import { CrossplaneTopology } from "./components/CrossplaneTopology";
import { NfrGaugeGrid } from "./components/NfrGaugeGrid";
import { SecurityIsolationCard } from "./components/SecurityIsolationCard";
import { TelemetryLogDrawer } from "./components/TelemetryLogDrawer";
import { TopNavHeader } from "./components/TopNavHeader";
import type { CrossplaneClaim, IngressPath, IsolationCheck, NfrMetric, TelemetryLine } from "./types/telemetry";

const INITIAL_METRICS: NfrMetric[] = [
  {
    id: "boot",
    label: "Warm Boot Latency",
    value: "184 ms",
    slaTarget: "< 300ms",
    passed: true,
    delta: "-116ms",
  },
  {
    id: "balloon",
    label: "Virtio-Balloon Reclaim",
    value: "94.2%",
    slaTarget: "> 90% in 10s",
    passed: true,
    delta: "+4.2%",
  },
  {
    id: "trim",
    label: "APFS Sparse TRIM",
    value: "2.88 GB",
    slaTarget: "> 2.5GB / 3GB",
    passed: true,
    delta: "96% reclaimed",
  },
  {
    id: "net",
    label: "Virtio-Net Throughput",
    value: "41.8 Gbps",
    slaTarget: "> 35 Gbps",
    passed: true,
    delta: "+6.8 Gbps",
  },
];

const INITIAL_CLAIMS: CrossplaneClaim[] = [
  {
    name: "osc-api-gateway",
    kind: "XOrbMachine",
    arch: "arm64 (Native)",
    endpoint: "https://api.k8s.orb.local",
    synced: true,
    ready: true,
  },
  {
    name: "billing-worker-rosetta",
    kind: "XOrbMachine",
    arch: "amd64 (Rosetta 2)",
    endpoint: "https://billing.internal.orb.local",
    synced: true,
    ready: true,
  },
  {
    name: "localstack-event-bus",
    kind: "XEventBus",
    arch: "arm64 (Native)",
    endpoint: "https://s3.aws.orb.local",
    synced: true,
    ready: true,
  },
  {
    name: "postgres-16-cloudinit",
    kind: "XOrbMachine",
    arch: "arm64 (Native)",
    endpoint: "postgres.orb.local:5432",
    synced: true,
    ready: true,
  },
  {
    name: "osc-stevedores-ingress",
    kind: "XCloudflareEdgeIngress",
    arch: "arm64 (Native)",
    endpoint: "https://osc.stevedores.org",
    synced: true,
    ready: true,
  },
];

const ISOLATION_CHECKS: IsolationCheck[] = [
  { vector: "Host /Users mount", command: "ls /Users", blocked: true },
  { vector: "SSH agent", command: "test -n $SSH_AUTH_SOCK", blocked: true },
  { vector: "Lateral postgres", command: "nc postgres.orb.local 5432", blocked: true },
];

const TELEMETRY: TelemetryLine[] = [
  { ts: "09:41:02", source: "cloud-init", message: "postgres: cloud-init status done" },
  { ts: "09:41:05", source: "crossplane", message: "LocalCloudStack Ready=True" },
  { ts: "09:41:08", source: "gha", message: "aws --profile lornu-ai sts get-caller-identity ok" },
  { ts: "09:41:12", source: "bigquery", message: "nfr_benchmarks row inserted (run 98421)" },
];

export default function App() {
  const [activePath, setActivePath] = useState<IngressPath>("cloudflare-zt");
  const [logOpen, setLogOpen] = useState(true);

  return (
    <div className="min-h-screen bg-[#09090B] text-zinc-100 flex flex-col">
      <TopNavHeader activePath={activePath} onSelectPath={setActivePath} runId="98421" />
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
        <NfrGaugeGrid metrics={INITIAL_METRICS} />
        <CrossplaneTopology claims={INITIAL_CLAIMS} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SecurityIsolationCard checks={ISOLATION_CHECKS} />
          <TelemetryLogDrawer lines={TELEMETRY} open={logOpen} onToggle={() => setLogOpen((o) => !o)} />
        </div>
      </main>
    </div>
  );
}
