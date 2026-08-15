#!/bin/sh
set -eu

: "${POSTGRES_USER:=postgres}"

read_secret() {
  secret_path=$1
  if [ ! -s "$secret_path" ]; then
    echo "Required role secret is missing or empty: $secret_path" >&2
    exit 1
  fi
  value=$(cat "$secret_path")
  if [ "${#value}" -lt 20 ]; then
    echo "Role secret must contain at least 20 characters: $secret_path" >&2
    exit 1
  fi
  printf '%s' "$value"
}

migrator_password=$(read_secret /run/secrets/roles/adg-migrator-password)
runtime_password=$(read_secret /run/secrets/roles/adg-runtime-password)
backup_password=$(read_secret /run/secrets/roles/adg-backup-password)

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  --set=migrator_password="$migrator_password" \
  --set=runtime_password="$runtime_password" \
  --set=backup_password="$backup_password" <<'SQL'
SELECT 'CREATE ROLE adg_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'adg_owner') \gexec

SELECT 'CREATE ROLE adg_migrator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'adg_migrator') \gexec

SELECT 'CREATE ROLE adg_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'adg_runtime') \gexec

SELECT 'CREATE ROLE adg_backup LOGIN REPLICATION NOSUPERUSER NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'adg_backup') \gexec

ALTER ROLE adg_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER ROLE adg_migrator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 5 PASSWORD :'migrator_password';
ALTER ROLE adg_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 60 PASSWORD :'runtime_password';
ALTER ROLE adg_backup LOGIN REPLICATION NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 2 PASSWORD :'backup_password';

GRANT adg_owner TO adg_migrator;

ALTER ROLE adg_runtime SET statement_timeout = '15s';
ALTER ROLE adg_runtime SET lock_timeout = '5s';
ALTER ROLE adg_runtime SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE adg_runtime SET search_path = 'adjudication';
ALTER ROLE adg_migrator SET statement_timeout = '10min';
ALTER ROLE adg_migrator SET lock_timeout = '30s';
ALTER ROLE adg_migrator SET idle_in_transaction_session_timeout = '2min';

SELECT 'CREATE DATABASE adg_adjudication OWNER adg_owner ENCODING ''UTF8'' TEMPLATE template0'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'adg_adjudication') \gexec

REVOKE ALL ON DATABASE adg_adjudication FROM PUBLIC;
GRANT CONNECT ON DATABASE adg_adjudication TO adg_migrator, adg_runtime, adg_backup;
ALTER DATABASE adg_adjudication OWNER TO adg_owner;
ALTER DATABASE adg_adjudication SET timezone = 'UTC';

\connect adg_adjudication

CREATE SCHEMA IF NOT EXISTS adjudication AUTHORIZATION adg_owner;
ALTER SCHEMA adjudication OWNER TO adg_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA adjudication FROM PUBLIC;
GRANT USAGE ON SCHEMA adjudication TO adg_runtime, adg_backup;
GRANT USAGE, CREATE ON SCHEMA adjudication TO adg_owner;

ALTER DEFAULT PRIVILEGES FOR ROLE adg_owner IN SCHEMA adjudication
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE adg_owner IN SCHEMA adjudication
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO adg_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE adg_owner IN SCHEMA adjudication
  GRANT SELECT ON TABLES TO adg_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE adg_owner IN SCHEMA adjudication
  REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE adg_owner IN SCHEMA adjudication
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO adg_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE adg_owner IN SCHEMA adjudication
  GRANT SELECT ON SEQUENCES TO adg_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE adg_owner IN SCHEMA adjudication
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE adg_owner IN SCHEMA adjudication
  GRANT EXECUTE ON FUNCTIONS TO adg_runtime;
SQL

unset migrator_password runtime_password backup_password
