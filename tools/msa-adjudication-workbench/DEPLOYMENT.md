# ADS deployment

Canonical target: `https://adg.sbay.sa`

Legacy target: `https://ads.sbay.sa` (HTTP 308 redirect)

## Azure resources

- Resource group: `rg-adg-adjudication-production`
- Key Vault: `kv-adg-ads-sbay-2026`
- Storage account: `stadgadsprod2026`
- Containers:
  - `adg-participant-identities`
  - `adg-submissions-pending`
  - `adg-submissions-processed`

Key Vault secrets:

- `adg-identities-write-sas`
- `adg-submissions-write-sas`
- `adg-github-submission-hmac`
- `adg-repository-receipt-hmac`
- `adg-email-verification-hmac`
- `adg-entitycrypt-master-key-v1`
- `adg-entra-client-secret`

The submission SAS must be container-scoped, HTTPS-only, and create/write-only.
The identity SAS also requires delete permission so approved erasure requests
can remove private identity blobs after the retention gate. Both SAS values
must be rotated. The submission HMAC authenticates public envelopes imported
by GitHub Actions. The repository-receipt HMAC is separate and authenticates
merge receipts returned from GitHub to the Worker.
EntityCrypt key encrypts identity with the randomized Matryoshka
AES-256-GCM profile before Blob Storage receives it.
The email-verification HMAC key produces non-reversible address, requester,
and one-time-code fingerprints; plaintext codes and email addresses are not
stored in D1. Treat this key as a stable identity-index key: rotation requires
an explicit reindex of encrypted account email addresses before cutover.
The Entra secret is the existing SarmadAi single-tenant application's client
secret, imported from the protected server secret store without entering
source control or Worker variables.

## Cloudflare-primary runtime

Production now prefers Cloudflare-native bindings and keeps D1/Azure only as
explicit rollback paths:

- primary container binding: `CPOLY_POSTGRES`
- container vars/secrets:
  `CPOLY_POSTGRES_INSTANCE_ID`, `CPOLY_POSTGRES_PROVIDER_PORT`,
  `CPOLY_POSTGRES_INTERNAL_TOKEN`, `CPOLY_BACKUP_BASE_URL`,
  `ADG_MIGRATOR_PASSWORD`, `ADG_RUNTIME_PASSWORD`, `ADG_BACKUP_PASSWORD`,
  optional `POSTGRES_SUPERUSER_PASSWORD`,
  optional `CPOLY_ALLOW_FRESH_BOOTSTRAP`, optional
  `CPOLY_RESUME_RECOVERY`
- optional Hyperdrive rollback: `HYPERDRIVE`
- D1: `DB` (rollback lane plus the required CPOLY recovery store while
  PostgreSQL writes are journal-protected)
- private CPOLY backup KV: `CPOLY_BACKUPS`
- R2 buckets: `SUBMISSION_OBJECTS`, `IDENTITY_OBJECTS`
- archive mode selector: `EVIDENCE_ARCHIVE_MODE=d1|r2|azure`
- D1 Time Travel boundary: `D1_TIME_TRAVEL_RETENTION_DAYS`
- Microsoft Graph mail vars/secrets:
  `MAILER_TENANT_ID`, `MAILER_CLIENT_ID`, `MAILER_CLIENT_SECRET`,
  `MAILER_SENDER_ADDRESS`
- private CPOLY recovery secrets:
  `CPOLY_BACKUP_HMAC_KEY`, `CPOLY_BACKUP_MASTER_KEY`
- private CPOLY KV propagation delay:
  `CPOLY_BACKUP_KV_PROPAGATION_DELAY_MS`
- direct Worker secret values that satisfy the existing name indirection:
  `ENTITYCRYPT_MASTER_KEY`, `SUBMISSION_HMAC_KEY`,
  `REPOSITORY_RECEIPT_HMAC_KEY`, `EMAIL_VERIFICATION_HMAC_KEY`,
  `ENTRA_CLIENT_SECRET`, `TURNSTILE_SECRET`

Set `EVIDENCE_ARCHIVE_MODE=d1` until Cloudflare dashboard activation completes
and R2 is available. In `d1` mode, the authoritative
`evidence_outbox.public_payload_json` plus encrypted
`evidence_outbox.identity_payload_json` fields are the durable archive,
repository `portal-api` imports continue directly from D1, and retention-based
erasure removes the retained identity payload from the active store without
requiring external blob deletes. Cloudflare D1 Time Travel may still retain
recoverable historical snapshots until
`D1_TIME_TRAVEL_RETENTION_DAYS` elapses after the actual deletion run; the
completion record therefore means active-store deletion, not an immediate
physical purge from provider backups.

After R2 activation, `EVIDENCE_ARCHIVE_MODE=r2` is the preferred upgrade.
`SUBMISSION_OBJECTS` then stores only the public JSON evidence envelopes and
`IDENTITY_OBJECTS` stores only the existing EntityCrypt identity envelopes for
the identity-erasure delete path. Keep both buckets private; the Worker
accesses them through bindings and no public bucket access is required. The
only other explicit archive mode is `azure` for rollback.

When `CPOLY_POSTGRES` is bound, the Worker wraps the private container provider
with the same D1-style `prepare().bind().first/all/run` and `batch()` interface
used by the existing portal logic. The provider is contacted only through the
`CPOLY_POSTGRES` Durable Object binding with
`CPOLY_POSTGRES_INTERNAL_TOKEN`; the Worker never exposes a public SQL proxy.
`postgres\CPOLY-POSTGRES-CONTAINER-CONTRACT.md` fixes the exact private
provider contract. Production and staging configs bind
`infrastructure\cpoly-postgres\cloudflare\Dockerfile`; the checked-in
`postgres\Dockerfile` remains a fail-closed contract fixture only.

If `CPOLY_POSTGRES` is absent, optional `HYPERDRIVE` remains the rollback lane
for a remote TLS PostgreSQL origin. If both `CPOLY_POSTGRES` and `HYPERDRIVE`
are absent, the Worker stays on native D1. Keep the `DB` binding even after
PostgreSQL cutover because writes fail closed if the D1 recovery journal is
unavailable.

To apply the checked-in PostgreSQL schema to a trusted operator connection
string or Hyperdrive origin database, run:

```powershell
$env:POSTGRES_CONNECTION_STRING = "postgres://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require"
npm run postgres:schema
```

The idempotent schema file is `postgres\0001_portal_v15.sql`.

## Private CPOLY recovery lane

The Worker now uses D1 as a bounded private recovery lane around the CPOLY
container provider and any Hyperdrive rollback lane:

- mutating PostgreSQL `run()` and `batch()` calls are AES-GCM journaled into
  D1 first with `CPOLY_BACKUP_MASTER_KEY` and replayed under
  `postgres\0001_portal_v15.sql`'s `cpoly_write_receipts` table;
- scheduled cron maintenance replays pending or ambiguous journal rows, prunes
  expired signed nonces, and removes old encrypted journal rows only after the
  applicable recovery window; and
- a separate private dump API accepts the QdrantServer-style backup manifest
  plus chunked immutable backup uploads in the private `CPOLY_BACKUPS` KV
  namespace for the CPOLY container backup/restore path. D1 stores only the
  descriptor, per-chunk key/hash/length metadata, signed nonces, and recovery
  state. The default lane is a PostgreSQL custom-format binary dump with
  manifest attestations proving protected columns remain EntityCrypt
  ciphertext and role-password/bootstrap material is excluded from the dump.
  Legacy OpenPGP/GPG uploads remain optional compatibility only. The D1 write
  journal remains separately AES-GCM-wrapped by `CPOLY_BACKUP_MASTER_KEY`.

Required secrets:

- `CPOLY_BACKUP_HMAC_KEY`
- `CPOLY_BACKUP_MASTER_KEY`

`CPOLY_BACKUP_MASTER_KEY` is the dedicated D1 write-journal recovery key. Do
**not** reuse `ENTITYCRYPT_MASTER_KEY` or any mail/HMAC secret for it.

Optional non-secret bounds:

- `CPOLY_BACKUP_RETENTION_HOURS`
- `CPOLY_BACKUP_MAX_CHUNK_BYTES`
- `CPOLY_BACKUP_MAX_BACKUP_BYTES`
- `CPOLY_BACKUP_MAX_CHUNKS`
- `CPOLY_BACKUP_MAX_RETAINED_BACKUPS`
- `CPOLY_BACKUP_MAX_RETAINED_BYTES`
- `CPOLY_BACKUP_STALE_UPLOAD_HOURS`
- `CPOLY_BACKUP_RESTORE_LEASE_MS`
- `CPOLY_BACKUP_KV_PROPAGATION_DELAY_MS`
- `CPOLY_NONCE_PRUNE_LIMIT`
- `CPOLY_JOURNAL_REPLAY_LIMIT`
- `CPOLY_JOURNAL_CLEANUP_LIMIT`
- `CPOLY_RECOVERY_LEASE_MS`
- `CPOLY_JOURNAL_MAX_CIPHERTEXT_BYTES`

Private internal Worker routes reserved for CPOLY automation:

- `POST /api/internal/cpoly-backups`
- `PUT /api/internal/cpoly-backups/{backupId}/chunks/{index}`
- `POST /api/internal/cpoly-backups/{backupId}/complete`
- `GET /api/internal/cpoly-backups/latest`
- `GET /api/internal/cpoly-backups/{backupId}/chunks/{index}`
- `POST /api/internal/cpoly-recovery/begin`
- `GET /api/internal/cpoly-recovery/status`
- `POST /api/internal/cpoly-recovery/complete`

All calls must include:

- `x-adg-timestamp` (Unix ms)
- `x-adg-nonce` (UUID)
- `x-adg-content-sha256` (lowercase SHA-256 hex of the raw body)
- `x-adg-signature` (lowercase HMAC-SHA256 hex)

Canonical text:

```text
METHOD
PATH
TIMESTAMP
NONCE
BODY_HASH
```

`POST /api/internal/cpoly-backups` accepts the semantic equivalent of the
QdrantServer backup contract under `schema: adg.cpoly-postgres.backup.v1`: a
checked backup metadata document (`schema: cpoly_postgres_backup_v1`) carrying
the exact PostgreSQL `snapshotGeneration` and `postgresReceiptWatermark`, plus
archive metadata and contiguous chunk descriptors for the immutable backup
binary stored in `CPOLY_BACKUPS`. For the default KV lane the manifest must
include:

- `attestations.schema = adg.cpoly-postgres.backup-attestations.v1`
- `attestations.protected_columns_entitycrypt = true`
- `attestations.role_password_material_excluded = true`
- `attestations.bootstrap_roles_separate = true`

The Worker preserves the manifest's size/SHA-256/restore evidence fields and
the exact default claim boundary:

```text
This proves creation, integrity, EntityCrypt protected-column attestations, separate role bootstrap handling, and the requested restore test only. Off-host replication and recovery-time objectives require separate scheduled operations.
```

Chunk uploads use raw `application/octet-stream` bodies and must match the
declared size/hash metadata. Each immutable chunk is stored under a versioned
`backupId/index/uuid` KV key. `POST .../complete` uses the same
`adg.cpoly-postgres.backup.v1` schema with optional `descriptorSha256`,
`metadataSha256`, `chunkCount`, `totalBytes`, and `sha256` cross-checks. It
verifies D1 metadata against KV one chunk at a time and confirms the final
archive SHA-256 before publishing `latest`. `GET /latest` returns
descriptor/manifest metadata only plus `availableAfter` for the newest
generation and optional `priorBackup` metadata when an older verified
generation is still retained; clients fetch chunks individually via
`GET /api/internal/cpoly-backups/{backupId}/chunks/{index}`, which streams the
exact KV binary with no JSON/base64 conversion, and clients must verify every
chunk plus the final archive SHA-256 themselves. Restore clients must retry
missing or hash-mismatched chunks with bounded backoff and fall back to
`priorBackup` instead of restoring a partial newest generation while KV
propagation is still converging. Failed/incomplete backups
remain invalid in D1 and trigger best-effort KV cleanup. Legacy OpenPGP/GPG
claim boundaries and encryption metadata remain accepted only for compatibility
with existing restore tooling. `POST /api/internal/cpoly-recovery/begin`
starts a signed recovery generation, `GET /api/internal/cpoly-recovery/status`
reports `ready|recovering`, and `POST /api/internal/cpoly-recovery/complete`
verifies the restored PostgreSQL snapshot watermark, replays the D1 journal to
exhaustion under the same request IDs, promotes the next generation, and only
then returns the lane to `ready`. While recovery is active, or while the
private container provider reports `starting` or `restoring`, the Worker blocks
normal dynamic API traffic and cron side effects. The scheduled handler only
pings the container and, when ready, triggers a bounded backup.

Bounded claim: the encrypted D1 journal plus periodic KV-backed backup dump
protects accepted writes and supports point-in-time rebuild. It does **not**
justify a zero-loss promise under simultaneous Cloudflare D1 and CPOLY
container failure. Optional WAL-G or R2 archival remains a second copy when R2
activation is available.

To replay a Wrangler D1 export into that PostgreSQL target, run:

```powershell
npm run postgres:migrate:d1-export -- --source .\path\to\wrangler-d1-export.sql
npm run postgres:migrate:d1-export -- --source .\path\to\wrangler-d1-export.sql --apply
```

Dry-run is the default and emits only a JSON reconciliation report.
`--apply` imports each source application table in its own transaction,
preserves source table/column/value shape for shared tables, uses
parameterized inserts with `ON CONFLICT DO NOTHING` replay protection where the
source table has a primary key or unique index, excludes the D1-only CPOLY
recovery tables, validates per-table count/hash parity after import, stages the
Wrangler export in a plaintext project-local SQLite file under
`.migration-work\`, deletes that staging file on ordinary success/failure
paths, and never logs row contents or secrets. If the process is interrupted,
remove any leftover `.migration-work\*.sqlite` file manually.

For repository imports, `.github\workflows\import-msa-adjudication.yml`
supports `ADG_PORTAL_IMPORT_SOURCE=portal-api` with
`ADG_PORTAL_EVIDENCE_URL=https://adg.sbay.sa/api/repository/evidence/claim`.
That is the Cloudflare-primary import path: it returns only the already-
sanitized public evidence payload from the portal's authoritative DB/outbox
state under the existing repository HMAC secret with bounded timestamp/nonce
replay checks, and it does not require local storage access. Identity payloads
are never returned on that path. Keep the Azure Blob configuration in place
only as the rollback path until cutover import, receipt, export, hash, and
restore verification all succeed.

## Cloudflare D1

Create separate production and staging databases and bind each as `DB`.
Apply all migrations before deploying:

```powershell
npx wrangler d1 migrations apply DB --remote
```

D1 contains Passkey public credentials, hashed opaque sessions, encrypted
profiles and drafts, non-sensitive completion counters, submission receipts,
encrypted short-lived OIDC state, versioned consensus rounds, appeals,
moderation decisions, repository receipts, and append-only state events.

## Cloudflare Worker secrets

```powershell
npx wrangler secret put ENTITYCRYPT_MASTER_KEY
npx wrangler secret put SUBMISSION_HMAC_KEY
npx wrangler secret put REPOSITORY_RECEIPT_HMAC_KEY
npx wrangler secret put EMAIL_VERIFICATION_HMAC_KEY
npx wrangler secret put ENTRA_CLIENT_SECRET
npx wrangler secret put MAILER_CLIENT_SECRET
npx wrangler secret put AZURE_CLIENT_SECRET
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put CPOLY_POSTGRES_INTERNAL_TOKEN
```

`TURNSTILE_SITE_KEY`, `MAILER_TENANT_ID`, `MAILER_CLIENT_ID`,
`MAILER_SENDER_ADDRESS`, and the R2 binding names may be ordinary Worker
configuration. `AZURE_CLIENT_SECRET` remains rollback-only. `CPOLY_BACKUP_*`
secrets plus `CPOLY_POSTGRES_INTERNAL_TOKEN` are private internal recovery
credentials and must not be exposed via public config or committed `.dev.vars`.

Set `EMAIL_VERIFICATION_ENABLED=true` only after one of these complete delivery
paths exists:

1. Cloudflare-primary Microsoft Graph mailer:
   `MAILER_TENANT_ID`, `MAILER_CLIENT_ID`, `MAILER_CLIENT_SECRET`,
   `MAILER_SENDER_ADDRESS`, plus the direct `EMAIL_VERIFICATION_HMAC_KEY`; or
2. Azure ACS rollback with its existing sender and Key Vault secret path.

Registration and email changes fail closed when verification is not
configured. Discussion/governance notification sending likewise stays disabled
unless mail transport and `ENTITYCRYPT_MASTER_KEY` resolution are complete.

Set `IDENTITY_RETENTION_DAYS` to the approved retention period. The default
is `365`; erasure never runs while a linked consensus task remains active.

Entra ordinary variables:

- `ENTRA_TENANT_ID`
- `ENTRA_CLIENT_ID`
- `ENTRA_CLIENT_SECRET_NAME=adg-entra-client-secret`

The Entra application must include this Web redirect URI:

`https://adg.sbay.sa/signin-microsoft`

The Turnstile widget hostname allowlist must contain `adg.sbay.sa`.

It requires delegated `User.Read` and the existing application permission
`RoleManagement.Read.Directory` with tenant-admin consent. The administrative
dashboard accepts only the built-in Global Administrator role template
`62e90394-69f5-4237-9190-012177145e10`.

## GitHub Actions variables

- `ADG_AZURE_CLIENT_ID`
- `ADG_AZURE_TENANT_ID`
- `ADG_AZURE_SUBSCRIPTION_ID`
- `ADG_AZURE_STORAGE_ACCOUNT`
- `ADG_AZURE_KEY_VAULT`
- `ADG_PORTAL_RECEIPT_URL`
- `ADG_PORTAL_IMPORT_SOURCE` (`portal-api` default, `azure-blob` rollback only)
- `ADG_PORTAL_EVIDENCE_URL` (required for `portal-api`)

The Azure application must have a federated credential for
`repo:sbay-dev/ADG-Lang:environment:msa-adjudication-production`.
The workflow identity needs Blob read/write access to the public evidence
containers and Key Vault read access to both HMAC secrets. The repository
environment should set `ADG_PORTAL_RECEIPT_URL` to
`https://adg.sbay.sa/api/repository/receipts`.

When `ADG_PORTAL_IMPORT_SOURCE=portal-api`, the workflow claims evidence from
`ADG_PORTAL_EVIDENCE_URL` instead of Azure Blob. That is the Cloudflare-primary
path: it returns only the already-sanitized public evidence payload from the
portal's authoritative DB/outbox state, authenticated with the existing
repository HMAC secret plus bounded timestamp/nonce replay checks, and it does
not require local storage access. Identity payloads are never returned on that
path. Keep the Azure Blob configuration in place only as the rollback path
until cutover import, receipt, export, hash, and restore verification all
succeed.

Merged task-state records update a GitHub issue with
`adjudication:state/*` labels. Only an approved-state merge produces the
repository receipt that can satisfy the publication gate.

## Deploy

```powershell
Set-Location tools\msa-adjudication-workbench
npm ci
npm run check
npm test
npx wrangler deploy
```

Keep `SUBMISSION_ENABLED=false` until Turnstile production validation, the
custom domain, the GitHub import workflow, and the chosen rollback path are all
verified. Do not remove D1/Azure rollback settings until a real remote
PostgreSQL provider image plus any chosen Hyperdrive rollback binding have
passed import, receipt, export, hash, and restore verification end to end.
