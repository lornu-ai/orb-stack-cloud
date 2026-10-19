# WebMCP + ChromeOS agents (Gap / OSC)

Browser-native agent project for the Gap app stack. Full architecture: [docs/WEBMCP-CHROMEOS-AGENTS.md](../../docs/WEBMCP-CHROMEOS-AGENTS.md).

Linear: [LOR-594](https://linear.app/lornu-ai/issue/LOR-594).

## What lives here

| Path | Purpose |
|------|---------|
| `README.md` | This index |
| `crostini/` | ChromeOS Linux (Crostini) bridge patterns for `chrome-devtools-mcp` |
| `mcp/` | Example MCP client snippets (Gemini CLI / oxidizedMCP skill entry) — no secrets |

Mac OrbStack **gap-hub** stays under [`blueprint/gap/`](../gap/). This blueprint is the **ChromeOS / browser-agent** peer, not a replacement hub Deployment.

## Dual loop (short)

1. **DevTools MCP** — agents inspect/debug Gap web via CDP.
2. **WebMCP** — Gap web exposes `document.modelContext` tools to visiting agents in-session.

## Quick attach (dev laptop or Crostini)

```bash
# Gemini CLI example — Chrome DevTools MCP server
gemini mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest --no-usage-statistics

# Or install the ChromeDevTools extension pack
# gemini extensions install --auto-update https://github.com/ChromeDevTools/chrome-devtools-mcp
```

oxidizedMCP: add a skill endpoint that wraps the same server (see `mcp/oxidized-skill.example.yaml`).

## Gap product hooks

- Implement `registerTool` in `lornu-ai/gap` `web/` behind `"modelContext" in document`.
- Keep mutating tools `requiresConfirmation: true`; route through Gap outbox / Workers MCP.
- Validate with Chrome DevTools → Application → WebMCP panel (Chrome 146+ / OT 149+).

## Fleet

Inventory stub: [fleet/chromeos-agents.yaml](../../fleet/chromeos-agents.yaml).
