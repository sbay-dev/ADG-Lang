export const EMAIL_CODE_TTL_MS = 5 * 60 * 1000;
export const EMAIL_TOKEN_TTL_MS = 30 * 60 * 1000;
export const EMAIL_RESEND_COOLDOWN_MS = 60 * 1000;
export const EMAIL_MAX_ATTEMPTS = 5;
export const EMAIL_MAX_SENDS_PER_ADDRESS_HOUR = 5;
export const EMAIL_MAX_SENDS_PER_REQUESTER_HOUR = 20;

export function normalizeVerificationEmail(value) {
  const email = String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase();
  if (email.length < 5
      || email.length > 160
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new Error("البريد الإلكتروني غير صالح.");
  }
  return email;
}

export function normalizeVerificationCode(value) {
  const code = String(value || "").trim();
  if (!/^\d{6}$/.test(code)) {
    throw new Error("رمز التحقق يجب أن يتكون من ستة أرقام.");
  }
  return code;
}

export function generateVerificationCode(randomValues = crypto.getRandomValues) {
  const values = new Uint32Array(1);
  const largestUnbiasedValue = 4294000000;
  do {
    randomValues.call(crypto, values);
  } while (values[0] >= largestUnbiasedValue);
  return String(values[0] % 1000000).padStart(6, "0");
}

export function verificationEmailContent(code) {
  const safeCode = normalizeVerificationCode(code);
  return {
    subject: "رمز التحقق من البريد لمنصة تحكيم ADG-Lang",
    plainText:
      "استخدم رمز التحقق التالي لإكمال توثيق بريدك في منصة تحكيم "
      + `ADG-Lang:\n\n${safeCode}\n\n`
      + "تنتهي صلاحية الرمز بعد 5 دقائق، ولا تطلع عليه أي شخص. "
      + "إذا لم تطلب هذا الرمز فتجاهل الرسالة.",
    html:
      '<div dir="rtl" lang="ar" style="font-family:Tahoma,Arial,sans-serif;'
      + 'line-height:1.8;color:#173d2b">'
      + "<h2>توثيق البريد في منصة تحكيم ADG-Lang</h2>"
      + "<p>استخدم الرمز التالي لإكمال توثيق بريدك:</p>"
      + '<p dir="ltr" style="font-size:32px;font-weight:700;'
      + 'letter-spacing:8px;margin:24px 0">'
      + safeCode
      + "</p>"
      + "<p>تنتهي صلاحية الرمز بعد 5 دقائق، ولا تطلع عليه أي شخص.</p>"
      + "<p>إذا لم تطلب هذا الرمز فتجاهل الرسالة.</p>"
      + "</div>"
  };
}
