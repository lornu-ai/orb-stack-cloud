import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Test double for external CLIs: each fake is a Bun script that appends its argv to a
 * shared log and replies from a table of (argv prefix → stdout, exit code).
 */
export interface Reply {
  match: string[];
  stdout?: string;
  code?: number;
}

export class FakeBins {
  readonly dir = mkdtempSync(join(tmpdir(), "orb-fakebin-"));
  readonly log = join(this.dir, "calls.log");
  private readonly savedPath = process.env.PATH;

  constructor() {
    writeFileSync(this.log, "");
  }

  add(name: string, replies: Reply[]): this {
    const bin = join(this.dir, name);
    writeFileSync(
      bin,
      `#!/usr/bin/env bun
const args = process.argv.slice(2);
require("node:fs").appendFileSync(${JSON.stringify(this.log)}, JSON.stringify([${JSON.stringify(name)}, ...args]) + "\\n");
const replies = ${JSON.stringify(replies)};
const r = replies.find((x) => x.match.every((m, i) => args[i] === m));
if (r?.stdout) process.stdout.write(r.stdout);
process.exit(r ? (r.code ?? 0) : 0);
`,
    );
    chmodSync(bin, 0o755);
    return this;
  }

  /** Put the fakes first on PATH (Bun.which and Bun.spawn both read process.env.PATH). */
  activate(): this {
    process.env.PATH = `${this.dir}:${this.savedPath}`;
    return this;
  }

  restore(): void {
    process.env.PATH = this.savedPath;
  }

  calls(): string[][] {
    return readFileSync(this.log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as string[]);
  }
}
