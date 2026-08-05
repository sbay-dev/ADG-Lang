namespace Adg.LanguageEditor;

internal sealed class GrammarRefinementEngine(
    TextNormalizer normalizer,
    Tokenizer tokenizer,
    DiagnosticsMapper diagnosticsMapper,
    SuggestionEngine suggestionEngine,
    RewriteValidator rewriteValidator,
    SemanticConservationGate conservationGate)
{
    public static GrammarRefinementEngine CreateDefault()
    {
        var normalizer = new TextNormalizer();
        var tokenizer = new Tokenizer();
        var diagnosticsMapper = new DiagnosticsMapper();
        var rewriteValidator = new RewriteValidator(AdgVerifierClient.Discover());
        var conservationGate = new SemanticConservationGate();
        var suggestionEngine = new SuggestionEngine(rewriteValidator, conservationGate);

        return new GrammarRefinementEngine(normalizer, tokenizer, diagnosticsMapper, suggestionEngine, rewriteValidator, conservationGate);
    }

    public RefinementResult Analyze(string text)
    {
        var analysis = BuildAnalysis(text);
        return new RefinementResult(
            analysis.Original,
            analysis.Normalized,
            analysis.Normalized,
            analysis.Diagnostics.Count == 0,
            analysis.Diagnostics,
            null,
            []);
    }

    public RefinementResult Correct(string text)
    {
        var analysis = BuildAnalysis(text);
        var suggestions = suggestionEngine.Generate(analysis).ToArray();
        var approved = suggestions.FirstOrDefault(suggestion => suggestion.Verified);

        return new RefinementResult(
            analysis.Original,
            analysis.Normalized,
            approved?.Text ?? analysis.Normalized,
            analysis.Diagnostics.Count == 0,
            analysis.Diagnostics,
            approved,
            suggestions);
    }

    public RefinementResult Explain(string text)
    {
        var result = Correct(text);
        return result with
        {
            Diagnostics = result.Diagnostics
                .Select(diagnostic => diagnostic with { Explanation = diagnosticsMapper.Explain(diagnostic.Code, diagnostic.Token) })
                .ToArray()
        };
    }

    public RefinementResult Rewrite(string text)
    {
        var normalized = normalizer.Normalize(text);
        var rewritten = normalized;
        if (!CaseDetector.HasAnyCaseMark(normalized))
        {
            rewritten = RewriteUnvoweledSequence(normalized);
        }

        var result = Correct(rewritten);
        if (rewritten != normalized && result.Valid && rewriteValidator.Verify(rewritten))
        {
            var decision = conservationGate.RequiresAuthorDecision("The rewrite adds a sequence connector or infers structure not explicitly present in the original text.");
            var suggestion = new RefinementSuggestion(
                rewritten,
                true,
                "medium",
                [new RefinementChange(normalized, rewritten, "إعادة ضبط إعرابي وإضافة رابط تسلسل عند الحاجة.")],
                ["RewriteVerified"],
                decision.Kind,
                decision.Decision,
                decision.Reason);

            return result with
            {
                Original = text,
                Normalized = normalized,
                Corrected = normalized,
                VerifiedSuggestion = null,
                Suggestions = [suggestion]
            };
        }

        return result with { Original = text, Normalized = normalized };
    }

    public TraceResult Trace(string text)
    {
        var steps = new List<TraceStep>();
        var step = 1;

        steps.Add(new TraceStep(step++, "RawInput", "النص كما وصل إلى التطبيق.", new { text }));

        var normalized = normalizer.Normalize(text);
        steps.Add(new TraceStep(step++, "Normalization", "تنظيف النص وتوحيد المسافات والترقيم.", new { normalized }));

        var tokens = tokenizer.Tokenize(normalized).ToArray();
        steps.Add(new TraceStep(step++, "Tokenization", "تحويل النص إلى tokens مع الحالة الإعرابية المرصودة.", tokens));

        var rawDiagnostics = new List<GrammarDiagnostic>();
        var verbalDiagnostics = DetectVerbalDiagnostics(tokens).ToArray();
        rawDiagnostics.AddRange(verbalDiagnostics);
        steps.Add(new TraceStep(step++, "VerbalDiagnostics", "فحص الفاعل والمفعول في الجملة الفعلية.", verbalDiagnostics));

        var jarrDiagnostics = DetectJarrDiagnostics(tokens).ToArray();
        rawDiagnostics.AddRange(jarrDiagnostics);
        steps.Add(new TraceStep(step++, "JarrDiagnostics", "فحص أثر حروف الجر.", jarrDiagnostics));

        var conditionDiagnostics = DetectConditionDiagnostics(tokens).ToArray();
        rawDiagnostics.AddRange(conditionDiagnostics);
        steps.Add(new TraceStep(step++, "ConditionDiagnostics", "فحص اكتمال إطار الشرط.", conditionDiagnostics));

        var explanationDiagnostics = DetectExplanationDiagnostics(tokens).ToArray();
        rawDiagnostics.AddRange(explanationDiagnostics);
        steps.Add(new TraceStep(step++, "ExplanationDiagnostics", "فحص توافق علاقة التفسير.", explanationDiagnostics));

        var interrogativeDiagnostics = DetectInterrogativeDiagnostics(tokens).ToArray();
        rawDiagnostics.AddRange(interrogativeDiagnostics);
        steps.Add(new TraceStep(step++, "InterrogativeDiagnostics", "فحص متعلق أداة الاستفهام.", interrogativeDiagnostics));

        var negationDiagnostics = DetectNegationDiagnostics(tokens).ToArray();
        rawDiagnostics.AddRange(negationDiagnostics);
        steps.Add(new TraceStep(step++, "NegationDiagnostics", "فحص متعلق أداة النفي.", negationDiagnostics));

        var mappedDiagnostics = rawDiagnostics.Select(diagnosticsMapper.Map).ToArray();
        steps.Add(new TraceStep(step++, "DiagnosticsMapping", "تحويل diagnostics التقنية إلى رسائل مفهومة.", mappedDiagnostics));

        var analysis = new GrammarAnalysis(text, normalized, tokens, mappedDiagnostics);
        var suggestions = suggestionEngine.Generate(analysis).ToArray();
        steps.Add(new TraceStep(step++, "SuggestionEngine", "توليد اقتراحات مصنفة عبر Semantic Conservation Gate بعد ADG re-verification.", suggestions));

        var approved = suggestions.FirstOrDefault(suggestion => suggestion.Verified);
        var result = new RefinementResult(
            analysis.Original,
            analysis.Normalized,
            approved?.Text ?? analysis.Normalized,
            analysis.Diagnostics.Count == 0,
            analysis.Diagnostics,
            approved,
            suggestions);

        steps.Add(new TraceStep(step, "FinalResult", "الناتج النهائي بعد الفحص وإعادة التحقق.", result));

        return new TraceResult(text, steps, result);
    }

    private GrammarAnalysis BuildAnalysis(string text)
    {
        var normalized = normalizer.Normalize(text);
        var tokens = tokenizer.Tokenize(normalized).ToArray();
        var diagnostics = new List<GrammarDiagnostic>();

        diagnostics.AddRange(DetectVerbalDiagnostics(tokens));
        diagnostics.AddRange(DetectJarrDiagnostics(tokens));
        diagnostics.AddRange(DetectConditionDiagnostics(tokens));
        diagnostics.AddRange(DetectExplanationDiagnostics(tokens));
        diagnostics.AddRange(DetectInterrogativeDiagnostics(tokens));
        diagnostics.AddRange(DetectNegationDiagnostics(tokens));

        return new GrammarAnalysis(text, normalized, tokens, diagnostics.Select(diagnosticsMapper.Map).ToArray());
    }

    private static IEnumerable<GrammarDiagnostic> DetectVerbalDiagnostics(IReadOnlyList<TokenInfo> tokens)
    {
        if (tokens.Count < 3 || !tokens[0].LooksLikeVerb)
        {
            yield break;
        }

        if (tokens.Any(token => token.NormalizedSurface == "أي"))
        {
            yield break;
        }

        var fail = tokens[1];
        var maful = tokens[2];

        if (fail.Case != GrammarCase.Raf)
        {
            yield return GrammarDiagnostic.Raw("ADG1001", "InvalidFaelCase", fail.Surface, fail.Index, "Fa'il requires Raf.");
        }

        if (maful.Case != GrammarCase.Nasb)
        {
            yield return GrammarDiagnostic.Raw("ADG1002", "InvalidMafulCase", maful.Surface, maful.Index, "Maf'ul requires Nasb.");
        }
    }

    private static IEnumerable<GrammarDiagnostic> DetectJarrDiagnostics(IReadOnlyList<TokenInfo> tokens)
    {
        for (var index = 0; index < tokens.Count - 1; index++)
        {
            if (tokens[index].NormalizedSurface is "في" or "من" or "إلى" or "على" or "عن" && tokens[index + 1].Case != GrammarCase.Jarr)
            {
                yield return GrammarDiagnostic.Raw("ADG1003", "InvalidJarrOperand", tokens[index + 1].Surface, tokens[index + 1].Index, "JarrOperator requires Jarr operand.");
            }
        }
    }

    private static IEnumerable<GrammarDiagnostic> DetectConditionDiagnostics(IReadOnlyList<TokenInfo> tokens)
    {
        if (tokens.Count > 0 && tokens[0].NormalizedSurface is "إذا" or "إنْ" && tokens.Count < 4)
        {
            yield return GrammarDiagnostic.Raw("ADG1004", "MissingConditionalConsequence", tokens[0].Surface, tokens[0].Index, "ConditionalOperator requires ConsequenceClause.");
        }
    }

    private static IEnumerable<GrammarDiagnostic> DetectExplanationDiagnostics(IReadOnlyList<TokenInfo> tokens)
    {
        for (var index = 1; index < tokens.Count - 1; index++)
        {
            if (tokens[index].NormalizedSurface != "أي")
            {
                continue;
            }

            var explained = tokens[index - 1];
            var explanation = tokens[index + 1];
            if (explained.Case != GrammarCase.None && explanation.Case != GrammarCase.None && explained.Case != explanation.Case)
            {
                yield return GrammarDiagnostic.Raw("ADG1005", "ExplanationCaseMismatch", explanation.Surface, explanation.Index, "Explanation requires case agreement.");
            }
        }
    }

    private static IEnumerable<GrammarDiagnostic> DetectInterrogativeDiagnostics(IReadOnlyList<TokenInfo> tokens)
    {
        if (tokens.Count == 1 && tokens[0].NormalizedSurface is "هل" or "أ")
        {
            yield return GrammarDiagnostic.Raw("ADG1006", "MissingInterrogativeTarget", tokens[0].Surface, tokens[0].Index, "InterrogativeOperator requires a complete target.");
        }
    }

    private static IEnumerable<GrammarDiagnostic> DetectNegationDiagnostics(IReadOnlyList<TokenInfo> tokens)
    {
        if (tokens.Count == 1 && tokens[0].NormalizedSurface is "لا" or "لن" or "لم")
        {
            yield return GrammarDiagnostic.Raw("ADG1007", "MissingNegationTarget", tokens[0].Surface, tokens[0].Index, "NegationOperator requires a target.");
        }
    }

    private static string RewriteUnvoweledSequence(string text)
    {
        var words = text.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (words.Length < 6)
        {
            return text;
        }

        return $"{CaseDetector.SetCase(words[0], GrammarCase.Nasb)} {CaseDetector.SetCase(words[1], GrammarCase.Raf)} {CaseDetector.SetCase(words[2], GrammarCase.Nasb)}، ثم {CaseDetector.SetCase(words[3], GrammarCase.Nasb)} {CaseDetector.SetCase(words[4], GrammarCase.Raf)} {CaseDetector.SetCase(words[5], GrammarCase.Nasb)}";
    }
}
