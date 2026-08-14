import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} from "@simplewebauthn/server";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const SESSION_COOKIE_NAME = "ads_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_ACCOUNT_BODY_BYTES = 750000;
const ADMIN_COOKIE_NAME = "ads_admin";
const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const ADMIN_STATE_TTL_MS = 10 * 60 * 1000;
const GLOBAL_ADMIN_ROLE_TEMPLATE_ID =
  "62e90394-69f5-4237-9190-012177145e10";

const PII_KEYS = new Set([
  "fullName",
  "email",
  "phone",
  "affiliation"
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

let azureTokenCache = null;
const secretCache = new Map();
let entraMetadataCache = null;
let entraJwksCache = null;
let graphAppTokenCache = null;
const adminRoleCache = new Map();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/config" && request.method === "GET") {
        return json({
          submissionEnabled:
            String(env.SUBMISSION_ENABLED).toLowerCase() === "true",
          maxSubmissionBytes: Number(env.MAX_SUBMISSION_BYTES || 900000),
          turnstileSiteKey: env.TURNSTILE_SITE_KEY || null,
          repository:
            env.GITHUB_REPOSITORY || "sbay-dev/ADG-Lang",
          accountEnabled: Boolean(env.DB)
        });
      }

      const adminResponse = await routeAdminRequest(request, env, url);
      if (adminResponse) {
        return adminResponse;
      }

      const accountResponse = await routeAccountRequest(
        request,
        env,
        url
      );
      if (accountResponse) {
        return accountResponse;
      }

      if (url.pathname === "/api/submissions"
          && request.method === "POST") {
        enforceOrigin(request, env);
        return await receiveSubmission(request, env);
      }

      if (url.pathname.startsWith("/api/")) {
        return json({ message: "المسار المطلوب غير موجود." }, 404);
      }

      if (url.pathname === "/admin") {
        return Response.redirect(`${url.origin}/admin/`, 302);
      }

      const asset = await env.ASSETS.fetch(request);
      return withSecurityHeaders(asset);
    } catch (error) {
      if (!(error instanceof PublicError && error.status < 500)) {
        console.error("ADS request failed", {
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
    }
  }
};

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
  const [usersResult, draftsResult, submissionsResult] =
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
    participants.push({
      userId: user.id,
      fullName: profile.fullName,
      email: profile.email,
      phone: profile.phone,
      specialization: profile.specialization,
      affiliation: profile.affiliation,
      experienceYears: profile.experienceYears,
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
    participants
  });
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
  if (graphAppTokenCache?.expiresAt > Date.now()) {
    return graphAppTokenCache.value;
  }
  const clientSecret = await getVaultSecret(
    env.ENTRA_CLIENT_SECRET_NAME,
    env
  );
  const response = await fetch(
    `https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}`
      + "/oauth2/v2.0/token",
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        client_id: env.ENTRA_CLIENT_ID,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials"
      })
    }
  );
  if (!response.ok) {
    throw new Error(
      `Microsoft Graph app token returned ${response.status}.`
    );
  }
  const result = await response.json();
  if (typeof result.access_token !== "string") {
    throw new Error("Microsoft Graph app token was not issued.");
  }
  const claims = decodeJwtJson(result.access_token.split(".")[1] || "");
  if (!signedRoleIds(claims.roles).includes(
    "RoleManagement.Read.Directory"
  )) {
    throw new Error(
      "Microsoft Graph RoleManagement.Read.Directory is missing."
    );
  }
  graphAppTokenCache = {
    value: result.access_token,
    expiresAt: Date.now()
      + Math.max(60, Number(result.expires_in) - 300) * 1000
  };
  return graphAppTokenCache.value;
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
      && path !== "/api/drafts") {
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
  if (path === "/api/account/register/verify"
      && request.method === "POST") {
    enforceOrigin(request, env);
    return finishRegistration(await readJsonBody(request), env);
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
  if (path === "/api/account/logout"
      && request.method === "POST") {
    enforceOrigin(request, env);
    return logout(request, env);
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

  return json({ message: "المسار المطلوب غير موجود." }, 404);
}

async function beginRegistration(body, env) {
  const profile = validateAccountProfile(body?.profile);
  const consent = validateAccountConsent(body?.consent);
  const userId = crypto.randomUUID();
  const { origin, rpId } = relyingParty(env);
  const secret = await getVaultSecret(
    env.ENTITYCRYPT_MASTER_KEY_SECRET_NAME,
    env
  );
  const profileCiphertext = await encryptEntityCrypt(
    JSON.stringify(profile),
    secret
  );
  const options = await generateRegistrationOptions({
    rpName: "منصة تحكيم ADG للغة العربية",
    rpID: rpId,
    userID: new TextEncoder().encode(userId),
    userName: `ads-${userId.slice(0, 12)}`,
    userDisplayName: "محكّم اللغة العربية",
    timeout: 120000,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "required"
    }
  });
  const challengeId = crypto.randomUUID();
  const now = Date.now();

  await pruneAuthRecords(env.DB, now);
  await env.DB.prepare(
    `INSERT INTO webauthn_challenges
      (id, challenge, kind, user_id, profile_ciphertext,
       consent_json, expires_at)
     VALUES (?, ?, 'registration', ?, ?, ?, ?)`
  ).bind(
    challengeId,
    options.challenge,
    userId,
    profileCiphertext,
    JSON.stringify(consent),
    now + CHALLENGE_TTL_MS
  ).run();

  return json({ challengeId, options, origin });
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
  const { origin, rpId } = relyingParty(env);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
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
  const credential = info.credential;
  const now = Date.now();
  const session = await createSessionRecord(challenge.user_id, now);
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users
          (id, profile_ciphertext, consent_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(
        challenge.user_id,
        challenge.profile_ciphertext,
        challenge.consent_json,
        now,
        now
      ),
      env.DB.prepare(
        `INSERT INTO passkeys
          (credential_id, user_id, public_key, counter,
           transports_json, device_type, backed_up, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        credential.id,
        challenge.user_id,
        base64UrlFromBytes(credential.publicKey),
        credential.counter,
        JSON.stringify(credential.transports || []),
        info.credentialDeviceType,
        info.credentialBackedUp ? 1 : 0,
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
      )
    ]);
  } catch {
    throw new PublicError(
      "هذا المفتاح مسجل مسبقًا أو تعذر إنشاء الحساب.",
      409
    );
  }

  return json(
    {
      authenticated: true,
      userId: challenge.user_id,
      message: "تم إنشاء الحساب وحفظ مفتاح المرور."
    },
    201,
    { "set-cookie": sessionCookie(env, session.token) }
  );
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
  return json({
    authenticated: true,
    userId: account.user_id,
    profile: JSON.parse(profileText),
    consent: JSON.parse(account.consent_json)
  });
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
  const ciphertext = await encryptEntityCrypt(draftText, secret);
  const updatedAt = Date.now();
  const progress = calculateDraftProgress(body.draft);
  await env.DB.prepare(
    `INSERT INTO drafts
      (user_id, packet_id, role, ciphertext, updated_at,
       completion_percent, completed_fields, total_fields, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, packet_id, role)
     DO UPDATE SET ciphertext = excluded.ciphertext,
                   updated_at = excluded.updated_at,
                   completion_percent = excluded.completion_percent,
                   completed_fields = excluded.completed_fields,
                   total_fields = excluded.total_fields`
  ).bind(
    account.user_id,
    key.packetId,
    key.role,
    ciphertext,
    updatedAt,
    progress.percentage,
    progress.completed,
    progress.total,
    updatedAt
  ).run();
  return json({
    saved: true,
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
    `SELECT packet_id, role, completion_percent, updated_at
       FROM drafts
      WHERE user_id = ?
      ORDER BY updated_at DESC
      LIMIT 20`
  ).bind(account.user_id).all();
  return json({
    drafts: (result.results || []).map(row => ({
      packetId: row.packet_id,
      role: row.role,
      progressPercent: Number(row.completion_percent),
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

function validateAccountProfile(profile) {
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
  const email = normalizedText(
    profile.email,
    5,
    160,
    "البريد الإلكتروني"
  ).toLowerCase();
  const phone = normalizedText(profile.phone, 7, 32, "رقم الهاتف");
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
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new PublicError("البريد الإلكتروني غير صالح.", 400);
  }
  if (!/^\+?[0-9 ()-]{7,24}$/.test(phone)) {
    throw new PublicError("رقم الهاتف غير صالح.", 400);
  }
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
  return {
    fullName,
    email,
    phone,
    experienceYears,
    specialization,
    affiliation
  };
}

function validateAccountConsent(consent) {
  if (!consent || consent.identityStorage !== true) {
    throw new PublicError(
      "الموافقة على حفظ بيانات الحساب مطلوبة.",
      400
    );
  }
  return {
    identityStorage: true,
    futureContact: consent.futureContact === true
  };
}

function validateDraftKey(packetId, role) {
  const normalizedPacketId = normalizedText(
    packetId,
    1,
    160,
    "معرف المهمة"
  );
  if (!["A", "B", "adjudication"].includes(role)) {
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
            consent_json, expires_at
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
      "DELETE FROM webauthn_challenges WHERE expires_at <= ?"
    ).bind(now),
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now)
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
            u.consent_json
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
  const task = submissionTask(submission.artifact);

  const receiptId = crypto.randomUUID();
  const receivedAtUtc = new Date().toISOString();
  const entityCryptMasterKey = await getVaultSecret(
    env.ENTITYCRYPT_MASTER_KEY_SECRET_NAME,
    env
  );
  const storedProfile = JSON.parse(await decryptEntityCrypt(
    account.profile_ciphertext,
    entityCryptMasterKey
  ));
  const storedConsent = JSON.parse(account.consent_json);
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
    participantPseudonym: `ads-${receiptId.slice(0, 12)}`,
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
  const identitySas = await getVaultSecret(
    env.IDENTITY_SAS_SECRET_NAME,
    env
  );
  const submissionSas = await getVaultSecret(
    env.SUBMISSION_SAS_SECRET_NAME,
    env
  );

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

  await putBlob(
    identitySas,
    `${receiptId}.json`,
    JSON.stringify(identityEnvelope, null, 2) + "\n"
  );
  await putBlob(
    submissionSas,
    `${receiptId}.json`,
    JSON.stringify(signedEnvelope, null, 2) + "\n"
  );
  await env.DB.prepare(
    `INSERT INTO submissions
      (receipt_id, user_id, packet_id, role,
       artifact_sha256, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    receiptId,
    account.user_id,
    task.packetId,
    task.role,
    actualArtifactSha256,
    Date.parse(receivedAtUtc)
  ).run();

  return json({
    accepted: true,
    receiptId,
    repositoryImportStatus: "pending-validation"
  }, 202);
}

function submissionTask(artifact) {
  const packetId = artifact?.packet?.packetId;
  const role = artifact?.kind === "independent-annotation"
    ? artifact?.annotation?.annotatorSlot
    : artifact?.kind === "adjudication-package"
      ? "adjudication"
      : null;
  return validateDraftKey(packetId, role);
}

function validateSubmission(value) {
  if (!value || value.schema !== "adg-msa-portal-submission-v1"
      || !isUuid(value.participantId)
      || value.artifactType
        !== value.artifact?.kind
      || !/^[a-f0-9]{64}$/.test(value.artifactSha256 || "")
      || typeof value.clientVersion !== "string") {
    throw new PublicError("غلاف التقييم غير صالح.", 400);
  }

  const profile = value.profile;
  if (!profile
      || !boundedText(profile.fullName, 2, 120)
      || !boundedText(profile.email, 5, 160)
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)
      || !boundedText(profile.phone, 7, 32)
      || !/^\+?[0-9 ()-]{7,24}$/.test(profile.phone)
      || !Number.isInteger(profile.experienceYears)
      || profile.experienceYears < 0
      || profile.experienceYears > 80
      || !boundedText(profile.specialization, 2, 60)
      || (profile.affiliation !== null
        && !boundedText(profile.affiliation, 1, 160))) {
    throw new PublicError("بيانات المحكّم ناقصة أو غير صالحة.", 400);
  }

  if (value.consent?.identityStorage !== true
      || value.attestation?.independent !== true
      || value.attestation?.blind !== true
      || value.attestation?.authentic !== true) {
    throw new PublicError("الموافقات والتعهدات المطلوبة غير مكتملة.", 400);
  }
  if (!value.turnstileToken
      || typeof value.turnstileToken !== "string"
      || value.turnstileToken.length > 4096) {
    throw new PublicError("رمز الحماية غير صالح.", 400);
  }
  if (!value.artifact
      || value.artifact.schema !== "adg-msa-portal-artifact-v1"
      || !["independent-annotation", "adjudication-package"]
        .includes(value.artifact.kind)
      || containsKey(value.artifact, PII_KEYS)
      || containsKey(value.artifact, FORBIDDEN_ANALYSIS_KEYS)) {
    throw new PublicError(
      "ملف النتيجة يحتوي بيانات هوية أو تحليلًا محظورًا.",
      400
    );
  }
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

async function getVaultSecret(name, env) {
  if (!name) throw new Error("A Key Vault secret name is missing.");
  const cached = secretCache.get(name);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const token = await getAzureToken(env);
  const vaultUrl = String(env.AZURE_KEY_VAULT_URL || "")
    .replace(/\/+$/, "");
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

async function getAzureToken(env) {
  if (azureTokenCache && azureTokenCache.expiresAt > Date.now()) {
    return azureTokenCache.value;
  }
  const body = new URLSearchParams({
    client_id: env.AZURE_CLIENT_ID,
    client_secret: env.AZURE_CLIENT_SECRET,
    scope: "https://vault.azure.net/.default",
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
  azureTokenCache = {
    value: result.access_token,
    expiresAt: Date.now()
      + Math.max(60, Number(result.expires_in) - 300) * 1000
  };
  return azureTokenCache.value;
}

async function putBlob(containerSasUrl, fileName, content) {
  const url = new URL(containerSasUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${fileName}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-ms-blob-type": "BlockBlob",
      "x-ms-version": "2023-11-03"
    },
    body: content
  });
  if (!response.ok) {
    throw new Error(`Azure Blob upload returned ${response.status}.`);
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
  const expected = env.ALLOWED_ORIGIN || "https://ads.sbay.sa";
  const origin = request.headers.get("origin");
  if (origin && origin !== expected) {
    throw new PublicError("مصدر الطلب غير مسموح.", 403);
  }
}

function boundedText(value, minimum, maximum) {
  return typeof value === "string"
    && value.trim().length >= minimum
    && value.trim().length <= maximum;
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
