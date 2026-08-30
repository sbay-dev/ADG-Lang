import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/index.js";
import {
  PORTAL_ISSUE_REPORT_CLAIM_SCHEMA,
  PORTAL_ISSUE_REPORT_RECEIPT_SCHEMA
} from "../src/issue-reporting.js";

const origin = "https://adg-issues.test";
const repository = "sbay-dev/ADG-Lang";
const receiptKey = "repository-receipt-hmac-test";
const sessionToken = "issue-report-session-token";
const userId = "issue-report-user";

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
      "migrations/0012_task_state_repository_receipts.sql",
      "migrations/0013_cpoly_journal_disposition.sql"
    ]) {
      this.database.exec(readFileSync(path, "utf8"));
    }
    this.database.prepare(
      `INSERT INTO users
        (id, profile_ciphertext, consent_json, verified_email_hash,
         created_at, updated_at)
       VALUES (?, 'encrypted-profile', '{}', ?, ?, ?)`
    ).run(userId, "a".repeat(64), Date.now(), Date.now());
    this.database.prepare(
      `INSERT INTO sessions
        (token_hash, user_id, expires_at, created_at)
       VALUES (?, ?, ?, ?)`
    ).run(
      createHash("sha256").update(sessionToken).digest("hex"),
      userId,
      Date.now() + 60 * 60 * 1000,
      Date.now()
    );
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

test("authenticated reports queue only sanitized public payloads", async () => {
  const db = new D1TestDatabase();
  const reportId = randomUUID();
  const first = await sendReport(db, validReport(reportId));
  assert.equal(first.response.status, 202);
  assert.equal(first.value.accepted, true);
  assert.equal(first.value.duplicate, false);

  const stored = db.database.prepare(
    `SELECT user_id, payload_json, content_sha256, status
       FROM portal_issue_reports
      WHERE id = ?`
  ).get(reportId);
  assert.equal(stored.user_id, userId);
  assert.equal(stored.status, "pending");
  assert.equal(
    stored.content_sha256,
    createHash("sha256").update(stored.payload_json).digest("hex")
  );
  const publicText = stored.payload_json;
  assert.equal(publicText.includes(userId), false);
  assert.equal(publicText.includes("encrypted-profile"), false);
  assert.equal(publicText.includes("verified_email_hash"), false);
  assert.equal(publicText.includes("draft"), false);

  const duplicate = await sendReport(db, validReport(reportId));
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.value.duplicate, true);
  assert.equal(
    db.database.prepare(
      "SELECT COUNT(*) AS count FROM portal_issue_reports"
    ).get().count,
    1
  );
});

test("report endpoint rejects unauthenticated, private, and unknown content", async () => {
  const db = new D1TestDatabase();
  const unauthenticated = await worker.fetch(
    new Request(`${origin}/api/issue-reports`, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json"
      },
      body: JSON.stringify(validReport(randomUUID()))
    }),
    baseEnv(db)
  );
  assert.equal(unauthenticated.status, 401);

  const privateReport = validReport(randomUUID(), {
    details: "يمكن التواصل معي عبر reviewer@example.test لتوضيح الخلل."
  });
  assert.equal((await sendReport(db, privateReport)).response.status, 400);

  const unknown = {
    ...validReport(randomUUID()),
    draft: { answers: ["private"] }
  };
  assert.equal((await sendReport(db, unknown)).response.status, 400);
});

test("report endpoint enforces bounded per-account rates", async () => {
  const db = new D1TestDatabase();
  for (let index = 0; index < 5; index += 1) {
    const result = await sendReport(
      db,
      validReport(randomUUID(), {
        summary: `خلل متكرر في قائمة المهام رقم ${index + 1}`
      })
    );
    assert.equal(result.response.status, 202);
  }
  const limited = await sendReport(
    db,
    validReport(randomUUID(), {
      summary: "خلل متكرر في قائمة المهام بعد الحد"
    })
  );
  assert.equal(limited.response.status, 429);
});

test("signed claim and receipt publish one issue without identity leakage", async () => {
  const db = new D1TestDatabase();
  const reportId = randomUUID();
  await sendReport(db, validReport(reportId));
  const nonce = randomUUID();
  const claimResponse = await worker.fetch(
    signedClaimRequest(nonce),
    baseEnv(db)
  );
  const claim = await claimResponse.json();
  assert.equal(claimResponse.status, 200);
  assert.equal(claim.claim.count, 1);
  assert.equal(claim.items[0].reportId, reportId);
  assert.equal(JSON.stringify(claim).includes(userId), false);
  assert.equal(JSON.stringify(claim).includes("encrypted-profile"), false);

  const replay = await worker.fetch(
    signedClaimRequest(nonce),
    baseEnv(db)
  );
  assert.equal((await replay.json()).claim.count, 1);

  const issueUrl = `https://github.com/${repository}/issues/42`;
  const receiptResponse = await worker.fetch(
    signedReceiptRequest({
      claimNonce: nonce,
      reportId,
      contentSha256: claim.items[0].contentSha256,
      issueNumber: 42,
      issueUrl
    }),
    baseEnv(db)
  );
  const receipt = await receiptResponse.json();
  assert.equal(receiptResponse.status, 202);
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.duplicate, false);

  const duplicateReceipt = await worker.fetch(
    signedReceiptRequest({
      claimNonce: nonce,
      reportId,
      contentSha256: claim.items[0].contentSha256,
      issueNumber: 42,
      issueUrl
    }),
    baseEnv(db)
  );
  assert.equal((await duplicateReceipt.json()).duplicate, true);

  const listing = await accountRequest(db, "/api/issue-reports");
  assert.equal(listing.response.status, 200);
  assert.equal(listing.value.reports[0].status, "published");
  assert.equal(listing.value.reports[0].issueNumber, 42);
  assert.equal(listing.value.reports[0].issueUrl, issueUrl);
});

test("claim nonces are idempotent even when the first claim is empty", async () => {
  const db = new D1TestDatabase();
  const nonce = randomUUID();
  const empty = await worker.fetch(signedClaimRequest(nonce), baseEnv(db));
  assert.equal((await empty.json()).claim.count, 0);

  await sendReport(db, validReport(randomUUID()));
  const replay = await worker.fetch(signedClaimRequest(nonce), baseEnv(db));
  assert.equal((await replay.json()).claim.count, 0);

  const next = await worker.fetch(
    signedClaimRequest(randomUUID()),
    baseEnv(db)
  );
  assert.equal((await next.json()).claim.count, 1);
});

test("issue receipts reject an expired claim after the report is reclaimed", async () => {
  const db = new D1TestDatabase();
  const reportId = randomUUID();
  await sendReport(db, validReport(reportId));
  const firstNonce = randomUUID();
  const firstClaimResponse = await worker.fetch(
    signedClaimRequest(firstNonce),
    baseEnv(db)
  );
  const firstClaim = await firstClaimResponse.json();
  db.database.prepare(
    `UPDATE portal_issue_reports
        SET claim_expires_at = ?
      WHERE id = ?`
  ).run(Date.now() - 1, reportId);
  const secondNonce = randomUUID();
  const secondClaimResponse = await worker.fetch(
    signedClaimRequest(secondNonce),
    baseEnv(db)
  );
  assert.equal((await secondClaimResponse.json()).claim.count, 1);

  const issueUrl = `https://github.com/${repository}/issues/42`;
  const staleReceipt = await worker.fetch(
    signedReceiptRequest({
      claimNonce: firstNonce,
      reportId,
      contentSha256: firstClaim.items[0].contentSha256,
      issueNumber: 42,
      issueUrl
    }),
    baseEnv(db)
  );
  assert.equal(staleReceipt.status, 409);

  const currentReceipt = await worker.fetch(
    signedReceiptRequest({
      claimNonce: secondNonce,
      reportId,
      contentSha256: firstClaim.items[0].contentSha256,
      issueNumber: 42,
      issueUrl
    }),
    baseEnv(db)
  );
  assert.equal(currentReceipt.status, 202);
});

test("issue receipt rejects signatures and noncanonical GitHub URLs", async () => {
  const db = new D1TestDatabase();
  const invalidClaim = await worker.fetch(
    signedClaimRequest(randomUUID(), "wrong-key"),
    baseEnv(db)
  );
  assert.equal(invalidClaim.status, 401);

  const reportId = randomUUID();
  await sendReport(db, validReport(reportId));
  const claimNonce = randomUUID();
  const claimResponse = await worker.fetch(
    signedClaimRequest(claimNonce),
    baseEnv(db)
  );
  const claim = await claimResponse.json();
  const invalidReceipt = await worker.fetch(
    signedReceiptRequest({
      claimNonce,
      reportId,
      contentSha256: claim.items[0].contentSha256,
      issueNumber: 42,
      issueUrl: "https://github.com/attacker/repo/issues/42"
    }),
    baseEnv(db)
  );
  assert.equal(invalidReceipt.status, 400);
});

function validReport(reportId, overrides = {}) {
  return {
    schema: "adg-portal-issue-report-v1",
    reportId,
    category: "task-inbox",
    summary: "لا تظهر العيّنة الأساسية في قائمة المهام",
    details:
      "بعد تسجيل الدخول وفتح الخطوة الثالثة بقيت قائمة المهام فارغة.",
    reproductionSteps:
      "سجلت الدخول ثم انتقلت إلى الخطوة الثالثة وضغطت تحديث القائمة.",
    privacyConfirmed: true,
    context: {
      portalVersion: "15.2.3",
      step: 3,
      taskVersionId: "msa-adjudication-pilot:v1",
      taskLane: "operational-test",
      operationalMode: true
    },
    ...overrides
  };
}

async function sendReport(db, body) {
  return accountRequest(db, "/api/issue-reports", {
    method: "POST",
    body
  });
}

async function accountRequest(db, path, options = {}) {
  const response = await worker.fetch(
    new Request(`${origin}${path}`, {
      method: options.method || "GET",
      headers: {
        origin,
        cookie: `adg_session=${sessionToken}`,
        accept: "application/json",
        ...(options.body ? { "content-type": "application/json" } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    }),
    baseEnv(db)
  );
  return {
    response,
    value: await response.json()
  };
}

function signedClaimRequest(nonce, key = receiptKey) {
  const envelope = {
    schema: PORTAL_ISSUE_REPORT_CLAIM_SCHEMA,
    repository,
    nonce,
    requestedAtUtc: new Date().toISOString(),
    maxItems: 20
  };
  return new Request(
    `${origin}/api/repository/issue-reports/claim`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sign(envelope, key))
    }
  );
}

function signedReceiptRequest({
  claimNonce,
  reportId,
  contentSha256,
  issueNumber,
  issueUrl
}) {
  const envelope = {
    schema: PORTAL_ISSUE_REPORT_RECEIPT_SCHEMA,
    repository,
    nonce: randomUUID(),
    claimNonce,
    reportId,
    contentSha256,
    issueNumber,
    issueUrl,
    acceptedAtUtc: new Date().toISOString()
  };
  return new Request(
    `${origin}/api/repository/issue-reports/receipts`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sign(envelope, receiptKey))
    }
  );
}

function sign(envelope, key) {
  return {
    ...envelope,
    hmacSha256: createHmac("sha256", key)
      .update(JSON.stringify(envelope))
      .digest("hex")
  };
}

function baseEnv(db) {
  return {
    DB: db,
    ALLOWED_ORIGIN: origin,
    GITHUB_REPOSITORY: repository,
    REPOSITORY_RECEIPT_HMAC_SECRET_NAME: "repository-receipt",
    REPOSITORY_RECEIPT_HMAC_KEY: receiptKey,
    ASSETS: {
      fetch: async () => new Response("not found", { status: 404 })
    }
  };
}
