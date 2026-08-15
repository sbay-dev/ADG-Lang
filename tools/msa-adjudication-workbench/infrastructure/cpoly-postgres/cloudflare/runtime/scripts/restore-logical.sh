#!/bin/sh
set -eu

: "${RESTORE_ARCHIVE:=/backup/adg.dump}"
: "${MIGRATIONS_DIR:=/migrations/postgresql}"
: "${PGHOST:=adg-postgres-headless.adg-data-plane.svc.cluster.local}"
: "${PGPORT:=5432}"
: "${PGDATABASE:=adg_adjudication}"
: "${PGUSER:=adg_migrator}"
: "${PGSSLMODE:=verify-full}"
: "${PGSSLROOTCERT:=/run/secrets/tls/postgres-ca.crt}"

password_file=/run/secrets/roles/adg-migrator-password
if [ ! -s "$password_file" ]; then
  echo "Migration password secret is missing." >&2
  exit 1
fi
if [ ! -s "$RESTORE_ARCHIVE" ]; then
  echo "Validated restore archive is missing: $RESTORE_ARCHIVE" >&2
  exit 1
fi
if [ "$(dd if="$RESTORE_ARCHIVE" bs=5 count=1 2>/dev/null)" != "PGDMP" ]; then
  echo "Restore archive is not PostgreSQL custom format." >&2
  exit 1
fi
if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "Checked-in PostgreSQL migration mount is missing." >&2
  exit 1
fi

export PGPASSWORD
PGPASSWORD=$(cat "$password_file")

until pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" >/dev/null 2>&1; do
  sleep 2
done

table_count=$(
  psql --set=ON_ERROR_STOP=1 --quiet --tuples-only --no-align <<'SQL'
SET ROLE adg_owner;
SELECT count(*)
FROM pg_class AS relation
JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = 'adjudication'
  AND relation.relkind IN ('r', 'p', 'm', 'S');
SQL
)

if [ "$table_count" -gt 0 ] &&
   [ "${CPOLY_DESTRUCTIVE_RESTORE:-false}" != "RESTORE_adg_adjudication_FROM_D1" ]; then
  echo "Database is non-empty; exact destructive confirmation is required." >&2
  exit 1
fi

psql --set=ON_ERROR_STOP=1 <<'SQL'
SET ROLE adg_owner;
DROP SCHEMA IF EXISTS adjudication CASCADE;
SQL

pg_restore \
  --exit-on-error \
  --single-transaction \
  --no-owner \
  --no-privileges \
  --role=adg_owner \
  --host="$PGHOST" \
  --port="$PGPORT" \
  --username="$PGUSER" \
  --dbname="$PGDATABASE" \
  "$RESTORE_ARCHIVE"

/bin/sh /opt/cpoly/scripts/apply-migrations.sh

psql --set=ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SET ROLE adg_owner;
REVOKE ALL ON SCHEMA adjudication FROM PUBLIC;
GRANT USAGE ON SCHEMA adjudication TO adg_runtime, adg_backup;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA adjudication TO adg_runtime;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA adjudication TO adg_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA adjudication TO adg_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA adjudication TO adg_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA adjudication TO adg_backup;
REVOKE ALL ON adjudication.schema_migrations FROM adg_runtime;
GRANT SELECT ON adjudication.schema_migrations TO adg_backup;
REVOKE ALL ON adjudication.cpoly_recovery_state FROM adg_runtime;
GRANT SELECT ON adjudication.cpoly_recovery_state TO adg_runtime, adg_backup;
COMMIT;
SQL

if [ -n "${RESTORE_COMPLETE_MARKER:-}" ]; then
  : > "$RESTORE_COMPLETE_MARKER"
fi

unset PGPASSWORD
echo "LOGICAL_RESTORE_COMPLETE database=$PGDATABASE"
