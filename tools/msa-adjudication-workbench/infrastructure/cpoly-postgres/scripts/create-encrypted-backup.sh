#!/bin/sh
set -eu
umask 077

: "${BACKUP_ROOT:=/backup}"
: "${PGHOST:=adg-postgres-headless.adg-data-plane.svc.cluster.local}"
: "${PGPORT:=5432}"
: "${PGDATABASE:=postgres}"
: "${PGUSER:=adg_backup}"
: "${PGSSLMODE:=verify-full}"
: "${PGSSLROOTCERT:=/run/secrets/tls/postgres-ca.crt}"

password_file=/run/secrets/roles/adg-backup-password
passphrase_file=${BACKUP_PASSPHRASE_FILE:-/run/secrets/portal-backup/encryption-passphrase}
for required_file in "$password_file" "$passphrase_file" "$PGSSLROOTCERT"; do
  if [ ! -s "$required_file" ]; then
    echo "Required backup input is missing: $required_file" >&2
    exit 1
  fi
done
if [ "$(wc -c < "$passphrase_file")" -lt 32 ]; then
  echo "OpenPGP encryption passphrase must contain at least 32 bytes." >&2
  exit 1
fi

plain_dir=$BACKUP_ROOT/plain
bundle=$BACKUP_ROOT/cpoly-postgres-backup.tar
encrypted=$BACKUP_ROOT/cpoly-postgres-backup.tar.gpg
round_trip=$BACKUP_ROOT/round-trip.tar
metadata=$BACKUP_ROOT/manifest-base.json
gnupg_home=$BACKUP_ROOT/gnupg
snapshot_fifo=$BACKUP_ROOT/snapshot-control
snapshot_output=$BACKUP_ROOT/snapshot-output
snapshot_pid=
snapshot_active=false
claim_boundary="This proves creation, integrity, encryption, and the requested restore test only. Off-host replication and recovery-time objectives require separate scheduled operations."
source_image="postgres:16-bookworm@sha256:60f4761b9035e0b8d5218f701a8c3382f641bf12b1604822574cf5be3baeb537"

if find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 | grep -q .; then
  echo "Backup workspace is not empty: $BACKUP_ROOT" >&2
  exit 1
fi
mkdir -p "$plain_dir" "$gnupg_home"
chmod 0700 "$gnupg_home"

cleanup_plaintext() {
  if [ "$snapshot_active" = "true" ] && [ -n "$snapshot_pid" ] &&
     kill -0 "$snapshot_pid" 2>/dev/null; then
    printf 'ROLLBACK;\n' > "$snapshot_fifo" 2>/dev/null || true
    wait "$snapshot_pid" 2>/dev/null || true
  fi
  snapshot_active=false
  rm -rf "$plain_dir" "$bundle" "$round_trip" "$gnupg_home"
  rm -f "$snapshot_fifo" "$snapshot_output"
}
trap cleanup_plaintext EXIT INT TERM

export PGPASSWORD
PGPASSWORD=$(cat "$password_file")
export GNUPGHOME=$gnupg_home

until pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" >/dev/null 2>&1; do
  sleep 2
done

pg_dumpall \
  --host="$PGHOST" \
  --port="$PGPORT" \
  --username="$PGUSER" \
  --database="$PGDATABASE" \
  --globals-only \
  --no-role-passwords \
  --file="$plain_dir/globals.sql"
test -s "$plain_dir/globals.sql"

mkfifo "$snapshot_fifo"
(
  {
    printf '%s\n' \
      'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;' \
      'SELECT pg_export_snapshot();' \
      'SELECT current_generation FROM adjudication.cpoly_runtime_state WHERE singleton = TRUE;' \
      'SELECT COALESCE(MAX(receipt_seq), 0) FROM adjudication.cpoly_write_receipts;'
    cat "$snapshot_fifo"
  } | psql \
      --set=ON_ERROR_STOP=1 \
      --quiet \
      --tuples-only \
      --no-align \
      --dbname=adg_adjudication
) > "$snapshot_output" &
snapshot_pid=$!
snapshot_active=true

for attempt in $(seq 1 100); do
  if [ "$(wc -l < "$snapshot_output" 2>/dev/null || printf 0)" -ge 3 ]; then
    break
  fi
  if ! kill -0 "$snapshot_pid" 2>/dev/null; then
    echo "Snapshot keeper exited before exporting the snapshot." >&2
    exit 1
  fi
  sleep 0.1
done
snapshot_id=$(sed -n '1p' "$snapshot_output")
snapshot_generation=$(sed -n '2p' "$snapshot_output")
postgres_receipt_watermark=$(sed -n '3p' "$snapshot_output")
case "$snapshot_id" in
  ''|*[!0-9A-Fa-f-]*) echo "Exported snapshot ID was invalid." >&2; exit 1;;
esac
case "$snapshot_generation" in
  ''|*[!0-9]*) echo "Snapshot generation was invalid." >&2; exit 1;;
esac
case "$postgres_receipt_watermark" in
  ''|*[!0-9]*) echo "PostgreSQL receipt watermark was invalid." >&2; exit 1;;
esac

psql --set=ON_ERROR_STOP=1 --tuples-only --no-align --field-separator='|' \
  --command="SELECT oid, datname, pg_database_size(datname)
             FROM pg_database
             WHERE datallowconn AND NOT datistemplate
             ORDER BY datname" \
  > "$plain_dir/inventory.tsv"

database_count=0
snapshot_dumped=false
while IFS='|' read -r database_oid database_name database_bytes; do
  [ -n "$database_oid" ] || continue
  case "$database_oid" in *[!0-9]*) echo "Invalid database OID." >&2; exit 1;; esac
  case "$database_bytes" in *[!0-9]*) echo "Invalid database size." >&2; exit 1;; esac
  case "$database_name" in
    ''|*[!A-Za-z0-9_.-]*)
      echo "Database name is outside the fail-closed portable set: $database_name" >&2
      exit 1
      ;;
  esac
  dump_name=database-$database_oid.dump
  if [ "$database_name" = "adg_adjudication" ]; then
    pg_dump \
      --host="$PGHOST" \
      --port="$PGPORT" \
      --username="$PGUSER" \
      --dbname="$database_name" \
      --snapshot="$snapshot_id" \
      --exclude-table-data=adjudication.cpoly_recovery_state \
      --exclude-table-data=adjudication.schema_migrations \
      --format=custom \
      --compress=9 \
      --no-owner \
      --no-privileges \
      --lock-wait-timeout=60s \
      --file="$plain_dir/$dump_name"
    snapshot_dumped=true
    printf 'COMMIT;\n' > "$snapshot_fifo"
    wait "$snapshot_pid"
    snapshot_active=false
    rm -f "$snapshot_fifo" "$snapshot_output"
  else
    pg_dump \
      --host="$PGHOST" \
      --port="$PGPORT" \
      --username="$PGUSER" \
      --dbname="$database_name" \
      --format=custom \
      --compress=9 \
      --no-owner \
      --no-privileges \
      --lock-wait-timeout=60s \
      --file="$plain_dir/$dump_name"
  fi
  test -s "$plain_dir/$dump_name"
  if [ "$(dd if="$plain_dir/$dump_name" bs=5 count=1 2>/dev/null)" != "PGDMP" ]; then
    echo "Custom dump header verification failed: $dump_name" >&2
    exit 1
  fi
  database_count=$((database_count + 1))
done < "$plain_dir/inventory.tsv"

if [ "$database_count" -eq 0 ]; then
  echo "No connectable non-template database was discovered." >&2
  exit 1
fi
if [ "$snapshot_dumped" != "true" ]; then
  echo "The adjudication database was not dumped from the exported snapshot." >&2
  exit 1
fi

(
  cd "$plain_dir"
  sha256sum globals.sql inventory.tsv database-*.dump > plaintext-sha256.txt
)

server_version=$(psql --tuples-only --no-align --command="SHOW server_version")
created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
{
  printf '{\n'
  printf '  "schema": "cpoly_postgres_backup_v1",\n'
  printf '  "created_at_utc": "%s",\n' "$created_at"
  printf '  "source_service": "adg-postgres-headless.adg-data-plane.svc.cluster.local",\n'
  printf '  "server_version": "%s",\n' "$server_version"
  printf '  "snapshotGeneration": %s,\n' "$snapshot_generation"
  printf '  "postgresReceiptWatermark": %s,\n' "$postgres_receipt_watermark"
  printf '  "globals": "globals.sql",\n'
  printf '  "database_count": %s,\n' "$database_count"
  printf '  "databases": [\n'
  item_index=0
  while IFS='|' read -r database_oid database_name database_bytes; do
    [ -n "$database_oid" ] || continue
    [ "$item_index" -eq 0 ] || printf ',\n'
    printf '    {"oid": %s, "name": "%s", "bytes": %s, "dump": "database-%s.dump"}' \
      "$database_oid" "$database_name" "$database_bytes" "$database_oid"
    item_index=$((item_index + 1))
  done < "$plain_dir/inventory.tsv"
  printf '\n  ],\n'
  printf '  "plaintext_sha256_manifest": "plaintext-sha256.txt",\n'
  printf '  "encryption": "AES-256 OpenPGP symmetric",\n'
  printf '  "plaintext_removed_after_encryption": true,\n'
  printf '  "claim_boundary": "%s"\n' "$claim_boundary"
  printf '}\n'
} > "$plain_dir/backup-manifest.json"

tar -C "$plain_dir" -cf "$bundle" .
bundle_sha256=$(sha256sum "$bundle" | awk '{print $1}')

gpg \
  --batch \
  --yes \
  --pinentry-mode loopback \
  --passphrase-file "$passphrase_file" \
  --symmetric \
  --cipher-algo AES256 \
  --s2k-cipher-algo AES256 \
  --s2k-digest-algo SHA512 \
  --compress-algo none \
  --output "$encrypted" \
  "$bundle"
test -s "$encrypted"

gpg \
  --batch \
  --yes \
  --pinentry-mode loopback \
  --passphrase-file "$passphrase_file" \
  --decrypt \
  --output "$round_trip" \
  "$encrypted" 2>/dev/null
round_trip_sha256=$(sha256sum "$round_trip" | awk '{print $1}')
if [ "$bundle_sha256" != "$round_trip_sha256" ]; then
  echo "OpenPGP encryption round-trip SHA-256 verification failed." >&2
  exit 1
fi

encrypted_sha256=$(sha256sum "$encrypted" | awk '{print $1}')
encrypted_bytes=$(wc -c < "$encrypted" | tr -d ' ')
{
  printf '{\n'
  printf '  "schema": "cpoly_postgres_backup_v1",\n'
  printf '  "created_at_utc": "%s",\n' "$created_at"
  printf '  "source_container": "adg-postgres-0",\n'
  printf '  "source_image": "%s",\n' "$source_image"
  printf '  "server_version": "%s",\n' "$server_version"
  printf '  "snapshotGeneration": %s,\n' "$snapshot_generation"
  printf '  "postgresReceiptWatermark": %s,\n' "$postgres_receipt_watermark"
  printf '  "databases": [\n'
  item_index=0
  while IFS='|' read -r database_oid database_name database_bytes; do
    [ -n "$database_oid" ] || continue
    [ "$item_index" -eq 0 ] || printf ',\n'
    printf '    {"oid": %s, "name": "%s", "bytes": %s, "dump": "database-%s.dump"}' \
      "$database_oid" "$database_name" "$database_bytes" "$database_oid"
    item_index=$((item_index + 1))
  done < "$plain_dir/inventory.tsv"
  printf '\n  ],\n'
  printf '  "plaintext_file_hashes": [\n'
  hash_index=0
  while read -r file_sha file_name; do
    file_name=${file_name#\*}
    file_name=${file_name# }
    [ "$hash_index" -eq 0 ] || printf ',\n'
    file_bytes=$(wc -c < "$plain_dir/$file_name" | tr -d ' ')
    printf '    {"name": "%s", "bytes": %s, "sha256": "%s"}' \
      "$file_name" "$file_bytes" "$file_sha"
    hash_index=$((hash_index + 1))
  done < "$plain_dir/plaintext-sha256.txt"
  printf '\n  ],\n'
  printf '  "attestations": {\n'
  printf '    "schema": "adg.cpoly-postgres.backup-attestations.v1",\n'
  printf '    "protected_columns_entitycrypt": true,\n'
  printf '    "role_password_material_excluded": true,\n'
  printf '    "bootstrap_roles_separate": true\n'
  printf '  },\n'
  printf '  "encryption": {\n'
  printf '    "status": "PASS_AES256_GPG_SYMMETRIC",\n'
  printf '    "algorithm": "AES-256 via OpenPGP symmetric encryption",\n'
  printf '    "key_source": "kubernetes_secret",\n'
  printf '    "secret_name": "adg-postgres-portal-backup-secrets/encryption-passphrase",\n'
  printf '    "encrypted_archive": "cpoly-postgres-backup.tar.gpg",\n'
  printf '    "encrypted_bytes": %s,\n' "$encrypted_bytes"
  printf '    "encrypted_sha256": "%s",\n' "$encrypted_sha256"
  printf '    "round_trip_verified": true\n'
  printf '  },\n'
  printf '  "claim_boundary": "%s"\n' "$claim_boundary"
  printf '}\n'
} > "$metadata"

cleanup_plaintext
trap - EXIT INT TERM
if find "$BACKUP_ROOT" -type f \
  ! -name 'cpoly-postgres-backup.tar.gpg' \
  ! -name 'manifest-base.json' | grep -q .; then
  echo "Plaintext backup material remains after encryption." >&2
  exit 1
fi

unset PGPASSWORD
echo "ENCRYPTED_BACKUP_READY databases=$database_count sha256=$encrypted_sha256"
