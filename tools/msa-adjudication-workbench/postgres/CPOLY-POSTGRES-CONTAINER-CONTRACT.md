# CPOLY PostgreSQL container contract

This repository now fixes the **Worker-side** private contract for the
`CPOLY_POSTGRES` Cloudflare Container / Durable Object lane. The checked-in
`postgres\Dockerfile` is a **fail-closed placeholder only** so the Worker
configuration can be validated without deploying a public SQL proxy. Replace it
with the infra-owned provider image before any deployment.

## Worker bindings and secrets

- Durable Object binding: `CPOLY_POSTGRES`
- KV binding: `CPOLY_BACKUPS`
- D1 binding: `DB`
- secret: `CPOLY_POSTGRES_INTERNAL_TOKEN`
- secret: `CPOLY_BACKUP_HMAC_KEY`
- secret: `ADG_MIGRATOR_PASSWORD`
- secret: `ADG_RUNTIME_PASSWORD`
- secret: `ADG_BACKUP_PASSWORD`
- secret: `POSTGRES_SUPERUSER_PASSWORD` (optional bootstrap-only)
- secret: `CPOLY_BACKUP_MASTER_KEY` (**Worker-only D1 journal key; do not pass
  into the container env**)
- var: `CPOLY_POSTGRES_INSTANCE_ID`
- var: `CPOLY_POSTGRES_PROVIDER_PORT` (default `18444`)
- var: `CPOLY_BACKUP_BASE_URL`
- var: `CPOLY_ALLOW_FRESH_BOOTSTRAP` (optional, default `false`)
- var: `CPOLY_RESUME_RECOVERY` (optional, default `false`)

The portal deployment profile sets `CPOLY_ALLOW_FRESH_BOOTSTRAP=false` and
`CPOLY_RESUME_RECOVERY=true`. This allows a non-ready ephemeral container disk
to re-enter the signed restore protocol after a restart without permitting a
blank production bootstrap.

The Worker passes only these container env keys today:

- `CPOLY_POSTGRES_INSTANCE_ID`
- `CPOLY_POSTGRES_PROVIDER_PORT`
- `CPOLY_POSTGRES_INTERNAL_TOKEN`
- `CPOLY_BACKUP_HMAC_KEY`
- `CPOLY_BACKUP_BASE_URL`
- `ADG_MIGRATOR_PASSWORD`
- `ADG_RUNTIME_PASSWORD`
- `ADG_BACKUP_PASSWORD`
- `POSTGRES_SUPERUSER_PASSWORD`
- `CPOLY_ALLOW_FRESH_BOOTSTRAP`
- `CPOLY_RESUME_RECOVERY`
- `CPOLY_BACKUP_RETENTION_HOURS`
- `CPOLY_BACKUP_MAX_CHUNK_BYTES`
- `CPOLY_BACKUP_MAX_BACKUP_BYTES`
- `CPOLY_BACKUP_MAX_CHUNKS`

## Private provider endpoints

All requests are private Durable Object fetches with:

```text
Authorization: Bearer ${CPOLY_POSTGRES_INTERNAL_TOKEN}
```

Only these paths are allowed:

- `GET /api/internal/postgres/v1/status`
- `POST /api/internal/postgres/v1/query`
- `GET /api/internal/postgres/v1/runtime/receipt-watermark`
- `POST /api/internal/postgres/v1/runtime/promote-generation`
- `POST /api/internal/postgres/v1/runtime/keepalive`
- `POST /api/internal/postgres/v1/backups/trigger`

## Status

Request:

```http
GET /api/internal/postgres/v1/status
```

Response:

```json
{
  "ok": true,
  "schema": "adg.cpoly-postgres.status.v1",
  "status": {
    "instanceId": "cpoly-adg-postgres-production",
    "state": "starting | restoring | ready | error",
    "ready": true,
    "currentGeneration": 7,
    "receiptWatermark": 4123,
    "restoreBackupId": null,
    "restoreSnapshotGeneration": null,
    "restoreSnapshotWatermark": null,
    "lastBackupId": null,
    "backupInProgress": false,
    "lastError": null
  }
}
```

`ready=false` must keep the Worker dynamic API and cron side effects gated.

## Execute/query

Request:

```json
{
  "schema": "adg.cpoly-postgres.execute.v1",
  "requestId": "uuid-or-null",
  "payloadHash": "hex64-or-null",
  "operationKind": "read | run | batch",
  "statementCount": 1,
  "transaction": true,
  "expectedGeneration": 7,
  "operations": [
    {
      "mode": "all | run",
      "sql": "already translated PostgreSQL SQL with $1 placeholders",
      "params": ["json-safe params"]
    }
  ]
}
```

Worker expectations:

- SQL already arrives translated from the Worker's SQLite/D1 dialect.
- `INSERT OR IGNORE` is already rewritten to `ON CONFLICT DO NOTHING`.
- `requestId` and `payloadHash` are present for Worker-journaled writes.
- `expectedGeneration` is set only for recovery replay / generation-locked
  writes.

Parameter envelopes reserved by the Worker:

```json
{ "__adgType": "bigint", "value": "9223372036854775807" }
{ "__adgType": "bytes-base64", "value": "AAEC" }
```

Response:

```json
{
  "ok": true,
  "schema": "adg.cpoly-postgres.execute.v1",
  "requestId": "uuid-or-null",
  "results": [
    {
      "success": true,
      "results": [{ "column": "value" }],
      "meta": { "changes": 0 }
    }
  ],
  "receipt": {
    "generation": 7,
    "receiptSeq": 4123
  }
}
```

For mutating statements, `results[*].meta.last_row_id` must be present (use `0`
when unused). Receipt conflicts should return HTTP `409` with
`error.code = "write_receipt_conflict"`.

## Receipt watermark

Request:

```http
GET /api/internal/postgres/v1/runtime/receipt-watermark
```

Response:

```json
{
  "ok": true,
  "schema": "adg.cpoly-postgres.receipt-watermark.v1",
  "receipt": {
    "generation": 7,
    "receiptSeq": 4123
  }
}
```

## Promote generation

Request:

```json
{
  "schema": "adg.cpoly-postgres.promote-generation.v1",
  "snapshotCoverage": {
    "generation": 7,
    "watermark": 4123
  },
  "targetGeneration": 8
}
```

Response:

```json
{
  "ok": true,
  "schema": "adg.cpoly-postgres.promote-generation.v1",
  "receipt": {
    "generation": 8,
    "receiptSeq": 4123
  }
}
```

## Keepalive

Request:

```json
{
  "schema": "adg.cpoly-postgres.keepalive.v1",
  "reason": "scheduled",
  "requestedAt": 1760000000000
}
```

Response immediately reuses the same `status` object as `GET /status`.
Keepalive must not wait for recovery completion because the signed completion
callback re-enters the same Durable Object for generation promotion and
journal replay.

## Backup trigger

Request:

```json
{
  "schema": "adg.cpoly-postgres.backup-trigger.v1",
  "reason": "scheduled",
  "workerOrigin": "https://adg.sbay.sa",
  "backupApiBaseUrl": "https://adg.sbay.sa/api/internal/cpoly-backups",
  "requestedAt": 1760000000000
}
```

Response:

```json
{
  "accepted": true,
  "schema": "adg.cpoly-postgres.backup-trigger.v1",
  "status": { "...": "same shape as /status" },
  "backup": {
    "state": "queued | running | skipped",
    "reason": "scheduled",
    "backupId": null
  }
}
```

The backup client must still use the existing Worker backup API contract:

- `POST /api/internal/cpoly-backups`
- `PUT /api/internal/cpoly-backups/{backupId}/chunks/{index}`
- `POST /api/internal/cpoly-backups/{backupId}/complete`
- `GET /api/internal/cpoly-backups/latest`
- `GET /api/internal/cpoly-backups/{backupId}/chunks/{index}`

with `x-adg-timestamp`, `x-adg-nonce`, `x-adg-content-sha256`,
`x-adg-signature`, and canonical text:

```text
METHOD
PATH
TIMESTAMP
NONCE
BODY_HASH
```

## Claim boundary

The Worker now claims only this bounded recovery scope:

- accepted writes are journaled in D1 before PostgreSQL mutation;
- verified PostgreSQL custom-format dumps are chunked into private KV;
- restore readiness is blocked until the restored snapshot watermark and journal
  replay generation match, except that a deterministic integrity-constraint
  rejection with no committed transaction or matching receipt is retained as
  a nonblocking `failed/terminal_rejected` audit row; and
- this does **not** claim zero loss under simultaneous Cloudflare D1 and
  CPOLY container failure.
