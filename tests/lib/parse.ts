export interface VmStat {
  pageSize: number;
  pages: Record<string, number>;
}

/** Parse macOS `vm_stat` output. Page counts are keyed by their label, e.g. "Pages free". */
export function parseVmStat(text: string): VmStat {
  const header = text.match(/page size of (\d+) bytes/);
  if (!header?.[1]) throw new Error("vm_stat: page size header not found");
  const pages: Record<string, number> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^"?([^":]+)"?:\s+(\d+)\.?\s*$/);
    if (m?.[1] && m[2]) pages[m[1].trim()] = Number(m[2]);
  }
  return { pageSize: Number(header[1]), pages };
}

export function vmStatFreeBytes(v: VmStat): number {
  return ((v.pages["Pages free"] ?? 0) + (v.pages["Pages speculative"] ?? 0)) * v.pageSize;
}

/** `iperf3 -J` client report → received throughput in bits/second. */
export function parseIperf3Bps(json: string): number {
  const doc = JSON.parse(json) as {
    error?: string;
    end?: { sum_received?: { bits_per_second?: number } };
  };
  if (doc.error) throw new Error(`iperf3: ${doc.error}`);
  const bps = doc.end?.sum_received?.bits_per_second;
  if (typeof bps !== "number") throw new Error("iperf3: end.sum_received.bits_per_second missing");
  return bps;
}

/** `sysbench cpu run` → events per second. */
export function parseSysbenchEventsPerSecond(text: string): number {
  const m = text.match(/events per second:\s+([\d.]+)/);
  if (!m?.[1]) throw new Error("sysbench: 'events per second' not found");
  return Number(m[1]);
}

/** `ps -o time` values: "MM:SS.cc", "HH:MM:SS", or "D-HH:MM:SS" → seconds. */
export function parsePsTime(value: string): number {
  const v = value.trim();
  const [days, rest] = v.includes("-") ? (v.split("-") as [string, string]) : ["0", v];
  const parts = rest.split(":").map(Number);
  if (parts.some((p) => Number.isNaN(p))) throw new Error(`ps time: cannot parse '${value}'`);
  let seconds = 0;
  for (const p of parts) seconds = seconds * 60 + p;
  return Number(days) * 86400 + seconds;
}

export interface PsRow {
  pid: number;
  cpuSeconds: number;
  rssKiB: number;
  command: string;
}

/** Parse `ps -axo pid=,time=,rss=,comm=` output. */
export function parsePsRows(text: string): PsRow[] {
  const rows: PsRow[] = [];
  for (const line of text.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\S+)\s+(\d+)\s+(.+)$/);
    if (!m?.[1] || !m[2] || !m[3] || !m[4]) continue;
    rows.push({ pid: Number(m[1]), cpuSeconds: parsePsTime(m[2]), rssKiB: Number(m[3]), command: m[4] });
  }
  return rows;
}

const ORBSTACK_PROCESS = /OrbStack|com\.apple\.Virtualization\.VirtualMachine|\/vmgr$/;

export function isOrbStackProcess(command: string): boolean {
  return ORBSTACK_PROCESS.test(command);
}

export function percentile(samples: number[], p: number): number {
  if (samples.length === 0) throw new Error("percentile of empty sample set");
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const loV = sorted[lo] as number;
  const hiV = sorted[hi] as number;
  return loV + (hiV - loV) * (rank - lo);
}
