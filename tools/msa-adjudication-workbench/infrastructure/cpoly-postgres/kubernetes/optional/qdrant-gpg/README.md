# Optional Qdrant-style OpenPGP second copy

This Job preserves the QdrantServer-derived globals/per-database inventory,
SHA-256 manifest, AES-256 OpenPGP encryption, plaintext removal, and disposable
restore verification. It uploads its encrypted bundle to the same signed
Worker/KV lane as an optional second backup set.

It is not included in the base Kustomize deployment. Create
`adg-postgres-gpg-backup-secrets` with an `encryption-passphrase` key, then:

```powershell
kubectl --context <remote-context> apply -k `
  .\kubernetes\optional\qdrant-gpg
```

The required/default lane remains the raw `adg_adjudication` custom dump.

