# Security Policy | سياسة الأمان

ADG-Lang accepts responsible security reports for public repository code,
workflows, dependencies, and published collaboration processes.

## Private disclosure only | الإفصاح الخاص فقط

Do **not** open a public issue or pull request for:

- vulnerabilities or exploit paths;
- possible secret exposure;
- privacy incidents or identity leakage;
- reports that require non-public infrastructure details.

Use GitHub private vulnerability reporting if it is available for the
repository. If it is unavailable, report privately to `team@sbay.sa`.

## What to include | ماذا يتضمن البلاغ

Please send:

- the affected commit, branch, release, or file path;
- a concise impact statement;
- minimal reproduction steps or proof of concept;
- redacted logs or screenshots only when necessary;
- any proposed mitigation, if known.

Do **not** send live credentials, full databases, personal data, or restricted
source material.

## Public safety rules | قواعد السلامة العلنية

Public issues and pull requests must not contain:

- personal data, participant identity, student records, citizen data, or
  customer data;
- tokens, passwords, connection strings, private keys, or secret-bearing
  configuration;
- local absolute paths, internal-only screenshots, or hidden operational
  instructions;
- private corpora, sealed evaluations, or non-public contractual material.

The adjudication importer also rejects contact data and active content inside
public notes, rationales, and comments. Automated evidence pull requests are
accepted for receipt signing only when they target `main`, originate from the
same repository and GitHub Actions bot, change evidence paths only, pass HMAC
validation again, and reproduce their rendered Markdown exactly.

If you accidentally exposed sensitive material, remove public references where
possible and switch immediately to the private disclosure route above.

## Scope | النطاق

This policy covers the public repository surface, including:

- source code and scripts committed to the repository;
- GitHub Actions workflows and dependency metadata;
- documentation that could cause unsafe operation or misleading security
  handling;
- public submission or review processes documented in the repository.

This policy does **not** authorize intrusive testing, denial-of-service,
credential stuffing, social engineering, or attempts to access systems or data
that are not clearly intended for public testing.

## Coordinated disclosure | الإفصاح المنسق

We aim to acknowledge good-faith reports promptly and to coordinate public
disclosure after triage and remediation planning. Response time depends on
severity, maintainer availability, and whether the report is reproducible.

Please avoid public disclosure until maintainers have had a reasonable chance
to assess and mitigate the issue.

## Claim boundaries | حدود الادعاء

A security report should describe a concrete issue and its impact. It should
not claim broader system visibility, internal architecture knowledge, or
repository-wide readiness without evidence that can be handled safely.

## Arabic guidance | إرشادات بالعربية

هذا المستودع علني، ولذلك يُحظر نشر الثغرات الحسّاسة أو الأسرار أو البيانات
الشخصية في القضايا العلنية أو طلبات السحب. عند وجود بلاغ أمني، استخدموا مسار
الإفصاح الخاص عبر ميزة البلاغات الأمنية الخاصة في GitHub إن كانت مفعّلة، أو
أرسلوا البلاغ إلى `team@sbay.sa`. أرفقوا وصفًا محددًا للأثر، وخطوات إعادة
الإنتاج بالحد الأدنى، وأدلة منقّحة فقط. ولا تُرسلوا مفاتيح حية أو قواعد بيانات
كاملة أو مواد محمية بحقوق أو خصوصية.

## Non-security topics | ما ليس بلاغًا أمنيًا

Use normal issue forms for:

- feature requests;
- documentation corrections;
- linguistic evidence;
- reproducible defects that do not involve vulnerability handling or secret
  exposure.
