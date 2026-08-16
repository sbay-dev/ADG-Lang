import { validatePublicArtifactText } from "../public/protocol.js";

export const PORTAL_ISSUE_REPORT_SCHEMA = "adg-portal-issue-report-v1";
export const PORTAL_ISSUE_REPORT_CLAIM_SCHEMA =
  "adg-portal-issue-report-claim-v1";
export const PORTAL_ISSUE_REPORT_RECEIPT_SCHEMA =
  "adg-portal-issue-report-receipt-v1";

export const PORTAL_ISSUE_CATEGORIES = Object.freeze({
  access: "الدخول أو مفتاح المرور",
  "task-inbox": "قائمة المهام أو فتح المهمة",
  autosave: "الحفظ التلقائي أو استعادة المسودة",
  adjudication: "واجهة التحليل أو الحقول اللغوية",
  submission: "مراجعة النتيجة أو الإرسال",
  display: "العرض أو التوافق مع الجهاز",
  other: "خلل آخر"
});

const REPORT_INPUT_KEYS = new Set([
  "schema",
  "reportId",
  "category",
  "summary",
  "details",
  "reproductionSteps",
  "privacyConfirmed",
  "context"
]);
const REPORT_CONTEXT_KEYS = new Set([
  "portalVersion",
  "step",
  "taskVersionId",
  "taskLane",
  "operationalMode"
]);
const REPORT_PUBLIC_PAYLOAD_KEYS = new Set([
  "schema",
  "reportId",
  "category",
  "categoryLabelAr",
  "summary",
  "details",
  "reproductionSteps",
  "context",
  "createdAtUtc"
]);
const CREDENTIAL_PATTERN =
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._~+/-]{12,})\b/u;
const URL_PATTERN = /(?:https?:\/\/|www\.)/iu;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,200}$/u;
const VERSION_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/u;

export function validatePortalIssueReportInput(value) {
  if (!plainObject(value)
      || value.schema !== PORTAL_ISSUE_REPORT_SCHEMA
      || !isUuid(value.reportId)
      || value.privacyConfirmed !== true
      || hasUnknownKeys(value, REPORT_INPUT_KEYS)) {
    throw new Error("بيانات البلاغ غير مكتملة أو تحتوي حقولًا غير مسموحة.");
  }
  if (!Object.hasOwn(PORTAL_ISSUE_CATEGORIES, value.category)) {
    throw new Error("تصنيف البلاغ غير صالح.");
  }

  const summary = singleLine(value.summary, 10, 160, "ملخص البلاغ");
  const details = multiline(value.details, 20, 4000, "وصف الخلل");
  const reproductionSteps = optionalMultiline(
    value.reproductionSteps,
    2000,
    "خطوات إعادة الخلل"
  );
  validateReportText([summary, details, reproductionSteps]);

  return {
    reportId: value.reportId,
    category: value.category,
    summary,
    details,
    reproductionSteps,
    context: validatePortalIssueContext(value.context)
  };
}

export function buildPortalIssuePublicPayload(input, createdAtUtc) {
  if (!input || !Number.isFinite(Date.parse(createdAtUtc))) {
    throw new Error("تعذر إنشاء حمولة البلاغ الآمنة.");
  }
  return {
    schema: PORTAL_ISSUE_REPORT_SCHEMA,
    reportId: input.reportId,
    category: input.category,
    categoryLabelAr: PORTAL_ISSUE_CATEGORIES[input.category],
    summary: input.summary,
    details: input.details,
    reproductionSteps: input.reproductionSteps,
    context: input.context,
    createdAtUtc
  };
}

export function validatePortalIssuePublicPayload(value) {
  if (!plainObject(value)
      || value.schema !== PORTAL_ISSUE_REPORT_SCHEMA
      || !isUuid(value.reportId)
      || hasUnknownKeys(value, REPORT_PUBLIC_PAYLOAD_KEYS)
      || !Object.hasOwn(PORTAL_ISSUE_CATEGORIES, value.category)
      || value.categoryLabelAr !== PORTAL_ISSUE_CATEGORIES[value.category]
      || !Number.isFinite(Date.parse(value.createdAtUtc))) {
    throw new Error("حمولة بلاغ المنصة غير صالحة.");
  }
  const input = validatePortalIssueReportInput({
    schema: PORTAL_ISSUE_REPORT_SCHEMA,
    reportId: value.reportId,
    category: value.category,
    summary: value.summary,
    details: value.details,
    reproductionSteps: value.reproductionSteps,
    privacyConfirmed: true,
    context: value.context
  });
  return buildPortalIssuePublicPayload(input, value.createdAtUtc);
}

export function portalIssueReportMarker(reportId) {
  if (!isUuid(reportId)) {
    throw new Error("معرف البلاغ غير صالح.");
  }
  return `adg-portal-report-id:${reportId}`;
}

export function portalIssueTitle(payload) {
  const value = validatePortalIssuePublicPayload(payload);
  return `[بوابة التحكيم] ${value.summary}`
    .replace(/@/gu, "＠")
    .slice(0, 220);
}

export function renderPortalIssueMarkdown(payload) {
  const value = validatePortalIssuePublicPayload(payload);
  const context = value.context;
  const lines = [
    `<!-- ${portalIssueReportMarker(value.reportId)} -->`,
    "",
    "## بلاغ من منصّة تحكيم اللغة العربية",
    "",
    "> أُرسل هذا البلاغ آليًا من القناة المجهّلة في المنصّة. "
      + "لا يتضمن اسم المحكّم أو بريده أو حساباته أو مسودته أو قراراته اللغوية.",
    "",
    `**التصنيف:** ${escapeMarkdown(value.categoryLabelAr)}`,
    "",
    "### الملخص",
    "",
    escapeMarkdown(value.summary),
    "",
    "### وصف الخلل",
    "",
    escapeMarkdown(value.details)
  ];
  if (value.reproductionSteps) {
    lines.push(
      "",
      "### خطوات إعادة الخلل",
      "",
      escapeMarkdown(value.reproductionSteps)
    );
  }
  lines.push(
    "",
    "### سياق تقني آمن",
    "",
    `- إصدار المنصّة: \`${escapeInlineCode(context.portalVersion)}\``,
    `- الخطوة: \`${context.step}\``,
    `- مسار المهمة: \`${escapeInlineCode(context.taskLane || "غير محدد")}\``,
    `- وضع الاختبار التشغيلي: \`${context.operationalMode ? "نعم" : "لا"}\``
  );
  if (context.taskVersionId) {
    lines.push(
      `- معرّف إصدار المهمة العام: \`${escapeInlineCode(
        context.taskVersionId
      )}\``
    );
  }
  lines.push(
    "",
    "---",
    `معرّف البلاغ: \`${value.reportId}\``,
    `وقت الاستلام: \`${value.createdAtUtc}\``
  );
  return `${lines.join("\n")}\n`;
}

function validatePortalIssueContext(value) {
  if (!plainObject(value)
      || hasUnknownKeys(value, REPORT_CONTEXT_KEYS)
      || !VERSION_PATTERN.test(value.portalVersion || "")
      || !Number.isSafeInteger(value.step)
      || value.step < 1
      || value.step > 5
      || ![null, "standard", "operational-test"].includes(
        value.taskLane ?? null
      )
      || typeof value.operationalMode !== "boolean") {
    throw new Error("السياق التقني للبلاغ غير صالح.");
  }
  const taskVersionId = value.taskVersionId ?? null;
  if (taskVersionId !== null && !IDENTIFIER_PATTERN.test(taskVersionId)) {
    throw new Error("معرف المهمة في البلاغ غير صالح.");
  }
  return {
    portalVersion: value.portalVersion,
    step: value.step,
    taskVersionId,
    taskLane: value.taskLane ?? null,
    operationalMode: value.operationalMode
  };
}

function validateReportText(values) {
  const text = values.filter(Boolean).join("\n");
  if (URL_PATTERN.test(text) || CREDENTIAL_PATTERN.test(text)) {
    throw new Error(
      "لا تُدرج روابط أو مفاتيح أو رموز دخول في البلاغ العام."
    );
  }
  try {
    validatePublicArtifactText({
      note: values[0],
      rationale: values[1],
      resolutionNote: values[2]
    });
  } catch {
    throw new Error(
      "احذف بيانات التواصل أو الشيفرة النشطة أو المحتوى غير الآمن من البلاغ."
    );
  }
}

function singleLine(value, minimum, maximum, label) {
  const normalized = String(value || "").trim().replace(/[ \t]+/gu, " ");
  if (normalized.length < minimum
      || normalized.length > maximum
      || /[\r\n]/u.test(normalized)) {
    throw new Error(`${label} يجب أن يكون بين ${minimum} و${maximum} حرفًا.`);
  }
  return normalized;
}

function multiline(value, minimum, maximum, label) {
  const normalized = String(value || "")
    .replace(/\r\n?/gu, "\n")
    .trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new Error(`${label} يجب أن يكون بين ${minimum} و${maximum} حرفًا.`);
  }
  return normalized;
}

function optionalMultiline(value, maximum, label) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  return multiline(value, 1, maximum, label);
}

function escapeMarkdown(value) {
  return String(value)
    .replace(/\\/gu, "\\\\")
    .replace(/([`*_[\]<>#@|])/gu, "\\$1");
}

function escapeInlineCode(value) {
  return String(value).replace(/`/gu, "");
}

function hasUnknownKeys(value, allowed) {
  return Object.keys(value).some(key => !allowed.has(key));
}

function plainObject(value) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value);
}

function isUuid(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
      .test(value);
}
