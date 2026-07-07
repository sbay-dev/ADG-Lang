namespace Adg.Compiler;

internal static class SelfTest
{
    public static int Run()
    {
        var first = new VerbalSentence(
            Word.Fil("كتبَ"),
            Word.Ism("الطالبُ", AdgCase.Raf),
            Word.Ism("الدرسَ", AdgCase.Nasb));

        var second = new VerbalSentence(
            Word.Fil("قرأَ"),
            Word.Ism("المعلمُ", AdgCase.Raf),
            Word.Ism("الكتابَ", AdgCase.Nasb),
            [
                new HarfGovernance(
                    Word.Harf("في", HarfRole.JarrOperator),
                    new IdafaPhrase(
                        Word.Ism("بيتِ", AdgCase.Jarr),
                        Word.Ism("العلمِ", AdgCase.Jarr)))
            ]);

        var program = new AdgProgram(new ConnectedSentence(first, Word.Harf("ثم", HarfRole.SequenceConnector), second));
        var verifiedProgram = AdgVerifier.Verify(program);
        AssertEqual("كتبَ الطالبُ الدرسَ ثم قرأَ المعلمُ الكتابَ في بيتِ العلمِ", program.RenderText(), "rendered proof text");

        ExpectTypeFailure(() => new VerbalSentence(
            Word.Fil("كتبَ"),
            Word.Ism("الطالبَ", AdgCase.Nasb),
            Word.Ism("الدرسَ", AdgCase.Nasb)), "Fa'il should reject Ism[Nasb]");

        ExpectTypeFailure(() => new VerbalSentence(
            Word.Fil("كتبَ"),
            Word.Ism("الطالبُ", AdgCase.Raf),
            Word.Ism("الدرسُ", AdgCase.Raf)), "Maf'ul should reject Ism[Raf]");

        ExpectTypeFailure(() => new ConnectedSentence(
            first,
            Word.Harf("ثم", HarfRole.SequenceConnector),
            Word.Ism("الدرسَ", AdgCase.Nasb)), "SequenceConnector should reject a naked object on the right");

        ExpectTypeFailure(() => new ConnectedSentence(
            Word.Ism("الفتىُ", AdgCase.Raf),
            Word.Harf("أي", HarfRole.ExplanatoryConnector),
            Word.Ism("الطالبَ", AdgCase.Nasb)), "ExplanatoryConnector should reject case mismatch");

        var llvm = LlvmModuleEmitter.Emit(verifiedProgram, "self-test.adg.json");
        if (!llvm.Contains("define i32 @main()", StringComparison.Ordinal) || !llvm.Contains("@adg_output", StringComparison.Ordinal))
        {
            throw new AdgTypeException("LLVM module does not contain the expected main/output symbols.");
        }

        RunFunctionTests();

        Console.WriteLine("ADG native compiler self-test passed.");
        return 0;
    }

    private static void RunFunctionTests()
    {
        string[] positive =
        [
            "اتجاهُ النصِّ: RTL",
            "دالةٌ \"د\" مُعامِلاتُها \"الفاعلُ\" مرفوعٌ \"المبلغُ\" عددٌ",
            "متنٌ \"يدفعُ {الفاعلُ}.\"",
            "شرطٌ \"المبلغُ\" أكبرُ ٠ جزاؤُهُ \"غرامةٌ مقدارُها {المبلغُ}.\"",
            "مُخرَجٌ نصٌّ",
            "استدعاءٌ \"د\" \"زيدٌ\" ١٠٠",
            "استدعاءٌ \"د\" \"عمرٌو\" ٠"
        ];

        var program = AdgFunctionParser.ParseLines(positive);
        FunctionTypeChecker.Check(program);
        var ir = LlvmFunctionEmitter.Emit(program, "self-test.adg");

        foreach (var fragment in new[]
        {
            "declare i32 @printf(ptr, ...)",
            "define void @adg_func0(ptr %p0, i32 %p1)",
            "icmp sgt i32 %p1, 0",
            "br i1 %cmp0",
            "call void @adg_func0(ptr",
            "i32 100",
            "i32 0"
        })
        {
            if (!ir.Contains(fragment, StringComparison.Ordinal))
            {
                throw new AdgTypeException($"Function IR is missing the expected fragment '{fragment}'.");
            }
        }

        ExpectFunctionDiagnostic(
            [
                "اتجاهُ النصِّ: RTL",
                "دالةٌ \"د\" مُعامِلاتُها \"الفاعلُ\" مرفوعٌ \"المبلغُ\" عددٌ",
                "متنٌ \"يدفعُ {الفاعلُ}.\"",
                "استدعاءٌ \"د\" \"زيدٌ\""
            ],
            DiagnosticCode.FunctionArityMismatch,
            "call arity mismatch should be rejected");

        ExpectFunctionDiagnostic(
            [
                "اتجاهُ النصِّ: RTL",
                "دالةٌ \"د\" مُعامِلاتُها \"الفاعلُ\" مرفوعٌ",
                "متنٌ \"يدفعُ {الفاعلُ}.\"",
                "شرطٌ \"الفاعلُ\" أكبرُ ٠ جزاؤُهُ \"خطأٌ.\"",
                "استدعاءٌ \"د\" \"زيدٌ\""
            ],
            DiagnosticCode.ConditionRequiresNumber,
            "condition on a text parameter should be rejected");

        ExpectFunctionDiagnostic(
            [
                "اتجاهُ النصِّ: RTL",
                "دالةٌ \"د\" مُعامِلاتُها \"الفاعلُ\" مرفوعٌ",
                "متنٌ \"يدفعُ {المبلغُ}.\"",
                "استدعاءٌ \"د\" \"زيدٌ\""
            ],
            DiagnosticCode.UndefinedFunctionParameter,
            "undefined parameter reference should be rejected");

        ExpectFunctionDiagnostic(
            [
                "اتجاهُ النصِّ: RTL",
                "دالةٌ \"د\" مُعامِلاتُها \"الفاعلُ\" مرفوعٌ",
                "متنٌ \"يدفعُ {الفاعلُ}.\""
            ],
            DiagnosticCode.EmptyFunctionProgram,
            "a function program without a call should be rejected");
    }

    private static void ExpectFunctionDiagnostic(string[] lines, DiagnosticCode expected, string label)
    {
        try
        {
            var program = AdgFunctionParser.ParseLines(lines);
            FunctionTypeChecker.Check(program);
        }
        catch (AdgDiagnosticException ex)
        {
            if (ex.Code != expected)
            {
                throw new AdgTypeException($"{label}: expected {expected}, received {ex.Code} ({ex.Message}).");
            }

            return;
        }

        throw new AdgTypeException($"{label}: expected diagnostic {expected} but none was raised.");
    }

    private static void AssertEqual(string expected, string actual, string label)
    {
        if (!string.Equals(expected, actual, StringComparison.Ordinal))
        {
            throw new AdgTypeException($"{label} mismatch. Expected '{expected}', received '{actual}'.");
        }
    }

    private static void ExpectTypeFailure(Action action, string label)
    {
        try
        {
            action();
        }
        catch (AdgTypeException)
        {
            return;
        }

        throw new AdgTypeException($"{label}: expected an ADG type failure.");
    }
}
