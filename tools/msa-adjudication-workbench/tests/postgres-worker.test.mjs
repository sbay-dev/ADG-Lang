import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import worker, {
  decryptEntityCryptForTest,
  encryptEntityCrypt
} from "../src/index.js";
import { computePacketMerkleRoot } from "../public/protocol.js";
import {
  buildCpolyCanonicalText,
  hmacSha256Hex,
  sha256HexBytes
} from "../src/cpoly-recovery.js";
import { createRuntimeEnv } from "../src/database.js";
import { createPostgresFixture, dockerAvailable } from "./postgres-test-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const origin = "https://adg-postgres.test";
const repository = "sbay-dev/ADG-Lang";
const entityKey = "entity-key-material-for-tests-2026";
const emailHmacKey = "email-hmac-material-for-tests-2026";
const repositoryHmacKey = "repository-hmac-material-for-tests-2026";
const recoveryMasterKey = "cpoly-backup-master-key-test-2026";
const openPgpFixture = Uint8Array.from(Buffer.from(
  readFileSync(
    path.join(__dirname, "fixtures", "cpoly-openpgp-symmetric-aes256.base64"),
    "ascii"
  ).trim(),
  "base64"
));
const BACKUP_CLAIM_BOUNDARY = (
  "This proves creation, integrity, encryption, and the requested restore " +
  "test only. Off-host replication and recovery-time objectives require " +
  "separate scheduled operations."
);

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
      success: true,
      results: this.database.prepare(this.sql).all(...this.bindings),
      meta: { changes: 0 }
    };
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.bindings);
    return {
      success: true,
      meta: {
        changes: Number(result.changes || 0),
        last_row_id: Number(result.lastInsertRowid || 0)
      }
    };
  }
}

class D1RecoveryDatabase {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    for (const path of [
      "migrations/0005_cpoly_recovery.sql",
      "migrations/0006_cpoly_backup_contract.sql",
      "migrations/0007_cpoly_recovery_state.sql",
      "migrations/0008_cpoly_backup_metadata_hash.sql",
      "migrations/0009_cpoly_backup_kv_lane.sql",
      "migrations/0013_cpoly_journal_disposition.sql"
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

class MemoryKvNamespace {
  constructor() {
    this.entries = new Map();
  }

  async put(name, value, options = {}) {
    const bytes = value instanceof Uint8Array
      ? Uint8Array.from(value)
      : new Uint8Array(value);
    this.entries.set(String(name), {
      bytes,
      metadata: options.metadata ?? null
    });
  }

  async get(name, type = "text") {
    const entry = this.entries.get(String(name));
    if (!entry) return null;
    if (type === "arrayBuffer" || type?.type === "arrayBuffer") {
      return entry.bytes.buffer.slice(
        entry.bytes.byteOffset,
        entry.bytes.byteOffset + entry.bytes.byteLength
      );
    }
    return new TextDecoder().decode(entry.bytes);
  }

  async delete(name) {
    this.entries.delete(String(name));
  }
}

test("recovery begin/status/complete gates dynamic traffic until PostgreSQL replay is ready", {
  skip: !dockerAvailable
}, async () => {
    const fixture = await createPostgresFixture("recovery-gate");
    const recoveryDb = new D1RecoveryDatabase();
    const env = {
      DB: recoveryDb,
      CPOLY_BACKUPS: new MemoryKvNamespace(),
      HYPERDRIVE: {
        connectionString: fixture.connectionString
      },
      CPOLY_BACKUP_MASTER_KEY: recoveryMasterKey,
      CPOLY_BACKUP_HMAC_KEY: "cpoly-backup-hmac-test-key-material-2026"
    };
    const runtimeEnv = createRuntimeEnv(env);
    try {
      await runtimeEnv.DB.prepare(
        `INSERT INTO admin_oidc_states
          (state_hash, ciphertext, expires_at, created_at)
         VALUES (?, ?, ?, ?)`
      ).bind("state-hash", "ciphertext", 10, 10).run();
      const receipt = (await fixture.sql`
        SELECT generation, receipt_seq
          FROM cpoly_write_receipts
         ORDER BY receipt_seq ASC
         LIMIT 1
      `)[0];
      assert.equal(Number(receipt.generation), 1);
      assert.equal(Number(receipt.receipt_seq), 1);

      const spec = buildRecoveryBackupSpec({
        snapshotGeneration: 1,
        postgresReceiptWatermark: 1
      });
      const createResponse = await worker.fetch(
        await signedRecoveryRequest("/api/internal/cpoly-backups", {
          method: "POST",
          body: jsonBytes(spec.createBody),
          secret: env.CPOLY_BACKUP_HMAC_KEY
        }),
        env
      );
      assert.equal(createResponse.status, 201);
      const created = await createResponse.json();
      const backupId = created.backup.backupId;
      for (const [index, chunk] of spec.chunks.entries()) {
        const upload = await worker.fetch(
          await signedRecoveryRequest(
            `/api/internal/cpoly-backups/${backupId}/chunks/${index}`,
            {
              method: "PUT",
              body: chunk,
              secret: env.CPOLY_BACKUP_HMAC_KEY
            }
          ),
          env
        );
        assert.equal(upload.status, 200);
      }
      const completeBackup = await worker.fetch(
        await signedRecoveryRequest(
          `/api/internal/cpoly-backups/${backupId}/complete`,
          {
            method: "POST",
            body: jsonBytes(spec.completeBody),
            secret: env.CPOLY_BACKUP_HMAC_KEY
          }
        ),
        env
      );
      assert.equal(completeBackup.status, 200);

      const begin = await worker.fetch(
        await signedRecoveryRequest("/api/internal/cpoly-recovery/begin", {
          method: "POST",
          body: jsonBytes({
            schema: "adg-cpoly-recovery-begin-v1",
            backupId,
            snapshotGeneration: 1,
            snapshotWatermark: 1
          }),
          secret: env.CPOLY_BACKUP_HMAC_KEY
        }),
        env
      );
      assert.equal(begin.status, 200);
      const beginPayload = await begin.json();
      assert.equal(beginPayload.recovery.state, "recovering");
      assert.equal(beginPayload.recovery.restoreBackupId, backupId);
      assert.equal(beginPayload.recovery.targetGeneration, 2);

      recoveryDb.database.prepare(
        `UPDATE cpoly_recovery_runtime
            SET restore_lease_expires_at = 0,
                last_error = 'expired lease probe'
          WHERE slot = 'global'`
      ).run();
      recoveryDb.database.prepare(
        `UPDATE cpoly_backup_sets
            SET restore_lease_expires_at = 0
          WHERE id = ?`
      ).run(backupId);
      const resumed = await worker.fetch(
        await signedRecoveryRequest("/api/internal/cpoly-recovery/begin", {
          method: "POST",
          body: jsonBytes({
            schema: "adg-cpoly-recovery-begin-v1",
            backupId,
            snapshotGeneration: 1,
            snapshotWatermark: 1
          }),
          secret: env.CPOLY_BACKUP_HMAC_KEY
        }),
        env
      );
      assert.equal(resumed.status, 200);
      const resumedPayload = await resumed.json();
      assert.equal(
        resumedPayload.recovery.recoveryId,
        beginPayload.recovery.recoveryId
      );
      assert.ok(
        Date.parse(resumedPayload.recovery.restoreLeaseExpiresAtUtc) > Date.now()
      );
      const renewedRuntime = recoveryDb.database.prepare(
        `SELECT restore_lease_expires_at, last_error
           FROM cpoly_recovery_runtime
          WHERE slot = 'global'`
      ).get();
      const renewedBackup = recoveryDb.database.prepare(
        `SELECT restore_lease_expires_at
           FROM cpoly_backup_sets
          WHERE id = ?`
      ).get(backupId);
      assert.ok(Number(renewedRuntime.restore_lease_expires_at) > Date.now());
      assert.equal(renewedRuntime.last_error, null);
      assert.equal(
        Number(renewedBackup.restore_lease_expires_at),
        Number(renewedRuntime.restore_lease_expires_at)
      );

      const gatedConfig = await worker.fetch(
        new Request(`${origin}/api/config`, { method: "GET" }),
        env
      );
      assert.equal(gatedConfig.status, 503);

      const status = await worker.fetch(
        await signedRecoveryRequest("/api/internal/cpoly-recovery/status", {
          method: "GET",
          secret: env.CPOLY_BACKUP_HMAC_KEY
        }),
        env
      );
      assert.equal(status.status, 200);
      const statusPayload = await status.json();
      assert.equal(statusPayload.recovery.state, "recovering");

      const completeRecovery = await worker.fetch(
        await signedRecoveryRequest("/api/internal/cpoly-recovery/complete", {
          method: "POST",
          body: jsonBytes({
            schema: "adg-cpoly-recovery-complete-v1",
            recoveryId: beginPayload.recovery.recoveryId,
            backupId,
            snapshotGeneration: 1,
            snapshotWatermark: 1
          }),
          secret: env.CPOLY_BACKUP_HMAC_KEY
        }),
        env
      );
      assert.equal(completeRecovery.status, 200);
      const completePayload = await completeRecovery.json();
      assert.equal(completePayload.recovery.state, "ready");
      assert.equal(completePayload.recovery.readyGeneration, 2);
      assert.equal(completePayload.replay.generation, 2);
      assert.ok(Number(completePayload.replay.receiptSeq) >= 1);

      const restoredConfig = await worker.fetch(
        new Request(`${origin}/api/config`, { method: "GET" }),
        env
      );
      assert.equal(restoredConfig.status, 200);
    } finally {
      await runtimeEnv.__runtimeCleanup__?.();
      recoveryDb.database.close();
      await fixture.close();
    }
});

test("email verification works through Hyperdrive PostgreSQL with Graph mail", {
  skip: !dockerAvailable
}, async () => {
  const fixture = await createPostgresFixture("email");
  const recoveryDb = new D1RecoveryDatabase();
  const sentMessages = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname === "login.microsoftonline.com") {
      return Response.json({
        access_token: "graph-mail-token",
        expires_in: 3600
      });
    }
    if (url.hostname === "graph.microsoft.com") {
      sentMessages.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 202 });
    }
    throw new Error(`Unexpected fetch in Hyperdrive mail test: ${url}`);
  };

  const env = {
    DB: recoveryDb,
    HYPERDRIVE: {
      connectionString: fixture.connectionString
    },
    CPOLY_BACKUP_MASTER_KEY: recoveryMasterKey,
    ALLOWED_ORIGIN: origin,
    EMAIL_VERIFICATION_ENABLED: "true",
    EMAIL_VERIFICATION_HMAC_SECRET_NAME: "email-hmac-test",
    EMAIL_VERIFICATION_HMAC_KEY: emailHmacKey,
    ENTITYCRYPT_MASTER_KEY_SECRET_NAME: "entity-key-test",
    ENTITYCRYPT_MASTER_KEY: entityKey,
    MAILER_TENANT_ID: "mailer-tenant",
    MAILER_CLIENT_ID: "mailer-client",
    MAILER_CLIENT_SECRET: "mailer-secret",
    MAILER_SENDER_ADDRESS: "notifications@adg.sbay.sa"
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
    const code = sentMessages[0].message.body.content.match(/\b\d{6}\b/u)?.[0];
    assert.match(code, /^\d{6}$/u);

    const stored = (await fixture.sql`
      SELECT email_hash, code_hash
        FROM email_verifications
       WHERE id = ${sendResult.verificationId}
    `)[0];
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
    const reservation = (await fixture.sql`
      SELECT reservation_id, consumed_at
        FROM email_verifications
       WHERE id = ${sendResult.verificationId}
    `)[0];
    assert.equal(reservation.reservation_id, registration.challengeId);
    assert.equal(reservation.consumed_at, null);
  } finally {
    globalThis.fetch = originalFetch;
    recoveryDb.database.close();
    await fixture.close();
  }
});

test("repository receipts and evidence receipts work through Hyperdrive PostgreSQL", {
  skip: !dockerAvailable
}, async () => {
  const fixture = await createPostgresFixture("receipts");
  const recoveryDb = new D1RecoveryDatabase();
  const now = Date.now();
  const taskVersionId = "task-version-test";
  const roundId = "task-version-test:round:1";
  const finalReceiptId = "final-receipt-test";
  const approvedEventId = "approved-event-test";
  const finalMerkleRoot = "a".repeat(64);
  const submissionReceiptId = "11111111-1111-4111-8111-111111111111";
  const openTaskVersionId = "task-version-open-test";
  const openRoundId = "task-version-open-test:round:1";
  const openEventId = "task-open:task-version-open-test";
  const openStatePayload = JSON.stringify({
    schema: "adg-msa-task-state-v1",
    nonce: openEventId,
    eventId: openEventId,
    taskVersionId: openTaskVersionId,
    toState: "open",
    stateVersion: 0,
    hmacSha256: "f".repeat(64)
  });

  await fixture.sql.unsafe(`
    INSERT INTO users (id, profile_ciphertext, consent_json, created_at, updated_at)
    VALUES
      ('user-final', 'cipher', '{}', ${now}, ${now}),
      ('user-submission', 'cipher', '{}', ${now}, ${now});

    INSERT INTO task_versions (
      id, task_id, task_version, packet_id, holdout_id, packet_merkle_root,
      guideline_version, data_version, protocol_version, metric_policy_json,
      state, state_version, current_round, last_event_id, active_final_receipt_id,
      repository_status, created_at, updated_at, approved_at, appeal_deadline_at
    ) VALUES (
      '${taskVersionId}', 'task', 1, 'packet', 'holdout', '${"b".repeat(64)}',
      'guideline-v1', 'data-v1', 'protocol-v1', '{}',
      'approved', 1, 1, '${approvedEventId}', '${finalReceiptId}',
      'pending', ${now}, ${now}, ${now}, ${now - 1000}
    ), (
      '${openTaskVersionId}', 'task-open', 1, 'packet-open', 'holdout-open',
      '${"d".repeat(64)}', 'guideline-v1', 'data-v1', 'protocol-v1', '{}',
      'open', 0, 1, '${openEventId}', NULL,
      'not-sent', ${now}, ${now}, NULL, NULL
    );

    INSERT INTO consensus_rounds (
      id, task_version_id, round_number, status, opened_at, deadline_at, closed_at
    ) VALUES (
      '${roundId}', '${taskVersionId}', 1, 'closed', ${now - 2000}, ${now - 1000}, ${now - 500}
    ), (
      '${openRoundId}', '${openTaskVersionId}', 1, 'open',
      ${now}, ${now + 86400000}, NULL
    );

    INSERT INTO submissions (
      receipt_id, user_id, packet_id, role, artifact_sha256, submitted_at,
      repository_status, task_version_id, round_id, holdout_id,
      guideline_version, data_version, protocol_version, consensus_role, consensus_round
    ) VALUES
    (
      '${finalReceiptId}', 'user-final', 'packet', 'ratification', 'c', ${now},
      'pending-validation', '${taskVersionId}', '${roundId}', 'holdout',
      'guideline-v1', 'data-v1', 'protocol-v1', 'J1', 1
    ),
    (
      '${submissionReceiptId}', 'user-submission', 'packet', 'annotation-a', 'd', ${now},
      'pending-validation', '${taskVersionId}', '${roundId}', 'holdout',
      'guideline-v1', 'data-v1', 'protocol-v1', 'A', 1
    );

    INSERT INTO consensus_events (
      id, task_version_id, round_id, event_type, from_state, to_state,
      reason_code, evidence_json, event_hash, idempotency_key, created_at
    ) VALUES (
      '${approvedEventId}', '${taskVersionId}', '${roundId}', 'result-approved',
      'final-review', 'approved', 'test', '{}', '${"c".repeat(64)}',
      'approved-event-test', ${now}
    ), (
      '${openEventId}', '${openTaskVersionId}', '${openRoundId}', 'task-opened',
      'draft', 'open', 'test', '{}', '${"e".repeat(64)}',
      '${openEventId}', ${now}
    );

    INSERT INTO final_results (
      primary_receipt_id, task_version_id, round_id, final_merkle_root,
      status, proposed_at, approved_at
    ) VALUES (
      '${finalReceiptId}', '${taskVersionId}', '${roundId}', '${finalMerkleRoot}',
      'active', ${now}, ${now}
    );

    INSERT INTO evidence_outbox (
      id, kind, task_version_id, related_id, public_blob_name,
      public_payload_json, dedupe_key, status, attempts, next_attempt_at, created_at
    ) VALUES
    (
      'outbox-task-state', 'task-state', '${taskVersionId}', '${approvedEventId}',
      '${approvedEventId}.state.json', '{"schema":"public"}', 'task-state-key',
      'pending', 0, ${now}, ${now}
    ),
    (
      'outbox-submission', 'submission', '${taskVersionId}', '${submissionReceiptId}',
      '${submissionReceiptId}.json', '{"schema":"public"}', 'submission-key',
      'pending', 0, ${now}, ${now}
    ),
    (
      'outbox-task-state-open', 'task-state', '${openTaskVersionId}', '${openEventId}',
      '${openEventId}.state.json', '${openStatePayload}', 'task-state-open-key',
      'pending', 0, ${now}, ${now}
    );
  `);

  const env = {
    DB: recoveryDb,
    HYPERDRIVE: {
      connectionString: fixture.connectionString
    },
    CPOLY_BACKUP_MASTER_KEY: recoveryMasterKey,
    GITHUB_REPOSITORY: repository,
    REPOSITORY_RECEIPT_HMAC_SECRET_NAME: "repository-receipt-test",
    REPOSITORY_RECEIPT_HMAC_KEY: repositoryHmacKey,
    SUBMISSION_HMAC_SECRET_NAME: "submission-hmac-test",
    SUBMISSION_HMAC_KEY: "submission-hmac-material-for-tests-2026",
    ENTITYCRYPT_MASTER_KEY_SECRET_NAME: "entity-key-test",
    ENTITYCRYPT_MASTER_KEY: entityKey
  };

  try {
    const acceptedAtUtc = new Date(now).toISOString();
    const receipt = {
      schema: "adg-msa-repository-receipt-v1",
      receiptId: "22222222-2222-4222-8222-222222222222",
      taskVersionId,
      roundId,
      finalMerkleRoot,
      nonce: approvedEventId,
      repository,
      prNumber: 42,
      prMergeSha: "d".repeat(40),
      importerCommitSha: "e".repeat(40),
      receivedAtUtc: acceptedAtUtc,
      acceptedAtUtc
    };
    const receiptResponse = await worker.fetch(
      new Request(`${origin}/api/repository/receipts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...receipt,
          hmacSha256: createHmac("sha256", repositoryHmacKey)
            .update(JSON.stringify(receipt))
            .digest("hex")
        })
      }),
      env
    );
    const receiptText = await receiptResponse.text();
    assert.equal(receiptResponse.status, 202, receiptText);
    const receiptResult = JSON.parse(receiptText);
    assert.equal(receiptResult.state, "published");
    assert.equal(receiptResult.publicationDeferred, false);
    const published = (await fixture.sql`
      SELECT state, repository_status
        FROM task_versions
       WHERE id = ${taskVersionId}
    `)[0];
    assert.deepEqual(published, {
      state: "published",
      repository_status: "accepted"
    });

    const evidenceReceipt = {
      schema: "adg-msa-evidence-receipt-v1",
      receiptId: "33333333-3333-4333-8333-333333333333",
      evidenceKind: "submission",
      relatedId: submissionReceiptId,
      repository,
      prNumber: 43,
      prMergeSha: "f".repeat(40),
      importerCommitSha: "0".repeat(40),
      acceptedAtUtc
    };
    const evidenceResponse = await worker.fetch(
      new Request(`${origin}/api/repository/receipts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...evidenceReceipt,
          hmacSha256: createHmac("sha256", repositoryHmacKey)
            .update(JSON.stringify(evidenceReceipt))
            .digest("hex")
        })
      }),
      env
    );
    assert.equal(evidenceResponse.status, 202, await evidenceResponse.text());
    const taskStateReceipt = {
      schema: "adg-msa-task-state-receipt-v1",
      receiptId: "44444444-4444-4444-8444-444444444444",
      taskVersionId: openTaskVersionId,
      eventId: openEventId,
      toState: "open",
      stateVersion: 0,
      repository,
      prNumber: 44,
      prMergeSha: "1".repeat(40),
      importerCommitSha: "2".repeat(40),
      issueNumber: 18,
      acceptedAtUtc
    };
    const taskStateResponse = await worker.fetch(
      new Request(`${origin}/api/repository/receipts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...taskStateReceipt,
          hmacSha256: createHmac("sha256", repositoryHmacKey)
            .update(JSON.stringify(taskStateReceipt))
            .digest("hex")
        })
      }),
      env
    );
    assert.equal(
      taskStateResponse.status,
      202,
      await taskStateResponse.text()
    );
    const submission = (await fixture.sql`
      SELECT repository_status
        FROM submissions
       WHERE receipt_id = ${submissionReceiptId}
    `)[0];
    assert.equal(submission.repository_status, "imported");
    const taskStateOutbox = (await fixture.sql`
      SELECT status
        FROM evidence_outbox
       WHERE id = 'outbox-task-state'
    `)[0];
    const submissionOutbox = (await fixture.sql`
      SELECT status
        FROM evidence_outbox
       WHERE id = 'outbox-submission'
    `)[0];
    const openTaskStateOutbox = (await fixture.sql`
      SELECT status
        FROM evidence_outbox
       WHERE id = 'outbox-task-state-open'
    `)[0];
    const openTaskStateReceipt = (await fixture.sql`
      SELECT to_state, state_version, pr_number, issue_number
        FROM task_state_repository_receipts
       WHERE task_version_id = ${openTaskVersionId}
         AND event_id = ${openEventId}
    `)[0];
    assert.equal(taskStateOutbox.status, "sent");
    assert.equal(submissionOutbox.status, "sent");
    assert.equal(openTaskStateOutbox.status, "sent");
    assert.equal(openTaskStateReceipt.to_state, "open");
    assert.equal(openTaskStateReceipt.state_version, 0);
    assert.equal(Number(openTaskStateReceipt.pr_number), 44);
    assert.equal(Number(openTaskStateReceipt.issue_number), 18);
  } finally {
    recoveryDb.database.close();
    await fixture.close();
  }
});

test("repository task synchronization is atomic through Hyperdrive PostgreSQL", {
  skip: !dockerAvailable
}, async () => {
  const fixture = await createPostgresFixture("repository-task-sync");
  const recoveryDb = new D1RecoveryDatabase();
  const packet = JSON.parse(readFileSync(
    path.resolve(
      __dirname,
      "../../../examples/arabic-text/msa-adjudication-pilot-v1/packet.json"
    ),
    "utf8"
  ));
  const packetMerkleRoot = await computePacketMerkleRoot(packet);
  const sourcePath =
    "human-evidence/tasks/msa-adjudication-pilot-v1.task.json";
  const manifest = {
    schema: "adg-msa-repository-task-v1",
    titleAr: "اختبار مزامنة مهمة المستودع",
    summaryAr:
      "حزمة موثقة لاختبار التثبيت الذري عبر محول PostgreSQL.",
    assignmentMode: "open",
    lane: "operational-test",
    status: "active",
    sourcePath,
    packetMerkleRoot,
    packet
  };
  const env = {
    DB: recoveryDb,
    HYPERDRIVE: {
      connectionString: fixture.connectionString
    },
    CPOLY_BACKUP_MASTER_KEY: recoveryMasterKey,
    GITHUB_REPOSITORY: repository,
    REPOSITORY_RECEIPT_HMAC_SECRET_NAME: "repository-receipt-test",
    REPOSITORY_RECEIPT_HMAC_KEY: repositoryHmacKey
  };
  try {
    const firstCommit = "1".repeat(40);
    const firstEnvelope = {
      schema: "adg-msa-repository-task-sync-v1",
      repository,
      sourceCommitSha: firstCommit,
      nonce: "11111111-2222-4333-8444-555555555555",
      requestedAtUtc: new Date().toISOString(),
      tasks: [manifest]
    };
    const firstResponse = await worker.fetch(
      new Request(`${origin}/api/repository/tasks/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...firstEnvelope,
          hmacSha256: createHmac("sha256", repositoryHmacKey)
            .update(JSON.stringify(firstEnvelope))
            .digest("hex")
        })
      }),
      env
    );
    assert.equal(firstResponse.status, 202, await firstResponse.text());

    const secondEnvelope = {
      ...firstEnvelope,
      sourceCommitSha: "2".repeat(40),
      nonce: "22222222-3333-4444-8555-666666666666",
      requestedAtUtc: new Date().toISOString(),
      tasks: [{ ...manifest, status: "withdrawn" }]
    };
    const secondResponse = await worker.fetch(
      new Request(`${origin}/api/repository/tasks/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...secondEnvelope,
          hmacSha256: createHmac("sha256", repositoryHmacKey)
            .update(JSON.stringify(secondEnvelope))
            .digest("hex")
        })
      }),
      env
    );
    assert.equal(secondResponse.status, 202, await secondResponse.text());
    const rows = await fixture.sql`
      SELECT status, source_commit_sha, immutable_manifest_sha256
        FROM adjudication.repository_task_packets
       WHERE packet_id = ${packet.packetId}
    `;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "withdrawn");
    assert.equal(rows[0].source_commit_sha, firstCommit);
    assert.match(rows[0].immutable_manifest_sha256, /^[a-f0-9]{64}$/);
  } finally {
    await fixture.close();
  }
});

test("identity erasure removes active D1 payloads and records backup boundary through Hyperdrive PostgreSQL", {
  skip: !dockerAvailable
}, async () => {
  const fixture = await createPostgresFixture("erasure");
  const recoveryDb = new D1RecoveryDatabase();
  const now = Date.now();
  const userId = "user-erasure";
  const verifiedHash = "verified-hash";
  const profileCiphertext = await encryptEntityCrypt(JSON.stringify({
    fullName: "مشارك",
    email: "judge@example.test"
  }), entityKey);
  const identityEnvelope = await encryptEntityCrypt(JSON.stringify({
    email: "judge@example.test"
  }), entityKey);

  await fixture.sql.unsafe(`
    INSERT INTO users (
      id, profile_ciphertext, consent_json, verified_email_hash, created_at, updated_at
    ) VALUES (
      '${userId}', '${profileCiphertext.replace(/'/g, "''")}',
      '{"identityStorage":true,"futureContact":false,"discussionNotifications":false}',
      '${verifiedHash}', ${now - 4000}, ${now - 4000}
    );

    INSERT INTO passkeys (
      credential_id, user_id, public_key, counter, transports_json,
      device_type, backed_up, created_at
    ) VALUES (
      'credential-test', '${userId}', 'public-key', 0, '[]', 'singleDevice', 0, ${now - 3000}
    );

    INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
    VALUES ('session-test', '${userId}', ${now + 1000}, ${now - 2000});

    INSERT INTO drafts (
      user_id, packet_id, role, ciphertext, updated_at
    ) VALUES (
      '${userId}', 'packet', 'annotation-a', 'ciphertext', ${now - 2000}
    );

    INSERT INTO email_verifications (
      id, email_hash, request_fingerprint, code_hash, expires_at,
      resend_after, created_at
    ) VALUES (
      'verification-test', '${verifiedHash}', 'request', 'code',
      ${now + 1000}, ${now}, ${now - 2000}
    );

    INSERT INTO submissions (
      receipt_id, user_id, packet_id, role, artifact_sha256, submitted_at,
      repository_status
    ) VALUES (
      '44444444-4444-4444-8444-444444444444', '${userId}', 'packet',
      'annotation-a', 'hash', ${now - 2000}, 'pending-validation'
    );

    INSERT INTO evidence_outbox (
      id, kind, related_id, public_blob_name, identity_blob_name,
      public_payload_json, identity_payload_json, dedupe_key,
      status, attempts, next_attempt_at, created_at
    ) VALUES (
      'evidence-erasure', 'submission', '44444444-4444-4444-8444-444444444444',
      '44444444-4444-4444-8444-444444444444.json',
      '44444444-4444-4444-8444-444444444444.json',
      '{"schema":"public"}',
      '${identityEnvelope.replace(/'/g, "''")}',
      'erasure-dedupe', 'sent', 0, ${now - 1000}, ${now - 1000}
    );

    INSERT INTO identity_erasure_requests (
      id, user_id, status, requested_at, eligible_after
    ) VALUES (
      'request-erasure', '${userId}', 'pending', ${now - 1000}, ${now - 1000}
    );
  `);

  const env = {
    DB: recoveryDb,
    HYPERDRIVE: {
      connectionString: fixture.connectionString
    },
    CPOLY_BACKUP_MASTER_KEY: recoveryMasterKey,
    EVIDENCE_ARCHIVE_MODE: "d1",
    D1_TIME_TRAVEL_RETENTION_DAYS: "30",
    IDENTITY_RETENTION_DAYS: "30",
    ENTITYCRYPT_MASTER_KEY_SECRET_NAME: "entity-key-test",
    ENTITYCRYPT_MASTER_KEY: entityKey
  };

  try {
    const pending = [];
    await worker.scheduled({}, env, {
      waitUntil(promise) {
        pending.push(promise);
      }
    });
    await Promise.all(pending);

    const user = (await fixture.sql`
      SELECT profile_ciphertext, consent_json, verified_email_hash
        FROM users
       WHERE id = ${userId}
    `)[0];
    assert.equal(user.verified_email_hash, null);
    const tombstone = JSON.parse(
      await decryptEntityCryptForTest(user.profile_ciphertext, entityKey)
    );
    assert.equal(tombstone.schema, "adg-erased-participant-v1");
    assert.match(tombstone.activeStoreDeletedAtUtc, /^\d{4}-/u);
    assert.equal(
      tombstone.providerBackupRetention.provider,
      "cloudflare-d1-time-travel"
    );

    const outbox = (await fixture.sql`
      SELECT identity_blob_name, identity_payload_json
        FROM evidence_outbox
       WHERE id = 'evidence-erasure'
    `)[0];
    assert.equal(outbox.identity_blob_name, null);
    assert.equal(outbox.identity_payload_json, null);

    const request = (await fixture.sql`
      SELECT status, completed_at
        FROM identity_erasure_requests
       WHERE id = 'request-erasure'
    `)[0];
    assert.equal(request.status, "completed");
    assert.ok(Number(request.completed_at) > 0);

    const surviving = (await fixture.sql`
      SELECT COUNT(*) AS count
        FROM email_verifications
       WHERE email_hash = ${verifiedHash}
    `)[0];
    assert.equal(Number(surviving.count), 0);
  } finally {
    recoveryDb.database.close();
    await fixture.close();
  }
});

function buildRecoveryBackupSpec({
  snapshotGeneration,
  postgresReceiptWatermark
}) {
  const chunks = splitOpenPgpFixture(145);
  const digest = createHash("sha256");
  let totalBytes = 0;
  for (const chunk of chunks) {
    digest.update(chunk);
    totalBytes += chunk.length;
  }
  const archive = {
    fileName: "cpoly-postgres-backup.tar.gpg",
    sizeBytes: totalBytes,
    sha256: digest.digest("hex"),
    chunkCount: chunks.length,
    chunkSizeBytes: Math.max(...chunks.map(chunk => chunk.length)),
    contentType: "application/octet-stream",
    encryptionFormat: "openpgp-symmetric-aes256"
  };
  const metadata = {
    schema: "cpoly_postgres_backup_v1",
    created_at_utc: "2026-08-14T12:00:00.000Z",
    source_container: "cpoly-postgres-statefulset",
    source_image: "postgres@sha256:test-fixture",
    server_version: "16.4",
    databases: [
      {
        oid: 16384,
        name: "adg_adjudication",
        bytes: 1024,
        dump: "database-16384.dump"
      }
    ],
    plaintext_file_hashes: [
      {
        name: "bootstrap-roles.sql",
        bytes: 32,
        sha256: sha256HexBytes(Buffer.from("bootstrap-roles-sql"))
      }
    ],
    attestations: {
      schema: "adg.cpoly-postgres.backup-attestations.v1",
      protected_columns_entitycrypt: true,
      role_password_material_excluded: true,
      bootstrap_roles_separate: true
    },
    encryption: {
      status: "PASS_AES256_GPG_SYMMETRIC",
      algorithm: "AES-256 via OpenPGP symmetric encryption",
      key_source: "kubernetes_secret",
      secret_name: "adg-backup-password",
      encrypted_archive: archive.fileName,
      encrypted_bytes: archive.sizeBytes,
      encrypted_sha256: archive.sha256,
      round_trip_verified: true
    },
    restore_test: {
      requested: true,
      status: "PASS",
      databases: [
        {
          source_database: "adg_adjudication",
          target_database: "verify_16384",
          restored_bytes: 1024,
          status: "PASS"
        }
      ]
    },
    claim_boundary: BACKUP_CLAIM_BOUNDARY,
    snapshotGeneration,
    postgresReceiptWatermark
  };
  return {
    chunks,
    archive,
    metadata,
    createBody: {
      schema: "adg.cpoly-postgres.backup.v1",
      metadata,
      archive,
      chunks: chunks.map((chunk, index) => ({
        index,
        sizeBytes: chunk.length,
        sha256: sha256HexBytes(chunk)
      }))
    },
    completeBody: {
      schema: "adg.cpoly-postgres.backup.v1",
      chunkCount: archive.chunkCount,
      totalBytes: archive.sizeBytes,
      sha256: archive.sha256
    }
  };
}

function splitOpenPgpFixture(chunkSize) {
  const chunks = [];
  for (let offset = 0; offset < openPgpFixture.length; offset += chunkSize) {
    chunks.push(openPgpFixture.slice(offset, offset + chunkSize));
  }
  return chunks;
}

async function signedRecoveryRequest(requestPath, {
  method = "GET",
  body = new Uint8Array(0),
  secret,
  nonce = crypto.randomUUID(),
  timestamp = Date.now()
} = {}) {
  const bodyBytes = body instanceof Uint8Array
    ? body
    : new Uint8Array(body);
  const bodyHash = sha256HexBytes(bodyBytes);
  const canonical = buildCpolyCanonicalText(
    method,
    requestPath,
    timestamp,
    nonce,
    bodyHash
  );
  const signature = await hmacSha256Hex(secret, canonical);
  return new Request(`${origin}${requestPath}`, {
    method,
    headers: {
      "content-type": requestPath.includes("/chunks/")
        ? "application/octet-stream"
        : "application/json",
      "x-adg-timestamp": String(timestamp),
      "x-adg-nonce": nonce,
      "x-adg-content-sha256": bodyHash,
      "x-adg-signature": signature
    },
    body: ["GET", "HEAD"].includes(method)
      ? undefined
      : Buffer.from(bodyBytes)
  });
}

function jsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value));
}
