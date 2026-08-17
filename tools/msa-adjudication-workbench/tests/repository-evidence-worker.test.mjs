import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import worker, {
  decryptEntityCryptForTest,
  encryptEntityCrypt
} from "../src/index.js";

const origin = "https://adg-import.test";
const repository = "sbay-dev/ADG-Lang";
const repositoryReceiptKey = "repository-receipt-hmac-test";

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

test("repository evidence claim never exposes private identity payloads", async () => {
  const db = new D1TestDatabase();
  seedSubmissionEvidence(db, {
    receiptId: "11111111-1111-4111-8111-111111111111",
    publicPayloadJson: JSON.stringify({
      schema: "adg-msa-github-inbox-v1",
      receiptId: "11111111-1111-4111-8111-111111111111",
      artifactType: "independent-annotation",
      artifactSha256: "a".repeat(64),
      artifact: {
        kind: "independent-annotation",
        packet: { packetId: "packet-1" }
      },
      hmacSha256: "b".repeat(64)
    }),
    identityPayloadJson: JSON.stringify({
      email: "identity@example.test",
      phone: "+15551234567"
    })
  });

  const response = await worker.fetch(
    signedClaimRequest({
      nonce: "22222222-2222-4222-8222-222222222222"
    }),
    baseEnv(db)
  );

  const value = await response.json();
  assert.equal(response.status, 200);
  assert.equal(value.accepted, true);
  assert.equal(value.claim.count, 1);
  assert.deepEqual(value.items, [{
    kind: "submission",
    relatedId: "11111111-1111-4111-8111-111111111111",
    publicBlobName: "11111111-1111-4111-8111-111111111111.json",
    publicPayloadJson: JSON.stringify({
      schema: "adg-msa-github-inbox-v1",
      receiptId: "11111111-1111-4111-8111-111111111111",
      artifactType: "independent-annotation",
      artifactSha256: "a".repeat(64),
      artifact: {
        kind: "independent-annotation",
        packet: { packetId: "packet-1" }
      },
      hmacSha256: "b".repeat(64)
    })
  }]);
  const responseText = JSON.stringify(value);
  assert.equal(responseText.includes("identity_payload_json"), false);
  assert.equal(responseText.includes("identity@example.test"), false);
  assert.equal(responseText.includes("+15551234567"), false);
});

test("repository evidence claim rejects invalid signatures", async () => {
  const db = new D1TestDatabase();
  const response = await worker.fetch(
    signedClaimRequest({
      nonce: "33333333-3333-4333-8333-333333333333",
      key: "wrong-key"
    }),
    baseEnv(db)
  );
  assert.equal(response.status, 401);
});

test("accepted evidence receipts stop claim replay", async () => {
  const db = new D1TestDatabase();
  const receiptId = "44444444-4444-4444-8444-444444444444";
  seedSubmissionEvidence(db, {
    receiptId,
    publicPayloadJson: JSON.stringify({
      schema: "adg-msa-github-inbox-v1",
      receiptId,
      artifactType: "independent-annotation",
      artifactSha256: "c".repeat(64),
      artifact: {
        kind: "independent-annotation",
        packet: { packetId: "packet-2" }
      },
      hmacSha256: "d".repeat(64)
    }),
    identityPayloadJson: JSON.stringify({
      email: "private@example.test"
    })
  });

  const firstClaim = await worker.fetch(
    signedClaimRequest({
      nonce: "55555555-5555-4555-8555-555555555555"
    }),
    baseEnv(db)
  );
  assert.equal(firstClaim.status, 200);
  assert.equal((await firstClaim.json()).claim.count, 1);

  const receiptResponse = await worker.fetch(
    signedEvidenceReceiptRequest({
      receiptId: "66666666-6666-4666-8666-666666666666",
      relatedId: receiptId
    }),
    baseEnv(db)
  );
  assert.equal(receiptResponse.status, 202, await receiptResponse.text());

  const secondClaim = await worker.fetch(
    signedClaimRequest({
      nonce: "77777777-7777-4777-8777-777777777777"
    }),
    baseEnv(db)
  );
  assert.equal(secondClaim.status, 200);
  const value = await secondClaim.json();
  assert.equal(value.claim.count, 0);
  assert.deepEqual(value.items, []);
});

test("accepted task-state receipts stop non-final state replay", async () => {
  const db = new D1TestDatabase();
  const taskVersionId = "task-state-receipt:v1";
  const eventId = "task-open:task-state-receipt:v1";
  seedTaskStateEvidence(db, {
    taskVersionId,
    eventId,
    toState: "open",
    stateVersion: 0
  });

  const firstClaim = await worker.fetch(
    signedClaimRequest({
      nonce: "12121212-1212-4212-8212-121212121212"
    }),
    baseEnv(db)
  );
  assert.equal(firstClaim.status, 200);
  assert.equal((await firstClaim.json()).claim.count, 1);

  const receiptResponse = await worker.fetch(
    signedTaskStateReceiptRequest({
      receiptId: "13131313-1313-4313-8313-131313131313",
      taskVersionId,
      eventId,
      toState: "open",
      stateVersion: 0,
      issueNumber: 18
    }),
    baseEnv(db)
  );
  assert.equal(receiptResponse.status, 202, await receiptResponse.text());
  const storedReceipt = db.database.prepare(
    `SELECT to_state, state_version, pr_number, issue_number
       FROM task_state_repository_receipts
      WHERE task_version_id = ? AND event_id = ?`
  ).get(taskVersionId, eventId);
  assert.equal(storedReceipt.to_state, "open");
  assert.equal(storedReceipt.state_version, 0);
  assert.equal(storedReceipt.pr_number, 17);
  assert.equal(storedReceipt.issue_number, 18);
  const storedTask = db.database.prepare(
    `SELECT repository_status, github_issue_number
       FROM task_versions
      WHERE id = ?`
  ).get(taskVersionId);
  assert.equal(storedTask.repository_status, "not-sent");
  assert.equal(storedTask.github_issue_number, 18);
  assert.equal(
    db.database.prepare(
      `SELECT status FROM evidence_outbox
        WHERE kind = 'task-state' AND related_id = ?`
    ).get(eventId).status,
    "sent"
  );

  const duplicateResponse = await worker.fetch(
    signedTaskStateReceiptRequest({
      receiptId: "14141414-1414-4414-8414-141414141414",
      taskVersionId,
      eventId,
      toState: "open",
      stateVersion: 0,
      issueNumber: 18
    }),
    baseEnv(db)
  );
  const duplicateText = await duplicateResponse.text();
  assert.equal(duplicateResponse.status, 202, duplicateText);
  assert.equal(
    JSON.parse(duplicateText).receiptId,
    "13131313-1313-4313-8313-131313131313"
  );

  const conflictingResponse = await worker.fetch(
    signedTaskStateReceiptRequest({
      receiptId: "15151515-1515-4515-8515-151515151515",
      taskVersionId,
      eventId,
      toState: "open",
      stateVersion: 0,
      issueNumber: 19,
      prMergeSha: "c".repeat(40)
    }),
    baseEnv(db)
  );
  assert.equal(conflictingResponse.status, 409);

  const secondClaim = await worker.fetch(
    signedClaimRequest({
      nonce: "16161616-1616-4616-8616-161616161616"
    }),
    baseEnv(db)
  );
  assert.equal(secondClaim.status, 200);
  assert.equal((await secondClaim.json()).claim.count, 0);
});

test("approved task states require the final-result repository receipt", async () => {
  const db = new D1TestDatabase();
  const response = await worker.fetch(
    signedTaskStateReceiptRequest({
      receiptId: "17171717-1717-4717-8717-171717171717",
      taskVersionId: "task-approved:v1",
      eventId: "task-approved:task-approved:v1",
      toState: "approved",
      stateVersion: 4,
      issueNumber: 18
    }),
    baseEnv(db)
  );
  assert.equal(response.status, 400);
});

test("D1 archive mode keeps only encrypted identity envelopes in the outbox archive", async () => {
  const db = new D1TestDatabase();
  const receiptId = "78787878-7878-4878-8878-787878787878";
  seedSubmissionEvidence(db, {
    receiptId,
    publicPayloadJson: "{\"public\":true}\n",
    identityPayloadJson: await createEncryptedIdentityEnvelope(
      receiptId,
      {
        fullName: "باحث تجريبي",
        email: "researcher@example.test",
        affiliation: "ADG Lab"
      }
    )
  });

  await runScheduled({
    DB: db,
    EVIDENCE_ARCHIVE_MODE: "d1",
    NOTIFICATION_EMAIL_ENABLED: "false"
  });

  const stored = db.database.prepare(
    `SELECT status, public_payload_json, identity_payload_json
       FROM evidence_outbox
      WHERE related_id = ?`
  ).get(receiptId);
  assert.equal(stored.status, "sent");
  assert.equal(stored.public_payload_json.includes("researcher@example.test"), false);
  assert.equal(stored.identity_payload_json.includes("researcher@example.test"), false);
  assert.equal(stored.identity_payload_json.includes("باحث تجريبي"), false);
  const envelope = JSON.parse(stored.identity_payload_json);
  assert.equal(envelope.schema, "adg-entitycrypt-data-room-envelope-v1");
  assert.match(envelope.ciphertext, /^MK1:0:/);
});

test("D1 archive mode still serves repository portal claims from the authoritative DB", async () => {
  const db = new D1TestDatabase();
  const receiptId = "98989898-9898-4989-8989-989898989898";
  seedSubmissionEvidence(db, {
    receiptId,
    publicPayloadJson: JSON.stringify({
      schema: "adg-msa-github-inbox-v1",
      receiptId,
      artifactType: "independent-annotation",
      artifactSha256: "1".repeat(64),
      artifact: {
        kind: "independent-annotation",
        packet: { packetId: "packet-d1" }
      },
      hmacSha256: "2".repeat(64)
    }),
    identityPayloadJson: await createEncryptedIdentityEnvelope(receiptId, {
      email: "archive@example.test"
    })
  });

  await runScheduled({
    DB: db,
    EVIDENCE_ARCHIVE_MODE: "d1",
    NOTIFICATION_EMAIL_ENABLED: "false"
  });

  const response = await worker.fetch(
    signedClaimRequest({
      nonce: "12341234-1234-4234-8234-123412341234"
    }),
    {
      ...baseEnv(db),
      EVIDENCE_ARCHIVE_MODE: "d1"
    }
  );
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.equal(value.claim.count, 1);
  assert.equal(value.items[0].relatedId, receiptId);
  assert.equal(JSON.stringify(value).includes("archive@example.test"), false);
});

test("R2 evidence outbox prefers private bucket bindings and separates scopes", async () => {
  const db = new D1TestDatabase();
  const receiptId = "88888888-8888-4888-8888-888888888888";
  seedSubmissionEvidence(db, {
    receiptId,
    publicPayloadJson: "{\"public\":true}\n",
    identityPayloadJson: "{\"identity\":true}\n"
  });
  const submissionObjects = createR2Bucket();
  const identityObjects = createR2Bucket();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    throw new Error(`R2 preference test should not fetch ${input}`);
  };

  try {
    await runScheduled({
      DB: db,
      EVIDENCE_ARCHIVE_MODE: "r2",
      SUBMISSION_OBJECTS: submissionObjects,
      IDENTITY_OBJECTS: identityObjects,
      NOTIFICATION_EMAIL_ENABLED: "false"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(
    identityObjects.puts.map(item => ({
      name: item.name,
      value: item.value,
      contentType: item.options.httpMetadata?.contentType,
      metadata: item.options.customMetadata
    })),
    [{
      name: `${receiptId}.json`,
      value: "{\"identity\":true}\n",
      contentType: "application/json; charset=utf-8",
      metadata: {
        "adg-scope": "identities",
        "adg-object-kind": "identity-envelope",
        "adg-privacy-tier": "protected"
      }
    }]
  );
  assert.deepEqual(
    submissionObjects.puts.map(item => ({
      name: item.name,
      value: item.value,
      contentType: item.options.httpMetadata?.contentType,
      metadata: item.options.customMetadata
    })),
    [{
      name: `${receiptId}.json`,
      value: "{\"public\":true}\n",
      contentType: "application/json; charset=utf-8",
      metadata: {
        "adg-scope": "submissions",
        "adg-object-kind": "submission",
        "adg-privacy-tier": "public"
      }
    }]
  );
  const stored = db.database.prepare(
    `SELECT status, attempts, last_error
       FROM evidence_outbox
      WHERE related_id = ?`
  ).get(receiptId);
  assert.equal(stored.status, "sent");
  assert.equal(stored.attempts, 1);
  assert.equal(stored.last_error, null);
});

test("R2 identity erasure deletes only protected identity objects", async () => {
  const db = new D1TestDatabase();
  const receiptId = "99999999-9999-4999-8999-999999999999";
  seedSubmissionEvidence(db, {
    receiptId,
    publicPayloadJson: "{\"public\":true}\n",
    identityPayloadJson: "{\"identity\":true}\n"
  });
  db.database.prepare(
    `INSERT INTO identity_erasure_requests
      (id, user_id, status, requested_at, eligible_after)
     VALUES (?, 'user-evidence', 'pending', ?, ?)`
  ).run(
    "erasure-1",
    Date.now() - 60000,
    Date.now() - 60000
  );
  const identityObjects = createR2Bucket();

  await runScheduled({
    DB: db,
    EVIDENCE_ARCHIVE_MODE: "r2",
    IDENTITY_OBJECTS: identityObjects,
    ENTITYCRYPT_MASTER_KEY_SECRET_NAME: "entity-key-test",
    ENTITYCRYPT_MASTER_KEY: "entity-key-material-for-tests-2026",
    NOTIFICATION_EMAIL_ENABLED: "false"
  });

  assert.deepEqual(identityObjects.deletes, [`${receiptId}.json`]);
  const request = db.database.prepare(
    `SELECT status, completed_at
       FROM identity_erasure_requests
      WHERE id = 'erasure-1'`
  ).get();
  assert.equal(request.status, "completed");
  assert.ok(Number(request.completed_at) > 0);
  const outbox = db.database.prepare(
    `SELECT identity_blob_name, identity_payload_json
       FROM evidence_outbox
      WHERE related_id = ?`
  ).get(receiptId);
  assert.equal(outbox.identity_blob_name, null);
  assert.equal(outbox.identity_payload_json, null);
});

test("R2 storage failures propagate through evidence outbox retries", async () => {
  const db = new D1TestDatabase();
  const receiptId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  seedSubmissionEvidence(db, {
    receiptId,
    publicPayloadJson: "{\"public\":true}\n",
    identityPayloadJson: "{\"identity\":true}\n"
  });
  const submissionObjects = createR2Bucket();
  const identityObjects = createR2Bucket({
    putError: "identity bucket unavailable"
  });

  await runScheduled({
    DB: db,
    EVIDENCE_ARCHIVE_MODE: "r2",
    SUBMISSION_OBJECTS: submissionObjects,
    IDENTITY_OBJECTS: identityObjects,
    NOTIFICATION_EMAIL_ENABLED: "false"
  });

  assert.equal(submissionObjects.puts.length, 0);
  const stored = db.database.prepare(
    `SELECT status, attempts, last_error
       FROM evidence_outbox
      WHERE related_id = ?`
  ).get(receiptId);
  assert.equal(stored.status, "pending");
  assert.equal(stored.attempts, 1);
  assert.match(
    stored.last_error,
    /R2 identities upload failed: identity bucket unavailable/
  );
});

test("D1 archive mode erasure removes retained identity payload without external blobs", async () => {
  const db = new D1TestDatabase();
  const receiptId = "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd";
  seedSubmissionEvidence(db, {
    receiptId,
    publicPayloadJson: "{\"public\":true}\n",
    identityPayloadJson: await createEncryptedIdentityEnvelope(receiptId, {
      email: "erase-me@example.test"
    })
  });
  db.database.prepare(
    `INSERT INTO identity_erasure_requests
      (id, user_id, status, requested_at, eligible_after)
     VALUES (?, 'user-evidence', 'pending', ?, ?)`
  ).run(
    "erasure-d1",
    Date.now() - 60000,
    Date.now() - 60000
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    throw new Error(`D1 archive mode should not fetch ${input}`);
  };

  try {
    await runScheduled({
      DB: db,
      EVIDENCE_ARCHIVE_MODE: "d1",
      D1_TIME_TRAVEL_RETENTION_DAYS: "7",
      ENTITYCRYPT_MASTER_KEY_SECRET_NAME: "entity-key-test",
      ENTITYCRYPT_MASTER_KEY: "entity-key-material-for-tests-2026",
      NOTIFICATION_EMAIL_ENABLED: "false"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const outbox = db.database.prepare(
    `SELECT identity_blob_name, identity_payload_json
       FROM evidence_outbox
      WHERE related_id = ?`
  ).get(receiptId);
  assert.equal(outbox.identity_blob_name, null);
  assert.equal(outbox.identity_payload_json, null);
  assert.equal(
    db.database.prepare(
      `SELECT COUNT(*) AS count
         FROM identity_erasure_items
        WHERE request_id = 'erasure-d1'`
    ).get().count,
    0
  );
  const tombstone = JSON.parse(await decryptEntityCryptForTest(
    db.database.prepare(
      "SELECT profile_ciphertext FROM users WHERE id = 'user-evidence'"
    ).get().profile_ciphertext,
    "entity-key-material-for-tests-2026"
  ));
  assert.equal(tombstone.schema, "adg-erased-participant-v1");
  assert.equal(tombstone.activeStoreDeletedAtUtc, tombstone.erasedAtUtc);
  assert.equal(
    tombstone.providerBackupRetention.provider,
    "cloudflare-d1-time-travel"
  );
  assert.equal(tombstone.providerBackupRetention.retentionDays, 7);
  assert.ok(
    Date.parse(tombstone.providerBackupRetention.mayRemainRecoverableUntilUtc)
      - Date.parse(tombstone.activeStoreDeletedAtUtc)
      >= 7 * 24 * 60 * 60 * 1000
  );
});

test("Azure evidence outbox fallback still uploads public and identity blobs", async () => {
  const db = new D1TestDatabase();
  const now = Date.now();
  db.database.prepare(
    `INSERT INTO evidence_outbox
      (id, kind, task_version_id, related_id, public_blob_name,
       identity_blob_name, public_payload_json, identity_payload_json,
       dedupe_key, status, attempts, next_attempt_at, created_at)
     VALUES (?, 'submission', NULL, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
  ).run(
    "delivery-azure-fallback",
    "88888888-8888-4888-8888-888888888888",
    "public.json",
    "identity.json",
    "{\"public\":true}\n",
    "{\"identity\":true}\n",
    "submission:88888888-8888-4888-8888-888888888888",
    now,
    now
  );

  const uploads = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (new URL(url).hostname === "login.microsoftonline.com") {
      return Response.json({
        access_token: "azure-token",
        expires_in: 3600
      });
    }
    if (url.includes(".vault.azure.net/secrets/")) {
      if (url.includes("submissions-sas")) {
        return Response.json({
          value: "https://storage.example.test/submissions?sig=sub"
        });
      }
      if (url.includes("identities-sas")) {
        return Response.json({
          value: "https://storage.example.test/identities?sig=id"
        });
      }
      throw new Error(`Unexpected secret URL: ${url}`);
    }
    if (url.startsWith("https://storage.example.test/")) {
      uploads.push({
        url,
        method: init.method,
        body: String(init.body)
      });
      return new Response(null, { status: 201 });
    }
    throw new Error(`Unexpected fetch in Azure fallback test: ${url}`);
  };

  try {
    let maintenance;
    await worker.scheduled(null, {
      DB: db,
      EVIDENCE_ARCHIVE_MODE: "azure",
      SUBMISSION_SAS_SECRET_NAME: "submissions-sas",
      IDENTITY_SAS_SECRET_NAME: "identities-sas",
      AZURE_TENANT_ID: "tenant",
      AZURE_CLIENT_ID: "client",
      AZURE_CLIENT_SECRET: "secret",
      AZURE_KEY_VAULT_URL: "https://vault.example.vault.azure.net",
      NOTIFICATION_EMAIL_ENABLED: "false"
    }, {
      waitUntil(promise) {
        maintenance = promise;
      }
    });
    await maintenance;
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(
    uploads.map(upload => ({
      path: new URL(upload.url).pathname,
      method: upload.method
    })),
    [
      { path: "/identities/identity.json", method: "PUT" },
      { path: "/submissions/public.json", method: "PUT" }
    ]
  );
});

async function runScheduled(env) {
  let maintenance;
  await worker.scheduled(null, env, {
    waitUntil(promise) {
      maintenance = promise;
    }
  });
  await maintenance;
}

function createR2Bucket({ putError, deleteError } = {}) {
  return {
    puts: [],
    deletes: [],
    async put(name, value, options) {
      if (putError) {
        throw new Error(putError);
      }
      this.puts.push({
        name,
        value: String(value),
        options
      });
    },
    async delete(name) {
      if (deleteError) {
        throw new Error(deleteError);
      }
      this.deletes.push(name);
    }
  };
}

async function createEncryptedIdentityEnvelope(receiptId, privateIdentity) {
  return JSON.stringify({
    schema: "adg-entitycrypt-data-room-envelope-v1",
    entityCryptProfile: "Matryoshka.MK1.AES256.GCM.Randomized",
    keySecretName: "entity-key-test",
    receiptId,
    ciphertext: await encryptEntityCrypt(
      JSON.stringify(privateIdentity),
      "entity-key-material-for-tests-2026"
    )
  }) + "\n";
}

function baseEnv(db) {
  return {
    DB: db,
    GITHUB_REPOSITORY: repository,
    REPOSITORY_RECEIPT_HMAC_SECRET_NAME: "repository-hmac",
    REPOSITORY_RECEIPT_HMAC_KEY: repositoryReceiptKey
  };
}

function signedClaimRequest({ nonce, key = repositoryReceiptKey }) {
  const envelope = {
    schema: "adg-msa-repository-evidence-claim-v1",
    repository,
    nonce,
    requestedAtUtc: new Date().toISOString(),
    maxItems: 10
  };
  return new Request(`${origin}/api/repository/evidence/claim`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(signEnvelope(envelope, key))
  });
}

function signedEvidenceReceiptRequest({ receiptId, relatedId }) {
  const envelope = {
    schema: "adg-msa-evidence-receipt-v1",
    receiptId,
    evidenceKind: "submission",
    relatedId,
    repository,
    prNumber: 7,
    prMergeSha: "a".repeat(40),
    importerCommitSha: "b".repeat(40),
    acceptedAtUtc: new Date().toISOString()
  };
  return new Request(`${origin}/api/repository/receipts`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(signEnvelope(envelope, repositoryReceiptKey))
  });
}

function signedTaskStateReceiptRequest({
  receiptId,
  taskVersionId,
  eventId,
  toState,
  stateVersion,
  issueNumber,
  prMergeSha = "a".repeat(40)
}) {
  const envelope = {
    schema: "adg-msa-task-state-receipt-v1",
    receiptId,
    taskVersionId,
    eventId,
    toState,
    stateVersion,
    repository,
    prNumber: 17,
    prMergeSha,
    importerCommitSha: "b".repeat(40),
    issueNumber,
    acceptedAtUtc: new Date().toISOString()
  };
  return new Request(`${origin}/api/repository/receipts`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(signEnvelope(envelope, repositoryReceiptKey))
  });
}

function signEnvelope(envelope, key) {
  return {
    ...envelope,
    hmacSha256: createHmac("sha256", key)
      .update(JSON.stringify(envelope))
      .digest("hex")
  };
}

function seedSubmissionEvidence(db, {
  receiptId,
  publicPayloadJson,
  identityPayloadJson
}) {
  db.database.prepare(
    `INSERT INTO users
      (id, profile_ciphertext, consent_json, verified_email_hash,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    "user-evidence",
    "ciphertext",
    JSON.stringify({
      identityStorage: true,
      futureContact: false,
      discussionNotifications: false
    }),
    null,
    Date.now(),
    Date.now()
  );
  db.database.prepare(
    `INSERT INTO submissions
      (receipt_id, user_id, packet_id, role, artifact_sha256,
       submitted_at, participant_pseudonym, artifact_type,
       artifact_json, repository_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending-validation')`
  ).run(
    receiptId,
    "user-evidence",
    "packet-demo",
    "annotator-a",
    "e".repeat(64),
    Date.now(),
    "adg-123456789abc",
    "independent-annotation",
    "{\"artifact\":true}"
  );
  db.database.prepare(
    `INSERT INTO evidence_outbox
      (id, kind, task_version_id, related_id, public_blob_name,
       identity_blob_name, public_payload_json, identity_payload_json,
       dedupe_key, status, attempts, next_attempt_at, created_at)
     VALUES (?, 'submission', NULL, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
  ).run(
    `delivery-${receiptId}`,
    receiptId,
    `${receiptId}.json`,
    `${receiptId}.json`,
    publicPayloadJson,
    identityPayloadJson,
    `submission:${receiptId}`,
    Date.now(),
    Date.now()
  );
}

function seedTaskStateEvidence(db, {
  taskVersionId,
  eventId,
  toState,
  stateVersion
}) {
  const now = Date.now();
  const roundId = `${taskVersionId}:r1`;
  db.database.prepare(
    `INSERT INTO task_versions
      (id, task_id, task_version, packet_id, holdout_id,
       packet_merkle_root, guideline_version, data_version,
       protocol_version, metric_policy_json, state, state_version,
       current_round, last_event_id, repository_status,
       created_at, updated_at)
     VALUES (?, 'task-state-receipt', 1, 'packet-task-state',
             'holdout-task-state', ?, 'guideline-v1', 'data-v1',
             'protocol-v1', '{}', ?, ?, 1, ?, 'not-sent', ?, ?)`
  ).run(
    taskVersionId,
    "a".repeat(64),
    toState,
    stateVersion,
    eventId,
    now,
    now
  );
  db.database.prepare(
    `INSERT INTO consensus_rounds
      (id, task_version_id, round_number, status, opened_at, deadline_at)
     VALUES (?, ?, 1, 'open', ?, ?)`
  ).run(roundId, taskVersionId, now, now + 86400000);
  db.database.prepare(
    `INSERT INTO consensus_events
      (id, task_version_id, round_id, event_type, from_state, to_state,
       reason_code, evidence_json, event_hash, idempotency_key, created_at)
     VALUES (?, ?, ?, 'task-opened', 'draft', ?, 'test', '{}', ?, ?, ?)`
  ).run(
    eventId,
    taskVersionId,
    roundId,
    toState,
    "b".repeat(64),
    eventId,
    now
  );
  const publicPayload = JSON.stringify({
    schema: "adg-msa-task-state-v1",
    nonce: eventId,
    eventId,
    taskVersionId,
    toState,
    stateVersion,
    hmacSha256: "c".repeat(64)
  });
  db.database.prepare(
    `INSERT INTO evidence_outbox
      (id, kind, task_version_id, related_id, public_blob_name,
       public_payload_json, dedupe_key, status, attempts,
       next_attempt_at, created_at)
     VALUES (?, 'task-state', ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
  ).run(
    `delivery-${eventId}`,
    taskVersionId,
    eventId,
    `${eventId}.json`,
    publicPayload,
    `task-state:${eventId}`,
    now,
    now
  );
}
