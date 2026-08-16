# ADS security model

## Trust boundaries

1. The browser handles private identity and blind linguistic decisions.
2. The Cloudflare Worker validates origin, size, Turnstile, PII separation, and
   artifact hashes.
3. EntityCrypt's randomized Matryoshka profile encrypts identity with
   HKDF-SHA-256 and AES-256-GCM before it leaves the Worker for Blob Storage.
4. Azure Key Vault holds the EntityCrypt master key, write-only SAS values, and
   GitHub-ingestion HMAC key.
5. Azure Blob Storage keeps encrypted identity, pending anonymized submissions,
   and processed submissions in separate private containers.
6. GitHub Actions uses Azure OIDC to pull the pending queue, verify HMAC and
   protocol roots, and open a review pull request with PII-free files.
7. Cloudflare D1 stores WebAuthn credential public keys and counters. Profiles
   and resumable drafts are EntityCrypt ciphertext; participant session tokens
   are random and only their SHA-256 hashes are stored.
8. `/admin/` is a separate Microsoft Entra control plane. Authorization Code
   with PKCE verifies the tenant, issuer, audience, nonce, signature, Graph
   `userType=Member`, and Global Administrator authority. Role authority is
   accepted only from signed `wids`
   `62e90394-69f5-4237-9190-012177145e10` or a direct active Microsoft Graph
   role assignment.

## Required controls

- Turnstile must be production-configured before `SUBMISSION_ENABLED=true`.
- The Worker service principal receives only Key Vault secret `get`.
- The EntityCrypt key `adg-entitycrypt-master-key-v1` never enters GitHub or
  Blob metadata, and identity blobs contain `MK1:0:` ciphertext only.
- Worker SAS values permit create/write only and cannot list or read.
- The GitHub OIDC principal receives Blob Data Contributor and Key Vault Secret
  User only on the dedicated resources.
- Repository workflows use explicit minimal permissions.
- No participant identity may enter logs, GitHub, analytics, or error messages.
- Participant registration never requires or accepts an organization account.
- Admin cookies are independent from participant Passkey cookies, HttpOnly,
  Secure, and limited to eight hours. Privileged API calls revalidate the
  active directory role and fail closed if Microsoft Graph is unavailable.
- OIDC state, PKCE verifier, admin identity, profiles, and drafts are encrypted
  with EntityCrypt before D1 persistence. Raw bearer tokens are never stored.

## Reporting

Operational defects may be sent from the persistent in-portal report button.
The authenticated endpoint accepts only bounded technical text and a small
allowlist of safe context, rate-limits each account, and queues a payload that
contains no account identifier, profile, email, draft, or linguistic decision.
A least-privilege GitHub Action creates or reuses the matching public Issue and
returns an HMAC-signed receipt. The repository Issue Form is a fallback when a
login failure blocks the authenticated channel.

Report vulnerabilities privately to `team@sbay.sa`. Do not publish security
details, participant PII, drafts, linguistic decisions, or live credentials in
an Issue.
