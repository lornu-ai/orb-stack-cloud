# ChromeOS Crostini bridge for chrome-devtools-mcp

ChromeOS keeps the primary Chrome browser on the **host**. Rust / Bun / Gemini CLI run in **Crostini** (`penguin`). Pick a pattern based on RAM and isolation.

## Pattern 1 — Linux-side Chrome for Testing (isolated)

Best for repeatable Gap QA without touching the user’s daily browser profile.

1. Inside Crostini, install [Chrome for Testing](https://developer.chrome.com/blog/chrome-for-testing) (or Chromium) matching the WebMCP / DevTools version you target (146–149+).
2. Sommelier forwards the Wayland window onto the ChromeOS desktop.
3. Point `chrome-devtools-mcp` at that local browser (default CDP endpoint stays inside the Linux namespace).

```bash
# Inside Crostini — attach MCP server to the agent CLI
gemini mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest --no-usage-statistics
```

Use this pattern for automated checks against `https://gap.airesearches.app` (Access session supplied by the test profile) and local Vite (`http://127.0.0.1:5173`).

## Pattern 2 — Host Chrome bridge (low RAM)

On 8GB Chromebooks, avoid a second Chromium in Linux.

1. Enable remote debugging on **host** Chrome (ChromeOS settings / launch flags as documented for your build).
2. Forward the debugging port across the Crostini virtual switch (commonly via the `100.115.92.x` path) or use the vendor-supported `--browser-url` / connect URL that `chrome-devtools-mcp` accepts.
3. Run the MCP server **in Crostini**, aimed at the host browser URL — one set of Gemini Nano / `window.ai` weights, no duplicate renderer.

Document the concrete connect URL **privately** per device; do not commit host debugging endpoints or tokens to this repo.

## Gap-specific smoke

1. Open Gap web (Access) in the chosen Chrome.
2. Confirm WebMCP tools appear in DevTools → Application → WebMCP (flag / OT as required).
3. From the agent CLI, list chrome-devtools-mcp tools; run a read-only inspect (console / network) against the Gap tab.
4. Dry-run one Gap WebMCP tool from the panel before allowing agent invocation.

## Out of scope here

- Unattended automation of third-party origins
- Committing CDP ports, cookies, or Access tokens
- Replacing iOS interactive voice as Gap’s primary UX
