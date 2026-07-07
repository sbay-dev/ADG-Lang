using System.Text.RegularExpressions;

namespace Adg.Compiler;

internal static partial class AdgSurfaceParser
{
    private static readonly IReadOnlyDictionary<string, string> CanonicalArabicKeywords = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        [Normalize("جملةٌ")] = "جملةٌ",
        [Normalize("فعليةٌ")] = "فعليةٌ",
        [Normalize("فعلُها")] = "فعلُها",
        [Normalize("فاعلُها")] = "فاعلُها",
        [Normalize("مفعولُها")] = "مفعولُها",
        [Normalize("جارٌّ")] = "جارٌّ",
        [Normalize("ومجرورٌ")] = "ومجرورٌ",
        [Normalize("إضافةٌ")] = "إضافةٌ",
        [Normalize("رابطٌ")] = "رابطٌ",
        [Normalize("اسمٌ")] = "اسمٌ",
        [Normalize("مرفوعٌ")] = "مرفوعٌ",
        [Normalize("منصوبٌ")] = "منصوبٌ",
        [Normalize("مجرورٌ")] = "مجرورٌ",
        [Normalize("مجزومٌ")] = "مجزومٌ",
        [Normalize("ترتيبٌ")] = "ترتيبٌ",
        [Normalize("سببٌ")] = "سببٌ",
        [Normalize("شرطٌ")] = "شرطٌ",
        [Normalize("تفسيرٌ")] = "تفسيرٌ",
        [Normalize("استدراكٌ")] = "استدراكٌ",
        [Normalize("عطفٌ")] = "عطفٌ",
        [Normalize("تعقيبٌ")] = "تعقيبٌ"
    };

    private static readonly HashSet<string> TechnicalKeywords =
    [
        "verbal",
        "fael",
        "maful",
        "adjunct",
        "jarr",
        "jar",
        "idafa",
        "connector",
        "clause",
        "fil",
        "ism",
        "sequence",
        "cause",
        "causal",
        "condition",
        "conditional",
        "explanation",
        "explanatory",
        "contrast",
        "coordination",
        "immediate",
        "raf",
        "nasb",
        "jazm",
        "none"
    ];

    public static IAdgNode ParseFile(string path)
    {
        var lines = File.ReadAllLines(path);
        var items = new List<object>();
        var directionHeaderValidated = false;

        foreach (var rawLine in lines)
        {
            var line = StripComment(rawLine).Trim();
            if (line.Length == 0)
            {
                continue;
            }

            if (!directionHeaderValidated)
            {
                TextDirectionHeader.Validate(line);
                directionHeaderValidated = true;
                continue;
            }

            if (line.StartsWith("adg ", StringComparison.OrdinalIgnoreCase) || line.StartsWith("program ", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (TryParseVerbal(line, out var verbal))
            {
                items.Add(verbal);
                continue;
            }

            if (TryParseAdjunct(line, out var adjunct))
            {
                AttachAdjunct(items, adjunct);
                continue;
            }

            if (TryParseConnector(line, out var connector))
            {
                items.Add(connector);
                continue;
            }

            if (TryParseClause(line, out var clause))
            {
                items.Add(clause);
                continue;
            }

            ThrowSurfaceDiagnostic(line);
        }

        if (!directionHeaderValidated)
        {
            throw new AdgParseException(
                DiagnosticCode.MissingTextDirectionHeader,
                $"Missing mandatory text direction header. First non-empty line must be '{TextDirectionHeader.Canonical}'.");
        }

        return Fold(items);
    }

    private static bool TryParseVerbal(string line, out VerbalSentence sentence)
    {
        var match = VerbalPattern().Match(line);
        var matchedArabic = false;
        if (!match.Success)
        {
            match = ArabicVerbalPattern().Match(line);
            matchedArabic = match.Success;
        }

        if (!match.Success)
        {
            sentence = null!;
            return false;
        }

        if (matchedArabic)
        {
            EnsureCanonicalArabicCaseLabel(match.Groups["failCase"].Value);
            EnsureCanonicalArabicCaseLabel(match.Groups["mafulCase"].Value);
        }

        var verb = Word.Fil(match.Groups["verb"].Value);
        var fail = Word.Ism(match.Groups["fail"].Value, ParseCase(match.Groups["failCase"].Value));
        var maful = match.Groups["maful"].Success
            ? Word.Ism(match.Groups["maful"].Value, ParseCase(match.Groups["mafulCase"].Value))
            : null;

        sentence = new VerbalSentence(verb, fail, maful);
        return true;
    }

    private static bool TryParseAdjunct(string line, out IAdgNode adjunct)
    {
        var match = JarrIdafaPattern().Match(line);
        var matchedArabic = false;
        if (!match.Success)
        {
            match = ArabicJarrIdafaPattern().Match(line);
            matchedArabic = match.Success;
        }

        if (!match.Success)
        {
            adjunct = null!;
            return false;
        }

        if (matchedArabic)
        {
            EnsureCanonicalArabicCaseLabel(match.Groups["mudafCase"].Value);
            EnsureCanonicalArabicCaseLabel(match.Groups["mudafIlayhCase"].Value);
        }

        adjunct = new HarfGovernance(
            Word.Harf(match.Groups["operator"].Value, HarfRole.JarrOperator),
            new IdafaPhrase(
                Word.Ism(match.Groups["mudaf"].Value, ParseCase(match.Groups["mudafCase"].Value)),
                Word.Ism(match.Groups["mudafIlayh"].Value, ParseCase(match.Groups["mudafIlayhCase"].Value))));
        return true;
    }

    private static bool TryParseConnector(string line, out Word connector)
    {
        var match = ConnectorPattern().Match(line);
        var matchedArabic = false;
        if (!match.Success)
        {
            match = ArabicConnectorPattern().Match(line);
            matchedArabic = match.Success;
        }

        if (!match.Success)
        {
            connector = null!;
            return false;
        }

        var role = ParseRole(match.Groups["role"].Value);
        if (matchedArabic)
        {
            EnsureCanonicalArabicRoleLabel(match.Groups["role"].Value, role);
        }

        connector = Word.Harf(match.Groups["surface"].Value, role);
        return true;
    }

    private static bool TryParseClause(string line, out Clause clause)
    {
        var match = ClausePattern().Match(line);
        var matchedArabic = false;
        if (!match.Success)
        {
            match = ArabicClausePattern().Match(line);
            matchedArabic = match.Success;
        }

        if (!match.Success)
        {
            clause = null!;
            return false;
        }

        var parts = new List<IAdgNode> { Word.Fil(match.Groups["verb"].Value) };
        var rest = match.Groups["rest"].Value.Trim();

        while (rest.Length > 0)
        {
            var expectedPattern = matchedArabic ? ArabicClauseIsmPattern() : ClauseIsmPattern();
            var mixedPattern = matchedArabic ? ClauseIsmPattern() : ArabicClauseIsmPattern();
            var ismMatch = expectedPattern.Match(rest);

            if (!ismMatch.Success)
            {
                if (mixedPattern.IsMatch(rest))
                {
                    throw new AdgParseException(
                        DiagnosticCode.MixedSurfaceSyntax,
                        "Mixed canonical Arabic and technical syntax is not allowed within a single clause statement.");
                }

                throw new AdgParseException($"Unsupported ADG surface clause segment: {rest}");
            }

            if (matchedArabic)
            {
                EnsureCanonicalArabicCaseLabel(ismMatch.Groups["case"].Value);
            }

            parts.Add(Word.Ism(ismMatch.Groups["surface"].Value, ParseCase(ismMatch.Groups["case"].Value)));
            rest = ismMatch.Groups["rest"].Value.Trim();
        }

        clause = new Clause(parts);
        return true;
    }

    private static void AttachAdjunct(List<object> items, IAdgNode adjunct)
    {
        for (var index = items.Count - 1; index >= 0; index--)
        {
            if (items[index] is VerbalSentence sentence)
            {
                items[index] = new VerbalSentence(
                    sentence.Verb,
                    sentence.Fail,
                    sentence.Maful,
                    [.. sentence.Adjuncts, adjunct]);
                return;
            }
        }

        throw new AdgParseException("adjunct statement requires a previous verbal statement.");
    }

    private static IAdgNode Fold(IReadOnlyList<object> items)
    {
        if (items.Count == 0)
        {
            throw new AdgParseException("ADG surface file did not contain any executable statements.");
        }

        if (items[0] is not IAdgNode current)
        {
            throw new AdgParseException("ADG surface file must start with a node statement.");
        }

        var index = 1;
        while (index < items.Count)
        {
            if (items[index] is not Word connector || items.Count <= index + 1 || items[index + 1] is not IAdgNode right)
            {
                throw new AdgParseException("ADG surface statements must alternate node, connector, node.");
            }

            current = new ConnectedSentence(current, connector, right);
            index += 2;
        }

        return current;
    }

    private static void EnsureCanonicalArabicCaseLabel(string value)
    {
        if (!HasArabicLetter(value))
        {
            throw new AdgParseException(
                DiagnosticCode.MixedSurfaceSyntax,
                $"Technical case label '{value}' is not allowed inside canonical Arabic statements.");
        }

        var parsedCase = ParseCase(value);
        var canonical = parsedCase switch
        {
            AdgCase.Raf => "مرفوعٌ",
            AdgCase.Nasb => "منصوبٌ",
            AdgCase.Jarr => "مجرورٌ",
            AdgCase.Jazm => "مجزومٌ",
            _ => null
        };

        if (canonical is not null && !string.Equals(value, canonical, StringComparison.Ordinal))
        {
            throw new AdgParseException(
                DiagnosticCode.InvalidKeywordIrab,
                $"Arabic case label '{value}' must be written as '{canonical}'.");
        }
    }

    private static void EnsureCanonicalArabicRoleLabel(string value, HarfRole role)
    {
        if (!HasArabicLetter(value))
        {
            throw new AdgParseException(
                DiagnosticCode.MixedSurfaceSyntax,
                $"Technical connector role '{value}' is not allowed inside canonical Arabic statements.");
        }

        var canonical = role switch
        {
            HarfRole.SequenceConnector => "ترتيبٌ",
            HarfRole.CausalConnector => "سببٌ",
            HarfRole.ConditionalConnector => "شرطٌ",
            HarfRole.ExplanatoryConnector => "تفسيرٌ",
            HarfRole.ContrastConnector => "استدراكٌ",
            HarfRole.CoordinationConnector => "عطفٌ",
            HarfRole.ImmediateConnector => "تعقيبٌ",
            _ => null
        };

        if (canonical is not null && !string.Equals(value, canonical, StringComparison.Ordinal))
        {
            throw new AdgParseException(
                DiagnosticCode.InvalidKeywordIrab,
                $"Arabic connector role '{value}' must be written as '{canonical}'.");
        }
    }

    private static void ThrowSurfaceDiagnostic(string line)
    {
        var normalizedLine = StripQuotedContent(line);
        var tokens = normalizedLine
            .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(token => token.Length > 0 && token != "\"\"")
            .ToArray();

        var hasCanonical = false;
        var hasTechnical = false;

        foreach (var token in tokens)
        {
            var normalizedToken = Normalize(token);
            if (normalizedToken.Length == 0)
            {
                continue;
            }

            if (CanonicalArabicKeywords.TryGetValue(normalizedToken, out var canonical))
            {
                hasCanonical = true;
                if (!string.Equals(token, canonical, StringComparison.Ordinal))
                {
                    throw new AdgParseException(
                        DiagnosticCode.InvalidKeywordIrab,
                        $"Arabic keyword '{token}' must be written as '{canonical}'.");
                }

                continue;
            }

            if (TechnicalKeywords.Contains(normalizedToken))
            {
                hasTechnical = true;
                continue;
            }

            if (HasArabicLetter(token))
            {
                throw new AdgParseException(
                    DiagnosticCode.UnknownArabicKeyword,
                    $"Unknown Arabic keyword '{token}' in ADG surface syntax.");
            }
        }

        if (hasCanonical && hasTechnical)
        {
            throw new AdgParseException(
                DiagnosticCode.MixedSurfaceSyntax,
                "Mixed canonical Arabic and technical syntax is not allowed in the same ADG statement.");
        }

        throw new AdgParseException($"Unsupported ADG surface statement: {line}");
    }

    private static AdgCase ParseCase(string value) => Normalize(value) switch
    {
        "raf" or "رفع" or "مرفوع" => AdgCase.Raf,
        "nasb" or "نصب" or "منصوب" => AdgCase.Nasb,
        "jarr" or "jar" or "جر" or "مجرور" => AdgCase.Jarr,
        "jazm" or "جزم" or "مجزوم" => AdgCase.Jazm,
        "none" => AdgCase.None,
        _ => throw new AdgParseException($"Unknown ADG surface case '{value}'.")
    };

    private static HarfRole ParseRole(string value) => Normalize(value) switch
    {
        "sequence" or "ترتيب" => HarfRole.SequenceConnector,
        "cause" or "causal" or "سبب" => HarfRole.CausalConnector,
        "condition" or "conditional" or "شرط" => HarfRole.ConditionalConnector,
        "explanation" or "explanatory" or "تفسير" => HarfRole.ExplanatoryConnector,
        "contrast" or "استدراك" => HarfRole.ContrastConnector,
        "coordination" or "عطف" => HarfRole.CoordinationConnector,
        "immediate" or "تعقيب" => HarfRole.ImmediateConnector,
        _ => throw new AdgParseException($"Unknown ADG surface connector role '{value}'.")
    };

    private static string StripComment(string line)
    {
        var index = line.IndexOf('#', StringComparison.Ordinal);
        return index < 0 ? line : line[..index];
    }

    private static string Normalize(string value)
    {
        var normalized = value.Trim().ToLowerInvariant().Replace("_", "", StringComparison.Ordinal).Replace("-", "", StringComparison.Ordinal);
        Span<char> buffer = stackalloc char[normalized.Length];
        var index = 0;

        foreach (var ch in normalized)
        {
            if (ch is >= '\u064B' and <= '\u065F' or '\u0670')
            {
                continue;
            }

            buffer[index++] = ch;
        }

        return new string(buffer[..index]);
    }

    private static bool HasArabicLetter(string value)
    {
        foreach (var ch in value)
        {
            if (ch is >= '\u0600' and <= '\u06FF' or >= '\u0750' and <= '\u077F' or >= '\u08A0' and <= '\u08FF')
            {
                return true;
            }
        }

        return false;
    }

    private static string StripQuotedContent(string line) => QuotedContentPattern().Replace(line, "\"\"");

    [GeneratedRegex("^verbal\\s+\"(?<verb>[^\"]+)\"\\s+fael\\s+\"(?<fail>[^\"]+)\"\\s+(?<failCase>\\S+)(?:\\s+maful\\s+\"(?<maful>[^\"]+)\"\\s+(?<mafulCase>\\S+))?\\s*$", RegexOptions.CultureInvariant)]
    private static partial Regex VerbalPattern();

    [GeneratedRegex("^جملةٌ\\s+فعليةٌ\\s+\"(?<verb>[^\"]+)\"\\s+فاعلُها\\s+\"(?<fail>[^\"]+)\"\\s+(?<failCase>\\S+)\\s+مفعولُها\\s+\"(?<maful>[^\"]+)\"\\s+(?<mafulCase>\\S+)\\s*$", RegexOptions.CultureInvariant)]
    private static partial Regex ArabicVerbalPattern();

    [GeneratedRegex("^adjunct\\s+jarr\\s+\"(?<operator>[^\"]+)\"\\s+idafa\\s+\"(?<mudaf>[^\"]+)\"\\s+(?<mudafCase>\\S+)\\s+\"(?<mudafIlayh>[^\"]+)\"\\s+(?<mudafIlayhCase>\\S+)\\s*$", RegexOptions.CultureInvariant)]
    private static partial Regex JarrIdafaPattern();

    [GeneratedRegex("^جارٌّ\\s+ومجرورٌ\\s+\"(?<operator>[^\"]+)\"\\s+إضافةٌ\\s+\"(?<mudaf>[^\"]+)\"\\s+(?<mudafCase>\\S+)\\s+\"(?<mudafIlayh>[^\"]+)\"\\s+(?<mudafIlayhCase>\\S+)\\s*$", RegexOptions.CultureInvariant)]
    private static partial Regex ArabicJarrIdafaPattern();

    [GeneratedRegex("^connector\\s+\"(?<surface>[^\"]+)\"\\s+(?<role>\\S+)\\s*$", RegexOptions.CultureInvariant)]
    private static partial Regex ConnectorPattern();

    [GeneratedRegex("^رابطٌ\\s+\"(?<surface>[^\"]+)\"\\s+(?<role>\\S+)\\s*$", RegexOptions.CultureInvariant)]
    private static partial Regex ArabicConnectorPattern();

    [GeneratedRegex("^clause\\s+fil\\s+\"(?<verb>[^\"]+)\"(?<rest>.*)$", RegexOptions.CultureInvariant)]
    private static partial Regex ClausePattern();

    [GeneratedRegex("^جملةٌ\\s+فعلُها\\s+\"(?<verb>[^\"]+)\"(?<rest>.*)$", RegexOptions.CultureInvariant)]
    private static partial Regex ArabicClausePattern();

    [GeneratedRegex("^ism\\s+\"(?<surface>[^\"]+)\"\\s+(?<case>\\S+)(?<rest>.*)$", RegexOptions.CultureInvariant)]
    private static partial Regex ClauseIsmPattern();

    [GeneratedRegex("^اسمٌ\\s+\"(?<surface>[^\"]+)\"\\s+(?<case>\\S+)(?<rest>.*)$", RegexOptions.CultureInvariant)]
    private static partial Regex ArabicClauseIsmPattern();

    [GeneratedRegex("\"[^\"]*\"", RegexOptions.CultureInvariant)]
    private static partial Regex QuotedContentPattern();
}
