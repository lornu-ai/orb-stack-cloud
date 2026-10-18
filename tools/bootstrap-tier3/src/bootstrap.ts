import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const tier3Dir = join(repoRoot, "blueprint/tier3-cloudinit");

function render(path: string): string {
  const raw = readFileSync(path, "utf8");
  const pubkey = process.env.ORB_SSH_PUBKEY?.trim() ?? "";
  if (!pubkey) {
    console.error("ORB_SSH_PUBKEY is required (see docs/VALIDATION.md)");
    process.exit(1);
  }
  const tsAuthKey = process.env.TS_AUTHKEY ?? "";
  return raw
    .replaceAll("${ORB_SSH_PUBKEY}", pubkey)
    .replaceAll("${TS_AUTHKEY}", tsAuthKey);
}

function orbCreate(distro: string, name: string, userdataPath: string): void {
  const result = spawnSync("orb", ["create", distro, name, "-c", userdataPath], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const work = mkdtempSync(join(tmpdir(), "orb-tier3-"));
const postgresPath = join(work, "postgres-userdata.yaml");
const vaultPath = join(work, "vault-userdata.yaml");

writeFileSync(postgresPath, render(join(tier3Dir, "postgres-userdata.yaml")));
writeFileSync(vaultPath, render(join(tier3Dir, "vault-userdata.yaml")));

console.log("Creating Tier 3 machines (Crossplane replacement for terraform apply)…");
orbCreate("ubuntu", "postgres", postgresPath);
orbCreate("debian", "vault", vaultPath);
console.log("Done. Verify with docs/VALIDATION.md");
