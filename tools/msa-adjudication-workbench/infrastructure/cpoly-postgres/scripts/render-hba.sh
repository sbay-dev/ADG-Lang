#!/bin/sh
set -eu

: "${PGDATA:=/var/lib/postgresql/data/pgdata}"

client_certificate=
case "${CPOLY_REQUIRE_CLIENT_CERT:-false}" in
  true)
    client_certificate=" clientcert=verify-ca"
    ;;
  false)
    ;;
  *)
    echo "CPOLY_REQUIRE_CLIENT_CERT must be true or false." >&2
    exit 1
    ;;
esac

cat > "$PGDATA/pg_hba.conf" <<EOF
# Local administration is available only to the postgres OS account.
local   all                 postgres                                peer
local   all                 all                                     reject

# Plaintext TCP is always rejected.
hostnossl all               all                 0.0.0.0/0           reject
hostnossl all               all                 ::/0                reject

# Hyperdrive runtime identity; optional client-certificate verification is
# additive to SCRAM and is controlled at initialization/restart.
hostssl adg_adjudication    adg_runtime         0.0.0.0/0           scram-sha-256${client_certificate}
hostssl adg_adjudication    adg_runtime         ::/0                scram-sha-256${client_certificate}

# Migration and physical-backup identities are non-admin and independently
# scoped. Network firewalls/NetworkPolicy provide the source restriction.
hostssl adg_adjudication    adg_migrator        0.0.0.0/0           scram-sha-256
hostssl adg_adjudication    adg_migrator        ::/0                scram-sha-256
hostssl all                 adg_backup          0.0.0.0/0           scram-sha-256
hostssl all                 adg_backup          ::/0                scram-sha-256
hostssl replication        adg_backup          0.0.0.0/0           scram-sha-256
hostssl replication        adg_backup          ::/0                scram-sha-256

# No public network login exists for the bootstrap/owner roles or other roles.
hostssl all                 all                 0.0.0.0/0           reject
hostssl all                 all                 ::/0                reject
EOF

chmod 0600 "$PGDATA/pg_hba.conf"

if [ -s "$PGDATA/postmaster.pid" ] && [ "$(id -u)" != "0" ]; then
  pg_ctl reload -D "$PGDATA"
fi
