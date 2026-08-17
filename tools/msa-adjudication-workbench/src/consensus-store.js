import {
  ROUND_DEADLINE_MS,
  assertConsensusTransition,
  consensusEventHash,
  consensusRoundId,
  taskVersionIdentity
} from "./consensus.js";

export class ConsensusConflict extends Error {
  constructor(message) {
    super(message);
    this.name = "ConsensusConflict";
    this.status = 409;
  }
}

export async function ensureConsensusTask(db, packet, packetRoot, now) {
  const registration = await prepareConsensusTaskRegistration(
    db,
    packet,
    packetRoot,
    now
  );
  await db.batch(registration.statements);
  return assertConsensusTaskRegistration(db, packet, packetRoot);
}

export async function prepareConsensusTaskRegistration(
  db,
  packet,
  packetRoot,
  now
) {
  const identity = taskVersionIdentity(packet, packetRoot);
  const idBinding = await getConsensusTask(db, identity.id);
  if (idBinding && !consensusTaskMatches(
    idBinding,
    identity,
    packet.metricPolicy
  )) {
    throw new ConsensusConflict(
      "Task identity is already bound to different versioned evidence."
    );
  }
  const packetBinding = await db.prepare(
    `SELECT id, packet_merkle_root
       FROM task_versions
      WHERE packet_id = ?`
  ).bind(identity.packetId).first();
  if (packetBinding
      && (packetBinding.id !== identity.id
        || packetBinding.packet_merkle_root !== identity.packetMerkleRoot)) {
    throw new ConsensusConflict(
      "Packet identity is already bound to different versioned evidence."
    );
  }
  const roundId = consensusRoundId(identity.id, 1);
  const initialEventId = `task-open:${identity.id}`;
  const evidence = {
    taskVersionId: identity.id,
    taskBinding: identity,
    metricPolicy: packet.metricPolicy
  };
  const eventHash = await consensusEventHash({
    id: initialEventId,
    taskVersionId: identity.id,
    roundId,
    eventType: "task-opened",
    fromState: "draft",
    toState: "open",
    reasonCode: "task-version-registered",
    evidence,
    createdAt: now
  });

  return {
    identity,
    statements: [
      db.prepare(
        `INSERT OR IGNORE INTO task_versions
          (id, task_id, task_version, packet_id, holdout_id,
           packet_merkle_root, guideline_version, data_version,
           protocol_version, metric_policy_json, state, state_version,
           current_round, last_event_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 0, 1, ?, ?, ?)`
      ).bind(
        identity.id,
        identity.taskId,
        identity.taskVersion,
        identity.packetId,
        identity.holdoutId,
        identity.packetMerkleRoot,
        identity.guidelineVersion,
        identity.dataVersion,
        identity.protocolVersion,
        JSON.stringify(packet.metricPolicy),
        initialEventId,
        now,
        now
      ),
      db.prepare(
        `INSERT OR IGNORE INTO consensus_rounds
          (id, task_version_id, round_number, status,
           opened_at, deadline_at)
         VALUES (?, ?, 1, 'open', ?, ?)`
      ).bind(roundId, identity.id, now, now + ROUND_DEADLINE_MS),
      db.prepare(
        `INSERT OR IGNORE INTO consensus_events
          (id, task_version_id, round_id, event_type, from_state,
           to_state, reason_code, evidence_json, event_hash,
           idempotency_key, created_at)
         VALUES (?, ?, ?, 'task-opened', 'draft', 'open',
                 'task-version-registered', ?, ?, ?, ?)`
      ).bind(
        initialEventId,
        identity.id,
        roundId,
        JSON.stringify(evidence),
        eventHash,
        initialEventId,
        now
      )
    ]
  };
}

export async function assertConsensusTaskRegistration(
  db,
  packet,
  packetRoot
) {
  const identity = taskVersionIdentity(packet, packetRoot);
  const task = await getConsensusTask(db, identity.id);
  if (!consensusTaskMatches(task, identity, packet.metricPolicy)) {
    throw new ConsensusConflict(
      "Task identity is already bound to different versioned evidence."
    );
  }
  return task;
}

function consensusTaskMatches(task, identity, metricPolicy) {
  return Boolean(
    task
    && task.task_id === identity.taskId
    && Number(task.task_version) === identity.taskVersion
    && task.packet_id === identity.packetId
    && task.holdout_id === identity.holdoutId
    && task.packet_merkle_root === identity.packetMerkleRoot
    && task.guideline_version === identity.guidelineVersion
    && task.data_version === identity.dataVersion
    && task.protocol_version === identity.protocolVersion
    && JSON.stringify(JSON.parse(task.metric_policy_json))
      === JSON.stringify(metricPolicy)
  );
}

export async function getConsensusTask(db, taskVersionId) {
  return db.prepare(
    `SELECT id, task_id, task_version, packet_id, holdout_id,
            packet_merkle_root, guideline_version, data_version,
            protocol_version, metric_policy_json, state, state_version,
            current_round, last_event_id, active_final_receipt_id,
            appeal_deadline_at, repository_status, github_issue_number,
            created_at, updated_at, approved_at, published_at, revoked_at
       FROM task_versions
      WHERE id = ?`
  ).bind(taskVersionId).first();
}

export async function getCurrentConsensusRound(db, task) {
  return db.prepare(
    `SELECT id, task_version_id, round_number, status, reissue_reason,
            opened_at, deadline_at, closed_at, prior_round_id
       FROM consensus_rounds
      WHERE task_version_id = ? AND round_number = ?`
  ).bind(task.id, Number(task.current_round)).first();
}

export async function transitionConsensusTask(db, task, transition) {
  assertConsensusTransition(task.state, transition.toState);
  const existing = await db.prepare(
    `SELECT id
       FROM consensus_events
      WHERE idempotency_key = ?`
  ).bind(transition.idempotencyKey).first();
  if (existing) return getConsensusTask(db, task.id);

  const now = transition.createdAt ?? Date.now();
  const eventId = transition.eventId ?? crypto.randomUUID();
  const priorStateHash = await consensusEventHash({
    taskVersionId: task.id,
    state: task.state,
    stateVersion: Number(task.state_version),
    currentRound: Number(task.current_round),
    lastEventId: task.last_event_id
  });
  const evidence = transition.evidence ?? {};
  const eventHash = await consensusEventHash({
    id: eventId,
    taskVersionId: task.id,
    roundId: transition.roundId ?? null,
    eventType: transition.eventType,
    fromState: task.state,
    toState: transition.toState,
    actorUserId: transition.actorUserId ?? null,
    actorSubjectHash: transition.actorSubjectHash ?? null,
    reasonCode: transition.reasonCode,
    evidence,
    priorStateHash,
    createdAt: now
  });
  const nextVersion = Number(task.state_version) + 1;
  const results = await db.batch([
    db.prepare(
      `UPDATE task_versions
          SET state = ?, state_version = state_version + 1,
              last_event_id = ?, updated_at = ?,
              appeal_deadline_at = COALESCE(?, appeal_deadline_at),
              active_final_receipt_id = CASE
                WHEN ? = 1 THEN NULL
                ELSE COALESCE(?, active_final_receipt_id)
              END,
              approved_at = CASE
                WHEN ? = 'approved' THEN ?
                ELSE approved_at
              END,
              published_at = CASE
                WHEN ? = 'published' THEN ?
                ELSE published_at
              END,
              revoked_at = CASE
                WHEN ? = 'revoked' THEN ?
                ELSE revoked_at
              END
        WHERE id = ? AND state = ? AND state_version = ?
          AND (
            ? = 0
            OR (
              appeal_deadline_at IS NOT NULL
              AND appeal_deadline_at <= ?
              AND NOT EXISTS (
                SELECT 1
                  FROM appeals
                 WHERE task_version_id = task_versions.id
                   AND status = 'pending'
              )
            )
          )`
    ).bind(
      transition.toState,
      eventId,
      now,
      transition.appealDeadlineAt ?? null,
      transition.clearActiveFinal ? 1 : 0,
      transition.activeFinalReceiptId ?? null,
      transition.toState,
      now,
      transition.toState,
      now,
      transition.toState,
      now,
      task.id,
      task.state,
      Number(task.state_version),
      transition.requirePublicationReady ? 1 : 0,
      transition.publicationGuardAt ?? now
    ),
    db.prepare(
      `INSERT INTO consensus_events
        (id, task_version_id, round_id, event_type, from_state,
         to_state, actor_user_id, actor_subject_hash, reason_code,
         evidence_json, prior_state_hash, event_hash,
         idempotency_key, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1
            FROM task_versions
           WHERE id = ? AND last_event_id = ?
             AND state = ? AND state_version = ?
        )`
    ).bind(
      eventId,
      task.id,
      transition.roundId ?? null,
      transition.eventType,
      task.state,
      transition.toState,
      transition.actorUserId ?? null,
      transition.actorSubjectHash ?? null,
      transition.reasonCode,
      JSON.stringify(evidence),
      priorStateHash,
      eventHash,
      transition.idempotencyKey,
      now,
      task.id,
      eventId,
      transition.toState,
      nextVersion
    )
  ]);
  if (Number(results[0]?.meta?.changes || 0) !== 1
      || Number(results[1]?.meta?.changes || 0) !== 1) {
    const idempotent = await db.prepare(
      `SELECT id
         FROM consensus_events
        WHERE idempotency_key = ?`
    ).bind(transition.idempotencyKey).first();
    if (!idempotent) {
      throw new ConsensusConflict(
        "Consensus state changed concurrently; reload the task."
      );
    }
  }
  return getConsensusTask(db, task.id);
}

export async function createReissuedRound(db, task, reason, actor) {
  if (!["escalated", "revoked"].includes(task.state)) {
    throw new ConsensusConflict(
      "Only escalated or revoked tasks can be reissued."
    );
  }
  const currentRound = await getCurrentConsensusRound(db, task);
  if (!currentRound) {
    throw new ConsensusConflict("Current consensus round was not found.");
  }
  const reissued = await transitionConsensusTask(db, task, {
    toState: "reissued",
    roundId: currentRound.id,
    eventType: "task-reissued",
    reasonCode: reason,
    evidence: { priorRoundId: currentRound.id },
    actorUserId: actor?.userId ?? null,
    actorSubjectHash: actor?.subjectHash ?? null,
    idempotencyKey: `reissue:${task.id}:${currentRound.id}:${reason}`
  });
  const nextRoundNumber = Number(reissued.current_round) + 1;
  const nextRoundId = consensusRoundId(reissued.id, nextRoundNumber);
  const now = Date.now();
  const update = await db.batch([
    db.prepare(
      `UPDATE consensus_rounds
          SET status = 'superseded', reissue_reason = ?, closed_at = ?
        WHERE id = ? AND status = 'open'`
    ).bind(reason, now, currentRound.id),
    db.prepare(
      `INSERT INTO consensus_rounds
        (id, task_version_id, round_number, status, reissue_reason,
         opened_at, deadline_at, prior_round_id)
       VALUES (?, ?, ?, 'open', ?, ?, ?, ?)`
    ).bind(
      nextRoundId,
      reissued.id,
      nextRoundNumber,
      reason,
      now,
      now + ROUND_DEADLINE_MS,
      currentRound.id
    ),
    db.prepare(
      `UPDATE task_versions
          SET current_round = ?, updated_at = ?
        WHERE id = ? AND state = 'reissued'
          AND current_round = ?`
    ).bind(
      nextRoundNumber,
      now,
      reissued.id,
      Number(reissued.current_round)
    ),
    db.prepare(
      `UPDATE evidence_outbox
          SET status = 'cancelled',
              last_error = 'Independent quorum closed before release.'
        WHERE task_version_id = ?
          AND kind = 'submission'
          AND status = 'held'
          AND related_id IN (
            SELECT receipt_id
              FROM submissions
             WHERE task_version_id = ? AND round_id = ?
          )`
    ).bind(
      reissued.id,
      reissued.id,
      currentRound.id
    )
  ]);
  if (Number(update[1]?.meta?.changes || 0) !== 1
      || Number(update[2]?.meta?.changes || 0) !== 1) {
    throw new ConsensusConflict("Failed to create a fresh consensus round.");
  }
  const refreshed = await getConsensusTask(db, reissued.id);
  return transitionConsensusTask(db, refreshed, {
    toState: "independent-review",
    roundId: nextRoundId,
    eventType: "independent-review-opened",
    reasonCode: "fresh-round-created",
    evidence: {
      priorRoundId: currentRound.id,
      roundNumber: nextRoundNumber
    },
    actorUserId: actor?.userId ?? null,
    actorSubjectHash: actor?.subjectHash ?? null,
    idempotencyKey: `round-open:${nextRoundId}`
  });
}
