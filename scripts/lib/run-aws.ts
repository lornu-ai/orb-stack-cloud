import { spawnSync } from "node:child_process";

export const AWS_PROFILE = process.env.AWS_PROFILE?.trim() || "lornu-ai";
export const AWS_REGION = process.env.AWS_DEFAULT_REGION?.trim() || "us-east-1";

/** LocalStack or custom endpoint (AWS CLI v2 `--endpoint-url`). */
export function awsEndpoint(): string | undefined {
  return process.env.AWS_ENDPOINT_URL?.trim() || process.env.LOCALSTACK_ENDPOINT?.trim() || undefined;
}

export type AwsResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
};

export function runAws(args: string[], input?: { env?: Record<string, string> }): AwsResult {
  const base = ["--profile", AWS_PROFILE, "--region", AWS_REGION];
  const endpoint = awsEndpoint();
  if (endpoint) base.push("--endpoint-url", endpoint);
  const proc = spawnSync("aws", [...base, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...input?.env },
  });
  return {
    ok: proc.status === 0,
    stdout: (proc.stdout ?? "").trim(),
    stderr: (proc.stderr ?? "").trim(),
    status: proc.status,
  };
}

export function requireAws(args: string[]): string {
  const r = runAws(args);
  if (!r.ok) {
    throw new Error(`aws ${args.join(" ")} failed (${r.status}): ${r.stderr || r.stdout}`);
  }
  return r.stdout;
}
