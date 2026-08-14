import assert from "node:assert/strict";
import test from "node:test";
import worker, {
  adminCallbackUri,
  base64UrlFromBytes,
  base64UrlToBytes,
  calculateDraftProgress,
  decryptEntityCryptForTest,
  encryptEntityCrypt,
  validateAccountConsent,
  validateAccountProfile
} from "../src/index.js";

test("config exposes no server secrets", async () => {
  const response = await worker.fetch(
    new Request("https://adg.sbay.sa/api/config"),
    {
      SUBMISSION_ENABLED: "false",
      MAX_SUBMISSION_BYTES: "900000",
      TURNSTILE_SITE_KEY: "public-site-key",
      GITHUB_REPOSITORY: "sbay-dev/ADG-Lang",
      CPOLY_BACKUP_BASE_URL: "https://adg.sbay.sa",
      ADG_MIGRATOR_PASSWORD: "migrator-secret",
      ADG_RUNTIME_PASSWORD: "runtime-secret",
      ADG_BACKUP_PASSWORD: "backup-secret",
      POSTGRES_SUPERUSER_PASSWORD: "superuser-secret",
      CPOLY_POSTGRES_INTERNAL_TOKEN: "container-secret"
    }
  );
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.deepEqual(value, {
    submissionEnabled: false,
    maxSubmissionBytes: 900000,
    turnstileSiteKey: "public-site-key",
    repository: "sbay-dev/ADG-Lang",
    accountEnabled: false,
    emailVerificationEnabled: false
  });
  assert.equal(JSON.stringify(value).includes("SECRET"), false);
  assert.equal(JSON.stringify(value).includes("migrator-secret"), false);
  assert.equal(JSON.stringify(value).includes("runtime-secret"), false);
  assert.equal(JSON.stringify(value).includes("backup-secret"), false);
  assert.equal(JSON.stringify(value).includes("superuser-secret"), false);
  assert.equal(JSON.stringify(value).includes("container-secret"), false);
});

test("config enables email verification with the complete Azure rollback path", async () => {
  const response = await worker.fetch(
    new Request("https://adg.sbay.sa/api/config"),
    {
      DB: {},
      EMAIL_VERIFICATION_ENABLED: "true",
      ACS_EMAIL_ENDPOINT: "https://example.communication.azure.com",
      ACS_EMAIL_SENDER_ADDRESS: "notifications@adg.sbay.sa",
      AZURE_TENANT_ID: "tenant",
      AZURE_CLIENT_ID: "client",
      AZURE_CLIENT_SECRET: "server-secret",
      AZURE_KEY_VAULT_URL: "https://vault.example",
      EMAIL_VERIFICATION_HMAC_SECRET_NAME: "email-hmac"
    }
  );
  const value = await response.json();
  assert.equal(value.accountEnabled, true);
  assert.equal(value.emailVerificationEnabled, true);
  assert.equal(JSON.stringify(value).includes("server-secret"), false);
});

test("config enables email verification with Graph mail and direct Worker secrets", async () => {
  const response = await worker.fetch(
    new Request("https://adg.sbay.sa/api/config"),
    {
      DB: {},
      EMAIL_VERIFICATION_ENABLED: "true",
      EMAIL_VERIFICATION_HMAC_SECRET_NAME: "email-hmac",
      EMAIL_VERIFICATION_HMAC_KEY: "direct-email-hmac",
      MAILER_TENANT_ID: "tenant",
      MAILER_CLIENT_ID: "client",
      MAILER_CLIENT_SECRET: "mailer-secret",
      MAILER_SENDER_ADDRESS: "notifications@adg.sbay.sa"
    }
  );
  const value = await response.json();
  assert.equal(value.accountEnabled, true);
  assert.equal(value.emailVerificationEnabled, true);
  assert.equal(JSON.stringify(value).includes("mailer-secret"), false);
});

test("draft progress follows the enabled linguistic controls", () => {
  assert.deepEqual(
    calculateDraftProgress({
      fields: [{
        structural: "true",
        predicate: "",
        tokens: [
          {
            upos: "NOUN",
            head: "1",
            relation: "nsubj",
            irabCategory: "faail",
            irabHead: ""
          },
          {
            upos: "PUNCT",
            head: "1",
            relation: "punct",
            irabCategory: "_",
            irabHead: ""
          }
        ]
      }]
    }),
    {
      completed: 9,
      total: 11,
      percentage: 82
    }
  );
});

test("admin callback uses the registered Microsoft redirect path", () => {
  assert.equal(
    adminCallbackUri({ ALLOWED_ORIGIN: "https://adg.sbay.sa" }),
    "https://adg.sbay.sa/signin-microsoft"
  );
});

test("legacy ADS links redirect to the canonical ADG domain", async () => {
  const response = await worker.fetch(
    new Request("https://ads.sbay.sa/admin/?from=old"),
    { ALLOWED_ORIGIN: "https://adg.sbay.sa" }
  );
  assert.equal(response.status, 308);
  assert.equal(
    response.headers.get("location"),
    "https://adg.sbay.sa/admin/?from=old"
  );
});

test("social usernames are normalized without collecting a phone number", () => {
  assert.deepEqual(
    validateAccountProfile({
      fullName: "محكّم تجريبي",
      email: "JUDGE@example.test",
      experienceYears: 12,
      specialization: "grammar",
      affiliation: null,
      socialAccounts: {
        whatsapp: "@judge_2026",
        x: "@ArabicJudge",
        otherPlatform: "منصة علمية",
        otherUsername: "@judge"
      }
    }),
    {
      fullName: "محكّم تجريبي",
      email: "judge@example.test",
      experienceYears: 12,
      specialization: "grammar",
      affiliation: null,
      socialAccounts: {
        whatsapp: "judge_2026",
        x: "ArabicJudge",
        otherUsername: "judge",
        otherPlatform: "منصة علمية"
      }
    }
  );
  assert.throws(
    () => validateAccountProfile({
      fullName: "محكّم تجريبي",
      email: "judge@example.test",
      experienceYears: 12,
      specialization: "grammar",
      socialAccounts: { whatsapp: "123456" }
    }),
    /واتساب/
  );
});

test("discussion email requires an explicit independent preference", () => {
  assert.deepEqual(
    validateAccountConsent({
      identityStorage: true,
      futureContact: true,
      discussionNotifications: true
    }),
    {
      identityStorage: true,
      futureContact: true,
      discussionNotifications: true
    }
  );
  assert.deepEqual(
    validateAccountConsent({ identityStorage: true }),
    {
      identityStorage: true,
      futureContact: false,
      discussionNotifications: false
    }
  );
});

test("WebAuthn base64url values round-trip without padding", () => {
  const source = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  const encoded = base64UrlFromBytes(source);
  assert.doesNotMatch(encoded, /[+/=]/);
  assert.deepEqual(base64UrlToBytes(encoded), source);
});

test("admin identity is anonymous without an admin cookie", async () => {
  const response = await worker.fetch(
    new Request("https://adg.sbay.sa/api/admin/auth/me"),
    {
      DB: {},
      ENTRA_TENANT_ID: "tenant",
      ENTRA_CLIENT_ID: "client",
      ENTRA_CLIENT_SECRET_NAME: "secret"
    }
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    authenticated: false,
    administrator: false
  });
});

test("admin progress fails closed without an admin cookie", async () => {
  const response = await worker.fetch(
    new Request("https://adg.sbay.sa/api/admin/progress"),
    {
      DB: {},
      ENTRA_TENANT_ID: "tenant",
      ENTRA_CLIENT_ID: "client",
      ENTRA_CLIENT_SECRET_NAME: "secret"
    }
  );
  assert.equal(response.status, 401);
});

test("foreign origins are rejected before processing", async () => {
  const response = await worker.fetch(
    new Request("https://adg.sbay.sa/api/submissions", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "content-type": "application/json"
      },
      body: "{}"
    }),
    {
      ALLOWED_ORIGIN: "https://adg.sbay.sa",
      SUBMISSION_ENABLED: "true"
    }
  );
  assert.equal(response.status, 403);
});

test("static responses receive restrictive headers", async () => {
  const response = await worker.fetch(
    new Request("https://adg.sbay.sa/"),
    {
      ASSETS: {
        fetch: async () => new Response("<h1>ok</h1>", {
          headers: { "content-type": "text/html" }
        })
      }
    }
  );
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-security-policy"),
    /frame-ancestors 'none'/
  );
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("EntityCrypt Matryoshka profile encrypts identities with AES-GCM", async () => {
  const plainText = JSON.stringify({
    fullName: "محكّم تجريبي",
    email: "judge@example.test",
    socialAccounts: { whatsapp: "judge_2026" }
  });
  const masterKey = "test-master-key-with-sufficient-entropy";
  const first = await encryptEntityCrypt(plainText, masterKey);
  const second = await encryptEntityCrypt(plainText, masterKey);
  assert.match(first, /^MK1:0:/);
  assert.notEqual(first, second);
  assert.equal(
    await decryptEntityCryptForTest(first, masterKey),
    plainText
  );
});
