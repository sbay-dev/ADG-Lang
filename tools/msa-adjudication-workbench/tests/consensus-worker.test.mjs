import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import worker, {
  decryptEntityCryptForTest,
  encryptEntityCrypt
} from "../src/index.js";
import {
  RATIFICATION_SCHEMA,
  computeAdjudicationMerkleRoot,
  computeAnnotationMerkleRoot,
  computePacketMerkleRoot,
  sha256Json
} from "../public/protocol.js";

const origin = "https://adg-consensus.test";
const repository = "sbay-dev/ADG-Lang";
const exampleRoot = new URL(
  "../../../examples/arabic-text/msa-adjudication-pilot-v1/",
  import.meta.url
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
      "migrations/0011_portal_issue_reports.sql"
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

test("four independent accounts reach approved then repository-published", async () => {
  const fixture = await createFixture("approved");
  try {
    const result = await submitConsensusSequence(fixture, "agree");
    assert.equal(result.task.state, "approved");
    assert.equal(result.task.current_round, 1);
    assert.equal(result.participants.length, 4);
    assert.equal(new Set(result.participants.map(row => row.user_id)).size, 4);
    assert.deepEqual(
      result.participants.map(row => row.role).sort(),
      ["A", "B", "J1", "J2"]
    );
    assert.equal(result.metrics.policy_passed, 1);
    assert.equal(result.final.status, "active");

    fixture.db.database.prepare(
      "UPDATE task_versions SET appeal_deadline_at = ? WHERE id = ?"
    ).run(Date.now() - 1000, result.task.id);
    const approvedEvent = fixture.db.database.prepare(
      `SELECT id, round_id
         FROM consensus_events
        WHERE task_version_id = ? AND to_state = 'approved'
        ORDER BY created_at DESC
        LIMIT 1`
    ).get(result.task.id);
    const acceptedAtUtc = new Date().toISOString();
    const receipt = {
      schema: "adg-msa-repository-receipt-v1",
      receiptId: "55555555-5555-4555-8555-555555555555",
      taskVersionId: result.task.id,
      roundId: approvedEvent.round_id,
      finalMerkleRoot: result.final.final_merkle_root,
      nonce: approvedEvent.id,
      repository,
      prNumber: 42,
      prMergeSha: "a".repeat(40),
      importerCommitSha: "b".repeat(40),
      receivedAtUtc: acceptedAtUtc,
      acceptedAtUtc
    };
    const response = await worker.fetch(
      new Request(`${origin}/api/repository/receipts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...receipt,
          hmacSha256: createHmac(
            "sha256",
            fixture.secrets.repositoryReceipt
          ).update(JSON.stringify(receipt)).digest("hex")
        })
      }),
      fixture.env
    );
    assert.equal(response.status, 202, await response.text());
    const published = { ...fixture.db.database.prepare(
      "SELECT state, repository_status FROM task_versions WHERE id = ?"
    ).get(result.task.id) };
    assert.deepEqual(published, {
      state: "published",
      repository_status: "accepted"
    });
    assert.equal(
      fixture.db.database.prepare(
        "SELECT COUNT(*) AS count FROM repository_receipts"
      ).get().count,
      1
    );

    const submissionReceipt = fixture.db.database.prepare(
      `SELECT receipt_id
         FROM submissions
        WHERE task_version_id = ? AND consensus_role = 'A'`
    ).get(result.task.id).receipt_id;
    const evidenceAcceptedAt = new Date().toISOString();
    const evidenceReceipt = {
      schema: "adg-msa-evidence-receipt-v1",
      receiptId: "88888888-8888-4888-8888-888888888888",
      evidenceKind: "submission",
      relatedId: submissionReceipt,
      repository,
      prNumber: 41,
      prMergeSha: "c".repeat(40),
      importerCommitSha: "d".repeat(40),
      acceptedAtUtc: evidenceAcceptedAt
    };
    const evidenceResponse = await worker.fetch(
      new Request(`${origin}/api/repository/receipts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...evidenceReceipt,
          hmacSha256: createHmac(
            "sha256",
            fixture.secrets.repositoryReceipt
          ).update(JSON.stringify(evidenceReceipt)).digest("hex")
        })
      }),
      fixture.env
    );
    assert.equal(evidenceResponse.status, 202);
    assert.equal(
      fixture.db.database.prepare(
        "SELECT repository_status FROM submissions WHERE receipt_id = ?"
      ).get(submissionReceipt).repository_status,
      "imported"
    );
  } finally {
    fixture.restoreFetch();
  }
});

test("independent evidence stays private until both roles are fixed", async () => {
  const fixture = await createFixture("blind-quorum");
  try {
    const values = await independentArtifacts();
    const first = await submitArtifact(
      fixture,
      "A",
      values.participantIds.A,
      values.artifactA
    );
    assert.equal(
      first.repositoryImportStatus,
      "held-for-independent-quorum"
    );
    assert.deepEqual(
      fixture.db.database.prepare(
        `SELECT status
           FROM evidence_outbox
          WHERE kind = 'submission'
          ORDER BY created_at`
      ).all().map(row => row.status),
      ["held"]
    );

    const second = await submitArtifact(
      fixture,
      "B",
      values.participantIds.B,
      values.artifactB
    );
    assert.equal(second.repositoryImportStatus, "pending-validation");
    assert.deepEqual(
      fixture.db.database.prepare(
        `SELECT status
           FROM evidence_outbox
          WHERE kind = 'submission'
          ORDER BY created_at`
      ).all().map(row => row.status),
      ["pending", "pending"]
    );
  } finally {
    fixture.restoreFetch();
  }
});

test("operational pilot test imports without occupying consensus roles", async () => {
  const fixture = await createFixture("operational-test");
  try {
    const values = await independentArtifacts();
    const account = fixture.accounts.get("A");
    const draftUpdatedAt = Date.now() - 1000;
    fixture.db.database.prepare(
      `INSERT INTO drafts
        (user_id, packet_id, role, ciphertext, updated_at)
       VALUES (?, ?, 'A', ?, ?)`
    ).run(
      account.userId,
      values.packet.packetId,
      "existing-encrypted-autosave",
      draftUpdatedAt
    );
    const userBefore = fixture.db.database.prepare(
      `SELECT profile_ciphertext, consent_json
         FROM users
        WHERE id = ?`
    ).get(account.userId);
    const annotation = {
      ...values.artifactA.annotation,
      isHuman: true,
      isSynthetic: false,
      independentFromImplementationTeam: false,
      blindToParserInternals: false
    };
    const artifact = {
      ...values.artifactA,
      annotation
    };
    await registerRepositoryTask(
      fixture,
      values.packet,
      "operational-test",
      "A"
    );
    const standardTasks = await accountJson(
      fixture,
      "A",
      "/api/tasks"
    );
    assert.equal(standardTasks.tasks.length, 1);
    assert.equal(standardTasks.tasks[0].lane, "operational-test");
    assert.equal(standardTasks.tasks[0].baseline, true);
    assert.equal(standardTasks.tasks[0].status, "claimed");
    const operationalTasks = await accountJson(
      fixture,
      "A",
      "/api/tasks?mode=operational-test"
    );
    assert.equal(operationalTasks.tasks.length, 1);
    assert.equal(operationalTasks.tasks[0].lane, "operational-test");
    assert.equal(operationalTasks.tasks[0].status, "claimed");
    const result = await submitOperationalTest(
      fixture,
      "A",
      values.participantIds.A,
      artifact
    );

    assert.equal(result.repositoryImportStatus, "pending-validation");
    assert.equal(result.operationalTest, true);
    const stored = fixture.db.database.prepare(
      `SELECT role, packet_id, task_version_id, round_id,
              consensus_role, repository_status
         FROM submissions
        WHERE receipt_id = ?`
    ).get(result.receiptId);
    assert.equal(stored.role, "operational-test");
    assert.equal(
      stored.packet_id,
      `${artifact.packet.packetId}:operational-test`
    );
    assert.equal(stored.task_version_id, null);
    assert.equal(stored.round_id, null);
    assert.equal(stored.consensus_role, "TEST");
    assert.equal(stored.repository_status, "pending-validation");
    const operationalClaim = fixture.db.database.prepare(
      `SELECT status, submission_receipt_id
         FROM operational_task_claims
        WHERE task_version_id = ? AND user_id = ?`
    ).get(
      `${values.packet.taskId}:v${values.packet.taskVersion}`,
      account.userId
    );
    assert.equal(operationalClaim.status, "submitted");
    assert.equal(operationalClaim.submission_receipt_id, result.receiptId);
    assert.equal(
      fixture.db.database.prepare(
        "SELECT COUNT(*) AS count FROM task_participations"
      ).get().count,
      0
    );

    const queued = fixture.db.database.prepare(
      `SELECT status, public_payload_json
         FROM evidence_outbox
        WHERE related_id = ?`
    ).get(result.receiptId);
    assert.equal(queued.status, "pending");
    const publicEnvelope = JSON.parse(queued.public_payload_json);
    assert.equal(publicEnvelope.submissionMode, "operational-test");
    assert.deepEqual(publicEnvelope.attestation, {
      independent: false,
      blind: false,
      authentic: true
    });
    assert.match(
      publicEnvelope.claimBoundaries.join("\n"),
      /does not occupy A, B, J1, or J2/
    );
    const draftAfter = fixture.db.database.prepare(
      `SELECT ciphertext, updated_at
         FROM drafts
        WHERE user_id = ? AND packet_id = ? AND role = 'A'`
    ).get(account.userId, values.packet.packetId);
    assert.equal(draftAfter.ciphertext, "existing-encrypted-autosave");
    assert.equal(draftAfter.updated_at, draftUpdatedAt);
    const userAfter = fixture.db.database.prepare(
      `SELECT profile_ciphertext, consent_json
         FROM users
        WHERE id = ?`
    ).get(account.userId);
    assert.equal(userAfter.profile_ciphertext, userBefore.profile_ciphertext);
    assert.equal(userAfter.consent_json, userBefore.consent_json);

    const duplicate = await submitOperationalTest(
      fixture,
      "A",
      values.participantIds.A,
      artifact,
      409
    );
    assert.match(duplicate.message, /سبق لهذا الحساب/);
    assert.equal(
      fixture.db.database.prepare(
        `SELECT COUNT(*) AS count
           FROM submissions
          WHERE user_id = ? AND role = 'operational-test'`
      ).get(account.userId).count,
      1
    );
    assert.equal(
      fixture.db.database.prepare(
        `SELECT COUNT(*) AS count
           FROM evidence_outbox
          WHERE related_id = ?`
      ).get(result.receiptId).count,
      1
    );

    const previewResponse = await worker.fetch(
      new Request(
        `${origin}/api/results?receiptId=${result.receiptId}`,
        {
          headers: {
            cookie: `adg_session=${account.token}`
          }
        }
      ),
      fixture.env
    );
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    assert.equal(preview.operationalTest, true);
    assert.equal(preview.results.length, 1);
    assert.equal(preview.results[0].role, "operational-test");
    assert.equal(preview.source.packetId, artifact.packet.packetId);

    const independent = await submitArtifact(
      fixture,
      "A",
      values.participantIds.A,
      values.artifactA,
      { expectedStatus: 409 }
    );
    assert.match(independent.message, /تشغيلية معزولة/);
    const participations = fixture.db.database.prepare(
      "SELECT role, status FROM task_participations"
    ).all();
    assert.equal(participations.length, 0);
  } finally {
    fixture.restoreFetch();
  }
});

test("default task inbox pins the operational baseline before standard work", async () => {
  const fixture = await createFixture("baseline-order");
  try {
    const values = await independentArtifacts();
    const standardPacket = structuredClone(values.packet);
    standardPacket.taskId = "msa-standard-followup";
    standardPacket.packetId = "msa-standard-followup-v1";
    standardPacket.holdoutId = "standard-followup-holdout";
    standardPacket.dataVersion = "standard-followup-v1";
    standardPacket.pilotOnly = false;
    standardPacket.developerVisible = false;

    await registerRepositoryTask(
      fixture,
      standardPacket,
      "standard",
      "A"
    );
    await registerRepositoryTask(
      fixture,
      values.packet,
      "operational-test",
      "A"
    );

    const inbox = await accountJson(fixture, "A", "/api/tasks");
    assert.equal(inbox.tasks.length, 2);
    assert.deepEqual(
      inbox.tasks.map(task => ({
        packetId: task.packetId,
        lane: task.lane,
        baseline: task.baseline
      })),
      [
        {
          packetId: values.packet.packetId,
          lane: "operational-test",
          baseline: true
        },
        {
          packetId: standardPacket.packetId,
          lane: "standard",
          baseline: false
        }
      ]
    );
  } finally {
    fixture.restoreFetch();
  }
});

test("repository task sync is atomic, immutable, and withdrawal-only", async () => {
  const fixture = await createFixture("repository-sync");
  try {
    const values = await independentArtifacts();
    await registerRepositoryTask(
      fixture,
      values.packet,
      "standard",
      "A"
    );
    const stored = fixture.db.database.prepare(
      `SELECT manifest_json, source_commit_sha
         FROM repository_task_packets
        WHERE packet_id = ?`
    ).get(values.packet.packetId);
    const manifest = JSON.parse(stored.manifest_json);
    const changed = {
      ...manifest,
      titleAr: "عنوان بديل غير مسموح بعد تثبيت المهمة"
    };
    const rejected = await sendRepositoryTaskSync(
      fixture,
      [changed],
      "cccccccccccccccccccccccccccccccccccccccc",
      409
    );
    assert.match(rejected.message, /بياناتها المثبتة/);
    const unchanged = fixture.db.database.prepare(
      `SELECT manifest_json, source_commit_sha
         FROM repository_task_packets
        WHERE packet_id = ?`
    ).get(values.packet.packetId);
    assert.equal(
      JSON.parse(unchanged.manifest_json).titleAr,
      manifest.titleAr
    );
    assert.equal(unchanged.source_commit_sha, stored.source_commit_sha);

    const secondPacket = structuredClone(values.packet);
    secondPacket.taskId = `${values.packet.taskId}-atomic`;
    secondPacket.packetId = `${values.packet.packetId}-atomic`;
    secondPacket.holdoutId = `${values.packet.holdoutId}-atomic`;
    const secondRoot = await computePacketMerkleRoot(secondPacket);
    const secondManifest = {
      ...manifest,
      titleAr: "مهمة ثانية لا يجوز تثبيتها جزئيًا",
      sourcePath:
        `human-evidence/tasks/${secondPacket.packetId}.standard.task.json`,
      packetMerkleRoot: secondRoot,
      packet: secondPacket
    };
    await sendRepositoryTaskSync(
      fixture,
      [secondManifest, changed],
      "dddddddddddddddddddddddddddddddddddddddd",
      409
    );
    assert.equal(
      fixture.db.database.prepare(
        "SELECT COUNT(*) AS count FROM task_versions WHERE packet_id = ?"
      ).get(secondPacket.packetId).count,
      0
    );
    assert.equal(
      fixture.db.database.prepare(
        `SELECT COUNT(*) AS count
           FROM repository_task_packets
          WHERE packet_id = ?`
      ).get(secondPacket.packetId).count,
      0
    );

    const withdrawn = { ...manifest, status: "withdrawn" };
    await sendRepositoryTaskSync(
      fixture,
      [withdrawn],
      "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    );
    assert.equal(
      fixture.db.database.prepare(
        "SELECT status FROM repository_task_packets WHERE packet_id = ?"
      ).get(values.packet.packetId).status,
      "withdrawn"
    );
    const reactivation = await sendRepositoryTaskSync(
      fixture,
      [manifest],
      "ffffffffffffffffffffffffffffffffffffffff",
      409
    );
    assert.match(reactivation.message, /إعادة تنشيط/);
  } finally {
    fixture.restoreFetch();
  }
});

test("repository tasks route A/B disagreement directly to J1", async () => {
  const fixture = await createFixture("repository-task-routing");
  try {
    const values = await independentArtifacts();
    const taskVersionId =
      `${values.packet.taskId}:v${values.packet.taskVersion}`;
    await registerRepositoryTask(
      fixture,
      values.packet,
      "standard",
      "A"
    );
    await claimRepositoryTask(fixture, "B", taskVersionId);
    await submitArtifact(
      fixture,
      "A",
      values.participantIds.A,
      values.artifactA
    );
    const changedAnnotationB = structuredClone(
      values.artifactB.annotation
    );
    for (const sentence of changedAnnotationB.sentences) {
      sentence.structurallyAcceptable =
        !sentence.structurallyAcceptable;
    }
    await submitArtifact(
      fixture,
      "B",
      values.participantIds.B,
      {
        ...values.artifactB,
        annotation: changedAnnotationB
      }
    );

    const task = fixture.db.database.prepare(
      `SELECT state, current_round
         FROM task_versions
        WHERE id = ?`
    ).get(taskVersionId);
    assert.deepEqual(
      { ...task },
      { state: "discussion", current_round: 1 }
    );
    const metrics = fixture.db.database.prepare(
      `SELECT policy_passed
         FROM consensus_metrics
        WHERE task_version_id = ?`
    ).get(taskVersionId);
    assert.equal(metrics.policy_passed, 0);
    assert.equal(
      fixture.db.database.prepare(
        `SELECT COUNT(*) AS count
           FROM consensus_rounds
          WHERE task_version_id = ?`
      ).get(taskVersionId).count,
      1
    );

    const j1Task = await claimRepositoryTask(
      fixture,
      "J1",
      taskVersionId
    );
    assert.equal(j1Task.role, "J1");
    assert.equal(j1Task.clientRole, "adjudication");
    assert.equal(j1Task.annotationA.annotatorSlot, "A");
    assert.equal(j1Task.annotationB.annotatorSlot, "B");
    assert.equal(j1Task.lane, "standard");

    const adjudication = readJson("adjudication.synthetic.json");
    const j1ParticipantId = "33333333-3333-4333-8333-333333333333";
    adjudication.adjudicatorPseudonym =
      `human-${j1ParticipantId.slice(0, 12)}-J1`;
    adjudication.annotationAMerkleRoot =
      await computeAnnotationMerkleRoot(
        values.packet,
        values.artifactA.annotation
      );
    adjudication.annotationBMerkleRoot =
      await computeAnnotationMerkleRoot(
        values.packet,
        changedAnnotationB
      );
    for (const sentence of adjudication.sentences) {
      sentence.resolutionNote =
        "اختير قرار A بعد مراجعة مستقلة لاختلاف سلامة التركيب.";
    }
    const primary = await submitArtifact(
      fixture,
      "J1",
      j1ParticipantId,
      {
        schema: "adg-msa-portal-artifact-v1",
        kind: "adjudication-package",
        packet: values.packet,
        annotationA: values.artifactA.annotation,
        annotationB: changedAnnotationB,
        adjudication
      }
    );
    assert.ok(primary.receiptId);
    const j2Task = await claimRepositoryTask(
      fixture,
      "J2",
      taskVersionId
    );
    assert.equal(j2Task.role, "J2");
    assert.equal(j2Task.clientRole, "ratification");
    assert.equal(j2Task.primaryArtifact.kind, "adjudication-package");
  } finally {
    fixture.restoreFetch();
  }
});

test("draft replacement preserves the previous encrypted revision", async () => {
  const fixture = await createFixture("draft-revisions");
  try {
    const values = await independentArtifacts();
    const first = {
      schema: "adg-msa-portal-draft-v1",
      savedAtUtc: "2026-08-15T01:00:00.000Z",
      participantId: values.participantIds.A,
      role: "A",
      packet: values.packet,
      annotationA: null,
      annotationB: null,
      primaryArtifact: null,
      fields: []
    };
    const second = {
      ...first,
      savedAtUtc: "2026-08-15T01:01:00.000Z",
      fields: [{
        sentenceId: "pilot-01",
        structural: "true",
        predicate: "true",
        tokens: []
      }]
    };
    const firstSave = await putDraft(fixture, "A", first);
    assert.equal(firstSave.revisionPreserved, false);
    const secondSave = await putDraft(fixture, "A", second);
    assert.equal(secondSave.revisionPreserved, true);

    const revision = fixture.db.database.prepare(
      `SELECT ciphertext
         FROM draft_revisions
        WHERE user_id = ? AND packet_id = ? AND role = 'A'`
    ).get(
      fixture.accounts.get("A").userId,
      values.packet.packetId
    );
    const preserved = JSON.parse(await decryptEntityCryptForTest(
      revision.ciphertext,
      fixture.secrets.master
    ));
    assert.deepEqual(preserved, first);

    const current = fixture.db.database.prepare(
      `SELECT ciphertext
         FROM drafts
        WHERE user_id = ? AND packet_id = ? AND role = 'A'`
    ).get(
      fixture.accounts.get("A").userId,
      values.packet.packetId
    );
    const currentDraft = JSON.parse(await decryptEntityCryptForTest(
      current.ciphertext,
      fixture.secrets.master
    ));
    assert.deepEqual(currentDraft, second);
    const listed = await accountJson(fixture, "A", "/api/drafts");
    assert.equal(listed.drafts[0].revisionCount, 1);
  } finally {
    fixture.restoreFetch();
  }
});

test("D1 archive mode persists only encrypted identity payloads for submitted evidence", async () => {
  const fixture = await createFixture("d1-archive");
  fixture.env.EVIDENCE_ARCHIVE_MODE = "d1";
  try {
    const values = await independentArtifacts();
    const result = await submitArtifact(
      fixture,
      "A",
      values.participantIds.A,
      values.artifactA
    );
    const stored = fixture.db.database.prepare(
      `SELECT status, public_payload_json, identity_payload_json
         FROM evidence_outbox
        WHERE related_id = ?`
    ).get(result.receiptId);
    assert.equal(stored.status, "held");
    assert.equal(
      stored.public_payload_json.includes(fixture.accounts.get("A").profile.email),
      false
    );
    assert.equal(
      stored.identity_payload_json.includes(fixture.accounts.get("A").profile.email),
      false
    );
    assert.equal(
      stored.identity_payload_json.includes(fixture.accounts.get("A").profile.fullName),
      false
    );
    const envelope = JSON.parse(stored.identity_payload_json);
    assert.equal(envelope.schema, "adg-entitycrypt-data-room-envelope-v1");
    assert.match(envelope.ciphertext, /^MK1:0:/);
  } finally {
    fixture.restoreFetch();
  }
});

test("an incomplete independent round cancels its held public evidence", async () => {
  const fixture = await createFixture("blind-expiry");
  try {
    const values = await independentArtifacts();
    await submitArtifact(
      fixture,
      "A",
      values.participantIds.A,
      values.artifactA
    );
    fixture.db.database.prepare(
      "UPDATE consensus_rounds SET deadline_at = ? WHERE round_number = 1"
    ).run(Date.now() - 1000);
    let maintenance;
    await worker.scheduled(null, fixture.env, {
      waitUntil(promise) {
        maintenance = promise;
      }
    });
    await maintenance;
    assert.equal(
      fixture.db.database.prepare(
        `SELECT status
           FROM evidence_outbox
          WHERE kind = 'submission'`
      ).get().status,
      "cancelled"
    );
    assert.deepEqual(
      { ...fixture.db.database.prepare(
        "SELECT state, current_round FROM task_versions"
      ).get() },
      { state: "independent-review", current_round: 2 }
    );
  } finally {
    fixture.restoreFetch();
  }
});

test("failed bot protection leaves no consensus state behind", async () => {
  const fixture = await createFixture("mutation-order");
  try {
    const values = await independentArtifacts();
    await submitArtifact(
      fixture,
      "A",
      values.participantIds.A,
      values.artifactA,
      {
        turnstileToken: "invalid-turnstile",
        expectedStatus: 403
      }
    );
    for (const table of [
      "task_versions",
      "consensus_rounds",
      "consensus_events",
      "submissions",
      "evidence_outbox"
    ]) {
      assert.equal(
        fixture.db.database.prepare(
          `SELECT COUNT(*) AS count FROM ${table}`
        ).get().count,
        0,
        `${table} mutated before Turnstile validation`
      );
    }
  } finally {
    fixture.restoreFetch();
  }
});

test("packet identifiers cannot be rebound to different evidence", async () => {
  const fixture = await createFixture("packet-binding");
  try {
    const values = await independentArtifacts();
    await submitArtifact(
      fixture,
      "A",
      values.participantIds.A,
      values.artifactA
    );
    const conflictingPacket = structuredClone(values.packet);
    conflictingPacket.sentences[0].text += " نسخة متعارضة";
    const conflictingAnnotation = structuredClone(values.annotationB);
    conflictingAnnotation.packetMerkleRoot =
      await computePacketMerkleRoot(conflictingPacket);
    await submitArtifact(
      fixture,
      "B",
      values.participantIds.B,
      {
        schema: "adg-msa-portal-artifact-v1",
        kind: "independent-annotation",
        packet: conflictingPacket,
        annotation: conflictingAnnotation
      },
      { expectedStatus: 409 }
    );
    assert.equal(
      fixture.db.database.prepare(
        "SELECT COUNT(*) AS count FROM task_versions"
      ).get().count,
      1
    );
  } finally {
    fixture.restoreFetch();
  }
});

test("J2 disagreement preserves evidence and opens a fresh round", async () => {
  const fixture = await createFixture("disagreement");
  try {
    const result = await submitConsensusSequence(fixture, "disagree");
    assert.equal(result.task.state, "independent-review");
    assert.equal(result.task.current_round, 2);
    const rounds = fixture.db.database.prepare(
      `SELECT round_number, status, reissue_reason
         FROM consensus_rounds
        WHERE task_version_id = ?
        ORDER BY round_number`
    ).all(result.task.id).map(row => ({ ...row }));
    assert.deepEqual(rounds, [
      {
        round_number: 1,
        status: "superseded",
        reissue_reason: "j2-disagreement"
      },
      {
        round_number: 2,
        status: "open",
        reissue_reason: "j2-disagreement"
      }
    ]);
    assert.equal(
      fixture.db.database.prepare(
        "SELECT COUNT(*) AS count FROM submissions WHERE task_version_id = ?"
      ).get(result.task.id).count,
      4
    );
    assert.equal(
      fixture.db.database.prepare(
        `SELECT COUNT(*) AS count
           FROM consensus_events
          WHERE task_version_id = ? AND to_state = 'reissued'`
      ).get(result.task.id).count,
      1
    );
  } finally {
    fixture.restoreFetch();
  }
});

test("a pending appeal prevents repository publication", async () => {
  const fixture = await createFixture("appeal-gate");
  try {
    const result = await submitConsensusSequence(fixture, "agree");
    const account = fixture.accounts.get("A");
    const appealResponse = await worker.fetch(
      new Request(`${origin}/api/consensus/appeals`, {
        method: "POST",
        headers: {
          origin,
          cookie: `adg_session=${account.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          finalReceiptId: result.final.primary_receipt_id,
          evidence:
            "يوجد تعارض مادي موثق في القرار النهائي ويتطلب مراجعة مستقلة."
        })
      }),
      fixture.env
    );
    assert.equal(appealResponse.status, 202, await appealResponse.text());
    fixture.db.database.prepare(
      "UPDATE task_versions SET appeal_deadline_at = ? WHERE id = ?"
    ).run(Date.now() - 1000, result.task.id);
    const approvedEvent = fixture.db.database.prepare(
      `SELECT id, round_id
         FROM consensus_events
        WHERE task_version_id = ? AND to_state = 'approved'
        ORDER BY created_at DESC
        LIMIT 1`
    ).get(result.task.id);
    const acceptedAtUtc = new Date().toISOString();
    const receipt = {
      schema: "adg-msa-repository-receipt-v1",
      receiptId: "99999999-9999-4999-8999-999999999999",
      taskVersionId: result.task.id,
      roundId: approvedEvent.round_id,
      finalMerkleRoot: result.final.final_merkle_root,
      nonce: approvedEvent.id,
      repository,
      prNumber: 51,
      prMergeSha: "e".repeat(40),
      importerCommitSha: "f".repeat(40),
      receivedAtUtc: acceptedAtUtc,
      acceptedAtUtc
    };
    const receiptResponse = await worker.fetch(
      new Request(`${origin}/api/repository/receipts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...receipt,
          hmacSha256: createHmac(
            "sha256",
            fixture.secrets.repositoryReceipt
          ).update(JSON.stringify(receipt)).digest("hex")
        })
      }),
      fixture.env
    );
    assert.equal(receiptResponse.status, 202, await receiptResponse.text());
    assert.deepEqual(
      { ...fixture.db.database.prepare(
        `SELECT state, repository_status
           FROM task_versions
          WHERE id = ?`
      ).get(result.task.id) },
      { state: "approved", repository_status: "accepted" }
    );
  } finally {
    fixture.restoreFetch();
  }
});

test("invalid repository receipt signatures return a bounded 401", async () => {
  const fixture = await createFixture("receipt-rejection");
  try {
    const timestamp = new Date().toISOString();
    const response = await worker.fetch(
      new Request(`${origin}/api/repository/receipts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schema: "adg-msa-repository-receipt-v1",
          receiptId: "12121212-1212-4212-8212-121212121212",
          taskVersionId: "smoke:v1",
          roundId: "smoke:v1:r1",
          finalMerkleRoot: "a".repeat(64),
          nonce: "13131313-1313-4313-8313-131313131313",
          repository,
          prNumber: 1,
          prMergeSha: "b".repeat(40),
          importerCommitSha: "c".repeat(40),
          receivedAtUtc: timestamp,
          acceptedAtUtc: timestamp,
          hmacSha256: "d".repeat(64)
        })
      }),
      fixture.env
    );
    assert.equal(response.status, 401);
    assert.match(
      (await response.json()).message,
      /توقيع إيصال المستودع/
    );
  } finally {
    fixture.restoreFetch();
  }
});

test("identity erasure removes contact linkage after retention", async () => {
  const fixture = await createFixture("erasure");
  try {
    const account = fixture.accounts.get("A");
    const values = await independentArtifacts();
    const taskVersionId =
      `${values.packet.taskId}:v${values.packet.taskVersion}`;
    await registerRepositoryTask(
      fixture,
      values.packet,
      "operational-test",
      "A"
    );
    const round = fixture.db.database.prepare(
      `SELECT id
         FROM consensus_rounds
        WHERE task_version_id = ? AND round_number = 1`
    ).get(taskVersionId);
    const verifiedEmailHash = fixture.db.database.prepare(
      "SELECT verified_email_hash FROM users WHERE id = ?"
    ).get(account.userId).verified_email_hash;
    fixture.db.database.prepare(
      `INSERT INTO drafts
        (user_id, packet_id, role, ciphertext, updated_at)
       VALUES (?, ?, 'A', 'current-draft', ?)`
    ).run(account.userId, values.packet.packetId, Date.now());
    fixture.db.database.prepare(
      `INSERT INTO draft_revisions
        (id, user_id, packet_id, role, ciphertext, content_sha256,
         completion_percent, completed_fields, total_fields, saved_at)
       VALUES (?, ?, ?, 'A', 'prior-draft', ?, 50, 18, 36, ?)`
    ).run(
      crypto.randomUUID(),
      account.userId,
      values.packet.packetId,
      "a".repeat(64),
      Date.now() - 1000
    );
    fixture.db.database.prepare(
      `INSERT INTO task_assignments
        (id, task_version_id, round_id, holdout_id, role, email_hash,
         email_ciphertext, user_id, status, invited_at, updated_at)
       VALUES (?, ?, ?, ?, 'B', ?, ?, ?, 'invited', ?, ?)`
    ).run(
      crypto.randomUUID(),
      taskVersionId,
      round.id,
      values.packet.holdoutId,
      verifiedEmailHash,
      await encryptEntityCrypt(
        account.profile.email,
        fixture.secrets.master
      ),
      account.userId,
      Date.now(),
      Date.now()
    );
    const reportId = crypto.randomUUID();
    fixture.db.database.prepare(
      `INSERT INTO portal_issue_reports
        (id, user_id, category, summary, payload_json, content_sha256,
         status, attempts, created_at, updated_at)
       VALUES (?, ?, 'display', ?, '{}', ?, 'pending', 0, ?, ?)`
    ).run(
      reportId,
      account.userId,
      "خلل في عرض صفحة التحكيم على الجهاز",
      "b".repeat(64),
      Date.now(),
      Date.now()
    );
    const response = await worker.fetch(
      new Request(`${origin}/api/account/privacy/erasure`, {
        method: "POST",
        headers: {
          origin,
          cookie: `adg_session=${account.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ confirm: true })
      }),
      fixture.env
    );
    assert.equal(response.status, 202, await response.text());
    fixture.db.database.prepare(
      `UPDATE identity_erasure_requests
          SET eligible_after = ?
        WHERE user_id = ?`
    ).run(Date.now() - 1000, account.userId);

    let maintenance;
    await worker.scheduled(null, fixture.env, {
      waitUntil(promise) {
        maintenance = promise;
      }
    });
    await maintenance;

    const erased = fixture.db.database.prepare(
      `SELECT profile_ciphertext, consent_json, verified_email_hash
         FROM users
        WHERE id = ?`
    ).get(account.userId);
    assert.equal(erased.verified_email_hash, null);
    assert.deepEqual(JSON.parse(erased.consent_json), {
      identityStorage: false,
      futureContact: false,
      discussionNotifications: false
    });
    const tombstone = JSON.parse(await decryptEntityCryptForTest(
      erased.profile_ciphertext,
      fixture.secrets.master
    ));
    assert.equal(tombstone.schema, "adg-erased-participant-v1");
    assert.equal(
      fixture.db.database.prepare(
        "SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?"
      ).get(account.userId).count,
      0
    );
    assert.equal(
      fixture.db.database.prepare(
        "SELECT COUNT(*) AS count FROM drafts WHERE user_id = ?"
      ).get(account.userId).count,
      0
    );
    assert.equal(
      fixture.db.database.prepare(
        "SELECT COUNT(*) AS count FROM draft_revisions WHERE user_id = ?"
      ).get(account.userId).count,
      0
    );
    assert.equal(
      fixture.db.database.prepare(
        `SELECT COUNT(*) AS count
           FROM operational_task_claims
          WHERE user_id = ?`
      ).get(account.userId).count,
      0
    );
    assert.equal(
      fixture.db.database.prepare(
        "SELECT user_id FROM portal_issue_reports WHERE id = ?"
      ).get(reportId).user_id,
      null
    );
    const erasedAssignment = fixture.db.database.prepare(
      `SELECT email_hash, email_ciphertext, user_id
         FROM task_assignments
        WHERE task_version_id = ? AND role = 'B'`
    ).get(taskVersionId);
    assert.equal(erasedAssignment.user_id, null);
    assert.notEqual(erasedAssignment.email_hash, verifiedEmailHash);
    assert.equal(
      await decryptEntityCryptForTest(
        erasedAssignment.email_ciphertext,
        fixture.secrets.master
      ),
      "هوية ممحوة"
    );
    assert.equal(
      fixture.db.database.prepare(
        `SELECT status
           FROM identity_erasure_requests
          WHERE user_id = ?`
      ).get(account.userId).status,
      "completed"
    );
  } finally {
    fixture.restoreFetch();
  }
});

test("D1 erasure records active-store deletion with provider backup expiry boundary", async () => {
  const fixture = await createFixture("erasure-d1-boundary");
  fixture.env.EVIDENCE_ARCHIVE_MODE = "d1";
  fixture.env.D1_TIME_TRAVEL_RETENTION_DAYS = "7";
  try {
    const account = fixture.accounts.get("A");
    const response = await worker.fetch(
      new Request(`${origin}/api/account/privacy/erasure`, {
        method: "POST",
        headers: {
          origin,
          cookie: `adg_session=${account.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ confirm: true })
      }),
      fixture.env
    );
    assert.equal(response.status, 202);
    const request = await response.json();
    assert.equal(request.deletionScope, "active-store-after-retention");
    assert.equal(request.providerBackupRetentionDays, 7);
    assert.match(request.message, /المخزن النشط/);
    fixture.db.database.prepare(
      `UPDATE identity_erasure_requests
          SET eligible_after = ?
        WHERE user_id = ?`
    ).run(Date.now() - 1000, account.userId);

    let maintenance;
    await worker.scheduled(null, fixture.env, {
      waitUntil(promise) {
        maintenance = promise;
      }
    });
    await maintenance;

    const erased = fixture.db.database.prepare(
      `SELECT profile_ciphertext
         FROM users
        WHERE id = ?`
    ).get(account.userId);
    const tombstone = JSON.parse(await decryptEntityCryptForTest(
      erased.profile_ciphertext,
      fixture.secrets.master
    ));
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
  } finally {
    fixture.restoreFetch();
  }
});

test("identity erasure request blocks later identity submissions", async () => {
  const fixture = await createFixture("erasure-block");
  try {
    const account = fixture.accounts.get("A");
    const response = await worker.fetch(
      new Request(`${origin}/api/account/privacy/erasure`, {
        method: "POST",
        headers: {
          origin,
          cookie: `adg_session=${account.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ confirm: true })
      }),
      fixture.env
    );
    assert.equal(response.status, 202, await response.text());
    const values = await independentArtifacts();
    await submitArtifact(
      fixture,
      "A",
      values.participantIds.A,
      values.artifactA,
      { expectedStatus: 409 }
    );
    assert.equal(
      fixture.db.database.prepare(
        "SELECT COUNT(*) AS count FROM submissions"
      ).get().count,
      0
    );
  } finally {
    fixture.restoreFetch();
  }
});

async function createFixture(tag) {
  const db = new D1TestDatabase();
  const secrets = {
    master: `master-key-${tag}-with-sufficient-entropy`,
    submission: `submission-hmac-${tag}`,
    repositoryReceipt: `repository-receipt-hmac-${tag}`,
    emailVerification: `email-verification-hmac-${tag}`,
    identitySas:
      "https://storage.example.test/identities?sp=rd&sig=test"
  };
  const secretNames = {
    master: `master-${tag}`,
    submission: `submission-${tag}`,
    repositoryReceipt: `repository-${tag}`,
    emailVerification: `email-verification-${tag}`,
    identitySas: `identity-sas-${tag}`
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (new URL(url).hostname === "login.microsoftonline.com") {
      return Response.json({
        access_token: `azure-token-${tag}`,
        expires_in: 3600
      });
    }
    if (url.includes(".vault.azure.net/secrets/")) {
      const name = decodeURIComponent(
        new URL(url).pathname.split("/").at(-1)
      );
      const values = new Map([
        [secretNames.master, secrets.master],
        [secretNames.submission, secrets.submission],
        [secretNames.repositoryReceipt, secrets.repositoryReceipt],
        [secretNames.emailVerification, secrets.emailVerification],
        [secretNames.identitySas, secrets.identitySas]
      ]);
      assert.ok(values.has(name), `Unexpected secret: ${name}`);
      return Response.json({ value: values.get(name) });
    }
    if (url.includes("challenges.cloudflare.com/turnstile")) {
      return Response.json({
        success: init?.body?.get("response") !== "invalid-turnstile"
      });
    }
    throw new Error(`Unexpected fetch in consensus test: ${url}`);
  };
  const env = {
    DB: db,
    ALLOWED_ORIGIN: origin,
    SUBMISSION_ENABLED: "true",
    EVIDENCE_ARCHIVE_MODE: "azure",
    MAX_SUBMISSION_BYTES: "900000",
    TURNSTILE_SECRET: "turnstile-test",
    GITHUB_REPOSITORY: repository,
    ENTITYCRYPT_MASTER_KEY_SECRET_NAME: secretNames.master,
    SUBMISSION_HMAC_SECRET_NAME: secretNames.submission,
    REPOSITORY_RECEIPT_HMAC_SECRET_NAME:
      secretNames.repositoryReceipt,
    EMAIL_VERIFICATION_HMAC_SECRET_NAME:
      secretNames.emailVerification,
    IDENTITY_SAS_SECRET_NAME: secretNames.identitySas,
    IDENTITY_RETENTION_DAYS: "30",
    AZURE_TENANT_ID: "tenant",
    AZURE_CLIENT_ID: "client",
    AZURE_CLIENT_SECRET: "client-secret",
    AZURE_KEY_VAULT_URL: "https://consensus-test.vault.azure.net"
  };
  const accounts = new Map();
  for (const [role, index] of [
    ["A", 1],
    ["B", 2],
    ["J1", 3],
    ["J2", 4]
  ]) {
    const token = `session-${tag}-${role}`;
    const userId = `user-${tag}-${role}`;
    const profile = {
      fullName: `محكم ${role}`,
      email: `${tag}-${role.toLowerCase()}@example.test`,
      experienceYears: 10 + index,
      specialization: "grammar",
      affiliation: null,
      socialAccounts: {}
    };
    db.database.prepare(
      `INSERT INTO users
        (id, profile_ciphertext, consent_json, verified_email_hash,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      await encryptEntityCrypt(JSON.stringify(profile), secrets.master),
      JSON.stringify({
        identityStorage: true,
        futureContact: false,
        discussionNotifications: false
      }),
      createHmac("sha256", secrets.emailVerification)
        .update(`email-v1:${profile.email}`)
        .digest("hex"),
      Date.now(),
      Date.now()
    );
    db.database.prepare(
      `INSERT INTO sessions
        (token_hash, user_id, expires_at, created_at)
       VALUES (?, ?, ?, ?)`
    ).run(
      createHash("sha256").update(token).digest("hex"),
      userId,
      Date.now() + 60 * 60 * 1000,
      Date.now()
    );
    accounts.set(role, { token, userId, profile });
  }
  return {
    db,
    env,
    accounts,
    secrets,
    restoreFetch() {
      globalThis.fetch = originalFetch;
    }
  };
}

async function submitConsensusSequence(fixture, ratificationDecision) {
  const packet = readJson("packet.json");
  const annotationA = readJson("annotation-a.synthetic.json");
  const annotationB = readJson("annotation-b.synthetic.json");
  const adjudication = readJson("adjudication.synthetic.json");
  const participantIds = {
    A: "11111111-1111-4111-8111-111111111111",
    B: "22222222-2222-4222-8222-222222222222",
    J1: "33333333-3333-4333-8333-333333333333",
    J2: "44444444-4444-4444-8444-444444444444"
  };
  annotationA.annotatorPseudonym =
    `human-${participantIds.A.slice(0, 12)}-A`;
  annotationB.annotatorPseudonym =
    `human-${participantIds.B.slice(0, 12)}-B`;
  adjudication.adjudicatorPseudonym =
    `human-${participantIds.J1.slice(0, 12)}-J1`;
  adjudication.annotationAMerkleRoot =
    await computeAnnotationMerkleRoot(packet, annotationA);
  adjudication.annotationBMerkleRoot =
    await computeAnnotationMerkleRoot(packet, annotationB);
  const artifactA = {
    schema: "adg-msa-portal-artifact-v1",
    kind: "independent-annotation",
    packet,
    annotation: annotationA
  };
  const artifactB = {
    schema: "adg-msa-portal-artifact-v1",
    kind: "independent-annotation",
    packet,
    annotation: annotationB
  };
  await submitArtifact(fixture, "A", participantIds.A, artifactA);
  await submitArtifact(fixture, "B", participantIds.B, artifactB);
  const primaryArtifact = {
    schema: "adg-msa-portal-artifact-v1",
    kind: "adjudication-package",
    packet,
    annotationA,
    annotationB,
    adjudication
  };
  const primaryResponse = await submitArtifact(
    fixture,
    "J1",
    participantIds.J1,
    primaryArtifact
  );
  const finalRoot = await computeAdjudicationMerkleRoot(
    packet,
    annotationA,
    annotationB,
    adjudication
  );
  const ratification = {
    schema: RATIFICATION_SCHEMA,
    taskId: packet.taskId,
    taskVersion: packet.taskVersion,
    packetId: packet.packetId,
    holdoutId: packet.holdoutId,
    protocolVersion: packet.protocolVersion,
    packetMerkleRoot: await computePacketMerkleRoot(packet),
    primaryReceiptId: primaryResponse.receiptId,
    primaryAdjudicationMerkleRoot: finalRoot,
    reviewerSlot: "J2",
    reviewerPseudonym:
      `human-${participantIds.J2.slice(0, 12)}-J2`,
    reviewerIsHuman: true,
    reviewerIsSynthetic: false,
    independentFromImplementationTeam: true,
    decision: ratificationDecision,
    rationale:
      ratificationDecision === "agree"
        ? "راجعت الجذر النهائي وجميع الأدلة ووافقت على الحسم الموثق."
        : "لا أوافق على الحسم الحالي ويجب إعادة طرح المهمة بجولة مستقلة."
  };
  await submitArtifact(
    fixture,
    "J2",
    participantIds.J2,
    {
      schema: "adg-msa-portal-artifact-v1",
      kind: "ratification-package",
      primaryArtifact,
      ratification
    }
  );
  const task = fixture.db.database.prepare(
    "SELECT * FROM task_versions WHERE packet_id = ?"
  ).get(packet.packetId);
  return {
    task,
    participants: fixture.db.database.prepare(
      `SELECT user_id, role, status
         FROM task_participations
        WHERE task_version_id = ?
        ORDER BY role`
    ).all(task.id),
    metrics: fixture.db.database.prepare(
      "SELECT * FROM consensus_metrics WHERE task_version_id = ?"
    ).get(task.id),
    final: fixture.db.database.prepare(
      "SELECT * FROM final_results WHERE task_version_id = ?"
    ).get(task.id)
  };
}

async function submitArtifact(
  fixture,
  role,
  participantId,
  artifact,
  options = {}
) {
  const account = fixture.accounts.get(role);
  const payload = {
    schema: "adg-msa-portal-submission-v1",
    participantId,
    profile: account.profile,
    consent: {
      identityStorage: true,
      futureContact: false,
      discussionNotifications: false
    },
    attestation: {
      independent: true,
      blind: true,
      authentic: true
    },
    turnstileToken:
      options.turnstileToken ?? `turnstile-${role}`,
    clientVersion: "consensus-worker-test-v1",
    artifactType: artifact.kind,
    artifactSha256: await sha256Json(artifact),
    artifact
  };
  const response = await worker.fetch(
    new Request(`${origin}/api/submissions`, {
      method: "POST",
      headers: {
        origin,
        cookie: `adg_session=${account.token}`,
        "content-type": "application/json",
        "CF-Connecting-IP": "203.0.113.44"
      },
      body: JSON.stringify(payload)
    }),
    fixture.env
  );
  const result = await response.json();
  assert.equal(
    response.status,
    options.expectedStatus ?? 202,
    JSON.stringify(result)
  );
  return result;
}

async function submitOperationalTest(
  fixture,
  role,
  participantId,
  artifact,
  expectedStatus = 202
) {
  const account = fixture.accounts.get(role);
  const payload = {
    schema: "adg-msa-portal-submission-v1",
    participantId,
    profile: account.profile,
    consent: {
      identityStorage: true,
      futureContact: false,
      discussionNotifications: false
    },
    attestation: {
      independent: false,
      blind: false,
      authentic: true
    },
    submissionMode: "operational-test",
    turnstileToken: `turnstile-operational-${role}`,
    clientVersion: "consensus-worker-test-v1",
    artifactType: artifact.kind,
    artifactSha256: await sha256Json(artifact),
    artifact
  };
  const response = await worker.fetch(
    new Request(`${origin}/api/operational-tests`, {
      method: "POST",
      headers: {
        origin,
        cookie: `adg_session=${account.token}`,
        "content-type": "application/json",
        "CF-Connecting-IP": "203.0.113.44"
      },
      body: JSON.stringify(payload)
    }),
    fixture.env
  );
  const result = await response.json();
  assert.equal(response.status, expectedStatus, JSON.stringify(result));
  return result;
}

async function registerRepositoryTask(
  fixture,
  packet,
  lane,
  accountRole
) {
  const packetMerkleRoot = await computePacketMerkleRoot(packet);
  const manifest = {
    schema: "adg-msa-repository-task-v1",
    titleAr: lane === "operational-test"
      ? "اختبار تشغيلي للحزمة التجريبية"
      : "مهمة تحكيم معيارية",
    summaryAr:
      "حزمة موثقة من المستودع لاختبار التسليم الآمن وإدارة المهمة.",
    assignmentMode: "open",
    lane,
    status: "active",
    sourcePath:
      `human-evidence/tasks/${packet.packetId}.${lane}.task.json`,
    packetMerkleRoot,
    packet
  };
  await sendRepositoryTaskSync(
    fixture,
    [manifest],
    lane === "operational-test"
      ? "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      : "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  );
  return claimRepositoryTask(
    fixture,
    accountRole,
    `${packet.taskId}:v${packet.taskVersion}`,
    lane
  );
}

async function sendRepositoryTaskSync(
  fixture,
  tasks,
  sourceCommitSha,
  expectedStatus = 202
) {
  const envelope = {
    schema: "adg-msa-repository-task-sync-v1",
    repository,
    sourceCommitSha,
    nonce: crypto.randomUUID(),
    requestedAtUtc: new Date().toISOString(),
    tasks
  };
  const signed = {
    ...envelope,
    hmacSha256: createHmac(
      "sha256",
      fixture.secrets.repositoryReceipt
    ).update(JSON.stringify(envelope)).digest("hex")
  };
  const syncResponse = await worker.fetch(
    new Request(`${origin}/api/repository/tasks/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signed)
    }),
    fixture.env
  );
  const result = await syncResponse.json();
  assert.equal(
    syncResponse.status,
    expectedStatus,
    JSON.stringify(result)
  );
  return result;
}

async function claimRepositoryTask(
  fixture,
  accountRole,
  taskVersionId,
  lane = "standard"
) {
  const account = fixture.accounts.get(accountRole);
  const claimResponse = await worker.fetch(
    new Request(`${origin}/api/tasks/claim`, {
      method: "POST",
      headers: {
        origin,
        cookie: `adg_session=${account.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        taskVersionId,
        ...(lane === "operational-test"
          ? { mode: "operational-test" }
          : {})
      })
    }),
    fixture.env
  );
  const claim = await claimResponse.json();
  assert.equal(claimResponse.status, 200, JSON.stringify(claim));
  assert.equal(claim.lane, lane);
  return claim;
}

async function accountJson(fixture, accountRole, path) {
  const account = fixture.accounts.get(accountRole);
  const response = await worker.fetch(
    new Request(`${origin}${path}`, {
      headers: { cookie: `adg_session=${account.token}` }
    }),
    fixture.env
  );
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
}

async function putDraft(fixture, accountRole, draft) {
  const account = fixture.accounts.get(accountRole);
  const response = await worker.fetch(
    new Request(`${origin}/api/draft`, {
      method: "PUT",
      headers: {
        origin,
        cookie: `adg_session=${account.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        packetId: draft.packet.packetId,
        role: draft.role,
        draft
      })
    }),
    fixture.env
  );
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
}

async function independentArtifacts() {
  const packet = readJson("packet.json");
  const annotationA = readJson("annotation-a.synthetic.json");
  const annotationB = readJson("annotation-b.synthetic.json");
  const participantIds = {
    A: "11111111-1111-4111-8111-111111111111",
    B: "22222222-2222-4222-8222-222222222222"
  };
  annotationA.annotatorPseudonym =
    `human-${participantIds.A.slice(0, 12)}-A`;
  annotationB.annotatorPseudonym =
    `human-${participantIds.B.slice(0, 12)}-B`;
  return {
    packet,
    annotationA,
    annotationB,
    participantIds,
    artifactA: {
      schema: "adg-msa-portal-artifact-v1",
      kind: "independent-annotation",
      packet,
      annotation: annotationA
    },
    artifactB: {
      schema: "adg-msa-portal-artifact-v1",
      kind: "independent-annotation",
      packet,
      annotation: annotationB
    }
  };
}

function readJson(name) {
  return JSON.parse(readFileSync(new URL(name, exampleRoot), "utf8"));
}
