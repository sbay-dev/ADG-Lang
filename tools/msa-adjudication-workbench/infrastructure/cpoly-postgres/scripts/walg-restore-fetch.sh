#!/bin/sh
set -eu

. /opt/cpoly/scripts/load-walg-env.sh

restore_target=${1:-/restore}
backup_name=${2:-LATEST}

mkdir -p "$restore_target"
if find "$restore_target" -mindepth 1 -maxdepth 1 ! -name lost+found | grep -q .; then
  echo "Restore target is not empty: $restore_target" >&2
  exit 1
fi

wal-g backup-list
wal-g backup-fetch "$restore_target" "$backup_name"

if [ ! -s "$restore_target/PG_VERSION" ]; then
  echo "Restored backup does not contain PG_VERSION." >&2
  exit 1
fi

unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY WALG_LIBSODIUM_KEY

