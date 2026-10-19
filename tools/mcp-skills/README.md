# OSC MCP skills (`orbstack::*`, `tailscale::*`)

Host-side MCP skill backends for [stevedores-org/oxidizedMCP](https://github.com/stevedores-org/oxidizedMCP).

**Architecture & security posture:** [docs/OSC-MCP-SKILLS.md](../../docs/OSC-MCP-SKILLS.md).  
**Registry fragments:** [`blueprint/gap/mcp/oxidized-skill.example.yaml`](../../blueprint/gap/mcp/oxidized-skill.example.yaml), [`blueprint/webmcp-chromeos/mcp/oxidized-skill.example.yaml`](../../blueprint/webmcp-chromeos/mcp/oxidized-skill.example.yaml).

Do **not** move OrbStack or Tailscale CLI logic into `oxidized-mcp-core`. `oxidizedMCP` stays a dumb protocol proxy + `skill::tool` router.

## Skills in this workspace

| Crate / Binary | Skill namespace | Default HTTP endpoint | Stdio mode (Podman fallback) | Tools |
|----------------|-----------------|-----------------------|------------------------------|-------|
| `osc-skill-orbstack` (`orbstack/`) | `orbstack::*` | `http://127.0.0.1:9320/mcp` | `osc-skill-orbstack --stdio` | `status`, `k8s_context`, `machines_list`, `gap_healthz`, `apply_overlay` (`mac-a` only, `dry_run: true` default) |
| `osc-skill-tailscale` (`tailscale/`) | `tailscale::*` | `http://127.0.0.1:9321/mcp` | `osc-skill-tailscale --stdio` | `status`, `whoami`, `serve_status`, `acl_lint`, `authkey_present` (boolean only) |

Two separate skills allow ChromeOS / Crostini agents to enable `tailscale` (+ `chrome-devtools`) without needing the macOS `orb` CLI.

## Security posture (non-negotiable)

1. **Default read-only.** `orbstack::apply_overlay` defaults to `dry_run: true` (`--dry-run=server`); setting `dry_run: false` requires `confirm: true` and verifies `kubectl config current-context == orbstack`.
2. **Allowlist commands and overlays.** Only `mac-a` (`blueprint/gap/overlays/mac-a`) in namespace `gap` is permitted. No arbitrary `orb create`, machine delete, or free-form shell.
3. **Never return `TS_AUTHKEY` / OAuth client secrets.** `tailscale::authkey_present` returns `{ "present": true | false }` only (checking env or macOS Keychain metadata without `-w`), and all `tailscale::*` outputs scrub `tskey-*` tokens.
4. **No public Tunnel to Gap `/ws`** until [LOR-545](https://linear.app/lornu-ai/issue/LOR-545) closes.
5. **Run as the host user** with local CLI access; never bake auth keys into OCI images.

## Run locally (Mac A or ChromeOS)

```bash
cd tools/mcp-skills

# Start OrbStack skill on 127.0.0.1:9320/mcp (Mac OrbStack hosts)
cargo run -p osc-skill-orbstack

# Start Tailscale skill on 127.0.0.1:9321/mcp (Mac or ChromeOS hosts)
cargo run -p osc-skill-tailscale
```

## Smoke test

```bash
# List tools
curl -fsS -X POST http://127.0.0.1:9320/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

curl -fsS -X POST http://127.0.0.1:9321/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Run unit tests
cargo test --workspace
```
