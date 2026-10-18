export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  ms: number;
  timedOut: boolean;
}

export interface RunOptions {
  timeoutMs?: number;
  stdin?: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
  /** Return the result instead of throwing on a non-zero exit. */
  allowFailure?: boolean;
}

export class CommandError extends Error {
  constructor(
    readonly cmd: string[],
    readonly result: RunResult,
  ) {
    const tail = (result.stderr || result.stdout).trim().split("\n").slice(-5).join("\n");
    super(
      `${cmd.join(" ")} ${result.timedOut ? "timed out" : `exited ${result.code}`} after ${Math.round(result.ms)}ms${tail ? `\n${tail}` : ""}`,
    );
  }
}

export async function run(cmd: string[], opts: RunOptions = {}): Promise<RunResult> {
  const started = performance.now();
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    stdin: opts.stdin === undefined ? "ignore" : new TextEncoder().encode(opts.stdin),
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timer =
    opts.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          proc.kill("SIGKILL");
        }, opts.timeoutMs);

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (timer) clearTimeout(timer);

  const result: RunResult = { code, stdout, stderr, ms: performance.now() - started, timedOut };
  if ((code !== 0 || timedOut) && !opts.allowFailure) throw new CommandError(cmd, result);
  return result;
}

export async function which(bin: string): Promise<string | undefined> {
  const path = Bun.which(bin);
  return path ?? undefined;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
