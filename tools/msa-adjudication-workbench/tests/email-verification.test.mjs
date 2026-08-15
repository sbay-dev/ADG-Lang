import assert from "node:assert/strict";
import test from "node:test";
import {
  generateVerificationCode,
  normalizeVerificationCode,
  normalizeVerificationEmail,
  verificationEmailContent
} from "../src/email-verification.js";

test("email verification normalizes addresses and six-digit codes", () => {
  assert.equal(
    normalizeVerificationEmail("  JUDGE@Example.Test  "),
    "judge@example.test"
  );
  assert.equal(normalizeVerificationCode(" 004217 "), "004217");
  assert.throws(
    () => normalizeVerificationEmail("judge-at-example.test"),
    /غير صالح/
  );
  assert.throws(() => normalizeVerificationCode("4217"), /ستة أرقام/);
});

test("email verification code generation rejects modulo-biased values", () => {
  const values = [4294967295, 42];
  const code = generateVerificationCode(array => {
    array[0] = values.shift();
    return array;
  });
  assert.equal(code, "000042");
});

test("verification email is bounded and does not request a reply", () => {
  const content = verificationEmailContent("123456");
  assert.match(content.subject, /رمز التحقق/);
  assert.match(content.plainText, /123456/);
  assert.match(content.plainText, /5 دقائق/);
  assert.doesNotMatch(content.plainText, /أرسل رد/);
  assert.match(content.html, /dir="rtl"/);
});
