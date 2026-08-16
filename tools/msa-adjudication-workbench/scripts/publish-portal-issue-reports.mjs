import { createHash, createHmac, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  PORTAL_ISSUE_REPORT_CLAIM_SCHEMA,
  PORTAL_ISSUE_REPORT_RECEIPT_SCHEMA,
  portalIssueReportMarker,
  portalIssueTitle,
  renderPortalIssueMarkdown,
  validatePortalIssuePublicPayload
} from "../src/issue-reporting.js";

const DEFAULT_CLAIM_URL =
  "https://adg.sbay.sa/api/repository/issue-reports/claim";
const DEFAULT_MAX_ITEMS = 20;
const GITHUB_API_VERSION = "2022-11-28";

export async function publishPortalIssueReports(options = {}) {
  const repository = required(
    options.repository || process.env.GITHUB_REPOSITORY,
    "GITHUB_REPOSITORY"
  );
  const githubToken = required(
    options.githubToken || process.env.GITHUB_TOKEN,
    "GITHUB_TOKEN"
  );
  const receiptKey = required(
    options.receiptKey || process.env.ADG_REPOSITORY_RECEIPT_HMAC,
    "ADG_REPOSITORY_RECEIPT_HMAC"
  );
  const claimUrl = new URL(
    options.claimUrl
      || process.env.ADG_PORTAL_ISSUE_REPORTS_URL
      || DEFAULT_CLAIM_URL
  );
  const receiptUrl = new URL(
    options.receiptUrl
      || process.env.ADG_PORTAL_ISSUE_REPORTS_RECEIPT_URL
      || "/api/repository/issue-reports/receipts",
    claimUrl
  );
  const githubApiBase = options.githubApiBase
    || "https://api.github.com";
  const fetchImpl = options.fetchImpl || fetch;
  const claimNonce = randomUUID();
  const claimEnvelope = {
    schema: PORTAL_ISSUE_REPORT_CLAIM_SCHEMA,
    repository,
    nonce: claimNonce,
    requestedAtUtc: new Date().toISOString(),
    maxItems: DEFAULT_MAX_ITEMS
  };
  const claim = await fetchJson(fetchImpl, claimUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(signEnvelope(claimEnvelope, receiptKey))
  });
  if (claim.accepted !== true || !Array.isArray(claim.items)) {
    throw new Error("Portal issue-report claim was rejected.");
  }

  const published = [];
  for (const item of claim.items) {
    const payloadJson = String(item?.payloadJson || "");
    const payload = validatePortalIssuePublicPayload(
      JSON.parse(payloadJson)
    );
    if (item.reportId !== payload.reportId
        || item.contentSha256 !== sha256Hex(payloadJson)) {
      throw new Error("Portal issue-report payload integrity failed.");
    }
    const marker = portalIssueReportMarker(payload.reportId);
    let issue = await findExistingIssue(
      fetchImpl,
      githubApiBase,
      repository,
      githubToken,
      marker
    );
    if (!issue) {
      issue = await createIssue(
        fetchImpl,
        githubApiBase,
        repository,
        githubToken,
        payload
      );
    }
    const receiptEnvelope = {
      schema: PORTAL_ISSUE_REPORT_RECEIPT_SCHEMA,
      repository,
      nonce: randomUUID(),
      claimNonce,
      reportId: payload.reportId,
      contentSha256: item.contentSha256,
      issueNumber: Number(issue.number),
      issueUrl: issue.html_url,
      acceptedAtUtc: new Date().toISOString()
    };
    const receipt = await fetchJson(fetchImpl, receiptUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signEnvelope(receiptEnvelope, receiptKey))
    });
    if (receipt.accepted !== true) {
      throw new Error("Portal issue-report receipt was rejected.");
    }
    published.push({
      reportId: payload.reportId,
      issueNumber: Number(issue.number),
      duplicate: Boolean(receipt.duplicate)
    });
  }
  return {
    claimed: claim.items.length,
    published
  };
}

async function findExistingIssue(
  fetchImpl,
  apiBase,
  repository,
  token,
  marker
) {
  for (let page = 1; page <= 10; page += 1) {
    const url = new URL(
      `/repos/${repository}/issues`,
      apiBase
    );
    url.searchParams.set("state", "all");
    url.searchParams.set("labels", "reviewer-report");
    url.searchParams.set("sort", "created");
    url.searchParams.set("direction", "desc");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    const issues = await fetchJson(fetchImpl, url, {
      headers: githubHeaders(token)
    });
    if (!Array.isArray(issues)) {
      throw new Error("GitHub returned an invalid issue list.");
    }
    const found = issues.find(issue =>
      typeof issue?.body === "string"
      && issue.body.includes(marker)
      && !issue.pull_request
    );
    if (found) {
      if (!Number.isSafeInteger(found.number)
          || found.number < 1
          || !validCreatedIssueUrl(
            found.html_url,
            repository,
            found.number
          )) {
        throw new Error("GitHub returned an invalid matching issue.");
      }
      return found;
    }
    if (issues.length < 100) return null;
  }
  return null;
}

async function createIssue(
  fetchImpl,
  apiBase,
  repository,
  token,
  payload
) {
  const url = new URL(`/repos/${repository}/issues`, apiBase);
  const issue = await fetchJson(fetchImpl, url, {
    method: "POST",
    headers: {
      ...githubHeaders(token),
      "content-type": "application/json"
    },
    body: JSON.stringify({
      title: portalIssueTitle(payload),
      body: renderPortalIssueMarkdown(payload),
      labels: ["bug", "portal", "reviewer-report"]
    })
  });
  if (!Number.isSafeInteger(issue?.number)
      || issue.number < 1
      || !validCreatedIssueUrl(issue.html_url, repository, issue.number)) {
    throw new Error("GitHub returned an invalid created issue.");
  }
  return issue;
}

function validCreatedIssueUrl(value, repository, issueNumber) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && parsed.hostname === "github.com"
      && parsed.pathname === `/${repository}/issues/${issueNumber}`
      && parsed.search === ""
      && parsed.hash === "";
  } catch {
    return false;
  }
}

async function fetchJson(fetchImpl, url, init) {
  const response = await fetchImpl(url, init);
  const text = await response.text();
  let value;
  try {
    value = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Non-JSON response from ${new URL(url).hostname}.`);
  }
  if (!response.ok) {
    throw new Error(
      `Request to ${new URL(url).hostname} failed with ${response.status}.`
    );
  }
  return value;
}

function githubHeaders(token) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": GITHUB_API_VERSION,
    "user-agent": "adg-portal-issue-publisher"
  };
}

function signEnvelope(envelope, key) {
  return {
    ...envelope,
    hmacSha256: createHmac("sha256", key)
      .update(JSON.stringify(envelope))
      .digest("hex")
  };
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;
if (invokedPath === import.meta.url) {
  publishPortalIssueReports()
    .then(result => {
      process.stdout.write(JSON.stringify({
        claimed: result.claimed,
        published: result.published.map(item => ({
          reportId: item.reportId,
          issueNumber: item.issueNumber,
          duplicate: item.duplicate
        }))
      }) + "\n");
    })
    .catch(error => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
