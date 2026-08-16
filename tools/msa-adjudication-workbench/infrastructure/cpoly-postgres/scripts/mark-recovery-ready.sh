#!/bin/sh
set -eu

: "${RECOVERY_READY_FILE:=/backup/recovery-ready.tsv}"
: "${PGHOST:=adg-postgres-recovery.adg-data-plane.svc.cluster.local}"
: "${PGPORT:=5432}"
: "${PGDATABASE:=adg_adjudication}"
: "${PGUSER:=adg_migrator}"
: "${PGSSLMODE:=verify-full}"
: "${PGSSLROOTCERT:=/run/secrets/tls/postgres-ca.crt}"

password_file=/run/secrets/roles/adg-migrator-password
if [ ! -s "$RECOVERY_READY_FILE" ] || [ ! -s "$password_file" ]; then
  echo "Recovery-ready evidence or migration secret is missing." >&2
  exit 1
fi

recovery_id=$(cut -f1 "$RECOVERY_READY_FILE")
target_generation=$(cut -f2 "$RECOVERY_READY_FILE")
snapshot_generation=$(cut -f3 "$RECOVERY_READY_FILE")
snapshot_watermark=$(cut -f4 "$RECOVERY_READY_FILE")
verified_receipt=$(cut -f5 "$RECOVERY_READY_FILE")
state=$(cut -f6 "$RECOVERY_READY_FILE" | tr -d '\r\n')
case "$recovery_id" in
  ????????-????-4???-[89abAB]???-????????????) ;;
  *) echo "Recovery ID is invalid." >&2; exit 1;;
esac
for value in "$target_generation" "$snapshot_generation" \
  "$snapshot_watermark" "$verified_receipt"; do
  case "$value" in ''|*[!0-9]*) echo "Recovery watermark is invalid." >&2; exit 1;; esac
done
[ "$state" = "ready" ] || {
  echo "Worker recovery state is not ready." >&2
  exit 1
}
[ "$verified_receipt" -ge "$snapshot_watermark" ] || {
  echo "Verified PostgreSQL receipt does not cover the snapshot." >&2
  exit 1
}

export PGPASSWORD
PGPASSWORD=$(cat "$password_file")
until pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" >/dev/null 2>&1; do
  sleep 2
done

postgres_coverage=$(
  psql --set=ON_ERROR_STOP=1 --quiet --tuples-only --no-align \
    --field-separator='|' <<'SQL'
SET ROLE adg_owner;
SELECT state.current_generation,
       (
         SELECT COALESCE(MAX(receipt_seq), 0)
           FROM adjudication.cpoly_write_receipts
       )
FROM adjudication.cpoly_runtime_state AS state
WHERE state.singleton = TRUE;
SQL
)
postgres_generation=${postgres_coverage%%|*}
postgres_receipt=${postgres_coverage#*|}
[ "$postgres_generation" = "$target_generation" ] || {
  echo "PostgreSQL generation does not match Worker ready generation." >&2
  exit 1
}
[ "$postgres_receipt" -ge "$verified_receipt" ] || {
  echo "PostgreSQL receipt verification is below Worker evidence." >&2
  exit 1
}

psql --set=ON_ERROR_STOP=1 \
  --set=recovery_id="$recovery_id" \
  --set=snapshot_generation="$snapshot_generation" \
  --set=snapshot_watermark="$snapshot_watermark" <<'SQL'
BEGIN;
SET ROLE adg_owner;
INSERT INTO adjudication.cpoly_recovery_state
  (singleton, ready, snapshot_generation, postgres_receipt_watermark,
   worker_recovery_id, worker_status, updated_at)
VALUES
  (TRUE, TRUE, :'snapshot_generation', :'snapshot_watermark',
   :'recovery_id', 'ready', clock_timestamp())
ON CONFLICT (singleton) DO UPDATE
SET ready = EXCLUDED.ready,
    snapshot_generation = EXCLUDED.snapshot_generation,
    postgres_receipt_watermark = EXCLUDED.postgres_receipt_watermark,
    worker_recovery_id = EXCLUDED.worker_recovery_id,
    worker_status = EXCLUDED.worker_status,
    updated_at = EXCLUDED.updated_at;
COMMIT;
SQL

unset PGPASSWORD
echo "POSTGRES_READINESS_GATE_OPEN generation=$target_generation receipt=$postgres_receipt"
