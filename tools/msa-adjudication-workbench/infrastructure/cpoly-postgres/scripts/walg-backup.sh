#!/bin/sh
set -eu

CPOLY_WALG_NEEDS_POSTGRES=true
export CPOLY_WALG_NEEDS_POSTGRES
. /opt/cpoly/scripts/load-walg-env.sh

wal-g backup-push
wal-g backup-list
wal-g delete retain FULL "$WALG_RETENTION_FULL" --confirm
wal-g backup-list

unset PGPASSWORD AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY WALG_LIBSODIUM_KEY

