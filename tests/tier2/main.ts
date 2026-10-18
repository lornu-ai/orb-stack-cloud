import { appendFileSync, mkdtempSync, rmSync, statfsSync } from "node:fs";
import { cpus, homedir } from "node:os";
import { join } from "node:path";
import { measuredOutcome, round, runGates, skip, type Gate, type GateOutcome } from "../lib/gates";
import { LineReader } from "../lib/lines";
import { ciName, cleanupCiResources, createMachine, deleteMachine, listMachines, machineExec, removeContainer, waitSystemReady } from "../lib/orb";
import { parseIperf3Bps, parsePsRows, parseSysbenchEventsPerSecond, percentile } from "../lib/parse";
import { run, sleep, which } from "../lib/proc";
import { finish } from "../lib/report";
import { balloonReclaim, clockOffset, idleCpu, latencyStats, LIMITS, parseWatchLine, trimReclaim, vmProcess, type RssSample } from "./engine";

const UBUNTU = "ubuntu:noble";
const ALPINE = "alpine:3.21";
const STRESS_NG = "ghcr.io/colinianking/stress-ng@sha256:f4b9d2b0faf78d304799f4d73ea3635a95ab17dc4718a33c52daf6954c0537a0";
const GiB = 1024 ** 3;

async function ps() {
  return parsePsRows((await run(["ps", "-axo", "pid=,time=,rss=,comm="])).stdout);
}

function hostFreeBytes(): number {
  const s = statfsSync(homedir());
  return Number(s.bavail) * Number(s.bsize);
}

async function runningWorkloads(): Promise<string> {
  const machines = (await listMachines()).filter((m) => m.state === "running").length;
  const containers = (await run(["docker", "ps", "-q"], { allowFailure: true })).stdout.split("\n").filter(Boolean).length;
  return `${machines} machines and ${containers} containers running`;
}

const idleCpuGate: Gate = {
  tier: 2,
  name: "idle-cpu",
  async run() {
    const seconds = Number(process.env.ORB_NFR_IDLE_SECONDS ?? 60);
    const workloads = await runningWorkloads();
    const before = await ps();
    const t0 = performance.now();
    await sleep(seconds * 1000);
    const after = await ps();
    const wall = (performance.now() - t0) / 1000;
    const r = idleCpu(before, after, wall, cpus().length);
    return measuredOutcome(
      r.singleCorePercent,
      { op: "<", limit: LIMITS.idleCpuPercent, unit: "% of one core" },
      `OrbStack processes over ${Math.round(wall)}s with ${workloads}`,
      { hostPercent: round(r.hostPercent, 4), cpuSeconds: round(r.cpuSeconds), windowSeconds: Math.round(wall) },
    );
  },
};

interface BootSamples {
  createMs: number[];
  warmBootMs: number[];
  states: string[];
}

let bootSamples: Promise<BootSamples> | undefined;

/** One loop feeds both boot gates: create (issue #5 Story 2.1) and warm boot (issue #6 Tier 2). */
function measureBoots(): Promise<BootSamples> {
  bootSamples ??= (async () => {
    const warm = ciName("boot-warm");
    await createMachine(UBUNTU, warm);
    await deleteMachine(warm);
    const out: BootSamples = { createMs: [], warmBootMs: [], states: [] };
    for (let i = 0; i < LIMITS.bootIterations; i++) {
      const name = ciName(`boot-${i}`);
      const t0 = performance.now();
      await createMachine(UBUNTU, name);
      out.states.push(await waitSystemReady(name));
      out.createMs.push(performance.now() - t0);
      await run(["orb", "stop", name], { timeoutMs: 120_000 });
      const t1 = performance.now();
      await run(["orb", "start", name], { timeoutMs: 120_000 });
      await waitSystemReady(name);
      out.warmBootMs.push(performance.now() - t1);
      await deleteMachine(name);
    }
    return out;
  })();
  return bootSamples;
}

function bootOutcome(samples: number[], what: string, states: string[]): GateOutcome {
  return measuredOutcome(percentile(samples, 95), { op: "<", limit: LIMITS.bootP95Ms, unit: "ms" }, `P95 of ${samples.length} ${what} to systemd ready`, {
    p50Ms: round(percentile(samples, 50), 1),
    maxMs: round(Math.max(...samples), 1),
    samplesMs: samples.map((s) => Math.round(s)).join(","),
    states: [...new Set(states)].join(","),
  });
}

const bootGate: Gate = {
  tier: 2,
  name: "machine-boot",
  async run() {
    const s = await measureBoots();
    return bootOutcome(s.warmBootMs, "warm boots (orb stop → orb start)", s.states);
  },
};

const createGate: Gate = {
  tier: 2,
  name: "machine-create",
  async run() {
    const s = await measureBoots();
    return bootOutcome(s.createMs, "cached-image creates (orb create)", s.states);
  },
};

const balloonGate: Gate = {
  tier: 2,
  name: "memory-balloon",
  async run() {
    const vm = vmProcess(await ps());
    if (!vm) return { status: "error", detail: "OrbStack VM process not found" };
    const rss = async () => (await ps()).find((r) => r.pid === vm.pid)?.rssKiB ?? 0;
    const baseline = await rss();
    const name = ciName("balloon");
    const workload = Bun.spawn(
      ["docker", "run", "--rm", "--name", name, STRESS_NG, "--vm", "1", "--vm-bytes", `${LIMITS.balloonBytes / GiB}G`, "--vm-keep", "--timeout", "6s"],
      { stdout: "ignore", stderr: "pipe" },
    );
    const samples: RssSample[] = [];
    const started = performance.now();
    let exitedAt: number | undefined;
    void workload.exited.then(() => (exitedAt = performance.now()));
    while (exitedAt === undefined || (performance.now() - exitedAt) / 1000 <= LIMITS.balloonSeconds) {
      const now = performance.now();
      samples.push({ t: exitedAt === undefined ? -(now - started) / 1000 : (now - exitedAt) / 1000, rssKiB: await rss() });
      await sleep(250);
    }
    if ((await workload.exited) !== 0) {
      return { status: "error", detail: `stress-ng exited ${workload.exitCode}: ${(await new Response(workload.stderr).text()).trim()}` };
    }
    const r = balloonReclaim(baseline, samples);
    if (r.grewKiB * 1024 < LIMITS.balloonBytes * 0.75) {
      return { status: "error", detail: `VM RSS grew only ${round((r.grewKiB * 1024) / GiB, 2)} GiB for a ${LIMITS.balloonBytes / GiB} GiB workload; measurement is not meaningful` };
    }
    return measuredOutcome(
      r.fraction,
      { op: ">=", limit: LIMITS.balloonFraction, unit: "fraction" },
      `OrbStack Helper RSS returned within ${LIMITS.balloonSeconds}s of a ${LIMITS.balloonBytes / GiB} GiB workload exiting`,
      { grewGiB: round((r.grewKiB * 1024) / GiB, 2), secondsTo90: r.secondsTo90 === undefined ? "never" : round(r.secondsTo90, 2) },
    );
  },
};

const trimGate: Gate = {
  tier: 2,
  name: "apfs-trim",
  async run() {
    const name = ciName("trim");
    await createMachine(UBUNTU, name);
    await waitSystemReady(name);
    const file = "/var/tmp/osc-trim.bin";
    await machineExec(name, ["fstrim", "-av"], { root: true, timeoutMs: 60_000 });
    await sleep(2000);
    const before = hostFreeBytes();
    const mib = LIMITS.trimWriteBytes / 1024 ** 2;
    await machineExec(name, ["dd", "if=/dev/urandom", `of=${file}`, "bs=1M", `count=${mib}`, "conv=fsync", "status=none"], { root: true, timeoutMs: 300_000 });
    await sleep(2000);
    const afterWrite = hostFreeBytes();
    await machineExec(name, ["rm", "-f", file], { root: true });
    const t0 = performance.now();
    await machineExec(name, ["fstrim", "-av"], { root: true, timeoutMs: 60_000 });
    let afterTrim = hostFreeBytes();
    while ((performance.now() - t0) / 1000 < LIMITS.trimSeconds && afterTrim - afterWrite < LIMITS.trimReclaimBytes) {
      await sleep(250);
      afterTrim = hostFreeBytes();
    }
    const r = trimReclaim(before, afterWrite, afterTrim);
    // Diagnostics only: keep watching so a failure says "slow" or "never".
    let late = afterTrim;
    let lateSeconds = (performance.now() - t0) / 1000;
    while (lateSeconds < 60 && late - afterWrite < LIMITS.trimReclaimBytes) {
      await sleep(1000);
      late = hostFreeBytes();
      lateSeconds = (performance.now() - t0) / 1000;
    }
    if (r.consumedBytes < LIMITS.trimWriteBytes * 0.5) {
      return {
        status: "error",
        detail: `host free space dropped only ${round(r.consumedBytes / 1e9, 2)} GB for a ${round(LIMITS.trimWriteBytes / 1e9, 2)} GB guest write; the sparse image did not grow, so reclamation cannot be measured`,
      };
    }
    return measuredOutcome(
      r.reclaimedBytes / 1e9,
      { op: ">=", limit: LIMITS.trimReclaimBytes / 1e9, unit: "GB" },
      `host APFS free space regained within ${LIMITS.trimSeconds}s of fstrim`,
      {
        consumedGB: round(r.consumedBytes / 1e9, 2),
        fraction: round(r.fraction),
        reclaimedBy60sGB: round((late - afterWrite) / 1e9, 2),
        diagnosticSeconds: round(lateSeconds, 1),
      },
    );
  },
};

const epochMs = () => performance.timeOrigin + performance.now();

/** Each event is stamped inside the guest, so the docker output stream adds no latency. */
const WATCHER =
  'apk add -q --no-cache inotify-tools coreutils >/dev/null && echo READY && inotifywait -m -q -e modify --format %f /w | while read f; do echo "$(date +%s%N) $f"; done';

const inotifyGate: Gate = {
  tier: 2,
  name: "virtiofs-inotify",
  async run() {
    const dir = mkdtempSync(join(homedir(), ".osc-inotify-"));
    const name = ciName("inotify");
    const watcher = Bun.spawn(["docker", "run", "--rm", "--name", name, "-v", `${dir}:/w`, ALPINE, "sh", "-c", WATCHER], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const lines = new LineReader(watcher.stdout);
    try {
      let line: string | undefined;
      do line = await lines.next(120_000);
      while (line !== undefined && line !== "READY");
      if (line === undefined) return { status: "error", detail: "watcher container never became ready" };
      await sleep(500);

      const clock = [];
      for (let i = 0; i < 15; i++) {
        const hostBeforeMs = epochMs();
        const out = await run(["docker", "exec", name, "date", "+%s%N"]);
        clock.push({ hostBeforeMs, hostAfterMs: epochMs(), guestMs: Number(out.stdout.trim()) / 1e6 });
      }
      const { offsetMs, uncertaintyMs } = clockOffset(clock);

      const probe = join(dir, "probe.txt");
      appendFileSync(probe, "w");
      if ((await lines.next(2000)) === undefined) return { status: "error", detail: "watcher reported no event for the warm-up write" };
      lines.drain();

      const samples: number[] = [];
      for (let i = 0; i < LIMITS.inotifyWrites; i++) {
        const t0 = epochMs();
        appendFileSync(probe, "x");
        let event;
        do event = parseWatchLine((await lines.next(1000)) ?? "");
        while (event && event.file !== "probe.txt");
        if (!event) return { status: "fail", detail: `write ${i + 1} produced no inotify event within 1s` };
        samples.push(event.guestMs - offsetMs - t0);
        await sleep(30);
        lines.drain();
      }
      const s = latencyStats(samples);
      return measuredOutcome(s.p95, { op: "<", limit: LIMITS.inotifyP95Ms, unit: "ms" }, `P95 of ${s.n} macOS writes to in-guest inotify timestamps (±${round(uncertaintyMs, 1)}ms clock error)`, {
        p50Ms: round(s.p50, 2),
        maxMs: round(s.max, 2),
        clockOffsetMs: round(offsetMs, 2),
        clockUncertaintyMs: round(uncertaintyMs, 2),
      });
    } finally {
      watcher.kill();
      await removeContainer(name);
      rmSync(dir, { recursive: true, force: true });
    }
  },
};

const netGate: Gate = {
  tier: 2,
  name: "virtio-net",
  async run() {
    const iperf3 = await which("iperf3");
    if (!iperf3) return skip("iperf3 is not installed on the macOS host (brew install iperf3)");
    const name = ciName("net");
    await createMachine(UBUNTU, name);
    await waitSystemReady(name);
    await machineExec(name, ["sh", "-c", "DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq iperf3"], {
      root: true,
      timeoutMs: 300_000,
    });
    await machineExec(name, ["iperf3", "-s", "-D"], { root: true });
    await sleep(1000);
    const res = await run([iperf3, "-c", `${name}.orb.local`, "-t", "5", "-J"], { allowFailure: true, timeoutMs: 60_000 });
    const gbps = parseIperf3Bps(res.stdout) / 1e9;
    return measuredOutcome(gbps, { op: ">=", limit: LIMITS.netGbps, unit: "Gbps" }, `single-stream macOS → ${name}.orb.local, 5s`);
  },
};

async function amd64EventsPerSecond(): Promise<number> {
  const res = await run(
    ["docker", "run", "--rm", "--platform", "linux/amd64", ALPINE, "sh", "-c", "apk add --no-cache sysbench >/dev/null && sysbench cpu --cpu-max-prime=20000 --time=10 run"],
    { timeoutMs: 600_000 },
  );
  return parseSysbenchEventsPerSecond(res.stdout);
}

async function setRosetta(enabled: boolean): Promise<boolean> {
  const res = await run(["orb", "config", "set", "rosetta", String(enabled)], { allowFailure: true });
  const needsRestart = /restart/i.test(res.stdout + res.stderr);
  if (needsRestart) {
    await run(["orb", "restart"], { timeoutMs: 300_000 });
    await run(["docker", "info"], { timeoutMs: 120_000 });
  }
  return needsRestart;
}

const rosettaGate: Gate = {
  tier: 2,
  name: "rosetta-vs-qemu",
  async run(): Promise<GateOutcome> {
    if (process.env.ORB_NFR_ALLOW_ENGINE_RESTART !== "1") {
      return skip(
        "toggling Rosetta may restart the OrbStack engine, stopping every container, machine, and the Kubernetes cluster; set ORB_NFR_ALLOW_ENGINE_RESTART=1 on a dedicated runner",
      );
    }
    const original = (await run(["orb", "config", "get", "rosetta"])).stdout.trim() === "true";
    try {
      if (!original) await setRosetta(true);
      const rosetta = await amd64EventsPerSecond();
      const restarted = await setRosetta(false);
      const qemu = await amd64EventsPerSecond();
      return measuredOutcome(rosetta / qemu, { op: ">=", limit: LIMITS.rosettaSpeedup, unit: "x" }, "sysbench cpu events/s, Rosetta over QEMU", {
        rosettaEps: round(rosetta, 1),
        qemuEps: round(qemu, 1),
        toggleRestartedEngine: restarted,
      });
    } finally {
      await setRosetta(original);
    }
  },
};

const only = process.env.ORB_NFR_GATES?.split(",").map((s) => s.trim());
const gates = [idleCpuGate, bootGate, createGate, balloonGate, trimGate, inotifyGate, netGate, rosettaGate].filter((g) => !only || only.includes(g.name));
try {
  finish("tier2-engine", await runGates(gates), { nfrSummary: true });
} finally {
  await cleanupCiResources();
}
