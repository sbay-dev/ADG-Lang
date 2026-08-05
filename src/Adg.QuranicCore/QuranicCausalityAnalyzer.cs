namespace Adg.QuranicCore;

public sealed class QuranicCausalityAnalyzer
{
    private static readonly HashSet<string> NegationMarkers =
        new(StringComparer.Ordinal) { "لا", "لم", "لن", "ما" };

    private static readonly HashSet<string> CausalNouns =
        new(StringComparer.Ordinal)
        {
            "ذنب",
            "ظلم",
            "نقض",
            "كسب",
            "عمل",
            "فساد"
        };

    private static readonly HashSet<string> InstrumentNouns =
        new(StringComparer.Ordinal)
        {
            "قلم",
            "عصا",
            "سيف"
        };

    private static readonly string[] ConsequencePastStems =
    [
        "قضي",
        "قتل",
        "وكز"
    ];

    private readonly QuranicTokenizer tokenizer = new();

    public QuranicAnalysis Analyze(string text)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(text);

        var tokens = tokenizer.Tokenize(text);
        var markers = new List<QuranicCausalMarker>();
        var diagnostics = new List<QuranicDiagnostic>();

        foreach (var token in tokens.Where(token => token.Kind == QuranicTokenKind.Word))
        {
            AnalyzeFa(text, tokens, token, markers, diagnostics);
            AnalyzeBa(text, tokens, token, markers);
        }

        return new QuranicAnalysis(
            text,
            string.Join(
                " ",
                tokens
                    .Where(token => token.Kind != QuranicTokenKind.Punctuation)
                    .Select(token => token.NormalizedSurface)),
            tokens,
            markers
                .OrderBy(marker => marker.MarkerRange.Start)
                .ThenBy(marker => marker.Kind)
                .ToArray(),
            diagnostics);
    }

    private static void AnalyzeFa(
        string text,
        IReadOnlyList<QuranicToken> tokens,
        QuranicToken token,
        List<QuranicCausalMarker> markers,
        List<QuranicDiagnostic> diagnostics)
    {
        var fa = token.Segments.FirstOrDefault(
            segment => segment.Kind == QuranicSegmentKind.ConjunctionFa);
        var stem = token.Segments.LastOrDefault(
            segment => segment.Kind == QuranicSegmentKind.Stem);

        if (fa is null || stem is null)
        {
            return;
        }

        if (token.Segments.Any(
            segment => segment.Kind == QuranicSegmentKind.PrepositionBa))
        {
            markers.Add(new QuranicCausalMarker(
                QuranicCausalMarkerKind.FaResumption,
                QuranicCausalDirection.None,
                QuranicVerbMood.Unknown,
                token.Index,
                token.Surface,
                fa.Surface,
                fa.Range,
                null,
                null,
                "ADG-QC1-FA-RESUMPTION-BEFORE-BA",
                "The fa prefix resumes the statement before a governed ba phrase."));
            return;
        }

        var clauseStart = FindClauseStart(text, token.Range.Start);
        var priorForms = tokens
            .Take(token.Index)
            .Where(candidate =>
                candidate.Kind == QuranicTokenKind.Word
                && candidate.Range.Start >= clauseStart)
            .Select(candidate => candidate.Segments.Last().NormalizedSurface)
            .ToArray();
        var normalizedStem = stem.NormalizedSurface;

        if (LooksLikeImperfect(normalizedStem)
            && priorForms.TakeLast(8).Any(NegationMarkers.Contains))
        {
            var mood = InferMood(stem);
            if (mood == QuranicVerbMood.Nasb)
            {
                markers.Add(new QuranicCausalMarker(
                    QuranicCausalMarkerKind.FaSababiyya,
                    QuranicCausalDirection.LeftCauseToRightEffect,
                    mood,
                    token.Index,
                    token.Surface,
                    fa.Surface,
                    fa.Range,
                    RangeBefore(text, token.Range.Start),
                    RangeAfter(text, stem.Range.Start),
                    "ADG-QC1-FA-SABABIYYA-NEGATION",
                    "A prefixed fa introduces an imperfect consequence after a nearby negation or prohibition."));
            }
            else
            {
                markers.Add(new QuranicCausalMarker(
                    QuranicCausalMarkerKind.FaSababiyyaCandidate,
                    QuranicCausalDirection.None,
                    mood,
                    token.Index,
                    token.Surface,
                    fa.Surface,
                    fa.Range,
                    null,
                    null,
                    "ADG-QC1-FA-SABABIYYA-MOOD-UNVERIFIED",
                    "The causal context is present, but the required Nasb mood was not verified."));
                diagnostics.Add(new QuranicDiagnostic(
                    "ADG-QC1001",
                    "Fa sababiyya requires the following imperfect verb to be in Nasb.",
                    stem.Range));
            }

            return;
        }

        var nearbyPriorForms = priorForms.TakeLast(8).ToArray();
        var hasUntilCondition = nearbyPriorForms.Contains("حتي", StringComparer.Ordinal)
            && nearbyPriorForms.Contains("اذا", StringComparer.Ordinal);
        if (hasUntilCondition)
        {
            markers.Add(new QuranicCausalMarker(
                QuranicCausalMarkerKind.FaResumption,
                QuranicCausalDirection.None,
                QuranicVerbMood.Past,
                token.Index,
                token.Surface,
                fa.Surface,
                fa.Range,
                null,
                null,
                "ADG-QC1-FA-RESUMPTION-HATTA-IDHA",
                "The fa follows a hatta-idha narrative frame and is retained as sequence/resumption."));
            return;
        }

        if (token.Index > 0
            && ConsequencePastStems.Any(
                candidate => normalizedStem.StartsWith(
                    candidate,
                    StringComparison.Ordinal)))
        {
            markers.Add(new QuranicCausalMarker(
                QuranicCausalMarkerKind.FaConsequence,
                QuranicCausalDirection.LeftCauseToRightEffect,
                QuranicVerbMood.Past,
                token.Index,
                token.Surface,
                fa.Surface,
                fa.Range,
                RangeBefore(text, token.Range.Start),
                RangeAfter(text, stem.Range.Start),
                "ADG-QC1-FA-CONSEQUENCE-PAST-EVENT",
                "A past event follows an established event through fa; the relation is emitted as a consequence edge."));
            return;
        }

        // An unresolved initial fa stays unclassified instead of becoming
        // a success-shaped causal or resumption relation.
    }

    private static void AnalyzeBa(
        string text,
        IReadOnlyList<QuranicToken> tokens,
        QuranicToken token,
        List<QuranicCausalMarker> markers)
    {
        var ba = token.Segments.FirstOrDefault(
            segment => segment.Kind == QuranicSegmentKind.PrepositionBa);
        var stem = token.Segments.LastOrDefault(
            segment => segment.Kind == QuranicSegmentKind.Stem);

        if (ba is null || stem is null)
        {
            return;
        }

        var head = NormalizeNominalHead(stem.NormalizedSurface);
        if (stem.NormalizedSurface.StartsWith("ما", StringComparison.Ordinal))
        {
            markers.Add(CausalBa(
                text,
                token,
                ba,
                stem,
                "ADG-QC1-BA-SABABIYYA-RELATIVE",
                "Ba governs a relative ma clause that states the cause."));
            return;
        }

        if (CausalNouns.Contains(head))
        {
            markers.Add(CausalBa(
                text,
                token,
                ba,
                stem,
                "ADG-QC1-BA-SABABIYYA-NOUN",
                $"The governed nominal head '{head}' belongs to the audited causal-noun seed."));
            return;
        }

        if (InstrumentNouns.Contains(head))
        {
            markers.Add(new QuranicCausalMarker(
                QuranicCausalMarkerKind.BaInstrument,
                QuranicCausalDirection.None,
                QuranicVerbMood.Unknown,
                token.Index,
                token.Surface,
                ba.Surface,
                ba.Range,
                null,
                null,
                "ADG-QC1-BA-INSTRUMENT",
                $"The governed nominal head '{head}' belongs to the audited instrument seed."));
            return;
        }

        markers.Add(new QuranicCausalMarker(
            QuranicCausalMarkerKind.BaAmbiguous,
            QuranicCausalDirection.None,
            QuranicVerbMood.Unknown,
            token.Index,
            token.Surface,
            ba.Surface,
            ba.Range,
            null,
            null,
            "ADG-QC1-BA-AMBIGUOUS",
            "The prepositional ba is preserved without forcing a causal interpretation."));
    }

    private static QuranicCausalMarker CausalBa(
        string text,
        QuranicToken token,
        QuranicSegment ba,
        QuranicSegment stem,
        string ruleId,
        string evidence) =>
        new(
            QuranicCausalMarkerKind.BaSababiyya,
            QuranicCausalDirection.RightCauseToLeftEffect,
            QuranicVerbMood.Unknown,
            token.Index,
            token.Surface,
            ba.Surface,
            ba.Range,
            RangeAfter(text, stem.Range.Start),
            RangeBefore(
                text,
                token.Segments.FirstOrDefault(
                    segment => segment.Kind == QuranicSegmentKind.ConjunctionFa)
                    ?.Range.Start
                ?? ba.Range.Start),
            ruleId,
            evidence);

    private static QuranicVerbMood InferMood(QuranicSegment stem)
    {
        if (stem.NormalizedSurface.EndsWith("وا", StringComparison.Ordinal)
            && !stem.NormalizedSurface.EndsWith("ون", StringComparison.Ordinal))
        {
            return QuranicVerbMood.Nasb;
        }

        var clusters = QuranicCliticSegmenter.GetLetterClusters(stem.Surface);
        var lexicalIndex = LastLexicalClusterIndex(clusters);
        if (lexicalIndex >= 0
            && clusters[lexicalIndex].Surface.Contains('\u064E'))
        {
            return QuranicVerbMood.Nasb;
        }

        return QuranicVerbMood.Unknown;
    }

    private static int LastLexicalClusterIndex(
        IReadOnlyList<LetterCluster> clusters)
    {
        var normalized = string.Concat(
            clusters.Select(cluster => cluster.NormalizedBase));
        foreach (var suffix in new[]
        {
            "كما",
            "كم",
            "كن",
            "هم",
            "هن",
            "ها",
            "نا",
            "ني",
            "ه",
            "ك"
        })
        {
            if (normalized.EndsWith(suffix, StringComparison.Ordinal)
                && clusters.Count > suffix.Length)
            {
                return clusters.Count - suffix.Length - 1;
            }
        }

        return clusters.Count - 1;
    }

    private static string NormalizeNominalHead(string value)
    {
        var head = value.StartsWith("ال", StringComparison.Ordinal)
            ? value[2..]
            : value;

        foreach (var suffix in new[] { "هما", "هم", "هن", "ها", "نا", "ني", "ه", "ك" })
        {
            if (head.EndsWith(suffix, StringComparison.Ordinal)
                && head.Length > suffix.Length + 1)
            {
                return head[..^suffix.Length];
            }
        }

        return head;
    }

    private static bool LooksLikeImperfect(string value) =>
        value.Length > 2 && value[0] is 'ا' or 'ن' or 'ي' or 'ت';

    private static SourceRange? RangeBefore(string text, int end)
    {
        return TrimRange(text, FindClauseStart(text, end), end);
    }

    private static SourceRange? RangeAfter(string text, int start)
    {
        return TrimRange(text, start, FindClauseEnd(text, start));
    }

    private static int FindClauseStart(string text, int end)
    {
        for (var index = end - 1; index >= 0; index--)
        {
            if (IsClauseBoundary(text[index]))
            {
                return index + 1;
            }
        }

        return 0;
    }

    private static int FindClauseEnd(string text, int start)
    {
        for (var index = start; index < text.Length; index++)
        {
            if (IsClauseBoundary(text[index]))
            {
                return index;
            }
        }

        return text.Length;
    }

    private static SourceRange? TrimRange(
        string text,
        int start,
        int end)
    {
        while (start < end && char.IsWhiteSpace(text[start]))
        {
            start++;
        }

        while (end > start && char.IsWhiteSpace(text[end - 1]))
        {
            end--;
        }

        return start >= end ? null : new SourceRange(start, end - start);
    }

    private static bool IsClauseBoundary(char value) =>
        value is '،' or '؛' or '.' or '؟' or '!' or '\r' or '\n' or '۝';
}
