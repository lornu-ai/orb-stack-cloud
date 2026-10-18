import type { GateOutcome } from "../lib/gates";

export interface Target {
  label: string;
  host: string;
  port: number;
  /** How to prove an application answered; a bare TCP handshake can come from OrbStack's NAT proxy. */
  kind: "http" | "https" | "postgres";
}

/**
 * An isolation probe only means something when a normal machine *can* reach the
 * target. Control reachable + attacker blocked = pass; attacker reachable = fail;
 * control blocked = skip, because the target itself is down.
 */
export function evaluateReachability(target: Target, controlReached: boolean, attackerReached: boolean): GateOutcome {
  const where = `${target.label} (${target.host}:${target.port})`;
  if (attackerReached) return { status: "fail", detail: `isolated machine connected to ${where}` };
  if (!controlReached) return { status: "skip", detail: `control machine could not reach ${where} either, so the probe proves nothing` };
  return { status: "pass", detail: `${where}: control connects, isolated machine is blocked` };
}

export function evaluatePath(path: string, controlSees: boolean, attackerSees: boolean): GateOutcome {
  if (attackerSees) return { status: "fail", detail: `${path} is visible inside the isolated machine` };
  if (!controlSees) return { status: "skip", detail: `${path} is not visible in the control machine either, so the probe proves nothing` };
  return { status: "pass", detail: `${path}: shared with the control machine, absent in the isolated machine` };
}

export function evaluateAgentSocket(attackerValue: string): GateOutcome {
  return attackerValue.trim()
    ? { status: "fail", detail: `SSH_AUTH_SOCK is set inside the isolated machine (${attackerValue.trim()})` }
    : { status: "pass", detail: "SSH_AUTH_SOCK is unset inside the isolated machine" };
}

/** `tmutil isexcluded PATH` prints "[Excluded]    PATH" or "[Included]    PATH". */
export function evaluateTmutil(output: string): GateOutcome {
  if (/\[Excluded\]/.test(output)) return { status: "pass", detail: "OrbStack data is excluded from Time Machine" };
  if (/\[Included\]/.test(output)) return { status: "fail", detail: "OrbStack data is included in Time Machine backups" };
  if (/Full Disk Access/i.test(output)) return { status: "skip", detail: "tmutil needs Full Disk Access for the process running the suite" };
  return { status: "error", detail: `unexpected tmutil output: ${output.trim() || "<empty>"}` };
}

/** PostgreSQL SSLRequest (length 8, code 80877103); any server answers with one byte, 'S' or 'N'. */
const PG_SSL_REQUEST = "\\x00\\x00\\x00\\x08\\x04\\xd2\\x16\\x2f";

/**
 * Command whose stdout carries proof an application answered: an HTTP status code
 * (curl prints 000 when nothing did) or the PostgreSQL SSL response byte.
 */
export function probeCommand(t: Target, timeoutSeconds = 4): string[] {
  if (t.kind === "postgres") {
    return ["timeout", String(timeoutSeconds), "bash", "-c", `exec 3<>/dev/tcp/${t.host}/${t.port} && printf '${PG_SSL_REQUEST}' >&3 && head -c1 <&3`];
  }
  return ["curl", "-sk", "-m", String(timeoutSeconds), "-o", "/dev/null", "-w", "%{http_code}", `${t.kind}://${t.host}:${t.port}/`];
}

export function answered(t: Target, stdout: string): boolean {
  const out = stdout.trim();
  return t.kind === "postgres" ? out === "S" || out === "N" : /^[1-5]\d\d$/.test(out);
}

export function firstIpv4(getentOutput: string): string | undefined {
  return getentOutput
    .split("\n")
    .map((l) => l.trim().split(/\s+/)[0] ?? "")
    .find((ip) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip));
}
