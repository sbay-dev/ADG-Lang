#!/bin/sh
set -eu

drill_volume=cpoly-adg-postgres-restore-drill
compose_env_file=${CPOLY_COMPOSE_ENV_FILE:-}

if [ ! -s "$compose_env_file" ]; then
  echo "Set CPOLY_COMPOSE_ENV_FILE to the protected deployment env file." >&2
  exit 1
fi
if docker volume inspect "$drill_volume" >/dev/null 2>&1; then
  echo "Restore drill volume already exists; inspect and remove it explicitly: $drill_volume" >&2
  exit 1
fi

run_compose() {
  docker compose --env-file "$compose_env_file" "$@"
}

cleanup() {
  run_compose --profile restore-drill stop postgres-restore-drill >/dev/null 2>&1 || true
  run_compose --profile restore-drill rm -f postgres-restore-drill >/dev/null 2>&1 || true
  docker volume rm "$drill_volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

run_compose --profile restore-drill stop postgres-restore-drill >/dev/null 2>&1 || true
run_compose --profile restore-drill rm -f postgres-restore-drill >/dev/null 2>&1 || true

run_compose --profile restore-drill run --rm walg-restore-drill
run_compose --profile restore-drill up -d postgres-restore-drill

attempt=0
until run_compose --profile restore-drill exec -T --user postgres \
  postgres-restore-drill \
  pg_isready -h /var/run/postgresql -U postgres -d adg_adjudication \
  >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo "Restore drill database did not become ready." >&2
    exit 1
  fi
  sleep 2
done

run_compose --profile restore-drill exec -T --user postgres \
  postgres-restore-drill \
  psql --set=ON_ERROR_STOP=1 -U postgres -d adg_adjudication \
  -c "SELECT current_database(), to_regnamespace('adjudication') IS NOT NULL AS schema_present;"

echo "Restore drill passed in an internal-only disposable volume."
