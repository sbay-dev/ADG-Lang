import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} from "@simplewebauthn/server";
import {
  computeAdjudicationMerkleRoot,
  computeAnnotationMerkleRoot,
  computePacketMerkleRoot,
  computeRatificationMerkleRoot,
  validateAdjudicationBinding,
  validatePacket,
  validatePublicArtifactText,
  validateRatificationBinding,
  validateSubmissionBinding
} from "../public/protocol.js";
import {
  APPEAL_WINDOW_MS,
  CONSENSUS_POLICY_VERSION,
  DEFAULT_METRIC_POLICY,
  ROUND_DEADLINE_MS,
  agreementPolicyPassed,
  assertConsensusTransition,
  computeIndependentAgreement,
  consensusEventHash,
  consensusRoundId,
  countNovelPrimaryDecisions,
  taskVersionIdentity
} from "./consensus.js";
import {
  ConsensusConflict,
  assertConsensusTaskRegistration,
  createReissuedRound,
  ensureConsensusTask,
  getConsensusTask,
  getCurrentConsensusRound,
  prepareConsensusTaskRegistration,
  transitionConsensusTask
} from "./consensus-store.js";
import {
  countDecisionDifferences,
  notificationEmailContent,
  validateDiscussionInput
} from "./discussion.js";
import {
  EMAIL_CODE_TTL_MS,
  EMAIL_MAX_ATTEMPTS,
  EMAIL_MAX_SENDS_PER_ADDRESS_HOUR,
  EMAIL_MAX_SENDS_PER_REQUESTER_HOUR,
  EMAIL_RESEND_COOLDOWN_MS,
  EMAIL_TOKEN_TTL_MS,
  generateVerificationCode,
  normalizeVerificationCode,
  normalizeVerificationEmail,
  verificationEmailContent
} from "./email-verification.js";
import {
  CpolyAdgPostgresContainer,
  fetchCpolyPostgresStatus,
  processCpolyPostgresContainerMaintenance
} from "./cpoly-postgres-container.js";
import {
  getCpolyRecoveryRuntime,
  processCpolyRecoveryMaintenance,
  routeCpolyBackupRequest
} from "./cpoly-recovery.js";
import { createRuntimeEnv } from "./database.js";
import {
  PORTAL_ISSUE_REPORT_CLAIM_SCHEMA,
  PORTAL_ISSUE_REPORT_RECEIPT_SCHEMA,
  buildPortalIssuePublicPayload,
  validatePortalIssueReportInput
} from "./issue-reporting.js";

export { CpolyAdgPostgresContainer };

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const DEFAULT_ORIGIN = "https://adg.sbay.sa";
const LEGACY_HOST = "ads.sbay.sa";
const SESSION_COOKIE_NAME = "adg_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_ACCOUNT_BODY_BYTES = 750000;
const ADMIN_COOKIE_NAME = "adg_admin";
const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const ADMIN_STATE_TTL_MS = 10 * 60 * 1000;
const GRAPH_APP_SCOPE = "https://graph.microsoft.com/.default";
const GRAPH_MAIL_TIMEOUT_MS = 15000;
const JSON_OBJECT_CONTENT_TYPE = "application/json; charset=utf-8";
const DEFAULT_D1_TIME_TRAVEL_RETENTION_DAYS = 30;
const EVIDENCE_ARCHIVE_MODES = new Set(["d1", "r2", "azure"]);
const REPOSITORY_EVIDENCE_CLAIM_WINDOW_MS = 10 * 60 * 1000;
const REPOSITORY_EVIDENCE_CLAIM_HOLD_MS = 60 * 60 * 1000;
const REPOSITORY_EVIDENCE_CLAIM_MAX_ITEMS = 50;
const REPOSITORY_TASK_SYNC_WINDOW_MS = 15 * 60 * 1000;
const REPOSITORY_TASK_SYNC_MAX_ITEMS = 50;
const REPOSITORY_TASK_SYNC_MAX_BYTES = 5 * 1024 * 1024;
const PORTAL_ISSUE_REPORT_CLAIM_WINDOW_MS = 10 * 60 * 1000;
const PORTAL_ISSUE_REPORT_CLAIM_HOLD_MS = 60 * 60 * 1000;
const PORTAL_ISSUE_REPORT_CLAIM_MAX_ITEMS = 20;
const PORTAL_ISSUE_REPORT_RATE_HOUR = 5;
const PORTAL_ISSUE_REPORT_RATE_DAY = 20;
const GLOBAL_ADMIN_ROLE_TEMPLATE_ID =
  "62e90394-69f5-4237-9190-012177145e10";

const PII_KEYS = new Set([
  "fullName",
  "email",
  "phone",
  "affiliation",
  "socialAccounts",
  "whatsapp",
  "x",
  "tiktok",
  "instagram",
  "threads",
  "telegram",
  "snapchat",
  "facebook",
  "linkedin",
  "youtube",
  "bluesky",
  "otherPlatform",
  "otherUsername"
]);

const SOCIAL_ACCOUNT_KEYS = new Set([
  "whatsapp",
  "x",
  "tiktok",
  "instagram",
  "threads",
  "telegram",
  "snapchat",
  "facebook",
  "linkedin",
  "youtube",
  "bluesky",
  "otherPlatform",
  "otherUsername"
]);

const FORBIDDEN_ANALYSIS_KEYS = new Set([
  "analysis",
  "candidateAware",
  "dependencyGraph",
  "evaluation",
  "morphology",
  "parse",
  "parserOutput",
  "parserPredictions",
  "predictions",
  "strictTag"
]);

const azureTokenCache = new Map();
const secretCache = new Map();
let entraMetadataCache = null;
let entraJwksCache = null;
const graphAppTokenCache = new Map();
const adminRoleCache = new Map();

export default {
  async fetch(request, env) {
    const runtimeEnv = createRuntimeEnv(env);
    const url = new URL(request.url);
    try {
      const legacyRedirect = redirectLegacyOrigin(request, runtimeEnv, url);
      if (legacyRedirect) return legacyRedirect;

      const cpolyBackupResponse = await routeCpolyBackupRequest(
        request,
        runtimeEnv,
        url
      );
      if (cpolyBackupResponse) {
        return cpolyBackupResponse;
      }

      await enforceRecoveryReady(runtimeEnv, url);

      if (url.pathname === "/api/config" && request.method === "GET") {
        return json({
          submissionEnabled:
            String(runtimeEnv.SUBMISSION_ENABLED).toLowerCase() === "true",
          maxSubmissionBytes: Number(
            runtimeEnv.MAX_SUBMISSION_BYTES || 900000
          ),
          turnstileSiteKey: runtimeEnv.TURNSTILE_SITE_KEY || null,
          repository:
            runtimeEnv.GITHUB_REPOSITORY || "sbay-dev/ADG-Lang",
          accountEnabled: Boolean(runtimeEnv.DB),
          emailVerificationEnabled: emailVerificationAvailable(runtimeEnv)
        });
      }

      const adminResponse = await routeAdminRequest(
        request,
        runtimeEnv,
        url
      );
      if (adminResponse) {
        return adminResponse;
      }

      const accountResponse = await routeAccountRequest(
        request,
        runtimeEnv,
        url
      );
      if (accountResponse) {
        return accountResponse;
      }

      if (url.pathname === "/api/repository/receipts"
          && request.method === "POST") {
        return await receiveRepositoryReceipt(request, runtimeEnv);
      }
      if (url.pathname === "/api/repository/evidence/claim"
          && request.method === "POST") {
        return await claimRepositoryEvidence(request, runtimeEnv);
      }
      if (url.pathname === "/api/repository/tasks/sync"
          && request.method === "POST") {
        return await syncRepositoryTasks(request, runtimeEnv);
      }
      if (url.pathname === "/api/repository/issue-reports/claim"
          && request.method === "POST") {
        return await claimPortalIssueReports(request, runtimeEnv);
      }
      if (url.pathname === "/api/repository/issue-reports/receipts"
          && request.method === "POST") {
        return await receivePortalIssueReportReceipt(request, runtimeEnv);
      }

      if (url.pathname === "/api/submissions"
          && request.method === "POST") {
        enforceOrigin(request, runtimeEnv);
        return await receiveSubmission(request, runtimeEnv);
      }
      if (url.pathname === "/api/operational-tests"
          && request.method === "POST") {
        enforceOrigin(request, runtimeEnv);
        return await receiveOperationalTest(request, runtimeEnv);
      }

      if (url.pathname.startsWith("/api/")) {
        return json({ message: "المسار المطلوب غير موجود." }, 404);
      }

      if (url.pathname === "/admin") {
        return Response.redirect(`${url.origin}/admin/`, 302);
      }

      const asset = await runtimeEnv.ASSETS.fetch(request);
      return withSecurityHeaders(asset);
    } catch (error) {
      if (!(error instanceof PublicError && error.status < 500)) {
        console.error("ADG request failed", {
          path: url.pathname,
          name: error?.name,
          message: error?.message
        });
      }
      return json(
        {
          message: error instanceof PublicError
            ? error.message
            : "تعذر إكمال الطلب بأمان. حاول لاحقًا أو احفظ نسخة محلية."
        },
        error instanceof PublicError ? error.status : 500
      );
    } finally {
      await runtimeEnv.__runtimeCleanup__?.();
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil((async () => {
      const runtimeEnv = createRuntimeEnv(env);
      try {
        await runScheduledMaintenance(runtimeEnv);
      } finally {
        await runtimeEnv.__runtimeCleanup__?.();
      }
    })());
  }
};

async function runScheduledMaintenance(env) {
  const recoveryRuntime = await getCpolyRecoveryRuntime(env);
  let containerStatus = null;
  if (env?.DB?.__isContainerPostgresD1Database) {
    try {
      containerStatus = await processCpolyPostgresContainerMaintenance(env, {
        triggerBackup: recoveryRuntime.state !== "recovering"
      });
    } catch (error) {
      console.error("CPOLY PostgreSQL container maintenance failed", {
        name: error?.name,
        message: error?.message
      });
      await processCpolyRecoveryMaintenance(env);
      return;
    }
  }
  if (recoveryRuntime.state === "recovering"
      || (containerStatus && !containerStatus.ready)) {
    await processCpolyRecoveryMaintenance(env);
    return;
  }
  await Promise.all([
    processCpolyRecoveryMaintenance(env),
    processNotificationOutbox(env),
    processGovernanceNotificationOutbox(env),
    processEvidenceOutbox(env),
    processExpiredConsensusRounds(env),
    processPublishableTasks(env)
  ]);
  await processIdentityErasureRequests(env);
}

async function enforceRecoveryReady(env, url) {
  if (!url.pathname.startsWith("/api/")
      && !url.pathname.startsWith("/signin-microsoft")
      && !url.pathname.startsWith("/api/admin/")) {
    return;
  }
  const recoveryRuntime = await getCpolyRecoveryRuntime(env);
  if (recoveryRuntime.state !== "recovering") {
    if (!env?.DB?.__isContainerPostgresD1Database) {
      return;
    }
    try {
      const status = await fetchCpolyPostgresStatus(env);
      if (!status || status.ready) {
        return;
      }
    } catch (error) {
      console.error("CPOLY PostgreSQL container readiness probe failed", {
        name: error?.name,
        message: error?.message
      });
    }
  }
  throw new PublicError(
    "تجري الآن عملية استعادة موثقة. تعود الخدمات الديناميكية بعد اكتمال التحقق.",
    503
  );
}

async function routeAdminRequest(request, env, url) {
  if (!url.pathname.startsWith("/api/admin/")
      && url.pathname !== "/signin-microsoft") {
    return null;
  }
  if (!env.DB || !env.ENTRA_TENANT_ID || !env.ENTRA_CLIENT_ID
      || !env.ENTRA_CLIENT_SECRET_NAME) {
    throw new PublicError("لوحة المسؤول غير مهيأة بعد.", 503);
  }

  if (url.pathname === "/api/admin/auth/login"
      && request.method === "GET") {
    return beginAdminLogin(env);
  }
  if (url.pathname === "/signin-microsoft"
      && request.method === "GET") {
    return finishAdminLogin(url, env);
  }
  if (url.pathname === "/api/admin/auth/me"
      && request.method === "GET") {
    return getAdminIdentity(request, env);
  }
  if (url.pathname === "/api/admin/auth/logout"
      && request.method === "POST") {
    enforceExactOrigin(request, env);
    return logoutAdmin(request, env);
  }
  if (url.pathname === "/api/admin/progress"
      && request.method === "GET") {
    return getAdminProgress(request, env);
  }
  if (url.pathname === "/api/admin/tasks/reissue"
      && request.method === "POST") {
    enforceExactOrigin(request, env);
    return reissueConsensusTask(
      request,
      env,
      await readJsonBody(request)
    );
  }
  if (url.pathname === "/api/admin/tasks/assign"
      && request.method === "POST") {
    enforceExactOrigin(request, env);
    return assignRepositoryTask(
      request,
      env,
      await readJsonBody(request)
    );
  }
  if (url.pathname === "/api/admin/appeals/review"
      && request.method === "POST") {
    enforceExactOrigin(request, env);
    return reviewConsensusAppeal(
      request,
      env,
      await readJsonBody(request)
    );
  }
  if (url.pathname === "/api/admin/discussion/moderate"
      && request.method === "POST") {
    enforceExactOrigin(request, env);
    return moderateDiscussionComment(
      request,
      env,
      await readJsonBody(request)
    );
  }

  return json({ message: "المسار الإداري غير موجود." }, 404);
}

async function beginAdminLogin(env) {
  const state = randomBase64Url(32);
  const verifier = randomBase64Url(48);
  const nonce = randomBase64Url(32);
  const challenge = base64UrlFromBytes(new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier)
    )
  ));
  const masterKey = await getVaultSecret(
    env.ENTITYCRYPT_MASTER_KEY_SECRET_NAME,
    env
  );
  const stateCiphertext = await encryptEntityCrypt(
    JSON.stringify({ verifier, nonce }),
    masterKey
  );
  const now = Date.now();
  await pruneAdminRecords(env.DB, now);
  await env.DB.prepare(
    `INSERT INTO admin_oidc_states
      (state_hash, ciphertext, expires_at, created_at)
     VALUES (?, ?, ?, ?)`
  ).bind(
    await sha256Hex(state),
    stateCiphertext,
    now + ADMIN_STATE_TTL_MS,
    now
  ).run();

  const metadata = await getEntraMetadata(env);
  const authorize = new URL(metadata.authorization_endpoint);
  authorize.search = new URLSearchParams({
    client_id: env.ENTRA_CLIENT_ID,
    response_type: "code",
    redirect_uri: adminCallbackUri(env),
    response_mode: "query",
    scope: "openid profile email User.Read",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account"
  }).toString();
  return new Response(null, {
    status: 302,
    headers: {
      location: authorize.toString(),
      "cache-control": "no-store"
    }
  });
}

async function finishAdminLogin(url, env) {
  try {
    if (url.searchParams.has("error")) {
      throw new PublicError("رفض موفر الهوية طلب الدخول.", 401);
    }
    const code = normalizedOidcValue(
      url.searchParams.get("code"),
      4096,
      "رمز الدخول"
    );
    const state = normalizedOidcValue(
      url.searchParams.get("state"),
      512,
      "حالة الدخول"
    );
    const pending = await takeAdminState(state, env);
    const masterKey = await getVaultSecret(
      env.ENTITYCRYPT_MASTER_KEY_SECRET_NAME,
      env
    );
    const stateData = JSON.parse(await decryptEntityCrypt(
      pending.ciphertext,
      masterKey
    ));
    const tokens = await exchangeAdminCode(
      code,
      stateData.verifier,
      env
    );
    const claims = await verifyEntraIdToken(
      tokens.id_token,
      stateData.nonce,
      env
    );
    const profile = await getEntraMemberProfile(
      tokens.access_token,
      claims,
      env
    );
    const authority = await verifyGlobalAdministrator(
      claims,
      profile.id,
      env
    );
    if (!authority.isAdmin || !authority.authoritative) {
      await recordAdminAudit(
        env.DB,
        await adminSubjectHash(profile.id, env),
        "login",
        false,
        "Global Administrator authority was not proven."
      );
      return adminPageRedirect(env, "forbidden");
    }

    const now = Date.now();
    const session = await createAdminSessionRecord(now);
    const subjectHash = await adminSubjectHash(profile.id, env);
    const identityCiphertext = await encryptEntityCrypt(
      JSON.stringify({
        objectId: profile.id,
        displayName: profile.displayName,
        email: profile.email,
        authoritySource: authority.source
      }),
      masterKey
    );
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO admin_sessions
          (token_hash, subject_hash, identity_ciphertext,
           expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(
        session.tokenHash,
        subjectHash,
        identityCiphertext,
        session.expiresAt,
        now
      ),
      env.DB.prepare(
        `INSERT INTO admin_audit
          (id, subject_hash, event_type, success, detail, created_at)
         VALUES (?, ?, 'login', 1, ?, ?)`
      ).bind(
        crypto.randomUUID(),
        subjectHash,
        authority.source,
        now
      )
    ]);
    return adminPageRedirect(
      env,
      null,
      adminSessionCookie(env, session.token)
    );
  } catch (error) {
    console.error("ADS admin login failed", {
      name: error?.name,
      message: error?.message
    });
    try {
      await recordAdminAudit(
        env.DB,
        null,
        "login",
        false,
        "Microsoft Entra authentication failed."
      );
    } catch (auditError) {
      console.error("ADS admin audit failed", {
        name: auditError?.name,
        message: auditError?.message
      });
    }
    return adminPageRedirect(env, "authentication_failed");
  }
}

async function getAdminIdentity(request, env) {
  const session = await findAdminSession(request, env, false);
  if (!session) {
    return json({ authenticated: false, administrator: false });
  }
  return json({
    authenticated: true,
    administrator: true,
    displayName: session.identity.displayName,
    email: session.identity.email,
    authoritySource: session.identity.authoritySource,
    expiresAtUtc: new Date(session.expires_at).toISOString()
  });
}

async function logoutAdmin(request, env) {
  const token = cookieValue(request, ADMIN_COOKIE_NAME);
  let subjectHash = null;
  if (token) {
    const tokenHash = await sha256Hex(token);
    const row = await env.DB.prepare(
      "SELECT subject_hash FROM admin_sessions WHERE token_hash = ?"
    ).bind(tokenHash).first();
    subjectHash = row?.subject_hash ?? null;
    await env.DB.prepare(
      "DELETE FROM admin_sessions WHERE token_hash = ?"
    ).bind(tokenHash).run();
  }
  await recordAdminAudit(
    env.DB,
    subjectHash,
    "logout",
    true,
    "Administrator session signed out."
  );
  return json(
    { authenticated: false },
    200,
    { "set-cookie": clearAdminSessionCookie(env) }
  );
}

async function getAdminProgress(request, env) {
  const administrator = await findAdminSession(request, env, true);
  const [
    usersResult,
    draftsResult,
    submissionsResult,
    tasksResult,
    appealsResult,
    commentsResult,
    taskAssignmentsResult
  ] =
    await Promise.all([
      env.DB.prepare(
        `SELECT id, profile_ciphertext, created_at
           FROM users
          ORDER BY created_at DESC
          LIMIT 500`
      ).all(),
      env.DB.prepare(
        `SELECT user_id, packet_id, role, completion_percent,
                completed_fields, total_fields, started_at, updated_at
           FROM drafts
          ORDER BY updated_at DESC`
      ).all(),
      env.DB.prepare(
        `SELECT receipt_id, user_id, packet_id, role, submitted_at
           FROM submissions
          ORDER BY submitted_at DESC`
      ).all(),
      env.DB.prepare(
        `SELECT tv.id, tv.packet_id, tv.task_version, tv.state,
                tv.current_round, tv.repository_status,
                tv.active_final_receipt_id, tv.appeal_deadline_at,
                tv.github_issue_number, tv.updated_at,
                rtp.manifest_json, rtp.assignment_mode,
                rtp.lane,
                rtp.source_repository, rtp.source_path,
                rtp.source_commit_sha
           FROM task_versions tv
           LEFT JOIN repository_task_packets rtp
             ON rtp.task_version_id = tv.id
          ORDER BY tv.updated_at DESC
          LIMIT 100`
      ).all(),
      env.DB.prepare(
        `SELECT a.id, a.task_version_id, a.final_receipt_id,
                a.evidence, a.status, a.created_at,
                tv.packet_id, tv.state
           FROM appeals a
           JOIN task_versions tv ON tv.id = a.task_version_id
          ORDER BY a.created_at DESC
          LIMIT 100`
      ).all(),
      env.DB.prepare(
        `SELECT dc.comment_id, dc.packet_id,
                dc.participant_pseudonym, dc.category, dc.body,
                dc.created_at, dm.state AS moderation_state
           FROM discussion_comments dc
           LEFT JOIN discussion_moderation dm
             ON dm.id = (
               SELECT id
                 FROM discussion_moderation
                WHERE comment_id = dc.comment_id
                ORDER BY created_at DESC
                LIMIT 1
             )
          ORDER BY dc.created_at DESC
          LIMIT 100`
      ).all(),
      env.DB.prepare(
        `SELECT ta.id, ta.task_version_id, ta.round_id, ta.role,
                ta.email_ciphertext, ta.user_id, ta.status,
                ta.invited_at, ta.claimed_at, ta.submitted_at,
                ta.updated_at
           FROM task_assignments ta
          ORDER BY ta.updated_at DESC
          LIMIT 400`
      ).all()
    ]);
  const masterKey = await getVaultSecret(
    env.ENTITYCRYPT_MASTER_KEY_SECRET_NAME,
    env
  );
  const submissions = new Map();
  for (const item of submissionsResult.results || []) {
    const key = adminTaskKey(item.user_id, item.packet_id, item.role);
    if (!submissions.has(key)) submissions.set(key, item);
  }
  const draftsByUser = new Map();
  for (const item of draftsResult.results || []) {
    const list = draftsByUser.get(item.user_id) || [];
    list.push(item);
    draftsByUser.set(item.user_id, list);
  }
  const taskAssignments = new Map();
  for (const item of taskAssignmentsResult.results || []) {
    const list = taskAssignments.get(item.task_version_id) || [];
    let email = null;
    try {
      email = await decryptEntityCrypt(item.email_ciphertext, masterKey);
    } catch {
      email = "تعذر فك بريد الإسناد";
    }
    list.push({
      id: item.id,
      roundId: item.round_id,
      role: item.role,
      email,
      userId: item.user_id,
      status: item.status,
      invitedAtUtc: new Date(item.invited_at).toISOString(),
      claimedAtUtc: item.claimed_at
        ? new Date(item.claimed_at).toISOString()
        : null,
      submittedAtUtc: item.submitted_at
        ? new Date(item.submitted_at).toISOString()
        : null,
      updatedAtUtc: new Date(item.updated_at).toISOString()
    });
    taskAssignments.set(item.task_version_id, list);
  }

  const participants = [];
  for (const user of usersResult.results || []) {
    const profile = JSON.parse(await decryptEntityCrypt(
      user.profile_ciphertext,
      masterKey
    ));
    const assignments = (draftsByUser.get(user.id) || []).map(draft => {
      const submission = submissions.get(adminTaskKey(
        user.id,
        draft.packet_id,
        draft.role
      ));
      return {
        packetId: draft.packet_id,
        role: draft.role,
        completionPercent: submission
          ? 100
          : Number(draft.completion_percent),
        completedFields: Number(draft.completed_fields),
        totalFields: Number(draft.total_fields),
        startedAtUtc: new Date(
          Number(draft.started_at) || Number(draft.updated_at)
        ).toISOString(),
        updatedAtUtc: new Date(draft.updated_at).toISOString(),
        status: submission ? "submitted" : "in-progress",
        receiptId: submission?.receipt_id ?? null,
        submittedAtUtc: submission
          ? new Date(submission.submitted_at).toISOString()
          : null
      };
    });
    const submitted = assignments.filter(
      item => item.status === "submitted"
    ).length;
    const progress = assignments.length === 0
      ? 0
      : Math.round(assignments.reduce(
        (sum, item) => sum + item.completionPercent,
        0
      ) / assignments.length);
    const lastActivity = assignments
      .map(item => item.submittedAtUtc || item.updatedAtUtc)
      .sort()
      .at(-1) ?? null;
    const erased = profile.schema === "adg-erased-participant-v1";
    participants.push({
      userId: user.id,
      fullName: erased ? "هوية ممحوة" : profile.fullName,
      email: erased ? null : profile.email,
      socialAccounts: erased ? {} : profile.socialAccounts ?? {},
      specialization: erased ? null : profile.specialization,
      affiliation: erased ? null : profile.affiliation,
      experienceYears: erased ? null : profile.experienceYears,
      registeredAtUtc: new Date(user.created_at).toISOString(),
      lastActivityUtc: lastActivity,
      progressPercent: progress,
      status: assignments.length === 0
        ? "not-started"
        : submitted === assignments.length
          ? "submitted"
          : "in-progress",
      assignments
    });
  }

  const active = participants.filter(
    item => item.status === "in-progress"
  ).length;
  const completed = participants.filter(
    item => item.status === "submitted"
  ).length;
  const averageProgress = participants.length === 0
    ? 0
    : Math.round(participants.reduce(
      (sum, item) => sum + item.progressPercent,
      0
    ) / participants.length);
  await recordAdminAudit(
    env.DB,
    administrator.subject_hash,
    "read-participant-progress",
    true,
    `Read ${participants.length} profiles, `
      + `${tasksResult.results?.length || 0} tasks, and `
      + `${appealsResult.results?.length || 0} appeals.`
  );
  return json({
    generatedAtUtc: new Date().toISOString(),
    administrator: {
      displayName: administrator.identity.displayName,
      authoritySource: administrator.identity.authoritySource
    },
    summary: {
      total: participants.length,
      active,
      completed,
      notStarted: participants.length - active - completed,
      averageProgress
    },
    participants,
    governance: {
      tasks: (tasksResult.results || []).map(row => ({
        taskVersionId: row.id,
        packetId: row.packet_id,
        taskVersion: Number(row.task_version),
        state: row.state,
        round: Number(row.current_round),
        repositoryStatus: row.repository_status,
        activeFinalReceiptId: row.active_final_receipt_id,
        appealDeadlineAtUtc: row.appeal_deadline_at
          ? new Date(row.appeal_deadline_at).toISOString()
          : null,
        githubIssueNumber: row.github_issue_number,
        updatedAtUtc: new Date(row.updated_at).toISOString(),
        repositoryTask: row.manifest_json
          ? {
            title: parseRepositoryTaskManifest(row.manifest_json).titleAr,
            assignmentMode: row.assignment_mode,
            lane: row.lane,
            repository: row.source_repository,
            path: row.source_path,
            commitSha: row.source_commit_sha
          }
          : null,
        assignments: taskAssignments.get(row.id) || []
      })),
      appeals: (appealsResult.results || []).map(row => ({
        id: row.id,
        taskVersionId: row.task_version_id,
        packetId: row.packet_id,
        finalReceiptId: row.final_receipt_id,
        evidence: row.evidence,
        status: row.status,
        taskState: row.state,
        createdAtUtc: new Date(row.created_at).toISOString()
      })),
      comments: (commentsResult.results || []).map(row => ({
        commentId: row.comment_id,
        packetId: row.packet_id,
        participantPseudonym: row.participant_pseudonym,
        category: row.category,
        body: row.body,
        moderationState: row.moderation_state || "visible",
        createdAtUtc: new Date(row.created_at).toISOString()
      }))
    }
  });
}

async function assignRepositoryTask(request, env, body) {
  const administrator = await findAdminSession(request, env, true);
  const taskVersionId = requiredTaskVersionId(
    body?.taskVersionId,
    "معرف إصدار المهمة"
  );
  const role = String(body?.role || "").toUpperCase();
  if (!["A", "B", "J1", "J2"].includes(role)) {
    throw new PublicError("دور الإسناد غير صالح.", 400);
  }
  let email;
  try {
    email = normalizeVerificationEmail(body?.email);
  } catch {
    throw new PublicError("بريد المحكّم غير صالح.", 400);
  }
  const context = await getRepositoryTaskContext(env.DB, taskVersionId);
  if (!context || context.catalog_status !== "active") {
    throw new PublicError(
      "لا يمكن إسناد مهمة قبل تسجيلها من المستودع.",
      404
    );
  }
  if (context.lane === "operational-test") {
    throw new PublicError(
      "الاختبار التشغيلي مفتوح داخل وضعه المعزول ولا يقبل إسناد أدوار إجماع.",
      409
    );
  }
  const emailHash = await verifiedEmailAddressHash(email, env);
  const user = await env.DB.prepare(
    "SELECT id FROM users WHERE verified_email_hash = ?"
  ).bind(emailHash).first();
  if (user) {
    const conflict = await env.DB.prepare(
      `SELECT role
         FROM task_participations
        WHERE holdout_id = ? AND user_id = ?
        UNION ALL
       SELECT role
         FROM task_assignments
        WHERE holdout_id = ? AND user_id = ?
          AND status IN ('invited', 'claimed', 'submitted')
          AND NOT (
            task_version_id = ? AND round_id = ? AND role = ?
          )
        LIMIT 1`
    ).bind(
      context.holdout_id,
      user.id,
      context.holdout_id,
      user.id,
      context.task_version_id,
      context.round_id,
      role
    ).first();
    if (conflict) {
      throw new PublicError(
        "لا يمكن إسناد أكثر من دور للحساب نفسه على المادة نفسها.",
        409
      );
    }
  }

  const existing = await env.DB.prepare(
    `SELECT id, status
       FROM task_assignments
      WHERE task_version_id = ? AND round_id = ? AND role = ?`
  ).bind(
    context.task_version_id,
    context.round_id,
    role
  ).first();
  if (existing?.status === "submitted") {
    throw new PublicError("أُنجز هذا الدور ولا يمكن إعادة إسناده.", 409);
  }
  const masterKey = await getVaultSecret(
    env.ENTITYCRYPT_MASTER_KEY_SECRET_NAME,
    env
  );
  const encryptedEmail = await encryptEntityCrypt(email, masterKey);
  const now = Date.now();
  const assignmentId = existing?.id || crypto.randomUUID();
  let write;
  if (existing) {
    write = await env.DB.prepare(
      `UPDATE task_assignments
          SET email_hash = ?, email_ciphertext = ?, user_id = ?,
              status = 'invited', invited_at = ?, claimed_at = NULL,
              submitted_at = NULL, submission_receipt_id = NULL,
              updated_at = ?
        WHERE id = ? AND status <> 'submitted'`
    ).bind(
      emailHash,
      encryptedEmail,
      user?.id ?? null,
      now,
      now,
      assignmentId
    ).run();
  } else {
    write = await env.DB.prepare(
      `INSERT INTO task_assignments
        (id, task_version_id, round_id, holdout_id, role, email_hash,
         email_ciphertext, user_id, status, invited_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'invited', ?, ?)`
    ).bind(
      assignmentId,
      context.task_version_id,
      context.round_id,
      context.holdout_id,
      role,
      emailHash,
      encryptedEmail,
      user?.id ?? null,
      now,
      now
    ).run();
  }
  if (Number(write.meta?.changes || 0) !== 1) {
    throw new PublicError("تعذر تثبيت إسناد المهمة.", 409);
  }
  await recordAdminAudit(
    env.DB,
    administrator.subject_hash,
    "assign-repository-task",
    true,
    `${taskVersionId}:${role}:${emailHash.slice(0, 12)}`
  );

  const manifest = parseRepositoryTaskManifest(context.manifest_json);
  try {
    await sendNotificationEmail(
      env,
      email,
      repositoryTaskInvitationEmailContent(
        manifest,
        role,
        env.ALLOWED_ORIGIN || DEFAULT_ORIGIN
      ),
      "adjudication-task-assignment",
      assignmentId
    );
  } catch (error) {
    console.error("ADG task assignment email delivery failed", {
      assignmentId,
      message: error?.message
    });
    throw new PublicError(
      "ثُبّت الإسناد، لكن تعذر إرسال رسالة الدعوة. أعد الإسناد لإعادة الإرسال.",
      502
    );
  }

  return json({
    assigned: true,
    assignmentId,
    taskVersionId,
    packetId: context.packet_id,
    role,
    email,
    registeredAccount: Boolean(user),
    message: "ثُبّت الإسناد وأُرسلت الدعوة إلى البريد المحدد."
  });
}

function repositoryTaskInvitationEmailContent(manifest, role, origin) {
  const roleName = {
    A: "المعلّق المستقل A",
    B: "المعلّق المستقل B",
    J1: "المحكّم الرئيس J1",
    J2: "المراجع النهائي J2"
  }[role];
  const portal = new URL("/", origin).toString();
  return {
    subject: `مهمة تحكيم جديدة: ${manifest.titleAr}`,
    plainText:
      `أُسندت إليك مهمة «${manifest.titleAr}» بدور ${roleName}. `
      + `سجّل الدخول بالبريد نفسه، وستظهر المهمة في قائمة مهامك: ${portal}`,
    html:
      `<p>أُسندت إليك مهمة <strong>${escapeEmailHtml(manifest.titleAr)}</strong> `
      + `بدور <strong>${escapeEmailHtml(roleName)}</strong>.</p>`
      + `<p>${escapeEmailHtml(manifest.summaryAr)}</p>`
      + `<p><a href="${escapeEmailHtml(portal)}">افتح منصة التحكيم</a>، `
      + `وسجّل الدخول بالبريد نفسه لتظهر المهمة مباشرة.</p>`
  };
}

async function reissueConsensusTask(request, env, body) {
  const administrator = await findAdminSession(request, env, true);
  const taskVersionId = normalizedText(
    body?.taskVersionId,
    3,
    200,
    "معرف نسخة المهمة"
  );
  const reasons = new Set([
    "missing-quorum-deadline",
    "accepted-recusal",
    "j2-disagreement",
    "accepted-appeal",
    "material-evidence-defect",
    "low-independent-agreement",
    "novel-primary-decision"
  ]);
  if (!reasons.has(body?.reason)) {
    throw new PublicError("سبب إعادة الطرح غير معتمد.", 400);
  }
  const task = await getConsensusTask(env.DB, taskVersionId);
  if (!task) throw new PublicError("نسخة المهمة غير موجودة.", 404);
  let updated;
  try {
    updated = await createReissuedRound(
      env.DB,
      task,
      body.reason,
      { subjectHash: administrator.subject_hash }
    );
  } catch (error) {
    if (error instanceof ConsensusConflict) {
      throw new PublicError(error.message, 409);
    }
    throw error;
  }
  await ensureTaskStateEvidence(env, updated);
  await queueGovernanceNotifications(
    env,
    updated.id,
    "task-reissued",
    {
      taskVersionId: updated.id,
      packetId: updated.packet_id,
      reason: body.reason
    },
    `task-reissued:${updated.last_event_id}`
  );
  await recordAdminAudit(
    env.DB,
    administrator.subject_hash,
    "reissue-consensus-task",
    true,
    `${taskVersionId}:${body.reason}`
  );
  return json({
    reissued: true,
    taskVersionId,
    state: updated.state,
    round: Number(updated.current_round)
  });
}

async function reviewConsensusAppeal(request, env, body) {
  const administrator = await findAdminSession(request, env, true);
  const appealId = requiredId(body?.appealId, "معرف الاستئناف");
  const decision = body?.decision;
  if (!["accepted", "rejected"].includes(decision)) {
    throw new PublicError("قرار الاستئناف غير صالح.", 400);
  }
  const reason = normalizedText(
    body?.reason,
    20,
    4000,
    "تعليل قرار الاستئناف"
  );
  const appeal = await env.DB.prepare(
    `SELECT id, task_version_id, round_id, final_receipt_id,
            appellant_user_id, status
       FROM appeals
      WHERE id = ?`
  ).bind(appealId).first();
  if (!appeal || appeal.status !== "pending") {
    throw new PublicError("الاستئناف غير موجود أو سبق البت فيه.", 409);
  }
  let task = await getConsensusTask(env.DB, appeal.task_version_id);
  if (!task || task.state !== "approved") {
    throw new PublicError(
      "لا يمكن البت في الاستئناف بعد مغادرة حالة الاعتماد المؤقت.",
      409
    );
  }
  const reviewed = await env.DB.prepare(
    `UPDATE appeals
        SET status = ?, reviewer_subject_hash = ?,
            review_reason = ?, reviewed_at = ?
      WHERE id = ? AND status = 'pending'`
  ).bind(
    decision,
    administrator.subject_hash,
    reason,
    Date.now(),
    appealId
  ).run();
  if (Number(reviewed.meta?.changes || 0) !== 1) {
    throw new PublicError("تغيرت حالة الاستئناف بالتزامن.", 409);
  }
  if (decision === "accepted") {
    await env.DB.prepare(
      `UPDATE final_results
          SET status = 'revoked', revoked_at = ?,
              revocation_reason = ?
        WHERE primary_receipt_id = ? AND status = 'active'`
    ).bind(Date.now(), reason, appeal.final_receipt_id).run();
    task = await transitionConsensusTask(env.DB, task, {
      toState: "escalated",
      roundId: appeal.round_id,
      eventType: "approved-result-appealed",
      reasonCode: "accepted-appeal",
      evidence: { appealId, finalReceiptId: appeal.final_receipt_id },
      actorSubjectHash: administrator.subject_hash,
      clearActiveFinal: true,
      idempotencyKey: `appeal-escalation:${appealId}`
    });
    await ensureTaskStateEvidence(env, task);
    task = await createReissuedRound(
      env.DB,
      task,
      "accepted-appeal",
      { subjectHash: administrator.subject_hash }
    );
    await ensureTaskStateEvidence(env, task);
    await queueGovernanceNotifications(
      env,
      task.id,
      "result-revoked",
      {
        taskVersionId: task.id,
        packetId: task.packet_id,
        reason: "accepted-appeal"
      },
      `result-revoked:${appealId}`
    );
    await queueGovernanceNotifications(
      env,
      task.id,
      "task-reissued",
      {
        taskVersionId: task.id,
        packetId: task.packet_id,
        reason: "accepted-appeal"
      },
      `task-reissued:${appealId}`
    );
  }
  await queueGovernanceNotifications(
    env,
    task.id,
    "appeal-decided",
    {
      taskVersionId: task.id,
      packetId: task.packet_id,
      reason: decision
    },
    `appeal-decided:${appealId}`
  );
  await recordAdminAudit(
    env.DB,
    administrator.subject_hash,
    "review-consensus-appeal",
    true,
    `${appealId}:${decision}`
  );
  return json({
    reviewed: true,
    appealId,
    decision,
    state: task.state,
    round: Number(task.current_round)
  });
}

async function moderateDiscussionComment(request, env, body) {
  const administrator = await findAdminSession(request, env, true);
  const commentId = requiredId(body?.commentId, "معرف التعليق");
  const state = body?.state;
  if (!["hidden", "redacted", "blocked"].includes(state)) {
    throw new PublicError("حالة الإشراف غير صالحة.", 400);
  }
  const reason = normalizedText(
    body?.reason,
    10,
    1000,
    "سبب الإشراف"
  );
  const comment = await env.DB.prepare(
    `SELECT body FROM discussion_comments WHERE comment_id = ?`
  ).bind(commentId).first();
  if (!comment) throw new PublicError("التعليق غير موجود.", 404);
  await env.DB.prepare(
    `INSERT INTO discussion_moderation
      (id, comment_id, state, reason, original_body_hash,
       actor_subject_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(),
    commentId,
    state,
    reason,
    await sha256Hex(comment.body),
    administrator.subject_hash,
    Date.now()
  ).run();
  await recordAdminAudit(
    env.DB,
    administrator.subject_hash,
    "moderate-discussion-comment",
    true,
    `${commentId}:${state}`
  );
  return json({ moderated: true, commentId, state });
}

async function takeAdminState(state, env) {
  const stateHash = await sha256Hex(state);
  const row = await env.DB.prepare(
    `SELECT ciphertext, expires_at
       FROM admin_oidc_states
      WHERE state_hash = ?`
  ).bind(stateHash).first();
  if (!row) {
    throw new PublicError("حالة دخول Entra غير صالحة.", 400);
  }
  const deletion = await env.DB.prepare(
    "DELETE FROM admin_oidc_states WHERE state_hash = ?"
  ).bind(stateHash).run();
  if (Number(deletion.meta?.changes || 0) !== 1
      || Number(row.expires_at) <= Date.now()) {
    throw new PublicError("انتهت محاولة دخول Entra.", 400);
  }
  return row;
}

async function exchangeAdminCode(code, verifier, env) {
  if (typeof verifier !== "string" || verifier.length < 43) {
    throw new Error("OIDC PKCE verifier is invalid.");
  }
  const metadata = await getEntraMetadata(env);
  const clientSecret = await getVaultSecret(
    env.ENTRA_CLIENT_SECRET_NAME,
    env
  );
  const response = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: env.ENTRA_CLIENT_ID,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: adminCallbackUri(env),
      code_verifier: verifier,
      scope: "openid profile email User.Read"
    })
  });
  if (!response.ok) {
    throw new Error(`Entra token endpoint returned ${response.status}.`);
  }
  const result = await response.json();
  if (typeof result.id_token !== "string"
      || typeof result.access_token !== "string") {
    throw new Error("Entra did not issue the required tokens.");
  }
  return result;
}

async function getEntraMetadata(env) {
  if (entraMetadataCache?.expiresAt > Date.now()) {
    return entraMetadataCache.value;
  }
  const issuer =
    `https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/v2.0`;
  const response = await fetch(
    `${issuer}/.well-known/openid-configuration`,
    { headers: { accept: "application/json" } }
  );
  if (!response.ok) {
    throw new Error(`Entra metadata returned ${response.status}.`);
  }
  const metadata = await response.json();
  if (metadata.issuer !== issuer
      || typeof metadata.authorization_endpoint !== "string"
      || typeof metadata.token_endpoint !== "string"
      || typeof metadata.jwks_uri !== "string") {
    throw new Error("Entra metadata did not match the configured tenant.");
  }
  entraMetadataCache = {
    value: metadata,
    expiresAt: Date.now() + 6 * 60 * 60 * 1000
  };
  return metadata;
}

async function getEntraJwks(env, force = false) {
  if (!force && entraJwksCache?.expiresAt > Date.now()) {
    return entraJwksCache.value;
  }
  const metadata = await getEntraMetadata(env);
  const response = await fetch(metadata.jwks_uri, {
    headers: { accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`Entra JWKS returned ${response.status}.`);
  }
  const value = await response.json();
  if (!Array.isArray(value.keys)) {
    throw new Error("Entra JWKS response is invalid.");
  }
  entraJwksCache = {
    value,
    expiresAt: Date.now() + 6 * 60 * 60 * 1000
  };
  return value;
}

async function verifyEntraIdToken(token, expectedNonce, env) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Entra ID token is malformed.");
  }
  const header = decodeJwtJson(parts[0]);
  const claims = decodeJwtJson(parts[1]);
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new Error("Entra ID token algorithm is not allowed.");
  }
  let jwks = await getEntraJwks(env);
  let jwk = jwks.keys.find(key => key.kid === header.kid);
  if (!jwk) {
    jwks = await getEntraJwks(env, true);
    jwk = jwks.keys.find(key => key.kid === header.kid);
  }
  if (!jwk || jwk.kty !== "RSA") {
    throw new Error("Entra signing key was not found.");
  }
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!verified) {
    throw new Error("Entra ID token signature is invalid.");
  }

  const now = Math.floor(Date.now() / 1000);
  const expectedIssuer =
    `https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/v2.0`;
  const audiences = Array.isArray(claims.aud)
    ? claims.aud
    : [claims.aud];
  if (claims.iss !== expectedIssuer
      || !audiences.includes(env.ENTRA_CLIENT_ID)
      || claims.tid !== env.ENTRA_TENANT_ID
      || claims.nonce !== expectedNonce
      || !Number.isFinite(claims.exp)
      || claims.exp <= now
      || (Number.isFinite(claims.nbf) && claims.nbf > now + 120)
      || !isGuid(claims.oid)) {
    throw new Error("Entra ID token claims are invalid.");
  }
  return claims;
}

async function getEntraMemberProfile(accessToken, claims, env) {
  const response = await fetch(
    "https://graph.microsoft.com/v1.0/me"
      + "?$select=id,displayName,mail,userPrincipalName,userType",
    {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json"
      }
    }
  );
  if (!response.ok) {
    throw new Error(`Microsoft Graph profile returned ${response.status}.`);
  }
  const profile = await response.json();
  if (!isGuid(profile.id)
      || profile.id.toLowerCase() !== claims.oid.toLowerCase()
      || String(profile.userType).toLowerCase() !== "member"
      || claims.tid.toLowerCase() !== env.ENTRA_TENANT_ID.toLowerCase()) {
    throw new Error("Entra organization membership was not proven.");
  }
  return {
    id: profile.id,
    displayName: profile.displayName || claims.name || "Administrator",
    email: profile.mail || profile.userPrincipalName
      || claims.preferred_username || null
  };
}

async function verifyGlobalAdministrator(claims, objectId, env) {
  if (signedRoleIds(claims.wids).includes(
    GLOBAL_ADMIN_ROLE_TEMPLATE_ID
  )) {
    return {
      isAdmin: true,
      authoritative: true,
      source: "signed-wids-claim"
    };
  }
  return evaluateGlobalAdministratorWithGraph(objectId, env);
}

async function evaluateGlobalAdministratorWithGraph(objectId, env) {
  if (!isGuid(objectId)) {
    return {
      isAdmin: false,
      authoritative: true,
      source: "invalid-object-id"
    };
  }
  const cached = adminRoleCache.get(objectId.toLowerCase());
  if (cached?.expiresAt > Date.now()) return cached.value;

  const token = await getGraphAppToken(env);
  const definitionFilter = encodeURIComponent(
    `templateId eq '${GLOBAL_ADMIN_ROLE_TEMPLATE_ID}'`
  );
  const definitions = await graphJson(
    "roleManagement/directory/roleDefinitions"
      + `?$filter=${definitionFilter}&$select=id,templateId`,
    token
  );
  const roleDefinitionId = definitions.value?.[0]?.id;
  if (!isGuid(roleDefinitionId)) {
    throw new Error(
      "Microsoft Graph did not return the Global Administrator role."
    );
  }
  const assignmentFilter = encodeURIComponent(
    `principalId eq '${objectId.toLowerCase()}'`
  );
  const assignments = await graphJson(
    "roleManagement/directory/roleAssignments"
      + `?$filter=${assignmentFilter}`
      + "&$select=principalId,roleDefinitionId",
    token
  );
  const value = {
    isAdmin: (assignments.value || []).some(
      item => typeof item.roleDefinitionId === "string"
        && item.roleDefinitionId.toLowerCase()
          === roleDefinitionId.toLowerCase()
    ),
    authoritative: true,
    source: "microsoft-graph-role-assignment"
  };
  adminRoleCache.set(objectId.toLowerCase(), {
    value,
    expiresAt: Date.now() + 2 * 60 * 1000
  });
  return value;
}

async function getGraphAppToken(env) {
  const clientSecret = await getVaultSecret(
    env.ENTRA_CLIENT_SECRET_NAME,
    env
  );
  return getMicrosoftGraphClientToken({
    tenantId: env.ENTRA_TENANT_ID,
    clientId: env.ENTRA_CLIENT_ID,
    clientSecret,
    scope: GRAPH_APP_SCOPE,
    cacheKey: `entra-admin:${String(env.ENTRA_TENANT_ID || "")}:`
      + String(env.ENTRA_CLIENT_ID || ""),
    label: "Microsoft Graph app token",
    validateAccessToken(accessToken) {
      const claims = decodeJwtJson(accessToken.split(".")[1] || "");
      if (!signedRoleIds(claims.roles).includes(
        "RoleManagement.Read.Directory"
      )) {
        throw new Error(
          "Microsoft Graph RoleManagement.Read.Directory is missing."
        );
      }
      return accessToken;
    }
  });
}

async function graphJson(path, accessToken) {
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/${path}`,
    {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json"
      }
    }
  );
  if (!response.ok) {
    throw new Error(`Microsoft Graph returned ${response.status}.`);
  }
  return response.json();
}

async function findAdminSession(request, env, revalidate) {
  const token = cookieValue(request, ADMIN_COOKIE_NAME);
  if (!token) {
    if (revalidate) {
      throw new PublicError("يلزم دخول مسؤول Entra.", 401);
    }
    return null;
  }
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT token_hash, subject_hash, identity_ciphertext, expires_at
       FROM admin_sessions
      WHERE token_hash = ?`
  ).bind(tokenHash).first();
  if (!row || Number(row.expires_at) <= Date.now()) {
    if (row) {
      await env.DB.prepare(
        "DELETE FROM admin_sessions WHERE token_hash = ?"
      ).bind(tokenHash).run();
    }
    if (revalidate) {
      throw new PublicError("انتهت جلسة المسؤول.", 401);
    }
    return null;
  }
  const masterKey = await getVaultSecret(
    env.ENTITYCRYPT_MASTER_KEY_SECRET_NAME,
    env
  );
  const identity = JSON.parse(await decryptEntityCrypt(
    row.identity_ciphertext,
    masterKey
  ));
  if (revalidate) {
    const authority = await evaluateGlobalAdministratorWithGraph(
      identity.objectId,
      env
    );
    if (!authority.isAdmin || !authority.authoritative) {
      await env.DB.prepare(
        "DELETE FROM admin_sessions WHERE token_hash = ?"
      ).bind(tokenHash).run();
      throw new PublicError("صلاحية المسؤول غير متاحة.", 403);
    }
    identity.authoritySource = authority.source;
  }
  return { ...row, identity };
}

async function createAdminSessionRecord(now) {
  const token = randomBase64Url(32);
  return {
    token,
    tokenHash: await sha256Hex(token),
    expiresAt: now + ADMIN_SESSION_TTL_MS
  };
}

async function pruneAdminRecords(db, now) {
  await db.batch([
    db.prepare(
      "DELETE FROM admin_oidc_states WHERE expires_at <= ?"
    ).bind(now),
    db.prepare(
      "DELETE FROM admin_sessions WHERE expires_at <= ?"
    ).bind(now)
  ]);
}

async function recordAdminAudit(
  db,
  subjectHash,
  eventType,
  success,
  detail
) {
  await db.prepare(
    `INSERT INTO admin_audit
      (id, subject_hash, event_type, success, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(),
    subjectHash,
    eventType,
    success ? 1 : 0,
    detail,
    Date.now()
  ).run();
}

function adminPageRedirect(env, error = null, cookie = null) {
  const target = new URL("/admin/", env.ALLOWED_ORIGIN);
  if (error) target.searchParams.set("error", error);
  const headers = new Headers({
    location: target.toString(),
    "cache-control": "no-store"
  });
  if (cookie) headers.set("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

export function adminCallbackUri(env) {
  return new URL(
    "/signin-microsoft",
    env.ALLOWED_ORIGIN
  ).toString();
}

function adminSessionCookie(env, token) {
  const secure = cookieSecureAttribute(env);
  return `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}; `
    + `Max-Age=${Math.floor(ADMIN_SESSION_TTL_MS / 1000)}; Path=/; `
    + `HttpOnly; SameSite=Lax${secure}`;
}

function clearAdminSessionCookie(env) {
  const secure = cookieSecureAttribute(env);
  return `${ADMIN_COOKIE_NAME}=; Max-Age=0; Path=/; `
    + `HttpOnly; SameSite=Lax${secure}`;
}

function randomBase64Url(length) {
  return base64UrlFromBytes(
    crypto.getRandomValues(new Uint8Array(length))
  );
}

function normalizedOidcValue(value, maximum, label) {
  if (typeof value !== "string"
      || value.length < 16
      || value.length > maximum) {
    throw new PublicError(`${label} غير صالح.`, 400);
  }
  return value;
}

function decodeJwtJson(segment) {
  if (!segment) throw new Error("JWT segment is missing.");
  try {
    return JSON.parse(new TextDecoder().decode(
      base64UrlToBytes(segment)
    ));
  } catch {
    throw new Error("JWT payload is invalid.");
  }
}

function signedRoleIds(value) {
  if (Array.isArray(value)) {
    return value.filter(item => typeof item === "string");
  }
  if (typeof value === "string") {
    if (value.startsWith("[")) {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed)
          ? parsed.filter(item => typeof item === "string")
          : [];
      } catch {
        return [];
      }
    }
    return value.split(/\s+/u).filter(Boolean);
  }
  return [];
}

function isGuid(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      .test(value);
}

async function adminSubjectHash(objectId, env) {
  return sha256Hex(
    `${env.ENTRA_TENANT_ID.toLowerCase()}:${objectId.toLowerCase()}`
  );
}

function adminTaskKey(userId, packetId, role) {
  return `${userId}\u0000${packetId}\u0000${role}`;
}

function enforceExactOrigin(request, env) {
  const origin = request.headers.get("origin");
  if (origin !== env.ALLOWED_ORIGIN) {
    throw new PublicError("مصدر الطلب غير مسموح.", 403);
  }
}

async function routeAccountRequest(request, env, url) {
  const path = url.pathname;
  if (!path.startsWith("/api/account")
      && path !== "/api/draft"
      && path !== "/api/drafts"
      && path !== "/api/results"
      && path !== "/api/discussion/comments"
      && path !== "/api/tasks"
      && path !== "/api/tasks/claim"
      && path !== "/api/tasks/load"
      && path !== "/api/tasks/status"
      && path !== "/api/issue-reports"
      && path !== "/api/consensus/appeals") {
    return null;
  }
  if (!env.DB) {
    throw new PublicError("خدمة الحساب غير مهيأة بعد.", 503);
  }

  if (path === "/api/account/register/options"
      && request.method === "POST") {
    enforceOrigin(request, env);
    return beginRegistration(await readJsonBody(request), env);
  }
  if (path === "/api/account/email/send-code"
      && request.method === "POST") {
    enforceOrigin(request, env);
    return sendEmailVerificationCode(
      request,
      env,
      await readJsonBody(request)
    );
  }
  if (path === "/api/account/email/verify-code"
      && request.method === "POST") {
    enforceOrigin(request, env);
    return verifyEmailVerificationCode(
      env,
      await readJsonBody(request)
    );
  }
  if (path === "/api/account/register/verify"
      && request.method === "POST") {
    enforceOrigin(request, env);
    return finishRegistration(await readJsonBody(request), env);
  }
  if (path === "/api/account/passkeys/register/options"
      && request.method === "POST") {
    enforceOrigin(request, env);
    return beginAdditionalPasskeyRegistration(request, env);
  }
  if (path === "/api/account/passkeys/register/verify"
      && request.method === "POST") {
    enforceOrigin(request, env);
    return finishAdditionalPasskeyRegistration(
      request,
      await readJsonBody(request),
      env
    );
  }
  if (path === "/api/account/login/options"
      && request.method === "POST") {
    enforceOrigin(request, env);
    return beginAuthentication(env);
  }
  if (path === "/api/account/login/verify"
      && request.method === "POST") {
    enforceOrigin(request, env);
    return finishAuthentication(await readJsonBody(request), env);
  }
  if (path === "/api/account" && request.method === "GET") {
    return getAccount(request, env);
  }
  if (path === "/api/account/preferences"
      && request.method === "PUT") {
    enforceOrigin(request, env);
    return updateAccountPreferences(
      request,
      env,
      await readJsonBody(request)
    );
  }
  if (path === "/api/account/logout"
      && request.method === "POST") {
    enforceOrigin(request, env);
    return logout(request, env);
  }
  if (path === "/api/account/privacy/erasure"
      && request.method === "POST") {
    enforceExactOrigin(request, env);
    return requestIdentityErasure(
      request,
      env,
      await readJsonBody(request)
    );
  }
  if (path === "/api/draft") {
    if (request.method === "GET") {
      return loadDraft(request, env, url);
    }
    if (request.method === "PUT") {
      enforceOrigin(request, env);
      return saveDraft(
        request,
        env,
        await readJsonBody(request)
      );
    }
    if (request.method === "DELETE") {
      enforceOrigin(request, env);
      return deleteDraft(request, env, url);
    }
  }
  if (path === "/api/drafts" && request.method === "GET") {
    return listDrafts(request, env);
  }
  if (path === "/api/tasks" && request.method === "GET") {
    return listRepositoryTasks(request, env, url);
  }
  if (path === "/api/tasks/claim" && request.method === "POST") {
    enforceOrigin(request, env);
    return claimRepositoryTask(
      request,
      env,
      await readJsonBody(request)
    );
  }
  if (path === "/api/tasks/load" && request.method === "GET") {
    return loadRepositoryTask(request, env, url);
  }
  if (path === "/api/results" && request.method === "GET") {
    return getCompletedResults(request, env, url);
  }
  if (path === "/api/discussion/comments"
      && request.method === "POST") {
    enforceOrigin(request, env);
    return createDiscussionComment(
      request,
      env,
      await readJsonBody(request)
    );
  }
  if (path === "/api/tasks/status" && request.method === "GET") {
    return getTaskStatus(request, env, url);
  }
  if (path === "/api/issue-reports" && request.method === "GET") {
    return listPortalIssueReports(request, env);
  }
  if (path === "/api/issue-reports" && request.method === "POST") {
    enforceOrigin(request, env);
    return createPortalIssueReport(
      request,
      env,
      await readJsonBody(request)
    );
  }
  if (path === "/api/consensus/appeals"
      && request.method === "POST") {
    enforceOrigin(request, env);
    return createConsensusAppeal(
      request,
      env,
      await readJsonBody(request)
    );
  }

  return json({ message: "المسار المطلوب غير موجود." }, 404);
}

function emailVerificationAvailable(env) {
  return String(env.EMAIL_VERIFICATION_ENABLED).toLowerCase() === "true"
    && Boolean(
      env.DB
      && mailTransportAvailable(env)
      && secretCanBeResolved(env.EMAIL_VERIFICATION_HMAC_SECRET_NAME, env)
    );
}

function requireEmailVerificationConfiguration(env) {
  if (!emailVerificationAvailable(env)) {
    throw new PublicError(
      "خدمة توثيق البريد غير مهيأة حاليًا.",
      503
    );
  }
}

function verifiedEmail(value) {
  try {
    return normalizeVerificationEmail(value);
  } catch (error) {
    throw new PublicError(error.message, 400);
  }
}

function verifiedEmailCode(value) {
  try {
    return normalizeVerificationCode(value);
  } catch (error) {
    throw new PublicError(error.message, 400);
  }
}

async function emailVerificationKey(env) {
  requireEmailVerificationConfiguration(env);
  return emailIdentityKey(env);
}

async function emailIdentityKey(env) {
  if (!secretCanBeResolved(
    env.EMAIL_VERIFICATION_HMAC_SECRET_NAME,
    env
  )) {
    throw new PublicError(
      "مفتاح ربط البريد الموثق غير مهيأ حاليًا.",
      503
    );
  }
  return getVaultSecret(env.EMAIL_VERIFICATION_HMAC_SECRET_NAME, env);
}

async function verifiedEmailAddressHash(email, env) {
  const secret = await emailIdentityKey(env);
  return hmacSha256(secret, `email-v1:${email}`);
}

async function sendEmailVerificationCode(request, env, body) {
  const email = verifiedEmail(body?.email);
  const secret = await emailVerificationKey(env);
  const requester = request.headers.get("CF-Connecting-IP")
    || request.headers.get("user-agent")
    || "unknown";
  const [emailHash, requestFingerprint] = await Promise.all([
    hmacSha256(secret, `email-v1:${email}`),
    hmacSha256(secret, `request-v1:${requester.slice(0, 200)}`)
  ]);
  const now = Date.now();
  await pruneAuthRecords(env.DB, now);
  const hourAgo = now - 60 * 60 * 1000;
  const [addressRate, requesterRate] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS recent_count, MAX(created_at) AS last_created
         FROM email_verifications
        WHERE email_hash = ? AND created_at >= ?`
    ).bind(emailHash, hourAgo).first(),
    env.DB.prepare(
      `SELECT COUNT(*) AS recent_count
         FROM email_verifications
        WHERE request_fingerprint = ? AND created_at >= ?`
    ).bind(requestFingerprint, hourAgo).first()
  ]);
  if (Number(addressRate?.recent_count || 0)
        >= EMAIL_MAX_SENDS_PER_ADDRESS_HOUR
      || Number(requesterRate?.recent_count || 0)
        >= EMAIL_MAX_SENDS_PER_REQUESTER_HOUR) {
    throw new PublicError(
      "بلغت محاولات الإرسال الحد المؤقت. أعد المحاولة بعد ساعة.",
      429
    );
  }
  const lastCreated = Number(addressRate?.last_created || 0);
  if (lastCreated && now - lastCreated < EMAIL_RESEND_COOLDOWN_MS) {
    const remainingSeconds = Math.ceil(
      (EMAIL_RESEND_COOLDOWN_MS - (now - lastCreated)) / 1000
    );
    throw new PublicError(
      `انتظر ${remainingSeconds} ثانية قبل طلب رمز جديد.`,
      429
    );
  }

  const verificationId = crypto.randomUUID();
  const code = generateVerificationCode();
  const codeHash = await hmacSha256(
    secret,
    `code-v1:${verificationId}:${code}`
  );
  try {
    const inserted = await env.DB.prepare(
      `INSERT INTO email_verifications
        (id, email_hash, request_fingerprint, code_hash, attempts,
         expires_at, resend_after, created_at)
       SELECT ?, ?, ?, ?, 0, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1
            FROM email_verifications
           WHERE email_hash = ?
             AND created_at > ? - ?
        )
          AND (
            SELECT COUNT(*)
              FROM email_verifications
             WHERE email_hash = ?
               AND created_at >= ? - 3600000
          ) < ?
          AND (
            SELECT COUNT(*)
              FROM email_verifications
             WHERE request_fingerprint = ?
               AND created_at >= ? - 3600000
          ) < ?`
    ).bind(
      verificationId,
      emailHash,
      requestFingerprint,
      codeHash,
      now + EMAIL_CODE_TTL_MS,
      now + EMAIL_RESEND_COOLDOWN_MS,
      now,
      emailHash,
      now,
      EMAIL_RESEND_COOLDOWN_MS,
      emailHash,
      now,
      EMAIL_MAX_SENDS_PER_ADDRESS_HOUR,
      requestFingerprint,
      now,
      EMAIL_MAX_SENDS_PER_REQUESTER_HOUR
    ).run();
    if (Number(inserted.meta?.changes || 0) !== 1) {
      throw new Error("email verification send limit");
    }
  } catch {
    throw new PublicError(
      "طلب رمز آخر جارٍ أو بلغ حد الإرسال المؤقت. حاول لاحقًا.",
      429
    );
  }

  try {
    await sendNotificationEmail(
      env,
      email,
      verificationEmailContent(code),
      "email-verification",
      verificationId
    );
  } catch (error) {
    await env.DB.prepare(
      "DELETE FROM email_verifications WHERE id = ?"
    ).bind(verificationId).run();
    console.error("ADG email verification delivery failed", {
      name: error?.name,
      message: error?.message
    });
    throw new PublicError(
      "تعذر إرسال رمز التحقق الآن. حاول مرة أخرى بعد قليل.",
      503
    );
  }

  await env.DB.prepare(
    `UPDATE email_verifications
        SET consumed_at = ?
      WHERE email_hash = ?
        AND id <> ?
        AND consumed_at IS NULL`
  ).bind(now, emailHash, verificationId).run();

  return json({
    verificationId,
    expiresInSeconds: EMAIL_CODE_TTL_MS / 1000,
    resendAfterSeconds: EMAIL_RESEND_COOLDOWN_MS / 1000,
    message: "أرسلنا رمزًا من ستة أرقام إلى بريدك."
  });
}

async function verifyEmailVerificationCode(env, body) {
  requireEmailVerificationConfiguration(env);
  const verificationId = requiredId(
    body?.verificationId,
    "معرف توثيق البريد"
  );
  const code = verifiedEmailCode(body?.code);
  const row = await env.DB.prepare(
    `SELECT id, attempts, expires_at, verified_at, reserved_at, consumed_at
       FROM email_verifications
      WHERE id = ?`
  ).bind(verificationId).first();
  const now = Date.now();
  if (!row
      || Number(row.expires_at) <= now
      || Number(row.attempts) >= EMAIL_MAX_ATTEMPTS
      || row.verified_at
      || row.reserved_at
      || row.consumed_at) {
    throw new PublicError(
      "انتهى رمز التحقق أو استُخدم. اطلب رمزًا جديدًا.",
      400
    );
  }

  const secret = await emailVerificationKey(env);
  const codeHash = await hmacSha256(
    secret,
    `code-v1:${verificationId}:${code}`
  );
  const verificationToken = randomBase64Url(32);
  const tokenHash = await sha256Hex(verificationToken);
  const verified = await env.DB.prepare(
    `UPDATE email_verifications
        SET verified_at = ?, verification_token_hash = ?,
            token_expires_at = ?
      WHERE id = ?
        AND code_hash = ?
        AND attempts < ?
        AND expires_at > ?
        AND verified_at IS NULL
        AND reserved_at IS NULL
        AND consumed_at IS NULL`
  ).bind(
    now,
    tokenHash,
    now + EMAIL_TOKEN_TTL_MS,
    verificationId,
    codeHash,
    EMAIL_MAX_ATTEMPTS,
    now
  ).run();
  if (Number(verified.meta?.changes || 0) !== 1) {
    await env.DB.prepare(
      `UPDATE email_verifications
          SET attempts = attempts + 1,
              consumed_at = CASE
                WHEN attempts + 1 >= ? THEN ?
                ELSE consumed_at
              END
        WHERE id = ?
          AND attempts < ?
          AND verified_at IS NULL
          AND reserved_at IS NULL
          AND consumed_at IS NULL`
    ).bind(
      EMAIL_MAX_ATTEMPTS,
      now,
      verificationId,
      EMAIL_MAX_ATTEMPTS
    ).run();
    throw new PublicError(
      "رمز التحقق غير صحيح. تحقق من الرسالة وحاول مرة أخرى.",
      400
    );
  }

  return json({
    verified: true,
    verificationToken,
    tokenExpiresInSeconds: EMAIL_TOKEN_TTL_MS / 1000,
    message: "تم توثيق البريد بنجاح."
  });
}

async function requireVerifiedEmail(emailValue, tokenValue, env) {
  const email = verifiedEmail(emailValue);
  if (typeof tokenValue !== "string"
      || tokenValue.length < 32
      || tokenValue.length > 200) {
    throw new PublicError(
      "وثّق البريد الإلكتروني بالرمز قبل المتابعة.",
      403
    );
  }
  const secret = await emailVerificationKey(env);
  const [emailHash, tokenHash] = await Promise.all([
    hmacSha256(secret, `email-v1:${email}`),
    sha256Hex(tokenValue)
  ]);
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT id
       FROM email_verifications
      WHERE email_hash = ?
        AND verification_token_hash = ?
        AND verified_at IS NOT NULL
        AND token_expires_at > ?
        AND reserved_at IS NULL
        AND consumed_at IS NULL`
  ).bind(emailHash, tokenHash, now).first();
  if (!row) {
    throw new PublicError(
      "انتهى توثيق البريد أو لا يطابق العنوان المدخل.",
      403
    );
  }
  return {
    id: row.id,
    emailHash,
    tokenHash
  };
}

async function beginRegistration(body, env) {
  const profile = validateAccountProfile(body?.profile);
  const consent = validateAccountConsent(body?.consent);
  const emailVerification = await requireVerifiedEmail(
    profile.email,
    body?.emailVerificationToken,
    env
  );
  const existingAccount = await env.DB.prepare(
    "SELECT id FROM users WHERE verified_email_hash = ?"
  ).bind(emailVerification.emailHash).first();
  const userId = existingAccount?.id || crypto.randomUUID();
  const { origin, rpId } = relyingParty(env);
  const secret = await getVaultSecret(
    env.ENTITYCRYPT_MASTER_KEY_SECRET_NAME,
    env
  );
  const profileCiphertext = await encryptEntityCrypt(
    JSON.stringify(profile),
    secret
  );
  const options = await registrationOptionsForAccount(
    env.DB,
    userId,
    profile,
    rpId
  );
  const challengeId = crypto.randomUUID();
  const now = Date.now();

  await pruneAuthRecords(env.DB, now);
  const reservation = await env.DB.batch([
    env.DB.prepare(
      `UPDATE email_verifications
          SET reserved_at = ?, reservation_id = ?
        WHERE id = ?
          AND email_hash = ?
          AND verification_token_hash = ?
          AND verified_at IS NOT NULL
          AND token_expires_at > ?
          AND reserved_at IS NULL
          AND consumed_at IS NULL`
    ).bind(
      now,
      challengeId,
      emailVerification.id,
      emailVerification.emailHash,
      emailVerification.tokenHash,
      now
    ),
    env.DB.prepare(
      `INSERT INTO webauthn_challenges
        (id, challenge, kind, user_id, profile_ciphertext,
         consent_json, email_verification_id, verified_email_hash,
         expires_at)
       VALUES (?, ?, 'registration', ?, ?, ?, ?, ?, ?)`
    ).bind(
      challengeId,
      options.challenge,
      userId,
      profileCiphertext,
      JSON.stringify(consent),
      emailVerification.id,
      emailVerification.emailHash,
      now + CHALLENGE_TTL_MS
    )
  ]);
  if (Number(reservation[0]?.meta?.changes || 0) !== 1) {
    await env.DB.prepare(
      "DELETE FROM webauthn_challenges WHERE id = ?"
    ).bind(challengeId).run();
    throw new PublicError(
      "انتهى توثيق البريد أو استُخدم. أرسل رمزًا جديدًا.",
      409
    );
  }

  return json({
    challengeId,
    options,
    origin,
    accountMode: existingAccount ? "existing" : "new"
  });
}

async function finishRegistration(body, env) {
  const challengeId = requiredId(body?.challengeId, "معرف التسجيل");
  if (!body?.response || typeof body.response !== "object") {
    throw new PublicError("استجابة مفتاح المرور غير صالحة.", 400);
  }
  const challenge = await takeChallenge(
    env.DB,
    challengeId,
    "registration"
  );
  const emailReservation = challenge.email_verification_id
    ? await env.DB.prepare(
      `SELECT id
         FROM email_verifications
        WHERE id = ?
          AND email_hash = ?
          AND reservation_id = ?
          AND verified_at IS NOT NULL
          AND consumed_at IS NULL`
    ).bind(
      challenge.email_verification_id,
      challenge.verified_email_hash,
      challenge.id
    ).first()
    : null;
  if (!emailReservation) {
    throw new PublicError(
      "انتهى توثيق البريد. أرسل رمزًا جديدًا ثم أعد التسجيل.",
      400
    );
  }
  const credential = await verifyRegistrationCredential(
    body.response,
    challenge,
    env
  );
  const now = Date.now();
  const session = await createSessionRecord(challenge.user_id, now);
  const existingAccount = await env.DB.prepare(
    "SELECT id FROM users WHERE verified_email_hash = ?"
  ).bind(challenge.verified_email_hash).first();
  if (existingAccount && existingAccount.id !== challenge.user_id) {
    throw new PublicError(
      "تغيّرت حالة حساب البريد أثناء التسجيل. أعد طلب رمز البريد.",
      409
    );
  }
  const statements = [];
  if (existingAccount) {
    statements.push(
      env.DB.prepare(
        `UPDATE users
            SET profile_ciphertext = ?, consent_json = ?, updated_at = ?
          WHERE id = ? AND verified_email_hash = ?`
      ).bind(
        challenge.profile_ciphertext,
        challenge.consent_json,
        now,
        challenge.user_id,
        challenge.verified_email_hash
      )
    );
  } else {
    statements.push(
      env.DB.prepare(
        `INSERT INTO users
          (id, profile_ciphertext, consent_json, verified_email_hash,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        challenge.user_id,
        challenge.profile_ciphertext,
        challenge.consent_json,
        challenge.verified_email_hash,
        now,
        now
      )
    );
  }
  statements.push(
    passkeyInsertStatement(
      env.DB,
      credential,
      challenge.user_id,
      now
    ),
    env.DB.prepare(
      `INSERT INTO sessions
        (token_hash, user_id, expires_at, created_at)
       VALUES (?, ?, ?, ?)`
    ).bind(
      session.tokenHash,
      challenge.user_id,
      session.expiresAt,
      now
    ),
    env.DB.prepare(
      `DELETE FROM email_verifications
        WHERE id = ?
          AND reservation_id = ?
          AND consumed_at IS NULL`
    ).bind(
      challenge.email_verification_id,
      challenge.id
    )
  );
  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new PublicError(
        "مفتاح المرور مرتبط بحساب قائم، أو تغيّرت ملكية البريد.",
        409
      );
    }
    throw error;
  }

  return json(
    {
      authenticated: true,
      userId: challenge.user_id,
      passkeyCount: await accountPasskeyCount(
        env.DB,
        challenge.user_id
      ),
      message: existingAccount
        ? "تمت استعادة حساب البريد وإضافة مفتاح المرور الجديد."
        : "تم إنشاء الحساب وحفظ مفتاح المرور."
    },
    201,
    { "set-cookie": sessionCookie(env, session.token) }
  );
}

async function beginAdditionalPasskeyRegistration(request, env) {
  const account = await requireSession(request, env);
  const secret = await getVaultSecret(
    env.ENTITYCRYPT_MASTER_KEY_SECRET_NAME,
    env
  );
  const profile = JSON.parse(await decryptEntityCrypt(
    account.profile_ciphertext,
    secret
  ));
  const { origin, rpId } = relyingParty(env);
  const options = await registrationOptionsForAccount(
    env.DB,
    account.user_id,
    profile,
    rpId
  );
  const challengeId = crypto.randomUUID();
  const now = Date.now();
  await pruneAuthRecords(env.DB, now);
  await env.DB.prepare(
    `INSERT INTO webauthn_challenges
      (id, challenge, kind, user_id, expires_at)
     VALUES (?, ?, 'registration', ?, ?)`
  ).bind(
    challengeId,
    options.challenge,
    account.user_id,
    now + CHALLENGE_TTL_MS
  ).run();
  return json({ challengeId, options, origin });
}

async function finishAdditionalPasskeyRegistration(request, body, env) {
  const account = await requireSession(request, env);
  const challengeId = requiredId(body?.challengeId, "معرف التسجيل");
  if (!body?.response || typeof body.response !== "object") {
    throw new PublicError("استجابة مفتاح المرور غير صالحة.", 400);
  }
  const challenge = await takeChallenge(
    env.DB,
    challengeId,
    "registration"
  );
  if (challenge.user_id !== account.user_id
      || challenge.email_verification_id
      || challenge.verified_email_hash) {
    throw new PublicError(
      "محاولة إضافة مفتاح المرور غير مرتبطة بالحساب.",
      403
    );
  }
  const credential = await verifyRegistrationCredential(
    body.response,
    challenge,
    env
  );
  const now = Date.now();
  try {
    await passkeyInsertStatement(
      env.DB,
      credential,
      account.user_id,
      now
    ).run();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new PublicError("مفتاح المرور مسجل سابقًا.", 409);
    }
    throw error;
  }
  return json({
    authenticated: true,
    passkeyCount: await accountPasskeyCount(
      env.DB,
      account.user_id
    ),
    message: "تمت إضافة مفتاح المرور إلى حساب البريد."
  });
}

async function registrationOptionsForAccount(db, userId, profile, rpId) {
  const passkeys = await db.prepare(
    `SELECT credential_id, transports_json
       FROM passkeys
      WHERE user_id = ?
      ORDER BY created_at ASC, credential_id ASC`
  ).bind(userId).all();
  return generateRegistrationOptions({
    rpName: "منصة تحكيم ADG للغة العربية",
    rpID: rpId,
    userID: new TextEncoder().encode(userId),
    userName: profile.email,
    userDisplayName: profile.email,
    timeout: 120000,
    attestationType: "none",
    excludeCredentials: (passkeys.results || []).map(passkey => ({
      id: passkey.credential_id,
      transports: JSON.parse(passkey.transports_json)
    })),
    authenticatorSelection: {
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "required"
    }
  });
}

async function verifyRegistrationCredential(response, challenge, env) {
  const { origin, rpId } = relyingParty(env);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      requireUserVerification: true
    });
  } catch {
    throw new PublicError(
      "تعذر التحقق من مفتاح المرور. أعد بدء التسجيل.",
      400
    );
  }
  if (!verification.verified || !verification.registrationInfo) {
    throw new PublicError("لم ينجح التحقق من مفتاح المرور.", 400);
  }
  const info = verification.registrationInfo;
  if (!info.credential?.id
      || !info.credential.publicKey
      || !info.credentialDeviceType
      || typeof info.credentialBackedUp !== "boolean") {
    throw new PublicError("بيانات مفتاح المرور ناقصة.", 400);
  }
  return {
    ...info.credential,
    deviceType: info.credentialDeviceType,
    backedUp: Boolean(info.credentialBackedUp)
  };
}

function passkeyInsertStatement(db, credential, userId, now) {
  return db.prepare(
    `INSERT INTO passkeys
      (credential_id, user_id, public_key, counter,
       transports_json, device_type, backed_up, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    credential.id,
    userId,
    base64UrlFromBytes(credential.publicKey),
    credential.counter,
    JSON.stringify(credential.transports || []),
    credential.deviceType,
    credential.backedUp ? 1 : 0,
    now
  );
}

async function accountPasskeyCount(db, userId) {
  const row = await db.prepare(
    "SELECT COUNT(*) AS passkey_count FROM passkeys WHERE user_id = ?"
  ).bind(userId).first();
  return Number(row?.passkey_count || 0);
}

function isUniqueConstraintError(error) {
  const message = [
    error?.message,
    error?.cause?.message
  ].filter(Boolean).join(" ").toLowerCase();
  return message.includes("unique constraint")
    || message.includes("duplicate key")
    || message.includes("constraint failed");
}

async function beginAuthentication(env) {
  const { rpId } = relyingParty(env);
  const options = await generateAuthenticationOptions({
    rpID: rpId,
    timeout: 120000,
    userVerification: "required"
  });
  const challengeId = crypto.randomUUID();
  const now = Date.now();
  await pruneAuthRecords(env.DB, now);
  await env.DB.prepare(
    `INSERT INTO webauthn_challenges
      (id, challenge, kind, expires_at)
     VALUES (?, ?, 'authentication', ?)`
  ).bind(
    challengeId,
    options.challenge,
    now + CHALLENGE_TTL_MS
  ).run();
  return json({ challengeId, options });
}

async function finishAuthentication(body, env) {
  const challengeId = requiredId(body?.challengeId, "معرف الدخول");
  const response = body?.response;
  if (!response || typeof response !== "object"
      || typeof response.id !== "string") {
    throw new PublicError("استجابة مفتاح المرور غير صالحة.", 400);
  }
  const passkey = await env.DB.prepare(
    `SELECT p.credential_id, p.user_id, p.public_key, p.counter,
            p.transports_json
       FROM passkeys p
      WHERE p.credential_id = ?`
  ).bind(response.id).first();
  if (!passkey) {
    throw new PublicError("لم يتم التعرف على مفتاح المرور.", 401);
  }
  const challenge = await takeChallenge(
    env.DB,
    challengeId,
    "authentication"
  );
  const expectedUserHandle = base64UrlFromBytes(
    new TextEncoder().encode(passkey.user_id)
  );
  if (response.response?.userHandle
      && response.response.userHandle !== expectedUserHandle) {
    throw new PublicError("لا يطابق مفتاح المرور هذا الحساب.", 401);
  }

  const { origin, rpId } = relyingParty(env);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      credential: {
        id: passkey.credential_id,
        publicKey: base64UrlToBytes(passkey.public_key),
        counter: Number(passkey.counter),
        transports: JSON.parse(passkey.transports_json)
      },
      requireUserVerification: true
    });
  } catch {
    throw new PublicError(
      "تعذر التحقق من مفتاح المرور. أعد محاولة الدخول.",
      401
    );
  }
  if (!verification.verified) {
    throw new PublicError("لم ينجح التحقق من مفتاح المرور.", 401);
  }

  const now = Date.now();
  const session = await createSessionRecord(passkey.user_id, now);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE passkeys
          SET counter = ?, last_used_at = ?
        WHERE credential_id = ?`
    ).bind(
      verification.authenticationInfo.newCounter,
      now,
      passkey.credential_id
    ),
    env.DB.prepare(
      `INSERT INTO sessions
        (token_hash, user_id, expires_at, created_at)
       VALUES (?, ?, ?, ?)`
    ).bind(
      session.tokenHash,
      passkey.user_id,
      session.expiresAt,
      now
    )
  ]);

  return json(
    {
      authenticated: true,
      userId: passkey.user_id,
      message: "تم الدخول بمفتاح المرور."
    },
    200,
    { "set-cookie": sessionCookie(env, session.token) }
  );
}

async function getAccount(request, env) {
  const account = await requireSession(request, env);
  const secret = await getVaultSecret(
    env.ENTITYCRYPT_MASTER_KEY_SECRET_NAME,
    env
  );
  const profileText = await decryptEntityCrypt(
    account.profile_ciphertext,
    secret
  );
  const erasure = await env.DB.prepare(
    `SELECT id, eligible_after
       FROM identity_erasure_requests
      WHERE user_id = ? AND status = 'pending'`
  ).bind(account.user_id).first();
  const d1Backup = evidenceArchiveMode(env) === "d1"
    ? d1TimeTravelRetentionSummary(env)
    : null;
  return json({
    authenticated: true,
    userId: account.user_id,
    profile: JSON.parse(profileText),
    consent: JSON.parse(account.consent_json),
    emailVerified: Boolean(account.verified_email_hash),
    passkeyCount: await accountPasskeyCount(env.DB, account.user_id),
    identityErasure: erasure
      ? {
        requested: true,
        requestId: erasure.id,
        eligibleAfterUtc: new Date(erasure.eligible_after).toISOString(),
        deletionScope: d1Backup
          ? "active-store-after-retention"
          : "archive-after-retention",
        providerBackupRetentionDays: d1Backup?.retentionDays ?? null,
        providerBackupBoundaryNote: d1Backup
          ? "قد تبقى لقطات Cloudflare D1 Time Travel القابلة للاسترجاع "
            + "حتى انتهاء نافذة الخطة بعد حذف المخزن النشط."
          : null
      }
      : { requested: false }
  });
}

async function updateAccountPreferences(request, env, body) {
  const account = await requireSession(request, env);
  if (account.erasure_status === "pending") {
    throw new PublicError(
      "لا يمكن تغيير بيانات الهوية بعد تسجيل طلب محوها.",
      409
    );
  }
  const profile = validateAccountProfile(body?.profile);
  const consent = validateAccountConsent(body?.consent);
  const secret = await getVaultSecret(
    env.ENTITYCRYPT_MASTER_KEY_SECRET_NAME,
    env
  );
  const currentProfile = JSON.parse(await decryptEntityCrypt(
    account.profile_ciphertext,
    secret
  ));
  const profileCiphertext = await encryptEntityCrypt(
    JSON.stringify(profile),
    secret
  );
  const requiresEmailVerification =
    !account.verified_email_hash
    || currentProfile.email !== profile.email;
  const now = Date.now();
  if (requiresEmailVerification) {
    const verification = await requireVerifiedEmail(
      profile.email,
      body?.emailVerificationToken,
      env
    );
    let changes;
    try {
      changes = await env.DB.batch([
        env.DB.prepare(
          `UPDATE users
              SET profile_ciphertext = ?, consent_json = ?,
                  verified_email_hash = ?, updated_at = ?
            WHERE id = ?
              AND EXISTS (
                SELECT 1
                  FROM email_verifications
                 WHERE id = ?
                   AND email_hash = ?
                   AND verification_token_hash = ?
                   AND verified_at IS NOT NULL
                   AND token_expires_at > ?
                   AND reserved_at IS NULL
                   AND consumed_at IS NULL
              )`
        ).bind(
          profileCiphertext,
          JSON.stringify(consent),
          verification.emailHash,
          now,
          account.user_id,
          verification.id,
          verification.emailHash,
          verification.tokenHash,
          now
        ),
        env.DB.prepare(
          `DELETE FROM email_verifications
            WHERE id = ?
              AND verification_token_hash = ?
              AND consumed_at IS NULL`
        ).bind(
          verification.id,
          verification.tokenHash
        )
      ]);
    } catch {
      throw new PublicError(
        "هذا البريد مرتبط بحساب آخر أو تعذر حفظ التغيير.",
        409
      );
    }
    if (Number(changes[0]?.meta?.changes || 0) !== 1
        || Number(changes[1]?.meta?.changes || 0) !== 1) {
      throw new PublicError(
        "انتهى توثيق البريد أو استُخدم. أرسل رمزًا جديدًا.",
        409
      );
    }
  } else {
    await env.DB.prepare(
      `UPDATE users
          SET profile_ciphertext = ?, consent_json = ?, updated_at = ?
        WHERE id = ?`
    ).bind(
      profileCiphertext,
      JSON.stringify(consent),
      now,
      account.user_id
    ).run();
  }
  return json({
    saved: true,
    consent,
    emailVerified: true,
    message: "حُفظت بيانات الحساب وتفضيلات الإشعارات."
  });
}

async function getCompletedResults(request, env, url) {
  const account = await requireSession(request, env);
  const receiptId = String(url.searchParams.get("receiptId") || "");
  if (!isUuid(receiptId)) {
    throw new PublicError("معرف الإرسال المطلوب غير صالح.", 400);
  }
  const source = await env.DB.prepare(
    `SELECT receipt_id, user_id, packet_id, role, artifact_sha256,
            participant_pseudonym, artifact_type, artifact_json,
            repository_status, submitted_at, task_version_id, round_id,
            (SELECT status FROM final_results
              WHERE primary_receipt_id = submissions.receipt_id)
              AS final_status
       FROM submissions
      WHERE receipt_id = ? AND user_id = ?`
  ).bind(receiptId, account.user_id).first();
  if (!source || !source.artifact_json) {
    throw new PublicError(
      "لا يمكن فتح النتائج قبل إتمام المهمة المرتبطة بهذا الحساب.",
      404
    );
  }

  if (source.role === "operational-test") {
    const result = publicResultRow(source, true);
    return json({
      source: publicResultRow(source, false),
      revealedAtUtc: new Date().toISOString(),
      results: [result],
      comments: [],
      operationalTest: true,
      repository:
        env.GITHUB_REPOSITORY || "sbay-dev/ADG-Lang",
      publicationBoundary:
        "هذه تجربة تشغيلية مجهّلة لا تدخل آلة الإجماع ولا تثبت الجاهزية."
    });
  }

  const now = Date.now();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO result_access
      (user_id, packet_id, source_receipt_id, first_viewed_at,
       task_version_id, round_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    account.user_id,
    source.packet_id,
    receiptId,
    now,
    source.task_version_id,
    source.round_id
  ).run();

  const [resultsQuery, commentsQuery] = await Promise.all([
    env.DB.prepare(
      `SELECT s.receipt_id, s.packet_id, s.role, s.artifact_sha256,
              s.participant_pseudonym, s.artifact_type, s.artifact_json,
              s.repository_status, s.submitted_at,
              f.status AS final_status
         FROM submissions s
         LEFT JOIN final_results f
           ON f.primary_receipt_id = s.receipt_id
        WHERE s.task_version_id = ?
          AND s.round_id = ?
          AND s.receipt_id <> ?
          AND s.artifact_json IS NOT NULL
        ORDER BY s.submitted_at ASC
        LIMIT 40`
    ).bind(source.task_version_id, source.round_id, receiptId).all(),
    env.DB.prepare(
      `SELECT dc.comment_id, dc.participant_pseudonym,
              dc.source_receipt_id, dc.target_receipt_id,
              dc.parent_comment_id, dc.category, dc.body,
              dc.sentence_id, dc.token_id, dc.mentions_json,
              dc.references_json, dc.github_status, dc.created_at,
              dm.state AS moderation_state
         FROM discussion_comments dc
         LEFT JOIN discussion_moderation dm
           ON dm.id = (
             SELECT id
               FROM discussion_moderation
              WHERE comment_id = dc.comment_id
              ORDER BY created_at DESC
              LIMIT 1
           )
        WHERE dc.task_version_id = ?
          AND dc.round_id = ?
        ORDER BY dc.created_at ASC
        LIMIT 250`
    ).bind(source.task_version_id, source.round_id).all()
  ]);

  return json({
    source: publicResultRow(source, false),
    revealedAtUtc: new Date(now).toISOString(),
    results: (resultsQuery.results || [])
      .map(row => publicResultRow(row, true)),
    comments: (commentsQuery.results || [])
      .filter(row => !["hidden", "blocked"].includes(
        row.moderation_state
      ))
      .map(publicCommentRow),
    repository:
      env.GITHUB_REPOSITORY || "sbay-dev/ADG-Lang",
    publicationBoundary:
      "تظهر الأدلة المجهّلة فقط، وتبقى الهوية وبيانات التواصل خاصة."
  });
}

async function createPortalIssueReport(request, env, body) {
  const account = await requireSession(request, env);
  let input;
  try {
    input = validatePortalIssueReportInput(body);
  } catch (error) {
    throw new PublicError(error.message, 400);
  }

  const existing = await env.DB.prepare(
    `SELECT id, user_id, category, summary, payload_json, status,
            github_issue_number, github_issue_url, created_at, published_at
       FROM portal_issue_reports
      WHERE id = ?`
  ).bind(input.reportId).first();
  if (existing) {
    if (existing.user_id !== account.user_id
        || !portalIssueInputMatchesPayload(input, existing.payload_json)) {
      throw new PublicError("معرف البلاغ مستخدم لطلب مختلف.", 409);
    }
    return json({
      accepted: true,
      duplicate: true,
      report: portalIssueReportSummary(existing)
    });
  }

  const now = Date.now();
  const createdAtUtc = new Date(now).toISOString();
  const payloadJson = JSON.stringify(
    buildPortalIssuePublicPayload(input, createdAtUtc)
  );
  const contentSha256 = await sha256Hex(payloadJson);
  const insert = await env.DB.prepare(
    `INSERT INTO portal_issue_reports
      (id, user_id, category, summary, payload_json, content_sha256,
       status, attempts, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?
      WHERE (
        SELECT COUNT(*)
          FROM portal_issue_reports
         WHERE user_id = ? AND created_at >= ?
      ) < ?
        AND (
          SELECT COUNT(*)
            FROM portal_issue_reports
           WHERE user_id = ? AND created_at >= ?
        ) < ?`
  ).bind(
    input.reportId,
    account.user_id,
    input.category,
    input.summary,
    payloadJson,
    contentSha256,
    now,
    now,
    account.user_id,
    now - 60 * 60 * 1000,
    PORTAL_ISSUE_REPORT_RATE_HOUR,
    account.user_id,
    now - 24 * 60 * 60 * 1000,
    PORTAL_ISSUE_REPORT_RATE_DAY
  ).run();
  if (Number(insert.meta?.changes || 0) !== 1) {
    throw new PublicError(
      "بلغت الحد المؤقت للبلاغات. انتظر قبل إرسال بلاغ آخر.",
      429
    );
  }
  const stored = await env.DB.prepare(
    `SELECT id, category, summary, status, github_issue_number,
            github_issue_url, created_at, published_at
       FROM portal_issue_reports
      WHERE id = ? AND user_id = ?`
  ).bind(input.reportId, account.user_id).first();
  return json({
    accepted: true,
    duplicate: false,
    report: portalIssueReportSummary(stored)
  }, 202);
}

async function listPortalIssueReports(request, env) {
  const account = await requireSession(request, env);
  const result = await env.DB.prepare(
    `SELECT id, category, summary, status, github_issue_number,
            github_issue_url, created_at, published_at
       FROM portal_issue_reports
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 10`
  ).bind(account.user_id).all();
  return json({
    reports: (result.results || []).map(portalIssueReportSummary)
  });
}

function portalIssueInputMatchesPayload(input, payloadJson) {
  let payload;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return false;
  }
  return payload.reportId === input.reportId
    && payload.category === input.category
    && payload.summary === input.summary
    && payload.details === input.details
    && payload.reproductionSteps === input.reproductionSteps
    && JSON.stringify(payload.context) === JSON.stringify(input.context);
}

function portalIssueReportSummary(row) {
  return {
    reportId: row.id,
    category: row.category,
    summary: row.summary,
    status: row.status,
    issueNumber: row.github_issue_number === null
      || row.github_issue_number === undefined
      ? null
      : Number(row.github_issue_number),
    issueUrl: row.github_issue_url || null,
    createdAtUtc: new Date(Number(row.created_at)).toISOString(),
    publishedAtUtc: row.published_at
      ? new Date(Number(row.published_at)).toISOString()
      : null
  };
}

async function listRepositoryTasks(request, env, url) {
  const account = await requireSession(request, env);
  if (!account.verified_email_hash) {
    throw new PublicError("وثّق بريد الحساب لعرض المهام المسندة.", 403);
  }
  const operationalOnly =
    url.searchParams.get("mode") === "operational-test";
  const result = await env.DB.prepare(
    `SELECT rtp.task_version_id, rtp.packet_id, rtp.manifest_json,
            rtp.assignment_mode, rtp.lane, rtp.source_repository,
            rtp.source_path, rtp.source_commit_sha,
            rtp.first_synced_at, rtp.updated_at,
            tv.task_id, tv.task_version, tv.holdout_id, tv.state,
            tv.current_round, cr.id AS round_id,
            cr.deadline_at AS round_deadline_at
       FROM repository_task_packets rtp
       JOIN task_versions tv ON tv.id = rtp.task_version_id
       JOIN consensus_rounds cr
         ON cr.task_version_id = tv.id
        AND cr.round_number = tv.current_round
      WHERE rtp.status = 'active'
        AND rtp.lane IN ('standard', 'operational-test')
      ORDER BY CASE
                 WHEN rtp.lane = 'operational-test' THEN 0
                 ELSE 1
               END,
               rtp.first_synced_at DESC
      LIMIT 100`
  ).all();
  const rows = (result.results || []).filter(
    row => !operationalOnly || row.lane === "operational-test"
  );
  if (rows.length === 0) {
    return json({ tasks: [] });
  }
  const taskVersionIds = rows.map(row => row.task_version_id);
  const packetIds = rows.map(row => row.packet_id);
  const taskPlaceholders = taskVersionIds.map(() => "?").join(", ");
  const packetPlaceholders = packetIds.map(() => "?").join(", ");
  const [
    operationalClaimsResult,
    assignmentsResult,
    participationsResult,
    draftsResult
  ] = await Promise.all([
    env.DB.prepare(
      `SELECT otc.task_version_id, otc.role, otc.status,
              otc.claimed_at, otc.submitted_at
         FROM operational_task_claims otc
         JOIN repository_task_packets rtp
           ON rtp.task_version_id = otc.task_version_id
        WHERE otc.user_id = ? AND rtp.status = 'active'
          AND otc.task_version_id IN (${taskPlaceholders})`
    ).bind(account.user_id, ...taskVersionIds).all(),
    env.DB.prepare(
      `SELECT ta.task_version_id, ta.round_id, ta.id, ta.role, ta.status,
              ta.user_id, ta.email_hash, ta.invited_at, ta.claimed_at,
              ta.submitted_at
         FROM task_assignments ta
         JOIN task_versions tv ON tv.id = ta.task_version_id
         JOIN repository_task_packets rtp
           ON rtp.task_version_id = ta.task_version_id
         JOIN consensus_rounds cr
           ON cr.id = ta.round_id
          AND cr.round_number = tv.current_round
        WHERE rtp.status = 'active' AND ta.status <> 'cancelled'
          AND ta.task_version_id IN (${taskPlaceholders})`
    ).bind(...taskVersionIds).all(),
    env.DB.prepare(
      `SELECT tp.task_version_id, tp.round_id, tp.role,
              tp.status, tp.user_id
         FROM task_participations tp
         JOIN task_versions tv ON tv.id = tp.task_version_id
         JOIN repository_task_packets rtp
           ON rtp.task_version_id = tp.task_version_id
         JOIN consensus_rounds cr
           ON cr.id = tp.round_id
          AND cr.round_number = tv.current_round
        WHERE rtp.status = 'active'
          AND tp.task_version_id IN (${taskPlaceholders})`
    ).bind(...taskVersionIds).all(),
    env.DB.prepare(
      `SELECT d.packet_id, d.role, d.completion_percent, d.updated_at
         FROM drafts d
         JOIN repository_task_packets rtp ON rtp.packet_id = d.packet_id
        WHERE d.user_id = ? AND rtp.status = 'active'
          AND d.packet_id IN (${packetPlaceholders})`
    ).bind(account.user_id, ...packetIds).all()
  ]);
  const operationalClaims = new Map(
    (operationalClaimsResult.results || []).map(item => [
      item.task_version_id,
      item
    ])
  );
  const assignmentsByRound = new Map();
  for (const item of assignmentsResult.results || []) {
    const key = `${item.task_version_id}\u0000${item.round_id}`;
    const values = assignmentsByRound.get(key) || [];
    values.push(item);
    assignmentsByRound.set(key, values);
  }
  const participationsByRound = new Map();
  for (const item of participationsResult.results || []) {
    const key = `${item.task_version_id}\u0000${item.round_id}`;
    const values = participationsByRound.get(key) || [];
    values.push(item);
    participationsByRound.set(key, values);
  }
  const drafts = new Map(
    (draftsResult.results || []).map(item => [
      `${item.packet_id}\u0000${item.role}`,
      item
    ])
  );

  const tasks = [];
  for (const row of rows) {
    if (row.lane === "operational-test") {
      const claim = operationalClaims.get(row.task_version_id) || null;
      const manifest = parseRepositoryTaskManifest(row.manifest_json);
      const draft = drafts.get(`${row.packet_id}\u0000A`) || null;
      tasks.push({
        taskVersionId: row.task_version_id,
        taskId: row.task_id,
        taskVersion: Number(row.task_version),
        packetId: row.packet_id,
        holdoutId: row.holdout_id,
        title: manifest.titleAr,
        summary: manifest.summaryAr,
        lane: row.lane,
        baseline: true,
        assignmentMode: "open",
        source: {
          repository: row.source_repository,
          path: row.source_path,
          commitSha: row.source_commit_sha
        },
        consensusState: "operational-test",
        round: 0,
        deadlineAtUtc: null,
        role: claim?.role || "A",
        clientRole: claim?.role || "A",
        status: claim?.status || "new",
        ready: claim?.status !== "submitted",
        new: !claim,
        draft: draft
          ? {
            progressPercent: Number(draft.completion_percent || 0),
            updatedAtUtc: new Date(draft.updated_at).toISOString()
          }
          : null
      });
      continue;
    }
    const roundKey = `${row.task_version_id}\u0000${row.round_id}`;
    const assignments = assignmentsByRound.get(roundKey) || [];
    const participations = participationsByRound.get(roundKey) || [];
    const own = assignments.find(item =>
      item.user_id === account.user_id
      || item.email_hash === account.verified_email_hash
    ) || null;
    const occupiedRoles = new Set([
      ...assignments.map(item => item.role),
      ...participations.map(item => item.role)
    ]);
    const eligibleRoles = repositoryTaskRolesForState(row.state);
    const availableRoles = eligibleRoles.filter(
      role => !occupiedRoles.has(role)
    );
    if (row.assignment_mode === "assigned" && !own) continue;
    if (row.assignment_mode === "open"
        && !own
        && availableRoles.length === 0) {
      continue;
    }
    const manifest = parseRepositoryTaskManifest(row.manifest_json);
    const role = own?.role || availableRoles[0] || null;
    const ready = own
      ? own.status === "submitted" || eligibleRoles.includes(own.role)
      : availableRoles.length > 0;
    const draftRole = clientRoleForConsensusRole(role);
    const draft = draftRole
      ? drafts.get(`${row.packet_id}\u0000${draftRole}`) || null
      : null;
    tasks.push({
      taskVersionId: row.task_version_id,
      taskId: row.task_id,
      taskVersion: Number(row.task_version),
      packetId: row.packet_id,
      holdoutId: row.holdout_id,
      title: manifest.titleAr,
      summary: manifest.summaryAr,
      assignmentMode: row.assignment_mode,
      lane: row.lane,
      baseline: false,
      source: {
        repository: row.source_repository,
        path: row.source_path,
        commitSha: row.source_commit_sha
      },
      consensusState: row.state,
      round: Number(row.current_round),
      deadlineAtUtc: new Date(row.round_deadline_at).toISOString(),
      role,
      clientRole: draftRole,
      status: own?.status || "new",
      ready,
      new: !own || own.status === "invited",
      draft: draft
        ? {
          progressPercent: Number(draft.completion_percent || 0),
          updatedAtUtc: new Date(draft.updated_at).toISOString()
        }
        : null
    });
  }
  tasks.sort((left, right) =>
    Number(right.baseline) - Number(left.baseline));
  return json({ tasks });
}

async function claimRepositoryTask(request, env, body) {
  const account = await requireSession(request, env);
  if (!account.verified_email_hash) {
    throw new PublicError("وثّق بريد الحساب قبل استلام المهمة.", 403);
  }
  const taskVersionId = requiredTaskVersionId(
    body?.taskVersionId,
    "معرف إصدار المهمة"
  );
  const context = await getRepositoryTaskContext(env.DB, taskVersionId);
  if (!context || context.catalog_status !== "active") {
    throw new PublicError("المهمة المطلوبة غير متاحة.", 404);
  }
  const requestedLane = requestedRepositoryTaskLane(body?.mode);
  if (context.lane !== requestedLane) {
    throw new PublicError("المهمة المطلوبة غير متاحة في هذا الوضع.", 404);
  }
  if (context.lane === "operational-test") {
    return claimOperationalRepositoryTask(env, account, context);
  }
  const eligibleRoles = repositoryTaskRolesForState(context.state);
  if (eligibleRoles.length === 0) {
    throw new PublicError("هذه المهمة ليست جاهزة لدور جديد الآن.", 409);
  }

  let assignment = await env.DB.prepare(
    `SELECT *
       FROM task_assignments
      WHERE task_version_id = ? AND round_id = ?
        AND status <> 'cancelled'
        AND (user_id = ? OR email_hash = ?)
      ORDER BY invited_at
      LIMIT 1`
  ).bind(
    context.task_version_id,
    context.round_id,
    account.user_id,
    account.verified_email_hash
  ).first();
  if (assignment && !eligibleRoles.includes(assignment.role)
      && assignment.status !== "submitted") {
    throw new PublicError(
      "المهمة مسندة إليك، لكنها تنتظر اكتمال المرحلة السابقة.",
      409
    );
  }

  const conflict = await env.DB.prepare(
    `SELECT role
       FROM task_participations
      WHERE holdout_id = ? AND user_id = ?
      UNION ALL
     SELECT role
       FROM task_assignments
      WHERE holdout_id = ? AND user_id = ?
        AND status IN ('invited', 'claimed', 'submitted')
        AND task_version_id <> ?
      LIMIT 1`
  ).bind(
    context.holdout_id,
    account.user_id,
    context.holdout_id,
    account.user_id,
    context.task_version_id
  ).first();
  if (conflict) {
    throw new PublicError(
      "سبق لهذا الحساب العمل على المادة نفسها؛ لا يمكن إسناد دور آخر.",
      409
    );
  }

  const now = Date.now();
  if (!assignment) {
    if (context.assignment_mode !== "open") {
      throw new PublicError(
        "هذه المهمة مخصصة لحساب آخر بحسب البريد الموثق.",
        403
      );
    }
    const occupied = await env.DB.prepare(
      `SELECT role
         FROM task_assignments
        WHERE task_version_id = ? AND round_id = ?
          AND status <> 'cancelled'
        UNION
       SELECT role
         FROM task_participations
        WHERE task_version_id = ? AND round_id = ?`
    ).bind(
      context.task_version_id,
      context.round_id,
      context.task_version_id,
      context.round_id
    ).all();
    const occupiedRoles = new Set(
      (occupied.results || []).map(row => row.role)
    );
    const role = eligibleRoles.find(value => !occupiedRoles.has(value));
    if (!role) {
      throw new PublicError("اكتملت الأدوار المتاحة لهذه المرحلة.", 409);
    }
    const email = await verifiedAccountEmail(account, env);
    const masterKey = await getVaultSecret(
      env.ENTITYCRYPT_MASTER_KEY_SECRET_NAME,
      env
    );
    const id = crypto.randomUUID();
    try {
      const result = await env.DB.prepare(
        `INSERT INTO task_assignments
          (id, task_version_id, round_id, holdout_id, role, email_hash,
           email_ciphertext, user_id, status, invited_at, claimed_at,
           updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'claimed', ?, ?, ?)`
      ).bind(
        id,
        context.task_version_id,
        context.round_id,
        context.holdout_id,
        role,
        account.verified_email_hash,
        await encryptEntityCrypt(email, masterKey),
        account.user_id,
        now,
        now,
        now
      ).run();
      if (Number(result.meta?.changes || 0) !== 1) {
        throw new Error("Assignment insert did not persist.");
      }
    } catch {
      throw new PublicError(
        "حجز محكّم آخر هذا الدور للتو؛ حدّث قائمة المهام.",
        409
      );
    }
    assignment = await env.DB.prepare(
      "SELECT * FROM task_assignments WHERE id = ?"
    ).bind(id).first();
  } else if (assignment.status === "invited") {
    const result = await env.DB.prepare(
      `UPDATE task_assignments
          SET user_id = ?, status = 'claimed', claimed_at = ?, updated_at = ?
        WHERE id = ? AND status = 'invited'`
    ).bind(account.user_id, now, now, assignment.id).run();
    if (Number(result.meta?.changes || 0) !== 1) {
      throw new PublicError("تغيرت حالة الإسناد؛ حدّث قائمة المهام.", 409);
    }
    assignment = {
      ...assignment,
      user_id: account.user_id,
      status: "claimed",
      claimed_at: now,
      updated_at: now
    };
  }

  return json(await repositoryTaskPayload(env, context, assignment));
}

async function loadRepositoryTask(request, env, url) {
  const account = await requireSession(request, env);
  const taskVersionId = requiredTaskVersionId(
    url.searchParams.get("taskVersionId"),
    "معرف إصدار المهمة"
  );
  const context = await getRepositoryTaskContext(env.DB, taskVersionId);
  if (!context || context.catalog_status !== "active") {
    throw new PublicError("المهمة المطلوبة غير متاحة.", 404);
  }
  const requestedLane = requestedRepositoryTaskLane(
    url.searchParams.get("mode")
  );
  if (context.lane !== requestedLane) {
    throw new PublicError("المهمة المطلوبة غير متاحة في هذا الوضع.", 404);
  }
  if (context.lane === "operational-test") {
    const claim = await env.DB.prepare(
      `SELECT *
         FROM operational_task_claims
        WHERE task_version_id = ? AND user_id = ?`
    ).bind(context.task_version_id, account.user_id).first();
    if (!claim) {
      throw new PublicError("استلم الاختبار من القائمة قبل فتحه.", 403);
    }
    return json(await repositoryTaskPayload(env, context, claim));
  }
  const assignment = await env.DB.prepare(
    `SELECT *
       FROM task_assignments
      WHERE task_version_id = ? AND round_id = ?
        AND user_id = ?
        AND status IN ('claimed', 'submitted')`
  ).bind(
    context.task_version_id,
    context.round_id,
    account.user_id
  ).first();
  if (!assignment) {
    throw new PublicError("استلم المهمة من القائمة قبل فتحها.", 403);
  }
  return json(await repositoryTaskPayload(env, context, assignment));
}

async function getRepositoryTaskContext(db, taskVersionId) {
  return db.prepare(
    `SELECT rtp.task_version_id, rtp.manifest_json,
            rtp.assignment_mode, rtp.lane,
            rtp.status AS catalog_status,
            tv.task_id, tv.task_version, tv.packet_id, tv.holdout_id,
            tv.state, tv.current_round, cr.id AS round_id,
            cr.deadline_at
       FROM repository_task_packets rtp
       JOIN task_versions tv ON tv.id = rtp.task_version_id
       JOIN consensus_rounds cr
         ON cr.task_version_id = tv.id
        AND cr.round_number = tv.current_round
      WHERE rtp.task_version_id = ?`
  ).bind(taskVersionId).first();
}

async function repositoryTaskPayload(env, context, assignment) {
  const manifest = parseRepositoryTaskManifest(context.manifest_json);
  const payload = {
    taskVersionId: context.task_version_id,
    taskId: context.task_id,
    taskVersion: Number(context.task_version),
    consensusState: context.lane === "operational-test"
      ? "operational-test"
      : context.state,
    round: context.lane === "operational-test"
      ? 0
      : Number(context.current_round),
    deadlineAtUtc: context.lane === "operational-test"
      ? null
      : new Date(context.deadline_at).toISOString(),
    role: assignment.role,
    clientRole: clientRoleForConsensusRole(assignment.role),
    assignmentStatus: assignment.status,
    lane: context.lane,
    packet: manifest.packet
  };
  if (assignment.role === "J1") {
    const result = await env.DB.prepare(
      `SELECT role, artifact_json
         FROM submissions
        WHERE task_version_id = ? AND round_id = ?
          AND consensus_role IN ('A', 'B') AND active = 1
        ORDER BY submitted_at`
    ).bind(context.task_version_id, context.round_id).all();
    const artifacts = new Map(
      (result.results || []).map(row => [
        row.role,
        JSON.parse(row.artifact_json)
      ])
    );
    if (!artifacts.has("A") || !artifacts.has("B")) {
      throw new PublicError(
        "لم تكتمل بعد نتيجتا المحكّمين المستقلين.",
        409
      );
    }
    payload.annotationA = artifacts.get("A").annotation;
    payload.annotationB = artifacts.get("B").annotation;
  } else if (assignment.role === "J2") {
    const row = await env.DB.prepare(
      `SELECT artifact_json
         FROM submissions
        WHERE task_version_id = ? AND round_id = ?
          AND consensus_role = 'J1' AND active = 1
        ORDER BY submitted_at DESC
        LIMIT 1`
    ).bind(context.task_version_id, context.round_id).first();
    if (!row) {
      throw new PublicError("لم يكتمل قرار المحكّم الرئيس بعد.", 409);
    }
    payload.primaryArtifact = JSON.parse(row.artifact_json);
  }
  return payload;
}

function parseRepositoryTaskManifest(value) {
  try {
    const manifest = JSON.parse(value);
    if (manifest?.schema !== "adg-msa-repository-task-v1") {
      throw new Error("Unexpected repository task schema.");
    }
    return manifest;
  } catch {
    throw new PublicError("تعريف المهمة المخزن غير صالح.", 500);
  }
}

function repositoryTaskRolesForState(state) {
  if (["open", "independent-review"].includes(state)) return ["A", "B"];
  if (state === "discussion") return ["J1"];
  if (state === "final-review") return ["J2"];
  return [];
}

function clientRoleForConsensusRole(role) {
  return role === "J1"
    ? "adjudication"
    : role === "J2"
      ? "ratification"
      : ["A", "B"].includes(role)
        ? role
        : null;
}

function requestedRepositoryTaskLane(mode) {
  return mode === "operational-test"
    ? "operational-test"
    : "standard";
}

async function claimOperationalRepositoryTask(env, account, context) {
  let claim = await env.DB.prepare(
    `SELECT *
       FROM operational_task_claims
      WHERE task_version_id = ? AND user_id = ?`
  ).bind(context.task_version_id, account.user_id).first();
  if (!claim) {
    const now = Date.now();
    const id = crypto.randomUUID();
    const result = await env.DB.prepare(
      `INSERT INTO operational_task_claims
        (id, task_version_id, user_id, role, status, claimed_at, updated_at)
       VALUES (?, ?, ?, 'A', 'claimed', ?, ?)`
    ).bind(
      id,
      context.task_version_id,
      account.user_id,
      now,
      now
    ).run();
    if (Number(result.meta?.changes || 0) !== 1) {
      throw new PublicError("تعذر استلام الاختبار التشغيلي.", 409);
    }
    claim = {
      id,
      task_version_id: context.task_version_id,
      user_id: account.user_id,
      role: "A",
      status: "claimed",
      claimed_at: now,
      updated_at: now
    };
  }
  return json(await repositoryTaskPayload(env, context, claim));
}

function requiredTaskVersionId(value, label) {
  const normalized = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,200}$/.test(normalized)) {
    throw new PublicError(`${label} غير صالح.`, 400);
  }
  return normalized;
}

async function verifiedAccountEmail(account, env) {
  const masterKey = await getVaultSecret(
    env.ENTITYCRYPT_MASTER_KEY_SECRET_NAME,
    env
  );
  const profile = JSON.parse(await decryptEntityCrypt(
    account.profile_ciphertext,
    masterKey
  ));
  const email = normalizeVerificationEmail(profile.email);
  if (await verifiedEmailAddressHash(email, env)
      !== account.verified_email_hash) {
    throw new PublicError("تعذر ربط بريد الحساب الموثق بالمهمة.", 409);
  }
  return email;
}

async function getTaskStatus(request, env, url) {
  const account = await requireSession(request, env);
  const receiptId = requiredId(
    url.searchParams.get("receiptId"),
    "معرف المساهمة"
  );
  const task = await env.DB.prepare(
    `SELECT tv.id, tv.task_id, tv.task_version, tv.packet_id,
            tv.holdout_id, tv.packet_merkle_root,
            tv.guideline_version, tv.data_version, tv.protocol_version,
            tv.metric_policy_json, tv.state, tv.state_version,
            tv.current_round, tv.active_final_receipt_id,
            tv.appeal_deadline_at, tv.repository_status,
            tv.github_issue_number, tv.updated_at, tv.approved_at,
            tv.published_at, tv.revoked_at
       FROM submissions s
       JOIN task_versions tv ON tv.id = s.task_version_id
      WHERE s.receipt_id = ? AND s.user_id = ?`
  ).bind(receiptId, account.user_id).first();
  if (!task) {
    return json({ found: false, receiptId });
  }
  const round = await getCurrentConsensusRound(env.DB, task);
  const [participationResult, ownParticipation, metrics, appeals] =
    await Promise.all([
      env.DB.prepare(
        `SELECT role, status, COUNT(*) AS count
           FROM task_participations
          WHERE round_id = ?
          GROUP BY role, status`
      ).bind(round.id).all(),
      env.DB.prepare(
        `SELECT role, status, submission_receipt_id
           FROM task_participations
          WHERE task_version_id = ? AND user_id = ?`
      ).bind(task.id, account.user_id).first(),
      env.DB.prepare(
        `SELECT metrics_json, policy_passed, computed_at
           FROM consensus_metrics
          WHERE task_version_id = ? AND round_id = ?`
      ).bind(task.id, round.id).first(),
      env.DB.prepare(
        `SELECT id, status, created_at, reviewed_at
           FROM appeals
          WHERE task_version_id = ?
          ORDER BY created_at DESC
          LIMIT 20`
      ).bind(task.id).all()
    ]);
  const canViewMetrics = Boolean(ownParticipation)
    || !["open", "independent-review"].includes(task.state);
  return json({
    found: true,
    sourceReceiptId: receiptId,
    taskVersionId: task.id,
    taskId: task.task_id,
    taskVersion: Number(task.task_version),
    packetId: task.packet_id,
    holdoutId: task.holdout_id,
    packetMerkleRoot: task.packet_merkle_root,
    guidelineVersion: task.guideline_version,
    dataVersion: task.data_version,
    protocolVersion: task.protocol_version,
    state: task.state,
    stateVersion: Number(task.state_version),
    round: {
      id: round.id,
      number: Number(round.round_number),
      status: round.status,
      deadlineAtUtc: new Date(round.deadline_at).toISOString()
    },
    slots: (participationResult.results || []).map(row => ({
      role: row.role,
      status: row.status,
      count: Number(row.count)
    })),
    ownParticipation: ownParticipation
      ? {
        role: ownParticipation.role,
        status: ownParticipation.status,
        receiptId: ownParticipation.submission_receipt_id
      }
      : null,
    metricPolicy: JSON.parse(task.metric_policy_json),
    agreement: canViewMetrics && metrics
      ? {
        ...JSON.parse(metrics.metrics_json),
        policyPassed: Boolean(metrics.policy_passed),
        computedAtUtc: new Date(metrics.computed_at).toISOString()
      }
      : null,
    activeFinalReceiptId: task.active_final_receipt_id,
    appealDeadlineAtUtc: task.appeal_deadline_at
      ? new Date(task.appeal_deadline_at).toISOString()
      : null,
    repositoryStatus: task.repository_status,
    githubIssueNumber: task.github_issue_number,
    appeals: (appeals.results || []).map(row => ({
      id: row.id,
      status: row.status,
      createdAtUtc: new Date(row.created_at).toISOString(),
      reviewedAtUtc: row.reviewed_at
        ? new Date(row.reviewed_at).toISOString()
        : null
    })),
    updatedAtUtc: new Date(task.updated_at).toISOString()
  });
}

async function createConsensusAppeal(request, env, body) {
  const account = await requireSession(request, env);
  if (!account.verified_email_hash) {
    throw new PublicError("وثّق بريد الحساب قبل تقديم الاستئناف.", 403);
  }
  const finalReceiptId = requiredId(
    body?.finalReceiptId,
    "معرف النتيجة النهائية"
  );
  const evidence = normalizedText(
    body?.evidence,
    40,
    4000,
    "دليل الاستئناف"
  );
  const final = await env.DB.prepare(
    `SELECT f.primary_receipt_id, f.task_version_id, f.round_id,
            f.status, tv.state, tv.appeal_deadline_at, tv.packet_id
       FROM final_results f
       JOIN task_versions tv ON tv.id = f.task_version_id
      WHERE f.primary_receipt_id = ?`
  ).bind(finalReceiptId).first();
  if (!final
      || final.status !== "active"
      || final.state !== "approved") {
    throw new PublicError("النتيجة غير مؤهلة للاستئناف.", 409);
  }
  if (!final.appeal_deadline_at
      || Number(final.appeal_deadline_at) < Date.now()) {
    throw new PublicError("انتهت مهلة الاستئناف لهذه النتيجة.", 409);
  }
  const eligible = await env.DB.prepare(
    `SELECT role
       FROM task_participations
      WHERE task_version_id = ? AND user_id = ?
        AND role IN ('A', 'B', 'J1', 'J2')
        AND status = 'submitted'`
  ).bind(final.task_version_id, account.user_id).first();
  if (!eligible) {
    throw new PublicError(
      "الاستئناف متاح للمشاركين المثبتين في هذه المهمة فقط.",
      403
    );
  }
  const appealId = crypto.randomUUID();
  const createdAt = Date.now();
  let inserted;
  try {
    inserted = await env.DB.prepare(
      `INSERT INTO appeals
        (id, task_version_id, round_id, appellant_user_id,
         final_receipt_id, evidence, status, created_at)
       SELECT ?, f.task_version_id, f.round_id, ?, f.primary_receipt_id,
              ?, 'pending', ?
         FROM final_results f
         JOIN task_versions tv ON tv.id = f.task_version_id
        WHERE f.primary_receipt_id = ?
          AND f.status = 'active'
          AND tv.state = 'approved'
          AND tv.appeal_deadline_at IS NOT NULL
          AND tv.appeal_deadline_at >= ?
          AND EXISTS (
            SELECT 1
              FROM task_participations tp
             WHERE tp.task_version_id = f.task_version_id
               AND tp.user_id = ?
               AND tp.role IN ('A', 'B', 'J1', 'J2')
               AND tp.status = 'submitted'
          )`
    ).bind(
      appealId,
      account.user_id,
      evidence,
      createdAt,
      finalReceiptId,
      createdAt,
      account.user_id
    ).run();
  } catch {
    throw new PublicError(
      "سبق أن قدمت استئنافًا لهذه النتيجة.",
      409
    );
  }
  if (Number(inserted?.meta?.changes || 0) !== 1) {
    throw new PublicError(
      "تغيرت حالة النتيجة أو انتهت مهلة الاستئناف.",
      409
    );
  }
  await queueGovernanceNotifications(
    env,
    final.task_version_id,
    "appeal-opened",
    {
      taskVersionId: final.task_version_id,
      packetId: final.packet_id,
      appealId
    },
    `appeal-opened:${appealId}`
  );
  return json({
    accepted: true,
    appealId,
    status: "pending",
    message:
      "سُجل الاستئناف وسيحتاج مراجعًا مستقلًا قبل إعادة طرح المهمة."
  }, 202);
}

async function requestIdentityErasure(request, env, body) {
  const account = await requireSession(request, env);
  if (body?.confirm !== true) {
    throw new PublicError(
      "يلزم تأكيد طلب محو ارتباط الهوية صراحة.",
      400
    );
  }
  const existing = await env.DB.prepare(
    `SELECT id, eligible_after
       FROM identity_erasure_requests
      WHERE user_id = ? AND status = 'pending'`
  ).bind(account.user_id).first();
  const d1Backup = evidenceArchiveMode(env) === "d1"
    ? d1TimeTravelRetentionSummary(env)
    : null;
  if (existing) {
    return json({
      accepted: true,
      requestId: existing.id,
      eligibleAfterUtc:
        new Date(existing.eligible_after).toISOString(),
      deletionScope: d1Backup
        ? "active-store-after-retention"
        : "archive-after-retention",
      providerBackupRetentionDays: d1Backup?.retentionDays ?? null
    }, 202);
  }
  const retentionDays = Math.min(
    730,
    Math.max(30, Number(env.IDENTITY_RETENTION_DAYS || 365))
  );
  const now = Date.now();
  const eligibleAfter = now
    + retentionDays * 24 * 60 * 60 * 1000;
  const requestId = crypto.randomUUID();
  const receipts = await env.DB.prepare(
    `SELECT receipt_id
       FROM submissions
      WHERE user_id = ?`
  ).bind(account.user_id).all();
  const writes = [
    env.DB.prepare(
      `INSERT INTO identity_erasure_requests
        (id, user_id, status, requested_at, eligible_after)
       VALUES (?, ?, 'pending', ?, ?)`
    ).bind(requestId, account.user_id, now, eligibleAfter)
  ];
  for (const row of receipts.results || []) {
    writes.push(env.DB.prepare(
      `INSERT INTO identity_erasure_items
        (request_id, blob_name, status)
       VALUES (?, ?, 'pending')`
    ).bind(requestId, `${row.receipt_id}.json`));
  }
  await env.DB.batch(writes);
  return json({
    accepted: true,
    requestId,
    retentionDays,
    eligibleAfterUtc: new Date(eligibleAfter).toISOString(),
    deletionScope: d1Backup
      ? "active-store-after-retention"
      : "archive-after-retention",
    providerBackupRetentionDays: d1Backup?.retentionDays ?? null,
    message:
      d1Backup
        ? "سيمحى ارتباط الهوية من المخزن النشط بعد إغلاق المهام "
          + "وانقضاء مدة الاحتفاظ، وقد تبقى لقطات D1 القابلة للاسترجاع "
          + "حتى انتهاء نافذة الخطة."
        : "سيمحى ارتباط الهوية بعد إغلاق المهام وانقضاء مدة الاحتفاظ."
  }, 202);
}

async function receiveRepositoryReceipt(request, env) {
  if (!env.REPOSITORY_RECEIPT_HMAC_SECRET_NAME) {
    throw new PublicError("قناة إيصال المستودع غير مهيأة.", 503);
  }
  const text = await request.text();
  if (!text || text.length > 32768) {
    throw new PublicError("حجم إيصال المستودع غير صالح.", 413);
  }
  let signed;
  try {
    signed = JSON.parse(text);
  } catch {
    throw new PublicError("إيصال المستودع ليس JSON صالحًا.", 400);
  }
  const { hmacSha256: signature, ...envelope } = signed || {};
  if (envelope.schema === "adg-msa-repository-receipt-v1") {
    validateRepositoryReceiptEnvelope(envelope, signature, env);
  } else if (envelope.schema === "adg-msa-evidence-receipt-v1") {
    validateEvidenceRepositoryReceiptEnvelope(
      envelope,
      signature,
      env
    );
  } else if (envelope.schema === "adg-msa-task-state-receipt-v1") {
    validateTaskStateRepositoryReceiptEnvelope(
      envelope,
      signature,
      env
    );
  } else {
    throw new PublicError("نوع إيصال المستودع غير مدعوم.", 400);
  }
  const key = await getVaultSecret(
    env.REPOSITORY_RECEIPT_HMAC_SECRET_NAME,
    env
  );
  if (!await verifyHmacSha256(
    key,
    JSON.stringify(envelope),
    signature
  )) {
    throw new PublicError("توقيع إيصال المستودع غير صحيح.", 401);
  }
  if (envelope.schema === "adg-msa-evidence-receipt-v1") {
    return acceptEvidenceRepositoryReceipt(
      env,
      envelope,
      signature
    );
  }
  if (envelope.schema === "adg-msa-task-state-receipt-v1") {
    return acceptTaskStateRepositoryReceipt(
      env,
      envelope,
      signature
    );
  }
  const binding = await env.DB.prepare(
    `SELECT e.id, e.round_id, e.to_state,
            f.primary_receipt_id, f.final_merkle_root, f.status
       FROM consensus_events e
       JOIN final_results f
         ON f.task_version_id = e.task_version_id
        AND f.round_id = e.round_id
      WHERE e.id = ?
        AND e.task_version_id = ?
        AND e.round_id = ?
        AND e.to_state = 'approved'
        AND f.final_merkle_root = ?
        AND f.status = 'active'`
  ).bind(
    envelope.nonce,
    envelope.taskVersionId,
    envelope.roundId,
    envelope.finalMerkleRoot
  ).first();
  if (!binding) {
    throw new PublicError(
      "إيصال المستودع لا يطابق نتيجة معتمدة في سجل الإجماع.",
      409
    );
  }
  const receivedAt = Date.parse(envelope.receivedAtUtc);
  const acceptedAt = Date.parse(envelope.acceptedAtUtc);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO repository_receipts
        (id, task_version_id, round_id, final_merkle_root, nonce,
         pr_number, pr_merge_sha, importer_commit_sha, envelope_json,
         signature_sha256, received_at, accepted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      envelope.receiptId,
      envelope.taskVersionId,
      envelope.roundId,
      envelope.finalMerkleRoot,
      envelope.nonce,
      envelope.prNumber,
      envelope.prMergeSha,
      envelope.importerCommitSha,
      JSON.stringify(envelope),
      signature,
      receivedAt,
      acceptedAt
    ),
    env.DB.prepare(
      `UPDATE task_versions
          SET repository_status = 'accepted',
              github_issue_number = COALESCE(?, github_issue_number),
              updated_at = ?
        WHERE id = ? AND state = 'approved'
          AND active_final_receipt_id = ?`
    ).bind(
      envelope.issueNumber ?? null,
      Date.now(),
      envelope.taskVersionId,
      binding.primary_receipt_id
    ),
    env.DB.prepare(
      `UPDATE evidence_outbox
          SET status = 'sent',
              sent_at = COALESCE(sent_at, ?),
              last_error = NULL
        WHERE kind = 'task-state' AND related_id = ?`
    ).bind(
      acceptedAt,
      envelope.nonce
    )
  ]);
  const stored = await env.DB.prepare(
    `SELECT id
       FROM repository_receipts
      WHERE task_version_id = ? AND final_merkle_root = ?
        AND nonce = ?`
  ).bind(
    envelope.taskVersionId,
    envelope.finalMerkleRoot,
    envelope.nonce
  ).first();
  if (!stored) {
    throw new PublicError("تعارض إيصال المستودع مع إيصال سابق.", 409);
  }
  const task = await attemptPublishTask(env, envelope.taskVersionId);
  return json({
    accepted: true,
    receiptId: stored.id,
    taskVersionId: envelope.taskVersionId,
    state: task?.state ?? "approved",
    publicationDeferred: task?.state !== "published"
  }, 202);
}

async function claimPortalIssueReports(request, env) {
  if (!env.DB || !env.REPOSITORY_RECEIPT_HMAC_SECRET_NAME) {
    throw new PublicError("قناة نشر بلاغات المنصة غير مهيأة.", 503);
  }
  const signed = await readJsonBody(request);
  const { hmacSha256: signature, ...envelope } = signed || {};
  validatePortalIssueReportClaimEnvelope(envelope, signature, env);
  const key = await getVaultSecret(
    env.REPOSITORY_RECEIPT_HMAC_SECRET_NAME,
    env
  );
  if (!await verifyHmacSha256(
    key,
    JSON.stringify(envelope),
    signature
  )) {
    throw new PublicError("توقيع طلب سحب البلاغات غير صحيح.", 401);
  }

  const priorClaim = await env.DB.prepare(
    `SELECT nonce
       FROM portal_issue_report_claims
      WHERE nonce = ?`
  ).bind(envelope.nonce).first();
  if (!priorClaim) {
    const now = Date.now();
    const claimInsert = await env.DB.prepare(
      `INSERT INTO portal_issue_report_claims
        (nonce, requested_at, claimed_at)
       VALUES (?, ?, ?)
       ON CONFLICT (nonce) DO NOTHING`
    ).bind(
      envelope.nonce,
      Date.parse(envelope.requestedAtUtc),
      now
    ).run();
    if (Number(claimInsert.meta?.changes || 0) === 1) {
      const limit = Math.min(
        PORTAL_ISSUE_REPORT_CLAIM_MAX_ITEMS,
        Math.max(1, Number(envelope.maxItems))
      );
      const candidates = await env.DB.prepare(
        `SELECT id
           FROM portal_issue_reports
          WHERE status = 'pending'
             OR (status = 'claimed' AND claim_expires_at <= ?)
          ORDER BY created_at
          LIMIT ?`
      ).bind(now, limit).all();
      const updates = (candidates.results || []).map(row =>
        env.DB.prepare(
          `UPDATE portal_issue_reports
              SET status = 'claimed',
                  claim_nonce = ?,
                  claim_expires_at = ?,
                  attempts = attempts + 1,
                  updated_at = ?
            WHERE id = ?
              AND (
                status = 'pending'
                OR (status = 'claimed' AND claim_expires_at <= ?)
              )`
        ).bind(
          envelope.nonce,
          now + PORTAL_ISSUE_REPORT_CLAIM_HOLD_MS,
          now,
          row.id,
          now
        )
      );
      if (updates.length) await env.DB.batch(updates);
      await env.DB.prepare(
        `DELETE FROM portal_issue_report_claims
          WHERE claimed_at < ? AND nonce <> ?`
      ).bind(
        now - 30 * 24 * 60 * 60 * 1000,
        envelope.nonce
      ).run();
    }
  }

  const rows = await env.DB.prepare(
    `SELECT id, content_sha256, payload_json
       FROM portal_issue_reports
      WHERE status = 'claimed' AND claim_nonce = ?
      ORDER BY created_at
      LIMIT ?`
  ).bind(
    envelope.nonce,
    PORTAL_ISSUE_REPORT_CLAIM_MAX_ITEMS
  ).all();
  const claimedAt = Date.now();
  return json({
    accepted: true,
    claim: {
      schema: "adg-portal-issue-report-claim-result-v1",
      repository: envelope.repository,
      nonce: envelope.nonce,
      requestedAtUtc: envelope.requestedAtUtc,
      claimedAtUtc: new Date(claimedAt).toISOString(),
      count: rows.results?.length || 0
    },
    items: (rows.results || []).map(row => ({
      reportId: row.id,
      contentSha256: row.content_sha256,
      payloadJson: row.payload_json
    }))
  });
}

async function receivePortalIssueReportReceipt(request, env) {
  if (!env.DB || !env.REPOSITORY_RECEIPT_HMAC_SECRET_NAME) {
    throw new PublicError("قناة إيصال بلاغات المنصة غير مهيأة.", 503);
  }
  const signed = await readJsonBody(request);
  const { hmacSha256: signature, ...envelope } = signed || {};
  validatePortalIssueReportReceiptEnvelope(envelope, signature, env);
  const key = await getVaultSecret(
    env.REPOSITORY_RECEIPT_HMAC_SECRET_NAME,
    env
  );
  if (!await verifyHmacSha256(
    key,
    JSON.stringify(envelope),
    signature
  )) {
    throw new PublicError("توقيع إيصال البلاغ غير صحيح.", 401);
  }

  const stored = await env.DB.prepare(
    `SELECT id, content_sha256, status, claim_nonce, github_issue_number,
            github_issue_url
       FROM portal_issue_reports
      WHERE id = ?`
  ).bind(envelope.reportId).first();
  if (!stored || stored.content_sha256 !== envelope.contentSha256) {
    throw new PublicError("البلاغ المرتبط بالإيصال غير موجود.", 404);
  }
  if (stored.claim_nonce !== envelope.claimNonce) {
    throw new PublicError("إيصال البلاغ لا يطابق دورة السحب الحالية.", 409);
  }
  if (stored.status === "published") {
    if (Number(stored.github_issue_number) !== envelope.issueNumber
        || stored.github_issue_url !== envelope.issueUrl) {
      throw new PublicError("سبق ربط البلاغ بمسألة أخرى.", 409);
    }
    return json({
      accepted: true,
      duplicate: true,
      reportId: stored.id,
      issueNumber: Number(stored.github_issue_number),
      issueUrl: stored.github_issue_url
    }, 202);
  }
  if (stored.status !== "claimed") {
    throw new PublicError("لم يُسحب البلاغ للنشر بعد.", 409);
  }

  const publishedAt = Date.parse(envelope.acceptedAtUtc);
  const update = await env.DB.prepare(
    `UPDATE portal_issue_reports
        SET status = 'published',
            github_issue_number = ?,
            github_issue_url = ?,
            published_at = ?,
            updated_at = ?,
            claim_expires_at = NULL
      WHERE id = ?
        AND content_sha256 = ?
        AND status = 'claimed'
        AND claim_nonce = ?`
  ).bind(
    envelope.issueNumber,
    envelope.issueUrl,
    publishedAt,
    publishedAt,
    envelope.reportId,
    envelope.contentSha256,
    envelope.claimNonce
  ).run();
  if (Number(update.meta?.changes || 0) !== 1) {
    throw new PublicError("تغيّرت حالة البلاغ أثناء قبول الإيصال.", 409);
  }
  return json({
    accepted: true,
    duplicate: false,
    reportId: envelope.reportId,
    issueNumber: envelope.issueNumber,
    issueUrl: envelope.issueUrl
  }, 202);
}

async function claimRepositoryEvidence(request, env) {
  if (!env.DB || !env.REPOSITORY_RECEIPT_HMAC_SECRET_NAME) {
    throw new PublicError("قناة سحب أدلة المستودع غير مهيأة.", 503);
  }
  const signed = await readJsonBody(request);
  const { hmacSha256: signature, ...envelope } = signed || {};
  validateRepositoryEvidenceClaimEnvelope(
    envelope,
    signature,
    env
  );
  const key = await getVaultSecret(
    env.REPOSITORY_RECEIPT_HMAC_SECRET_NAME,
    env
  );
  if (!await verifyHmacSha256(
    key,
    JSON.stringify(envelope),
    signature
  )) {
    throw new PublicError("توقيع طلب سحب الأدلة غير صحيح.", 401);
  }
  const now = Date.now();
  const limit = Math.min(
    REPOSITORY_EVIDENCE_CLAIM_MAX_ITEMS,
    Math.max(1, Number(envelope.maxItems || REPOSITORY_EVIDENCE_CLAIM_MAX_ITEMS))
  );
  const claimMarker = repositoryEvidenceClaimMarker(envelope.nonce);
  let rows = (await selectClaimedRepositoryEvidenceRows(
    env.DB,
    claimMarker,
    limit
  )).results || [];
  if (rows.length === 0) {
    const candidates = await selectClaimableRepositoryEvidenceRows(
      env.DB,
      now,
      limit
    );
    const statements = [];
    for (const row of candidates.results || []) {
      statements.push(env.DB.prepare(
        `UPDATE evidence_outbox
            SET status = 'sending',
                next_attempt_at = ?,
                last_error = ?
          WHERE id = ?
            AND (
              status IN ('pending', 'sent')
              OR (status = 'sending' AND next_attempt_at <= ?)
            )`
      ).bind(
        now + REPOSITORY_EVIDENCE_CLAIM_HOLD_MS,
        claimMarker,
        row.id,
        now
      ));
    }
    if (statements.length) {
      await env.DB.batch(statements);
    }
    rows = (await selectClaimedRepositoryEvidenceRows(
      env.DB,
      claimMarker,
      limit
    )).results || [];
  }
  return json({
    accepted: true,
    claim: {
      schema: "adg-msa-repository-evidence-claim-result-v1",
      repository: envelope.repository,
      nonce: envelope.nonce,
      requestedAtUtc: envelope.requestedAtUtc,
      claimedAtUtc: new Date(now).toISOString(),
      count: rows.length
    },
    items: rows.map(row => ({
      kind: row.kind,
      relatedId: row.related_id,
      publicBlobName: row.public_blob_name,
      publicPayloadJson: row.public_payload_json
    }))
  });
}

async function syncRepositoryTasks(request, env) {
  if (!env.DB || !env.REPOSITORY_RECEIPT_HMAC_SECRET_NAME) {
    throw new PublicError("قناة مزامنة مهام المستودع غير مهيأة.", 503);
  }
  const signed = await readRepositoryTaskSyncBody(request);
  const { hmacSha256: signature, ...envelope } = signed || {};
  validateRepositoryTaskSyncEnvelope(envelope, signature, env);
  const key = await getVaultSecret(
    env.REPOSITORY_RECEIPT_HMAC_SECRET_NAME,
    env
  );
  if (!await verifyHmacSha256(
    key,
    JSON.stringify(envelope),
    signature
  )) {
    throw new PublicError("توقيع مزامنة مهام المستودع غير صحيح.", 401);
  }

  const existing = await env.DB.prepare(
    `SELECT nonce
       FROM repository_task_syncs
      WHERE nonce = ? OR source_commit_sha = ?`
  ).bind(envelope.nonce, envelope.sourceCommitSha).first();
  if (existing) {
    return json({
      accepted: true,
      duplicate: true,
      sourceCommitSha: envelope.sourceCommitSha,
      synchronized: 0
    }, 202);
  }

  const prepared = [];
  for (const item of envelope.tasks) {
    const manifest = validateRepositoryTaskManifest(item, envelope);
    const packetMerkleRoot = await computePacketMerkleRoot(manifest.packet);
    if (manifest.packetMerkleRoot !== packetMerkleRoot) {
      throw new PublicError(
        `جذر الحزمة ${manifest.packet.packetId} لا يطابق محتواها.`,
        409
      );
    }
    prepared.push({
      manifest,
      packetMerkleRoot,
      immutableManifestSha256:
        await repositoryTaskImmutableManifestSha256(manifest),
      taskVersionId: taskVersionIdentity(
        manifest.packet,
        packetMerkleRoot
      ).id
    });
  }

  const now = Date.now();
  for (const item of prepared) {
    const existingResult = await env.DB.prepare(
      `SELECT task_version_id, packet_merkle_root,
              immutable_manifest_sha256, assignment_mode, lane, status,
              source_repository, source_path
         FROM repository_task_packets
        WHERE packet_id = ? OR source_path = ?`
    ).bind(
      item.manifest.packet.packetId,
      item.manifest.sourcePath
    ).all();
    const existingRows = existingResult.results || [];
    if (existingRows.length > 1) {
      throw new PublicError(
        `تتعارض هوية الحزمة ${item.manifest.packet.packetId} مع مسار مثبت.`,
        409
      );
    }
    const existingPacket = existingRows[0] || null;
    if (existingPacket
        && (existingPacket.task_version_id !== item.taskVersionId
          || existingPacket.packet_merkle_root !== item.packetMerkleRoot
          || existingPacket.immutable_manifest_sha256
            !== item.immutableManifestSha256
          || existingPacket.assignment_mode
            !== item.manifest.assignmentMode
          || existingPacket.lane !== item.manifest.lane
          || existingPacket.source_repository !== envelope.repository
          || existingPacket.source_path !== item.manifest.sourcePath)) {
      throw new PublicError(
        `لا يجوز تغيير محتوى الحزمة أو بياناتها المثبتة `
          + `${item.manifest.packet.packetId}.`,
        409
      );
    }
    if (item.manifest.status === "withdrawn" && !existingPacket) {
      throw new PublicError(
        `لا يمكن سحب حزمة لم تُسجل سابقًا: `
          + `${item.manifest.packet.packetId}.`,
        409
      );
    }
    if (existingPacket?.status === "withdrawn"
        && item.manifest.status === "active") {
      throw new PublicError(
        `لا يمكن إعادة تنشيط الحزمة المسحوبة `
          + `${item.manifest.packet.packetId}.`,
        409
      );
    }
    if (item.manifest.status === "active") {
      item.registration = await prepareConsensusTaskRegistration(
        env.DB,
        item.manifest.packet,
        item.packetMerkleRoot,
        now
      );
    }
  }

  const writes = [];
  const catalogIndexes = [];
  for (const item of prepared) {
    if (item.registration) {
      writes.push(...item.registration.statements);
    }
    catalogIndexes.push(writes.length);
    writes.push(env.DB.prepare(
      `INSERT INTO repository_task_packets
        (task_version_id, packet_id, packet_merkle_root, manifest_json,
         immutable_manifest_sha256, assignment_mode, lane, status,
         source_repository, source_path, source_commit_sha,
         first_synced_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(task_version_id) DO UPDATE SET
         manifest_json = CASE
           WHEN repository_task_packets.packet_id = excluded.packet_id
             AND repository_task_packets.packet_merkle_root
               = excluded.packet_merkle_root
             AND repository_task_packets.immutable_manifest_sha256
               = excluded.immutable_manifest_sha256
             AND repository_task_packets.assignment_mode
               = excluded.assignment_mode
             AND repository_task_packets.lane = excluded.lane
             AND repository_task_packets.source_repository
               = excluded.source_repository
             AND repository_task_packets.source_path = excluded.source_path
             AND NOT (
               repository_task_packets.status = 'withdrawn'
               AND excluded.status = 'active'
             )
           THEN excluded.manifest_json
           ELSE NULL
         END,
         status = excluded.status,
         updated_at = excluded.updated_at`
    ).bind(
      item.taskVersionId,
      item.manifest.packet.packetId,
      item.packetMerkleRoot,
      JSON.stringify(item.manifest),
      item.immutableManifestSha256,
      item.manifest.assignmentMode,
      item.manifest.lane,
      item.manifest.status,
      envelope.repository,
      item.manifest.sourcePath,
      envelope.sourceCommitSha,
      now,
      now
    ));
  }

  const payloadSha256 = await sha256Hex(JSON.stringify(envelope));
  const syncIndex = writes.length;
  writes.push(env.DB.prepare(
    `INSERT INTO repository_task_syncs
      (nonce, source_commit_sha, payload_sha256, synced_at)
     VALUES (?, ?, ?, ?)`
  ).bind(
    envelope.nonce,
    envelope.sourceCommitSha,
    payloadSha256,
    now
  ));
  const results = await env.DB.batch(writes);
  for (let index = 0; index < prepared.length; index += 1) {
    if (Number(results[catalogIndexes[index]]?.meta?.changes || 0) !== 1) {
      throw new PublicError(
        `تعذر تثبيت الحزمة `
          + `${prepared[index].manifest.packet.packetId}.`,
        409
      );
    }
  }
  if (Number(results[syncIndex]?.meta?.changes || 0) !== 1) {
    throw new PublicError("تعذر تثبيت سجل مزامنة المستودع.", 409);
  }
  for (const item of prepared) {
    if (!item.registration) continue;
    const task = await assertConsensusTaskRegistration(
      env.DB,
      item.manifest.packet,
      item.packetMerkleRoot
    );
    if (task.id !== item.taskVersionId) {
      throw new PublicError("هوية المهمة المخزنة لا تطابق الحزمة.", 409);
    }
  }

  return json({
    accepted: true,
    duplicate: false,
    sourceCommitSha: envelope.sourceCommitSha,
    synchronized: prepared.length
  }, 202);
}

async function readRepositoryTaskSyncBody(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > REPOSITORY_TASK_SYNC_MAX_BYTES) {
    throw new PublicError("حجم دليل مهام المستودع أكبر من الحد المسموح.", 413);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length
      > REPOSITORY_TASK_SYNC_MAX_BYTES) {
    throw new PublicError("حجم دليل مهام المستودع أكبر من الحد المسموح.", 413);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new PublicError("دليل مهام المستودع ليس JSON صالحًا.", 400);
  }
}

function validateRepositoryTaskSyncEnvelope(envelope, signature, env) {
  const requestedAt = Date.parse(envelope?.requestedAtUtc);
  const now = Date.now();
  if (!envelope
      || envelope.schema !== "adg-msa-repository-task-sync-v1"
      || !isUuid(envelope.nonce)
      || envelope.repository
        !== (env.GITHUB_REPOSITORY || "sbay-dev/ADG-Lang")
      || !/^[a-f0-9]{40}$/.test(envelope.sourceCommitSha || "")
      || !Array.isArray(envelope.tasks)
      || envelope.tasks.length < 1
      || envelope.tasks.length > REPOSITORY_TASK_SYNC_MAX_ITEMS
      || !/^[a-f0-9]{64}$/.test(signature || "")
      || !Number.isFinite(requestedAt)
      || Math.abs(now - requestedAt) > REPOSITORY_TASK_SYNC_WINDOW_MS) {
    throw new PublicError("صيغة مزامنة مهام المستودع غير صالحة.", 400);
  }
}

function validateRepositoryTaskManifest(manifest, envelope) {
  const allowedKeys = new Set([
    "schema",
    "titleAr",
    "summaryAr",
    "assignmentMode",
    "lane",
    "status",
    "sourcePath",
    "packetMerkleRoot",
    "packet"
  ]);
  if (!manifest
      || manifest.schema !== "adg-msa-repository-task-v1"
      || Object.keys(manifest).some(key => !allowedKeys.has(key))
      || typeof manifest.titleAr !== "string"
      || manifest.titleAr.trim().length < 5
      || manifest.titleAr.length > 140
      || typeof manifest.summaryAr !== "string"
      || manifest.summaryAr.trim().length < 10
      || manifest.summaryAr.length > 600
      || !["open", "assigned"].includes(manifest.assignmentMode)
      || !["standard", "operational-test"].includes(manifest.lane)
      || !["active", "withdrawn"].includes(manifest.status)
      || typeof manifest.sourcePath !== "string"
      || manifest.sourcePath.includes("..")
      || !/^human-evidence\/tasks\/[A-Za-z0-9][A-Za-z0-9._/-]{0,220}\.task\.json$/
        .test(manifest.sourcePath)
      || !/^[a-f0-9]{64}$/.test(manifest.packetMerkleRoot || "")) {
    throw new PublicError("تعريف إحدى مهام المستودع غير صالح.", 400);
  }
  if (containsKey(manifest, PII_KEYS)
      || containsKey(manifest, FORBIDDEN_ANALYSIS_KEYS)) {
    throw new PublicError(
      "تعريف المهمة يحتوي بيانات شخصية أو تحليلًا محظورًا.",
      400
    );
  }
  try {
    validatePacket(manifest.packet);
    validatePublicArtifactText({
      titleAr: manifest.titleAr,
      summaryAr: manifest.summaryAr,
      packet: manifest.packet
    });
  } catch (error) {
    throw new PublicError(error.message, 400);
  }
  return {
    ...manifest,
    titleAr: manifest.titleAr.trim(),
    summaryAr: manifest.summaryAr.trim()
  };
}

async function repositoryTaskImmutableManifestSha256(manifest) {
  return sha256Hex(JSON.stringify({
    schema: manifest.schema,
    titleAr: manifest.titleAr,
    summaryAr: manifest.summaryAr,
    assignmentMode: manifest.assignmentMode,
    lane: manifest.lane,
    sourcePath: manifest.sourcePath,
    packetMerkleRoot: manifest.packetMerkleRoot
  }));
}

function validatePortalIssueReportClaimEnvelope(
  envelope,
  signature,
  env
) {
  const requestedAt = Date.parse(envelope?.requestedAtUtc);
  const now = Date.now();
  if (!envelope
      || envelope.schema !== PORTAL_ISSUE_REPORT_CLAIM_SCHEMA
      || !isUuid(envelope.nonce)
      || envelope.repository
        !== (env.GITHUB_REPOSITORY || "sbay-dev/ADG-Lang")
      || !Number.isSafeInteger(envelope.maxItems)
      || envelope.maxItems < 1
      || envelope.maxItems > PORTAL_ISSUE_REPORT_CLAIM_MAX_ITEMS
      || !/^[a-f0-9]{64}$/.test(signature || "")
      || !Number.isFinite(requestedAt)
      || Math.abs(now - requestedAt)
        > PORTAL_ISSUE_REPORT_CLAIM_WINDOW_MS) {
    throw new PublicError("صيغة طلب سحب البلاغات غير صالحة.", 400);
  }
}

function validatePortalIssueReportReceiptEnvelope(
  envelope,
  signature,
  env
) {
  const acceptedAt = Date.parse(envelope?.acceptedAtUtc);
  const now = Date.now();
  const repository =
    env.GITHUB_REPOSITORY || "sbay-dev/ADG-Lang";
  if (!envelope
      || envelope.schema !== PORTAL_ISSUE_REPORT_RECEIPT_SCHEMA
      || envelope.repository !== repository
      || !isUuid(envelope.nonce)
      || !isUuid(envelope.claimNonce)
      || !isUuid(envelope.reportId)
      || !/^[a-f0-9]{64}$/.test(envelope.contentSha256 || "")
      || !Number.isSafeInteger(envelope.issueNumber)
      || envelope.issueNumber < 1
      || !validPortalIssueUrl(
        envelope.issueUrl,
        repository,
        envelope.issueNumber
      )
      || !Number.isFinite(acceptedAt)
      || Math.abs(now - acceptedAt)
        > PORTAL_ISSUE_REPORT_CLAIM_WINDOW_MS
      || !/^[a-f0-9]{64}$/.test(signature || "")) {
    throw new PublicError("صيغة إيصال بلاغ المنصة غير صالحة.", 400);
  }
}

function validPortalIssueUrl(value, repository, issueNumber) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && parsed.hostname === "github.com"
      && parsed.port === ""
      && parsed.username === ""
      && parsed.password === ""
      && parsed.search === ""
      && parsed.hash === ""
      && parsed.pathname === `/${repository}/issues/${issueNumber}`;
  } catch {
    return false;
  }
}

function validateRepositoryEvidenceClaimEnvelope(envelope, signature, env) {
  const requestedAt = Date.parse(envelope?.requestedAtUtc);
  const now = Date.now();
  if (!envelope
      || envelope.schema !== "adg-msa-repository-evidence-claim-v1"
      || !isUuid(envelope.nonce)
      || envelope.repository
        !== (env.GITHUB_REPOSITORY || "sbay-dev/ADG-Lang")
      || !Number.isSafeInteger(envelope.maxItems)
      || envelope.maxItems < 1
      || envelope.maxItems > REPOSITORY_EVIDENCE_CLAIM_MAX_ITEMS
      || !/^[a-f0-9]{64}$/.test(signature || "")
      || !Number.isFinite(requestedAt)
      || Math.abs(now - requestedAt) > REPOSITORY_EVIDENCE_CLAIM_WINDOW_MS) {
    throw new PublicError("صيغة طلب سحب الدليل غير صالحة.", 400);
  }
}

function repositoryEvidenceClaimMarker(nonce) {
  return `repository-claim:${nonce}`;
}

async function selectClaimableRepositoryEvidenceRows(db, now, limit) {
  return db.prepare(
    `SELECT eo.id
       FROM evidence_outbox eo
       LEFT JOIN submissions s
         ON eo.kind = 'submission' AND s.receipt_id = eo.related_id
       LEFT JOIN discussion_comments dc
         ON eo.kind = 'comment' AND dc.comment_id = eo.related_id
       LEFT JOIN task_versions tv
         ON eo.kind = 'task-state' AND tv.id = eo.task_version_id
       LEFT JOIN evidence_repository_receipts err
         ON eo.kind = err.kind
        AND err.related_id = eo.related_id
        AND eo.kind IN ('submission', 'comment')
       LEFT JOIN task_state_repository_receipts tsrr
         ON eo.kind = 'task-state'
        AND tsrr.event_id = eo.related_id
       LEFT JOIN repository_receipts rr
         ON eo.kind = 'task-state' AND rr.nonce = eo.related_id
      WHERE eo.kind IN ('submission', 'comment', 'task-state')
        AND err.id IS NULL
        AND (eo.kind <> 'task-state'
          OR (tsrr.id IS NULL AND rr.id IS NULL))
        AND (
          eo.status IN ('pending', 'sent')
          OR (eo.status = 'sending' AND eo.next_attempt_at <= ?)
        )
        AND (eo.kind <> 'submission' OR s.receipt_id IS NOT NULL)
        AND (eo.kind <> 'submission' OR s.repository_status <> 'imported')
        AND (eo.kind <> 'comment' OR dc.comment_id IS NOT NULL)
        AND (eo.kind <> 'comment' OR dc.github_status <> 'imported')
        AND (eo.kind <> 'task-state' OR tv.id IS NOT NULL)
        AND (eo.kind <> 'task-state' OR tv.repository_status <> 'accepted')
      ORDER BY eo.created_at
      LIMIT ?`
  ).bind(now, limit).all();
}

async function selectClaimedRepositoryEvidenceRows(db, claimMarker, limit) {
  return db.prepare(
    `SELECT eo.kind, eo.related_id, eo.public_blob_name,
            eo.public_payload_json
       FROM evidence_outbox eo
       LEFT JOIN submissions s
         ON eo.kind = 'submission' AND s.receipt_id = eo.related_id
       LEFT JOIN discussion_comments dc
         ON eo.kind = 'comment' AND dc.comment_id = eo.related_id
       LEFT JOIN task_versions tv
         ON eo.kind = 'task-state' AND tv.id = eo.task_version_id
       LEFT JOIN evidence_repository_receipts err
         ON eo.kind = err.kind
        AND err.related_id = eo.related_id
        AND eo.kind IN ('submission', 'comment')
       LEFT JOIN task_state_repository_receipts tsrr
         ON eo.kind = 'task-state'
        AND tsrr.event_id = eo.related_id
       LEFT JOIN repository_receipts rr
         ON eo.kind = 'task-state' AND rr.nonce = eo.related_id
      WHERE eo.kind IN ('submission', 'comment', 'task-state')
        AND eo.status = 'sending'
        AND eo.last_error = ?
        AND err.id IS NULL
        AND (eo.kind <> 'task-state'
          OR (tsrr.id IS NULL AND rr.id IS NULL))
        AND (eo.kind <> 'submission' OR s.receipt_id IS NOT NULL)
        AND (eo.kind <> 'submission' OR s.repository_status <> 'imported')
        AND (eo.kind <> 'comment' OR dc.comment_id IS NOT NULL)
        AND (eo.kind <> 'comment' OR dc.github_status <> 'imported')
        AND (eo.kind <> 'task-state' OR tv.id IS NOT NULL)
        AND (eo.kind <> 'task-state' OR tv.repository_status <> 'accepted')
      ORDER BY eo.created_at
      LIMIT ?`
  ).bind(claimMarker, limit).all();
}

function validateEvidenceRepositoryReceiptEnvelope(
  envelope,
  signature,
  env
) {
  const acceptedAt = Date.parse(envelope.acceptedAtUtc);
  const now = Date.now();
  if (!isUuid(envelope.receiptId)
      || !["submission", "comment"].includes(envelope.evidenceKind)
      || !isUuid(envelope.relatedId)
      || envelope.repository
        !== (env.GITHUB_REPOSITORY || "sbay-dev/ADG-Lang")
      || !Number.isSafeInteger(envelope.prNumber)
      || envelope.prNumber < 1
      || !/^[a-f0-9]{40}$/.test(envelope.prMergeSha || "")
      || !/^[a-f0-9]{40}$/.test(envelope.importerCommitSha || "")
      || !/^[a-f0-9]{64}$/.test(signature || "")
      || !Number.isFinite(acceptedAt)
      || Math.abs(now - acceptedAt) > 24 * 60 * 60 * 1000) {
    throw new PublicError("صيغة إيصال الدليل غير صالحة.", 400);
  }
}

async function acceptEvidenceRepositoryReceipt(env, envelope, signature) {
  const table = envelope.evidenceKind === "submission"
    ? "submissions"
    : "discussion_comments";
  const idColumn = envelope.evidenceKind === "submission"
    ? "receipt_id"
    : "comment_id";
  const exists = await env.DB.prepare(
    `SELECT ${idColumn} AS id FROM ${table} WHERE ${idColumn} = ?`
  ).bind(envelope.relatedId).first();
  if (!exists) {
    throw new PublicError("الدليل المشار إليه غير موجود في المنصة.", 409);
  }
  const acceptedAt = Date.parse(envelope.acceptedAtUtc);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO evidence_repository_receipts
        (id, kind, related_id, repository, pr_number, pr_merge_sha,
         importer_commit_sha, envelope_json, signature_sha256,
         accepted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      envelope.receiptId,
      envelope.evidenceKind,
      envelope.relatedId,
      envelope.repository,
      envelope.prNumber,
      envelope.prMergeSha,
      envelope.importerCommitSha,
      JSON.stringify(envelope),
      signature,
      acceptedAt
    ),
    env.DB.prepare(
      envelope.evidenceKind === "submission"
        ? `UPDATE submissions
              SET repository_status = 'imported'
            WHERE receipt_id = ?`
        : `UPDATE discussion_comments
              SET github_status = 'imported'
            WHERE comment_id = ?`
    ).bind(envelope.relatedId),
    env.DB.prepare(
      `UPDATE evidence_outbox
          SET status = 'sent',
              sent_at = COALESCE(sent_at, ?),
              last_error = NULL
        WHERE kind = ? AND related_id = ?`
    ).bind(acceptedAt, envelope.evidenceKind, envelope.relatedId)
  ]);
  return json({
    accepted: true,
    receiptId: envelope.receiptId,
    evidenceKind: envelope.evidenceKind,
    relatedId: envelope.relatedId
  }, 202);
}

function validateTaskStateRepositoryReceiptEnvelope(
  envelope,
  signature,
  env
) {
  const acceptedAt = Date.parse(envelope.acceptedAtUtc);
  const now = Date.now();
  if (!isUuid(envelope.receiptId)
      || typeof envelope.taskVersionId !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
        .test(envelope.taskVersionId)
      || typeof envelope.eventId !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(envelope.eventId)
      || typeof envelope.toState !== "string"
      || !/^[a-z][a-z-]{1,31}$/.test(envelope.toState)
      || envelope.toState === "approved"
      || !Number.isSafeInteger(envelope.stateVersion)
      || envelope.stateVersion < 0
      || envelope.repository
        !== (env.GITHUB_REPOSITORY || "sbay-dev/ADG-Lang")
      || !Number.isSafeInteger(envelope.prNumber)
      || envelope.prNumber < 1
      || (envelope.issueNumber !== null
        && envelope.issueNumber !== undefined
        && (!Number.isSafeInteger(envelope.issueNumber)
          || envelope.issueNumber < 1))
      || !/^[a-f0-9]{40}$/.test(envelope.prMergeSha || "")
      || !/^[a-f0-9]{40}$/.test(envelope.importerCommitSha || "")
      || !/^[a-f0-9]{64}$/.test(signature || "")
      || !Number.isFinite(acceptedAt)
      || Math.abs(now - acceptedAt) > 24 * 60 * 60 * 1000) {
    throw new PublicError("صيغة إيصال حالة المهمة غير صالحة.", 400);
  }
}

async function acceptTaskStateRepositoryReceipt(
  env,
  envelope,
  signature
) {
  const binding = await env.DB.prepare(
    `SELECT eo.id AS outbox_id, eo.public_payload_json,
            ce.to_state
       FROM evidence_outbox eo
       JOIN consensus_events ce
         ON ce.id = eo.related_id
        AND ce.task_version_id = eo.task_version_id
      WHERE eo.kind = 'task-state'
        AND eo.task_version_id = ?
        AND eo.related_id = ?`
  ).bind(
    envelope.taskVersionId,
    envelope.eventId
  ).first();
  if (!binding) {
    throw new PublicError(
      "حدث حالة المهمة المشار إليه غير موجود في المنصة.",
      409
    );
  }
  let signedState;
  try {
    signedState = JSON.parse(binding.public_payload_json);
  } catch {
    throw new PublicError(
      "سجل حالة المهمة المخزن غير صالح.",
      409
    );
  }
  if (signedState?.schema !== "adg-msa-task-state-v1"
      || signedState.eventId !== envelope.eventId
      || signedState.nonce !== envelope.eventId
      || signedState.taskVersionId !== envelope.taskVersionId
      || signedState.toState !== envelope.toState
      || Number(signedState.stateVersion) !== envelope.stateVersion
      || binding.to_state !== envelope.toState) {
    throw new PublicError(
      "إيصال المستودع لا يطابق حدث حالة المهمة.",
      409
    );
  }

  const existing = await env.DB.prepare(
    `SELECT id, to_state, state_version, repository, pr_number,
            pr_merge_sha, importer_commit_sha, issue_number
       FROM task_state_repository_receipts
      WHERE task_version_id = ? AND event_id = ?`
  ).bind(
    envelope.taskVersionId,
    envelope.eventId
  ).first();
  if (existing
      && (existing.to_state !== envelope.toState
        || Number(existing.state_version) !== envelope.stateVersion
        || existing.repository !== envelope.repository
        || Number(existing.pr_number) !== envelope.prNumber
        || existing.pr_merge_sha !== envelope.prMergeSha
        || existing.importer_commit_sha !== envelope.importerCommitSha
        || (existing.issue_number === null
          ? null
          : Number(existing.issue_number))
          !== (envelope.issueNumber ?? null))) {
    throw new PublicError(
      "إيصال حالة المهمة يتعارض مع إيصال سابق.",
      409
    );
  }

  const acceptedAt = Date.parse(envelope.acceptedAtUtc);
  if (!existing) {
    await env.DB.prepare(
      `INSERT INTO task_state_repository_receipts
        (id, task_version_id, event_id, to_state, state_version,
         repository, pr_number, pr_merge_sha, importer_commit_sha,
         issue_number, envelope_json, signature_sha256, accepted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      envelope.receiptId,
      envelope.taskVersionId,
      envelope.eventId,
      envelope.toState,
      envelope.stateVersion,
      envelope.repository,
      envelope.prNumber,
      envelope.prMergeSha,
      envelope.importerCommitSha,
      envelope.issueNumber ?? null,
      JSON.stringify(envelope),
      signature,
      acceptedAt
    ).run();
  }
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE evidence_outbox
          SET status = 'sent',
              sent_at = COALESCE(sent_at, ?),
              last_error = NULL
        WHERE kind = 'task-state'
          AND task_version_id = ?
          AND related_id = ?`
    ).bind(
      acceptedAt,
      envelope.taskVersionId,
      envelope.eventId
    ),
    env.DB.prepare(
      `UPDATE task_versions
          SET github_issue_number = COALESCE(?, github_issue_number),
              updated_at = ?
        WHERE id = ?`
    ).bind(
      envelope.issueNumber ?? null,
      Date.now(),
      envelope.taskVersionId
    )
  ]);
  return json({
    accepted: true,
    receiptId: existing?.id ?? envelope.receiptId,
    taskVersionId: envelope.taskVersionId,
    eventId: envelope.eventId,
    state: envelope.toState,
    stateVersion: envelope.stateVersion
  }, 202);
}

function validateRepositoryReceiptEnvelope(envelope, signature, env) {
  if (!envelope || envelope.schema !== "adg-msa-repository-receipt-v1"
      || !isUuid(envelope.receiptId)
      || typeof envelope.taskVersionId !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
        .test(envelope.taskVersionId)
      || typeof envelope.roundId !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(envelope.roundId)
      || typeof envelope.nonce !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(envelope.nonce)
      || !/^[a-f0-9]{64}$/.test(envelope.finalMerkleRoot || "")
      || !/^[a-f0-9]{40}$/.test(envelope.prMergeSha || "")
      || !/^[a-f0-9]{40}$/.test(envelope.importerCommitSha || "")
      || !Number.isSafeInteger(envelope.prNumber)
      || envelope.prNumber < 1
      || (envelope.issueNumber !== null
        && envelope.issueNumber !== undefined
        && (!Number.isSafeInteger(envelope.issueNumber)
          || envelope.issueNumber < 1))
      || envelope.repository
        !== (env.GITHUB_REPOSITORY || "sbay-dev/ADG-Lang")
      || !/^[a-f0-9]{64}$/.test(signature || "")) {
    throw new PublicError("صيغة إيصال المستودع غير صالحة.", 400);
  }
  const receivedAt = Date.parse(envelope.receivedAtUtc);
  const acceptedAt = Date.parse(envelope.acceptedAtUtc);
  const now = Date.now();
  if (!Number.isFinite(receivedAt)
      || !Number.isFinite(acceptedAt)
      || Math.abs(now - receivedAt) > 24 * 60 * 60 * 1000
      || acceptedAt < receivedAt
      || acceptedAt > now + 5 * 60 * 1000) {
    throw new PublicError("توقيت إيصال المستودع غير صالح.", 400);
  }
}

async function attemptPublishTask(env, taskVersionId) {
  let task = await getConsensusTask(env.DB, taskVersionId);
  if (!task || task.state !== "approved"
      || task.repository_status !== "accepted"
      || !task.appeal_deadline_at
      || Number(task.appeal_deadline_at) > Date.now()) {
    return task;
  }
  const pendingAppeal = await env.DB.prepare(
    `SELECT id FROM appeals
      WHERE task_version_id = ? AND status = 'pending'
      LIMIT 1`
  ).bind(taskVersionId).first();
  if (pendingAppeal) return task;
  const final = await env.DB.prepare(
    `SELECT primary_receipt_id, round_id, final_merkle_root
       FROM final_results
      WHERE task_version_id = ? AND status = 'active'
        AND primary_receipt_id = ?`
  ).bind(taskVersionId, task.active_final_receipt_id).first();
  if (!final) return task;
  const receipt = await env.DB.prepare(
    `SELECT id, pr_number, pr_merge_sha, importer_commit_sha
       FROM repository_receipts
      WHERE task_version_id = ? AND round_id = ?
        AND final_merkle_root = ?
      LIMIT 1`
  ).bind(
    taskVersionId,
    final.round_id,
    final.final_merkle_root
  ).first();
  if (!receipt) return task;
  try {
    task = await transitionConsensusTask(env.DB, task, {
      toState: "published",
      roundId: final.round_id,
      eventType: "repository-publication-confirmed",
      reasonCode: "signed-repository-receipt",
      evidence: {
        repositoryReceiptId: receipt.id,
        finalReceiptId: final.primary_receipt_id,
        finalMerkleRoot: final.final_merkle_root,
        pullRequestNumber: Number(receipt.pr_number),
        mergeCommitSha: receipt.pr_merge_sha,
        importerCommitSha: receipt.importer_commit_sha
      },
      activeFinalReceiptId: final.primary_receipt_id,
      requirePublicationReady: true,
      publicationGuardAt: Date.now(),
      idempotencyKey: `publish:${taskVersionId}:${receipt.id}`
    });
  } catch (error) {
    if (!(error instanceof ConsensusConflict)) throw error;
    return getConsensusTask(env.DB, taskVersionId);
  }
  await env.DB.prepare(
    `UPDATE final_results
        SET published_at = ?
      WHERE primary_receipt_id = ? AND status = 'active'`
  ).bind(Date.now(), final.primary_receipt_id).run();
  await ensureTaskStateEvidence(env, task);
  await queueGovernanceNotifications(
    env,
    task.id,
    "result-published",
    {
      taskVersionId: task.id,
      packetId: task.packet_id,
      repositoryReceiptId: receipt.id
    },
    `result-published:${receipt.id}`
  );
  return task;
}

async function createDiscussionComment(request, env, body) {
  const account = await requireSession(request, env);
  const sourceReceiptId = String(body?.sourceReceiptId || "");
  if (!isUuid(sourceReceiptId)) {
    throw new PublicError("معرف مساهمتك المكتملة غير صالح.", 400);
  }
  let input;
  try {
    input = validateDiscussionInput(body);
  } catch (error) {
    throw new PublicError(error.message, 400);
  }
  const source = await env.DB.prepare(
    `SELECT receipt_id, user_id, packet_id, participant_pseudonym,
            artifact_sha256, artifact_type, task_version_id, round_id
       FROM submissions
      WHERE receipt_id = ? AND user_id = ? AND artifact_json IS NOT NULL`
  ).bind(sourceReceiptId, account.user_id).first();
  if (!source) {
    throw new PublicError(
      "لا يمكن المشاركة في النقاش قبل إتمام المهمة.",
      403
    );
  }
  const access = await env.DB.prepare(
    `SELECT first_viewed_at
       FROM result_access
      WHERE user_id = ? AND source_receipt_id = ?
        AND task_version_id = ? AND round_id = ?`
  ).bind(
    account.user_id,
    sourceReceiptId,
    source.task_version_id,
    source.round_id
  ).first();
  if (!access) {
    throw new PublicError(
      "افتح النتائج السابقة أولًا قبل إضافة تعليق.",
      409
    );
  }
  const recent = await env.DB.prepare(
    `SELECT COUNT(*) AS count
       FROM discussion_comments
      WHERE author_user_id = ? AND created_at >= ?`
  ).bind(account.user_id, Date.now() - 24 * 60 * 60 * 1000).first();
  if (Number(recent?.count || 0) >= 20) {
    throw new PublicError(
      "بلغت الحد اليومي للتعليقات. عد لاحقًا لاستكمال النقاش.",
      429
    );
  }

  const referencedIds = [
    ...(input.targetReceiptId ? [input.targetReceiptId] : []),
    ...input.mentionedReceiptIds,
    ...input.referencedReceiptIds
  ];
  const relatedRows = await findTaskSubmissions(
    env.DB,
    source.task_version_id,
    source.round_id,
    referencedIds
  );
  const related = new Map(
    relatedRows.map(row => [row.receipt_id, row])
  );
  for (const receiptId of new Set(referencedIds)) {
    if (!related.has(receiptId)) {
      throw new PublicError(
        "إحدى النتائج المشار إليها لا تنتمي إلى هذه المهمة.",
        400
      );
    }
  }
  if (input.targetReceiptId === sourceReceiptId) {
    throw new PublicError(
      "استخدم توضيحًا عامًا بدل استهداف نتيجتك نفسها.",
      400
    );
  }
  if (input.parentCommentId) {
    const parent = await env.DB.prepare(
      `SELECT comment_id
         FROM discussion_comments
        WHERE comment_id = ? AND task_version_id = ? AND round_id = ?`
    ).bind(
      input.parentCommentId,
      source.task_version_id,
      source.round_id
    ).first();
    if (!parent) {
      throw new PublicError("التعليق المراد الرد عليه غير متاح.", 400);
    }
  }

  const mentions = input.mentionedReceiptIds
    .filter(receiptId => receiptId !== sourceReceiptId)
    .map(receiptId => ({
      receiptId,
      pseudonym: related.get(receiptId).participant_pseudonym
    }));
  const resultReferences = input.referencedReceiptIds.map(receiptId => {
    const row = related.get(receiptId);
    return {
      receiptId,
      artifactSha256: row.artifact_sha256,
      kind: row.artifact_type,
      pseudonym: row.participant_pseudonym,
      isFinal: row.artifact_type === "adjudication-package"
        && row.final_status === "active"
    };
  });
  if (input.category === "final-result"
      && !resultReferences.some(reference => reference.isFinal)) {
    throw new PublicError(
      "تعليق النتيجة النهائية يجب أن يشير إلى قرار تحكيم نهائي.",
      400
    );
  }

  const commentId = crypto.randomUUID();
  const receivedAtUtc = new Date().toISOString();
  const target = input.targetReceiptId
    ? related.get(input.targetReceiptId)
    : null;
  const publicEnvelope = {
    schema: "adg-msa-github-comment-v1",
    commentId,
    participantPseudonym: source.participant_pseudonym,
    receivedAtUtc,
    packetId: source.packet_id,
    taskVersionId: source.task_version_id,
    roundId: source.round_id,
    sourceReceiptId,
    targetReceiptId: input.targetReceiptId,
    targetArtifactSha256: target?.artifact_sha256 ?? null,
    parentCommentId: input.parentCommentId,
    category: input.category,
    body: input.body,
    location: {
      sentenceId: input.sentenceId,
      tokenId: input.tokenId
    },
    mentions,
    resultReferences,
    attestation: {
      authoredAfterIndependentSubmission: true,
      publicTechnicalDiscussion: true
    },
    claimBoundaries: [
      "The author identity is private and represented only by a pseudonym.",
      "A disagreement is not an established error without an approved final result.",
      "The comment remains untrusted until repository validation passes."
    ]
  };
  const hmacKey = await getVaultSecret(
    env.SUBMISSION_HMAC_SECRET_NAME,
    env
  );
  const signedEnvelope = {
    ...publicEnvelope,
    hmacSha256: await hmacSha256(
      hmacKey,
      JSON.stringify(publicEnvelope)
    )
  };
  const evidencePayload =
    JSON.stringify(signedEnvelope, null, 2) + "\n";
  const createdAt = Date.parse(receivedAtUtc);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO discussion_comments
        (comment_id, packet_id, author_user_id, participant_pseudonym,
         source_receipt_id, target_receipt_id, parent_comment_id,
         category, body, sentence_id, token_id, mentions_json,
         references_json, github_status, created_at,
         task_version_id, round_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               'pending-validation', ?, ?, ?)`
    ).bind(
      commentId,
      source.packet_id,
      account.user_id,
      source.participant_pseudonym,
      sourceReceiptId,
      input.targetReceiptId,
      input.parentCommentId,
      input.category,
      input.body,
      input.sentenceId,
      input.tokenId,
      JSON.stringify(mentions),
      JSON.stringify(resultReferences),
      createdAt,
      source.task_version_id,
      source.round_id
    ),
    env.DB.prepare(
      `INSERT INTO evidence_outbox
        (id, kind, task_version_id, related_id, public_blob_name,
         public_payload_json, dedupe_key, status, attempts,
         next_attempt_at, created_at)
       VALUES (?, 'comment', ?, ?, ?, ?, ?,
               'pending', 0, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      source.task_version_id,
      commentId,
      `comment-${commentId}.json`,
      evidencePayload,
      `comment:${commentId}`,
      createdAt,
      createdAt
    )
  ]);

  await queueDiscussionNotifications(
    env,
    account.user_id,
    source,
    commentId,
    input.body,
    target,
    mentions,
    related
  );

  return json({
    accepted: true,
    comment: {
      ...publicEnvelope,
      githubStatus: "pending-validation"
    }
  }, 202);
}

async function findTaskSubmissions(
  db,
  taskVersionId,
  roundId,
  receiptIds
) {
  const unique = [...new Set(receiptIds.filter(Boolean))];
  if (unique.length === 0) return [];
  const placeholders = unique.map(() => "?").join(", ");
  const result = await db.prepare(
    `SELECT s.receipt_id, s.user_id, s.packet_id, s.role,
            s.participant_pseudonym, s.artifact_sha256, s.artifact_type,
            s.repository_status, u.consent_json,
            f.status AS final_status
       FROM submissions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN final_results f
         ON f.primary_receipt_id = s.receipt_id
      WHERE s.task_version_id = ?
        AND s.round_id = ?
        AND s.receipt_id IN (${placeholders})`
  ).bind(taskVersionId, roundId, ...unique).all();
  return result.results || [];
}

function publicResultRow(row, includeArtifact) {
  const artifact = includeArtifact || row.role === "operational-test"
    ? JSON.parse(row.artifact_json)
    : null;
  const value = {
    receiptId: row.receipt_id,
    packetId: row.role === "operational-test"
      ? artifact.packet.packetId
      : row.packet_id,
    role: row.role,
    participantPseudonym: row.participant_pseudonym,
    artifactType: row.artifact_type,
    artifactSha256: row.artifact_sha256,
    isFinal: row.artifact_type === "adjudication-package"
      && row.final_status === "active",
    githubStatus: row.repository_status,
    submittedAtUtc: new Date(row.submitted_at).toISOString()
  };
  if (includeArtifact) value.artifact = artifact;
  return value;
}

function publicCommentRow(row) {
  const redacted = row.moderation_state === "redacted";
  return {
    commentId: row.comment_id,
    participantPseudonym: row.participant_pseudonym,
    sourceReceiptId: row.source_receipt_id,
    targetReceiptId: row.target_receipt_id,
    parentCommentId: row.parent_comment_id,
    category: row.category,
    body: redacted
      ? "حُجب نص هذا التعليق بقرار إشراف موثق."
      : row.body,
    location: {
      sentenceId: row.sentence_id,
      tokenId: row.token_id == null ? null : Number(row.token_id)
    },
    mentions: redacted ? [] : JSON.parse(row.mentions_json),
    resultReferences: redacted
      ? []
      : JSON.parse(row.references_json),
    githubStatus: row.github_status,
    moderationState: row.moderation_state || "visible",
    createdAtUtc: new Date(row.created_at).toISOString()
  };
}

async function logout(request, env) {
  const token = cookieValue(request, SESSION_COOKIE_NAME);
  if (token) {
    await env.DB.prepare(
      "DELETE FROM sessions WHERE token_hash = ?"
    ).bind(await sha256Hex(token)).run();
  }
  return json(
    { authenticated: false },
    200,
    { "set-cookie": clearSessionCookie(env) }
  );
}

async function saveDraft(request, env, body) {
  const account = await requireSession(request, env);
  const key = validateDraftKey(body?.packetId, body?.role);
  if (!body?.draft || typeof body.draft !== "object"
      || Array.isArray(body.draft)
      || body.draft.schema !== "adg-msa-portal-draft-v1") {
    throw new PublicError("بنية المسودة غير صالحة.", 400);
  }
  const draftText = JSON.stringify(body.draft);
  if (new TextEncoder().encode(draftText).length
      > MAX_ACCOUNT_BODY_BYTES) {
    throw new PublicError("حجم المسودة أكبر من الحد المسموح.", 413);
  }
  const secret = await getVaultSecret(
    env.ENTITYCRYPT_MASTER_KEY_SECRET_NAME,
    env
  );
  const {
    savedAtUtc: _draftTimestamp,
    ...stableDraftContent
  } = body.draft;
  const contentSha256 = await sha256Hex(
    JSON.stringify(stableDraftContent)
  );
  const existing = await env.DB.prepare(
    `SELECT ciphertext, content_sha256, updated_at,
            completion_percent, completed_fields, total_fields
       FROM drafts
      WHERE user_id = ? AND packet_id = ? AND role = ?`
  ).bind(account.user_id, key.packetId, key.role).first();
  if (existing?.content_sha256 === contentSha256) {
    return json({
      saved: true,
      unchanged: true,
      revisionPreserved: false,
      progressPercent: Number(existing.completion_percent),
      updatedAtUtc: new Date(existing.updated_at).toISOString()
    });
  }
  const ciphertext = await encryptEntityCrypt(draftText, secret);
  const updatedAt = Date.now();
  const progress = calculateDraftProgress(body.draft);
  const writes = [];
  if (existing) {
    writes.push(env.DB.prepare(
      `INSERT INTO draft_revisions
        (id, user_id, packet_id, role, ciphertext, content_sha256,
         completion_percent, completed_fields, total_fields, saved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      account.user_id,
      key.packetId,
      key.role,
      existing.ciphertext,
      existing.content_sha256,
      Number(existing.completion_percent || 0),
      Number(existing.completed_fields || 0),
      Number(existing.total_fields || 0),
      Number(existing.updated_at)
    ));
  }
  writes.push(env.DB.prepare(
    `INSERT INTO drafts
      (user_id, packet_id, role, ciphertext, content_sha256, updated_at,
       completion_percent, completed_fields, total_fields, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, packet_id, role)
     DO UPDATE SET ciphertext = excluded.ciphertext,
                   content_sha256 = excluded.content_sha256,
                   updated_at = excluded.updated_at,
                   completion_percent = excluded.completion_percent,
                   completed_fields = excluded.completed_fields,
                   total_fields = excluded.total_fields`
  ).bind(
    account.user_id,
    key.packetId,
    key.role,
    ciphertext,
    contentSha256,
    updatedAt,
    progress.percentage,
    progress.completed,
    progress.total,
    updatedAt
  ));
  const results = await env.DB.batch(writes);
  if (results.length !== writes.length
      || results.some(result => Number(result.meta?.changes || 0) !== 1)) {
    throw new PublicError("تعذر تثبيت المسودة ونسختها السابقة.", 409);
  }
  return json({
    saved: true,
    unchanged: false,
    revisionPreserved: Boolean(existing),
    progressPercent: progress.percentage,
    updatedAtUtc: new Date(updatedAt).toISOString()
  });
}

async function loadDraft(request, env, url) {
  const account = await requireSession(request, env);
  const key = validateDraftKey(
    url.searchParams.get("packetId"),
    url.searchParams.get("role")
  );
  const row = await env.DB.prepare(
    `SELECT ciphertext, updated_at
       FROM drafts
      WHERE user_id = ? AND packet_id = ? AND role = ?`
  ).bind(account.user_id, key.packetId, key.role).first();
  if (!row) {
    return json({ found: false });
  }
  const secret = await getVaultSecret(
    env.ENTITYCRYPT_MASTER_KEY_SECRET_NAME,
    env
  );
  const plaintext = await decryptEntityCrypt(row.ciphertext, secret);
  return json({
    found: true,
    draft: JSON.parse(plaintext),
    updatedAtUtc: new Date(row.updated_at).toISOString()
  });
}

async function deleteDraft(request, env, url) {
  const account = await requireSession(request, env);
  const key = validateDraftKey(
    url.searchParams.get("packetId"),
    url.searchParams.get("role")
  );
  await env.DB.prepare(
    `DELETE FROM drafts
      WHERE user_id = ? AND packet_id = ? AND role = ?`
  ).bind(account.user_id, key.packetId, key.role).run();
  return json({ deleted: true });
}

export function calculateDraftProgress(draft) {
  if (draft.role === "ratification") {
    const value = (draft.fields || [])
      .find(field => field.kind === "ratification") || {};
    const completed = [
      isUuid(value.primaryReceiptId),
      ["agree", "disagree", "recuse"].includes(value.decision),
      String(value.rationale || "").trim().length >= 20
    ].filter(Boolean).length;
    return {
      completed,
      total: 3,
      percentage: Math.round(completed / 3 * 100)
    };
  }
  let total = 0;
  let completed = 0;
  for (const sentence of draft.fields || []) {
    for (const value of [sentence.structural, sentence.predicate]) {
      total += 1;
      if (hasDraftValue(value)) completed += 1;
    }
    for (const token of sentence.tokens || []) {
      const values = [
        token.upos,
        token.head,
        token.relation,
        token.irabCategory
      ];
      if (token.irabCategory !== "_") {
        values.push(token.irabHead);
      }
      for (const value of values) {
        total += 1;
        if (hasDraftValue(value)) completed += 1;
      }
    }
  }
  return {
    completed,
    total,
    percentage: total === 0
      ? 0
      : Math.round(completed / total * 100)
  };
}

function hasDraftValue(value) {
  return value !== null
    && value !== undefined
    && String(value).trim() !== "";
}

async function listDrafts(request, env) {
  const account = await requireSession(request, env);
  const result = await env.DB.prepare(
    `SELECT d.packet_id, d.role, d.completion_percent, d.updated_at,
            (
              SELECT COUNT(*)
                FROM draft_revisions dr
               WHERE dr.user_id = d.user_id
                 AND dr.packet_id = d.packet_id
                 AND dr.role = d.role
            ) AS revision_count
       FROM drafts d
      WHERE user_id = ?
      ORDER BY updated_at DESC
      LIMIT 20`
  ).bind(account.user_id).all();
  return json({
    drafts: (result.results || []).map(row => ({
      packetId: row.packet_id,
      role: row.role,
      progressPercent: Number(row.completion_percent),
      revisionCount: Number(row.revision_count || 0),
      updatedAtUtc: new Date(row.updated_at).toISOString()
    }))
  });
}

async function readJsonBody(request) {
  const contentLength = Number(
    request.headers.get("content-length") || 0
  );
  if (contentLength > MAX_ACCOUNT_BODY_BYTES) {
    throw new PublicError("حجم الطلب أكبر من الحد المسموح.", 413);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length
      > MAX_ACCOUNT_BODY_BYTES) {
    throw new PublicError("حجم الطلب أكبر من الحد المسموح.", 413);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new PublicError("بيانات الطلب غير صالحة.", 400);
  }
}

export function validateAccountProfile(profile) {
  if (!profile || typeof profile !== "object"
      || Array.isArray(profile)) {
    throw new PublicError("بيانات المحكّم غير صالحة.", 400);
  }
  const fullName = normalizedText(
    profile.fullName,
    2,
    120,
    "الاسم الكامل"
  );
  const email = verifiedEmail(profile.email);
  const experienceYears = Number(profile.experienceYears);
  const specialization = normalizedText(
    profile.specialization,
    2,
    40,
    "مجال التخصص"
  );
  const specializations = new Set([
    "grammar",
    "morphology",
    "arabic-education",
    "quranic-arabic",
    "linguistics",
    "other"
  ]);
  if (!Number.isInteger(experienceYears)
      || experienceYears < 0 || experienceYears > 80) {
    throw new PublicError("سنوات الخبرة غير صالحة.", 400);
  }
  if (!specializations.has(specialization)) {
    throw new PublicError("مجال التخصص غير صالح.", 400);
  }
  const affiliation = profile.affiliation == null
    || String(profile.affiliation).trim() === ""
    ? null
    : normalizedText(profile.affiliation, 1, 160, "الجهة العلمية");
  const socialAccounts = validateSocialAccounts(profile.socialAccounts);
  return {
    fullName,
    email,
    experienceYears,
    specialization,
    affiliation,
    socialAccounts
  };
}

function validateSocialAccounts(value) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new PublicError("حسابات التواصل غير صالحة.", 400);
  }
  const unknownKeys = Object.keys(value).filter(
    key => !SOCIAL_ACCOUNT_KEYS.has(key)
  );
  if (unknownKeys.length !== 0) {
    throw new PublicError("تحتوي حسابات التواصل حقولًا غير معروفة.", 400);
  }
  const normalized = {};
  for (const key of SOCIAL_ACCOUNT_KEYS) {
    if (key === "otherPlatform") continue;
    const raw = value[key];
    if (raw == null || String(raw).trim() === "") continue;
    const handle = String(raw).trim().replace(/^@+/, "");
    if (!/^[^\s/@?#]{1,80}$/u.test(handle)) {
      throw new PublicError(
        "اسم المستخدم في حسابات التواصل غير صالح.",
        400
      );
    }
    normalized[key] = handle;
  }
  if (normalized.whatsapp
      && !/^[a-z][a-z0-9._]{2,34}$/.test(normalized.whatsapp)) {
    throw new PublicError("اسم مستخدم واتساب غير صالح.", 400);
  }
  const otherPlatform = value.otherPlatform == null
    || String(value.otherPlatform).trim() === ""
    ? null
    : normalizedText(
      value.otherPlatform,
      2,
      40,
      "اسم المنصة الأخرى"
    );
  if (Boolean(otherPlatform) !== Boolean(normalized.otherUsername)) {
    throw new PublicError(
      "يجب إدخال اسم المنصة الأخرى واسم المستخدم معًا.",
      400
    );
  }
  if (otherPlatform) normalized.otherPlatform = otherPlatform;
  return normalized;
}

export function validateAccountConsent(consent) {
  if (!consent || consent.identityStorage !== true) {
    throw new PublicError(
      "الموافقة على حفظ بيانات الحساب مطلوبة.",
      400
    );
  }
  return {
    identityStorage: true,
    futureContact: consent.futureContact === true,
    discussionNotifications:
      consent.discussionNotifications === true
  };
}

function validateDraftKey(packetId, role) {
  const normalizedPacketId = normalizedText(
    packetId,
    1,
    160,
    "معرف المهمة"
  );
  if (!["A", "B", "adjudication", "ratification"].includes(role)) {
    throw new PublicError("دور التحكيم غير صالح.", 400);
  }
  return { packetId: normalizedPacketId, role };
}

function normalizedText(value, minimum, maximum, label) {
  if (typeof value !== "string") {
    throw new PublicError(`${label} غير صالح.`, 400);
  }
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new PublicError(`${label} غير صالح.`, 400);
  }
  return normalized;
}

function requiredId(value, label) {
  if (!isUuid(value)) {
    throw new PublicError(`${label} غير صالح.`, 400);
  }
  return value;
}

function relyingParty(env) {
  let origin;
  try {
    origin = new URL(env.ALLOWED_ORIGIN);
  } catch {
    throw new Error("ALLOWED_ORIGIN is not a valid URL.");
  }
  if (origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("ALLOWED_ORIGIN must not contain a path.");
  }
  return {
    origin: origin.origin,
    rpId: origin.hostname
  };
}

async function takeChallenge(db, id, kind) {
  const row = await db.prepare(
    `SELECT id, challenge, kind, user_id, profile_ciphertext,
            consent_json, email_verification_id, verified_email_hash,
            expires_at
       FROM webauthn_challenges
      WHERE id = ? AND kind = ?`
  ).bind(id, kind).first();
  if (!row) {
    throw new PublicError("انتهت محاولة التحقق أو استُخدمت.", 400);
  }
  const deletion = await db.prepare(
    "DELETE FROM webauthn_challenges WHERE id = ? AND kind = ?"
  ).bind(id, kind).run();
  if (Number(deletion.meta?.changes || 0) !== 1
      || Number(row.expires_at) <= Date.now()) {
    throw new PublicError("انتهت محاولة التحقق أو استُخدمت.", 400);
  }
  return row;
}

async function pruneAuthRecords(db, now) {
  await db.batch([
    db.prepare(
      `UPDATE email_verifications
          SET consumed_at = ?
        WHERE consumed_at IS NULL
          AND (
            expires_at <= ?
            OR (token_expires_at IS NOT NULL AND token_expires_at <= ?)
            OR reservation_id IN (
              SELECT id
                FROM webauthn_challenges
               WHERE expires_at <= ?
            )
          )`
    ).bind(now, now, now, now),
    db.prepare(
      "DELETE FROM webauthn_challenges WHERE expires_at <= ?"
    ).bind(now),
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
    db.prepare(
      `DELETE FROM email_verifications
        WHERE created_at <= ?`
    ).bind(now - 7 * 24 * 60 * 60 * 1000)
  ]);
}

async function createSessionRecord(userId, now) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = base64UrlFromBytes(bytes);
  return {
    token,
    tokenHash: await sha256Hex(token),
    userId,
    expiresAt: now + SESSION_TTL_MS
  };
}

async function requireSession(request, env) {
  const token = cookieValue(request, SESSION_COOKIE_NAME);
  if (!token) {
    throw new PublicError("سجّل الدخول أولًا لمتابعة المسودة.", 401);
  }
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT s.user_id, s.expires_at, u.profile_ciphertext,
            u.consent_json, u.verified_email_hash,
            (
              SELECT status
                FROM identity_erasure_requests
               WHERE user_id = u.id AND status = 'pending'
               LIMIT 1
            ) AS erasure_status
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`
  ).bind(tokenHash).first();
  if (!row || Number(row.expires_at) <= Date.now()) {
    if (row) {
      await env.DB.prepare(
        "DELETE FROM sessions WHERE token_hash = ?"
      ).bind(tokenHash).run();
    }
    throw new PublicError("انتهت جلسة الحساب. سجّل الدخول مجددًا.", 401);
  }
  return row;
}

function cookieValue(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) {
      continue;
    }
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return null;
}

function sessionCookie(env, token) {
  const secure = cookieSecureAttribute(env);
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; `
    + `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; Path=/; `
    + `HttpOnly; SameSite=Strict${secure}`;
}

function clearSessionCookie(env) {
  const secure = cookieSecureAttribute(env);
  return `${SESSION_COOKIE_NAME}=; Max-Age=0; Path=/; `
    + `HttpOnly; SameSite=Strict${secure}`;
}

function cookieSecureAttribute(env) {
  const origin = new URL(env.ALLOWED_ORIGIN);
  return origin.protocol === "https:" ? "; Secure" : "";
}

export function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function base64UrlFromBytes(value) {
  return bytesToBase64(value)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

async function receiveSubmission(request, env) {
  if (String(env.SUBMISSION_ENABLED).toLowerCase() !== "true") {
    throw new PublicError(
      "قناة الإرسال متوقفة مؤقتًا، ويمكن حفظ نسخة محلية.",
      503
    );
  }
  const account = await requireSession(request, env);
  if (!account.verified_email_hash) {
    throw new PublicError(
      "وثّق بريد الحساب قبل إرسال التحكيم.",
      403
    );
  }
  if (account.erasure_status === "pending") {
    throw new PublicError(
      "لا يمكن إنشاء مساهمة جديدة بعد تسجيل طلب محو الهوية.",
      409
    );
  }

  const maxBytes = Number(env.MAX_SUBMISSION_BYTES || 900000);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxBytes) {
    throw new PublicError("حجم التقييم أكبر من الحد المسموح.", 413);
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) {
    throw new PublicError("حجم التقييم أكبر من الحد المسموح.", 413);
  }

  let submission;
  try {
    submission = JSON.parse(text);
  } catch {
    throw new PublicError("بيانات التقييم غير صالحة.", 400);
  }
  validateSubmission(submission);
  await validateArtifactForServer(submission.artifact);
  const task = await submissionTask(submission.artifact);
  const repositoryCatalog = await env.DB.prepare(
    `SELECT lane
       FROM repository_task_packets
      WHERE task_version_id = ?`
  ).bind(task.identity.id).first();
  if (repositoryCatalog?.lane === "operational-test") {
    throw new PublicError(
      "هذه الحزمة تشغيلية معزولة؛ أرسلها عبر مسار الاختبار التشغيلي.",
      409
    );
  }
  const resultAccess = await env.DB.prepare(
    `SELECT first_viewed_at
       FROM result_access
      WHERE user_id = ? AND task_version_id = ?`
  ).bind(account.user_id, task.identity.id).first();
  if (resultAccess && ["A", "B"].includes(task.role)) {
    throw new PublicError(
      "اطلعت على نتائج هذه المهمة؛ لا يمكن بدء تحكيم مستقل جديد لها.",
      409
    );
  }

  const turnstile = await verifyTurnstile(
    submission.turnstileToken,
    request.headers.get("CF-Connecting-IP"),
    env
  );
  if (!turnstile.success) {
    throw new PublicError("لم ينجح اختبار الحماية. أعد المحاولة.", 403);
  }

  const actualArtifactSha256 = await sha256Hex(
    JSON.stringify(submission.artifact)
  );
  if (actualArtifactSha256 !== submission.artifactSha256) {
    throw new PublicError("تغيّرت نتيجة التقييم أثناء الإرسال.", 400);
  }
  const entityCryptMasterKey = await getVaultSecret(
    env.ENTITYCRYPT_MASTER_KEY_SECRET_NAME,
    env
  );
  const storedProfile = JSON.parse(await decryptEntityCrypt(
    account.profile_ciphertext,
    entityCryptMasterKey
  ));
  const storedConsent = JSON.parse(account.consent_json);
  const priorParticipation = await env.DB.prepare(
    `SELECT id
       FROM task_participations
      WHERE user_id = ?
        AND (task_version_id = ? OR holdout_id = ?)
      LIMIT 1`
  ).bind(
    account.user_id,
    task.identity.id,
    task.identity.holdoutId
  ).first();
  if (priorParticipation) {
    throw new PublicError(
      "سبق أن شارك هذا الحساب في المهمة أو عائلة الحجز نفسها.",
      409
    );
  }

  let consensusTask;
  try {
    const existingTask = await getConsensusTask(
      env.DB,
      task.identity.id
    );
    if (!existingTask
        && !["A", "B"].includes(task.consensusRole)) {
      throw new PublicError(
        "يجب تثبيت التحكيمين المستقلين قبل هذا الدور.",
        409
      );
    }
    consensusTask = await ensureConsensusTask(
      env.DB,
      task.packet,
      task.packetRoot,
      Date.now()
    );
  } catch (error) {
    if (error instanceof ConsensusConflict) {
      throw new PublicError(error.message, 409);
    }
    throw error;
  }
  const round = await getCurrentConsensusRound(env.DB, consensusTask);
  const repositoryAssignment = await requiredRepositoryTaskAssignment(
    env.DB,
    account,
    task,
    consensusTask,
    round
  );
  const roleContext = await validateConsensusEligibility(
    env,
    account,
    task,
    consensusTask,
    round,
    submission.artifact
  );
  const receiptId = crypto.randomUUID();
  const participantPseudonym = `adg-${receiptId.slice(0, 12)}`;
  const receivedAtUtc = new Date().toISOString();
  const privateIdentity = {
    schema: "adg-msa-private-participant-identity-v1",
    receiptId,
    participantId: submission.participantId,
    accountUserId: account.user_id,
    receivedAtUtc,
    profile: storedProfile,
    consent: storedConsent,
    artifactSha256: actualArtifactSha256,
    clientVersion: submission.clientVersion
  };
  const publicEnvelope = {
    schema: "adg-msa-github-inbox-v1",
    receiptId,
    participantPseudonym,
    receivedAtUtc,
    artifactType: submission.artifactType,
    artifactSha256: actualArtifactSha256,
    attestation: submission.attestation,
    artifact: submission.artifact,
    claimBoundaries: [
      "Participant identity is stored separately and is not present here.",
      "This submission is untrusted until repository validation passes.",
      "Pilot submissions cannot become final MSA readiness evidence."
    ]
  };

  const hmacKey = await getVaultSecret(
    env.SUBMISSION_HMAC_SECRET_NAME,
    env
  );
  const signedEnvelope = {
    ...publicEnvelope,
    hmacSha256: await hmacSha256(
      hmacKey,
      JSON.stringify(publicEnvelope))
  };

  const encryptedIdentity = await encryptEntityCrypt(
    JSON.stringify(privateIdentity),
    entityCryptMasterKey
  );
  const identityEnvelope = {
    schema: "adg-entitycrypt-data-room-envelope-v1",
    entityCryptProfile: "Matryoshka.MK1.AES256.GCM.Randomized",
    keySecretName: env.ENTITYCRYPT_MASTER_KEY_SECRET_NAME,
    receiptId,
    ciphertext: encryptedIdentity
  };

  const receivedAt = Date.parse(receivedAtUtc);
  const deliveryId = crypto.randomUUID();
  const participationId = crypto.randomUUID();
  const participationStatus =
    task.consensusRole === "J2"
      && submission.artifact.ratification.decision === "recuse"
      ? "recused"
      : "submitted";
  const evidenceStatus = ["A", "B"].includes(task.consensusRole)
    ? "held"
    : "pending";
  const writes = [
    env.DB.prepare(
      `INSERT INTO submissions
        (receipt_id, user_id, packet_id, role,
         artifact_sha256, submitted_at, participant_pseudonym,
         artifact_type, artifact_json, repository_status,
         task_version_id, round_id, holdout_id, guideline_version,
         data_version, protocol_version, consensus_role,
         consensus_round)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending-validation',
               ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      receiptId,
      account.user_id,
      task.packetId,
      task.role,
      actualArtifactSha256,
      receivedAt,
      participantPseudonym,
      submission.artifactType,
      JSON.stringify(submission.artifact),
      consensusTask.id,
      round.id,
      task.identity.holdoutId,
      task.identity.guidelineVersion,
      task.identity.dataVersion,
      task.identity.protocolVersion,
      task.consensusRole,
      Number(round.round_number)
    ),
    env.DB.prepare(
      `INSERT INTO task_participations
        (id, task_version_id, round_id, holdout_id, user_id,
         role, status, submission_receipt_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      participationId,
      consensusTask.id,
      round.id,
      task.identity.holdoutId,
      account.user_id,
      task.consensusRole,
      participationStatus,
      receiptId,
      receivedAt,
      receivedAt
    ),
    env.DB.prepare(
      `INSERT INTO evidence_outbox
        (id, kind, task_version_id, related_id, public_blob_name,
         identity_blob_name, public_payload_json, identity_payload_json,
         dedupe_key, status, attempts, next_attempt_at, created_at)
       VALUES (?, 'submission', ?, ?, ?, ?, ?, ?, ?,
               ?, 0, ?, ?)`
    ).bind(
      deliveryId,
      consensusTask.id,
      receiptId,
      `${receiptId}.json`,
      `${receiptId}.json`,
      JSON.stringify(signedEnvelope, null, 2) + "\n",
      JSON.stringify(identityEnvelope, null, 2) + "\n",
      `submission:${receiptId}`,
      evidenceStatus,
      receivedAt,
      receivedAt
    )
  ];
  let primaryFinalRoot = null;
  if (task.consensusRole === "J1") {
    primaryFinalRoot = await computeAdjudicationMerkleRoot(
      submission.artifact.packet,
      submission.artifact.annotationA,
      submission.artifact.annotationB,
      submission.artifact.adjudication
    );
    writes.push(env.DB.prepare(
      `INSERT INTO final_results
        (primary_receipt_id, task_version_id, round_id,
         final_merkle_root, status, proposed_at)
       VALUES (?, ?, ?, ?, 'proposed', ?)`
    ).bind(
      receiptId,
      consensusTask.id,
      round.id,
      primaryFinalRoot,
      receivedAt
    ));
  }
  if (task.consensusRole === "J2"
      && submission.artifact.ratification.decision === "agree") {
    writes.push(env.DB.prepare(
      `UPDATE final_results
          SET secondary_receipt_id = ?, status = 'active',
              approved_at = ?
        WHERE primary_receipt_id = ?
          AND task_version_id = ?
          AND round_id = ?
          AND final_merkle_root = ?
          AND status = 'proposed'
          AND secondary_receipt_id IS NULL`
    ).bind(
      receiptId,
      receivedAt,
      roleContext.primaryFinal.primary_receipt_id,
      consensusTask.id,
      round.id,
      submission.artifact.ratification
        .primaryAdjudicationMerkleRoot
    ));
  }
  if (task.consensusRole === "J2"
      && submission.artifact.ratification.decision === "recuse") {
    writes.push(env.DB.prepare(
      `INSERT INTO recusals
        (id, task_version_id, round_id, user_id, role,
         scope, reason, created_at)
       VALUES (?, ?, ?, ?, 'J2', 'holdout-family', ?, ?)`
    ).bind(
      crypto.randomUUID(),
      consensusTask.id,
      round.id,
      account.user_id,
      submission.artifact.ratification.rationale,
      receivedAt
    ));
  }
  if (repositoryAssignment) {
    writes.push(env.DB.prepare(
      `UPDATE task_assignments
          SET user_id = ?, status = 'submitted',
              submission_receipt_id = ?, claimed_at = COALESCE(claimed_at, ?),
              submitted_at = ?, updated_at = ?
        WHERE id = ?
          AND role = ?
          AND status IN ('invited', 'claimed')
          AND (user_id IS NULL OR user_id = ?)`
    ).bind(
      account.user_id,
      receiptId,
      receivedAt,
      receivedAt,
      receivedAt,
      repositoryAssignment.id,
      task.consensusRole,
      account.user_id
    ));
  }
  let writeResults;
  try {
    writeResults = await env.DB.batch(writes);
  } catch (error) {
    console.error("ADG consensus submission write failed", {
      name: error?.name,
      message: error?.message
    });
    throw new PublicError(
      "تعارض الدور أو تغيرت حالة الجولة. حدّث المهمة وأعد المحاولة.",
      409
    );
  }
  if (writeResults.length !== writes.length
      || writeResults.some(
        result => Number(result?.meta?.changes || 0) !== 1
      )) {
    throw new PublicError(
      "لم تُثبت المساهمة ذريًا في سجل الجولة.",
      409
    );
  }
  if (["A", "B"].includes(task.consensusRole)
      && consensusTask.state === "open") {
    try {
      consensusTask = await transitionConsensusTask(
        env.DB,
        consensusTask,
        {
          toState: "independent-review",
          roundId: round.id,
          eventType: "independent-review-opened",
          reasonCode: "first-independent-submission",
          evidence: { roundNumber: Number(round.round_number) },
          actorUserId: account.user_id,
          idempotencyKey:
            `independent-open:${consensusTask.id}:${round.id}`
        }
      );
      await ensureTaskStateEvidence(env, consensusTask);
    } catch (error) {
      if (!(error instanceof ConsensusConflict)) throw error;
      consensusTask = await getConsensusTask(env.DB, consensusTask.id);
    }
  }
  await reconcileConsensusTask(env, consensusTask.id);
  const refreshedTask = await getConsensusTask(env.DB, consensusTask.id);
  if (refreshedTask?.state === "approved"
      && task.consensusRole === "J2"
      && submission.artifact.ratification.decision === "agree") {
    await queueFinalResultNotifications(
      env,
      account.user_id,
      roleContext.primaryFinal.primary_receipt_id,
      roleContext.primaryFinal.participant_pseudonym,
      JSON.parse(roleContext.primaryFinal.artifact_json)
    );
  }
  const previous = await env.DB.prepare(
    `SELECT COUNT(*) AS count
       FROM submissions
      WHERE task_version_id = ? AND round_id = ?
        AND receipt_id <> ?
        AND artifact_json IS NOT NULL`
  ).bind(consensusTask.id, round.id, receiptId).first();
  const delivery = await env.DB.prepare(
    `SELECT status
       FROM evidence_outbox
      WHERE dedupe_key = ?`
  ).bind(`submission:${receiptId}`).first();
  const repositoryImportStatus = delivery?.status === "held"
    ? "held-for-independent-quorum"
    : "pending-validation";

  return json({
    accepted: true,
    receiptId,
    repositoryImportStatus,
    previousResultsAvailable: Number(previous?.count || 0),
    consensus: {
      taskVersionId: consensusTask.id,
      round: Number(round.round_number),
      role: task.consensusRole,
      state: refreshedTask?.state ?? consensusTask.state
    }
  }, 202);
}

async function receiveOperationalTest(request, env) {
  if (String(env.SUBMISSION_ENABLED).toLowerCase() !== "true") {
    throw new PublicError(
      "قناة الإرسال متوقفة مؤقتًا، ويمكن حفظ نسخة محلية.",
      503
    );
  }
  const account = await requireSession(request, env);
  if (!account.verified_email_hash) {
    throw new PublicError(
      "وثّق بريد الحساب قبل إرسال الاختبار التشغيلي.",
      403
    );
  }
  if (account.erasure_status === "pending") {
    throw new PublicError(
      "لا يمكن إنشاء اختبار جديد بعد تسجيل طلب محو الهوية.",
      409
    );
  }

  const maxBytes = Number(env.MAX_SUBMISSION_BYTES || 900000);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxBytes) {
    throw new PublicError("حجم الاختبار أكبر من الحد المسموح.", 413);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) {
    throw new PublicError("حجم الاختبار أكبر من الحد المسموح.", 413);
  }

  let submission;
  try {
    submission = JSON.parse(text);
  } catch {
    throw new PublicError("بيانات الاختبار غير صالحة.", 400);
  }
  validateSubmission(submission, { operationalTest: true });
  await validateArtifactForServer(submission.artifact);

  const turnstile = await verifyTurnstile(
    submission.turnstileToken,
    request.headers.get("CF-Connecting-IP"),
    env
  );
  if (!turnstile.success) {
    throw new PublicError("لم ينجح اختبار الحماية. أعد المحاولة.", 403);
  }

  const actualArtifactSha256 = await sha256Hex(
    JSON.stringify(submission.artifact)
  );
  if (actualArtifactSha256 !== submission.artifactSha256) {
    throw new PublicError("تغيّرت نتيجة الاختبار أثناء الإرسال.", 400);
  }

  const packet = submission.artifact.packet;
  const packetRoot = await computePacketMerkleRoot(packet);
  const operationalTaskId = taskVersionIdentity(packet, packetRoot).id;
  const operationalCatalog = await env.DB.prepare(
    `SELECT task_version_id, assignment_mode
       FROM repository_task_packets
      WHERE task_version_id = ?
        AND packet_merkle_root = ?
        AND lane = 'operational-test'
        AND status = 'active'`
  ).bind(operationalTaskId, packetRoot).first();
  if (!operationalCatalog) {
    throw new PublicError(
      "استلم حزمة الاختبار المنشورة في المستودع من قائمة مهامك أولًا.",
      403
    );
  }
  const operationalClaim = await env.DB.prepare(
    `SELECT id, status
       FROM operational_task_claims
      WHERE task_version_id = ? AND user_id = ?
        AND status IN ('claimed', 'submitted')`
  ).bind(operationalTaskId, account.user_id).first();
  const internalPacketId = `${packet.packetId}:operational-test`;
  const existingOperationalTest = await env.DB.prepare(
    `SELECT receipt_id, artifact_sha256, repository_status
       FROM submissions
      WHERE user_id = ? AND packet_id = ?`
  ).bind(account.user_id, internalPacketId).first();
  if (existingOperationalTest) {
    if (existingOperationalTest.artifact_sha256 === actualArtifactSha256) {
      return json({
        accepted: true,
        receiptId: existingOperationalTest.receipt_id,
        repositoryImportStatus:
          existingOperationalTest.repository_status,
        previousResultsAvailable: 1,
        operationalTest: true,
        duplicate: true
      });
    }
    throw new PublicError(
      "سبق لهذا الحساب إرسال نتيجة مختلفة للحزمة نفسها.",
      409
    );
  }
  if (operationalClaim?.status === "submitted") {
    throw new PublicError(
      "حالة الاختبار محفوظة كمرسلة دون إيصال متاح. أبلغ عن الخلل.",
      409
    );
  }
  if (!operationalClaim
      && operationalCatalog.assignment_mode !== "open") {
    throw new PublicError(
      "استلم الاختبار المسند من قائمة مهامك قبل إرسال النتيجة.",
      403
    );
  }
  const entityCryptMasterKey = await getVaultSecret(
    env.ENTITYCRYPT_MASTER_KEY_SECRET_NAME,
    env
  );
  const storedProfile = JSON.parse(await decryptEntityCrypt(
    account.profile_ciphertext,
    entityCryptMasterKey
  ));
  const storedConsent = JSON.parse(account.consent_json);
  const receiptId = crypto.randomUUID();
  const participantPseudonym = `adg-${receiptId.slice(0, 12)}`;
  const receivedAtUtc = new Date().toISOString();
  const receivedAt = Date.parse(receivedAtUtc);
  const privateIdentity = {
    schema: "adg-msa-private-participant-identity-v1",
    receiptId,
    participantId: submission.participantId,
    accountUserId: account.user_id,
    receivedAtUtc,
    profile: storedProfile,
    consent: storedConsent,
    artifactSha256: actualArtifactSha256,
    clientVersion: submission.clientVersion,
    submissionMode: "operational-test"
  };
  const publicEnvelope = {
    schema: "adg-msa-github-inbox-v1",
    receiptId,
    participantPseudonym,
    receivedAtUtc,
    submissionMode: "operational-test",
    artifactType: submission.artifactType,
    artifactSha256: actualArtifactSha256,
    attestation: submission.attestation,
    artifact: submission.artifact,
    claimBoundaries: [
      "Participant identity is stored separately and is not present here.",
      "This is an assisted operational test, not independent adjudication.",
      "This test does not occupy A, B, J1, or J2 and does not affect consensus.",
      "Pilot submissions cannot become final MSA readiness evidence."
    ]
  };
  const hmacKey = await getVaultSecret(
    env.SUBMISSION_HMAC_SECRET_NAME,
    env
  );
  const signedEnvelope = {
    ...publicEnvelope,
    hmacSha256: await hmacSha256(
      hmacKey,
      JSON.stringify(publicEnvelope))
  };
  const encryptedIdentity = await encryptEntityCrypt(
    JSON.stringify(privateIdentity),
    entityCryptMasterKey
  );
  const identityEnvelope = {
    schema: "adg-entitycrypt-data-room-envelope-v1",
    entityCryptProfile: "Matryoshka.MK1.AES256.GCM.Randomized",
    keySecretName: env.ENTITYCRYPT_MASTER_KEY_SECRET_NAME,
    receiptId,
    ciphertext: encryptedIdentity
  };
  const deliveryId = crypto.randomUUID();
  const claimWrite = operationalClaim
    ? env.DB.prepare(
      `UPDATE operational_task_claims
          SET status = 'submitted', submission_receipt_id = ?,
              submitted_at = ?, updated_at = ?
        WHERE id = ? AND user_id = ? AND status = 'claimed'`
    ).bind(
      receiptId,
      receivedAt,
      receivedAt,
      operationalClaim.id,
      account.user_id
    )
    : env.DB.prepare(
      `INSERT INTO operational_task_claims
        (id, task_version_id, user_id, role, status,
         submission_receipt_id, claimed_at, submitted_at, updated_at)
       VALUES (?, ?, ?, 'A', 'submitted', ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      operationalTaskId,
      account.user_id,
      receiptId,
      receivedAt,
      receivedAt,
      receivedAt
    );
  let writeResults;
  try {
    writeResults = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO submissions
          (receipt_id, user_id, packet_id, role,
           artifact_sha256, submitted_at, participant_pseudonym,
           artifact_type, artifact_json, repository_status,
           holdout_id, guideline_version, data_version, protocol_version,
           consensus_role, consensus_round)
         VALUES (?, ?, ?, 'operational-test', ?, ?, ?, ?, ?,
                 'pending-validation', ?, ?, ?, ?, 'TEST', 0)`
      ).bind(
        receiptId,
        account.user_id,
        internalPacketId,
        actualArtifactSha256,
        receivedAt,
        participantPseudonym,
        submission.artifactType,
        JSON.stringify(submission.artifact),
        packet.holdoutId,
        packet.guidelineVersion,
        packet.dataVersion,
        packet.protocolVersion
      ),
      env.DB.prepare(
        `INSERT INTO evidence_outbox
          (id, kind, task_version_id, related_id, public_blob_name,
           identity_blob_name, public_payload_json, identity_payload_json,
           dedupe_key, status, attempts, next_attempt_at, created_at)
         VALUES (?, 'submission', NULL, ?, ?, ?, ?, ?, ?,
                 'pending', 0, ?, ?)`
      ).bind(
        deliveryId,
        receiptId,
        `${receiptId}.json`,
        `${receiptId}.json`,
        JSON.stringify(signedEnvelope, null, 2) + "\n",
        JSON.stringify(identityEnvelope, null, 2) + "\n",
        `submission:${receiptId}`,
        receivedAt,
        receivedAt
      ),
      claimWrite
    ]);
  } catch (error) {
    const duplicate = await env.DB.prepare(
      `SELECT receipt_id, artifact_sha256, repository_status
         FROM submissions
        WHERE user_id = ? AND packet_id = ?`
    ).bind(account.user_id, internalPacketId).first();
    if (duplicate?.artifact_sha256 === actualArtifactSha256) {
      return json({
        accepted: true,
        receiptId: duplicate.receipt_id,
        repositoryImportStatus: duplicate.repository_status,
        previousResultsAvailable: 1,
        operationalTest: true,
        duplicate: true
      });
    }
    if (duplicate) {
      throw new PublicError(
        "سبق لهذا الحساب إرسال نتيجة مختلفة للحزمة نفسها.",
        409
      );
    }
    throw error;
  }
  if (writeResults.length !== 3
      || writeResults.some(
        result => Number(result?.meta?.changes || 0) !== 1
      )) {
    throw new PublicError("لم يُثبت الاختبار التشغيلي ذريًا.", 409);
  }

  return json({
    accepted: true,
    receiptId,
    repositoryImportStatus: "pending-validation",
    previousResultsAvailable: 1,
    operationalTest: true
  }, 202);
}

async function submissionTask(artifact) {
  const packet = artifact?.kind === "ratification-package"
    ? artifact?.primaryArtifact?.packet
    : artifact?.packet;
  const packetRoot = await computePacketMerkleRoot(packet);
  const role = artifact?.kind === "independent-annotation"
    ? artifact?.annotation?.annotatorSlot
    : artifact?.kind === "adjudication-package"
      ? "adjudication"
      : artifact?.kind === "ratification-package"
        ? "ratification"
        : null;
  const draftKey = validateDraftKey(packet?.packetId, role);
  return {
    ...draftKey,
    packet,
    packetRoot,
    identity: taskVersionIdentity(packet, packetRoot),
    consensusRole: role === "adjudication"
      ? "J1"
      : role === "ratification"
        ? "J2"
        : role
  };
}

function validateSubmission(value, options = {}) {
  const operationalTest = options.operationalTest === true;
  if (!value || value.schema !== "adg-msa-portal-submission-v1"
      || !isUuid(value.participantId)
      || value.artifactType
        !== value.artifact?.kind
      || !/^[a-f0-9]{64}$/.test(value.artifactSha256 || "")
      || typeof value.clientVersion !== "string") {
    throw new PublicError("غلاف التقييم غير صالح.", 400);
  }
  const participantPrefix = value.participantId.slice(0, 12);
  if (value.artifact.kind === "independent-annotation") {
    const expected =
      `human-${participantPrefix}-${value.artifact.annotation.annotatorSlot}`;
    if (value.artifact.annotation.annotatorPseudonym !== expected) {
      throw new PublicError("معرف المعلّق داخل النتيجة غير مرتبط بالجلسة.", 400);
    }
  } else if (value.artifact.kind === "adjudication-package") {
    const expected = `human-${participantPrefix}-J1`;
    if (value.artifact.adjudication.adjudicatorPseudonym !== expected) {
      throw new PublicError("معرف المحكّم داخل النتيجة غير مرتبط بالجلسة.", 400);
    }
  } else {
    const expected = `human-${participantPrefix}-J2`;
    if (value.artifact.ratification.reviewerPseudonym !== expected) {
      throw new PublicError(
        "معرف المراجع الثاني داخل النتيجة غير مرتبط بالجلسة.",
        400
      );
    }
  }

  validateAccountProfile(value.profile);

  const validAttestation = operationalTest
    ? value.attestation?.independent === false
      && value.attestation?.blind === false
      && value.attestation?.authentic === true
    : value.attestation?.independent === true
      && value.attestation?.blind === true
      && value.attestation?.authentic === true;
  if (value.consent?.identityStorage !== true || !validAttestation) {
    throw new PublicError("الموافقات والتعهدات المطلوبة غير مكتملة.", 400);
  }
  if (!value.turnstileToken
      || typeof value.turnstileToken !== "string"
      || value.turnstileToken.length > 4096) {
    throw new PublicError("رمز الحماية غير صالح.", 400);
  }
  if (!value.artifact
      || value.artifact.schema !== "adg-msa-portal-artifact-v1"
      || ![
        "independent-annotation",
        "adjudication-package",
        "ratification-package"
      ]
        .includes(value.artifact.kind)
      || containsKey(value.artifact, PII_KEYS)
      || containsKey(value.artifact, FORBIDDEN_ANALYSIS_KEYS)) {
    throw new PublicError(
      "ملف النتيجة يحتوي بيانات هوية أو تحليلًا محظورًا.",
      400
    );
  }
  if (operationalTest) {
    const annotation = value.artifact.annotation;
    if (value.submissionMode !== "operational-test"
        || value.artifact.kind !== "independent-annotation"
        || value.artifact.packet?.pilotOnly !== true
        || value.artifact.packet?.developerVisible !== true
        || annotation?.isHuman !== true
        || annotation?.isSynthetic !== false
        || annotation?.independentFromImplementationTeam !== false
        || annotation?.blindToParserInternals !== false) {
      throw new PublicError(
        "وضع الاختبار التشغيلي غير مرتبط بحزمة تجريبية صالحة.",
        400
      );
    }
  } else if (value.submissionMode === "operational-test") {
    throw new PublicError("أرسل الاختبار عبر مساره المخصص.", 400);
  }
}

async function validateArtifactForServer(artifact) {
  try {
    validatePublicArtifactText(artifact);
    if (artifact.kind === "independent-annotation") {
      await validateSubmissionBinding(artifact.packet, artifact.annotation);
      return;
    }
    if (artifact.kind === "adjudication-package") {
      await validateAdjudicationBinding(
        artifact.packet,
        artifact.annotationA,
        artifact.annotationB,
        artifact.adjudication
      );
      return;
    }
    await validateRatificationBinding(
      artifact.primaryArtifact,
      artifact.ratification
    );
  } catch (error) {
    throw new PublicError(
      `فشل التحقق البنيوي من نتيجة التحكيم: ${error.message}`,
      400
    );
  }
}

async function requiredRepositoryTaskAssignment(
  db,
  account,
  task,
  consensusTask,
  round
) {
  const catalog = await db.prepare(
    `SELECT status
       FROM repository_task_packets
      WHERE task_version_id = ? AND lane = 'standard'`
  ).bind(consensusTask.id).first();
  if (!catalog) return null;
  if (catalog.status !== "active") {
    throw new PublicError("سُحبت هذه المهمة من قائمة المستودع.", 409);
  }
  const assignment = await db.prepare(
    `SELECT id, role, status, user_id
       FROM task_assignments
      WHERE task_version_id = ? AND round_id = ? AND role = ?
        AND status IN ('invited', 'claimed')
        AND (
          user_id = ?
          OR (user_id IS NULL AND email_hash = ?)
        )
      LIMIT 1`
  ).bind(
    consensusTask.id,
    round.id,
    task.consensusRole,
    account.user_id,
    account.verified_email_hash
  ).first();
  if (!assignment) {
    throw new PublicError(
      "استلم هذه المهمة من قائمة مهامك قبل إرسال النتيجة.",
      403
    );
  }
  return assignment;
}

async function validateConsensusEligibility(
  env,
  account,
  task,
  consensusTask,
  round,
  artifact
) {
  if (!round || round.status !== "open") {
    throw new PublicError("جولة الإجماع الحالية ليست مفتوحة.", 409);
  }
  const allowedStates = {
    A: new Set(["open", "independent-review"]),
    B: new Set(["open", "independent-review"]),
    J1: new Set(["discussion"]),
    J2: new Set(["final-review"])
  }[task.consensusRole];
  if (!allowedStates?.has(consensusTask.state)) {
    throw new PublicError(
      `الدور ${task.consensusRole} غير متاح في حالة `
      + `${consensusTask.state}.`,
      409
    );
  }
  const existing = await env.DB.prepare(
    `SELECT id, task_version_id, holdout_id, role, status
       FROM task_participations
      WHERE user_id = ?
        AND (task_version_id = ? OR holdout_id = ?)
      LIMIT 1`
  ).bind(
    account.user_id,
    consensusTask.id,
    task.identity.holdoutId
  ).first();
  if (existing) {
    throw new PublicError(
      "سبق أن شارك هذا الحساب في المهمة أو عائلة الحجز نفسها.",
      409
    );
  }
  const occupied = await env.DB.prepare(
    `SELECT id
       FROM task_participations
      WHERE round_id = ? AND role = ?
      LIMIT 1`
  ).bind(round.id, task.consensusRole).first();
  if (occupied) {
    throw new PublicError("اكتمل هذا الدور في الجولة الحالية.", 409);
  }

  if (["A", "B"].includes(task.consensusRole)) return {};
  if (task.consensusRole === "J1") {
    const independent = await env.DB.prepare(
      `SELECT receipt_id, user_id, consensus_role, artifact_json
         FROM submissions
        WHERE task_version_id = ? AND round_id = ?
          AND consensus_role IN ('A', 'B')
          AND active = 1
        ORDER BY consensus_role`
    ).bind(consensusTask.id, round.id).all();
    if ((independent.results || []).length !== 2) {
      throw new PublicError(
        "لا يمكن بدء J1 قبل تثبيت A وB في الجولة نفسها.",
        409
      );
    }
    const requiredRoots = new Set([
      artifact.adjudication.annotationAMerkleRoot,
      artifact.adjudication.annotationBMerkleRoot
    ]);
    const storedRoots = new Set();
    for (const row of independent.results) {
      const storedArtifact = JSON.parse(row.artifact_json);
      storedRoots.add(await computeAnnotationMerkleRoot(
        storedArtifact.packet,
        storedArtifact.annotation
      ));
    }
    if (storedRoots.size !== 2
        || [...requiredRoots].some(root => !storedRoots.has(root))) {
      throw new PublicError(
        "حزمة J1 لا ترتبط بإرسالي A وB المثبتين لهذه الجولة.",
        409
      );
    }
    return { independent: independent.results };
  }

  const primaryFinal = await env.DB.prepare(
    `SELECT f.primary_receipt_id, f.final_merkle_root, f.status,
            s.user_id, s.participant_pseudonym, s.artifact_json
       FROM final_results f
       JOIN submissions s ON s.receipt_id = f.primary_receipt_id
      WHERE f.primary_receipt_id = ?
        AND f.task_version_id = ?
        AND f.round_id = ?
        AND f.status = 'proposed'`
  ).bind(
    artifact.ratification.primaryReceiptId,
    consensusTask.id,
    round.id
  ).first();
  if (!primaryFinal
      || primaryFinal.final_merkle_root
        !== artifact.ratification.primaryAdjudicationMerkleRoot) {
    throw new PublicError(
      "مراجعة J2 لا ترتبط بنتيجة J1 المقترحة في الجولة الحالية.",
      409
    );
  }
  return { primaryFinal };
}

async function reconcileConsensusTask(env, taskVersionId) {
  let task = await getConsensusTask(env.DB, taskVersionId);
  if (!task) return null;
  const round = await getCurrentConsensusRound(env.DB, task);
  if (!round) return task;

  try {
    if (task.state === "independent-review") {
      const result = await env.DB.prepare(
        `SELECT receipt_id, consensus_role, artifact_json
           FROM submissions
          WHERE task_version_id = ? AND round_id = ?
            AND consensus_role IN ('A', 'B') AND active = 1
          ORDER BY consensus_role`
      ).bind(task.id, round.id).all();
      const rows = result.results || [];
      if (rows.length === 2) {
        const byRole = new Map(rows.map(row => [row.consensus_role, row]));
        await releaseIndependentEvidence(
          env.DB,
          task.id,
          round.id,
          [
            byRole.get("A").receipt_id,
            byRole.get("B").receipt_id
          ]
        );
        const artifactA = JSON.parse(byRole.get("A").artifact_json);
        const artifactB = JSON.parse(byRole.get("B").artifact_json);
        const metrics = computeIndependentAgreement(
          artifactA.annotation,
          artifactB.annotation
        );
        const policy = JSON.parse(task.metric_policy_json);
        const passed = agreementPolicyPassed(metrics, policy);
        await env.DB.prepare(
          `INSERT OR IGNORE INTO consensus_metrics
            (task_version_id, round_id, annotation_a_receipt_id,
             annotation_b_receipt_id, metrics_json, policy_passed,
             computed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          task.id,
          round.id,
          byRole.get("A").receipt_id,
          byRole.get("B").receipt_id,
          JSON.stringify(metrics),
          passed ? 1 : 0,
          Date.now()
        ).run();
        task = await transitionConsensusTask(env.DB, task, {
          toState: "discussion",
          roundId: round.id,
          eventType: passed
            ? "independent-quorum-reached"
            : "independent-disagreement-routed",
          reasonCode: passed
            ? "independent-quorum-complete"
            : "j1-adjudication-required",
          evidence: {
            annotationAReceiptId: byRole.get("A").receipt_id,
            annotationBReceiptId: byRole.get("B").receipt_id,
            metrics,
            policy
          },
          idempotencyKey:
            `independent-quorum:${round.id}:`
            + `${byRole.get("A").receipt_id}:`
            + `${byRole.get("B").receipt_id}`
        });
        await ensureTaskStateEvidence(env, task);
        if (!passed) {
          await queueGovernanceNotifications(
            env,
            task.id,
            "j1-adjudication-required",
            {
              taskVersionId: task.id,
              packetId: task.packet_id,
              reason: "low-independent-agreement",
              roundId: round.id
            },
            `j1-adjudication-required:${task.last_event_id}`
          );
        }
      }
    } else if (task.state === "discussion") {
      const primary = await env.DB.prepare(
        `SELECT receipt_id, artifact_json
           FROM submissions
          WHERE task_version_id = ? AND round_id = ?
            AND consensus_role = 'J1' AND active = 1`
      ).bind(task.id, round.id).first();
      if (primary) {
        const artifact = JSON.parse(primary.artifact_json);
        const novelCount = countNovelPrimaryDecisions(
          artifact.annotationA,
          artifact.annotationB,
          artifact.adjudication
        );
        task = await transitionConsensusTask(env.DB, task, {
          toState: novelCount > 0 ? "escalated" : "final-review",
          roundId: round.id,
          eventType: novelCount > 0
            ? "novel-primary-decision"
            : "primary-adjudication-proposed",
          reasonCode: novelCount > 0
            ? "novel-primary-decision"
            : "j1-final-root-proposed",
          evidence: {
            primaryReceiptId: primary.receipt_id,
            finalMerkleRoot: await computeAdjudicationMerkleRoot(
              artifact.packet,
              artifact.annotationA,
              artifact.annotationB,
              artifact.adjudication
            ),
            novelDecisionCount: novelCount
          },
          idempotencyKey: `j1-proposal:${primary.receipt_id}`
        });
        await ensureTaskStateEvidence(env, task);
        if (novelCount > 0) {
          task = await createReissuedRound(
            env.DB,
            task,
            "novel-primary-decision",
            null
          );
          await ensureTaskStateEvidence(env, task);
          await queueGovernanceNotifications(
            env,
            task.id,
            "task-reissued",
            {
              taskVersionId: task.id,
              packetId: task.packet_id,
              reason: "novel-primary-decision"
            },
            `task-reissued:${task.last_event_id}`
          );
        }
      }
    } else if (task.state === "final-review") {
      const secondary = await env.DB.prepare(
        `SELECT receipt_id, artifact_json
           FROM submissions
          WHERE task_version_id = ? AND round_id = ?
            AND consensus_role = 'J2' AND active = 1`
      ).bind(task.id, round.id).first();
      if (secondary) {
        const artifact = JSON.parse(secondary.artifact_json);
        const agrees = artifact.ratification.decision === "agree";
        task = await transitionConsensusTask(env.DB, task, {
          toState: agrees ? "approved" : "escalated",
          roundId: round.id,
          eventType: agrees
            ? "secondary-ratification-approved"
            : "secondary-ratification-escalated",
          reasonCode: agrees
            ? "j2-exact-root-cosign"
            : artifact.ratification.decision === "recuse"
              ? "accepted-recusal"
              : "j2-disagreement",
          evidence: {
            secondaryReceiptId: secondary.receipt_id,
            primaryReceiptId: artifact.ratification.primaryReceiptId,
            finalMerkleRoot:
              artifact.ratification.primaryAdjudicationMerkleRoot,
            decision: artifact.ratification.decision
          },
          activeFinalReceiptId: agrees
            ? artifact.ratification.primaryReceiptId
            : null,
          appealDeadlineAt: agrees
            ? Date.now() + APPEAL_WINDOW_MS
            : null,
          idempotencyKey: `j2-ratification:${secondary.receipt_id}`
        });
        if (agrees) {
          await env.DB.prepare(
            `UPDATE consensus_rounds
                SET status = 'closed', closed_at = ?
              WHERE id = ? AND status = 'open'`
          ).bind(Date.now(), round.id).run();
        }
        await ensureTaskStateEvidence(env, task);
        if (agrees) {
          await queueGovernanceNotifications(
            env,
            task.id,
            "result-approved",
            {
              taskVersionId: task.id,
              packetId: task.packet_id,
              appealDeadlineAtUtc:
                new Date(task.appeal_deadline_at).toISOString()
            },
            `result-approved:${secondary.receipt_id}`
          );
        } else {
          task = await createReissuedRound(
            env.DB,
            task,
            artifact.ratification.decision === "recuse"
              ? "accepted-recusal"
              : "j2-disagreement",
            null
          );
          await ensureTaskStateEvidence(env, task);
          await queueGovernanceNotifications(
            env,
            task.id,
            "task-reissued",
            {
              taskVersionId: task.id,
              packetId: task.packet_id,
              reason:
                artifact.ratification.decision === "recuse"
                  ? "accepted-recusal"
                  : "j2-disagreement"
            },
            `task-reissued:${task.last_event_id}`
          );
        }
      }
    }
  } catch (error) {
    if (!(error instanceof ConsensusConflict)) throw error;
  }
  return getConsensusTask(env.DB, taskVersionId);
}

async function releaseIndependentEvidence(
  db,
  taskVersionId,
  roundId,
  receiptIds
) {
  await db.prepare(
    `UPDATE evidence_outbox
        SET status = 'pending', next_attempt_at = ?
      WHERE kind = 'submission'
        AND task_version_id = ?
        AND status = 'held'
        AND related_id IN (?, ?)
        AND related_id IN (
          SELECT receipt_id
            FROM submissions
           WHERE task_version_id = ? AND round_id = ?
             AND consensus_role IN ('A', 'B') AND active = 1
        )`
  ).bind(
    Date.now(),
    taskVersionId,
    receiptIds[0],
    receiptIds[1],
    taskVersionId,
    roundId
  ).run();
  const released = await db.prepare(
    `SELECT COUNT(*) AS count
       FROM evidence_outbox
      WHERE kind = 'submission'
        AND task_version_id = ?
        AND related_id IN (?, ?)
        AND status IN ('pending', 'sending', 'sent')`
  ).bind(
    taskVersionId,
    receiptIds[0],
    receiptIds[1]
  ).first();
  if (Number(released?.count || 0) !== 2) {
    throw new ConsensusConflict(
      "Independent evidence could not be released as one quorum."
    );
  }
}

async function ensureTaskStateEvidence(env, task) {
  if (!task?.last_event_id) return;
  const exists = await env.DB.prepare(
    `SELECT id FROM evidence_outbox
      WHERE dedupe_key = ?`
  ).bind(`task-state:${task.last_event_id}`).first();
  if (exists) return;
  const event = await env.DB.prepare(
    `SELECT id, round_id, event_type, from_state, to_state,
            reason_code, evidence_json, prior_state_hash,
            event_hash, created_at
       FROM consensus_events
      WHERE id = ?`
  ).bind(task.last_event_id).first();
  if (!event) return;
  const publicEnvelope = {
    schema: "adg-msa-task-state-v1",
    nonce: event.id,
    eventId: event.id,
    taskVersionId: task.id,
    taskId: task.task_id,
    taskVersion: Number(task.task_version),
    packetId: task.packet_id,
    holdoutId: task.holdout_id,
    packetMerkleRoot: task.packet_merkle_root,
    guidelineVersion: task.guideline_version,
    dataVersion: task.data_version,
    protocolVersion: task.protocol_version,
    state: event.to_state,
    stateVersion: Number(task.state_version),
    round: Number(task.current_round),
    roundId: event.round_id,
    eventType: event.event_type,
    fromState: event.from_state,
    toState: event.to_state,
    reasonCode: event.reason_code,
    evidence: JSON.parse(event.evidence_json),
    priorStateHash: event.prior_state_hash,
    eventHash: event.event_hash,
    activeFinalReceiptId: task.active_final_receipt_id,
    repositoryStatus: task.repository_status,
    createdAtUtc: new Date(event.created_at).toISOString(),
    transitionedAtUtc: new Date(event.created_at).toISOString(),
    claimBoundaries: [
      "This is a signed workflow-state event, not linguistic gold by itself.",
      "Participant identity and contact data are excluded.",
      "Published status requires a separately authenticated repository receipt."
    ]
  };
  const hmacKey = await getVaultSecret(
    env.SUBMISSION_HMAC_SECRET_NAME,
    env
  );
  const signedEnvelope = {
    ...publicEnvelope,
    hmacSha256: await hmacSha256(
      hmacKey,
      JSON.stringify(publicEnvelope)
    )
  };
  await env.DB.prepare(
    `INSERT OR IGNORE INTO evidence_outbox
      (id, kind, task_version_id, related_id, public_blob_name,
       public_payload_json, dedupe_key, status, attempts,
       next_attempt_at, created_at)
     VALUES (?, 'task-state', ?, ?, ?, ?, ?,
             'pending', 0, ?, ?)`
  ).bind(
    crypto.randomUUID(),
    task.id,
    event.id,
    `${event.id}.state.json`,
    JSON.stringify(signedEnvelope, null, 2) + "\n",
    `task-state:${event.id}`,
    Date.now(),
    Date.now()
  ).run();
}

async function queueDiscussionNotifications(
  env,
  authorUserId,
  source,
  commentId,
  body,
  target,
  mentions,
  related
) {
  const recipients = new Map();
  if (target && target.user_id !== authorUserId) {
    recipients.set(target.user_id, {
      row: target,
      eventType: "comment"
    });
  }
  for (const mention of mentions) {
    const row = related.get(mention.receiptId);
    if (row && row.user_id !== authorUserId) {
      recipients.set(row.user_id, {
        row,
        eventType: "mention"
      });
    }
  }
  for (const [userId, recipient] of recipients) {
    if (!discussionNotificationsEnabled(recipient.row.consent_json)) {
      continue;
    }
    await enqueueNotification(env.DB, {
      recipientUserId: userId,
      eventType: recipient.eventType,
      packetId: source.packet_id,
      commentId,
      sourceReceiptId: recipient.row.receipt_id,
      context: {
        packetId: source.packet_id,
        sourceReceiptId: recipient.row.receipt_id,
        actorPseudonym: source.participant_pseudonym,
        excerpt: body
      },
      dedupeKey:
        `${recipient.eventType}:${commentId}:${userId}`
    });
  }
}

async function queueFinalResultNotifications(
  env,
  adjudicatorUserId,
  finalReceiptId,
  finalPseudonym,
  finalArtifact
) {
  const result = await env.DB.prepare(
    `SELECT s.receipt_id, s.user_id, s.artifact_json, u.consent_json
       FROM submissions s
       JOIN users u ON u.id = s.user_id
      WHERE s.packet_id = ?
        AND s.artifact_type = 'independent-annotation'
        AND s.user_id <> ?
        AND s.artifact_json IS NOT NULL`
  ).bind(
    finalArtifact.packet.packetId,
    adjudicatorUserId
  ).all();
  const acceptedRoots = new Set([
    finalArtifact.adjudication.annotationAMerkleRoot,
    finalArtifact.adjudication.annotationBMerkleRoot
  ]);
  for (const row of result.results || []) {
    if (!discussionNotificationsEnabled(row.consent_json)) continue;
    const priorArtifact = JSON.parse(row.artifact_json);
    const root = await computeAnnotationMerkleRoot(
      priorArtifact.packet,
      priorArtifact.annotation
    );
    if (!acceptedRoots.has(root)) continue;
    const differenceCount = countDecisionDifferences(
      priorArtifact.annotation,
      finalArtifact.adjudication
    );
    if (differenceCount === 0) continue;
    await enqueueNotification(env.DB, {
      recipientUserId: row.user_id,
      eventType: "final-result-difference",
      packetId: finalArtifact.packet.packetId,
      commentId: null,
      sourceReceiptId: row.receipt_id,
      context: {
        packetId: finalArtifact.packet.packetId,
        sourceReceiptId: row.receipt_id,
        finalReceiptId,
        actorPseudonym: finalPseudonym,
        differenceCount
      },
      dedupeKey:
        `final-result-difference:${finalReceiptId}:${row.user_id}`
    });
  }
}

async function enqueueNotification(db, value) {
  const now = Date.now();
  await db.prepare(
    `INSERT OR IGNORE INTO notification_outbox
      (id, recipient_user_id, event_type, packet_id, comment_id,
       source_receipt_id, context_json, dedupe_key, status, attempts,
       next_attempt_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
  ).bind(
    crypto.randomUUID(),
    value.recipientUserId,
    value.eventType,
    value.packetId,
    value.commentId,
    value.sourceReceiptId,
    JSON.stringify(value.context),
    value.dedupeKey,
    now,
    now
  ).run();
}

async function queueGovernanceNotifications(
  env,
  taskVersionId,
  eventType,
  context,
  dedupeKey
) {
  const recipients = await env.DB.prepare(
    `SELECT DISTINCT tp.user_id, u.consent_json
       FROM task_participations tp
       JOIN users u ON u.id = tp.user_id
      WHERE tp.task_version_id = ?`
  ).bind(taskVersionId).all();
  const now = Date.now();
  const writes = [];
  for (const row of recipients.results || []) {
    if (!discussionNotificationsEnabled(row.consent_json)) continue;
    writes.push(env.DB.prepare(
      `INSERT OR IGNORE INTO governance_notification_outbox
        (id, recipient_user_id, event_type, task_version_id,
         context_json, dedupe_key, status, attempts,
         next_attempt_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      row.user_id,
      eventType,
      taskVersionId,
      JSON.stringify(context),
      `${dedupeKey}:${row.user_id}`,
      now,
      now
    ));
  }
  if (writes.length) await env.DB.batch(writes);
}

function discussionNotificationsEnabled(consentJson) {
  const consent = JSON.parse(consentJson);
  return consent.discussionNotifications === true;
}

async function processGovernanceNotificationOutbox(env) {
  if (!notificationEmailAvailable(env)) {
    return;
  }
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE governance_notification_outbox
        SET status = 'pending'
      WHERE status = 'sending' AND next_attempt_at <= ?`
  ).bind(now).run();
  const pending = await env.DB.prepare(
    `SELECT id, recipient_user_id, event_type, task_version_id,
            context_json, attempts
       FROM governance_notification_outbox
      WHERE status = 'pending' AND next_attempt_at <= ?
      ORDER BY created_at
      LIMIT 20`
  ).bind(now).all();
  if (!(pending.results || []).length) return;
  const masterKey = await getVaultSecret(
    env.ENTITYCRYPT_MASTER_KEY_SECRET_NAME,
    env
  );
  for (const item of pending.results) {
    const claim = await env.DB.prepare(
      `UPDATE governance_notification_outbox
          SET status = 'sending', next_attempt_at = ?
        WHERE id = ? AND status = 'pending'`
    ).bind(now + 10 * 60 * 1000, item.id).run();
    if (Number(claim.meta?.changes || 0) !== 1) continue;
    try {
      const recipient = await env.DB.prepare(
        `SELECT profile_ciphertext, consent_json
           FROM users
          WHERE id = ?`
      ).bind(item.recipient_user_id).first();
      if (!recipient
          || !discussionNotificationsEnabled(recipient.consent_json)) {
        await env.DB.prepare(
          `UPDATE governance_notification_outbox
              SET status = 'skipped', last_error = NULL
            WHERE id = ?`
        ).bind(item.id).run();
        continue;
      }
      const profile = JSON.parse(await decryptEntityCrypt(
        recipient.profile_ciphertext,
        masterKey
      ));
      const content = governanceNotificationEmailContent(
        item.event_type,
        JSON.parse(item.context_json),
        env.ALLOWED_ORIGIN || DEFAULT_ORIGIN
      );
      await sendNotificationEmail(
        env,
        profile.email,
        content,
        "adjudication-governance",
        item.id
      );
      await env.DB.prepare(
        `UPDATE governance_notification_outbox
            SET status = 'sent', attempts = attempts + 1,
                sent_at = ?, last_error = NULL
          WHERE id = ?`
      ).bind(Date.now(), item.id).run();
    } catch (error) {
      const attempts = Number(item.attempts || 0) + 1;
      const terminal = attempts >= 5;
      await env.DB.prepare(
        `UPDATE governance_notification_outbox
            SET status = ?, attempts = ?, next_attempt_at = ?,
                last_error = ?
          WHERE id = ?`
      ).bind(
        terminal ? "failed" : "pending",
        attempts,
        Date.now() + Math.min(60, 2 ** attempts) * 60 * 1000,
        String(error?.message || "Governance notification failed.")
          .slice(0, 400),
        item.id
      ).run();
    }
  }
}

function governanceNotificationEmailContent(eventType, context, origin) {
  const descriptions = {
    "task-reissued": {
      subject: "أعيد طرح مهمة تحكيم ADG-Lang",
      body: "لم تكتمل شروط الإجماع، ففُتحت جولة مستقلة جديدة."
    },
    "j1-adjudication-required": {
      subject: "أُحيل اختلاف المحكّمين إلى التحكيم الرئيس",
      body:
        "اكتمل الحكمان المستقلان وظهر اختلاف يتطلب قرار المحكّم الرئيس J1."
    },
    "result-approved": {
      subject: "اعتماد مؤقت لنتيجة تحكيم ADG-Lang",
      body:
        "وقّع المراجع الثاني الجذر النهائي، وبدأت نافذة الاستئناف."
    },
    "result-published": {
      subject: "نشر نتيجة تحكيم ADG-Lang",
      body: "قُبل الدليل في المستودع وانتهت نافذة الاستئناف."
    },
    "result-revoked": {
      subject: "سحب نتيجة تحكيم ADG-Lang",
      body: "سُحبت النتيجة بعد مراجعة موثقة، وستبقى الأدلة السابقة محفوظة."
    },
    "appeal-opened": {
      subject: "فتح استئناف في مهمة ADG-Lang",
      body: "قُدم استئناف موثق على النتيجة المؤقتة وينتظر مراجعًا مستقلًا."
    },
    "appeal-decided": {
      subject: "صدور قرار استئناف ADG-Lang",
      body: "صدر قرار موثق في الاستئناف المرتبط بالمهمة."
    }
  };
  const descriptor = descriptions[eventType];
  if (!descriptor) throw new Error("Unsupported governance event.");
  const packetId = String(context.packetId || "");
  const link = `${stripTrailingSlashes(String(origin))}/`
    + `?packetId=${encodeURIComponent(packetId)}`;
  const details = [
    descriptor.body,
    "",
    `المهمة: ${packetId || context.taskVersionId}`,
    context.reason ? `السبب: ${context.reason}` : null,
    `الرابط: ${link}`
  ].filter(Boolean).join("\n");
  return {
    subject: descriptor.subject,
    plainText: details,
    html: `<p>${escapeEmailHtml(descriptor.body)}</p>`
      + `<p><strong>المهمة:</strong> ${escapeEmailHtml(
        packetId || context.taskVersionId
      )}</p>`
      + (context.reason
        ? `<p><strong>السبب:</strong> ${escapeEmailHtml(context.reason)}</p>`
        : "")
      + `<p><a href="${escapeEmailHtml(link)}">فتح المنصة</a></p>`
  };
}

function escapeEmailHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function processEvidenceOutbox(env) {
  if (!env.DB || !evidenceStorageAvailable(env)) {
    return;
  }
  const archiveMode = evidenceArchiveMode(env);
  const now = Date.now();
  const result = await env.DB.prepare(
    `SELECT id, kind, related_id, public_blob_name,
            identity_blob_name, public_payload_json,
            identity_payload_json, attempts
       FROM evidence_outbox
      WHERE status = 'pending' AND next_attempt_at <= ?
      ORDER BY created_at
      LIMIT 20`
  ).bind(now).all();
  if (!(result.results || []).length) return;

  if (archiveMode === "d1") {
    for (const item of result.results) {
      const claimed = await env.DB.prepare(
        `UPDATE evidence_outbox
            SET status = 'sending', next_attempt_at = ?
          WHERE id = ? AND status = 'pending'`
      ).bind(now + 10 * 60 * 1000, item.id).run();
      if (Number(claimed.meta?.changes || 0) !== 1) continue;
      await env.DB.prepare(
        `UPDATE evidence_outbox
            SET status = 'sent',
                sent_at = COALESCE(sent_at, ?),
                last_error = NULL
          WHERE id = ? AND status = 'sending'`
      ).bind(Date.now(), item.id).run();
    }
    return;
  }

  const [submissionSas, identitySas] = await Promise.all([
    storageUsesAzureSas(env, "submissions")
      ? getVaultSecret(env.SUBMISSION_SAS_SECRET_NAME, env)
      : Promise.resolve(null),
    storageUsesAzureSas(env, "identities")
      ? getVaultSecret(env.IDENTITY_SAS_SECRET_NAME, env)
      : Promise.resolve(null)
  ]);
  for (const item of result.results) {
    const claimed = await env.DB.prepare(
      `UPDATE evidence_outbox
          SET status = 'sending', next_attempt_at = ?
        WHERE id = ? AND status = 'pending'`
    ).bind(now + 10 * 60 * 1000, item.id).run();
    if (Number(claimed.meta?.changes || 0) !== 1) continue;
    try {
      if (item.identity_blob_name && item.identity_payload_json) {
        await putEvidenceBlob(
          env,
          "identities",
          item.identity_blob_name,
          item.identity_payload_json,
          identitySas
        );
      }
      await putEvidenceBlob(
        env,
        "submissions",
        item.public_blob_name,
        item.public_payload_json,
        submissionSas
      );
      await env.DB.prepare(
        `UPDATE evidence_outbox
            SET status = 'sent', attempts = attempts + 1,
                sent_at = ?, last_error = NULL
          WHERE id = ?`
      ).bind(Date.now(), item.id).run();
    } catch (error) {
      const attempts = Number(item.attempts) + 1;
      const terminal = attempts >= 8;
      const retryAt = Date.now()
        + Math.min(6 * 60 * 60 * 1000, 30000 * 2 ** attempts);
      await env.DB.prepare(
        `UPDATE evidence_outbox
            SET status = ?, attempts = ?, next_attempt_at = ?,
                last_error = ?
          WHERE id = ?`
      ).bind(
        terminal ? "failed" : "pending",
        attempts,
        retryAt,
        String(error?.message || "Evidence delivery failed.").slice(0, 400),
        item.id
      ).run();
    }
  }
}

async function processExpiredConsensusRounds(env) {
  if (!env.DB) return;
  const active = await env.DB.prepare(
    `SELECT id
       FROM task_versions
      WHERE state IN (
        'independent-review',
        'discussion',
        'final-review'
      )
      ORDER BY updated_at
      LIMIT 25`
  ).all();
  for (const row of active.results || []) {
    try {
      await reconcileConsensusTask(env, row.id);
    } catch (error) {
      console.error("ADG consensus reconciliation failed", {
        taskVersionId: row.id,
        message: error?.message
      });
    }
  }

  const missingStateEvidence = await env.DB.prepare(
    `SELECT tv.id
       FROM task_versions tv
       JOIN consensus_events ce ON ce.id = tv.last_event_id
       LEFT JOIN evidence_outbox eo
         ON eo.dedupe_key = 'task-state:' || ce.id
      WHERE eo.id IS NULL
      ORDER BY ce.created_at
      LIMIT 25`
  ).all();
  for (const row of missingStateEvidence.results || []) {
    try {
      await ensureTaskStateEvidence(
        env,
        await getConsensusTask(env.DB, row.id)
      );
    } catch (error) {
      console.error("ADG task-state evidence enqueue failed", {
        taskVersionId: row.id,
        message: error?.message
      });
    }
  }

  const now = Date.now();
  const expired = await env.DB.prepare(
    `SELECT tv.id
       FROM task_versions tv
       JOIN consensus_rounds cr
         ON cr.task_version_id = tv.id
        AND cr.round_number = tv.current_round
      WHERE tv.state = 'independent-review'
        AND cr.status = 'open'
        AND cr.deadline_at <= ?
      LIMIT 10`
  ).bind(now).all();
  for (const row of expired.results || []) {
    try {
      let task = await getConsensusTask(env.DB, row.id);
      const round = await getCurrentConsensusRound(env.DB, task);
      task = await transitionConsensusTask(env.DB, task, {
        toState: "escalated",
        roundId: round.id,
        eventType: "independent-quorum-expired",
        reasonCode: "missing-quorum-deadline",
        evidence: {
          deadlineAtUtc: new Date(round.deadline_at).toISOString()
        },
        idempotencyKey: `deadline-expired:${round.id}`
      });
      await ensureTaskStateEvidence(env, task);
      task = await createReissuedRound(
        env.DB,
        task,
        "missing-quorum-deadline",
        null
      );
      await ensureTaskStateEvidence(env, task);
      await queueGovernanceNotifications(
        env,
        task.id,
        "task-reissued",
        {
          taskVersionId: task.id,
          packetId: task.packet_id,
          reason: "missing-quorum-deadline"
        },
        `task-reissued:${task.last_event_id}`
      );
    } catch (error) {
      console.error("ADG consensus deadline handling failed", {
        taskVersionId: row.id,
        message: error?.message
      });
    }
  }
}

async function processPublishableTasks(env) {
  if (!env.DB) return;
  const result = await env.DB.prepare(
    `SELECT id
       FROM task_versions
      WHERE state = 'approved'
        AND repository_status = 'accepted'
        AND appeal_deadline_at IS NOT NULL
        AND appeal_deadline_at <= ?
      ORDER BY appeal_deadline_at
      LIMIT 25`
  ).bind(Date.now()).all();
  for (const row of result.results || []) {
    try {
      await attemptPublishTask(env, row.id);
    } catch (error) {
      if (!(error instanceof ConsensusConflict)) {
        console.error("ADG task publication failed", {
          taskVersionId: row.id,
          message: error?.message
        });
      }
    }
  }
}

async function processIdentityErasureRequests(env) {
  if (!env.DB
      || !secretCanBeResolved(env.ENTITYCRYPT_MASTER_KEY_SECRET_NAME, env)
      || !storageTargetAvailable(env, "identities")) {
    return;
  }
  const archiveMode = evidenceArchiveMode(env);
  const externalIdentityArchive = archiveMode !== "d1";
  const now = Date.now();
  const requests = await env.DB.prepare(
    `SELECT id, user_id, eligible_after
       FROM identity_erasure_requests
      WHERE status = 'pending' AND eligible_after <= ?
      ORDER BY requested_at
      LIMIT 10`
  ).bind(now).all();
  if (!(requests.results || []).length) return;
  const retentionMs = Math.min(
    730,
    Math.max(30, Number(env.IDENTITY_RETENTION_DAYS || 365))
  ) * 24 * 60 * 60 * 1000;
  const [identitySas, masterKey] = await Promise.all([
    storageUsesAzureSas(env, "identities")
      ? getVaultSecret(env.IDENTITY_SAS_SECRET_NAME, env)
      : Promise.resolve(null),
    getVaultSecret(env.ENTITYCRYPT_MASTER_KEY_SECRET_NAME, env)
  ]);
  for (const request of requests.results) {
    try {
      const taskBoundary = await env.DB.prepare(
        `SELECT MAX(tv.updated_at) AS latest_update,
                SUM(CASE
                  WHEN tv.state NOT IN ('published', 'revoked', 'failed')
                  THEN 1 ELSE 0
                END) AS active_count
           FROM task_participations tp
           JOIN task_versions tv ON tv.id = tp.task_version_id
          WHERE tp.user_id = ?`
      ).bind(request.user_id).first();
      const latestUpdate = Number(taskBoundary?.latest_update || 0);
      if (Number(taskBoundary?.active_count || 0) > 0
          || latestUpdate + retentionMs > now) {
        const retryAt = Math.max(
          now + 24 * 60 * 60 * 1000,
          latestUpdate + retentionMs
        );
        await env.DB.prepare(
          `UPDATE identity_erasure_requests
              SET eligible_after = ?
            WHERE id = ? AND status = 'pending'`
        ).bind(retryAt, request.id).run();
        continue;
      }
      if (externalIdentityArchive) {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO identity_erasure_items
            (request_id, blob_name, status)
           SELECT ?, receipt_id || '.json', 'pending'
             FROM submissions
            WHERE user_id = ?`
        ).bind(request.id, request.user_id).run();
        const items = await env.DB.prepare(
          `SELECT blob_name
             FROM identity_erasure_items
            WHERE request_id = ? AND status = 'pending'`
        ).bind(request.id).all();
        for (const item of items.results || []) {
          await deleteEvidenceBlob(
            env,
            "identities",
            item.blob_name,
            identitySas
          );
          await env.DB.prepare(
            `UPDATE identity_erasure_items
                SET status = 'deleted', deleted_at = ?
              WHERE request_id = ? AND blob_name = ?
                AND status = 'pending'`
          ).bind(Date.now(), request.id, item.blob_name).run();
        }
        const remaining = await env.DB.prepare(
          `SELECT COUNT(*) AS count
             FROM identity_erasure_items
            WHERE request_id = ? AND status <> 'deleted'`
        ).bind(request.id).first();
        if (Number(remaining?.count || 0) !== 0) continue;
      }
      const user = await env.DB.prepare(
        `SELECT verified_email_hash
           FROM users
          WHERE id = ?`
      ).bind(request.user_id).first();
      if (!user) {
        await env.DB.prepare(
          `UPDATE identity_erasure_requests
              SET status = 'completed', completed_at = ?
            WHERE id = ? AND status = 'pending'`
        ).bind(Date.now(), request.id).run();
        continue;
      }
      const completedAt = Date.now();
      const d1Backup = archiveMode === "d1"
        ? d1TimeTravelCompletionInfo(env, completedAt)
        : null;
      const tombstone = await encryptEntityCrypt(
        JSON.stringify({
          schema: "adg-erased-participant-v1",
          erasedAtUtc: new Date(completedAt).toISOString(),
          activeStoreDeletedAtUtc: new Date(completedAt).toISOString(),
          providerBackupRetention: d1Backup
            ? {
              provider: "cloudflare-d1-time-travel",
              mayRemainRecoverableUntilUtc:
                d1Backup.providerBackupExpiresAfterUtc,
              retentionDays: d1Backup.retentionDays
            }
            : null
        }),
        masterKey
      );
      const assignmentTombstoneHash = await sha256Hex(
        `erased-assignment-v1:${request.id}`
      );
      const assignmentTombstone = await encryptEntityCrypt(
        "هوية ممحوة",
        masterKey
      );
      const writes = [
        env.DB.prepare(
          `UPDATE users
              SET profile_ciphertext = ?,
                  consent_json = ?,
                  verified_email_hash = NULL,
                  updated_at = ?
            WHERE id = ?`
        ).bind(
          tombstone,
          JSON.stringify({
            identityStorage: false,
            futureContact: false,
            discussionNotifications: false
          }),
          completedAt,
          request.user_id
        ),
        env.DB.prepare(
          "DELETE FROM passkeys WHERE user_id = ?"
        ).bind(request.user_id),
        env.DB.prepare(
          "DELETE FROM sessions WHERE user_id = ?"
        ).bind(request.user_id),
        env.DB.prepare(
          "DELETE FROM draft_revisions WHERE user_id = ?"
        ).bind(request.user_id),
        env.DB.prepare(
          "DELETE FROM drafts WHERE user_id = ?"
        ).bind(request.user_id),
        env.DB.prepare(
          "DELETE FROM operational_task_claims WHERE user_id = ?"
        ).bind(request.user_id),
        env.DB.prepare(
          `UPDATE portal_issue_reports
              SET user_id = NULL, updated_at = ?
            WHERE user_id = ?`
        ).bind(completedAt, request.user_id),
        env.DB.prepare(
          `UPDATE task_assignments
              SET user_id = NULL,
                  email_hash = ?,
                  email_ciphertext = ?,
                  updated_at = ?
            WHERE user_id = ?
               OR email_hash = ?`
        ).bind(
          assignmentTombstoneHash,
          assignmentTombstone,
          completedAt,
          request.user_id,
          user.verified_email_hash
        ),
        env.DB.prepare(
          "DELETE FROM result_access WHERE user_id = ?"
        ).bind(request.user_id),
        env.DB.prepare(
          "DELETE FROM notification_outbox WHERE recipient_user_id = ?"
        ).bind(request.user_id),
        env.DB.prepare(
          `DELETE FROM governance_notification_outbox
            WHERE recipient_user_id = ?`
        ).bind(request.user_id),
        env.DB.prepare(
          "DELETE FROM webauthn_challenges WHERE user_id = ?"
        ).bind(request.user_id),
        env.DB.prepare(
          `UPDATE evidence_outbox
              SET identity_blob_name = NULL,
                  identity_payload_json = NULL
            WHERE related_id IN (
              SELECT receipt_id FROM submissions WHERE user_id = ?
            )`
        ).bind(request.user_id),
        env.DB.prepare(
          `UPDATE appeals
              SET appellant_user_id = NULL
            WHERE appellant_user_id = ?`
        ).bind(request.user_id),
        env.DB.prepare(
          `UPDATE identity_erasure_requests
              SET status = 'completed', completed_at = ?
            WHERE id = ? AND status = 'pending'`
        ).bind(completedAt, request.id)
      ];
      if (user.verified_email_hash) {
        writes.push(env.DB.prepare(
          "DELETE FROM email_verifications WHERE email_hash = ?"
        ).bind(user.verified_email_hash));
      }
      await env.DB.batch(writes);
    } catch (error) {
      console.error("ADG identity erasure deferred", {
        requestId: request.id,
        message: error?.message
      });
    }
  }
}

async function processNotificationOutbox(env) {
  if (!notificationEmailAvailable(env)) {
    return;
  }
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE notification_outbox
        SET status = 'pending'
      WHERE status = 'sending' AND next_attempt_at <= ?`
  ).bind(now).run();
  const pending = await env.DB.prepare(
    `SELECT id, recipient_user_id, event_type, context_json, attempts
       FROM notification_outbox
      WHERE status = 'pending' AND next_attempt_at <= ?
      ORDER BY created_at ASC
      LIMIT 20`
  ).bind(now).all();
  if (!pending.results?.length) return;

  const masterKey = await getVaultSecret(
    env.ENTITYCRYPT_MASTER_KEY_SECRET_NAME,
    env
  );
  for (const item of pending.results) {
    const claim = await env.DB.prepare(
      `UPDATE notification_outbox
          SET status = 'sending', next_attempt_at = ?
        WHERE id = ? AND status = 'pending'`
    ).bind(now + 10 * 60 * 1000, item.id).run();
    if (Number(claim.meta?.changes || 0) !== 1) continue;
    try {
      const recipient = await env.DB.prepare(
        `SELECT profile_ciphertext, consent_json
           FROM users
          WHERE id = ?`
      ).bind(item.recipient_user_id).first();
      if (!recipient
          || !discussionNotificationsEnabled(recipient.consent_json)) {
        await env.DB.prepare(
          `UPDATE notification_outbox
              SET status = 'skipped', last_error = NULL
            WHERE id = ?`
        ).bind(item.id).run();
        continue;
      }
      const profile = JSON.parse(await decryptEntityCrypt(
        recipient.profile_ciphertext,
        masterKey
      ));
      const context = JSON.parse(item.context_json);
      const content = notificationEmailContent(
        item.event_type,
        context,
        env.ALLOWED_ORIGIN || DEFAULT_ORIGIN
      );
      await sendNotificationEmail(
        env,
        profile.email,
        content,
        "adjudication-discussion",
        item.id
      );
      await env.DB.prepare(
        `UPDATE notification_outbox
            SET status = 'sent', attempts = attempts + 1,
                sent_at = ?, last_error = NULL
          WHERE id = ?`
      ).bind(Date.now(), item.id).run();
    } catch (error) {
      const attempts = Number(item.attempts || 0) + 1;
      const terminal = attempts >= 5;
      const retryAt = Date.now()
        + Math.min(60, 2 ** attempts) * 60 * 1000;
      console.error("ADG notification delivery failed", {
        notificationId: item.id,
        eventType: item.event_type,
        attempts,
        message: error?.message
      });
      await env.DB.prepare(
        `UPDATE notification_outbox
            SET status = ?, attempts = ?, next_attempt_at = ?,
                last_error = ?
          WHERE id = ?`
      ).bind(
        terminal ? "failed" : "pending",
        attempts,
        retryAt,
        String(error?.message || "Notification delivery failed.")
          .slice(0, 400),
        item.id
      ).run();
    }
  }
}

function graphMailTransportAvailable(env) {
  if (!env?.MAILER_TENANT_ID
      || !env?.MAILER_CLIENT_ID
      || !env?.MAILER_CLIENT_SECRET) {
    return false;
  }
  try {
    return Boolean(configuredMailerSenderAddress(env));
  } catch {
    return false;
  }
}

function azureMailTransportAvailable(env) {
  return Boolean(
    env.ACS_EMAIL_ENDPOINT
    && env.ACS_EMAIL_SENDER_ADDRESS
    && env.AZURE_TENANT_ID
    && env.AZURE_CLIENT_ID
    && env.AZURE_CLIENT_SECRET
  );
}

function mailTransportAvailable(env) {
  return graphMailTransportAvailable(env)
    || azureMailTransportAvailable(env);
}

function evidenceStorageAvailable(env) {
  return storageTargetAvailable(env, "submissions")
    && storageTargetAvailable(env, "identities");
}

function notificationEmailAvailable(env) {
  return String(env.NOTIFICATION_EMAIL_ENABLED).toLowerCase() === "true"
    && Boolean(
      env.DB
      && mailTransportAvailable(env)
      && secretCanBeResolved(env.ENTITYCRYPT_MASTER_KEY_SECRET_NAME, env)
    );
}

function storageTargetAvailable(env, scope) {
  switch (evidenceArchiveMode(env)) {
    case "d1":
      return true;
    case "r2":
      return Boolean(r2BucketForScope(env, scope));
    case "azure":
      return azureStorageScopeAvailable(env, scope);
    default:
      return false;
  }
}

function storageUsesAzureSas(env, scope) {
  return evidenceArchiveMode(env) === "azure"
    && azureStorageScopeAvailable(env, scope);
}

function evidenceArchiveMode(env) {
  const value = String(env?.EVIDENCE_ARCHIVE_MODE || "d1")
    .trim()
    .toLowerCase();
  if (!EVIDENCE_ARCHIVE_MODES.has(value)) {
    throw new Error(
      "EVIDENCE_ARCHIVE_MODE must be one of d1, r2, azure."
    );
  }
  return value;
}

function d1TimeTravelRetentionSummary(env) {
  const retentionDays = Math.min(
    365,
    Math.max(
      1,
      Number.parseInt(
        String(
          env?.D1_TIME_TRAVEL_RETENTION_DAYS
          ?? DEFAULT_D1_TIME_TRAVEL_RETENTION_DAYS
        ),
        10
      ) || DEFAULT_D1_TIME_TRAVEL_RETENTION_DAYS
    )
  );
  return { retentionDays };
}

function d1TimeTravelCompletionInfo(env, completedAt) {
  const summary = d1TimeTravelRetentionSummary(env);
  return {
    ...summary,
    providerBackupExpiresAfterUtc: new Date(
      completedAt + summary.retentionDays * 24 * 60 * 60 * 1000
    ).toISOString()
  };
}

function azureStorageScopeAvailable(env, scope) {
  return Boolean(
    (scope === "submissions"
      ? env.SUBMISSION_SAS_SECRET_NAME
      : env.IDENTITY_SAS_SECRET_NAME)
    && env.AZURE_TENANT_ID
    && env.AZURE_CLIENT_ID
    && env.AZURE_CLIENT_SECRET
    && env.AZURE_KEY_VAULT_URL
  );
}

function secretCanBeResolved(name, env) {
  return Boolean(resolveDirectSecretBinding(name, env))
    || Boolean(
      name
      && env.AZURE_TENANT_ID
      && env.AZURE_CLIENT_ID
      && env.AZURE_CLIENT_SECRET
      && env.AZURE_KEY_VAULT_URL
    );
}

async function sendNotificationEmail(
  env,
  recipientEmail,
  content,
  messageType,
  correlationId
) {
  if (graphMailTransportAvailable(env)) {
    await sendGraphMail(
      env,
      recipientEmail,
      content,
      messageType,
      correlationId
    );
    return;
  }
  await sendAzureEmail(
    env,
    recipientEmail,
    content,
    messageType
  );
}

async function sendGraphMail(
  env,
  recipientEmail,
  content,
  messageType,
  correlationId
) {
  const senderAddress = configuredMailerSenderAddress(env);
  const token = await getMailerGraphToken(env);
  const internetMessageHeaders = [{
    name: "X-ADG-Notification-Type",
    value: String(messageType || "notification")
  }];
  if (correlationId) {
    internetMessageHeaders.push({
      name: "X-ADG-Correlation-Id",
      value: String(correlationId)
    });
  }
  const response = await fetchWithTimeout(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
      senderAddress
    )}/sendMail`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        message: {
          subject: String(content?.subject || ""),
          body: {
            contentType: "HTML",
            content: String(
              content?.html
              || `<pre>${escapeEmailHtml(content?.plainText || "")}</pre>`
            )
          },
          toRecipients: [{
            emailAddress: {
              address: recipientEmail
            }
          }],
          internetMessageHeaders
        },
        saveToSentItems: true
      })
    },
    GRAPH_MAIL_TIMEOUT_MS,
    "Microsoft Graph sendMail"
  );
  if (response.status !== 202) {
    const detail = await safeResponseText(response);
    throw new Error(
      `Microsoft Graph sendMail returned ${response.status}: `
        + detail.slice(0, 300)
    );
  }
}

async function sendAzureEmail(
  env,
  recipientEmail,
  content,
  messageType
) {
  const endpoint = stripTrailingSlashes(
    String(env.ACS_EMAIL_ENDPOINT || "")
  );
  const senderAddress = String(env.ACS_EMAIL_SENDER_ADDRESS || "");
  if (!endpoint || !senderAddress) {
    throw new Error("Azure email notification settings are missing.");
  }
  const token = await getAzureToken(
    env,
    env.ACS_EMAIL_SCOPE || "https://communication.azure.com/.default"
  );
  const operationId = crypto.randomUUID();
  const response = await fetch(
    `${endpoint}/emails:send?api-version=2023-03-31`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
        "operation-id": operationId,
        "x-ms-client-request-id": operationId
      },
      body: JSON.stringify({
        senderAddress,
        content,
        recipients: {
          to: [{ address: recipientEmail }]
        },
        headers: {
          "X-ADG-Notification-Type": messageType
        },
        userEngagementTrackingDisabled: true
      })
    }
  );
  if (response.status !== 202) {
    const detail = await response.text();
    throw new Error(
      `Azure email returned ${response.status}: ${detail.slice(0, 300)}`
    );
  }
}

function configuredMailerSenderAddress(env) {
  const value = String(env?.MAILER_SENDER_ADDRESS || "");
  try {
    return normalizeVerificationEmail(value);
  } catch {
    throw new Error("MAILER_SENDER_ADDRESS is invalid.");
  }
}

async function getMailerGraphToken(env) {
  return getMicrosoftGraphClientToken({
    tenantId: env.MAILER_TENANT_ID,
    clientId: env.MAILER_CLIENT_ID,
    clientSecret: env.MAILER_CLIENT_SECRET,
    scope: GRAPH_APP_SCOPE,
    cacheKey: `mailer:${String(env.MAILER_TENANT_ID || "")}:`
      + String(env.MAILER_CLIENT_ID || ""),
    label: "Microsoft Graph mail token"
  });
}

async function getMicrosoftGraphClientToken({
  tenantId,
  clientId,
  clientSecret,
  scope,
  cacheKey,
  label,
  validateAccessToken
}) {
  const normalizedTenantId = String(tenantId || "").trim();
  const normalizedClientId = String(clientId || "").trim();
  const normalizedClientSecret = String(clientSecret || "");
  const resolvedScope = String(scope || GRAPH_APP_SCOPE).trim();
  if (!normalizedTenantId
      || !normalizedClientId
      || !normalizedClientSecret
      || !resolvedScope) {
    throw new Error(`${label} settings are missing.`);
  }
  const key = `${cacheKey}:${resolvedScope}`;
  const cached = graphAppTokenCache.get(key);
  if (cached?.expiresAt > Date.now()) {
    return cached.value;
  }
  const response = await fetchWithTimeout(
    `https://login.microsoftonline.com/${normalizedTenantId}`
      + "/oauth2/v2.0/token",
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        client_id: normalizedClientId,
        client_secret: normalizedClientSecret,
        scope: resolvedScope,
        grant_type: "client_credentials"
      })
    },
    GRAPH_MAIL_TIMEOUT_MS,
    label
  );
  if (!response.ok) {
    throw new Error(`${label} returned ${response.status}.`);
  }
  const result = await response.json();
  if (typeof result.access_token !== "string") {
    throw new Error(`${label} was not issued.`);
  }
  const accessToken = await validateAccessToken?.(result.access_token)
    ?? result.access_token;
  const token = {
    value: accessToken,
    expiresAt: Date.now()
      + Math.max(60, Number(result.expires_in) - 300) * 1000
  };
  graphAppTokenCache.set(key, token);
  return token.value;
}

async function fetchWithTimeout(input, init, timeoutMs, label) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${label} timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function safeResponseText(response) {
  try {
    return String(await response.text() || "");
  } catch {
    return "";
  }
}

function stripTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return value.slice(0, end);
}

function resolveDirectSecretBinding(name, env) {
  if (!name) return null;
  for (const [nameField, valueField] of [
    ["ENTITYCRYPT_MASTER_KEY_SECRET_NAME", "ENTITYCRYPT_MASTER_KEY"],
    ["SUBMISSION_HMAC_SECRET_NAME", "SUBMISSION_HMAC_KEY"],
    [
      "REPOSITORY_RECEIPT_HMAC_SECRET_NAME",
      "REPOSITORY_RECEIPT_HMAC_KEY"
    ],
    [
      "EMAIL_VERIFICATION_HMAC_SECRET_NAME",
      "EMAIL_VERIFICATION_HMAC_KEY"
    ],
    ["ENTRA_CLIENT_SECRET_NAME", "ENTRA_CLIENT_SECRET"]
  ]) {
    if (env?.[nameField] === name && env?.[valueField]) {
      return env[valueField];
    }
  }
  return null;
}

async function verifyTurnstile(token, remoteIp, env) {
  if (!env.TURNSTILE_SECRET) {
    throw new Error("TURNSTILE_SECRET is not configured.");
  }
  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET,
    response: token,
    idempotency_key: crypto.randomUUID()
  });
  if (remoteIp) body.set("remoteip", remoteIp);
  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body
    }
  );
  if (!response.ok) {
    throw new Error(`Turnstile returned ${response.status}.`);
  }
  return response.json();
}

export async function getVaultSecret(name, env) {
  if (!name) throw new Error("A Key Vault secret name is missing.");
  const directValue = resolveDirectSecretBinding(name, env);
  if (directValue) return directValue;
  const cached = secretCache.get(name);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const token = await getAzureToken(env);
  const vaultUrl = stripTrailingSlashes(
    String(env.AZURE_KEY_VAULT_URL || "")
  );
  if (!vaultUrl) throw new Error("AZURE_KEY_VAULT_URL is missing.");
  const response = await fetch(
    `${vaultUrl}/secrets/${encodeURIComponent(name)}`
      + "?api-version=2025-07-01",
    {
      headers: { authorization: `Bearer ${token}` }
    }
  );
  if (!response.ok) {
    throw new Error(
      `Key Vault secret '${name}' returned ${response.status}.`);
  }
  const result = await response.json();
  secretCache.set(name, {
    value: result.value,
    expiresAt: Date.now() + 10 * 60 * 1000
  });
  return result.value;
}

async function getAzureToken(
  env,
  scope = "https://vault.azure.net/.default"
) {
  const cached = azureTokenCache.get(scope);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const body = new URLSearchParams({
    client_id: env.AZURE_CLIENT_ID,
    client_secret: env.AZURE_CLIENT_SECRET,
    scope,
    grant_type: "client_credentials"
  });
  const response = await fetch(
    `https://login.microsoftonline.com/${env.AZURE_TENANT_ID}`
      + "/oauth2/v2.0/token",
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body
    }
  );
  if (!response.ok) {
    throw new Error(`Azure token endpoint returned ${response.status}.`);
  }
  const result = await response.json();
  const token = {
    value: result.access_token,
    expiresAt: Date.now()
      + Math.max(60, Number(result.expires_in) - 300) * 1000
  };
  azureTokenCache.set(scope, token);
  return token.value;
}

async function putEvidenceBlob(env, scope, fileName, content, containerSasUrl) {
  switch (evidenceArchiveMode(env)) {
    case "d1":
      return;
    case "r2": {
      const bucket = r2BucketForScope(env, scope);
      if (!bucket) {
        throw new Error(`R2 ${scope} binding is missing.`);
      }
      await putR2EvidenceObject(bucket, scope, fileName, content);
      return;
    }
    case "azure":
      await putBlob(containerSasUrl, fileName, content);
      return;
    default:
      throw new Error("Unsupported evidence archive mode.");
  }
}

async function deleteEvidenceBlob(env, scope, fileName, containerSasUrl) {
  switch (evidenceArchiveMode(env)) {
    case "d1":
      return;
    case "r2": {
      const bucket = r2BucketForScope(env, scope);
      if (!bucket) {
        throw new Error(`R2 ${scope} binding is missing.`);
      }
      await deleteR2EvidenceObject(bucket, scope, fileName);
      return;
    }
    case "azure":
      await deleteBlob(containerSasUrl, fileName);
      return;
    default:
      throw new Error("Unsupported evidence archive mode.");
  }
}

function r2BucketForScope(env, scope) {
  const bucket = scope === "submissions"
    ? env?.SUBMISSION_OBJECTS
    : scope === "identities"
      ? env?.IDENTITY_OBJECTS
      : null;
  return bucket
    && typeof bucket.put === "function"
    && typeof bucket.delete === "function"
    ? bucket
    : null;
}

function validateEvidenceObjectName(scope, fileName) {
  const value = String(fileName || "");
  const patterns = scope === "identities"
    ? [{
      pattern: /^([0-9a-f-]{36})\.json$/i,
      objectKind: "identity-envelope",
      privacyTier: "protected"
    }]
    : [{
      pattern: /^([0-9a-f-]{36})\.json$/i,
      objectKind: "submission",
      privacyTier: "public"
    }, {
      pattern: /^comment-([0-9a-f-]{36})\.json$/i,
      objectKind: "comment",
      privacyTier: "public"
    }, {
      pattern: /^([0-9a-f-]{36})\.state\.json$/i,
      objectKind: "task-state",
      privacyTier: "public"
    }];
  for (const descriptor of patterns) {
    const match = value.match(descriptor.pattern);
    if (match && isUuid(match[1])) {
      return descriptor;
    }
  }
  throw new Error(`Invalid ${scope} evidence object name.`);
}

async function putR2EvidenceObject(bucket, scope, fileName, content) {
  const descriptor = validateEvidenceObjectName(scope, fileName);
  try {
    await bucket.put(fileName, content, {
      httpMetadata: {
        contentType: JSON_OBJECT_CONTENT_TYPE
      },
      customMetadata: {
        "adg-scope": scope,
        "adg-object-kind": descriptor.objectKind,
        "adg-privacy-tier": descriptor.privacyTier
      }
    });
  } catch (error) {
    throw new Error(
      `R2 ${scope} upload failed: ${String(error?.message || error)}`
    );
  }
}

async function deleteR2EvidenceObject(bucket, scope, fileName) {
  validateEvidenceObjectName(scope, fileName);
  try {
    await bucket.delete(fileName);
  } catch (error) {
    throw new Error(
      `R2 ${scope} deletion failed: ${String(error?.message || error)}`
    );
  }
}

async function putBlob(containerSasUrl, fileName, content) {
  const url = new URL(containerSasUrl);
  url.pathname = `${stripTrailingSlashes(url.pathname)}/${fileName}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "content-type": JSON_OBJECT_CONTENT_TYPE,
      "x-ms-blob-type": "BlockBlob",
      "x-ms-version": "2023-11-03"
    },
    body: content
  });
  if (!response.ok) {
    throw new Error(`Azure Blob upload returned ${response.status}.`);
  }
}

async function deleteBlob(containerSasUrl, fileName) {
  const url = new URL(containerSasUrl);
  url.pathname = `${stripTrailingSlashes(url.pathname)}/${fileName}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      "x-ms-version": "2023-11-03"
    }
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Azure Blob deletion returned ${response.status}.`);
  }
}

async function hmacSha256(secret, text) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(text)
  );
  return toHex(signature);
}

async function verifyHmacSha256(secret, text, signatureHex) {
  if (!/^[a-f0-9]{64}$/.test(signatureHex || "")) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    hexToBytes(signatureHex),
    encoder.encode(text)
  );
}

function hexToBytes(value) {
  return Uint8Array.from(
    value.match(/.{2}/g),
    pair => Number.parseInt(pair, 16)
  );
}

export async function encryptEntityCrypt(plainText, masterKey) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(masterKey),
    "HKDF",
    false,
    ["deriveKey"]
  );
  const aesKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("Matryoshka.AES256.v1"),
      info: encoder.encode("matryoshka-value-encryption")
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cipherAndTag = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, tagLength: 128 },
    aesKey,
    encoder.encode(plainText)
  ));
  const tag = cipherAndTag.slice(cipherAndTag.length - 16);
  const cipher = cipherAndTag.slice(0, cipherAndTag.length - 16);
  return `MK1:0:${bytesToBase64(concatBytes(nonce, tag, cipher))}`;
}

export async function decryptEntityCryptForTest(cipherText, masterKey) {
  if (!cipherText.startsWith("MK1:0:")) {
    throw new Error("Invalid EntityCrypt envelope.");
  }
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(masterKey),
    "HKDF",
    false,
    ["deriveKey"]
  );
  const aesKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("Matryoshka.AES256.v1"),
      info: encoder.encode("matryoshka-value-encryption")
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  const combined = base64ToBytes(cipherText.slice("MK1:0:".length));
  if (combined.length < 28) {
    throw new Error("Invalid EntityCrypt ciphertext length.");
  }
  const nonce = combined.slice(0, 12);
  const tag = combined.slice(12, 28);
  const cipher = combined.slice(28);
  const plainBytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce, tagLength: 128 },
    aesKey,
    concatBytes(cipher, tag)
  );
  return new TextDecoder().decode(plainBytes);
}

async function decryptEntityCrypt(cipherText, masterKey) {
  return decryptEntityCryptForTest(cipherText, masterKey);
}

async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)));
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map(value => value.toString(16).padStart(2, "0"))
    .join("");
}

function concatBytes(...arrays) {
  const length = arrays.reduce((sum, value) => sum + value.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const value of arrays) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function containsKey(value, keys) {
  if (Array.isArray(value)) {
    return value.some(item => containsKey(item, keys));
  }
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) =>
    keys.has(key) || containsKey(child, keys));
}

function enforceOrigin(request, env) {
  const expected = env.ALLOWED_ORIGIN || DEFAULT_ORIGIN;
  const origin = request.headers.get("origin");
  if (origin && origin !== expected) {
    throw new PublicError("مصدر الطلب غير مسموح.", 403);
  }
}

function redirectLegacyOrigin(request, env, url) {
  if (!["GET", "HEAD"].includes(request.method)
      || url.hostname !== LEGACY_HOST) {
    return null;
  }
  const target = new URL(env.ALLOWED_ORIGIN || DEFAULT_ORIGIN);
  if (target.hostname === LEGACY_HOST) return null;
  target.pathname = url.pathname;
  target.search = url.search;
  return new Response(null, {
    status: 308,
    headers: {
      location: target.toString(),
      "cache-control": "public, max-age=3600"
    }
  });
}

function isUuid(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}

function json(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...extraHeaders
    }
  });
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set(
    "content-security-policy",
    "default-src 'self'; "
      + "script-src 'self' https://challenges.cloudflare.com; "
      + "style-src 'self'; img-src 'self' data:; "
      + "connect-src 'self' https://challenges.cloudflare.com; "
      + "frame-src https://challenges.cloudflare.com; "
      + "font-src 'self'; object-src 'none'; base-uri 'self'; "
      + "form-action 'self'; frame-ancestors 'none';"
  );
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), "
      + "publickey-credentials-create=(self), "
      + "publickey-credentials-get=(self)"
  );
  headers.set(
    "strict-transport-security",
    "max-age=31536000; includeSubDomains"
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

class PublicError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "PublicError";
    this.status = status;
  }
}
