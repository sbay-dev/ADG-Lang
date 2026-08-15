# Remote-host CPOLY PostgreSQL

This qualified fallback variant runs only on an always-on, non-local Linux
data-plane host. It is not a workstation profile and is not the selected ADG
production runtime; the selected runtime is the stable CPOLY Cloudflare
Container.

## Prerequisites

- Linux host with Docker Engine and Docker Compose v2.
- Durable encrypted host storage for Docker's named volume.
- Public DNS name and a PostgreSQL server certificate whose SAN includes that
  name and the internal Compose name `postgres`.
- Network firewall/security group capable of allowing TCP 5432 only from
  Cloudflare's current published IP ranges.
- S3-compatible HTTPS storage and independent secret management for WAL-G.
- The checked-in operator migration `migrations/postgresql/*.sql`.

The database image is the official PostgreSQL 16 Bookworm multi-platform image:

```text
postgres:16-bookworm@sha256:60f4761b9035e0b8d5218f701a8c3382f641bf12b1604822574cf5be3baeb537
```

Registry inspection on 2026-08-14 identified it as PostgreSQL
`16.15-bookworm`. Re-resolve and review a new digest deliberately for upgrades.

## Prepare configuration

From `infrastructure/cpoly-postgres/standard` on the remote host:

```sh
install -d -m 0700 /etc/cpoly/adg-postgres/secrets
install -m 0600 deployment.env.example /etc/cpoly/adg-postgres/deployment.env
export CPOLY_SECRET_DIR=/etc/cpoly/adg-postgres/secrets
```

Populate the files listed in [secrets/README.md](secrets/README.md) from a
secret manager. Edit only the non-secret deployment settings in
`/etc/cpoly/adg-postgres/deployment.env`.

The default bind is `127.0.0.1`. Do not change it until:

1. public DNS points to the remote host;
2. the certificate SAN matches that DNS name;
3. the host/cloud firewall denies all inbound 5432 traffic except Cloudflare's
   current ranges; and
4. host hardening, monitoring, backup storage, and restore ownership are ready.

Then explicitly set `CPOLY_POSTGRES_BIND_ADDRESS=0.0.0.0` or, preferably, the
host's dedicated database IP. A public bind without the firewall is forbidden.

## Validate and start

```sh
docker compose \
  --env-file /etc/cpoly/adg-postgres/deployment.env \
  -f docker-compose.yml config --quiet

docker compose \
  --env-file /etc/cpoly/adg-postgres/deployment.env \
  -f docker-compose.yml up -d postgres

docker compose \
  --env-file /etc/cpoly/adg-postgres/deployment.env \
  -f docker-compose.yml ps
```

Apply the checked-in operator migration:

```sh
docker compose \
  --env-file /etc/cpoly/adg-postgres/deployment.env \
  -f docker-compose.yml --profile operations run --rm migrate
```

The migration runner records SHA-256 checksums and fails if an applied file was
changed. It does not duplicate portal table definitions in this package.

## Backup and restore

Run a backup from the remote host:

```sh
docker compose \
  --env-file /etc/cpoly/adg-postgres/deployment.env \
  -f docker-compose.yml --profile backup run --rm walg-backup
```

Schedule that command with the remote host's managed scheduler. Do not schedule
it on a workstation. See [../operations/BACKUP-RESTORE.md](../operations/BACKUP-RESTORE.md).

## Password rotation

Replace a role's secret file atomically, recreate the database container so the
new secret projection is present, and reconcile roles locally:

```sh
docker compose --env-file /etc/cpoly/adg-postgres/deployment.env up -d --force-recreate postgres
docker compose --env-file /etc/cpoly/adg-postgres/deployment.env \
  exec --user postgres postgres /bin/sh /docker-entrypoint-initdb.d/10-bootstrap-roles.sh
```

Update Hyperdrive with the new `adg_runtime` password, verify new connections,
then revoke/remove the old secret in the external secret manager.
