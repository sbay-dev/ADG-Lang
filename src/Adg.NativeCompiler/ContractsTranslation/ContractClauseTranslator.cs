using System.Text;
using System.Text.RegularExpressions;

namespace Adg.NativeCompiler;

internal static class ContractClauseTranslator
{
    private static readonly Regex SpacePattern = new(@"\s+", RegexOptions.Compiled);
    private static readonly Regex ClauseStartSplitPattern = new(
        @"(?<=[\.؛;])\s+(?=(?:يلتزم|تلتزم|يجب\s+على|لا\s+يجوز|يحق\s+ل))",
        RegexOptions.Compiled);
    private static readonly Regex NumberingPattern = new(
        @"^\s*(?:(?:[0-9٠-٩۰-۹]+|[أابجدهوزحطيكلمنسعفصقرشتثخذضظغ])[\)\.\-]\s*)",
        RegexOptions.Compiled);
    private static readonly Regex PenaltyPattern = new(
        @"(?:غرامة|غرامه|جزاء)[^\d٠-٩۰-۹\-−]*(?<amount>[\-−]?[0-9٠-٩۰-۹]+)",
        RegexOptions.Compiled);
    private static readonly Regex PaymentPattern = new(
        @"^(?:يلتزم|تلتزم)\s+(?<payer>.+?)\s+ب(?:دفع|سداد)\s+(?:مبلغ(?:ا|ًا)?\s*)?(?<amount>[0-9٠-٩۰-۹]+)(?:\s*ريال(?:ا|ًا)?)?(?:\s+(?:إلى|الى|لـ|ل)\s+(?<beneficiary>.+?))?(?:\s+(?<due>(?:في|خلال|قبل|عند)\s+.+))?$",
        RegexOptions.Compiled);
    private static readonly Regex TerminationPattern = new(
        @"^يحق\s+(?<holder>لـ?\S+|لل\S+)\s+فسخ\s+العقد\s+(?<reason>.+)$",
        RegexOptions.Compiled);
    private static readonly Regex ProhibitionPattern = new(
        @"^لا\s+يجوز\s+(?<party>لـ?\S+|لل\S+)\s+(?<action>.+)$",
        RegexOptions.Compiled);
    private static readonly Regex ObligationPattern = new(
        @"^(?:يلتزم|تلتزم)\s+(?<obligor>.+?)\s+(?:بأن\s+يقوم\s+ب|بأن\s+|أن\s+|بـ|ب)(?<obligation>.+)$",
        RegexOptions.Compiled);
    private static readonly Regex MustPattern = new(
        @"^يجب\s+على\s+(?<obligor>.+?)\s+(?<obligation>.+)$",
        RegexOptions.Compiled);
    private static readonly Regex AlaPattern = new(
        @"^على\s+(?<obligor>.+?)\s+(?<obligation>.+)$",
        RegexOptions.Compiled);
    private static readonly Regex BoundaryPattern = new(
        @"(?:،|\.|؛| عند\s+الإخلال| عند\s+الاخلال| في\s+حال\s+الإخلال| في\s+حال\s+الاخلال| وتستحق\s+(?:غرامة|غرامه)| تستحق\s+(?:غرامة|غرامه)| وتطبق\s+(?:غرامة|غرامه)| تطبق\s+(?:غرامة|غرامه))",
        RegexOptions.Compiled);

    public static ContractClauseCandidate Translate(string sourceText)
    {
        var document = TranslateDocument(sourceText);
        if (document.Clauses.Count != 1)
        {
            throw new CliException($"Expected one supported clause, but translated {document.Clauses.Count} clauses.");
        }

        return document.Clauses[0];
    }

    public static ContractTranslationDocument TranslateDocument(string sourceText)
    {
        var clauses = SplitClauses(sourceText).Select(TranslateClause).ToArray();
        if (clauses.Length == 0)
        {
            throw new CliException("contract text is empty.");
        }

        return new ContractTranslationDocument(clauses);
    }

    public static string ToAdg(ContractClauseCandidate candidate) => ToAdg(new ContractTranslationDocument([candidate]));

    public static string ToAdg(ContractTranslationDocument document)
    {
        if (document.Clauses.Count == 0)
        {
            throw new CliException("contract translation produced no ADG calls.");
        }

        var builder = new StringBuilder();
        builder.AppendLine("اتجاهُ النصِّ: RTL");
        builder.AppendLine("adg 0.1.1");
        builder.AppendLine("program \"ترجمةُ-العقدِ\"");
        builder.AppendLine();
        AppendFunctionDefinitions(builder);

        foreach (var clause in document.Clauses)
        {
            builder.AppendLine(ToCall(clause));
        }

        return builder.ToString();
    }

    private static ContractClauseCandidate TranslateClause(string rawClause)
    {
        var normalized = Normalize(rawClause);
        var evidence = new List<string>();
        return TryParsePayment(normalized, rawClause, evidence)
            ?? TryParseTermination(normalized, rawClause, evidence)
            ?? TryParseProhibition(normalized, rawClause, evidence)
            ?? TryParseObligation(normalized, rawClause, evidence)
            ?? throw new CliException(
                "Unsupported contract clause. Current ADG translator supports explicit obligation, prohibition, " +
                "termination-right, and payment clauses only.");
    }

    private static ContractClauseCandidate? TryParseObligation(string normalized, string sourceText, List<string> evidence)
    {
        var core = StripConsequence(normalized);
        var match = ObligationPattern.Match(core);

        if (!match.Success)
        {
            match = MustPattern.Match(core);
        }

        if (!match.Success)
        {
            match = AlaPattern.Match(core);
        }

        if (!match.Success)
        {
            return null;
        }

        var penaltyAmount = ExtractPenalty(normalized, evidence);
        var obligor = CleanArgument(match.Groups["obligor"].Value);
        var obligation = CleanArgument(match.Groups["obligation"].Value);
        if (obligor.Length == 0 || obligation.Length == 0)
        {
            return null;
        }

        evidence.Add("kind=obligation");
        evidence.Add($"obligor={obligor}");
        evidence.Add($"obligation={obligation}");
        return new ContractClauseCandidate(
            ContractClauseKind.Obligation,
            obligor,
            obligation,
            penaltyAmount,
            string.Empty,
            string.Empty,
            sourceText,
            evidence);
    }

    private static ContractClauseCandidate? TryParseProhibition(string normalized, string sourceText, List<string> evidence)
    {
        var core = StripConsequence(normalized);
        var match = ProhibitionPattern.Match(core);
        if (!match.Success)
        {
            return null;
        }

        var penaltyAmount = ExtractPenalty(normalized, evidence);
        var party = CleanParty(match.Groups["party"].Value);
        var action = CleanArgument(match.Groups["action"].Value);
        if (party.Length == 0 || action.Length == 0)
        {
            return null;
        }

        evidence.Add("kind=prohibition");
        evidence.Add($"party={party}");
        evidence.Add($"action={action}");
        return new ContractClauseCandidate(
            ContractClauseKind.Prohibition,
            party,
            action,
            penaltyAmount,
            string.Empty,
            string.Empty,
            sourceText,
            evidence);
    }

    private static ContractClauseCandidate? TryParseTermination(string normalized, string sourceText, List<string> evidence)
    {
        var core = StripConsequence(normalized);
        var match = TerminationPattern.Match(core);
        if (!match.Success)
        {
            return null;
        }

        var holder = CleanParty(match.Groups["holder"].Value);
        var reason = CleanArgument(RemoveLeadingWhen(match.Groups["reason"].Value));
        if (holder.Length == 0 || reason.Length == 0)
        {
            return null;
        }

        evidence.Add("kind=termination_right");
        evidence.Add($"holder={holder}");
        evidence.Add($"reason={reason}");
        return new ContractClauseCandidate(
            ContractClauseKind.TerminationRight,
            holder,
            reason,
            0,
            string.Empty,
            string.Empty,
            sourceText,
            evidence);
    }

    private static ContractClauseCandidate? TryParsePayment(string normalized, string sourceText, List<string> evidence)
    {
        var core = StripConsequence(normalized);
        var match = PaymentPattern.Match(core);
        if (!match.Success)
        {
            return null;
        }

        var payer = CleanArgument(match.Groups["payer"].Value);
        if (!FunctionSyntax.TryParseInteger(match.Groups["amount"].Value, out var amount) || amount <= 0)
        {
            throw new CliException("Unsupported payment clause: payment amount must be a positive digit value.");
        }

        var beneficiary = CleanArgument(match.Groups["beneficiary"].Success
            ? match.Groups["beneficiary"].Value
            : "الطرف المستحق");
        var due = CleanArgument(match.Groups["due"].Success
            ? match.Groups["due"].Value
            : "موعد الاستحقاق المتفق عليه");
        if (payer.Length == 0 || beneficiary.Length == 0 || due.Length == 0)
        {
            return null;
        }

        evidence.Add("kind=payment");
        evidence.Add($"payer={payer}");
        evidence.Add($"beneficiary={beneficiary}");
        evidence.Add($"amount={amount}");
        evidence.Add($"due={due}");
        return new ContractClauseCandidate(
            ContractClauseKind.Payment,
            payer,
            "دفع المبلغ",
            amount,
            beneficiary,
            due,
            sourceText,
            evidence);
    }

    private static long ExtractPenalty(string text, List<string> evidence)
    {
        var match = PenaltyPattern.Match(text);
        if (!match.Success)
        {
            if (text.Contains("غرامة", StringComparison.Ordinal) || text.Contains("غرامه", StringComparison.Ordinal))
            {
                throw new CliException("Unsupported penalty clause: penalty amounts must be written as digits.");
            }

            evidence.Add("penalty=0:missing_penalty_amount");
            return 0;
        }

        var amountText = match.Groups["amount"].Value.Replace('−', '-');
        if (!FunctionSyntax.TryParseInteger(amountText, out var value))
        {
            throw new CliException($"Unsupported penalty amount '{amountText}'.");
        }

        if (value < 0)
        {
            throw new CliException("Unsupported penalty amount: the amount must be zero or positive.");
        }

        evidence.Add($"penalty={value}");
        return value;
    }

    private static IReadOnlyList<string> SplitClauses(string sourceText)
    {
        var normalizedNewLines = (sourceText ?? string.Empty)
            .Replace("\r\n", "\n", StringComparison.Ordinal)
            .Replace('\r', '\n');
        var clauses = new List<string>();
        foreach (var line in normalizedNewLines.Split('\n'))
        {
            foreach (var segment in ClauseStartSplitPattern.Split(line))
            {
                var cleaned = NumberingPattern.Replace(segment, string.Empty);
                cleaned = Normalize(cleaned);
                if (cleaned.Length > 0)
                {
                    clauses.Add(cleaned);
                }
            }
        }

        return clauses;
    }

    private static string StripConsequence(string text) => BoundaryPattern.Split(text, count: 2)[0].Trim();

    private static string Normalize(string text)
    {
        var value = ArabicText.StripTashkeel(text ?? string.Empty)
            .Replace("ـ", string.Empty, StringComparison.Ordinal)
            .Replace('\u00A0', ' ')
            .Replace("\r\n", " ", StringComparison.Ordinal)
            .Replace('\n', ' ')
            .Replace('\r', ' ');
        return SpacePattern.Replace(value, " ").Trim();
    }

    private static string CleanArgument(string value)
    {
        var cleaned = SpacePattern.Replace(value.Trim(), " ");
        cleaned = cleaned.Trim(' ', '.', '،', '؛', ':', '-');
        return cleaned;
    }

    private static string CleanParty(string value)
    {
        var cleaned = CleanArgument(value);
        if (cleaned.StartsWith("لـ", StringComparison.Ordinal))
        {
            return CleanArgument(cleaned[2..]);
        }

        if (cleaned.StartsWith("لل", StringComparison.Ordinal) && cleaned.Length > 2)
        {
            return "ال" + cleaned[2..];
        }

        return cleaned.StartsWith('ل') && cleaned.Length > 1 ? CleanArgument(cleaned[1..]) : cleaned;
    }

    private static string RemoveLeadingWhen(string value)
    {
        var cleaned = CleanArgument(value);
        return cleaned.StartsWith("عند ", StringComparison.Ordinal) ? CleanArgument(cleaned[4..]) : cleaned;
    }

    private static string EscapeAdgString(string value) => value.Replace("\"", "'", StringComparison.Ordinal);

    private static void AppendFunctionDefinitions(StringBuilder builder)
    {
        builder.AppendLine("دالةٌ \"صياغةُ_بندِ_الالتزامِ\" مُعامِلاتُها \"المُلتزِمُ\" مرفوعٌ \"الالتزامُ\" منصوبٌ \"الغرامةُ\" عددٌ");
        builder.AppendLine("  متنٌ \"يلتزمُ {المُلتزِمُ} بأن يقومَ بما يلي: {الالتزامُ}.\"");
        builder.AppendLine("  شرطٌ \"الغرامةُ\" أكبرُ ٠ جزاؤُهُ \"وعند الإخلالِ تُستحَقُّ غرامةٌ ماليةٌ مقدارُها {الغرامةُ} ريالًا.\"");
        builder.AppendLine("  مُخرَجٌ نصٌّ");
        builder.AppendLine();
        builder.AppendLine("دالةٌ \"صياغةُ_بندِ_الحظرِ\" مُعامِلاتُها \"المخاطَبُ\" مرفوعٌ \"التصرفُ\" منصوبٌ \"الغرامةُ\" عددٌ");
        builder.AppendLine("  متنٌ \"يُحظَرُ على {المخاطَبُ} القيامُ بالتصرفِ الآتي: {التصرفُ}.\"");
        builder.AppendLine("  شرطٌ \"الغرامةُ\" أكبرُ ٠ جزاؤُهُ \"وعند المخالفةِ تُستحَقُّ غرامةٌ ماليةٌ مقدارُها {الغرامةُ} ريالًا.\"");
        builder.AppendLine("  مُخرَجٌ نصٌّ");
        builder.AppendLine();
        builder.AppendLine("دالةٌ \"صياغةُ_بندِ_الفسخِ\" مُعامِلاتُها \"صاحبُ_الحقِ\" مرفوعٌ \"سببُ_الفسخِ\" منصوبٌ");
        builder.AppendLine("  متنٌ \"يحقُّ لـ{صاحبُ_الحقِ} فسخُ العقد عند تحقق السبب الآتي: {سببُ_الفسخِ}.\"");
        builder.AppendLine("  مُخرَجٌ نصٌّ");
        builder.AppendLine();
        builder.AppendLine("دالةٌ \"صياغةُ_بندِ_الدفعِ\" مُعامِلاتُها \"الدافعُ\" مرفوعٌ \"المستفيدُ\" منصوبٌ \"المبلغُ\" عددٌ \"الاستحقاقُ\" منصوبٌ");
        builder.AppendLine("  متنٌ \"يلتزمُ {الدافعُ} بدفع مبلغٍ قدرُه {المبلغُ} ريالًا إلى {المستفيدُ} وفق {الاستحقاقُ}.\"");
        builder.AppendLine("  شرطٌ \"المبلغُ\" أكبرُ ٠ جزاؤُهُ \"ويُعدُّ هذا المبلغُ دينًا مستحقًا في ذمةِ {الدافعُ}.\"");
        builder.AppendLine("  مُخرَجٌ نصٌّ");
        builder.AppendLine();
    }

    private static string ToCall(ContractClauseCandidate clause)
    {
        return clause.Kind switch
        {
            ContractClauseKind.Obligation =>
                $"استدعاءٌ \"صياغةُ_بندِ_الالتزامِ\" \"{EscapeAdgString(clause.PrimaryParty)}\" \"{EscapeAdgString(clause.Action)}\" {ToArabicIndic(clause.Amount)}",
            ContractClauseKind.Prohibition =>
                $"استدعاءٌ \"صياغةُ_بندِ_الحظرِ\" \"{EscapeAdgString(clause.PrimaryParty)}\" \"{EscapeAdgString(clause.Action)}\" {ToArabicIndic(clause.Amount)}",
            ContractClauseKind.TerminationRight =>
                $"استدعاءٌ \"صياغةُ_بندِ_الفسخِ\" \"{EscapeAdgString(clause.PrimaryParty)}\" \"{EscapeAdgString(clause.Action)}\"",
            ContractClauseKind.Payment =>
                $"استدعاءٌ \"صياغةُ_بندِ_الدفعِ\" \"{EscapeAdgString(clause.PrimaryParty)}\" \"{EscapeAdgString(clause.SecondaryParty)}\" {ToArabicIndic(clause.Amount)} \"{EscapeAdgString(clause.DueText)}\"",
            _ => throw new CliException($"Unsupported contract clause kind '{clause.Kind}'.")
        };
    }

    private static string ToArabicIndic(long value)
    {
        var source = value.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var builder = new StringBuilder(source.Length);
        foreach (var ch in source)
        {
            builder.Append(ch is >= '0' and <= '9' ? (char)('\u0660' + (ch - '0')) : ch);
        }

        return builder.ToString();
    }
}
