# ADG CPOLY PostgreSQL data plane

This tree packages PostgreSQL 16 for the ADG MSA adjudication portal under the
CPOLY package contracts. The selected ADG production runtime is:

- `cloudflare`: one stable `standard-1` Cloudflare Container running
  PostgreSQL 16 plus the private HTTP provider bridge.

The Kubernetes StatefulSet and remote-host Compose contracts remain optional
variants. Neither this workstation nor any local runtime is a production data
plane.
Cloudflare Workers remain the public application, API, and Graph mail path.
The Worker calls the container's bearer-authenticated internal HTTP database
provider. PostgreSQL TCP 5432 is disabled from external routing.

## Claim boundary

- The database is single-primary, not HA.
- Container PGDATA is ephemeral and is not durable storage.
- The primary recovery copy is a raw custom-format binary `pg_dump`
  of `adg_adjudication`, split into signed chunks stored in the Worker's
  `CPOLY_BACKUPS` KV namespace. D1 retains descriptors, journal, leases, and
  recovery state.
- Sensitive values are already protected by the attested EntityCrypt profile.
  Role passwords/globals are excluded and roles are deterministically
  bootstrapped from Cloudflare secrets plus migrations.
- Qdrant-style AES-256 OpenPGP and WAL-G/S3 remain optional second-copy modes.
  R2 is not required.
- The Cloudflare Container is authoritative only while its recovery gate is
  ready. Durable recovery remains KV+D1, never the container disk.
- No external Kubernetes cluster is required for the selected runtime.
- No deployment is claimed until the active CPOLY Field/Workbench integration,
  secrets, and Worker recovery bindings are intentionally configured.

## Tree

```text
contract/                 ADG package aggregate contract and JSON Schema
cloudflare/               selected Cloudflare Container + private DB provider
standard/                 remote-host Compose package
kubernetes/               optional external-cluster StatefulSet package
scripts/                  shared bootstrap, migration, backup, restore scripts
operations/               remote-host runbook
docs/                     architecture, Hyperdrive security, and ADR
validation/               contract, policy, Compose, and manifest checks
```

The operator-compatible, schema-qualified PostgreSQL migration is checked in at
`migrations/postgresql/*.sql` and generated into the Kubernetes migration
ConfigMap by Kustomize.

## Validation

From this directory:

```powershell
.\validation\validate.ps1
.\validation\smoke-compose.ps1
.\validation\smoke-d1-recovery.ps1
.\validation\smoke-cloudflare-container.ps1
```

The script performs contract/schema checks, policy checks, `docker compose
config`, Kustomize rendering, Kubernetes client-side parsing when available,
and checks for secrets, host paths, mutable images, insecure SSL, missing PVCs,
and missing backup/restore artifacts. The smoke script uses a disposable
loopback-only container/volume to verify bootstrap, idempotent migrations,
TLS-only HBA, SCRAM, and runtime-role privilege boundaries; it is validation,
not a production placement. The KV/D1 recovery smoke destroys only its dedicated
validation PGDATA volume and restores signed chunks through a loopback harness
using the repository's actual Worker route implementation,
and verifies the exact seeded-data SHA-256.

## Deployment entry points

- Cloudflare Container: [cloudflare/README.md](cloudflare/README.md)
- Remote host: [standard/README.md](standard/README.md)
- Kubernetes: [kubernetes/README.md](kubernetes/README.md)
- Exact Workbench path: [kubernetes/CPOLY-WORKBENCH-PATH.md](kubernetes/CPOLY-WORKBENCH-PATH.md)
- Hyperdrive security: [docs/HYPERDRIVE-ORIGIN-SECURITY.md](docs/HYPERDRIVE-ORIGIN-SECURITY.md)
- Backup/restore: [operations/BACKUP-RESTORE.md](operations/BACKUP-RESTORE.md)
- Qdrant provenance: [docs/QDRANT-BACKUP-PROVENANCE.md](docs/QDRANT-BACKUP-PROVENANCE.md)
- CPOLY field observation: [docs/CPOLY-FIELD-STATUS.md](docs/CPOLY-FIELD-STATUS.md)
