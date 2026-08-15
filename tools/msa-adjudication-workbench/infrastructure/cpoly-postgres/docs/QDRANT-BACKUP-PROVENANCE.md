# QdrantServer backup-contract provenance

The Kubernetes implementation adapts, but does not copy operational
assumptions from, these read-only QdrantServer sources:

| Source | SHA-256 |
| --- | --- |
| `QdrantServer/scripts/backup-cpoly-postgres.ps1` | `099003fbdab520a02ff1d47ad6417127cc52000c8dfb806bf5b7ec8209c12159` |
| `QdrantServer/docs/cpoly-postgres-backup.md` | `3356b008573407740752f3dbf9b859efabc86373942e251f9cb40cf5c15c3dbc` |

Preserved verified invariants:

1. inventory every connectable non-template database;
2. export `pg_dumpall --globals-only` without role passwords;
3. create one custom-format `pg_dump` per database;
4. record database sizes and SHA-256 for every plaintext artifact;
5. bundle and encrypt using AES-256 OpenPGP symmetric encryption;
6. verify encryption/decryption SHA-256 round trip;
7. remove plaintext dumps, globals, tar, and temporary decryption material;
8. fail closed on discovery, dump, hashing, encryption, upload, or requested
   restore-verification failure;
9. optionally restore every database dump into disposable PostgreSQL 16
   databases; and
10. bound off-host claims explicitly.

Kubernetes adaptations:

- PostgreSQL is reached through
  `adg-postgres-headless.adg-data-plane.svc.cluster.local`.
- HMAC and OpenPGP secrets come only from Kubernetes Secret projections.
- The Qdrant-style OpenPGP path is retained as an optional second-copy mode.
- The required lane instead uploads raw `adg_adjudication` custom-format chunks
  to `CPOLY_BACKUPS` KV because sensitive values are already EntityCrypt
  ciphertext. D1 holds only metadata, journal, lease, and recovery gate state.
- Restore verification uses a disposable PVC/Pod and PostgreSQL 16, not Docker
  or host PowerShell.
- Azure Key Vault, host backup paths, Docker execution, local production
  dependencies, and Azure-specific claims are intentionally excluded.

The encrypted copy is off-cluster only after the Worker completion endpoint and
latest-manifest verification succeed. A PVC, an ephemeral Job workspace, or a
local smoke-server copy alone does not prove off-host disaster recovery.
