using System.Buffers;
using System.Globalization;
using System.Text;

namespace Adg.QuranicCore;

public sealed class QuranicTokenizer
{
    public IReadOnlyList<QuranicToken> Tokenize(string text)
    {
        ArgumentNullException.ThrowIfNull(text);

        var tokens = new List<QuranicToken>();
        var tokenStart = -1;
        var tokenLength = 0;
        var tokenKind = QuranicTokenKind.Other;

        void Flush()
        {
            if (tokenStart < 0)
            {
                return;
            }

            var surface = text.Substring(tokenStart, tokenLength);
            var range = new SourceRange(tokenStart, tokenLength);
            var normalizedSurface =
                QuranicTextNormalizer.NormalizeForAnalysis(surface);
            var effectiveKind =
                tokenKind == QuranicTokenKind.Word
                && normalizedSurface.Length == 0
                    ? QuranicTokenKind.Other
                    : tokenKind;
            var segments = effectiveKind == QuranicTokenKind.Word
                ? QuranicCliticSegmenter.Segment(surface, tokenStart)
                : [new QuranicSegment(
                    QuranicSegmentKind.Stem,
                    surface,
                    normalizedSurface,
                    range)];

            tokens.Add(new QuranicToken(
                tokens.Count,
                effectiveKind,
                surface,
                normalizedSurface,
                range,
                segments));

            tokenStart = -1;
            tokenLength = 0;
            tokenKind = QuranicTokenKind.Other;
        }

        for (var index = 0; index < text.Length;)
        {
            var status = Rune.DecodeFromUtf16(text.AsSpan(index), out var rune, out var consumed);
            if (status != OperationStatus.Done)
            {
                throw new ArgumentException($"Invalid UTF-16 sequence at index {index}.", nameof(text));
            }

            var category = Rune.GetUnicodeCategory(rune);
            if (Rune.IsWhiteSpace(rune))
            {
                Flush();
                index += consumed;
                continue;
            }

            var currentKind = Classify(rune, category);
            if (currentKind == QuranicTokenKind.Punctuation)
            {
                Flush();
                tokenStart = index;
                tokenLength = consumed;
                tokenKind = currentKind;
                Flush();
                index += consumed;
                continue;
            }

            if (tokenStart < 0)
            {
                tokenStart = index;
                tokenKind = currentKind;
            }
            else if (tokenKind != currentKind && !QuranicTextNormalizer.IsArabicMark(rune))
            {
                Flush();
                tokenStart = index;
                tokenKind = currentKind;
            }

            tokenLength += consumed;
            index += consumed;
        }

        Flush();
        return tokens;
    }

    private static QuranicTokenKind Classify(Rune rune, UnicodeCategory category)
    {
        if (category is UnicodeCategory.DecimalDigitNumber
            or UnicodeCategory.LetterNumber
            or UnicodeCategory.OtherNumber)
        {
            return QuranicTokenKind.Number;
        }

        if (category is UnicodeCategory.ConnectorPunctuation
            or UnicodeCategory.DashPunctuation
            or UnicodeCategory.OpenPunctuation
            or UnicodeCategory.ClosePunctuation
            or UnicodeCategory.InitialQuotePunctuation
            or UnicodeCategory.FinalQuotePunctuation
            or UnicodeCategory.OtherPunctuation)
        {
            return QuranicTokenKind.Punctuation;
        }

        return QuranicTextNormalizer.IsArabicRune(rune)
            ? QuranicTokenKind.Word
            : QuranicTokenKind.Other;
    }
}

internal static class QuranicCliticSegmenter
{
    public static IReadOnlyList<QuranicSegment> Segment(
        string surface,
        int absoluteStart)
    {
        var clusters = GetLetterClusters(surface);
        if (clusters.Count < 2)
        {
            return [Stem(surface, absoluteStart)];
        }

        var segments = new List<QuranicSegment>();
        var clusterIndex = 0;
        var first = clusters[0].NormalizedBase;

        if ((first is "ف" or "و")
            && IsConjunctionPrefix(clusters[0], first)
            && IsPlausibleConjunction(
                first,
                clusters.Skip(1).ToArray()))
        {
            segments.Add(ToSegment(
                first == "ف"
                    ? QuranicSegmentKind.ConjunctionFa
                    : QuranicSegmentKind.ConjunctionWa,
                surface,
                clusters[0].Start,
                clusters[0].Length,
                absoluteStart));
            clusterIndex++;
        }

        if (clusterIndex < clusters.Count - 1)
        {
            var candidate = clusters[clusterIndex].NormalizedBase;
            var remainder = string.Concat(
                clusters.Skip(clusterIndex + 1).Select(cluster => cluster.NormalizedBase));

            var kind = candidate switch
            {
                "ب" when ShouldSplitBa(remainder) =>
                    QuranicSegmentKind.PrepositionBa,
                "ك" when remainder.StartsWith("ال", StringComparison.Ordinal) =>
                    QuranicSegmentKind.PrepositionKa,
                "ل" when remainder.StartsWith("ال", StringComparison.Ordinal) =>
                    QuranicSegmentKind.PrepositionLam,
                "س" when LooksLikeImperfect(remainder) =>
                    QuranicSegmentKind.FutureSin,
                _ => (QuranicSegmentKind?)null
            };

            if (kind is not null)
            {
                segments.Add(ToSegment(
                    kind.Value,
                    surface,
                    clusters[clusterIndex].Start,
                    clusters[clusterIndex].Length,
                    absoluteStart));
                clusterIndex++;
            }
        }

        var stemStart = clusters[clusterIndex].Start;
        var stemLength = surface.Length - stemStart;
        segments.Add(ToSegment(
            QuranicSegmentKind.Stem,
            surface,
            stemStart,
            stemLength,
            absoluteStart));
        return segments;
    }

    internal static IReadOnlyList<LetterCluster> GetLetterClusters(string surface)
    {
        var clusters = new List<LetterCluster>();
        var currentStart = -1;
        var currentLength = 0;
        var currentBase = "";

        void Flush()
        {
            if (currentStart < 0)
            {
                return;
            }

            clusters.Add(new LetterCluster(
                currentStart,
                currentLength,
                currentBase,
                surface.Substring(currentStart, currentLength)));
            currentStart = -1;
            currentLength = 0;
            currentBase = "";
        }

        for (var index = 0; index < surface.Length;)
        {
            var status = Rune.DecodeFromUtf16(surface.AsSpan(index), out var rune, out var consumed);
            if (status != OperationStatus.Done)
            {
                throw new ArgumentException($"Invalid UTF-16 sequence at index {index}.", nameof(surface));
            }

            if (QuranicTextNormalizer.IsArabicMark(rune))
            {
                if (currentStart >= 0)
                {
                    currentLength += consumed;
                }

                index += consumed;
                continue;
            }

            Flush();
            currentStart = index;
            currentLength = consumed;
            currentBase = QuranicTextNormalizer.NormalizeForAnalysis(rune.ToString());
            index += consumed;
        }

        Flush();
        return clusters;
    }

    private static bool ShouldSplitBa(string remainder) =>
        remainder.StartsWith("ال", StringComparison.Ordinal)
        || remainder.StartsWith("ما", StringComparison.Ordinal)
        || new[]
        {
            "ذنب",
            "ظلم",
            "نقض",
            "كسب",
            "عمل",
            "فساد",
            "قلم",
            "عصا",
            "سيف"
        }.Any(stem => remainder.StartsWith(stem, StringComparison.Ordinal));

    private static bool IsConjunctionPrefix(
        LetterCluster cluster,
        string normalizedBase)
    {
        var hasShortVowel = cluster.Surface.Any(
            ch => ch is '\u064E' or '\u064F' or '\u0650');
        if (!hasShortVowel)
        {
            return true;
        }

        return normalizedBase switch
        {
            "ف" => cluster.Surface.Contains('\u064E'),
            "و" => cluster.Surface.Contains('\u064E'),
            _ => false
        };
    }

    private static bool IsPlausibleConjunction(
        string normalizedBase,
        IReadOnlyList<LetterCluster> remainderClusters)
    {
        if (remainderClusters.Count == 0)
        {
            return false;
        }

        var remainder = string.Concat(
            remainderClusters.Select(cluster => cluster.NormalizedBase));
        if (normalizedBase == "ف")
        {
            if (remainderClusters[0].NormalizedBase == "ب")
            {
                var afterBa = string.Concat(
                    remainderClusters.Skip(1).Select(cluster => cluster.NormalizedBase));
                return ShouldSplitBa(afterBa);
            }

            if (LooksLikeImperfect(remainderClusters))
            {
                return true;
            }

            return new[] { "قضي", "قتل", "وكز", "كلا" }
                .Any(stem => remainder.StartsWith(stem, StringComparison.Ordinal));
        }

        return remainder is "لا" or "ما"
            || remainder.StartsWith("لا", StringComparison.Ordinal)
            || remainder.StartsWith("ما", StringComparison.Ordinal);
    }

    private static bool LooksLikeImperfect(
        IReadOnlyList<LetterCluster> clusters) =>
        clusters.Count >= 3
        && clusters[0].NormalizedBase is "ا" or "ن" or "ي" or "ت"
        && !clusters[0].Surface.Contains('\u0652');

    private static bool LooksLikeImperfect(string value) =>
        value.Length > 2 && value[0] is 'ا' or 'ن' or 'ي' or 'ت';

    private static QuranicSegment Stem(string surface, int absoluteStart) =>
        new(
            QuranicSegmentKind.Stem,
            surface,
            QuranicTextNormalizer.NormalizeForAnalysis(surface),
            new SourceRange(absoluteStart, surface.Length));

    private static QuranicSegment ToSegment(
        QuranicSegmentKind kind,
        string surface,
        int start,
        int length,
        int absoluteStart)
    {
        var segmentSurface = surface.Substring(start, length);
        return new QuranicSegment(
            kind,
            segmentSurface,
            QuranicTextNormalizer.NormalizeForAnalysis(segmentSurface),
            new SourceRange(absoluteStart + start, length));
    }
}

internal sealed record LetterCluster(
    int Start,
    int Length,
    string NormalizedBase,
    string Surface);
