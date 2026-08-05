namespace Adg.LanguageEditor;

internal sealed class DiagnosticsMapper
{
    public GrammarDiagnostic Map(GrammarDiagnostic diagnostic) =>
        diagnostic with
        {
            Message = diagnostic.Code switch
            {
                "ADG1001" => "الفاعل يجب أن يكون مرفوعًا.",
                "ADG1002" => "المفعول به يجب أن يكون منصوبًا.",
                "ADG1003" => "الاسم بعد حرف الجر يجب أن يكون مجرورًا.",
                "ADG1004" => "أداة الشرط تحتاج إلى جواب شرط.",
                "ADG1005" => "التفسير يجب أن يطابق المفسَّر في الحالة الإعرابية.",
                "ADG1006" => "أداة الاستفهام تحتاج إلى جملة أو موضع استفهام مكتمل.",
                "ADG1007" => "أداة النفي تحتاج إلى متعلق تنفيه.",
                _ => diagnostic.Message
            },
            Explanation = Explain(diagnostic.Code, diagnostic.Token)
        };

    public string Explain(string code, string token) => code switch
    {
        "ADG1001" => $"في ADG-Lang، علاقة Fa'il لا تقبل إلا Ism بحالة Raf. الكلمة '{token}' لم تحقق هذا العقد.",
        "ADG1002" => $"في ADG-Lang، علاقة Maf'ul لا تقبل إلا Ism بحالة Nasb. الكلمة '{token}' لم تحقق هذا العقد.",
        "ADG1003" => $"حرف الجر عامل JarrOperator؛ لذلك يجب أن يكون الاسم المتعلق به مجرورًا. الكلمة '{token}' لم تحقق ذلك.",
        "ADG1004" => "أداة الشرط تفتح إطارًا يحتاج إلى شرط وجواب شرط. الإطار الحالي ناقص.",
        "ADG1005" => $"عند تفسير مفرد بمفرد يجب أن يطابق التفسير المفسَّر في الحالة الإعرابية. الكلمة '{token}' خالفت ذلك.",
        "ADG1006" => "أداة الاستفهام لا تعمل كرمز عائم؛ تحتاج إلى جملة كاملة أو موضع استفهام محدد.",
        "ADG1007" => "أداة النفي لا تعمل بلا متعلق؛ تحتاج إلى فعل أو جملة أو عبارة تنفيها.",
        _ => "Diagnostic issued by ADG-Lang."
    };
}
