#!/bin/sh
set -eu
umask 077

work=/var/lib/postgresql/cpoly-backup-work
rm -rf "$work"
mkdir -p "$work/backup" "$work/verify"
cleanup() {
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

BACKUP_ROOT=$work/backup \
CPOLY_SOURCE_CONTAINER=cpoly-postgres-cloudflare-standard-1 \
PGHOST=/var/run/postgresql \
PGPORT=5432 \
PGDATABASE=adg_adjudication \
PGUSER=adg_backup \
PGSSLMODE=disable \
/bin/sh /opt/cpoly/scripts/create-kv-binary-backup.sh

VERIFY_ROOT=$work/verify \
BINARY_ARCHIVE=$work/backup/adg-adjudication.dump \
RESTORE_EVIDENCE_FILE=$work/backup/restore-evidence.json \
/bin/sh /opt/cpoly/scripts/verify-binary-backup-job.sh

ADG_BACKUP_BASE_URL_FILE=/run/cpoly/secrets/backup-base-url \
ADG_BACKUP_HMAC_KEY_FILE=/run/cpoly/secrets/backup-hmac-key \
python3 /opt/cpoly/scripts/d1_backup_client.py upload \
  --archive "$work/backup/adg-adjudication.dump" \
  --manifest-base "$work/backup/manifest-base.json" \
  --restore-evidence "$work/backup/restore-evidence.json" \
  --archive-format postgres-custom \
  --encryption-format none \
  --database adg_adjudication

echo "CLOUDFLARE_CONTAINER_BACKUP_COMPLETE"
