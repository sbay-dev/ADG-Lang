# الشفافية — منصّة تحكيم اللغة العربية (ADG)

هذه الوثيقة إفصاحٌ علنيٌّ موجزٌ عن كيفية عمل منصّة التحكيم، وعن البيانات التي
تُجمع وسبب جمعها وطريقة حمايتها، وعن حدود ما تضمنه المنصّة وما لا تضمنه. الغرض
منها أن يطمئنّ المحكّم والمجتمع العلمي إلى أنّ ما يجري خلف الواجهة معلومٌ
وموثَّقٌ وقابلٌ للتحقّق، وأنّ الشيفرة المنشورة في هذا المستودع هي ذاتها العاملة
في الإنتاج.

- الرابط الرسمي: **https://adg.sbay.sa** (والعنوان السابق `ads.sbay.sa` يحوِّل
  إليه تلقائيًّا لتبقى الدعوات القديمة صالحة).
- مستودع المصدر العلني: `sbay-dev/ADG-Lang`.
- مصدر المنصّة وسياساتها: مجلد `tools/msa-adjudication-workbench` في هذا المستودع.

---

## 1. ما هذه المنصّة

منصّةُ تحكيمٍ بشريٍّ مستقلّ تُراجِع مخرجات محلّل `ADG-Lang` للنحو والإعراب في
العربية الفصحى المعيارية، وتُوجَّه إلى معلّمي العربية وخبرائها دون اشتراط أيّ
إلمامٍ تقنيٍّ أو معرفةٍ بـ GitHub أو بصيغ البيانات أو بسطر الأوامر. لا تُعرض
تنبّؤات المحلّل الآلي على المحكّم إطلاقًا؛ فالتحكيم أعمى، والمخرج النهائي حكمٌ
بشريٌّ مستقلّ.

## 2. مبادئ الشفافية الملتزَم بها

1. **الشيفرة المنشورة هي العاملة.** أصول واجهة المحكّم (`public/`) في هذا
   المستودع مطابقةٌ لِما يُقدَّم على `adg.sbay.sa`، فيما عدا نصوصًا طرفيةً
   تحقنها شبكة Cloudflare تلقائيًّا (قياس أداءٍ ومنصّة تحدٍّ) وليست جزءًا من
   المصدر.
2. **حدود النشر معلنة.** لا تُنشَر الأسرار ولا المفاتيح ولا الارتباطات الخاصّة
   ولا بيانات هوية المشاركين؛ وهي مستثناةٌ صراحةً من حدود الإصدار (انظر بيان
   الإصدار في `release/`).
3. **التحقّق العلني.** يفرض سير عمل الأمان على GitHub Actions فحوصًا آليّةً
   على كلّ طلب دمج: تثبيت مقفل، وفحص الشيفرة والاختبارات، وجرد ثغرات الاعتماديات،
   ورفض أسماء الملفّات الحسّاسة والمحتوى الشبيه بالاعتمادات والمسارات المحلّية،
   والتأكّد من طزاجة بيان سلامة الإصدار.

## 3. كيف يجري التحكيم

يقوم البروتوكول على أربعة حساباتٍ مستقلّةٍ متمايزة: المُعلِّمان `A` و`B`،
والمحكّم الأساس `J1`، والمُصدِّق `J2`.

- يُرمِّز `A` و`B` العيّنة **استقلالًا** قبل أيّ نقاش، ثمّ يُقاس مقدار الاتفاق
  المستقلّ.
- تبقى الأظرف العامّة لِـ `A` و`B` محجوزةً في مخزنٍ مؤجَّل حتّى يثبت الطرفان معًا؛
  والجولة غير المكتملة تُلغى بدل كشف إجابةٍ من طرفٍ واحد.
- يحسم `J1` مواضع الخلاف، ولا تُعتمد نتيجته إلّا بتوقيع `J2` على الجذر نفسه.
- تبقى النتيجة `approved` **مؤقّتةً** طوال نافذة استئنافٍ مدّتها 14 يومًا، ولا
  تتحوّل إلى `published` إلّا بعد وصول إيصال مستودعٍ موقّعٍ يُثبت قبول سجلّ الحالة
  المرتبط.
- يبقى كلّ دورٍ سابقٍ محفوظًا؛ وGitHub مرآةُ أدلّةٍ داعمةٍ لا قاعدةَ الحالة
  السلطويّة.

للتفصيل الكامل: `CONSENSUS-PROTOCOL.md`.

## 4. تدفّق المحكّم (تجربة الاستخدام)

الواجهة عربيةٌ باتجاه الكتابة من اليمين إلى اليسار، بطابعٍ مستوحًى من GitHub،
وبوضعين فاتحٍ ومظلمٍ يختارهما المحكّم. الخطوات الموجّهة:

1. الاطّلاع على المعايير وملخّص المحلّل.
2. إدخال بيانات الهوية والتواصل الخاصّة وإقرار الموافقات.
3. **التحقّق من البريد الإلكتروني** برمزٍ يُرسَل إلى صندوق المحكّم قبل المضيّ.
4. تسجيل مفتاح مرور (Passkey) قابلٍ للاكتشاف؛ دون حاجةٍ إلى حساب مؤسسةٍ أو كلمة
   مرور.
5. قراءة المثال المحلول، ثمّ العمل ضمن الدور المستقلّ المُسنَد.
6. إكمال القرارات اللغوية الموجّهة، مع حفظ المسودّات المشفّرة يدويًّا وبعد كلّ
   تعديلٍ للعودة لاحقًا.
7. حفظ نسخةٍ محلّيةٍ مجهّلة أو الإرسال عبر واجهة API المحميّة.
8. بعد الإرسال: تصفّح النتائج السابقة باسمٍ مستعار، ومناقشة الأدلّة المرتبطة،
   ومتابعة حالة الإجماع، وتقديم استئنافٍ خلال نافذته.

## 5. البيانات التي نجمعها وسببها

- **بيانات الهوية:** الاسم، والبريد الإلكتروني، وأسماء المستخدم الاختيارية في
  حسابات التواصل (ومنها اسم مستخدم واتساب بدل رقم الهاتف)، وسنوات الخبرة
  والتخصّص والجهة الاختيارية، والموافقات وتعهّدات الاستقلال والتعمية.
- **الأدلّة اللغوية:** القرارات المُسجَّلة داخل العيّنة.

تُستخدم هذه البيانات لتوثيق المشاركة، وللتواصل بشأن جولات التقييم عند وجود
موافقة، ولقياس وضوح البروتوكول. **لا** تُستخدم للإعلانات، و**لا** تُباع لأيّ
طرفٍ ثالث. التفصيل في `PRIVACY.md`.

## 6. حماية الخصوصية والهوية

- **التعمية قبل المغادرة:** تُشفَّر بيانات الهوية بملفّ EntityCrypt
  (اشتقاق `HKDF-SHA-256` وتعمية `AES-256-GCM` بملفٍّ Matryoshka عشوائي)
  قبل أن تغادر الـ Worker، وتُحفظ في مخزنٍ خاصٍّ منفصلٍ عن الأدلّة العامة.
- **الفصل بين الهوية والنتيجة:** لا يصل إلى GitHub اسمٌ ولا بريدٌ ولا حساب
  تواصلٍ ولا جهة؛ لا يصله إلّا ظرفٌ مجهّلٌ موقّعٌ بـ HMAC.
- **التحقّق من البريد دون تخزين صريح:** يُرسَل الرمز عبر Microsoft 365 Graph من
  عنوانٍ خادميٍّ مقيَّد، ولا يُحفظ الرمز ولا البريد بصورتهما الصريحة؛ تُحفظ فقط
  بصماتٌ غير قابلةٍ للعكس، مع حدٍّ للمحاولات ومهلةٍ لإعادة الإرسال، ثمّ تُحذف
  سجلّات التحقّق القصيرة الأجل آليًّا.
- **تحكيمٌ أعمى:** لا تُعرض تنبّؤات المحلّل الآلي إطلاقًا.
- **مفاتيح المرور:** تُحفظ في قاعدة D1 مفاتيحُها العامّة وعدّادُها ومعرّفٌ
  عشوائي فقط، بينما تبقى الملفّات والمسودّات مشفّرةً بـ EntityCrypt، ورموز
  الجلسات عشوائيةً لا يُحفظ منها إلّا بصمة `SHA-256`.

## 7. حقوق المشارك

- موافقةٌ صريحةٌ قبل الإرسال.
- مدّة احتفاظٍ افتراضيةٌ قدرها 365 يومًا (قابلةٌ للضبط في إعداد النشر).
- يمكن لصاحب الحساب تسجيل **طلب محوٍ** من داخل المنصّة؛ يُنفَّذ بعد إغلاق مهامّه
  وانقضاء مدّة الاحتفاظ، فتُحذف مادّة الهوية من المخزن النشط وتبقى النتيجة العلمية
  المجهّلة فقط.
- **تنويهٌ صريح:** في نمط الأرشفة على D1 قد تبقى لقطاتٌ تاريخيةٌ قابلةٌ للاسترجاع
  عبر D1 Time Travel حتّى انقضاء النافذة المضبوطة؛ فالإكمال يعني حذفًا من المخزن
  النشط لا محوًا ماديًّا فوريًّا من نسخ المزوّد.
- طلبات الوصول أو التصحيح تُرسَل إلى `team@sbay.sa` مع رقم إيصال المشاركة.

## 8. البنية التحتية (سحابةٌ أولًا، بلا اشتراكاتٍ مدفوعةٍ لا لزوم لها)

- **Cloudflare Worker** يخدم الأصول الثابتة وواجهة API على الحافة.
- **قاعدة PostgreSQL** داخل حاوية `CPOLY` خاصّة (حاوية Cloudflare مربوطةٌ عبر
  كائنٍ دائم) هي المسار الأساس، ويُتواصَل معها حصرًا عبر ربطٍ داخليٍّ موثَّقٍ لا
  يكشف أيّ وكيل SQL علنيّ.
- **سجلّ استردادٍ على D1** مشفَّرٌ `AES-256-GCM`: تُسجَّل الكتابات المتغيّرة
  المقبولة أوّلًا قبل تطبيقها، ثمّ تُحفظ نسخٌ احتياطيةٌ مجزَّأةٌ غير قابلةٍ للتبديل
  في مساحة `KV` خاصّة، مع بيانات وصفٍ وتحقّقٍ من التجزّؤ في D1.
- **Cloudflare Turnstile** وفحوص المصدر نفسه تحمي النقطة العامة.
- **لوحة الإدارة** على `/admin/` منفصلةٌ تمامًا وتعتمد Microsoft Entra وحده، ولا
  تمنح حسابات مفاتيح المرور العامّة أيّ وصولٍ إليها.

مرجع النسخ الاحتياطي والاسترجاع: `infrastructure/cpoly-postgres/operations/BACKUP-RESTORE.md`،
والمعمارية في `infrastructure/cpoly-postgres/docs/ARCHITECTURE.md`.

## 9. الأمان

- **سياسة محتوًى صارمة (CSP):** بلا سكربتاتٍ أو أنماطٍ مضمّنة، وبلا خطوطٍ
  خارجية، مع `x-content-type-options: nosniff` و`frame-ancestors 'none'`.
- **أظرفٌ موقّعةٌ بـ HMAC** ومنعُ تكرارٍ عبر الطابع الزمني والرقم العشوائي على
  المسارات الداخلية.
- الإبلاغ عن الثغرات يكون على انفرادٍ إلى `team@sbay.sa` دون تضمين أيّ بياناتٍ
  شخصيةٍ أو اعتماداتٍ حيّة. التفصيل في `SECURITY.md`.

## 10. حدود الادعاء (بصراحة)

- `approved` ليست نهائية؛ و`published` تتطلّب إيصالًا موقّعًا يُثبت الدمج في
  المستودع.
- سجلّ D1 المشفَّر مع النسخة الاحتياطية الدورية على KV يدعمان استرجاع الكتابات
  المقبولة وإعادة البناء عند نقطةٍ زمنية، لكنّهما **لا** يقدّمان وعدًا بانعدام
  الفقد إذا تعطّل Cloudflare D1 وحاوية `CPOLY` معًا في الوقت نفسه.
- الحزمة التجريبية المؤلَّفة مرئيةٌ للمطوّرين وتصلح لاختبار سهولة الاستخدام،
  لكنّها **لا** تُثبت جاهزية المحلّل النهائية ولا تفي بأبواب الحسم المختومة.
- هذه المنصّة حالةُ استخدامٍ بحثيةٌ للتحكيم، وليست خدمة تصحيحٍ لغويٍّ نهائية.

## 11. التحقّق وإعادة الإنتاج

من نسخةٍ نظيفة، داخل `tools/msa-adjudication-workbench`:

```powershell
npm ci
npm run check
npm test
```

تُثبِّت `release/portal-15.0.0.json` سلامةَ الأصول عبر جذر `SHA-256` قانونيٍّ
مُطبَّعٍ بنهايات أسطر `LF`. يُعاد توليده حتميًّا بالأمر:

```powershell
npm run release:manifest
```

ويرفض سير عمل الأمان أيّ بيان إصدارٍ قديمٍ أو غير مُتتبَّع. الارتباطات الخاصّة
وملفّات البيئة والهُويّات والاعتمادات مستثناةٌ صراحةً من حدود هذا الإصدار.

## 12. الوثائق التفصيلية

| الوثيقة | الموضوع |
| --- | --- |
| `README.md` | نظرة المنصّة وتشغيلها ومسار الإنتاج السحابي. |
| `PRIVACY.md` | سياسة الخصوصية وجمع البيانات والاحتفاظ والمحو. |
| `SECURITY.md` | نموذج الثقة والضوابط والإبلاغ عن الثغرات. |
| `DEPLOYMENT.md` | إجراءات النشر والأسرار والبنية التشغيلية. |
| `CONSENSUS-PROTOCOL.md` | بروتوكول الأدوار والإجماع والنشر. |
| `infrastructure/cpoly-postgres/docs/ARCHITECTURE.md` | معمارية حاوية PostgreSQL. |
| `infrastructure/cpoly-postgres/operations/BACKUP-RESTORE.md` | النسخ الاحتياطي والاسترجاع. |

حقوق الاستخدام والتقييم موضّحةٌ في `../../EVALUATION-NOTICE.md` بجذر المستودع.

---

## English summary

This document is a plain-language transparency disclosure for the Arabic
adjudication portal at **https://adg.sbay.sa** (source under
`tools/msa-adjudication-workbench` in `sbay-dev/ADG-Lang`).

- **Published code is the running code.** The portal front-end assets in this
  repository match what is served in production, except for Cloudflare
  edge-injected analytics/challenge scripts that are not part of the source.
- **Purpose.** Independent human adjudication of `ADG-Lang` Modern Standard
  Arabic grammar/parse gold data by Arabic teachers, with no GitHub, JSON, or
  command-line knowledge required. Automated parser predictions are never shown
  (blind adjudication).
- **Process.** Four independent accounts (`A`, `B`, `J1`, `J2`) annotate
  independently, agreement is measured before discussion, `J1` adjudicates,
  `J2` ratifies the same root; `approved` is provisional for a 14-day appeal
  window and only becomes `published` after a signed repository receipt. GitHub
  is an evidence mirror, not the authoritative state store.
- **Data & privacy.** Identity (name, email, optional social usernames,
  expertise, consents) is EntityCrypt-encrypted (`HKDF-SHA-256` +
  `AES-256-GCM`) before leaving the Worker and is stored separately from public
  evidence. GitHub only ever receives a pseudonymous, HMAC-signed envelope.
  Email verification uses non-reversible fingerprints; plaintext codes and
  addresses are not stored. See `PRIVACY.md`.
- **Rights.** Explicit consent; default 365-day retention; in-portal erasure
  after task closure and retention expiry; D1 Time Travel snapshots may remain
  recoverable until the configured window elapses.
- **Infrastructure.** Cloudflare-first: Worker edge, a private `CPOLY`
  PostgreSQL container as the primary lane, an encrypted D1 recovery journal,
  and immutable chunked backups in a private KV namespace — no unnecessary paid
  subscriptions. `/admin/` is a separate Microsoft Entra control plane.
- **Security.** Strict CSP (no inline scripts/styles, no external fonts),
  `nosniff`, `frame-ancestors 'none'`, HMAC-signed internal envelopes with
  timestamp/nonce replay protection. Report privately to `team@sbay.sa`.
- **Claim boundaries.** The encrypted journal plus periodic KV backup support
  accepted-write recovery and point-in-time rebuild, but do **not** promise
  zero loss under simultaneous D1 and container failure. The developer-visible
  pilot cannot establish final parser readiness. This is a research
  adjudication use case, not a final proofreading service.
- **Reproduce.** From a clean clone, inside `tools/msa-adjudication-workbench`:
  `npm ci`, `npm run check`, `npm test`. Release integrity is bound by
  `release/portal-15.0.0.json` (canonical LF SHA-256 root), regenerated with
  `npm run release:manifest` and enforced by the GitHub Actions security
  workflow.
