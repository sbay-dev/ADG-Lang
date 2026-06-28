using System.Text.Json;

namespace Adg.Compiler;

internal static class AdgJsonParser
{
    public static IAdgNode Parse(JsonElement element)
    {
        var kind = GetRequiredString(element, "kind", "type");
        return Normalize(kind) switch
        {
            "word" => ParseWord(element),
            "ism" => ParseIsm(element),
            "fil" or "fiil" or "fi'l" => ParseFil(element),
            "harf" => ParseHarf(element),
            "verbalsentence" or "verbal" => ParseVerbalSentence(element),
            "idafaphrase" or "idafa" => ParseIdafaPhrase(element),
            "harfgovernance" or "governance" => ParseHarfGovernance(element),
            "connectedsentence" or "connected" or "sequence" => ParseConnectedSentence(element),
            "condition" or "conditional" => ParseConditionalExpression(element),
            "explanation" or "explanatory" => ParseExplanatoryExpression(element),
            "negation" => ParseOperatorApplication(element, HarfRole.NegationOperator),
            "question" or "interrogative" => ParseOperatorApplication(element, HarfRole.InterrogativeOperator),
            "clause" => ParseClause(element),
            _ => throw new AdgParseException($"Unsupported ADG node kind '{kind}'.")
        };
    }

    private static Word ParseWord(JsonElement element)
    {
        var category = ParseTokenKind(GetRequiredString(element, "category", "tokenKind"));
        var surface = GetRequiredString(element, "surface", "text");
        return category switch
        {
            TokenKind.Ism => Word.Ism(surface, ParseCase(GetOptionalString(element, "case", "marker") ?? "None")),
            TokenKind.Fil => Word.Fil(surface, ParseCase(GetOptionalString(element, "case", "marker") ?? "None")),
            TokenKind.Harf => Word.Harf(surface, ParseRoleOrInfer(element, surface)),
            _ => throw new AdgParseException($"Unsupported token category '{category}'.")
        };
    }

    private static Word ParseIsm(JsonElement element) =>
        Word.Ism(GetRequiredString(element, "surface", "text"), ParseCase(GetOptionalString(element, "case", "marker") ?? "None"));

    private static Word ParseFil(JsonElement element) =>
        Word.Fil(GetRequiredString(element, "surface", "text"), ParseCase(GetOptionalString(element, "case", "marker") ?? "None"));

    private static Word ParseHarf(JsonElement element)
    {
        var surface = GetRequiredString(element, "surface", "text");
        return Word.Harf(surface, ParseRoleOrInfer(element, surface));
    }

    private static VerbalSentence ParseVerbalSentence(JsonElement element)
    {
        var verb = ParseWordOrSurface(element.GetRequiredProperty("verb"), TokenKind.Fil);
        var fail = ParseWordOrSurface(element.GetRequiredProperty("fail", "faail", "fa'il", "agent"), TokenKind.Ism, AdgCase.Raf);
        var maful = element.TryGetPropertyAny(out var mafulElement, "maful", "mafoul", "maf'ul", "patient")
            ? ParseWordOrSurface(mafulElement, TokenKind.Ism, AdgCase.Nasb)
            : null;

        var adjuncts = new List<IAdgNode>();
        if (element.TryGetPropertyAny(out var adjunctsElement, "adjuncts"))
        {
            if (adjunctsElement.ValueKind != JsonValueKind.Array)
            {
                throw new AdgParseException("adjuncts must be an array.");
            }

            foreach (var adjunct in adjunctsElement.EnumerateArray())
            {
                adjuncts.Add(Parse(adjunct));
            }
        }

        return new VerbalSentence(verb, fail, maful, adjuncts);
    }

    private static IdafaPhrase ParseIdafaPhrase(JsonElement element)
    {
        var mudaf = ParseWordOrSurface(element.GetRequiredProperty("mudaf"), TokenKind.Ism);
        var mudafIlayh = ParseWordOrSurface(element.GetRequiredProperty("mudafIlayh", "mudaf_ilayh", "dependent"), TokenKind.Ism, AdgCase.Jarr);
        return new IdafaPhrase(mudaf, mudafIlayh);
    }

    private static HarfGovernance ParseHarfGovernance(JsonElement element)
    {
        var op = ParseHarfLike(element.GetRequiredProperty("operator", "harf"));
        var operand = Parse(element.GetRequiredProperty("operand"));
        return new HarfGovernance(op, operand);
    }

    private static ConnectedSentence ParseConnectedSentence(JsonElement element)
    {
        var left = Parse(element.GetRequiredProperty("left"));
        var connector = ParseHarfLike(element.GetRequiredProperty("connector"));

        if (!element.TryGetPropertyAny(out var rightElement, "right", "consequence", "answer"))
        {
            if (connector.Role == HarfRole.ConditionalConnector)
            {
                throw new AdgTypeException(DiagnosticCode.MissingConditionalConsequence, $"ConditionalOperator \"{connector.Surface}\" requires ConsequenceClause.");
            }

            throw new AdgParseException("ConnectedSentence requires a right operand.");
        }

        return new ConnectedSentence(left, connector, Parse(rightElement));
    }

    private static ConnectedSentence ParseConditionalExpression(JsonElement element)
    {
        var condition = Parse(element.GetRequiredProperty("condition", "left"));
        var connector = element.TryGetPropertyAny(out var connectorElement, "connector")
            ? ParseHarfLike(connectorElement)
            : Word.Harf(GetOptionalString(element, "operator", "surface") ?? "إذا", HarfRole.ConditionalConnector);

        if (connector.Role != HarfRole.ConditionalConnector)
        {
            throw new AdgTypeException($"ConditionalOperator expected ConditionalConnector, but received {connector}.");
        }

        if (!element.TryGetPropertyAny(out var consequenceElement, "consequence", "answer", "right"))
        {
            throw new AdgTypeException(DiagnosticCode.MissingConditionalConsequence, $"ConditionalOperator \"{connector.Surface}\" requires ConsequenceClause.");
        }

        return new ConnectedSentence(condition, connector, Parse(consequenceElement));
    }

    private static ConnectedSentence ParseExplanatoryExpression(JsonElement element)
    {
        var explained = Parse(element.GetRequiredProperty("explained", "left"));
        var connector = element.TryGetPropertyAny(out var connectorElement, "connector")
            ? ParseHarfLike(connectorElement)
            : Word.Harf(GetOptionalString(element, "operator", "surface") ?? "أي", HarfRole.ExplanatoryConnector);

        if (connector.Role != HarfRole.ExplanatoryConnector)
        {
            throw new AdgTypeException($"ExplanatoryConnector expected ExplanatoryConnector, but received {connector}.");
        }

        if (!element.TryGetPropertyAny(out var explanationElement, "explanation", "right"))
        {
            throw new AdgTypeException($"ExplanatoryConnector \"{connector.Surface}\" requires an explanation operand.");
        }

        return new ConnectedSentence(explained, connector, Parse(explanationElement));
    }

    private static OperatorApplication ParseOperatorApplication(JsonElement element, HarfRole expectedRole)
    {
        var defaultSurface = expectedRole == HarfRole.NegationOperator ? "لا" : "هل";
        var op = element.TryGetPropertyAny(out var operatorElement, "operator", "harf")
            ? ParseHarfLike(operatorElement)
            : Word.Harf(GetOptionalString(element, "surface") ?? defaultSurface, expectedRole);

        if (op.Role == HarfRole.None)
        {
            op = Word.Harf(op.Surface, expectedRole);
        }

        if (op.Role != expectedRole)
        {
            throw new AdgTypeException(DiagnosticCode.InvalidOperatorArity, $"{expectedRole} expected {expectedRole}, but received {op}.");
        }

        if (!element.TryGetPropertyAny(out var targetElement, "target", "operand", "sentence", "clause"))
        {
            var code = expectedRole == HarfRole.NegationOperator
                ? DiagnosticCode.MissingNegationTarget
                : DiagnosticCode.MissingInterrogativeTarget;
            var message = expectedRole == HarfRole.NegationOperator
                ? "NegationOperator requires a target Token, Clause, or Sentence."
                : "InterrogativeOperator requires a complete target Sentence or typed UnknownSlot.";
            throw new AdgTypeException(code, message);
        }

        return new OperatorApplication(op, Parse(targetElement));
    }

    private static Clause ParseClause(JsonElement element)
    {
        var partsElement = element.GetRequiredProperty("parts", "body");
        if (partsElement.ValueKind != JsonValueKind.Array)
        {
            throw new AdgParseException("Clause parts must be an array.");
        }

        return new Clause(partsElement.EnumerateArray().Select(Parse).ToArray());
    }

    private static Word ParseWordOrSurface(JsonElement element, TokenKind expectedKind, AdgCase defaultCase = AdgCase.None)
    {
        if (element.ValueKind == JsonValueKind.String)
        {
            return expectedKind switch
            {
                TokenKind.Ism => Word.Ism(element.GetString() ?? "", defaultCase),
                TokenKind.Fil => Word.Fil(element.GetString() ?? "", defaultCase),
                TokenKind.Harf => Word.Harf(element.GetString() ?? "", InferRole(element.GetString() ?? "")),
                _ => throw new AdgParseException($"Unsupported token kind '{expectedKind}'.")
            };
        }

        if (element.ValueKind != JsonValueKind.Object)
        {
            throw new AdgParseException("Expected token object or surface string.");
        }

        var word = element.TryGetPropertyAny(out _, "category", "tokenKind")
            ? ParseWord(element)
            : expectedKind switch
            {
                TokenKind.Ism => ParseIsm(element),
                TokenKind.Fil => ParseFil(element),
                TokenKind.Harf => ParseHarf(element),
                _ => throw new AdgParseException($"Unsupported token kind '{expectedKind}'.")
            };

        TypeContracts.RequireKind(word, expectedKind, "Token parser");
        return word;
    }

    private static Word ParseHarfLike(JsonElement element) => ParseWordOrSurface(element, TokenKind.Harf);

    private static TokenKind ParseTokenKind(string value) => Normalize(value) switch
    {
        "ism" or "اسم" => TokenKind.Ism,
        "fil" or "fiil" or "fi'l" or "فعل" => TokenKind.Fil,
        "harf" or "حرف" => TokenKind.Harf,
        _ => throw new AdgParseException($"Unknown token category '{value}'.")
    };

    private static AdgCase ParseCase(string value) => Normalize(value) switch
    {
        "" or "none" or "null" => AdgCase.None,
        "raf" or "رفع" or "rafu" => AdgCase.Raf,
        "nasb" or "نصب" => AdgCase.Nasb,
        "jarr" or "جر" or "jar" => AdgCase.Jarr,
        "jazm" or "جزم" => AdgCase.Jazm,
        "tanwin" or "تنوين" => AdgCase.Tanwin,
        _ => throw new AdgParseException($"Unknown i'rab case '{value}'.")
    };

    private static HarfRole ParseRoleOrInfer(JsonElement element, string surface)
    {
        var value = GetOptionalString(element, "role", "operator", "connectorRole");
        return value is null ? InferRole(surface) : ParseRole(value, surface);
    }

    private static HarfRole ParseRole(string value, string surface) => Normalize(value) switch
    {
        "none" or "" => InferRole(surface),
        "nasb" or "nasboperator" or "حرفنصب" => HarfRole.NasbOperator,
        "jarr" or "jarroperator" or "حرفجر" => HarfRole.JarrOperator,
        "jazm" or "jazmoperator" or "حرفجزم" => HarfRole.JazmOperator,
        "raf" or "rafoperator" or "حرفرفع" => HarfRole.RafOperator,
        "sequence" or "sequenceconnector" or "ترتيب" => HarfRole.SequenceConnector,
        "coordination" or "coordinationconnector" or "عطف" => HarfRole.CoordinationConnector,
        "immediate" or "immediateconnector" or "consequence" or "تعقيب" => HarfRole.ImmediateConnector,
        "contrast" or "contrastconnector" or "استدراك" => HarfRole.ContrastConnector,
        "cause" or "causal" or "causalconnector" or "سبب" => HarfRole.CausalConnector,
        "condition" or "conditional" or "conditionalconnector" or "شرط" => HarfRole.ConditionalConnector,
        "explanation" or "explanatory" or "explanatoryconnector" or "تفسير" => HarfRole.ExplanatoryConnector,
        "negation" or "negationoperator" or "نفي" => HarfRole.NegationOperator,
        "question" or "interrogative" or "interrogativeoperator" or "استفهام" => HarfRole.InterrogativeOperator,
        _ => throw new AdgParseException($"Unknown Harf role '{value}'.")
    };

    private static HarfRole InferRole(string surface) => surface switch
    {
        "إنّ" or "أنّ" or "ليت" or "لعلّ" or "كأنّ" or "لكنّ" or "لكنَّ" => HarfRole.NasbOperator,
        "في" or "من" or "إلى" or "على" or "عن" or "الباء" or "ب" or "ل" or "ك" => HarfRole.JarrOperator,
        "لم" or "لما" or "لا الناهية" => HarfRole.JazmOperator,
        "ثم" => HarfRole.SequenceConnector,
        "و" => HarfRole.CoordinationConnector,
        "ف" or "فـ" => HarfRole.ImmediateConnector,
        "لكنْ" or "لكن" => HarfRole.ContrastConnector,
        "لأن" or "لأنَّه" or "لأنه" => HarfRole.CausalConnector,
        "إذا" or "إنْ" or "كلما" or "لو" or "أما" => HarfRole.ConditionalConnector,
        "أي" or "أيْ" => HarfRole.ExplanatoryConnector,
        "لا" or "لن" or "ليس" => HarfRole.NegationOperator,
        "هل" or "أ" or "أين" or "متى" or "كيف" or "كم" => HarfRole.InterrogativeOperator,
        _ => HarfRole.None
    };

    private static string GetRequiredString(JsonElement element, params string[] names)
    {
        var property = element.GetRequiredProperty(names);
        if (property.ValueKind != JsonValueKind.String)
        {
            throw new AdgParseException($"Property '{names[0]}' must be a string.");
        }

        return property.GetString() ?? "";
    }

    private static string? GetOptionalString(JsonElement element, params string[] names)
    {
        if (!element.TryGetPropertyAny(out var property, names))
        {
            return null;
        }

        if (property.ValueKind != JsonValueKind.String)
        {
            throw new AdgParseException($"Property '{names[0]}' must be a string.");
        }

        return property.GetString();
    }

    private static string Normalize(string value)
    {
        Span<char> buffer = stackalloc char[value.Length];
        var index = 0;

        foreach (var ch in value.Trim().ToLowerInvariant())
        {
            if (char.IsWhiteSpace(ch) || ch is '_' or '-' or '‘' or '’' or '\'' or '`' or 'ء')
            {
                continue;
            }

            buffer[index++] = ch;
        }

        return new string(buffer[..index]);
    }
}

