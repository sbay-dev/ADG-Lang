# Secret-file contract

Create these files on the remote host in a root-owned directory outside the
repository. Set `CPOLY_SECRET_DIR` to that directory before running Compose.
Never commit the files.

```text
postgres-superuser-password
adg-migrator-password
adg-runtime-password
adg-backup-password
postgres-server.crt
postgres-server.key
postgres-ca.crt
backup-aws-access-key-id
backup-aws-secret-access-key
backup-libsodium-key
```

Requirements:

- Passwords are unique random values; the runtime password is the only database
  password supplied to Hyperdrive.
- `postgres-server.key` is unencrypted at runtime, mode `0600`, and readable only
  by the deployment account. The container copies it into a private tmpfs.
- The server certificate SAN contains the public origin DNS name and `postgres`
  for internal Compose verification.
- `backup-libsodium-key` is a 32-byte key encoded as expected by WAL-G. Preserve
  it in an independent secret manager; losing it makes backups unrecoverable.
- S3-compatible credentials are restricted to the configured backup prefix.

