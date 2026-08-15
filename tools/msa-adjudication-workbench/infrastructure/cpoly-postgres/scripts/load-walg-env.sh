#!/bin/sh
set -eu

require_secret() {
  if [ ! -s "$1" ]; then
    echo "Required WAL-G secret is missing or empty: $1" >&2
    exit 1
  fi
}

case "${AWS_ENDPOINT:-}" in
  https://*)
    ;;
  *)
    echo "AWS_ENDPOINT must use https://." >&2
    exit 1
    ;;
esac

case "${WALG_S3_PREFIX:-}" in
  s3://*REPLACE*|s3://)
    echo "WALG_S3_PREFIX contains an undeployed placeholder." >&2
    exit 1
    ;;
  s3://*)
    ;;
  *)
    echo "WALG_S3_PREFIX must use s3://." >&2
    exit 1
    ;;
esac

case "${WALG_S3_SSE:-}" in
  AES256|aws:kms)
    ;;
  *)
    echo "WALG_S3_SSE must be AES256 or aws:kms." >&2
    exit 1
    ;;
esac

case "${WALG_RETENTION_FULL:-}" in
  ''|*[!0-9]*)
    echo "WALG_RETENTION_FULL must be a positive integer." >&2
    exit 1
    ;;
esac
if [ "$WALG_RETENTION_FULL" -lt 2 ]; then
  echo "WALG_RETENTION_FULL must retain at least two full backups." >&2
  exit 1
fi

require_secret /run/secrets/backup/aws-access-key-id
require_secret /run/secrets/backup/aws-secret-access-key
require_secret /run/secrets/backup/libsodium-key

export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY WALG_LIBSODIUM_KEY
AWS_ACCESS_KEY_ID=$(cat /run/secrets/backup/aws-access-key-id)
AWS_SECRET_ACCESS_KEY=$(cat /run/secrets/backup/aws-secret-access-key)
WALG_LIBSODIUM_KEY=$(cat /run/secrets/backup/libsodium-key)
export WALG_LIBSODIUM_KEY_TRANSFORM=base64
export S3_SKIP_VALIDATION=false

if [ "${CPOLY_WALG_NEEDS_POSTGRES:-false}" = "true" ]; then
  require_secret /run/secrets/roles/adg-backup-password
  export PGPASSWORD
  PGPASSWORD=$(cat /run/secrets/roles/adg-backup-password)
  : "${PGSSLMODE:=verify-full}"
  : "${PGSSLROOTCERT:=/run/secrets/tls/postgres-ca.crt}"
  export PGSSLMODE PGSSLROOTCERT
fi

