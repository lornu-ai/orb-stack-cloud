/**
 * Warm Bun worker — Option 1 UDS pool (locked).
 * Protocol: 4-byte BE length + JSON.
 * Zod v4: z.toJSONSchema for XYFlow catalog export.
 *
 * eval_code is disabled unless ALLOW_EVAL_CODE=1 (prefer Option 2 Bun.spawn for untrusted JS).
 */
import { unlinkSync } from "node:fs";
import * as z from "zod";

const SOCKET_PATH = process.env.RUNNER_SOCKET || "/tmp/oxidized_bun_0.sock";
try {
  unlinkSync(SOCKET_PATH);
} catch {
  /* missing is fine */
}

export interface ConnectorDef<T extends z.ZodTypeAny = z.ZodTypeAny> {
  id: string;
  displayName: string;
  inputSchema: T;
  execute: (ctx: {
    input: z.infer<T>;
    credentials: Record<string, unknown>;
  }) => Promise<unknown>;
}

const registry = new Map<string, ConnectorDef>();

registry.set("slack.postMessage", {
  id: "slack.postMessage",
  displayName: "Slack: Post Message",
  inputSchema: z.object({
    channel: z.string().meta({ description: "Channel ID or #name" }),
    text: z.string().meta({ description: "Markdown message body" }),
  }),
  async execute({ input, credentials }) {
    const token = credentials.accessToken;
    if (typeof token !== "string" || !token) {
      throw new Error("missing credentials.accessToken");
    }
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
    return await res.json();
  },
});

function writeFrame(socket: { write: (b: Buffer) => void }, obj: unknown) {
  const bytes = Buffer.from(JSON.stringify(obj), "utf-8");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(bytes.length, 0);
  socket.write(Buffer.concat([header, bytes]));
}

// Scaffold: assumes one full frame per data event. Phase 2 adds a proper buffer assembler.
Bun.listen({
  unix: SOCKET_PATH,
  socket: {
    async data(socket, rawBuffer) {
      const buf = Buffer.from(rawBuffer);
      if (buf.length < 4) return;
      const frameLen = buf.readUInt32BE(0);
      if (buf.length < 4 + frameLen) return;
      const req = JSON.parse(buf.subarray(4, 4 + frameLen).toString("utf-8"));

      try {
        if (req.action === "export_schemas") {
          const schemas = Array.from(registry.values()).map((node) => ({
            id: node.id,
            displayName: node.displayName,
            jsonSchema: z.toJSONSchema(node.inputSchema, { io: "input" }),
          }));
          return writeFrame(socket, { ok: true, data: schemas });
        }

        if (req.action === "execute_connector") {
          const connector = registry.get(req.target);
          if (!connector) throw new Error(`Unknown connector: ${req.target}`);
          const parsedInput = connector.inputSchema.parse(req.input);
          const output = await connector.execute({
            input: parsedInput,
            credentials: req.credentials ?? {},
          });
          return writeFrame(socket, { ok: true, data: output });
        }

        if (req.action === "eval_code") {
          if (process.env.ALLOW_EVAL_CODE !== "1") {
            throw new Error(
              "eval_code disabled on warm pool; use Option 2 Bun.spawn for untrusted Code nodes",
            );
          }
          const AsyncFunction = Object.getPrototypeOf(async function () {})
            .constructor as new (
            ...args: string[]
          ) => (...args: unknown[]) => Promise<unknown>;
          const fn = new AsyncFunction("$input", "$credentials", "Bun", req.target);
          const output = await fn(req.input, req.credentials, Bun);
          return writeFrame(socket, { ok: true, data: output });
        }

        throw new Error(`unknown action: ${req.action}`);
      } catch (err: unknown) {
        const e = err as { stack?: string; message?: string };
        writeFrame(socket, { ok: false, error: e.stack || e.message || String(err) });
      }
    },
  },
});

console.error(`[ipaas-bun-sdk] listening on ${SOCKET_PATH}`);
