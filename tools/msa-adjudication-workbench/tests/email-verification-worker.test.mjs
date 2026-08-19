import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/index.js";

class D1Statement {
  constructor(database, sql, bindings = []) {
    this.database = database;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new D1Statement(this.database, this.sql, bindings);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.bindings) ?? null;
  }

  async all() {
    return {
      results: this.database.prepare(this.sql).all(...this.bindings)
    };
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.bindings);
    return {
      success: true,
      meta: {
        changes: result.changes,
        last_row_id: result.lastInsertRowid
      }
    };
  }
}

class D1TestDatabase {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    for (const path of [
      "migrations/0001_passkeys.sql",
      "migrations/0002_admin_progress.sql",
      "migrations/0003_results_discussion.sql",
      "migrations/0004_consensus_state.sql",
      "migrations/0005_cpoly_recovery.sql",
      "migrations/0006_cpoly_backup_contract.sql",
      "migrations/0007_cpoly_recovery_state.sql",
      "migrations/0008_cpoly_backup_metadata_hash.sql",
      "migrations/0009_cpoly_backup_kv_lane.sql",
      "migrations/0010_repository_task_catalog.sql",
      "migrations/0011_portal_issue_reports.sql",
      "migrations/0012_task_state_repository_receipts.sql"
    ]) {
      this.database.exec(readFileSync(path, "utf8"));
    }
  }

  prepare(sql) {
    return new D1Statement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

test("email code is sent, verified, and bound to registration", async () => {
  const database = new D1TestDatabase();
  const sentMessages = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (new URL(url).hostname === "login.microsoftonline.com") {
      return Response.json({
        access_token: "test-token",
        expires_in: 3600
      });
    }
    if (url.includes(".vault.azure.net/secrets/")) {
      const value = url.includes("entity-key-test")
        ? "entity-key-material-for-tests-2026"
        : "email-hmac-material-for-tests-2026";
      return Response.json({ value });
    }
    if (url.includes("/emails:send")) {
      sentMessages.push(JSON.parse(init.body));
      return new Response(null, { status: 202 });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  };

  const origin = "https://adg-msa-adjudication-staging.2sa.workers.dev";
  const env = {
    DB: database,
    ALLOWED_ORIGIN: origin,
    EMAIL_VERIFICATION_ENABLED: "true",
    EMAIL_VERIFICATION_HMAC_SECRET_NAME: "email-hmac-test",
    ENTITYCRYPT_MASTER_KEY_SECRET_NAME: "entity-key-test",
    ACS_EMAIL_ENDPOINT: "https://acs-test.communication.azure.com",
    ACS_EMAIL_SENDER_ADDRESS: "notifications@adg.sbay.sa",
    AZURE_TENANT_ID: "tenant",
    AZURE_CLIENT_ID: "client",
    AZURE_CLIENT_SECRET: "client-secret",
    AZURE_KEY_VAULT_URL: "https://test.vault.azure.net"
  };

  try {
    const sendResponse = await worker.fetch(
      new Request(`${origin}/api/account/email/send-code`, {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "CF-Connecting-IP": "203.0.113.25"
        },
        body: JSON.stringify({ email: "Judge@Example.test" })
      }),
      env
    );
    assert.equal(sendResponse.status, 200);
    const sendResult = await sendResponse.json();
    assert.equal(sentMessages.length, 1);
    const code = sentMessages[0].content.plainText.match(/\b\d{6}\b/)?.[0];
    assert.match(code, /^\d{6}$/);

    const stored = database.database.prepare(
      `SELECT email_hash, code_hash
         FROM email_verifications
        WHERE id = ?`
    ).get(sendResult.verificationId);
    assert.notEqual(stored.email_hash, "judge@example.test");
    assert.notEqual(stored.code_hash, code);

    const verifyResponse = await worker.fetch(
      new Request(`${origin}/api/account/email/verify-code`, {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          verificationId: sendResult.verificationId,
          code
        })
      }),
      env
    );
    assert.equal(verifyResponse.status, 200);
    const verifyResult = await verifyResponse.json();
    assert.equal(verifyResult.verified, true);
    assert.ok(verifyResult.verificationToken.length >= 32);

    const existingUserId = "f70c06c4-02f3-47ba-a0b7-27ff260c93b4";
    const now = Date.now();
    database.database.prepare(
      `INSERT INTO users
        (id, profile_ciphertext, consent_json, verified_email_hash,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      existingUserId,
      "will-be-replaced-from-registration-challenge",
      JSON.stringify({
        identityStorage: true,
        futureContact: false,
        discussionNotifications: false
      }),
      stored.email_hash,
      now,
      now
    );
    database.database.prepare(
      `INSERT INTO passkeys
        (credential_id, user_id, public_key, counter, transports_json,
         device_type, backed_up, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "existing-passkey",
      existingUserId,
      "existing-public-key",
      0,
      JSON.stringify(["internal"]),
      "singleDevice",
      0,
      now
    );

    const registrationResponse = await worker.fetch(
      new Request(`${origin}/api/account/register/options`, {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          profile: {
            fullName: "محكّم تجريبي",
            email: "judge@example.test",
            experienceYears: 8,
            specialization: "grammar",
            affiliation: null,
            socialAccounts: {}
          },
          consent: {
            identityStorage: true,
            futureContact: false,
            discussionNotifications: false
          },
          emailVerificationToken: verifyResult.verificationToken
        })
      }),
      env
    );
    assert.equal(registrationResponse.status, 200);
    const registration = await registrationResponse.json();
    assert.equal(registration.accountMode, "existing");
    assert.equal(registration.options.user.name, "judge@example.test");
    assert.deepEqual(
      registration.options.excludeCredentials,
      [{
        id: "existing-passkey",
        type: "public-key",
        transports: ["internal"]
      }]
    );
    const reservation = database.database.prepare(
      `SELECT reservation_id, consumed_at
         FROM email_verifications
        WHERE id = ?`
    ).get(sendResult.verificationId);
    assert.equal(reservation.reservation_id, registration.challengeId);
    assert.equal(reservation.consumed_at, null);
    const registrationChallenge = database.database.prepare(
      `SELECT user_id, profile_ciphertext
         FROM webauthn_challenges
        WHERE id = ?`
    ).get(registration.challengeId);
    assert.equal(registrationChallenge.user_id, existingUserId);

    database.database.prepare(
      "UPDATE users SET profile_ciphertext = ? WHERE id = ?"
    ).run(registrationChallenge.profile_ciphertext, existingUserId);
    const sessionToken = "email-owned-account-session-token";
    const sessionDigest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(sessionToken)
    );
    const sessionHash = [...new Uint8Array(sessionDigest)]
      .map(value => value.toString(16).padStart(2, "0"))
      .join("");
    database.database.prepare(
      `INSERT INTO sessions
        (token_hash, user_id, expires_at, created_at)
       VALUES (?, ?, ?, ?)`
    ).run(
      sessionHash,
      existingUserId,
      now + 60_000,
      now
    );

    const additionalResponse = await worker.fetch(
      new Request(
        `${origin}/api/account/passkeys/register/options`,
        {
          method: "POST",
          headers: {
            origin,
            cookie: `adg_session=${sessionToken}`,
            "content-type": "application/json"
          },
          body: "{}"
        }
      ),
      env
    );
    assert.equal(additionalResponse.status, 200);
    const additional = await additionalResponse.json();
    assert.equal(additional.options.user.name, "judge@example.test");
    assert.deepEqual(
      additional.options.excludeCredentials,
      registration.options.excludeCredentials
    );
    const additionalChallenge = database.database.prepare(
      `SELECT user_id, email_verification_id, verified_email_hash
         FROM webauthn_challenges
        WHERE id = ?`
    ).get(additional.challengeId);
    assert.equal(additionalChallenge.user_id, existingUserId);
    assert.equal(additionalChallenge.email_verification_id, null);
    assert.equal(additionalChallenge.verified_email_hash, null);

    database.database.prepare(
      `INSERT INTO passkeys
        (credential_id, user_id, public_key, counter, transports_json,
         device_type, backed_up, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "second-passkey",
      existingUserId,
      "second-public-key",
      0,
      "[]",
      "multiDevice",
      1,
      now + 1
    );
    const accountResponse = await worker.fetch(
      new Request(`${origin}/api/account`, {
        headers: { cookie: `adg_session=${sessionToken}` }
      }),
      env
    );
    assert.equal(accountResponse.status, 200);
    const account = await accountResponse.json();
    assert.equal(account.userId, existingUserId);
    assert.equal(account.passkeyCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("email verification prefers locked Microsoft Graph mail with cached token reuse", async () => {
  const database = new D1TestDatabase();
  const tokenRequests = [];
  const sendRequests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname === "login.microsoftonline.com") {
      tokenRequests.push({
        path: url.pathname,
        body: String(init.body)
      });
      return Response.json({
        access_token: "graph-mail-token",
        expires_in: 3600
      });
    }
    if (url.hostname === "graph.microsoft.com") {
      sendRequests.push({
        path: url.pathname,
        authorization: init.headers.authorization,
        body: JSON.parse(init.body)
      });
      return new Response(null, { status: 202 });
    }
    if (url.pathname.endsWith("/emails:send")) {
      throw new Error("ACS should not be used when Graph mail is configured.");
    }
    throw new Error(`Unexpected fetch in Graph mail test: ${url}`);
  };

  const origin = "https://adg-msa-adjudication-staging.2sa.workers.dev";
  const env = {
    DB: database,
    ALLOWED_ORIGIN: origin,
    EMAIL_VERIFICATION_ENABLED: "true",
    EMAIL_VERIFICATION_HMAC_SECRET_NAME: "email-hmac-test",
    EMAIL_VERIFICATION_HMAC_KEY: "email-hmac-material-for-tests-2026",
    MAILER_TENANT_ID: "mailer-tenant",
    MAILER_CLIENT_ID: "mailer-client",
    MAILER_CLIENT_SECRET: "mailer-secret",
    MAILER_SENDER_ADDRESS: "Notifications@ADG.sbay.sa",
    ACS_EMAIL_ENDPOINT: "https://acs-test.communication.azure.com",
    ACS_EMAIL_SENDER_ADDRESS: "notifications@adg.sbay.sa",
    AZURE_TENANT_ID: "tenant",
    AZURE_CLIENT_ID: "client",
    AZURE_CLIENT_SECRET: "client-secret"
  };

  try {
    for (const email of ["judge-one@example.test", "judge-two@example.test"]) {
      const response = await worker.fetch(
        new Request(`${origin}/api/account/email/send-code`, {
          method: "POST",
          headers: {
            origin,
            "content-type": "application/json",
            "CF-Connecting-IP": "203.0.113.25"
          },
          body: JSON.stringify({ email })
        }),
        env
      );
      assert.equal(response.status, 200, await response.text());
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(tokenRequests.length, 1);
  assert.match(tokenRequests[0].path, /\/mailer-tenant\/oauth2\/v2\.0\/token$/);
  assert.match(tokenRequests[0].body, /scope=https%3A%2F%2Fgraph\.microsoft\.com%2F\.default/);
  assert.match(tokenRequests[0].body, /client_id=mailer-client/);
  assert.equal(sendRequests.length, 2);
  assert.deepEqual(
    sendRequests[0].body.message.toRecipients,
    [{ emailAddress: { address: "judge-one@example.test" } }]
  );
  assert.equal(sendRequests[0].body.saveToSentItems, true);
  assert.equal(sendRequests[0].body.message.from, undefined);
  assert.equal(
    sendRequests[0].path,
    "/v1.0/users/notifications%40adg.sbay.sa/sendMail"
  );
  assert.equal(sendRequests[0].authorization, "Bearer graph-mail-token");
  assert.deepEqual(
    sendRequests[0].body.message.internetMessageHeaders.map(header => header.name),
    ["X-ADG-Notification-Type", "X-ADG-Correlation-Id"]
  );
});

test("email verification surfaces Microsoft Graph delivery failures honestly", async () => {
  const database = new D1TestDatabase();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.hostname === "login.microsoftonline.com") {
      return Response.json({
        access_token: "graph-mail-token",
        expires_in: 3600
      });
    }
    if (url.hostname === "graph.microsoft.com") {
      return new Response("mailbox busy", { status: 500 });
    }
    throw new Error(`Unexpected fetch in Graph failure test: ${url}`);
  };

  const origin = "https://adg-msa-adjudication-staging.2sa.workers.dev";
  const env = {
    DB: database,
    ALLOWED_ORIGIN: origin,
    EMAIL_VERIFICATION_ENABLED: "true",
    EMAIL_VERIFICATION_HMAC_SECRET_NAME: "email-hmac-test",
    EMAIL_VERIFICATION_HMAC_KEY: "email-hmac-material-for-tests-2026",
    MAILER_TENANT_ID: "mailer-tenant",
    MAILER_CLIENT_ID: "mailer-client",
    MAILER_CLIENT_SECRET: "mailer-secret",
    MAILER_SENDER_ADDRESS: "notifications@adg.sbay.sa"
  };

  try {
    const response = await worker.fetch(
      new Request(`${origin}/api/account/email/send-code`, {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "CF-Connecting-IP": "203.0.113.25"
        },
        body: JSON.stringify({ email: "judge@example.test" })
      }),
      env
    );
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.match(body.message, /تعذر إرسال رمز التحقق/);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const count = database.database.prepare(
    "SELECT COUNT(*) AS count FROM email_verifications"
  ).get();
  assert.equal(count.count, 0);
});
