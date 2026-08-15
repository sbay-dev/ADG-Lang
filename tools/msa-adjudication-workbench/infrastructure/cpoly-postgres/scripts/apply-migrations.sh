#!/bin/sh
set -eu

: "${MIGRATIONS_DIR:=/migrations/postgresql}"
: "${PGHOST:=postgres}"
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
export PGPASSWORD
PGPASSWORD=$(cat "$password_file")

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "Migration hook is absent: $MIGRATIONS_DIR" >&2
  exit 1
fi

migration_files=$(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' | sort)
if [ -z "$migration_files" ]; then
  echo "No PostgreSQL migrations found in $MIGRATIONS_DIR" >&2
  exit 1
fi

until pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" >/dev/null 2>&1; do
  sleep 2
done

psql --set=ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SET ROLE adg_owner;
CREATE TABLE IF NOT EXISTS adjudication.schema_migrations (
  name text PRIMARY KEY,
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON adjudication.schema_migrations FROM PUBLIC;
REVOKE ALL ON adjudication.schema_migrations FROM adg_runtime;
GRANT SELECT ON adjudication.schema_migrations TO adg_backup;
COMMIT;
SQL

printf '%s\n' "$migration_files" | while IFS= read -r migration_file; do
  migration_name=$(basename "$migration_file")
  case "$migration_name" in
    [0-9][0-9][0-9][0-9]_[A-Za-z0-9._-]*.sql)
      ;;
    *)
      echo "Migration name must match NNNN_name.sql: $migration_name" >&2
      exit 1
      ;;
  esac

  migration_checksum=$(sha256sum "$migration_file" | awk '{print $1}')
  existing_checksum=$(
    psql --set=ON_ERROR_STOP=1 --quiet --tuples-only --no-align \
      --set=migration_name="$migration_name" <<'SQL'
SET ROLE adg_owner;
SELECT checksum_sha256
FROM adjudication.schema_migrations
WHERE name = :'migration_name';
SQL
  )

  if [ -n "$existing_checksum" ]; then
    if [ "$existing_checksum" != "$migration_checksum" ]; then
      echo "Applied migration checksum changed: $migration_name" >&2
      exit 1
    fi
    echo "SKIP $migration_name"
    continue
  fi

  {
    printf '%s\n' 'BEGIN;' 'SET ROLE adg_owner;'
    cat "$migration_file"
    cat <<'SQL'
REVOKE ALL ON ALL TABLES IN SCHEMA adjudication FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA adjudication FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA adjudication FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA adjudication TO adg_runtime;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA adjudication TO adg_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA adjudication TO adg_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA adjudication TO adg_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA adjudication TO adg_backup;
REVOKE ALL ON adjudication.schema_migrations FROM adg_runtime;
GRANT SELECT ON adjudication.schema_migrations TO adg_backup;
DO $$
BEGIN
  IF to_regclass('adjudication.cpoly_recovery_state') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON adjudication.cpoly_recovery_state FROM adg_runtime';
    EXECUTE 'GRANT SELECT ON adjudication.cpoly_recovery_state TO adg_runtime, adg_backup';
  END IF;
END
$$;
INSERT INTO adjudication.schema_migrations(name, checksum_sha256)
VALUES (:'migration_name', :'migration_checksum');
COMMIT;
SQL
  } | psql --set=ON_ERROR_STOP=1 \
      --set=migration_name="$migration_name" \
      --set=migration_checksum="$migration_checksum"

  echo "APPLIED $migration_name"
done

unset PGPASSWORD
