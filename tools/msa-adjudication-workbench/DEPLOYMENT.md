# ADS deployment

Target: `https://ads.sbay.sa`

## Azure resources

- Resource group: `rg-adg-adjudication-production`
- Key Vault: `kv-adg-ads-sbay-2026`
- Storage account: `stadgadsprod2026`
- Containers:
  - `adg-participant-identities`
  - `adg-submissions-pending`
  - `adg-submissions-processed`

Key Vault secrets:

- `adg-identities-write-sas`
- `adg-submissions-write-sas`
- `adg-github-submission-hmac`
- `adg-entitycrypt-master-key-v1`
- `adg-entra-client-secret`

The two SAS values must be container-scoped, HTTPS-only, write/create-only, and
rotated. The HMAC key authenticates the queue imported by GitHub Actions. The
EntityCrypt key encrypts identity with the randomized Matryoshka
AES-256-GCM profile before Blob Storage receives it.
The Entra secret is the existing SarmadAi single-tenant application's client
secret, imported from the protected server secret store without entering
source control or Worker variables.

## Cloudflare D1

Create separate production and staging databases and bind each as `DB`.
Apply all migrations before deploying:

```powershell
npx wrangler d1 migrations apply DB --remote
```

D1 contains Passkey public credentials, hashed opaque sessions, encrypted
profiles and drafts, non-sensitive completion counters, submission receipts,
and encrypted short-lived OIDC state.

## Cloudflare Worker secrets

```powershell
npx wrangler secret put AZURE_CLIENT_SECRET
npx wrangler secret put TURNSTILE_SECRET
```

`AZURE_CLIENT_ID` and `TURNSTILE_SITE_KEY` may be ordinary Worker variables.
Do not commit `.dev.vars`.

Entra ordinary variables:

- `ENTRA_TENANT_ID`
- `ENTRA_CLIENT_ID`
- `ENTRA_CLIENT_SECRET_NAME=adg-entra-client-secret`

The Entra application must include this Web redirect URI:

`https://ads.sbay.sa/signin-microsoft`

It requires delegated `User.Read` and the existing application permission
`RoleManagement.Read.Directory` with tenant-admin consent. The administrative
dashboard accepts only the built-in Global Administrator role template
`62e90394-69f5-4237-9190-012177145e10`.

## GitHub Actions variables

- `ADG_AZURE_CLIENT_ID`
- `ADG_AZURE_TENANT_ID`
- `ADG_AZURE_SUBSCRIPTION_ID`
- `ADG_AZURE_STORAGE_ACCOUNT`
- `ADG_AZURE_KEY_VAULT`

The Azure application must have a federated credential for
`repo:sbay-dev/ADG-Lang:environment:msa-adjudication-production`.

## Deploy

```powershell
Set-Location tools\msa-adjudication-workbench
npm ci
npm run check
npm test
npx wrangler deploy
```

Keep `SUBMISSION_ENABLED=false` until Azure access, Turnstile production
validation, the custom domain, and the GitHub import workflow have all passed.
