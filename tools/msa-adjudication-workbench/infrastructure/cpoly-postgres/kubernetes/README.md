# External-cluster CPOLY PostgreSQL

This optional variant requires a real, always-on Kubernetes cluster. The CPOLY
Kubernetes Workbench is a control/telemetry layer only; it is not the stateful
database node. No cluster or `kubectl` context currently exists, so these
commands are prerequisites, not executed deployment evidence.

This is retained as an optional fallback; the selected production runtime is
the stable Cloudflare Container. See
[CPOLY-WORKBENCH-PATH.md](CPOLY-WORKBENCH-PATH.md) for the verified distinction
between the Workbench Helm installation, its read-only API, and the external
cluster deployment authority.

## Bounded architecture

- One PostgreSQL 16 primary in a StatefulSet.
- One retained 50 GiB `ReadWriteOnce` PVC using
  `cpoly-postgres-retain`.
- No replication and no HA claim.
- A `LoadBalancer` Service preserves source IPs and limits source ranges to the
  Cloudflare ranges published on 2026-08-14.
- TLS terminates in PostgreSQL, not at an HTTP proxy.
- Daily raw custom-format `pg_dump` of `adg_adjudication`, split into bounded
  signed chunks stored in `CPOLY_BACKUPS` KV. D1 stores metadata, journal, lease,
  and recovery gate state.
- EntityCrypt-protected value and separate role-bootstrap attestations are
  mandatory. Globals and role password hashes are not included.
- Optional WAL-G/S3-compatible second copy; R2 is not required.
- Hyperdrive/external readiness remains closed until signed Worker recovery
  reports journal replay exhausted and receipt verification ready. Migration
  and restore Jobs use the private `adg-postgres-recovery` ClusterIP.

## Cluster prerequisites

1. Kubernetes version supporting StatefulSet PVC retention and CronJob time
   zones.
2. CSI-backed encrypted StorageClass named `cpoly-postgres-retain`, with
   `reclaimPolicy: Retain`, `volumeBindingMode: WaitForFirstConsumer`, expansion,
   and provider snapshots enabled.
3. A load-balancer implementation that supports source-range filtering and
   `externalTrafficPolicy: Local`.
4. DNS and a certificate SAN containing:
   - the public Hyperdrive origin DNS name;
   - `adg-postgres-headless.adg-data-plane.svc.cluster.local`; and
   - `adg-postgres-recovery.adg-data-plane.svc.cluster.local`.
5. Current Cloudflare IP ranges reviewed against:
   `https://www.cloudflare.com/ips/`.
6. HTTPS Worker origin implementing the fixed private backup API and a
   Kubernetes Secret containing its origin URL plus HMAC key.
7. Optional S3-compatible HTTPS storage only when the WAL-G second copy is
   enabled.

## Create referenced secrets

Create source files outside the repository, then run:

```powershell
kubectl create namespace adg-data-plane --dry-run=client -o yaml |
  kubectl apply -f -

kubectl -n adg-data-plane create secret generic adg-postgres-role-secrets `
  --from-file=postgres-superuser-password=<protected-path>\postgres-superuser-password `
  --from-file=adg-migrator-password=<protected-path>\adg-migrator-password `
  --from-file=adg-runtime-password=<protected-path>\adg-runtime-password `
  --from-file=adg-backup-password=<protected-path>\adg-backup-password

kubectl -n adg-data-plane create secret generic adg-postgres-server-tls `
  --from-file=postgres-server.crt=<protected-path>\postgres-server.crt `
  --from-file=postgres-server.key=<protected-path>\postgres-server.key `
  --from-file=postgres-ca.crt=<protected-path>\postgres-ca.crt

kubectl -n adg-data-plane create secret generic adg-postgres-portal-backup-secrets `
  --from-file=hmac-key=<protected-path>\backup-hmac-key `
  --from-file=base-url=<protected-path>\portal-backup-base-url
```

Optional GPG and WAL-G/S3 secrets:

```powershell
kubectl -n adg-data-plane create secret generic adg-postgres-gpg-backup-secrets `
  --from-file=encryption-passphrase=<protected-path>\backup-encryption-passphrase

kubectl -n adg-data-plane create secret generic adg-postgres-backup-secrets `
  --from-file=aws-access-key-id=<protected-path>\backup-aws-access-key-id `
  --from-file=aws-secret-access-key=<protected-path>\backup-aws-secret-access-key `
  --from-file=libsodium-key=<protected-path>\backup-libsodium-key
```

Use an external-secrets controller instead when available. Never put secret
`data` or `stringData` into these manifests.

## Configure and deploy

Review the current Cloudflare CIDRs, then from
`infrastructure/cpoly-postgres`:

```powershell
.\kubernetes\operations\Deploy-CpolyPostgres.ps1 `
  -Context <remote-context>

.\kubernetes\operations\Deploy-CpolyPostgres.ps1 `
  -Context <remote-context> `
  -Apply
```

The first command performs server-side dry-run admission; the second applies
and waits for the StatefulSet. The equivalent raw path is:

```powershell
kubectl --context <remote-context> apply --server-side `
  -k .\infrastructure\cpoly-postgres
```

Kustomize generates `adg-postgres-migrations` from the checked-in,
schema-qualified operator migration. Run it through the actual migrator role:

```powershell
kubectl -n adg-data-plane delete job adg-postgres-migrate --ignore-not-found
kubectl apply -f .\kubernetes\operations\migrate-job.yaml
kubectl -n adg-data-plane wait --for=condition=complete `
  job/adg-postgres-migrate --timeout=30m
```

After the load balancer has an address, create DNS, verify the certificate with
`sslmode=verify-full`, and only then create Hyperdrive.

The D1 backup CronJob is part of the base. WAL-G is not:

```powershell
kubectl --context <remote-context> apply -k .\kubernetes\optional\walg
```

## Restore

Use the D1-backed isolated restore drill first. A production logical restore
refuses non-empty data unless the exact destructive confirmation is supplied
after an independent snapshot. See
[../operations/BACKUP-RESTORE.md](../operations/BACKUP-RESTORE.md).
