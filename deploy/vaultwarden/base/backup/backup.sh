#!/bin/sh
# Nightly Vaultwarden backup: consistent SQLite snapshot + data-file tarball,
# each age-encrypted to AGE_RECIPIENT and written to BACKUP_DIR/<timestamp>/.
# Plaintext only ever exists in WORK_DIR (a memory-backed emptyDir).
set -eu
umask 077

DATA_DIR="${DATA_DIR:-/data}"
BACKUP_DIR="${BACKUP_DIR:-/backup}"
WORK_DIR="${WORK_DIR:-/work}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
AGE_VERSION="v1.3.2"
AGE_SHA256_ARM64="6b8dc4333c53a5a57c9e5834e3a48f92605d7154014cd07269ff3327db5d37f4"
AGE_SHA256_AMD64="cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

: "${AGE_RECIPIENT:?AGE_RECIPIENT must be set}"
case "$AGE_RECIPIENT" in
  *REPLACE*) echo "AGE_RECIPIENT is still the placeholder" >&2; exit 1 ;;
  age1*) ;;
  *) echo "AGE_RECIPIENT must be an age X25519 recipient (age1...)" >&2; exit 1 ;;
esac
[ -f "$DATA_DIR/db.sqlite3" ] || { echo "$DATA_DIR/db.sqlite3 not found" >&2; exit 1; }

case "$(uname -m)" in
  aarch64 | arm64) age_arch=arm64; age_sha256="$AGE_SHA256_ARM64" ;;
  x86_64 | amd64) age_arch=amd64; age_sha256="$AGE_SHA256_AMD64" ;;
  *) echo "unsupported arch $(uname -m)" >&2; exit 1 ;;
esac
log "fetching age ${AGE_VERSION} (${age_arch})"
wget -q -O "$WORK_DIR/age.tar.gz" \
  "https://github.com/FiloSottile/age/releases/download/${AGE_VERSION}/age-${AGE_VERSION}-linux-${age_arch}.tar.gz"
echo "${age_sha256}  $WORK_DIR/age.tar.gz" | sha256sum -c -
tar -xzf "$WORK_DIR/age.tar.gz" -C "$WORK_DIR" age/age
AGE="$WORK_DIR/age/age"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
dest="$BACKUP_DIR/$ts"
partial="$BACKUP_DIR/.partial-$ts"
trap 'rm -rf "$partial" "$WORK_DIR/db.sqlite3"' EXIT
mkdir -p "$partial"

log "snapshotting db.sqlite3"
sqlite3 "$DATA_DIR/db.sqlite3" ".timeout 30000" ".backup '$WORK_DIR/db.sqlite3'"
integrity="$(sqlite3 "$WORK_DIR/db.sqlite3" 'PRAGMA integrity_check;')"
[ "$integrity" = "ok" ] || { echo "integrity_check failed: $integrity" >&2; exit 1; }
gzip -c "$WORK_DIR/db.sqlite3" | "$AGE" -r "$AGE_RECIPIENT" -o "$partial/db.sqlite3.gz.age"
rm -f "$WORK_DIR/db.sqlite3"

set --
for p in attachments sends icon_cache config.json rsa_key.pem rsa_key.pub.pem; do
  [ -e "$DATA_DIR/$p" ] && set -- "$@" "$p"
done
if [ "$#" -gt 0 ]; then
  log "archiving: $*"
  tar -C "$DATA_DIR" -czf - "$@" | "$AGE" -r "$AGE_RECIPIENT" -o "$partial/data-files.tar.gz.age"
fi

(cd "$partial" && sha256sum ./*.age > SHA256SUMS)
mv "$partial" "$dest"
log "wrote $dest"
ls -l "$dest"

log "pruning backups older than ${RETENTION_DAYS} days"
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime "+${RETENTION_DAYS}" -print -exec rm -rf {} +
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '.partial-*' -mtime +1 -print -exec rm -rf {} +
log "done"
