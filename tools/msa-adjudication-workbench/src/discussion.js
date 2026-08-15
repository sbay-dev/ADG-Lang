import { tokenDecisionKey } from "../public/protocol.js";

export const DISCUSSION_CATEGORIES = new Set([
  "agreement",
  "disagreement",
  "question",
  "clarification",
  "evidence",
  "final-result",
  "consensus-proposal",
  "escalation",
  "appeal",
  "recusal"
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/u;
const PHONE_PATTERN = /(?:\+?\d[\s().-]*){7,}/u;
const RAW_HTML_PATTERN = /<\/?[a-z][^>]*>/iu;
const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*\]\s*\(/u;
const UNSAFE_URL_PATTERN = /\b(?:javascript|data):/iu;
const CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

export function validateDiscussionInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("بيانات التعليق العلمي غير صالحة.");
  }
  const category = String(value.category || "").trim();
  if (!DISCUSSION_CATEGORIES.has(category)) {
    throw new Error("تصنيف التعليق العلمي غير صالح.");
  }
  const body = String(value.body || "").trim();
  if (body.length < 20 || body.length > 4000) {
    throw new Error("نص التعليق يجب أن يكون بين 20 و4000 محرف.");
  }
  if (EMAIL_PATTERN.test(body)
      || PHONE_PATTERN.test(body)
      || RAW_HTML_PATTERN.test(body)
      || MARKDOWN_IMAGE_PATTERN.test(body)
      || UNSAFE_URL_PATTERN.test(body)
      || CONTROL_PATTERN.test(body)) {
    throw new Error(
      "التعليق يحتوي بيانات تواصل أو محتوى غير مسموح للنشر العام."
    );
  }

  const targetReceiptId = nullableUuid(
    value.targetReceiptId,
    "معرف النتيجة المستهدفة"
  );
  const parentCommentId = nullableUuid(
    value.parentCommentId,
    "معرف التعليق السابق"
  );
  const sentenceId = nullableText(value.sentenceId, 120, "معرف الجملة");
  const tokenId = value.tokenId == null || value.tokenId === ""
    ? null
    : Number(value.tokenId);
  if (tokenId !== null
      && (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > 100000)) {
    throw new Error("رقم الوحدة المشار إليها غير صالح.");
  }

  return {
    category,
    body,
    targetReceiptId,
    parentCommentId,
    sentenceId,
    tokenId,
    mentionedReceiptIds: uniqueUuidList(
      value.mentionedReceiptIds,
      "قائمة المنشن"
    ),
    referencedReceiptIds: uniqueUuidList(
      value.referencedReceiptIds,
      "قائمة النتائج المشار إليها"
    )
  };
}

export function countDecisionDifferences(annotation, finalDecision) {
  const sourceSentences = new Map(
    (annotation?.sentences || [])
      .map(sentence => [sentence.sentenceId, sentence])
  );
  let differences = 0;
  for (const finalSentence of finalDecision?.sentences || []) {
    const sourceSentence = sourceSentences.get(finalSentence.sentenceId);
    if (!sourceSentence) {
      differences += 1 + (finalSentence.tokens?.length || 0);
      continue;
    }
    if (sourceSentence.structurallyAcceptable
        !== finalSentence.structurallyAcceptable) {
      differences++;
    }
    if (sourceSentence.completePredicate
        !== finalSentence.completePredicate) {
      differences++;
    }
    const sourceTokens = new Map(
      (sourceSentence.tokens || [])
        .map(token => [token.tokenId, token])
    );
    for (const finalToken of finalSentence.tokens || []) {
      const sourceToken = sourceTokens.get(finalToken.tokenId);
      if (!sourceToken
          || tokenDecisionKey(sourceToken) !== tokenDecisionKey(finalToken)) {
        differences++;
      }
    }
  }
  return differences;
}

export function notificationEmailContent(eventType, context, portalOrigin) {
  const packetId = safeInline(context.packetId, 160);
  const actor = safeInline(
    context.actorPseudonym || "مساهم مجهّل",
    80
  );
  const receiptId = safeInline(context.sourceReceiptId || "", 64);
  const link = new URL("/", portalOrigin);
  if (receiptId) link.searchParams.set("discussion", receiptId);
  link.hash = "discussion";

  let subject;
  let lead;
  if (eventType === "mention") {
    subject = "ذُكرت في نقاش تحكيم ADG-Lang";
    lead = `أشار إليك ${actor} في نقاش المهمة ${packetId}.`;
  } else if (eventType === "final-result-difference") {
    const count = Number(context.differenceCount || 0);
    subject = "صدرت نتيجة حاسمة لمهمة شاركت فيها";
    lead = `صدرت نتيجة نهائية للمهمة ${packetId} تختلف عن `
      + `${count} من قرارات مساهمتك. هذا إشعار بالمقارنة العلمية، `
      + "وليس تقييمًا لشخص المحكّم.";
  } else {
    subject = "تعليق جديد على نتيجتك في ADG-Lang";
    lead = `أضاف ${actor} تعليقًا علميًا على نتيجة مرتبطة بالمهمة `
      + `${packetId}.`;
  }

  const excerpt = safeExcerpt(context.excerpt);
  const plainText = [
    lead,
    excerpt ? `\nمقتطف التعليق:\n${excerpt}` : "",
    `\nافتح مساحة النقاش: ${link}`,
    "\nلن تظهر هويتك أو بريدك للمحكّمين الآخرين أو في GitHub."
  ].join("");
  const html = `<!doctype html><html lang="ar" dir="rtl"><body>`
    + `<h1>${escapeHtml(subject)}</h1>`
    + `<p>${escapeHtml(lead)}</p>`
    + (excerpt
      ? `<blockquote>${escapeHtml(excerpt)}</blockquote>`
      : "")
    + `<p><a href="${escapeHtml(link.toString())}">فتح مساحة النقاش</a></p>`
    + "<p>لن تظهر هويتك أو بريدك للمحكّمين الآخرين أو في GitHub.</p>"
    + "</body></html>";
  return { subject, plainText, html };
}

function uniqueUuidList(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 20) {
    throw new Error(`${label} غير صالحة.`);
  }
  const result = [];
  const seen = new Set();
  for (const item of value) {
    const normalized = String(item || "").trim();
    if (!UUID_PATTERN.test(normalized)) {
      throw new Error(`${label} تحتوي معرفًا غير صالح.`);
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function nullableUuid(value, label) {
  if (value == null || value === "") return null;
  const normalized = String(value).trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw new Error(`${label} غير صالح.`);
  }
  return normalized;
}

function nullableText(value, maximum, label) {
  if (value == null || String(value).trim() === "") return null;
  const normalized = String(value).trim();
  if (normalized.length > maximum || CONTROL_PATTERN.test(normalized)) {
    throw new Error(`${label} غير صالح.`);
  }
  return normalized;
}

function safeExcerpt(value) {
  if (value == null) return "";
  return String(value).replace(/\s+/gu, " ").trim().slice(0, 500);
}

function safeInline(value, maximum) {
  return String(value || "").replace(/\s+/gu, " ").trim().slice(0, maximum);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
