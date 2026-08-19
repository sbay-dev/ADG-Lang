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
- لا يحمل سجلّ الحالة العام إلا ربط إصدار المهمة. ويُقبل الاسم التاريخي
  `evidence.identity` فقط إذا طابقت حقوله وقيمه هذا الربط العام حرفيًّا؛ وأي
  حقل هوية أو تواصل زائد يبقى مرفوضًا. تستخدم السجلات الجديدة `taskBinding`.
- يبقى كلّ دورٍ سابقٍ محفوظًا؛ وGitHub مرآةُ أدلّةٍ داعمةٍ لا قاعدةَ الحالة
  السلطويّة.

للتفصيل الكامل: `CONSENSUS-PROTOCOL.md`.

## 4. تدفّق المحكّم (تجربة الاستخدام)

الواجهة عربيةٌ باتجاه الكتابة من اليمين إلى اليسار، بطابعٍ مستوحًى من GitHub،
وبوضعين فاتحٍ ومظلمٍ يختارهما المحكّم. الخطوات الموجّهة:

1. الاطّلاع على المعايير وملخّص المحلّل.
2. إدخال بيانات الهوية والتواصل الخاصّة وإقرار الموافقات.
3. **التحقّق من البريد الإلكتروني** برمزٍ يُرسَل إلى صندوق المحكّم قبل المضيّ.
4. تسجيل مفتاح مرور (Passkey) قابلٍ للاكتشاف؛ البريد الموثّق هو مالك الحساب،
   ويمكن ربط أكثر من بصمةٍ أو جهازٍ أو مفتاح أمانٍ بالحساب نفسه، دون كلمة مرور.
5. قراءة المثال المحلول، ثمّ البدء بعيّنة PILOT الأساسية المثبّتة أول القائمة؛
   وهي تختبر الحفظ والإرسال ولا تدخل الإجماع العلمي، ثمّ الانتقال إلى الدور
   المستقلّ المُسنَد.
6. إكمال القرارات اللغوية الموجّهة، مع حفظ المسودّات المشفّرة يدويًّا وبعد كلّ
   تعديلٍ للعودة لاحقًا.
7. حفظ نسخةٍ محلّيةٍ مجهّلة أو الإرسال عبر واجهة API المحميّة.
8. بعد الإرسال: تصفّح النتائج السابقة باسمٍ مستعار، ومناقشة الأدلّة المرتبطة،
   ومتابعة حالة الإجماع، وتقديم استئنافٍ خلال نافذته.
9. عند وقوع خللٍ تشغيلي: فتح زر البلاغ الدائم وإرسال وصفٍ تقنيٍّ منقّى إلى
   قناة المستودع، دون اشتراط حساب GitHub.

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
  بصمات HMAC غير قابلةٍ للعكس، وتُستخدم البصمة نفسها لربط إسناد المهمة بالحساب
  الموثق، مع حدٍّ للمحاولات ومهلةٍ لإعادة الإرسال، ثمّ تُحذف سجلّات التحقّق
  القصيرة الأجل آليًّا.
- **ملكية الحساب:** تُعيد بصمة البريد الموثّق الحساب نفسه عند الاسترداد، بدل
  إنشاء هوية جديدة لكل بصمة. ويمكن لصاحب الجلسة إضافة مفاتيح مرور متعددة،
  ويُمنع تسجيل المفتاح نفسه مرتين.
- **تحكيمٌ أعمى:** لا تُعرض تنبّؤات المحلّل الآلي إطلاقًا.
- **مفاتيح المرور:** تُحفظ في قاعدة D1 مفاتيحُها العامّة وعدّادُها ومعرّفٌ
  عشوائي فقط، بينما تبقى الملفّات والمسودّات مشفّرةً بـ EntityCrypt، ورموز
  الجلسات عشوائيةً لا يُحفظ منها إلّا بصمة `SHA-256`.

## 7. حقوق المشارك

- موافقةٌ صريحةٌ قبل الإرسال.
- مدّة احتفاظٍ افتراضيةٌ قدرها 365 يومًا (قابلةٌ للضبط في إعداد النشر).
- يمكن لصاحب الحساب تسجيل **طلب محوٍ** من داخل المنصّة؛ يُنفَّذ بعد إغلاق مهامّه
  وانقضاء مدّة الاحتفاظ، فتُحذف مادّة الهوية والمسودات ومراجعاتها ومطالبات
  الاختبار التشغيلي من المخزن النشط، وتُزال صلة البريد والحساب من سجلات الإسناد،
  وتبقى النتيجة العلمية المجهّلة فقط.
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
- البلاغات التشغيلية العادية تُرسل من داخل الحساب إلى جدولٍ خاص، ثم تسحبها
  GitHub Actions بغلاف HMAC وتُنشئ مسألةً عامةً بصلاحية `issues: write`.
  لا تحمل الحمولة العامة معرّف الحساب أو الاسم أو البريد أو الملف أو المسودة
  أو القرارات اللغوية، ويمنع الخادم بيانات التواصل والروابط والاعتمادات
  والمحتوى النشط ويطبق حدودًا زمنيةً لكل حساب.
- الإبلاغ عن الثغرات يكون على انفرادٍ إلى `team@sbay.sa` دون تضمين أيّ بياناتٍ
  شخصيةٍ أو اعتماداتٍ حيّة في مسألة عامة. التفصيل في `SECURITY.md`.

## 10. حدود الادعاء (بصراحة)

- `approved` ليست نهائية؛ و`published` تتطلّب إيصالًا موقّعًا يُثبت الدمج في
  المستودع.
- سجلّ D1 المشفَّر مع النسخة الاحتياطية الدورية على KV يدعمان استرجاع الكتابات
  المقبولة وإعادة البناء عند نقطةٍ زمنية، لكنّهما **لا** يقدّمان وعدًا بانعدام
  الفقد إذا تعطّل Cloudflare D1 وحاوية `CPOLY` معًا في الوقت نفسه.
- الحزمة التجريبية المؤلَّفة مرئيةٌ للمطوّرين وتصلح لاختبار سهولة الاستخدام،
  لكنّها **لا** تُثبت جاهزية المحلّل النهائية ولا تفي بأبواب الحسم المختومة.
- وضع `operational-test` مسارٌ تشغيلي مُساعَد يختبر الإرسال إلى المستودع
  ويُنشر بتعهّدات صريحة: الاستقلال «لا»، والتعمية «لا»، والأصالة «نعم».
  ولا يشغل هذا المسار أدوار A أو B أو J1 أو J2، ولا يدخل آلة الإجماع.
- الحزمة العمياء الخاصة بهذا الاختبار منشورة في
  `human-evidence/tasks/` بوسم `lane: operational-test`، ويعرضها طلب المهام
  العادي أولًا بوصفها «العيّنة الأساسية» مع بقاء العزل نفسه. ويظل
  `?mode=operational-test` مرشحًا متوافقًا لعرض هذه الحارة وحدها. لا يُنشر ملف
  الإجابات المحلي ولا المعرّف الشخصي الموجود في غلاف التصدير.
- هذه المنصّة حالةُ استخدامٍ بحثيةٌ للتحكيم، وليست خدمة تصحيحٍ لغويٍّ نهائية.

## 11. تسليم المهام وحماية المسودات

- تتحقق GitHub Actions من مخطط كل حزمة ومسارها والحقول المحظورة وجذر Merkle،
  ثم ترسل دليل المهام إلى المنصة بغلاف HMAC مؤقت. لا يقبل الخادم تغيير محتوى
  هوية حزمة سبق تثبيتها.
- يعيد كل حدث حالة غير نهائي دُمج في المستودع إيصال HMAC مستقلًا يوقف إعادة
  المطالبة به، من دون أن يدّعي النشر. وتبقى حالة `approved` محكومة بإيصال
  النتيجة النهائي الأشد تقييدًا قبل `accepted` أو `published`.
- إذا منعت سياسة المنظمة `GITHUB_TOKEN` من فتح طلب السحب، يحتفظ سير العمل
  بالفرع الداخلي المتحقق منه وينشئ مسألة تشغيلية واحدة برابط المقارنة. ويعاد
  التحقق من الغلاف الموقّع وحدود الملفات حتى عندما يفتح المشغّل طلب السحب.
- يثبّت الخادم كذلك العنوان والملخص ونمط الإسناد والمسار والمستودع عند أول
  مزامنة؛ والتغيير اللاحق الوحيد المسموح هو السحب الأحادي الاتجاه، بلا إعادة
  تنشيطٍ صامتة.
- تظهر للمحكّم قائمة مهام مرتبطة بحسابه. ويمكن إسناد الدور إلى بريد موثّق؛
  يحتفظ المخزن ببصمة غير عكوسة وبنسخة EntityCrypt مشفّرة من البريد، ولا يدخل
  البريد إلى الدليل العام.
- تظهر العينة التشغيلية ذات 9 جمل و36 وحدة أولًا، وتظهر معها حزمة نقل القواعد
  المعماة ذات 7 جمل و76 وحدة بوصفها مهمة إجماع مفتوحة تمرّ من A وB إلى J1 ثم
  J2. ولا تتضمن الحزمة العامة مفتاح التغطية المختوم أو تنبؤات المحلّل.
- يستلم J1 نتيجتي A وB من الحالة السلطوية للمنصة، ويستلم J2 حزمة J1 منها؛
  فلا يحتاج المحكّمون إلى تبادل ملفات JSON في المسار المعتاد.
- يحفظ كل تحديث للمسودة النسخة المشفّرة السابقة قبل الاستبدال، ويحتفظ المتصفح
  بنسخة استرداد محلية عند تعذر الشبكة. ويظل رفع ملف واحد خيار طوارئ يعيد
  القرارات اللغوية فقط، ثم ينشئ التعهّدات من الجلسة الحالية.
- بعد اكتمال A وB يُحال انخفاض الاتفاق أو التعارض مباشرةً إلى J1 في الجولة
  نفسها، مع بقاء القياسات والأدلة محفوظة؛ ولا تعاد جولة A/B لمجرد انخفاض
  الاتفاق.
- ترتبط قناة البلاغات بحساب المحكّم في المخزن الخاص لضبط المعدل وعرض حالة
  المسألة له فقط. أمّا الحمولة التي تسحبها GitHub Actions فلا تتضمن هذا
  الارتباط. يعيد وسمٌ خفيٌّ ثابت استخدام المسألة نفسها إذا نجح إنشاؤها وتعثر
  الإيصال، ويزيل محو الهوية ارتباط الحساب بالبلاغ دون حذف المسألة العامة.

## 12. التحقّق وإعادة الإنتاج

من نسخةٍ نظيفة، داخل `tools/msa-adjudication-workbench`:

```powershell
npm ci
npm run check
npm test
```

تُثبِّت `release/portal-15.3.0.json` سلامةَ الأصول عبر جذر `SHA-256` قانونيٍّ
مُطبَّعٍ بنهايات أسطر `LF`. يُعاد توليده حتميًّا بالأمر:

```powershell
npm run release:manifest
```

ويرفض سير عمل الأمان أيّ بيان إصدارٍ قديمٍ أو غير مُتتبَّع. الارتباطات الخاصّة
وملفّات البيئة والهُويّات والاعتمادات مستثناةٌ صراحةً من حدود هذا الإصدار.

## 13. الوثائق التفصيلية

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
  independently, agreement is measured before discussion, disagreement is
  routed directly to `J1` in the same round, `J1` adjudicates,
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
- **Task delivery and recovery.** CODEOWNERS-protected repository manifests are
  schema/Merkle validated and HMAC-synchronized into an authenticated task
  inbox. The isolated PILOT baseline is pinned first without entering consensus.
  J1/J2 inputs are hydrated from stored evidence. Draft updates preserve the
  previous encrypted revision and the browser keeps a local recovery copy; file
  import is an emergency path only.
- **Issue reporting.** Authenticated reviewers can queue a bounded defect report
  without a GitHub account. The public payload excludes account/profile/email,
  drafts, and linguistic decisions; a least-privilege Action creates or reuses
  the Issue and returns an HMAC receipt. Security reports remain private.
- **Claim boundaries.** The encrypted journal plus periodic KV backup support
  accepted-write recovery and point-in-time rebuild, but do **not** promise
  zero loss under simultaneous D1 and container failure. The developer-visible
  pilot cannot establish final parser readiness. The `operational-test` lane
  is explicitly assisted (`Independent: No`, `Blind: No`, `Authentic: Yes`)
  and never occupies a consensus role. This is a research adjudication use
  case, not a final proofreading service.
- **Reproduce.** From a clean clone, inside `tools/msa-adjudication-workbench`:
  `npm ci`, `npm run check`, `npm test`. Release integrity is bound by
  `release/portal-15.3.0.json` (canonical LF SHA-256 root), regenerated with
  `npm run release:manifest` and enforced by the GitHub Actions security
  workflow.
