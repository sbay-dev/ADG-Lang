#!/bin/sh
set -eu

: "${VERIFY_ROOT:=/verify}"
: "${BINARY_ARCHIVE:=/backup/adg-adjudication.dump}"
pgdata=$VERIFY_ROOT/pgdata
socket_dir=$VERIFY_ROOT/run
target=verify_adg_adjudication

if [ ! -s "$BINARY_ARCHIVE" ] ||
   [ "$(dd if="$BINARY_ARCHIVE" bs=5 count=1 2>/dev/null)" != "PGDMP" ]; then
  echo "Binary restore-verification archive is invalid." >&2
  exit 1
fi
if [ -e "$pgdata/PG_VERSION" ]; then
  echo "Disposable restore-verification PGDATA is not empty." >&2
  exit 1
fi
mkdir -p "$pgdata" "$socket_dir"
chmod 0700 "$pgdata" "$socket_dir"

initdb \
  --pgdata="$pgdata" \
  --username=postgres \
  --auth-local=trust \
  --auth-host=scram-sha-256 \
  --data-checksums >/dev/null

cleanup_postgres() {
  pg_ctl --pgdata="$pgdata" --mode=fast --wait stop >/dev/null 2>&1 || true
}
trap cleanup_postgres EXIT INT TERM

pg_ctl \
  --pgdata="$pgdata" \
  --options="-c listen_addresses='' -c unix_socket_directories='$socket_dir'" \
  --wait \
  start >/dev/null

createdb --host="$socket_dir" --username=postgres "$target"
pg_restore \
  --host="$socket_dir" \
  --username=postgres \
  --dbname="$target" \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  "$BINARY_ARCHIVE"
restored_bytes=$(
  psql --host="$socket_dir" --username=postgres --dbname=postgres \
    --tuples-only --no-align \
    --command="SELECT pg_database_size('$target')"
)
case "$restored_bytes" in ''|*[!0-9]*) echo "Restore size invalid." >&2; exit 1;; esac

if [ -n "${RESTORE_EVIDENCE_FILE:-}" ]; then
  cat > "$RESTORE_EVIDENCE_FILE" <<EOF
{"requested":true,"status":"PASS","databases":[{"source_database":"adg_adjudication","target_database":"$target","restored_bytes":$restored_bytes,"status":"PASS"}]}
EOF
fi

cleanup_postgres
trap - EXIT INT TERM
echo "KV_BINARY_RESTORE_VERIFY_PASS database=adg_adjudication bytes=$restored_bytes"

