# Backup and restore operations

## Recovery hierarchy

1. **Primary Kubernetes copy:** raw custom-format `pg_dump` of
   `adg_adjudication`, split into signed chunks no larger than 512 KiB and
   stored byte-for-byte in `CPOLY_BACKUPS` KV. D1 stores metadata, journal,
   lease, and recovery gate state.
2. **Optional second copies:** Qdrant-style AES-256 OpenPGP and WAL-G to an
   approved HTTPS S3-compatible service. R2 is not required.
3. **PVC:** authoritative live storage, never backup evidence by itself.

The primary descriptor attests EntityCrypt-protected columns and separate role
bootstrap. Globals and role password hashes are excluded. The primary copy is
logical; PITR and HA are not claimed.

## Signed Worker API

The fixed endpoints are:

```text
POST /api/internal/cpoly-backups
PUT  /api/internal/cpoly-backups/{backupId}/chunks/{index}
POST /api/internal/cpoly-backups/{backupId}/complete
GET  /api/internal/cpoly-backups/latest
GET  /api/internal/cpoly-backups/{backupId}/chunks/{index}
POST /api/internal/cpoly-recovery/begin
POST /api/internal/cpoly-recovery/complete
GET  /api/internal/cpoly-recovery/status
```

Every request includes `x-adg-timestamp`, `x-adg-nonce`,
`x-adg-content-sha256`, and `x-adg-signature`. The lowercase hexadecimal HMAC
is calculated over this UTF-8 canonical form:

```text
UPPERCASE_METHOD + "\n" + path + "\n" + timestamp_ms + "\n" +
uuid_v4_nonce + "\n" + body_sha256
```

Create and complete share schema `adg.cpoly-postgres.backup.v1`. `GET latest`
returns descriptors only plus `availableAfter` for the newest complete
generation and optional `priorBackup` metadata for the last retained verified
generation; chunks are fetched individually. The restore client must retry
missing/hash-mismatched chunks with bounded backoff and fall back to
`priorBackup` if the newest generation is still not globally readable from KV.
See `contract/d1-backup-api.v1.json`.

## Required secrets

`adg-postgres-portal-backup-secrets` references:

```text
hmac-key  # at least 32 bytes
base-url  # HTTPS origin only, no path
```

The backup Job also reads `adg-backup-password` from
`adg-postgres-role-secrets`. Values never appear in manifests.

## Run and inspect a primary backup

```powershell
kubectl --context <remote-context> -n adg-data-plane create job `
  --from=cronjob/adg-postgres-d1-backup `
  adg-postgres-d1-backup-manual

kubectl --context <remote-context> -n adg-data-plane wait `
  --for=condition=complete job/adg-postgres-d1-backup-manual --timeout=4h

kubectl --context <remote-context> -n adg-data-plane logs `
  job/adg-postgres-d1-backup-manual -c signed-upload
```

Success requires an exported repeatable-read snapshot, exact generation/receipt
watermark, custom binary dump header, EntityCrypt/role attestations,
per-chunk/final SHA-256, restore verification, `BACKUP_COMPLETE`, and agreement
with the latest descriptor. Any failure leaves the Job failed and visible.

## Restore to a fresh database/PVC

1. Provision a fresh retained PVC by starting the StatefulSet against the new
   claim.
2. Wait for PostgreSQL bootstrap to create the empty database and roles.
3. Confirm Kustomize applied its generated `adg-postgres-migrations` ConfigMap.
4. Apply `kubernetes/operations/d1-restore-job.yaml`.

```powershell
kubectl --context <remote-context> apply `
  -f .\kubernetes\operations\d1-restore-job.yaml

kubectl --context <remote-context> -n adg-data-plane wait `
  --for=condition=complete job/adg-postgres-d1-restore --timeout=4h
```

The restore first downloads and validates the selected backup descriptor and
its KV chunks, using `availableAfter`, bounded retries, and `priorBackup`
fallback before it touches PostgreSQL. It then calls signed `recovery/begin`,
which pins the chosen backup against retention and returns its recovery ID,
target generation, and lease expiry. It then refuses any non-empty
adjudication schema by default. After an
independent snapshot and explicit change-management approval, a temporary copy
of the Job manifest may set:

```text
CPOLY_DESTRUCTIVE_RESTORE=RESTORE_adg_adjudication_FROM_D1
```

Never commit that enabled flag. The restore downloads and validates the latest
complete descriptor before touching the database, retries the newest
generation until its bounded KV propagation window is exhausted, falls back to
`priorBackup` when needed, reconstructs the selected custom archive
byte-for-byte from KV chunks, verifies its final SHA-256, restores
`adg_adjudication` in one transaction, applies checked-in migrations, and
reconciles least privileges.

It then calls signed `recovery/complete` until journal replay is exhausted and
PostgreSQL receipt verification reaches the target generation. A final signed
status check must remain `ready` before the operator opens
`adjudication.cpoly_recovery_state`. The external/Hyperdrive Services publish
only ready endpoints; `adg-postgres-recovery` is the private not-ready
ClusterIP used by migration and restore Jobs.

## Isolated Kubernetes drill

`kubernetes/operations/restore-drill.yaml` creates a disposable PVC and Job.
The init container downloads and verifies KV chunks. The PostgreSQL 16
verification container initializes the disposable PVC without TCP ingress,
checks the exact binary hash, restores into a disposable
`verify_adg_adjudication` database, stops PostgreSQL, and completes the Job.

```powershell
kubectl --context <remote-context> apply `
  -f .\kubernetes\operations\restore-drill.yaml
kubectl --context <remote-context> -n adg-data-plane wait `
  --for=condition=complete job/adg-postgres-d1-restore-verify --timeout=4h
kubectl --context <remote-context> -n adg-data-plane logs `
  job/adg-postgres-d1-restore-verify -c postgres16-restore-verifier
```

Delete the Job and drill PVC only after verification.

## Optional Qdrant-style GPG and WAL-G copies

The digest-pinned OpenPGP scripts remain under `scripts/` and require only the
optional `adg-postgres-gpg-backup-secrets` passphrase projection. They are not
part of the required KV recovery lane.

Configure an approved S3-compatible HTTPS target and then explicitly apply:

```powershell
kubectl --context <remote-context> apply -k `
  .\kubernetes\optional\walg
```

The optional path remains digest-pinned, encrypted, retained, and fail-closed.
It is not part of the primary D1 recovery drill and does not require R2.

## Remote-host fallback

The non-selected Compose fallback retains its WAL-G backup and isolated restore
drill. It must run on an always-on remote host, never as a local production
dependency.
