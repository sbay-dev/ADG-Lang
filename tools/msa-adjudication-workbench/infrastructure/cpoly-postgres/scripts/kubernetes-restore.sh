#!/bin/sh
set -eu

expected_confirmation=RESTORE_adg_adjudication_FROM_WALG
if [ "${CPOLY_RESTORE_CONFIRM:-}" != "$expected_confirmation" ]; then
  echo "Restore confirmation is absent or incorrect." >&2
  exit 1
fi

restore_root=/restore
restore_target=$restore_root/pgdata
approval_marker=$restore_root/.cpoly-restore-approved

if [ ! -f "$approval_marker" ]; then
  echo "Restore approval marker is absent: $approval_marker" >&2
  exit 1
fi

if [ ! -s "$restore_target/PG_VERSION" ]; then
  echo "Target PVC does not contain an existing PostgreSQL cluster." >&2
  exit 1
fi

rm -f "$approval_marker"
find "$restore_target" -mindepth 1 -delete
exec /bin/sh /opt/cpoly/scripts/walg-restore-fetch.sh \
  "$restore_target" "${WALG_RESTORE_BACKUP:-LATEST}"

