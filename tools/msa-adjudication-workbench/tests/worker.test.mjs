import assert from "node:assert/strict";
import test from "node:test";
import worker, {
  adminCallbackUri,
  base64UrlFromBytes,
  base64UrlToBytes,
  calculateDraftProgress,
  decryptEntityCryptForTest,
  encryptEntityCrypt
} from "../src/index.js";

test("config exposes no server secrets", async () => {
  const response = await worker.fetch(
    new Request("https://ads.sbay.sa/api/config"),
    {
      SUBMISSION_ENABLED: "false",
      MAX_SUBMISSION_BYTES: "900000",
      TURNSTILE_SITE_KEY: "public-site-key",
      GITHUB_REPOSITORY: "sbay-dev/ADG-Lang"
    }
  );
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.deepEqual(value, {
    submissionEnabled: false,
    maxSubmissionBytes: 900000,
    turnstileSiteKey: "public-site-key",
    repository: "sbay-dev/ADG-Lang",
    accountEnabled: false
  });
  assert.equal(JSON.stringify(value).includes("SECRET"), false);
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
    adminCallbackUri({ ALLOWED_ORIGIN: "https://ads.sbay.sa" }),
    "https://ads.sbay.sa/signin-microsoft"
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
    new Request("https://ads.sbay.sa/api/admin/auth/me"),
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
    new Request("https://ads.sbay.sa/api/admin/progress"),
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
    new Request("https://ads.sbay.sa/api/submissions", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "content-type": "application/json"
      },
      body: "{}"
    }),
    {
      ALLOWED_ORIGIN: "https://ads.sbay.sa",
      SUBMISSION_ENABLED: "true"
    }
  );
  assert.equal(response.status, 403);
});

test("static responses receive restrictive headers", async () => {
  const response = await worker.fetch(
    new Request("https://ads.sbay.sa/"),
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
    email: "judge@example.test"
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
