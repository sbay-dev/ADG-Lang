#!/bin/sh
set -eu
umask 077

: "${PGDATA:=/var/lib/postgresql/data/pgdata}"
: "${PORT:=18444}"
: "${CPOLY_ALLOW_FRESH_BOOTSTRAP:=false}"
: "${CPOLY_BACKUP_ON_SIGTERM:=true}"

if [ "$(id -u)" -eq 0 ]; then
  install -d -m 0700 -o postgres -g postgres \
    /run/cpoly \
    /run/cpoly/secrets \
    /run/secrets \
    /run/secrets/roles \
    "$PGDATA"
  install -d -m 0775 -o postgres -g postgres /var/run/postgresql
  exec gosu postgres "$0" "$@"
fi

for name in ADG_MIGRATOR_PASSWORD ADG_RUNTIME_PASSWORD ADG_BACKUP_PASSWORD \
  CPOLY_POSTGRES_INTERNAL_TOKEN CPOLY_BACKUP_HMAC_KEY CPOLY_BACKUP_BASE_URL; do
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "Required container secret is absent: $name" >&2
    exit 1
  fi
done

mkdir -p /run/cpoly/secrets /run/secrets/roles /var/run/postgresql
chmod 0700 /run/cpoly/secrets /run/secrets/roles
printf '%s' "$ADG_MIGRATOR_PASSWORD" > /run/secrets/roles/adg-migrator-password
printf '%s' "$ADG_RUNTIME_PASSWORD" > /run/secrets/roles/adg-runtime-password
printf '%s' "$ADG_BACKUP_PASSWORD" > /run/secrets/roles/adg-backup-password
printf '%s' "${POSTGRES_SUPERUSER_PASSWORD:-unused-local-only}" \
  > /run/secrets/roles/postgres-superuser-password
printf '%s' "$CPOLY_BACKUP_HMAC_KEY" > /run/cpoly/secrets/backup-hmac-key
printf '%s' "$CPOLY_BACKUP_BASE_URL" > /run/cpoly/secrets/backup-base-url
chmod 0600 /run/cpoly/secrets/* /run/secrets/roles/*

new_cluster=false
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  new_cluster=true
  mkdir -p "$PGDATA"
  chmod 0700 "$PGDATA"
  initdb \
    --pgdata="$PGDATA" \
    --username=postgres \
    --auth-local=peer \
    --auth-host=reject \
    --data-checksums >/dev/null
fi

cat > "$PGDATA/pg_hba.conf" <<'EOF'
local all postgres peer
local adg_adjudication adg_migrator scram-sha-256
local adg_adjudication adg_runtime scram-sha-256
local adg_adjudication adg_backup scram-sha-256
local all all reject
host all all 0.0.0.0/0 reject
host all all ::/0 reject
EOF
chmod 0600 "$PGDATA/pg_hba.conf"

pg_ctl \
  --pgdata="$PGDATA" \
  --options="-c listen_addresses='' -c unix_socket_directories='/var/run/postgresql' -c password_encryption=scram-sha-256" \
  --wait start >/dev/null

bridge_pid=
stopping=false
shutdown() {
  [ "$stopping" = "false" ] || return
  stopping=true
  echo "CPOLY PostgreSQL container shutting down"
  if [ "$CPOLY_BACKUP_ON_SIGTERM" = "true" ] &&
     local_ready; then
    timeout 120 /bin/sh /opt/cpoly/bin/backup-now.sh \
      || echo "SIGTERM backup failed or timed out" >&2
  fi
  if [ -n "$bridge_pid" ]; then
    kill -TERM "$bridge_pid" 2>/dev/null || true
    wait "$bridge_pid" 2>/dev/null || true
  fi
  pg_ctl --pgdata="$PGDATA" --mode=fast --wait stop >/dev/null 2>&1 || true
  exit 0
}

apply_migrations() {
  MIGRATIONS_DIR=/opt/cpoly/migrations \
  PGHOST=/var/run/postgresql \
  PGPORT=5432 \
  PGDATABASE=adg_adjudication \
  PGUSER=adg_migrator \
  PGSSLMODE=disable \
  PGSSLROOTCERT=/dev/null \
  /bin/sh /opt/cpoly/scripts/apply-migrations.sh
}

local_ready() {
  result=$(
    psql -h /var/run/postgresql -U postgres -d adg_adjudication -Atqc \
      "SELECT CASE WHEN ready AND worker_status = 'ready' THEN 1 ELSE 0 END
         FROM adjudication.cpoly_recovery_state WHERE singleton = TRUE" \
      2>/dev/null || true
  )
  [ "$result" = "1" ]
}

recover_or_bootstrap() {
  recovery=/var/lib/postgresql/cpoly-recovery
  rm -rf "$recovery"
  mkdir -p "$recovery"
  log=$recovery/download.log
  set +e
  ADG_BACKUP_BASE_URL_FILE=/run/cpoly/secrets/backup-base-url \
  ADG_BACKUP_HMAC_KEY_FILE=/run/cpoly/secrets/backup-hmac-key \
  python3 /opt/cpoly/scripts/d1_backup_client.py download \
    --begin-recovery \
    --recovery-state "$recovery/recovery-state.json" \
    --output "$recovery/adg-adjudication.dump" \
    --manifest-output "$recovery/descriptor.json" \
    >"$log" 2>&1
  download_status=$?
  set -e

  if [ "$download_status" -ne 0 ]; then
    if [ "$CPOLY_ALLOW_FRESH_BOOTSTRAP" = "true" ] &&
       grep -Eq 'HTTP 404|No complete' "$log"; then
      psql -h /var/run/postgresql -U postgres -d adg_adjudication \
        --set=ON_ERROR_STOP=1 <<'SQL'
SET ROLE adg_owner;
UPDATE adjudication.cpoly_recovery_state
   SET ready = TRUE,
       snapshot_generation = (
         SELECT current_generation
           FROM adjudication.cpoly_runtime_state
          WHERE singleton = TRUE
       ),
       postgres_receipt_watermark = 0,
       worker_recovery_id = NULL,
       worker_status = 'ready',
       updated_at = clock_timestamp()
 WHERE singleton = TRUE;
SQL
      echo "Fresh environment explicitly approved and ready"
      rm -rf "$recovery"
      return
    fi
    cat "$log" >&2
    echo "Container recovery failed before database restore." >&2
    exit 1
  fi

  CPOLY_DESTRUCTIVE_RESTORE=RESTORE_adg_adjudication_FROM_D1 \
  BINARY_ARCHIVE="$recovery/adg-adjudication.dump" \
  MIGRATIONS_DIR=/opt/cpoly/migrations \
  PGHOST=/var/run/postgresql \
  PGPORT=5432 \
  PGDATABASE=adg_adjudication \
  PGUSER=adg_migrator \
  PGSSLMODE=disable \
  PGSSLROOTCERT=/dev/null \
  /bin/sh /opt/cpoly/scripts/restore-binary-backup.sh

  ADG_BACKUP_BASE_URL_FILE=/run/cpoly/secrets/backup-base-url \
  ADG_BACKUP_HMAC_KEY_FILE=/run/cpoly/secrets/backup-hmac-key \
  python3 /opt/cpoly/scripts/d1_backup_client.py recovery-complete \
    --recovery-state "$recovery/recovery-state.json" \
    --ready-output "$recovery/recovery-ready.tsv" \
    --timeout-seconds 3600 \
    --poll-seconds 5

  RECOVERY_READY_FILE="$recovery/recovery-ready.tsv" \
  PGHOST=/var/run/postgresql \
  PGPORT=5432 \
  PGDATABASE=adg_adjudication \
  PGUSER=adg_migrator \
  PGSSLMODE=disable \
  PGSSLROOTCERT=/dev/null \
  /bin/sh /opt/cpoly/scripts/mark-recovery-ready.sh

  rm -rf "$recovery"
  local_ready || {
    echo "Recovery completed but readiness gate remained closed." >&2
    exit 1
  }
}

main() {
  if [ "$new_cluster" = "true" ]; then
    POSTGRES_USER=postgres \
    /bin/sh /docker-entrypoint-initdb.d/10-bootstrap-roles.sh
  fi

  apply_migrations

  export PGHOST=/var/run/postgresql
  export PGDATABASE=adg_adjudication
  export PGUSER=adg_runtime
  node /opt/cpoly/bridge/server.mjs &
  bridge_pid=$!

  if local_ready; then
    echo "Existing local recovery gate is ready"
  elif [ "$new_cluster" = "true" ] ||
       [ "${CPOLY_RESUME_RECOVERY:-false}" = "true" ]; then
    recover_or_bootstrap
  else
    echo "Existing PGDATA is not ready; CPOLY_RESUME_RECOVERY=true is required." >&2
    shutdown
    exit 1
  fi

  wait "$bridge_pid"
}

trap shutdown TERM INT
main
