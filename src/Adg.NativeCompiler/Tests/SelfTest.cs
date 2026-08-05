namespace Adg.NativeCompiler;

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

        RunCompileOptionTests();
        RunBuildOptionTests();
        RunFunctionTests();
        RunContractTranslationTests();
        RunRefinementTests();

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

    private static void RunBuildOptionTests()
    {
        var options = BuildOptions.Parse(
        [
            "input.adg",
            "--target",
            "linux-gcc",
            "--out",
            "build/app",
            "--emit-llvm",
            "out.ll",
            "--sysroot",
            "/sysroots/linux",
            "--clang",
            "clang",
            "--print"
        ]);

        AssertEqual("input.adg", options.InputPath, "build input path");
        if (options.Target != BuildTarget.LinuxGcc)
        {
            throw new AdgTypeException($"build target: expected LinuxGcc, received {options.Target}.");
        }

        AssertEqual("build/app", options.OutputPath ?? "", "build output path");
        AssertEqual("out.ll", options.LlvmOutputPath ?? "", "build LLVM output path");
        AssertEqual("/sysroots/linux", options.SysrootPath ?? "", "build sysroot path");
        AssertEqual("clang", options.ClangPath ?? "", "build clang path");
        if (!options.PrintRendered)
        {
            throw new AdgTypeException("build --print option was not parsed.");
        }

        foreach (var (text, expected) in new[]
        {
            ("windows-mingw", BuildTarget.WindowsMingw),
            ("linux-gcc", BuildTarget.LinuxGcc),
            ("wasm", BuildTarget.Wasm),
            ("wasi", BuildTarget.Wasm),
            ("llvm", BuildTarget.Llvm),
            ("host", BuildTarget.Host),
            ("native", BuildTarget.Host)
        })
        {
            if (BuildOptions.ParseTarget(text) != expected)
            {
                throw new AdgTypeException($"build target alias '{text}' did not map to {expected}.");
            }
        }

        ExpectCliFailure(() => BuildOptions.Parse(["input.adg"]), "build without --target should fail closed");
        ExpectCliFailure(() => BuildOptions.Parse(["input.adg", "--target", "solaris"]), "unknown build target should fail closed");
    }

    private static void RunCompileOptionTests()
    {
        var options = CompileOptions.Parse(
        [
            "input.adg",
            "--emit-llvm",
            "out.ll",
            "--native",
            "out.exe",
            "--wasi",
            "out.wasm",
            "--wasi-sysroot",
            "/wasi",
            "--clang",
            "clang",
            "--print"
        ]);

        AssertEqual("input.adg", options.InputPath, "compile input path");
        AssertEqual("out.ll", options.LlvmOutputPath ?? "", "compile LLVM output path");
        AssertEqual("out.exe", options.NativeOutputPath ?? "", "compile native output path");
        AssertEqual("out.wasm", options.WasiOutputPath ?? "", "compile WASI output path");
        AssertEqual("/wasi", options.WasiSysrootPath ?? "", "compile WASI sysroot path");
        AssertEqual("clang", options.ClangPath ?? "", "compile clang path");
        if (!options.PrintRendered)
        {
            throw new AdgTypeException("compile --print option was not parsed.");
        }

    }

    private static void RunContractTranslationTests()
    {
        const string clause = "يلتزم المقاول بتسليم المشروع في موعده، وعند الإخلال تستحق غرامة مالية مقدارها 5000 ريال.";
        var candidate = ContractClauseTranslator.Translate(clause);
        if (candidate.Kind != ContractClauseKind.Obligation)
        {
            throw new AdgTypeException($"contract translator kind: expected Obligation, received {candidate.Kind}.");
        }

        AssertEqual("المقاول", candidate.Obligor, "contract translator obligor");
        AssertEqual("تسليم المشروع في موعده", candidate.Obligation, "contract translator obligation");
        if (candidate.PenaltyAmount != 5000)
        {
            throw new AdgTypeException($"contract translator penalty: expected 5000, received {candidate.PenaltyAmount}.");
        }

        var adg = ContractClauseTranslator.ToAdg(candidate);
        var program = AdgFunctionParser.ParseLines(adg.Split('\n'));
        FunctionTypeChecker.Check(program);
        var ir = LlvmFunctionEmitter.Emit(program, "contract-translator-self-test.adg");
        foreach (var fragment in new[]
        {
            "define void @adg_func0(ptr %p0, ptr %p1, i32 %p2)",
            "icmp sgt i32 %p2, 0",
            "br i1 %cmp0",
            "i32 5000"
        })
        {
            if (!ir.Contains(fragment, StringComparison.Ordinal))
            {
                throw new AdgTypeException($"Contract translator IR is missing the expected fragment '{fragment}'.");
            }
        }

        ExpectCliFailure(
            () => ContractClauseTranslator.Translate("هذا نص حر لا يصرح بالملتزم ولا الالتزام."),
            "unsupported free text should fail closed");
        ExpectCliFailure(
            () => ContractClauseTranslator.Translate("يلتزم المقاول بتنفيذ العمل، وتستحق غرامة مقدارها ألف ريال."),
            "non-digit penalty amount should fail closed");
        ExpectCliFailure(
            () => ContractClauseTranslator.Translate("يلتزم المقاول بتنفيذ العمل، وتستحق غرامة مقدارها -5 ريال."),
            "negative penalty amount should fail closed");

        RunMultiClauseContractTranslationTest();
    }

    private static void RunMultiClauseContractTranslationTest()
    {
        const string contract = """
                                يلتزم المقاول بتسليم المشروع في موعده، وعند الإخلال تستحق غرامة مالية مقدارها 5000 ريال.
                                لا يجوز للمستأجر التنازل عن العقد، وتطبق غرامة مقدارها 1000 ريال.
                                يحق للبائع فسخ العقد عند تأخر المشتري عن السداد لمدة 30 يوما.
                                يلتزم المشتري بدفع مبلغ 12000 ريال إلى البائع في تاريخ 2026-07-15.
                                """;
        var document = ContractClauseTranslator.TranslateDocument(contract);
        if (document.Clauses.Count != 4)
        {
            throw new AdgTypeException($"contract translator document: expected 4 clauses, received {document.Clauses.Count}.");
        }

        var expectedKinds = new[]
        {
            ContractClauseKind.Obligation,
            ContractClauseKind.Prohibition,
            ContractClauseKind.TerminationRight,
            ContractClauseKind.Payment
        };
        for (var index = 0; index < expectedKinds.Length; index++)
        {
            if (document.Clauses[index].Kind != expectedKinds[index])
            {
                throw new AdgTypeException(
                    $"contract translator clause {index + 1}: expected {expectedKinds[index]}, received {document.Clauses[index].Kind}.");
            }
        }

        var adg = ContractClauseTranslator.ToAdg(document);
        var program = AdgFunctionParser.ParseLines(adg.Split('\n'));
        FunctionTypeChecker.Check(program);
        var ir = LlvmFunctionEmitter.Emit(program, "contract-document-translator-self-test.adg");
        foreach (var fragment in new[]
        {
            "define void @adg_func0(ptr %p0, ptr %p1, i32 %p2)",
            "define void @adg_func1(ptr %p0, ptr %p1, i32 %p2)",
            "define void @adg_func2(ptr %p0, ptr %p1)",
            "define void @adg_func3(ptr %p0, ptr %p1, i32 %p2, ptr %p3)",
            "i32 5000",
            "i32 1000",
            "i32 12000",
            "br i1 %cmp0"
        })
        {
            if (!ir.Contains(fragment, StringComparison.Ordinal))
            {
                throw new AdgTypeException($"Contract document translator IR is missing the expected fragment '{fragment}'.");
            }
        }
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

    private static void ExpectCliFailure(Action action, string label)
    {
        try
        {
            action();
        }
        catch (CliException)
        {
            return;
        }

        throw new AdgTypeException($"{label}: expected CLI failure but none was raised.");
    }

    private static void RunRefinementTests()
    {
        string[] positive =
        [
            "اتجاهُ النصِّ: RTL",
            "مُنقِّحٌ \"م\"",
            "معجمٌ \"كتب\" تشكيلُها \"كَتَبَ\"",
            "تطبيعٌ \"ضبطُ_المسافاتِ\"",
            "ضمانٌ تشكيليٌّ",
            "تشغيلٌ \"م\""
        ];

        var program = AdgRefinerParser.ParseLines(positive);
        RefinerTypeChecker.Check(program);
        var ir = LlvmRefinerEmitter.Emit(program, "self-test.adg");

        foreach (var fragment in new[]
        {
            "declare i32 @adg_run(i32, ptr)",
            "define i32 @main(i32 %argc, ptr %argv)",
            "@adg_lex_keys = constant [1 x ptr]",
            "@adg_lex_count = constant i32 1",
            "@adg_flag_collapse_spaces = constant i32 1",
            "@adg_flag_strip_tashkeel = constant i32 0",
            "call i32 @adg_run(i32 %argc, ptr %argv)"
        })
        {
            if (!ir.Contains(fragment, StringComparison.Ordinal))
            {
                throw new AdgTypeException($"Refiner IR is missing the expected fragment '{fragment}'.");
            }
        }

        ExpectRefinerDiagnostic(
            [
                "اتجاهُ النصِّ: RTL",
                "مُنقِّحٌ \"م\"",
                "معجمٌ \"مدرسه\" تشكيلُها \"مَدْرَسَةٌ\"",
                "ضمانٌ تشكيليٌّ",
                "تشغيلٌ \"م\""
            ],
            DiagnosticCode.SkeletonConservationViolation,
            "a vowelization that changes the consonantal skeleton should be rejected");

        ExpectRefinerDiagnostic(
            [
                "اتجاهُ النصِّ: RTL",
                "مُنقِّحٌ \"م\"",
                "معجمٌ \"كتب\" تشكيلُها \"كَتَبَ\"",
                "معجمٌ \"كتب\" تشكيلُها \"كُتُبٌ\"",
                "تشغيلٌ \"م\""
            ],
            DiagnosticCode.DuplicateLexiconEntry,
            "a duplicated lexicon key should be rejected");

        ExpectRefinerDiagnostic(
            [
                "اتجاهُ النصِّ: RTL",
                "مُنقِّحٌ \"م\"",
                "تشغيلٌ \"م\""
            ],
            DiagnosticCode.EmptyRefiner,
            "a refiner with no rules should be rejected");

        ExpectRefinerDiagnostic(
            [
                "اتجاهُ النصِّ: RTL",
                "مُنقِّحٌ \"م\"",
                "معجمٌ \"كتب\" تشكيلُها \"كَتَبَ\"",
                "تشغيلٌ \"غيرُه\""
            ],
            DiagnosticCode.UndefinedRefinerApplication,
            "running an undefined refiner should be rejected");

        ExpectRefinerDiagnostic(
            [
                "اتجاهُ النصِّ: RTL",
                "مُنقِّحٌ \"م\"",
                "تطبيعٌ \"قاعدةٌ_مجهولةٌ\"",
                "تشغيلٌ \"م\""
            ],
            DiagnosticCode.InvalidNormalizationRule,
            "an unknown normalization rule should be rejected");

        ExpectRefinerDiagnostic(
            [
                "اتجاهُ النصِّ: RTL",
                "مُنقِّحٌ \"م\"",
                "معجمٌ \"كتب\" تشكيلُها \"كَتَبَ\""
            ],
            DiagnosticCode.EmptyRefinerProgram,
            "a refiner program without a run statement should be rejected");

        ExpectRefinerDiagnostic(
            [
                "اتجاهُ النصِّ: RTL",
                "مُنقِّحٌ \"م\"",
                "معجمٌ \"كتب\" تشكيلُها \"كَتَبَ\"",
                "تشغيلٌ \"م\"",
                "تشغيلٌ \"م\""
            ],
            DiagnosticCode.MultipleRefinerApplications,
            "more than one run statement should be rejected");
    }

    private static void ExpectRefinerDiagnostic(string[] lines, DiagnosticCode expected, string label)
    {
        try
        {
            var program = AdgRefinerParser.ParseLines(lines);
            RefinerTypeChecker.Check(program);
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
