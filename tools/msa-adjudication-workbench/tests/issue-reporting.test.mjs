import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import {
  PORTAL_ISSUE_REPORT_CLAIM_SCHEMA,
  PORTAL_ISSUE_REPORT_RECEIPT_SCHEMA,
  buildPortalIssuePublicPayload,
  portalIssueReportMarker,
  renderPortalIssueMarkdown,
  validatePortalIssueReportInput
} from "../src/issue-reporting.js";
import {
  publishPortalIssueReports
} from "../scripts/publish-portal-issue-reports.mjs";

const repository = "sbay-dev/ADG-Lang";
const receiptKey = "issue-report-receipt-test-key";
const reportId = "11111111-1111-4111-8111-111111111111";

test("issue reports accept only bounded privacy-safe fields", () => {
  const input = validatePortalIssueReportInput(validInput());
  const payload = buildPortalIssuePublicPayload(
    input,
    "2026-08-15T12:00:00.000Z"
  );
  const markdown = renderPortalIssueMarkdown(payload);

  assert.equal(payload.categoryLabelAr, "قائمة المهام أو فتح المهمة");
  assert.match(markdown, /بلاغ من منصّة تحكيم اللغة العربية/u);
  assert.match(markdown, new RegExp(portalIssueReportMarker(reportId)));
  assert.match(markdown, /msa-adjudication-pilot:v1/u);
  assert.doesNotMatch(markdown, /user_id|profile|draft/iu);
});

test("issue reports reject identity, links, credentials, and unknown fields", () => {
  assert.throws(
    () => validatePortalIssueReportInput(validInput({
      details: "ظهر الخطأ ثم أرسلت التفاصيل إلى reviewer@example.test"
    })),
    /بيانات التواصل/u
  );
  assert.throws(
    () => validatePortalIssueReportInput(validInput({
      details: "ظهر الخطأ في https://example.test أثناء فتح المهمة."
    })),
    /روابط/u
  );
  assert.throws(
    () => validatePortalIssueReportInput(validInput({
      details: "ظهر الخطأ مع الرمز "
        + ["ghp", "123456789012345678901234567890"].join("_")
    })),
    /مفاتيح/u
  );
  assert.throws(
    () => validatePortalIssueReportInput({
      ...validInput(),
      email: "reviewer@example.test"
    }),
    /حقولًا غير مسموحة/u
  );
  const safe = validatePortalIssueReportInput(validInput());
  const payload = buildPortalIssuePublicPayload(
    safe,
    "2026-08-15T12:00:00.000Z"
  );
  assert.throws(
    () => renderPortalIssueMarkdown({
      ...payload,
      userId: "private-user"
    }),
    /حمولة بلاغ المنصة غير صالحة/u
  );
});

test("publisher creates one labeled issue and returns a signed receipt", async () => {
  const input = validatePortalIssueReportInput(validInput());
  const payloadJson = JSON.stringify(buildPortalIssuePublicPayload(
    input,
    "2026-08-15T12:00:00.000Z"
  ));
  const contentSha256 = createHash("sha256")
    .update(payloadJson)
    .digest("hex");
  const calls = [];
  let claimNonce = null;
  const fetchImpl = async (urlValue, init = {}) => {
    const url = new URL(urlValue);
    calls.push({ url, init });
    if (url.hostname === "portal.test"
        && url.pathname.endsWith("/claim")) {
      const signed = JSON.parse(init.body);
      assert.equal(signed.schema, PORTAL_ISSUE_REPORT_CLAIM_SCHEMA);
      assertSigned(signed);
      claimNonce = signed.nonce;
      return jsonResponse({
        accepted: true,
        items: [{ reportId, contentSha256, payloadJson }]
      });
    }
    if (url.hostname === "api.github.test"
        && init.method !== "POST") {
      return jsonResponse([]);
    }
    if (url.hostname === "api.github.test"
        && init.method === "POST") {
      const issue = JSON.parse(init.body);
      assert.deepEqual(issue.labels, ["bug", "portal", "reviewer-report"]);
      assert.match(issue.body, new RegExp(portalIssueReportMarker(reportId)));
      assert.doesNotMatch(issue.body, /email|fullName|user_id/iu);
      return jsonResponse({
        number: 42,
        html_url: `https://github.com/${repository}/issues/42`
      });
    }
    if (url.hostname === "portal.test"
        && url.pathname.endsWith("/receipts")) {
      const signed = JSON.parse(init.body);
      assert.equal(signed.schema, PORTAL_ISSUE_REPORT_RECEIPT_SCHEMA);
      assert.equal(signed.claimNonce, claimNonce);
      assert.equal(signed.reportId, reportId);
      assert.equal(signed.issueNumber, 42);
      assertSigned(signed);
      return jsonResponse({ accepted: true, duplicate: false });
    }
    throw new Error(`Unexpected request to ${url}`);
  };

  const result = await publishPortalIssueReports({
    repository,
    githubToken: "github-token",
    receiptKey,
    claimUrl: "https://portal.test/api/repository/issue-reports/claim",
    githubApiBase: "https://api.github.test",
    fetchImpl
  });

  assert.equal(result.claimed, 1);
  assert.deepEqual(result.published, [{
    reportId,
    issueNumber: 42,
    duplicate: false
  }]);
  assert.equal(
    calls.filter(call =>
      call.url.hostname === "api.github.test"
      && call.init.method === "POST").length,
    1
  );
});

test("publisher reuses an existing issue marker after a receipt failure", async () => {
  const input = validatePortalIssueReportInput(validInput());
  const payloadJson = JSON.stringify(buildPortalIssuePublicPayload(
    input,
    "2026-08-15T12:00:00.000Z"
  ));
  const contentSha256 = createHash("sha256")
    .update(payloadJson)
    .digest("hex");
  let issueCreateCalls = 0;
  const fetchImpl = async (urlValue, init = {}) => {
    const url = new URL(urlValue);
    if (url.hostname === "portal.test"
        && url.pathname.endsWith("/claim")) {
      return jsonResponse({
        accepted: true,
        items: [{ reportId, contentSha256, payloadJson }]
      });
    }
    if (url.hostname === "api.github.test"
        && init.method !== "POST") {
      return jsonResponse([{
        number: 42,
        html_url: `https://github.com/${repository}/issues/42`,
        body: `<!-- ${portalIssueReportMarker(reportId)} -->`,
        pull_request: null
      }]);
    }
    if (url.hostname === "api.github.test"
        && init.method === "POST") {
      issueCreateCalls += 1;
      throw new Error("Issue creation must not repeat.");
    }
    if (url.hostname === "portal.test"
        && url.pathname.endsWith("/receipts")) {
      return jsonResponse({ accepted: true, duplicate: true });
    }
    throw new Error(`Unexpected request to ${url}`);
  };

  const result = await publishPortalIssueReports({
    repository,
    githubToken: "github-token",
    receiptKey,
    claimUrl: "https://portal.test/api/repository/issue-reports/claim",
    githubApiBase: "https://api.github.test",
    fetchImpl
  });

  assert.equal(issueCreateCalls, 0);
  assert.equal(result.published[0].duplicate, true);
});

function validInput(overrides = {}) {
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
      portalVersion: "15.2.2",
      step: 3,
      taskVersionId: "msa-adjudication-pilot:v1",
      taskLane: "operational-test",
      operationalMode: true
    },
    ...overrides
  };
}

function assertSigned(signed) {
  const { hmacSha256, ...envelope } = signed;
  assert.equal(
    hmacSha256,
    createHmac("sha256", receiptKey)
      .update(JSON.stringify(envelope))
      .digest("hex")
  );
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}
