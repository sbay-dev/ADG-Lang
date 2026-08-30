# Arabic Adjudication Studio (ADS)

`adg.sbay.sa` is the Arabic-first human adjudication portal for ADG-Lang. It is
designed for experienced Arabic teachers who should not need GitHub, JSON, or
command-line knowledge.

The reviewer interface uses an accessible, GitHub-flavored design with
right-to-left Arabic, light and dark themes, and professional official-register
copy, while keeping the flow simple enough to finish in one pass. For a
plain-language public disclosure of how the platform works, what data it
collects, how it is protected, and its claim boundaries, see
[`TRANSPARENCY.md`](TRANSPARENCY.md).

The previous `ads.sbay.sa` address redirects to the canonical domain so old
invitations remain usable. The public page includes ready-made WhatsApp and
X/Twitter invitation actions.

## User workflow

1. Read the Arabic criteria and parser summary.
2. Record private contact details and consent.
3. Verify the email address with a one-time code sent to the reviewer's inbox
   before continuing.
4. Register a discoverable Passkey. The verified email owns the account, and
   the same account may hold multiple Passkeys for different devices,
   fingerprints, platform authenticators, or security keys.
5. Read the worked example, then start with the pinned PILOT baseline in the
   authenticated task inbox. It exercises save and submission without entering
   scientific consensus.
6. Claim an open task or an email-bound assignment. The portal fixes the role
   and loads the repository packet automatically; J1 receives stored A/B
   evidence and J2 receives the stored J1 package without exchanging files.
7. Complete the guided linguistic decisions. Encrypted drafts are saved
   manually, before navigation, on page exit, and after edits. Changed server
   drafts preserve the previous encrypted revision, while a same-browser
   recovery copy protects work during a temporary network failure.
8. Submit through the protected API. JSON files remain a hidden
   disaster-recovery option for A, J1, and J2 rather than the ordinary reviewer
   workflow; imported attestations are never trusted.
9. After submitting, inspect pseudonymous prior results, discuss bound
   evidence, follow the consensus state, and appeal a provisional result
   within its 14-day window.
10. Report a portal defect from the persistent Arabic report button. The
    authenticated channel queues only bounded technical text and safe context;
    GitHub Actions creates the public issue with a short-lived repository token.

### Assisted operational test

The authenticated task inbox now pins the operational PILOT as the primary
baseline for every reviewer. Operators can still filter the inbox to that lane
alone by opening:

```text
https://adg.sbay.sa/?mode=operational-test
```

The blind pilot packet is published under
`human-evidence/tasks/*.task.json` with `lane: operational-test`. The ordinary
task query includes it first with an explicit baseline marker; the URL above
remains a compatibility/filtering route. A
CODEOWNERS-protected GitHub workflow validates the packet schema, prohibited
fields, path, and Merkle root before sending a timestamped HMAC-signed catalog
to the portal. The completed local annotation export is never committed.

The lane publishes `Independent: No`, `Blind: No`, and `Authentic: Yes`, uses
the normal signed GitHub evidence queue, and renders a clearly labelled result.
Its claims are stored separately from consensus participation, so it does not
occupy A/B/J1/J2 or change consensus state. Each account may run it once per
pilot packet.

The task inbox also publishes
`human-evidence/tasks/natural-arabic-rule-consumption-v1.task.json` as an open
standard task. Its sanitized packet contains seven authored sentences and 76
tokens. It contains neither the sealed coverage key nor parser predictions and
routes independent A/B submissions to J1 and then J2. Because the material is
developer-visible, its result is useful for rule-transfer adjudication but is
not a final unseen holdout claim.

### Direct GitHub issue reporting

- Authenticated reviewers can submit a bounded Arabic defect report without a
  GitHub account. The browser sends only category, summary, description,
  optional reproduction steps, portal version, wizard step, and public task
  identity/lane.
- The Worker rejects identity/contact data, URLs, active markup, credential-like
  strings, unknown fields, and over-limit reports. It applies per-account hourly
  and daily limits and stores the account link only in the private database.
- `.github/workflows/publish-portal-issue-reports.yml` claims reports through a
  timestamped HMAC envelope, creates or reuses a GitHub Issue carrying a hidden
  report marker, and returns a signed receipt. A failed receipt therefore does
  not create a duplicate Issue on retry.
- The public Issue never receives the user ID, profile, email, draft, or
  linguistic decisions. Identity erasure removes the private account link while
  preserving the already-public technical Issue.
- `.github/ISSUE_TEMPLATE/portal-reviewer-report.yml` is the fallback when a
  login failure prevents use of the in-portal channel. Security vulnerabilities
  remain private reports to `team@sbay.sa`.

### Repository task delivery

- `human-evidence/tasks/` is the public packet source; packet identities are
  immutable once bound to a Merkle root and first Git commit. Metadata and
  routing are pinned too; only one-way withdrawal is permitted.
- `.github/workflows/sync-msa-adjudication-tasks.yml` validates and signs the
  repository-to-portal catalog. No reviewer email is stored in a task manifest.
- Administrators may assign A/B/J1/J2 by verified email. The database stores a
  one-way email fingerprint plus EntityCrypt ciphertext; public evidence never
  receives the address.
- A verified email maps to one account. Re-verifying that address recovers the
  existing account and adds another Passkey instead of creating a second
  identity; authenticated reviewers can also add a Passkey directly.
- Claiming is atomic. A single account cannot occupy two roles in the same
  holdout family.
- Once both A and B submit, disagreement is routed in the same round to J1
  rather than silently opening a second independent round.

The separate `/admin/` progress dashboard uses Microsoft Entra only. It is
not part of participant registration and fails closed unless the signed-in
organization member has authoritative Global Administrator proof.

## Security and privacy boundary

- Parser predictions are never displayed.
- Packet and submission roots are recomputed in the browser and in .NET.
- Azure stores identity separately from linguistic evidence.
- Optional social usernames, including the WhatsApp username rather than a
  phone number, remain encrypted with the private identity record.
- GitHub receives only a pseudonymous, HMAC-signed envelope.
- The authoritative state machine requires four distinct accounts
  (`A`, `B`, `J1`, `J2`), measures independent agreement before discussion,
  preserves every superseded round, and never treats GitHub as its state
  database.
- A and B public envelopes remain in a held outbox until both independent
  submissions are fixed. An incomplete round cancels those envelopes instead
  of exposing a one-sided answer.
- `approved` is provisional. `published` requires both expiry of the
  14-day appeal window and an HMAC-authenticated receipt proving that the
  bound task-state evidence was merged into the repository.
- Public task-state records contain versioned task bindings only. The importer
  accepts the historical `evidence.identity` name solely when its exact field
  set and values match that public binding; any extra identity/contact field
  remains rejected. New records use `taskBinding`.
- Every merged non-final task-state event returns a distinct HMAC receipt that
  stops queue replay without claiming publication. `approved` still requires
  the stricter final-result receipt before repository status can become
  `accepted` or the task can become `published`.
- If organization policy prevents `GITHUB_TOKEN` from opening a pull request,
  the Action leaves the validated internal branch intact and opens one bounded
  operations Issue with the compare link. A manually opened internal PR is
  still revalidated from its signed envelopes and file boundary before any
  receipt is accepted.
- Repository imports return separate signed receipts for submissions and
  comments so the portal can display their actual GitHub acceptance state.
- Free-text notes, rationales, and comments are rejected before queueing when
  they contain contact data, active markup, or unsafe URL schemes.
- Cloudflare Turnstile and same-origin checks protect the public endpoint.
- D1 stores opaque account identifiers, Passkey public keys and counters,
  hashed session tokens, and EntityCrypt-encrypted profiles and drafts.
- The primary PostgreSQL cutover lane is a private CPOLY Cloudflare
  Container/Durable Object binding (`CPOLY_POSTGRES`) with a bearer-authenticated
  internal HTTP provider contract. Optional Hyperdrive remains a rollback lane
  when a remote TLS PostgreSQL origin exists; D1 remains the rollback/recovery
  lane until parity and cutover verification succeed.
- The Worker-side private provider contract is documented in
  [`postgres/CPOLY-POSTGRES-CONTAINER-CONTRACT.md`](postgres/CPOLY-POSTGRES-CONTAINER-CONTRACT.md).
  Deployment configs bind the infra-owned provider image at
  `infrastructure/cpoly-postgres/cloudflare/Dockerfile`; the checked-in
  `postgres/Dockerfile` remains a fail-closed contract fixture only.
- Passkeys require discoverable credentials and user verification, allowing
  device PIN, fingerprint, face verification, or a compatible security key.
- The private progress dashboard uses the same single-tenant Entra
  application as SarmadAi, OIDC Authorization Code with PKCE, an eight-hour
  HttpOnly session, and signed `wids` or Microsoft Graph role verification.
- A scheduled GitHub Action imports accepted queue items using Azure OIDC and
  the repository's short-lived `GITHUB_TOKEN`; no persistent GitHub token is
  exposed to the public Worker.
- A separate least-privilege Action publishes sanitized portal defect reports
  as Issues with `issues: write`; the browser and Worker never hold a GitHub
  token.
- A participant can schedule identity-linkage erasure. Execution waits for
  task closure and the configured retention boundary, deletes active-store
  identity material, removes login/contact material, and preserves only
  pseudonymous scientific evidence. In `EVIDENCE_ARCHIVE_MODE=d1`, Cloudflare
  D1 Time Travel snapshots may remain recoverable until the configured backup
  window expires.
- PADT/PUD-derived packets and unknown analysis fields are rejected.

See `TRANSPARENCY.md`, `CONSENSUS-PROTOCOL.md`, `PRIVACY.md`, `SECURITY.md`, and `DEPLOYMENT.md`.

## Local development

```powershell
Set-Location tools\msa-adjudication-workbench
npm ci
npm run check
npm test
npx wrangler d1 migrations apply DB
npm run dev
```

The public static assets are under `public\`; the Worker API is
`src\index.js`.

### Cloudflare-primary production path

Production now prefers Cloudflare-native bindings and keeps D1/Azure only as
explicit rollback paths:

- primary CPOLY container binding: `CPOLY_POSTGRES`
- container vars/secrets:
  `CPOLY_POSTGRES_INSTANCE_ID`, `CPOLY_POSTGRES_PROVIDER_PORT`,
  `CPOLY_POSTGRES_INTERNAL_TOKEN`, `CPOLY_BACKUP_BASE_URL`,
  `ADG_MIGRATOR_PASSWORD`, `ADG_RUNTIME_PASSWORD`, `ADG_BACKUP_PASSWORD`,
  optional `POSTGRES_SUPERUSER_PASSWORD`,
  optional `CPOLY_ALLOW_FRESH_BOOTSTRAP`, optional
  `CPOLY_RESUME_RECOVERY`
- optional Hyperdrive rollback binding: `HYPERDRIVE`
- D1 binding: `DB` (rollback lane plus the required CPOLY recovery store while
  PostgreSQL writes are journal-protected)
- private CPOLY backup KV binding: `CPOLY_BACKUPS`
- R2 bindings: `SUBMISSION_OBJECTS`, `IDENTITY_OBJECTS`
- archive mode selector: `EVIDENCE_ARCHIVE_MODE=d1|r2|azure`
- D1 Time Travel boundary: `D1_TIME_TRAVEL_RETENTION_DAYS`
- direct Graph mail vars/secrets:
  `MAILER_TENANT_ID`, `MAILER_CLIENT_ID`, `MAILER_CLIENT_SECRET`,
  `MAILER_SENDER_ADDRESS`

- private CPOLY recovery secrets:
  `CPOLY_BACKUP_HMAC_KEY`, `CPOLY_BACKUP_MASTER_KEY`
- private CPOLY KV propagation delay:
  `CPOLY_BACKUP_KV_PROPAGATION_DELAY_MS`
- direct Worker secrets that satisfy the existing secret-name indirection:
  `ENTITYCRYPT_MASTER_KEY`, `SUBMISSION_HMAC_KEY`,
  `REPOSITORY_RECEIPT_HMAC_KEY`, `EMAIL_VERIFICATION_HMAC_KEY`,
  `ENTRA_CLIENT_SECRET`, `TURNSTILE_SECRET`

The deployed Cloudflare configurations keep
`CPOLY_ALLOW_FRESH_BOOTSTRAP=false` and `CPOLY_RESUME_RECOVERY=true`.
An interrupted restore therefore resumes from the signed D1/KV backup and
journal instead of leaving dynamic traffic permanently closed or approving an
empty database. Legacy journal rows whose recorded failure is transport-
ambiguous (for example, a container disconnect or HTTP 5xx) are atomically
returned to `pending` and replayed under their original request IDs. Definitive
write failures remain `failed` and keep recovery closed. A container startup
failure is retained in the recovery runtime as a bounded stage/exit diagnostic
instead of being lost after the ephemeral instance stops.

Use `EVIDENCE_ARCHIVE_MODE=d1` until Cloudflare dashboard activation allows R2.
In `d1` mode, the authoritative `evidence_outbox.public_payload_json` and
encrypted `identity_payload_json` fields are the durable archive, repository
`portal-api` imports continue directly from D1, and retention-based erasure
removes the retained identity payload from the active store without requiring
external blobs. Cloudflare D1 Time Travel may still retain recoverable
historical snapshots until `D1_TIME_TRAVEL_RETENTION_DAYS` elapses after the
actual deletion run; do not describe that as an immediate physical purge. After
R2 activation, `EVIDENCE_ARCHIVE_MODE=r2` is the preferred upgrade.

When `EVIDENCE_ARCHIVE_MODE=r2`, the Worker writes public evidence envelopes to
`SUBMISSION_OBJECTS`, writes the existing EntityCrypt identity envelopes to
`IDENTITY_OBJECTS`, and deletes only identity objects during erasure. Keep both
buckets private; no public bucket access is required or supported. The only
other explicit mode is `azure` for rollback.

When `CPOLY_POSTGRES` is bound, the Worker wraps the private container provider
with the same D1-style `prepare().bind().first/all/run` and `batch()` interface
used by the existing portal logic. The provider is contacted only through the
`CPOLY_POSTGRES` Durable Object binding with
`CPOLY_POSTGRES_INTERNAL_TOKEN`; the Worker never exposes a public SQL proxy.
If `CPOLY_POSTGRES` is absent, optional `HYPERDRIVE` remains the rollback lane
for a remote TLS PostgreSQL origin. If both are absent, the Worker stays on
native D1.

PostgreSQL write protection is bounded, not magical. Every mutating `run()` or
`batch()` request is first encrypted into D1 with `CPOLY_BACKUP_MASTER_KEY`,
then applied to PostgreSQL under a request receipt table in
`postgres\0001_portal_v15.sql` through either the private CPOLY container
provider or the Hyperdrive rollback lane. The scheduled cron replays ambiguous
journal entries and prunes them only after a verified backup proves exact
receipt coverage for the same snapshot generation/watermark pair. Separately,
the private CPOLY backup lane stores immutable PostgreSQL backup chunks in the
private `CPOLY_BACKUPS` KV namespace while D1 keeps only descriptor metadata,
signed nonces, recovery state, and the AES-GCM-encrypted write journal. The
default lane is a PostgreSQL custom-format binary dump whose protected table
values remain EntityCrypt ciphertext and whose role-password/bootstrap material
is excluded from the dump and attested separately in the manifest. Legacy
OpenPGP/GPG archive uploads remain accepted only as a compatibility lane for
current restore tooling; the Worker no longer requires or claims GPG for the
primary KV binary lane. Together, the encrypted journal plus periodic KV-backed
dump support accepted-write recovery and point-in-time rebuild. They do **not**
justify a zero-loss claim under simultaneous Cloudflare D1 and CPOLY container
failure. Optional WAL-G or R2 archival remains a second copy once R2
activation is available.

The private CPOLY recovery API is reserved for the CPOLY container backup /
restore path and is never advertised through `/api/config`:

- `POST /api/internal/cpoly-backups`
- `PUT /api/internal/cpoly-backups/{backupId}/chunks/{index}`
- `POST /api/internal/cpoly-backups/{backupId}/complete`
- `GET /api/internal/cpoly-backups/latest`
- `GET /api/internal/cpoly-backups/{backupId}/chunks/{index}`
- `POST /api/internal/cpoly-recovery/begin`
- `GET /api/internal/cpoly-recovery/status`
- `POST /api/internal/cpoly-recovery/complete`

Every request must include `x-adg-timestamp`, `x-adg-nonce`,
`x-adg-content-sha256`, and `x-adg-signature` over the canonical text
`METHOD\nPATH\nTIMESTAMP\nNONCE\nBODY_HASH`.

`POST /api/internal/cpoly-backups` now accepts the semantic equivalent of the
QdrantServer backup contract:

```json
{
  "schema": "adg.cpoly-postgres.backup.v1",
  "retentionHours": 168,
  "metadata": {
    "schema": "cpoly_postgres_backup_v1",
    "snapshotGeneration": 7,
    "postgresReceiptWatermark": 4123,
    "plaintext_file_hashes": [
      { "name": "bootstrap-roles.sql", "bytes": 123, "sha256": "<hex>" },
      { "name": "database-16384.dump", "bytes": 456, "sha256": "<hex>" }
    ],
    "attestations": {
      "schema": "adg.cpoly-postgres.backup-attestations.v1",
      "protected_columns_entitycrypt": true,
      "role_password_material_excluded": true,
      "bootstrap_roles_separate": true
    },
    "restore_test": {
      "requested": true,
      "status": "PASS",
      "databases": [
        {
          "source_database": "adg_adjudication",
          "target_database": "verify_16384",
          "restored_bytes": 123,
          "status": "PASS"
        }
      ]
    },
    "claim_boundary": "This proves creation, integrity, EntityCrypt protected-column attestations, separate role bootstrap handling, and the requested restore test only. Off-host replication and recovery-time objectives require separate scheduled operations."
  },
  "archive": {
    "fileName": "cpoly-postgres-backup.dump",
    "sizeBytes": 123,
    "sha256": "<hex>",
    "chunkCount": 1,
    "chunkSizeBytes": 123,
    "contentType": "application/octet-stream",
    "format": "postgres-custom",
    "encryptionFormat": "none"
  },
  "chunks": [{ "index": 0, "sizeBytes": 123, "sha256": "<hex>" }]
}
```

The Worker preserves the manifest's SHA-256/size/restore evidence metadata and
explicit claim boundary, requires the finalized EntityCrypt/role attestations
for the default KV binary lane, writes each immutable chunk to
`CPOLY_BACKUPS` under a versioned `backupId/index/uuid` key, and keeps only the
descriptor plus per-chunk key/hash/length metadata in D1. `POST .../complete`
verifies each KV chunk one-at-a-time against D1 metadata and the final archive
SHA-256 before publishing the backup as `latest`; `GET /api/internal/cpoly-backups/latest`
returns descriptor metadata only plus `availableAfter` for the newest complete
generation and an optional `priorBackup` fallback descriptor when an older
verified generation exists, while `GET .../chunks/{index}` streams the exact
binary chunk from KV with no JSON/base64 wrapping. Restore clients must
reassemble the dump, verify every chunk plus the final archive SHA-256
themselves, and fall back to `priorBackup` if the newest generation is still
missing or hash-mismatched after bounded retries during KV propagation.
`POST .../complete` uses the same
`adg.cpoly-postgres.backup.v1` schema plus optional `descriptorSha256`,
`metadataSha256`, `chunkCount`, `totalBytes`, and `sha256` cross-checks.
Failed/incomplete backups keep invalid state in D1 and trigger best-effort KV
prefix cleanup. While `/api/internal/cpoly-recovery/status` reports
`recovering`, the Worker blocks normal dynamic API traffic and cron side
effects until the restore job verifies the restored PostgreSQL watermark,
replays the D1 journal to exhaustion under the same request IDs, promotes the
next recovery generation, and marks the lane `ready`. The scheduled handler
also pings the private container and only triggers a bounded backup when the
provider reports `ready`; all other cron side effects remain blocked while the
container reports `starting` or `restoring`.

For repository imports, `.github\workflows\import-msa-adjudication.yml` now
supports `ADG_PORTAL_IMPORT_SOURCE=portal-api` with
`ADG_PORTAL_EVIDENCE_URL=https://adg.sbay.sa/api/repository/evidence/claim`.
That is the Cloudflare-primary import path: it pulls only the already-sanitized
public evidence payload from the portal's authoritative DB/outbox state under
the existing repository HMAC secret with timestamp/nonce replay limits, does
not require local storage access, and never returns identity payloads. Keep the
`azure-blob` mode available only for rollback until import, receipt, export,
hash, and restore verification all succeed.

### PostgreSQL schema + D1 export cutover

```powershell
$env:POSTGRES_CONNECTION_STRING = "postgres://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require"
npm run postgres:schema
npm run postgres:migrate:d1-export -- --source .\path\to\wrangler-d1-export.sql
npm run postgres:migrate:d1-export -- --source .\path\to\wrangler-d1-export.sql --apply
```

`npm run postgres:schema` applies every numbered `postgres\*.sql` migration in
order and is idempotent. The Cloudflare Container startup runs the same
checksum-guarded numbered migration set before opening the runtime bridge on
both new and existing PostgreSQL disks. The migration CLI defaults to dry-run,
imports each source application table in its own transaction when `--apply` is
present, preserves source column names/types/values for tables shared with the
v15 schema, uses parameterized inserts with `ON CONFLICT DO NOTHING` replay
protection where the source table has a primary key or unique index, skips the
D1-only CPOLY recovery tables, and emits only JSON count/hash reports. It stages
the Wrangler export in a project-local plaintext SQLite file under
`.migration-work\`, deletes that staging file on ordinary success/failure
paths, never deletes the source `.sql` export, and never logs row contents or
secrets. If the process is force-killed, remove any leftover
`.migration-work\*.sqlite` file manually before sharing the working tree.

Do not remove D1 or Azure rollback bindings until import, receipt, export,
hash, and restore verification succeed against the real CPOLY PostgreSQL
provider image plus any chosen Hyperdrive rollback binding.

## Release integrity

`release\portal-15.3.3.json` binds the sanitized portal, importer, workflows,
tests, and documentation with canonical LF-normalized SHA-256 records. Regenerate
it deterministically from a clean clone with:

```powershell
npm run release:manifest
```

The security workflow rejects a stale or untracked release manifest. Private
Wrangler bindings, local environment files, identities, and credentials are
explicitly outside this ordinary-software release boundary.

## Authoritative evaluation

Browser validation improves usability, but the .NET evaluator remains the
authoritative linguistic evidence boundary:

```powershell
dotnet run --project src\Adg.LanguageEditor -c Release -- `
  evaluate-msa-adjudication `
  --packet <packet.json> `
  --annotation-a <annotation-a.json> `
  --annotation-b <annotation-b.json> `
  --adjudication <decision.json> `
  --report <evaluation.json> `
  --human-report <human-adjudication.json> `
  --conllu <adjudicated-gold.conllu>
```

The built-in pilot is authored and developer-visible. It can test usability but
can never satisfy the sealed-holdout or final-readiness gates.
