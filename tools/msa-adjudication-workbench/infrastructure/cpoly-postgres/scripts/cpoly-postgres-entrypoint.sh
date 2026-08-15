#!/bin/sh
set -eu

: "${PGDATA:=/var/lib/postgresql/data/pgdata}"

tls_source=/run/secrets/tls
tls_target=/var/lib/postgresql/cpoly-tls

for file in postgres-server.crt postgres-server.key postgres-ca.crt; do
  if [ ! -s "$tls_source/$file" ]; then
    echo "Required TLS secret is missing or empty: $file" >&2
    exit 1
  fi
done

mkdir -p "$tls_target"
if [ "$(id -u)" = "0" ]; then
  chown postgres:postgres "$tls_target"
  chmod 0700 "$tls_target"
  install -o postgres -g postgres -m 0600 \
    "$tls_source/postgres-server.key" "$tls_target/server.key"
  install -o postgres -g postgres -m 0644 \
    "$tls_source/postgres-server.crt" "$tls_target/server.crt"
  install -o postgres -g postgres -m 0644 \
    "$tls_source/postgres-ca.crt" "$tls_target/ca.crt"
else
  install -m 0600 "$tls_source/postgres-server.key" "$tls_target/server.key"
  install -m 0644 "$tls_source/postgres-server.crt" "$tls_target/server.crt"
  install -m 0644 "$tls_source/postgres-ca.crt" "$tls_target/ca.crt"
fi

if [ -s "$PGDATA/PG_VERSION" ]; then
  /bin/sh /opt/cpoly/scripts/render-hba.sh
fi

exec /usr/local/bin/docker-entrypoint.sh "$@"
