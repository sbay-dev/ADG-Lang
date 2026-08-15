# ADR 0002: Cloudflare Container is the selected PostgreSQL runtime

- Status: Accepted; supersedes ADR 0001 for production placement
- Date: 2026-08-15

## Decision

Use one stable `standard-1` Cloudflare Container as the selected PostgreSQL 16
runtime. The portal Worker accesses it only through the authenticated internal
HTTP provider. PostgreSQL TCP is not externally routed.

Container PGDATA remains ephemeral. `CPOLY_BACKUPS` KV stores byte-exact custom
dump chunks; D1 stores descriptors, write journal, leases, and recovery gate
state. A container becomes authoritative only after recovery-complete/status,
journal exhaustion, receipt verification, and the local readiness gate.

Kubernetes, remote Compose, Qdrant OpenPGP, and WAL-G remain optional fallback
or second-copy variants.

## Consequences

- No external Kubernetes cluster is required for the primary runtime.
- `max_instances=1` and stable instance ID `standard-1` prevent split-brain.
- The bridge, not port 5432, is the only routed data interface.
- Container restart correctness depends on a complete KV backup and Worker/D1
  recovery state.
- Fresh bootstrap requires an explicit opt-in and cannot silently replace a
  missing backup.
- No deployment is claimed by these artifacts.

