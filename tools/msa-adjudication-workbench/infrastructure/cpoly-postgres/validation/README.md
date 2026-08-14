# Validation

Run from `infrastructure/cpoly-postgres`:

```powershell
.\validation\validate.ps1
```

This offline gate runs:

1. ADG JSON Schema/contract checks.
2. Policy checks rejecting credential files/plaintext credential fields,
   Kubernetes `hostPath`, mutable images, local/workbench production placement,
   insecure SSL defaults, missing PVCs, and missing backup/restore artifacts.
3. SHA-256 verification of the complete package file set.
4. The repository's actual Worker recovery tests.
5. `docker compose config --quiet`.
6. `kubectl kustomize` parsing/rendering for the base and operation manifests.

No Kubernetes API server or context is required. This proves deterministic
rendering, not cluster admission, CSI behavior, load-balancer behavior, or a
successful deployment.

With Docker Engine and OpenSSL available, run the disposable runtime smoke:

```powershell
.\validation\smoke-compose.ps1
.\validation\smoke-d1-recovery.ps1
.\validation\smoke-cloudflare-container.ps1
```

It refuses to collide with an existing CPOLY project, generates validation-only
one-day certificates and credentials under this folder, binds only to
loopback, verifies PostgreSQL initialization, reruns a checksum migration,
tests `verify-full` plus SCRAM, proves plaintext rejection and migration-metadata
denial for the runtime role, then removes its container, network, volume, and
scratch files.

The KV/D1 recovery smoke starts a loopback-only HTTP harness around the
repository's actual Worker implementation and D1 migrations plus an in-memory
`CPOLY_BACKUPS` KV namespace,
seeds deterministic data, captures a raw custom-format adjudication dump from
the exact exported snapshot, verifies the EntityCrypt/role attestations,
uploads raw KV chunks, and restore-verifies PostgreSQL 16. It then deletes the
entire validation PGDATA volume, starts a fresh database, reassembles the exact
archive, compares pre-upload/reconstructed archive SHA-256 and restored data
SHA-256, and verifies that a second restore is blocked without destructive
confirmation. It is destructive only to its dedicated validation volume and
is never a production recommendation.
The harness hides the newest immutable KV chunk keys for multiple reads and
requires the client to emit `RESTORE_FALLBACK` and restore the prior complete
generation.
The actual Python client performs create/chunk/complete/latest,
recovery-begin, per-chunk restore, recovery-complete/status, and readiness-gate
conformance against that real Worker route implementation.

The Cloudflare-equivalent smoke builds the pinned container image, creates a
fresh explicitly approved environment, exercises the exact internal provider
contract and idempotent receipt, triggers KV backup, sends SIGTERM and requires
its backup evidence, removes the container/PGDATA, recreates it, completes
Worker journal/generation recovery, and verifies the restored row hash and
receipt watermark.
