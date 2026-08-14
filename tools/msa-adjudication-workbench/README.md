# Arabic Adjudication Studio (ADS)

`adg.sbay.sa` is the Arabic-first human adjudication portal for ADG-Lang. It is
designed for experienced Arabic teachers who should not need GitHub, JSON, or
command-line knowledge.

The previous `ads.sbay.sa` address redirects to the canonical domain so old
invitations remain usable. The public page includes ready-made WhatsApp and
X/Twitter invitation actions.

## User workflow

1. Read the Arabic criteria and parser summary.
2. Record private contact details and consent.
3. Register a discoverable Passkey; no organization account or password is
   required for an external adjudicator.
4. Read the worked example, then choose annotator A, annotator B, or
   third-party adjudicator.
5. Load the built-in pilot or an organizer packet.
6. Complete the guided linguistic decisions. Encrypted drafts are saved
   manually and after edits so the adjudicator can return later.
7. Save a local anonymized copy or submit through the protected API.

The separate `/admin/` progress dashboard uses Microsoft Entra only. It is
not part of participant registration and fails closed unless the signed-in
organization member has authoritative Global Administrator proof.

## Security and privacy boundary

- Parser predictions are never displayed.
- Packet and submission roots are recomputed in the browser and in .NET.
- Azure stores identity separately from linguistic evidence.
- Optional social usernames, including the WhatsApp username rather than a
  phone number, remain encrypted with the private identity record.
- GitHub receives only a pseudonymous, HMAC-signed envelope.
- Cloudflare Turnstile and same-origin checks protect the public endpoint.
- D1 stores opaque account identifiers, Passkey public keys and counters,
  hashed session tokens, and EntityCrypt-encrypted profiles and drafts.
- Passkeys require discoverable credentials and user verification, allowing
  device PIN, fingerprint, face verification, or a compatible security key.
- The private progress dashboard uses the same single-tenant Entra
  application as SarmadAi, OIDC Authorization Code with PKCE, an eight-hour
  HttpOnly session, and signed `wids` or Microsoft Graph role verification.
- A scheduled GitHub Action imports accepted queue items using Azure OIDC and
  the repository's short-lived `GITHUB_TOKEN`; no persistent GitHub token is
  exposed to the public Worker.
- PADT/PUD-derived packets and unknown analysis fields are rejected.

See `PRIVACY.md`, `SECURITY.md`, and `DEPLOYMENT.md`.

## Local development

```powershell
Set-Location tools\msa-adjudication-workbench
npm ci
npm run check
npm test
npx wrangler d1 migrations apply DB
npm run dev
```

The public static assets are under `public\`; the Worker API is
`src\index.js`.

## Authoritative evaluation

Browser validation improves usability, but the .NET evaluator remains the
authoritative linguistic evidence boundary:

```powershell
dotnet run --project src\Adg.LanguageEditor -c Release -- `
  evaluate-msa-adjudication `
  --packet <packet.json> `
  --annotation-a <annotation-a.json> `
  --annotation-b <annotation-b.json> `
  --adjudication <decision.json> `
  --report <evaluation.json> `
  --human-report <human-adjudication.json> `
  --conllu <adjudicated-gold.conllu>
```

The built-in pilot is authored and developer-visible. It can test usability but
can never satisfy the sealed-holdout or final-readiness gates.
