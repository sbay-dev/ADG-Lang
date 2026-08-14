import assert from "node:assert/strict";
import test from "node:test";
import {
  countDecisionDifferences,
  notificationEmailContent,
  validateDiscussionInput
} from "../src/discussion.js";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

test("discussion input normalizes technical references", () => {
  assert.deepEqual(
    validateDiscussionInput({
      category: "evidence",
      body: "أقترح مراجعة علاقة الفاعل في الوحدة الثانية قبل اعتماد الحسم.",
      targetReceiptId: UUID_A,
      parentCommentId: null,
      sentenceId: "msa-001",
      tokenId: 2,
      mentionedReceiptIds: [UUID_B, UUID_B],
      referencedReceiptIds: [UUID_A]
    }),
    {
      category: "evidence",
      body: "أقترح مراجعة علاقة الفاعل في الوحدة الثانية قبل اعتماد الحسم.",
      targetReceiptId: UUID_A,
      parentCommentId: null,
      sentenceId: "msa-001",
      tokenId: 2,
      mentionedReceiptIds: [UUID_B],
      referencedReceiptIds: [UUID_A]
    }
  );
});

test("discussion input rejects public contact data and active content", () => {
  assert.throws(
    () => validateDiscussionInput({
      category: "question",
      body: "للتواصل أرسل الرسالة إلى judge@example.test لمناقشة النتيجة.",
      mentionedReceiptIds: [],
      referencedReceiptIds: []
    }),
    /بيانات تواصل/
  );
  assert.throws(
    () => validateDiscussionInput({
      category: "question",
      body: "أرفقت توضيحًا بصريًا ![نتيجة](https://example.test/x.png)",
      mentionedReceiptIds: [],
      referencedReceiptIds: []
    }),
    /غير مسموح/
  );
});

test("difference count compares sentence and token decisions", () => {
  const annotation = {
    sentences: [{
      sentenceId: "s1",
      structurallyAcceptable: true,
      completePredicate: "كتب",
      tokens: [{
        tokenId: 1,
        universalPartOfSpeech: "VERB",
        headTokenId: 0,
        dependencyRelation: "root",
        irabHeadTokenId: 0,
        irabCategory: "_",
        irabNotApplicable: true
      }]
    }]
  };
  const decision = structuredClone(annotation);
  decision.sentences[0].tokens[0].dependencyRelation = "dep";
  assert.equal(countDecisionDifferences(annotation, decision), 1);
});

test("notification wording reports a difference without personal blame", () => {
  const result = notificationEmailContent(
    "final-result-difference",
    {
      packetId: "packet-1",
      sourceReceiptId: UUID_A,
      differenceCount: 3
    },
    "https://adg.sbay.sa"
  );
  assert.match(result.plainText, /تختلف عن 3/);
  assert.match(result.plainText, /ليس تقييمًا لشخص/);
  assert.doesNotMatch(result.plainText, /أخطأت|خطؤك/);
});
