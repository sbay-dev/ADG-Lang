#!/bin/sh
set -eu

target_volume=${CPOLY_RESTORE_TARGET_VOLUME:-}
compose_env_file=${CPOLY_COMPOSE_ENV_FILE:-}

if [ -z "$target_volume" ]; then
  echo "Set CPOLY_RESTORE_TARGET_VOLUME to a new, unused volume name." >&2
  exit 1
fi
if [ ! -s "$compose_env_file" ]; then
  echo "Set CPOLY_COMPOSE_ENV_FILE to the protected deployment env file." >&2
  exit 1
fi
case "$target_volume" in
  *[!A-Za-z0-9_.-]*|'')
    echo "Restore target contains unsupported characters." >&2
    exit 1
    ;;
esac
current_volume=${CPOLY_POSTGRES_DATA_VOLUME:-}
if [ -z "$current_volume" ]; then
  current_volume=$(sed -n 's/^CPOLY_POSTGRES_DATA_VOLUME=//p' "$compose_env_file" | tail -n 1)
fi
: "${current_volume:=cpoly-adg-postgres-data}"
if [ "$target_volume" = "$current_volume" ]; then
  echo "Restore target must not be the active production volume." >&2
  exit 1
fi
if docker volume inspect "$target_volume" >/dev/null 2>&1; then
  echo "Restore target volume already exists: $target_volume" >&2
  exit 1
fi

docker volume create "$target_volume" >/dev/null

env CPOLY_POSTGRES_DATA_VOLUME="$target_volume" \
  docker compose --env-file "$compose_env_file" \
    --profile restore run --rm walg-restore

env CPOLY_POSTGRES_DATA_VOLUME="$target_volume" \
  docker compose --env-file "$compose_env_file" \
    --profile restore run --rm --no-deps \
    --entrypoint /bin/sh postgres -c \
    'test -s /var/lib/postgresql/data/pgdata/PG_VERSION'

echo "Restore fetched and structurally verified into: $target_volume"
echo "The active volume was not changed. Run the isolated restore drill before cutover."
