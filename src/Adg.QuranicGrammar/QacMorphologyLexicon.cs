using System.Collections.Frozen;
using System.Security.Cryptography;
using System.Text;
using Adg.QuranicCore;
using Adg.QuranicCorpus;

namespace Adg.QuranicGrammar;

public enum QacLexiconMatchKind
{
    Unknown,
    Exact,
    Normalized,
    Heuristic,
}

public enum QacMorphologyCandidateSource
{
    QuranicCorpus,
    Heuristic,
}

public sealed record QacWordAnalysis(
    int Chapter,
    int Verse,
    int Word,
    string Location,
    string BuckwalterSurface,
    string ArabicSurface,
    string NormalizedSurface,
    string MorphologySignature,
    IReadOnlyList<QacNormalizedMorphologyRecord> Segments);

public sealed record QacLexicalCandidate(
    string ArabicSurface,
    string NormalizedSurface,
    string MorphologySignature,
    QacMorphologyCandidateSource Source,
    long OccurrenceCount,
    string FirstEvidenceLocation,
    IReadOnlyList<QacNormalizedMorphologyRecord> Segments,
    int SelectionScore = 0);

public sealed record QacLexiconParseResult(
    string Input,
    string NormalizedInput,
    QacLexiconMatchKind MatchKind,
    IReadOnlyList<QacLexicalCandidate> Candidates);

public sealed class QacLexiconMetrics
{
    public long WordCount { get; init; }

    public long DistinctExactSurfaceCount { get; init; }

    public long DistinctNormalizedSurfaceCount { get; init; }

    public long DistinctMorphologySignatureCount { get; init; }

    public long ExactSelfLookupMissCount { get; init; }

    public long NormalizedSelfLookupMissCount { get; init; }

    public long TokenizerSingleWordCount { get; init; }

    public long TokenizerMultiwordCount { get; init; }

    public long MaxCandidatesPerNormalizedSurface { get; init; }

    public required string WordMerkleRoot { get; init; }

    public required string SurfaceIndexMerkleRoot { get; init; }
}

public sealed class QacMorphologyLexicon
{
    private readonly FrozenDictionary<string, IReadOnlyList<QacLexicalCandidate>> exact;
    private readonly FrozenDictionary<string, IReadOnlyList<QacLexicalCandidate>> normalized;

    private QacMorphologyLexicon(
        IReadOnlyList<QacWordAnalysis> words,
        FrozenDictionary<string, IReadOnlyList<QacLexicalCandidate>> exact,
        FrozenDictionary<string, IReadOnlyList<QacLexicalCandidate>> normalized,
        QacLexiconMetrics metrics)
    {
        Words = words;
        this.exact = exact;
        this.normalized = normalized;
        Metrics = metrics;
    }

    public IReadOnlyList<QacWordAnalysis> Words { get; }

    public QacLexiconMetrics Metrics { get; }

    public int MaxSurfaceWordCount =>
        exact.Count == 0
            ? 1
            : exact.Keys.Max(surface => surface.Count(character => character == ' ') + 1);

    public QacLexiconParseResult Parse(string surface)
    {
        ArgumentNullException.ThrowIfNull(surface);
        var normalizedSurface = QuranicTextNormalizer.NormalizeForAnalysis(surface);
        if (exact.TryGetValue(surface, out var exactCandidates))
        {
            return new QacLexiconParseResult(
                surface,
                normalizedSurface,
                QacLexiconMatchKind.Exact,
                exactCandidates);
        }

        return normalized.TryGetValue(normalizedSurface, out var normalizedCandidates)
            ? new QacLexiconParseResult(
                surface,
                normalizedSurface,
                QacLexiconMatchKind.Normalized,
                normalizedCandidates)
            : new QacLexiconParseResult(
                surface,
                normalizedSurface,
                QacLexiconMatchKind.Unknown,
                []);
    }

    public IEnumerable<KeyValuePair<string, IReadOnlyList<QacLexicalCandidate>>>
        EnumerateNormalizedIndex() =>
        normalized.OrderBy(pair => pair.Key, StringComparer.Ordinal);

    public static QacMorphologyLexicon Build(IEnumerable<QacMorphologyRecord> records)
    {
        ArgumentNullException.ThrowIfNull(records);
        var words = BuildWords(records).ToArray();
        var exact = BuildCandidateIndex(words, word => word.ArabicSurface);
        var normalized = BuildCandidateIndex(words, word => word.NormalizedSurface);
        var tokenizer = new QuranicTokenizer();
        long exactMisses = 0;
        long normalizedMisses = 0;
        long tokenizerSingleWordCount = 0;
        long tokenizerMultiwordCount = 0;
        var wordLeaves = new List<byte[]>(words.Length);

        foreach (var word in words)
        {
            if (!exact.ContainsKey(word.ArabicSurface))
            {
                exactMisses++;
            }

            if (!normalized.ContainsKey(word.NormalizedSurface))
            {
                normalizedMisses++;
            }

            var wordTokens = tokenizer.Tokenize(word.ArabicSurface)
                .Count(token => token.Kind == QuranicTokenKind.Word);
            if (wordTokens == 1)
            {
                tokenizerSingleWordCount++;
            }
            else
            {
                tokenizerMultiwordCount++;
            }

            wordLeaves.Add(
                SHA256.HashData(
                    Encoding.UTF8.GetBytes(
                        string.Concat(
                            word.Location,
                            "\t",
                            word.BuckwalterSurface,
                            "\t",
                            word.ArabicSurface,
                            "\t",
                            word.MorphologySignature))));
        }

        var surfaceLeaves = normalized
            .OrderBy(pair => pair.Key, StringComparer.Ordinal)
            .Select(pair =>
                SHA256.HashData(
                    Encoding.UTF8.GetBytes(
                        string.Concat(
                            pair.Key,
                            "\t",
                            string.Join(
                                "\u001F",
                                pair.Value.Select(candidate =>
                                    string.Concat(
                                        candidate.MorphologySignature,
                                        ":",
                                        candidate.OccurrenceCount)))))))
            .ToArray();

        return new QacMorphologyLexicon(
            words,
            exact,
            normalized,
            new QacLexiconMetrics
            {
                WordCount = words.Length,
                DistinctExactSurfaceCount = exact.Count,
                DistinctNormalizedSurfaceCount = normalized.Count,
                DistinctMorphologySignatureCount = normalized.Values
                    .SelectMany(candidates => candidates)
                    .Select(candidate => candidate.MorphologySignature)
                    .Distinct(StringComparer.Ordinal)
                    .LongCount(),
                ExactSelfLookupMissCount = exactMisses,
                NormalizedSelfLookupMissCount = normalizedMisses,
                TokenizerSingleWordCount = tokenizerSingleWordCount,
                TokenizerMultiwordCount = tokenizerMultiwordCount,
                MaxCandidatesPerNormalizedSurface = normalized.Count == 0
                    ? 0
                    : normalized.Values.Max(candidates => candidates.Count),
                WordMerkleRoot = QacMerkle.ComputeRoot(wordLeaves),
                SurfaceIndexMerkleRoot = QacMerkle.ComputeRoot(surfaceLeaves),
            });
    }

    private static IEnumerable<QacWordAnalysis> BuildWords(
        IEnumerable<QacMorphologyRecord> records)
    {
        var current = new List<QacMorphologyRecord>(5);
        QacWordKey? currentKey = null;
        foreach (var record in records)
        {
            if (currentKey is not null && currentKey.Value != record.Location.WordKey)
            {
                yield return BuildWord(current);
                current.Clear();
            }

            currentKey = record.Location.WordKey;
            current.Add(record);
        }

        if (current.Count > 0)
        {
            yield return BuildWord(current);
        }
    }

    private static QacWordAnalysis BuildWord(
        IReadOnlyList<QacMorphologyRecord> records)
    {
        var buckwalter = string.Concat(records.Select(record => record.Form));
        var arabic = string.Concat(
            records.Select(record =>
                record.Form.Length == 0
                    ? string.Empty
                    : ExtendedBuckwalter.Decode(record.Form)));
        var segments = records.Select(QacMorphologyResolver.Resolve).ToArray();
        var signature = string.Join(
            "+",
            records.Select(record =>
                string.Concat(
                    record.Tag,
                    "[",
                    string.Join(",", record.Features.Skip(1)),
                    "]")));
        return new QacWordAnalysis(
            records[0].Location.Chapter,
            records[0].Location.Verse,
            records[0].Location.Word,
            records[0].Location.WordKey.ToString(),
            buckwalter,
            arabic,
            QuranicTextNormalizer.NormalizeForAnalysis(arabic),
            signature,
            segments);
    }

    private static FrozenDictionary<string, IReadOnlyList<QacLexicalCandidate>>
        BuildCandidateIndex(
            IReadOnlyList<QacWordAnalysis> words,
            Func<QacWordAnalysis, string> keySelector) =>
        words.GroupBy(keySelector, StringComparer.Ordinal)
            .ToFrozenDictionary(
                group => group.Key,
                group => (IReadOnlyList<QacLexicalCandidate>)group
                    .GroupBy(word => word.MorphologySignature, StringComparer.Ordinal)
                    .Select(signatureGroup =>
                    {
                        var first = signatureGroup.First();
                        return new QacLexicalCandidate(
                            first.ArabicSurface,
                            first.NormalizedSurface,
                            first.MorphologySignature,
                            QacMorphologyCandidateSource.QuranicCorpus,
                            signatureGroup.LongCount(),
                            first.Location,
                            first.Segments);
                    })
                    .OrderBy(candidate => candidate.MorphologySignature, StringComparer.Ordinal)
                    .ToArray(),
                StringComparer.Ordinal);
}
