# Selected Cloudflare Container runtime

This variant runs PostgreSQL 16 and the minimal CPOLY database provider in one
Cloudflare Container. Only HTTP port `18444` is routed. PostgreSQL uses a Unix
socket and rejects TCP, so port 5432 is never exposed.

## Fixed instance shape

```text
class: CpolyAdgPostgresContainer
instance ID: standard-1
instance type: standard-1
max instances: 1
```

The active integration targets supplied by the user are:

```text
CPOLY Field app:     a033613d-c3cf-45d8-b1d3-2de9447d7012
CPOLY Workbench app: a03397c9-f19f-49ad-9f80-28ec719a38bb
```

This repository was not modified and no deployment was attempted against those
apps.

## Provider API

The bridge implements the exact paths consumed by the portal Worker:

```text
GET  /api/internal/postgres/v1/status
POST /api/internal/postgres/v1/query
GET  /api/internal/postgres/v1/runtime/receipt-watermark
POST /api/internal/postgres/v1/runtime/promote-generation
POST /api/internal/postgres/v1/runtime/keepalive
POST /api/internal/postgres/v1/backups/trigger
```

All require `Authorization: Bearer ...`. See
`contract/database-bridge.v1.json`.

## Startup/recovery

On empty PGDATA the container initializes PostgreSQL, bootstraps owner,
migrator, runtime, and backup roles from secret environment variables, and
applies the checked-in migration. It then:

1. calls signed Worker recovery-begin;
2. downloads the latest KV descriptor/chunks;
3. reconstructs and verifies the custom archive byte-for-byte;
4. restores and migrates;
5. calls recovery-complete/status until journal replay and receipt verification
   are ready; and
6. opens the local provider readiness gate.

No backup is fail-closed unless `CPOLY_ALLOW_FRESH_BOOTSTRAP=true` explicitly
approves a new environment.

## Backup/lifecycle

The Worker cron invokes the provider backup trigger every six hours. The
container also performs a bounded backup on SIGTERM before stopping. PGDATA is
ephemeral; only a completed KV backup plus D1 descriptor/journal/gate state is
durable recovery evidence.

KV chunk keys are immutable and versioned. Startup honors D1 `availableAfter`,
retries missing or hash-mismatched chunks with bounded backoff, and falls back
to `priorBackup` when the newest complete generation is not yet globally
readable.

## Required secrets

Configure through Cloudflare secrets, never source:

```text
CPOLY_POSTGRES_INTERNAL_TOKEN
CPOLY_BACKUP_HMAC_KEY
ADG_MIGRATOR_PASSWORD
ADG_RUNTIME_PASSWORD
ADG_BACKUP_PASSWORD
POSTGRES_SUPERUSER_PASSWORD (optional local bootstrap credential)
```

`CPOLY_BACKUP_BASE_URL` is a non-secret Worker origin setting.

## Reproduce locally

```powershell
docker build -t adg-cpoly-postgres-cloudflare:validation .\cloudflare
.\validation\smoke-cloudflare-container.ps1
```

The smoke destroys the first container/PGDATA, recreates it, restores from the
actual Worker route harness with KV-compatible object storage, verifies the
binary and database hashes, tests receipt promotion, and proves SIGTERM backup.
