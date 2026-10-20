# Vaultwarden on OrbStack (tailnet only)

Self-hosted [Vaultwarden](https://github.com/dani-garcia/vaultwarden) (Bitwarden-compatible
server) on the OrbStack Kubernetes cluster, reconciled by Flux. Tracking: LOR-624.

```
deploy/vaultwarden/
  base/                      namespace, Deployment, PVCs, Service, Tailscale Ingress, backup CronJob
  overlays/orbstack/         DOMAIN, storage class, ingress hostname, SOPS secret (template)
  optional/                  ExternalSecret alternative to SOPS (not wired in)
clusters/orbstack/vaultwarden.yaml   Flux Kustomization -> overlays/orbstack
.sops.yaml                           SOPS creation rule (age recipient placeholder)
```

| Item | Value |
| --- | --- |
| URL | `https://vaultwarden.tailbab6b0.ts.net` (tailnet only) |
| Image | `vaultwarden/server:1.37.4` pinned by digest |
| Database | SQLite on PVC `vaultwarden-data` (`local-path`) |
| Backups | nightly 03:17 UTC, age-encrypted, PVC `vaultwarden-backup`, 14-day retention |
| Signups | disabled; invitations enabled; password hints disabled |

## Why tailnet only

Vaultwarden is exposed **only** through the Tailscale Kubernetes operator
(`ingressClassName: tailscale`). There is no Cloudflare tunnel or public ingress, and
Tailscale Funnel must never be enabled for it.

- The Bitwarden mobile apps, browser extensions and autofill call the API directly. They
  cannot complete the interactive Cloudflare Access login or send Access service-token
  headers, so sync breaks behind Cloudflare Access. Exposing the vault without Access
  would put the password vault on the public internet.
- Tailscale gives device-level WireGuard auth plus a real Let's Encrypt certificate for
  `*.ts.net`, which the Bitwarden clients require (HTTPS + WebCrypto).
- Off-tailnet, clients still autofill from their encrypted offline cache; changes sync once
  Tailscale reconnects.

Prerequisites on the cluster: Tailscale operator installed, MagicDNS and HTTPS enabled for
the tailnet, Flux bootstrapped with a `flux-system` GitRepository for this repo.

## 1. Generate the ADMIN_TOKEN (argon2id)

`ADMIN_TOKEN` must be an argon2id PHC hash. The plaintext admin password is only ever typed
into `/admin`; store it offline (it is the key to the server, not to anyone's vault).

Using the pinned image (prompts for the password twice):

```sh
docker run --rm -it \
  vaultwarden/server:1.37.4@sha256:efb3cde962015fcc036b2ea625242248611943b27212ebf4392841fb30fad055 \
  /vaultwarden hash --preset owasp
```

Or with the `argon2` CLI (`brew install argon2`), Bitwarden preset:

```sh
read -rs ADMIN_PW
printf %s "$ADMIN_PW" | argon2 "$(openssl rand -base64 32)" -e -id -k 65540 -t 3 -p 4
unset ADMIN_PW
```

Output looks like `$argon2id$v=19$m=65540,t=3,p=4$<salt>$<hash>`.

## 2. Create and encrypt the Secret with SOPS

One-time Flux SOPS key (skip if the cluster already has one):

```sh
age-keygen -o age.agekey                       # keep this file offline, never commit it
age-keygen -y age.agekey                       # public key -> replace placeholder in /.sops.yaml
kubectl -n flux-system create secret generic sops-age --from-file=age.agekey=age.agekey
```

The Secret name `sops-age` is referenced by `clusters/orbstack/vaultwarden.yaml`.

Create the encrypted Secret:

```sh
cd deploy/vaultwarden/overlays/orbstack
cp secret.sops.yaml.example secret.sops.yaml
$EDITOR secret.sops.yaml                       # paste the argon2id hash in single quotes
sops --encrypt --in-place secret.sops.yaml     # uses the rule in /.sops.yaml
grep -q 'sops:' secret.sops.yaml && grep -q 'ENC\[' secret.sops.yaml && echo encrypted
```

Then uncomment `- secret.sops.yaml` in `overlays/orbstack/kustomization.yaml` and commit
only the encrypted file. The ExternalSecret in `optional/` is an alternative if a secret
store is available.

## 3. Backup recipient

Backups are encrypted to a **separate** age identity from the Flux SOPS key, so a cluster
compromise does not expose old backups. Generate it on a trusted machine and keep the
private key offline (e.g. printed + stored with other recovery material):

```sh
age-keygen -o vaultwarden-backup.agekey
age-keygen -y vaultwarden-backup.agekey        # set as AGE_RECIPIENT in the overlay
```

Until `AGE_RECIPIENT` is set, the backup job fails on purpose.

## 4. Validate and deploy

```sh
kubectl kustomize deploy/vaultwarden/overlays/orbstack
```

Merge to `main`; Flux applies `clusters/orbstack/vaultwarden.yaml` (`prune: true`,
`wait: true`). Check:

```sh
flux get kustomizations vaultwarden
kubectl -n vaultwarden get pods,pvc,ingress
curl -fsS https://vaultwarden.tailbab6b0.ts.net/alive
```

The Namespace and PVCs carry `kustomize.toolkit.fluxcd.io/prune: disabled`, so removing the
Flux Kustomization does not delete the vault. `local-path` PVs use `reclaimPolicy: Delete`:
deleting a PVC by hand deletes its data.

## 5. First admin login and inviting Steven

1. Open `https://vaultwarden.tailbab6b0.ts.net/admin` and enter the **plaintext** admin
   password from step 1 (not the hash).
2. Prefer configuring settings via the overlay env vars. Anything saved in the admin UI is
   written to `/data/config.json` and **overrides** env vars from then on.
3. Invite Steven: *Users -> Invite User* with his email.
   - **With SMTP**: set the `SMTP_*` placeholders in `overlays/orbstack/kustomization.yaml`
     and `SMTP_PASSWORD` in the SOPS secret; he receives an invite email with a join link.
   - **Without SMTP**: no email is sent and there is no link to copy. Tell him to open the
     web vault, choose *Create account*, and register with exactly the invited email
     address; invited addresses may register even though `SIGNUPS_ALLOWED=false`.
4. Create an Organization in the web vault for shared items and invite him to it
   (organization invites follow the same SMTP / no-SMTP rules).

### Disabling the admin page afterwards (optional)

Vaultwarden disables `/admin` when no admin token is configured:

1. Uncomment the `patches/disable-admin.yaml` entry in the overlay kustomization (removes
   the `ADMIN_TOKEN` env var).
2. If settings were ever saved in the admin UI, `config.json` also contains `admin_token`;
   remove that key from `/data/config.json` (or delete the file if everything else lives in
   env) and restart the pod.
3. Re-enable temporarily by reverting the patch when admin access is needed.

## 6. Bitwarden client setup

On every device: install and connect Tailscale first, then in the Bitwarden app, browser
extension, or desktop app, choose the self-hosted option on the login screen (region
selector -> *Self-hosted*) and set **Server URL** to
`https://vaultwarden.tailbab6b0.ts.net`. The web vault is at the same URL.

## 7. Importing passwords

Imports run client-side and then sync to Vaultwarden. Import into your personal vault
first, then move shared items into the Organization.

### Apple Passwords (iOS / macOS 26)

- **Direct transfer (preferred, includes passkeys)**: on iOS/iPadOS/macOS 26, the Passwords
  app can export directly to another credential manager app (*Export Data to Another App*,
  using the FIDO Credential Exchange flow). Pick Bitwarden as the destination while logged in
  to this server in the Bitwarden app. If your Bitwarden app version does not offer it, use
  the CSV path.
- **CSV fallback (no passkeys)**: in the macOS Passwords app, *File -> Export All Passwords
  to File...*. In the web vault, *Tools -> Import data*, format **Safari and macOS (csv)**
  (named *Apple Passwords (csv)* in some versions), upload the file.

### Google Password Manager (no Android phone needed)

On a desktop browser: `passwords.google.com` -> Settings (gear) -> *Export passwords* ->
re-authenticate -> downloads a CSV. In the web vault, *Tools -> Import data*, format
**Chrome (csv)**, upload.

### Delete the CSVs

CSV exports are plaintext. Save them outside iCloud Drive-synced folders (Desktop and
Documents may sync), import immediately, then `rm` the file and empty the Trash. Check
Downloads for duplicates.

## 8. Backups

The CronJob `vaultwarden-backup` runs nightly at 03:17 UTC. Each run writes
`/backup/<UTC timestamp>/` on PVC `vaultwarden-backup`:

| File | Contents |
| --- | --- |
| `db.sqlite3.gz.age` | consistent `sqlite3 .backup` snapshot (integrity-checked), gzip, age |
| `data-files.tar.gz.age` | `attachments/`, `sends/`, `icon_cache/`, `config.json`, `rsa_key*.pem` |
| `SHA256SUMS` | checksums of the encrypted files |

Plaintext only exists in a memory-backed `emptyDir`. The job runs as uid 1000 in the
pinned `keinos/sqlite3:3.54.1` image and downloads the static `age` v1.3.2 binary from
GitHub, verifying a pinned sha256 (needs egress to `github.com`). Follow-up: replace that
with a purpose-built backup image (sqlite3 + age) built via a Nix flake / oci-builds entry.

Run one now:

```sh
kubectl -n vaultwarden create job --from=cronjob/vaultwarden-backup vaultwarden-backup-manual-$(date +%s)
kubectl -n vaultwarden logs -l app.kubernetes.io/component=backup --tail=50
```

### Off-site sync

The backup PVC lives on the same OrbStack VM disk as the data, so it only protects against
corruption and operator error, not loss of the Mac. Because every file is age-encrypted,
the backup directory can be synced as-is to object storage (R2 / B2 / S3 via `rclone`), or
copied to the Mac (see below) and covered by Time Machine. Keep at least one copy off the
machine.

### Copying backups off the cluster

```sh
IMG='keinos/sqlite3:3.54.1@sha256:b577e65892c6468d94b390097eda4488e05253470c161bdea68a05abb961fa17'
kubectl -n vaultwarden run vw-backup-reader --restart=Never --image="$IMG" --overrides='{
  "spec": {
    "securityContext": {"runAsNonRoot": true, "runAsUser": 1000, "runAsGroup": 1000,
                        "seccompProfile": {"type": "RuntimeDefault"}},
    "containers": [{
      "name": "reader", "image": "'"$IMG"'", "command": ["sleep", "3600"],
      "securityContext": {"allowPrivilegeEscalation": false, "capabilities": {"drop": ["ALL"]}},
      "volumeMounts": [{"name": "backup", "mountPath": "/backup", "readOnly": true}]
    }],
    "volumes": [{"name": "backup", "persistentVolumeClaim": {"claimName": "vaultwarden-backup"}}]
  }}'
kubectl -n vaultwarden wait --for=condition=Ready pod/vw-backup-reader
kubectl -n vaultwarden exec vw-backup-reader -- ls /backup
kubectl -n vaultwarden cp vw-backup-reader:/backup/<TS> ./vw-backup-<TS>
kubectl -n vaultwarden delete pod vw-backup-reader
```

## 9. Restore drill (do this quarterly)

Non-destructive: restore the latest backup into a throwaway local container and log in.

```sh
cd vw-backup-<TS>
shasum -a 256 -c SHA256SUMS
mkdir -p restore && chmod 700 restore
age -d -i /path/to/vaultwarden-backup.agekey db.sqlite3.gz.age | gunzip > restore/db.sqlite3
age -d -i /path/to/vaultwarden-backup.agekey data-files.tar.gz.age | tar -xzf - -C restore
sqlite3 restore/db.sqlite3 'PRAGMA integrity_check; SELECT count(*) FROM users; SELECT count(*) FROM ciphers;'

docker run --rm -d --name vw-restore-drill -p 127.0.0.1:18080:8080 \
  -e ROCKET_PORT=8080 -e DOMAIN=http://localhost:18080 -e SIGNUPS_ALLOWED=false \
  -v "$PWD/restore:/data" \
  vaultwarden/server:1.37.4@sha256:efb3cde962015fcc036b2ea625242248611943b27212ebf4392841fb30fad055
# Log in at http://localhost:18080, confirm items and an attachment open.
docker rm -f vw-restore-drill
rm -rf restore                                  # plaintext vault data
```

Record the date and result on LOR-624 (or its successor).

### Real restore into the cluster

1. `flux suspend kustomization vaultwarden` (otherwise Flux scales the Deployment back up).
2. `kubectl -n vaultwarden scale deploy/vaultwarden --replicas=0`
3. Start a helper pod like `vw-backup-reader` above, but mounting PVC `vaultwarden-data` at
   `/data` read-write. Move the current files aside:
   `mkdir /data/pre-restore && mv /data/db.sqlite3* /data/attachments /data/sends /data/config.json /data/rsa_key* /data/pre-restore/ 2>/dev/null`
4. Decrypt locally as in the drill, then copy in:
   `tar -C restore -cf - . | kubectl -n vaultwarden exec -i <helper-pod> -- tar -xf - -C /data`
5. Delete the helper pod, `kubectl -n vaultwarden scale deploy/vaultwarden --replicas=1`,
   `flux resume kustomization vaultwarden`, verify `/alive` and a client login.
6. Delete local plaintext (`rm -rf restore`) and, once satisfied, `/data/pre-restore`.

## Upgrading

Bump both the tag comment and the digest together. Resolve the digest with:

```sh
docker buildx imagetools inspect vaultwarden/server:<tag> --format '{{.Manifest.Digest}}'
```

Take a manual backup before upgrading; Vaultwarden runs DB migrations on start.
