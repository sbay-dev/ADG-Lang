#!/bin/sh
set -eu

: "${BINARY_ARCHIVE:=/backup/adg-adjudication.dump}"
if [ ! -s "$BINARY_ARCHIVE" ] ||
   [ "$(dd if="$BINARY_ARCHIVE" bs=5 count=1 2>/dev/null)" != "PGDMP" ]; then
  echo "Reconstructed PostgreSQL custom archive is invalid." >&2
  exit 1
fi

RESTORE_ARCHIVE=$BINARY_ARCHIVE \
/bin/sh /opt/cpoly/scripts/restore-logical.sh

echo "KV_BINARY_RESTORE_COMPLETE"

