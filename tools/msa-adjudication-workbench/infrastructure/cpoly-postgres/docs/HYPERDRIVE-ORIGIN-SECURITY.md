# Hyperdrive PostgreSQL origin security

This document now applies only to the optional Kubernetes and remote-host
variants. The selected Cloudflare Container runtime uses the private internal
HTTP provider and does not route PostgreSQL TCP through Hyperdrive.

## Required path

Cloudflare Worker -> Hyperdrive -> PostgreSQL wire protocol/TLS -> external
CPOLY data plane.

The Worker does not call PostgresServer REST/gRPC SQL endpoints. No local API,
database, mail process, scheduler, storage, or workstation is in the production
request path. Cloudflare Tunnel is intentionally not recommended or used.

## TLS

1. Give the origin a stable public DNS name.
2. Issue a server certificate whose SAN matches that name.
3. Upload the issuing CA to Hyperdrive and select PostgreSQL
   `sslmode=verify-full`; do not use `disable`, `allow`, `prefer`, or
   certificate-unverified modes.
4. Keep PostgreSQL's minimum protocol at TLS 1.2 or higher.

Cloudflare documents CA upload and Hyperdrive creation as:

```text
npx wrangler cert upload certificate-authority --ca-cert <ca.pem> --name <ca-name>
npx wrangler hyperdrive create <name> --connection-string="<postgresql-connection-string>" --ca-certificate-id <ca-id> --sslmode verify-full
```

Supply the connection string from a protected secret channel; do not place it
in source, shell history, CI logs, or command transcripts.

## Optional client certificate

For an additional factor:

1. Sign a Hyperdrive client certificate with the CA mounted as
   `postgres-ca.crt`.
2. Set `CPOLY_REQUIRE_CLIENT_CERT=true` before initialization, or set it and
   restart to regenerate `pg_hba.conf`.
3. Upload the client pair:

```text
npx wrangler cert upload mtls-certificate --cert <client-cert.pem> --key <client-key.pem> --name <client-name>
```

4. Associate the returned mTLS certificate ID with Hyperdrive.

The resulting rule requires both a CA-valid client certificate and the
`adg_runtime` SCRAM password. Certificate private keys remain in the external
secret manager and Cloudflare certificate store, not this repository.

## Network controls

- The remote-host bind remains loopback by default. A public/dedicated bind is
  explicit and allowed only after the external firewall permits TCP 5432 from
  Cloudflare's current published IP ranges and denies all other sources.
- Kubernetes applies the same ranges to the LoadBalancer Service and
  NetworkPolicy. Re-review them before every deploy because ranges can change.
- If a provider does not preserve source IPs or enforce source ranges, deployment
  is blocked until an equivalent provider firewall/security-group control is
  proven.
- Do not expose the bootstrap, owner, migration, or backup identity publicly.
  PostgreSQL HBA permits the public application path only as `adg_runtime`.

## Identity and connection budget

- `adg_owner`: NOLOGIN object owner.
- `adg_migrator`: five connections, can explicitly assume owner for migrations.
- `adg_runtime`: 60-connection database-scoped runtime identity.
- `adg_backup`: two-connection replication identity for WAL-G.
- `postgres`: local peer bootstrap administration only; no network HBA rule.

PostgreSQL is capped at 80 connections. Configure Hyperdrive's origin
connection limit below the runtime role's 60-connection limit (for example 40)
to leave capacity for migrations, backups, probes, and incident response.
Measure before increasing any limit.

## Rotation

Rotate the runtime password in the external secret manager, reconcile the role,
update Hyperdrive, verify new sessions, and then retire the old value. Rotate
server/client certificates before expiry and verify `verify-full` after every
change. Never grant the public runtime role superuser, owner, replication,
database-creation, or role-creation privileges.
