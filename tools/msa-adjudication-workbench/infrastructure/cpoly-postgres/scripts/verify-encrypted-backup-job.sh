#!/bin/sh
set -eu

: "${VERIFY_ROOT:=/verify}"
pgdata=$VERIFY_ROOT/pgdata
socket_dir=$VERIFY_ROOT/run

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

PGHOST=$socket_dir \
PGPORT=5432 \
PGUSER=postgres \
RESTORE_MODE=verify-all \
RESTORE_EVIDENCE_FILE="${RESTORE_EVIDENCE_FILE:-}" \
/bin/sh /opt/cpoly/scripts/restore-encrypted-backup.sh

cleanup_postgres
trap - EXIT INT TERM
echo "DISPOSABLE_POSTGRES16_RESTORE_VERIFY_COMPLETE"
