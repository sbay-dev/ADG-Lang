# PostgreSQL operator migration contract

The checked-in CPOLY migration is:

```text
migrations/postgresql/0001_portal_v15.sql
```

It was adapted read-only from:

```text
postgres/0001_portal_v15.sql
SHA-256 f4d5dc5702fa03ffa2387f36c212876638e6b62b574a4f19b7f848731569be7d
```

Adaptation rules:

- every application table, index target, DML target, and foreign-key target is
  explicitly qualified under `adjudication` (PostgreSQL index names inherit the
  qualified table's namespace);
- the source file's private `schema_migrations(version)` table, version insert,
  `BEGIN`, and `COMMIT` are removed;
- the operator exclusively owns
  `adjudication.schema_migrations(name, checksum_sha256)`;
- `cpoly_write_receipts.receipt_seq` is the exact monotonic journal watermark;
- `cpoly_runtime_state.current_generation` supplies the monotonic snapshot
  generation used by Worker recovery;
- `cpoly_recovery_state` gates application readiness until signed Worker
  recovery reports replay exhaustion and receipt verification;
- application runtime remains on `search_path=adjudication`; and
- recovery state and backup-generation controls are denied to the runtime role.

Kustomize generates `adg-postgres-migrations` directly from this file. No host
path, generated secret, root-level migration copy, or source-schema transaction
wrapper is required.
