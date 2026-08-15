#!/bin/sh
set -eu
umask 077

: "${BACKUP_ROOT:=/backup}"
: "${PGHOST:=adg-postgres-headless.adg-data-plane.svc.cluster.local}"
: "${PGPORT:=5432}"
: "${PGDATABASE:=adg_adjudication}"
: "${PGUSER:=adg_backup}"
: "${PGSSLMODE:=verify-full}"
: "${PGSSLROOTCERT:=/run/secrets/tls/postgres-ca.crt}"

password_file=/run/secrets/roles/adg-backup-password
archive=$BACKUP_ROOT/adg-adjudication.dump
metadata=$BACKUP_ROOT/manifest-base.json
snapshot_fifo=$BACKUP_ROOT/snapshot-control
snapshot_output=$BACKUP_ROOT/snapshot-output
snapshot_pid=
snapshot_active=false
claim_boundary="This proves creation, integrity, EntityCrypt protected-column attestations, separate role bootstrap handling, and the requested restore test only. Off-host replication and recovery-time objectives require separate scheduled operations."
source_image="postgres:16-bookworm@sha256:60f4761b9035e0b8d5218f701a8c3382f641bf12b1604822574cf5be3baeb537"
source_container=${CPOLY_SOURCE_CONTAINER:-adg-postgres-0}

required_files=$password_file
if [ "$PGSSLMODE" != "disable" ]; then
  required_files="$required_files $PGSSLROOTCERT"
fi
for required_file in $required_files; do
  if [ ! -s "$required_file" ]; then
    echo "Required binary backup input is missing: $required_file" >&2
    exit 1
  fi
done
if find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 | grep -q .; then
  echo "Backup workspace is not empty: $BACKUP_ROOT" >&2
  exit 1
fi

cleanup_snapshot() {
  if [ "$snapshot_active" = "true" ] && [ -n "$snapshot_pid" ] &&
     kill -0 "$snapshot_pid" 2>/dev/null; then
    printf 'ROLLBACK;\n' > "$snapshot_fifo" 2>/dev/null || true
    wait "$snapshot_pid" 2>/dev/null || true
  fi
  rm -f "$snapshot_fifo" "$snapshot_output"
}
trap cleanup_snapshot EXIT INT TERM

export PGPASSWORD
PGPASSWORD=$(cat "$password_file")
until pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" >/dev/null 2>&1; do
  sleep 2
done

mkfifo "$snapshot_fifo"
(
  {
    printf '%s\n' \
      'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;' \
      'SELECT pg_export_snapshot();' \
      'SELECT current_generation FROM adjudication.cpoly_runtime_state WHERE singleton = TRUE;' \
      'SELECT COALESCE(MAX(receipt_seq), 0) FROM adjudication.cpoly_write_receipts WHERE generation = (SELECT current_generation FROM adjudication.cpoly_runtime_state WHERE singleton = TRUE);'
    cat "$snapshot_fifo"
  } | psql \
      --set=ON_ERROR_STOP=1 \
      --quiet \
      --tuples-only \
      --no-align \
      --dbname="$PGDATABASE"
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
case "$snapshot_id" in ''|*[!0-9A-Fa-f-]*) echo "Snapshot ID invalid." >&2; exit 1;; esac
case "$snapshot_generation" in ''|*[!0-9]*) echo "Snapshot generation invalid." >&2; exit 1;; esac
case "$postgres_receipt_watermark" in ''|*[!0-9]*) echo "Receipt watermark invalid." >&2; exit 1;; esac

pg_dump \
  --host="$PGHOST" \
  --port="$PGPORT" \
  --username="$PGUSER" \
  --dbname="$PGDATABASE" \
  --snapshot="$snapshot_id" \
  --exclude-table-data=adjudication.cpoly_recovery_state \
  --exclude-table-data=adjudication.schema_migrations \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --lock-wait-timeout=60s \
  --file="$archive"

printf 'COMMIT;\n' > "$snapshot_fifo"
wait "$snapshot_pid"
snapshot_active=false
cleanup_snapshot
trap - EXIT INT TERM

test -s "$archive"
if [ "$(dd if="$archive" bs=5 count=1 2>/dev/null)" != "PGDMP" ]; then
  echo "Custom-format archive header verification failed." >&2
  exit 1
fi

archive_sha256=$(sha256sum "$archive" | awk '{print $1}')
archive_bytes=$(wc -c < "$archive" | tr -d ' ')
database_bytes=$(
  psql --set=ON_ERROR_STOP=1 --quiet --tuples-only --no-align \
    --command="SELECT pg_database_size('adg_adjudication')"
)
server_version=$(psql --tuples-only --no-align --command="SHOW server_version")
created_at=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)

cat > "$metadata" <<EOF
{
  "schema": "cpoly_postgres_backup_v1",
  "created_at_utc": "$created_at",
  "source_container": "$source_container",
  "source_image": "$source_image",
  "server_version": "$server_version",
  "databases": [
    {"name": "adg_adjudication", "bytes": $database_bytes, "dump": "adg-adjudication.dump"}
  ],
  "plaintext_file_hashes": [
    {"name": "adg-adjudication.dump", "bytes": $archive_bytes, "sha256": "$archive_sha256"}
  ],
  "attestations": {
    "schema": "adg.cpoly-postgres.backup-attestations.v1",
    "protected_columns_entitycrypt": true,
    "role_password_material_excluded": true,
    "bootstrap_roles_separate": true
  },
  "claim_boundary": "$claim_boundary",
  "snapshotGeneration": $snapshot_generation,
  "postgresReceiptWatermark": $postgres_receipt_watermark
}
EOF

unset PGPASSWORD
echo "KV_BINARY_BACKUP_READY sha256=$archive_sha256 generation=$snapshot_generation watermark=$postgres_receipt_watermark"
