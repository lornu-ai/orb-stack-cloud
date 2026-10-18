# WebMCP + Chrome DevTools MCP (ChromeOS agents)

**Project:** browser-native AI agents for Gap, hosted on ChromeOS (Crostini) and wired into the Gap / OrbStack Cloud (OSC) mix.

**Wrapped by:** the locked iPaaS Host path — oxidizedgraph Execution Plane + axum Control Plane + warm Bun UDS pool ([OXIDIZEDGRAPH-IPAAS-HOST.md](OXIDIZEDGRAPH-IPAAS-HOST.md)). WebMCP is the in-tab / QA surface; it does **not** own graph execution or the Bun host process.

| Piece | Role |
|-------|------|
| **WebMCP** (`document.modelContext`) | In-tab tools: Gap web declares typed, deterministic capabilities (same JSON Schema shape as server MCP) |
| **chrome-devtools-mcp** | Dev/QA agents drive Chrome via CDP (console, network, performance, agentic Lighthouse) |
| **Gap** (`lornu-ai/gap`) | Product surface that registers WebMCP tools; iOS voice remains primary UX |
| **OSC** (this repo) | Personal-cloud / fleet home; ChromeOS is a peer host class next to Mac OrbStack |
| **oxidizedgraph + axum Host** | Workflow Execution / Control planes ([OXIDIZEDGRAPH-IPAAS-HOST.md](OXIDIZEDGRAPH-IPAAS-HOST.md)) |
| **oxidizedMCP** | Sovereign skill mesh that can attach `chrome-devtools-mcp` as one skill endpoint |

Upstream: [ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp), W3C ML for the Web CG **WebMCP** draft (Chrome 146–149+ lifecycle).

## Why it belongs in the Gap / OSC mix

- Gap’s public edge already speaks **org MCP** at `gap.airesearches.app/mcp` (Workers). WebMCP is the **in-page** twin: agents act with the user’s cookies/session inside the tab, without a second token store.
- OSC already hosts **gap-hub** on Apple Silicon OrbStack. ChromeOS (Chromebook Plus + Crostini) is the natural **browser-agent / QA** host: Linux toolchain in penguin, Chrome on host or in-container.
- Interactive voice (iOS) and browser agents share the same Lead Agent / workforce model; WebMCP is how the **web** client becomes agent-callable without brittle DOM scraping.

## Dual-MCP loop

```
┌────────────────────────────── Development / QA loop ──────────────────────────────┐
│  Coding agent (Cursor / Gemini CLI / Gap Lead Agent)                              │
│         │                                                                          │
│         ▼                                                                          │
│  oxidizedMCP ──► chrome-devtools-mcp ──► CDP / Puppeteer ──► Chrome (host or CT) │
│         │              inspect · network · traces · WebMCP panel dry-run           │
└─────────┼──────────────────────────────────────────────────────────────────────────┘
          │
          │  verify / propose fixes
          ▼
┌────────────────────────────── In-page execution loop ─────────────────────────────┐
│  Gap web (HTTPS, Access session)                                                   │
│         document.modelContext.registerTool(...)   OR   declarative HTML tools      │
│         │                                                                          │
│         ▼                                                                          │
│  Visiting user-agent / Lead Agent invokes typed tools (confirm if required)        │
│         │                                                                          │
│         ▼                                                                          │
│  Frontend store / outbox ──► gap-hub WSS (after LOR-545) / Workers MCP (LOR-578)  │
└────────────────────────────────────────────────────────────────────────────────────┘
```

1. **Build & verify** with `chrome-devtools-mcp` (CDP): schemas, console errors, WS frames, perf.
2. **Execute product actions** with **WebMCP** tools registered by Gap web (deterministic, session-scoped).
3. **Orchestrate** both through Gap agent workforce + optional oxidizedMCP skill routing.

## WebMCP (in Gap web)

### Imperative (`document.modelContext`)

Gap web registers tools as route/state changes (same schema shape as backend MCP). Prefer calling the local store / outbox — not simulated clicks.

```ts
if ("modelContext" in document) {
  await document.modelContext.registerTool({
    name: "listOpenDelegations",
    title: "List open delegations",
    description: "Return the Lead Agent's open delegated tasks from local Gap state.",
    readOnly: true,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      return window.gapStore.tasks.open();
    },
  });
}
```

Mutating tools (delegate, status change) set `requiresConfirmation: true` and go through the same outbox path as typed UI.

### Declarative HTML

Annotate forms/actions so the browser synthesizes schemas from `<form>` / `<input>` constraints for simple Gap flows (filters, create-task) without custom glue.

### DevTools WebMCP panel

Chrome 146+ (`#enable-webmcp`) / 149+ Origin Trial: Application → WebMCP panel for live registry, schema validation, dry-run payloads. Use this in the QA loop before exposing tools to visiting agents.

## chrome-devtools-mcp (dev agents)

Three layers:

1. **MCP server** — bridges MCP clients to a live Chrome via CDP/Puppeteer.
2. **DevTools CLI** — single-shot shell for scripts.
3. **Agentic skills** — multi-step workflows (layout shift, memory, a11y, network waterfalls, proposed agentic Lighthouse).

Attach via oxidizedMCP registry (skill name e.g. `chrome-devtools`) or directly in Gemini CLI / Cursor MCP config. Scope: **Gap / OSC properties we own** — not third-party sites.

## ChromeOS (Crostini) bridge

ChromeOS runs host Chrome; toolchain lives in Crostini (`penguin`). Two patterns (detail: [blueprint/webmcp-chromeos](../blueprint/webmcp-chromeos/README.md)):

| Pattern | When | Idea |
|---------|------|------|
| **1. Linux-side Chrome for Testing** | Isolated CI / lab | Install Chrome for Testing in Crostini; Sommelier shows the window; CDP stays in the Linux namespace |
| **2. Host Chrome bridge** | 8GB Chromebook / Nano | Point `chrome-devtools-mcp` at host Chrome remote debugging / port-forward (`--browser-url`); reuse host hardware acceleration / `window.ai` without a second Chromium |

Fleet stub: [fleet/chromeos-agents.yaml](../fleet/chromeos-agents.yaml).

## Security & product gates

- WebMCP inherits the **user’s Access session** — treat tool surface as authenticated UI; confirmation for writes.
- Public Gap `/ws` still blocked until [LOR-545](https://linear.app/lornu-ai/issue/LOR-545); WebMCP must not become a bypass.
- Org MCP at `/mcp` (LOR-578) remains the **server** edge; WebMCP is **in-tab** only.
- CDP / DevTools MCP is for **developer and owned-property QA**, not unattended scraping of arbitrary origins.
- Do not commit ChromeOS debugging ports, tokens, or Crostini keys.

## Repo split

| Concern | Home |
|---------|------|
| OSC docs + ChromeOS fleet / Crostini notes | `stevedores-org/orb-stack-cloud` → this doc + `blueprint/webmcp-chromeos/` |
| Gap web `registerTool` + declarative annotations | `lornu-ai/gap` `web/` |
| Org MCP Workers | `lornu-ai/gap` `edge/` (existing) |
| Skill mesh attaching chrome-devtools-mcp | `stevedores-org/oxidizedMCP` |
| oxidizedgraph Execution + axum Host + Bun UDS | `blueprint/ipaas-host/` + [OXIDIZEDGRAPH-IPAAS-HOST.md](OXIDIZEDGRAPH-IPAAS-HOST.md) |
| Mac gap-hub | `blueprint/gap/` (unchanged) |

## Acceptance (project bootstrap)

- [ ] This doc + `blueprint/webmcp-chromeos/` land on OSC
- [ ] Linear epic tracks Gap WebMCP tools + ChromeOS QA host
- [ ] GROW / OSC README point at the project
- [ ] Gap web registers ≥1 read-only WebMCP tool behind feature detect
- [ ] One ChromeOS (or Linux Chrome for Testing) smoke: chrome-devtools-mcp lists tools; WebMCP panel sees Gap tools
- [ ] oxidizedMCP registry entry documented (optional attach)

## Related

- [OXIDIZEDGRAPH-IPAAS-HOST.md](OXIDIZEDGRAPH-IPAAS-HOST.md) — wraps this project in the locked Execution/Control/Bun planes
- [GAP-DEPLOYMENT-STRATEGY.md](GAP-DEPLOYMENT-STRATEGY.md)
- [GAP-ON-ORBSTACK.md](GAP-ON-ORBSTACK.md)
- Linear: [LOR-594](https://linear.app/lornu-ai/issue/LOR-594)
