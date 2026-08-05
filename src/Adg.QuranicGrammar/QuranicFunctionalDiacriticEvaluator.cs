using System.Security.Cryptography;
using System.Text;
using Adg.QuranicCorpus;

namespace Adg.QuranicGrammar;

public sealed record QuranicFunctionalEvaluationSample(
    string Location,
    string ParserStatus,
    string FunctionalStatus,
    IReadOnlyList<string> DiagnosticCodes,
    IReadOnlyList<string> Relations,
    IReadOnlyList<string> Details);

public sealed class QuranicFunctionalDiacriticEvaluation
{
    public long VerseCount { get; init; }

    public long ValidVerseCount { get; init; }

    public long UnverifiedVerseCount { get; init; }

    public long InvalidVerseCount { get; init; }

    public long TargetEdgeCount { get; init; }

    public long CheckedEdgeCount { get; init; }

    public long VerifiedEdgeCount { get; init; }

    public long SkippedEdgeCount { get; init; }

    public long UnverifiedEdgeCount { get; init; }

    public long InvalidEdgeCount { get; init; }

    public SortedDictionary<string, long> ParserStatusCounts { get; init; } =
        new(StringComparer.Ordinal);

    public SortedDictionary<string, long> FunctionalStatusCounts { get; init; } =
        new(StringComparer.Ordinal);

    public SortedDictionary<string, long> DiagnosticCodeCounts { get; init; } =
        new(StringComparer.Ordinal);

    public SortedDictionary<string, long> RelationDiagnosticCounts { get; init; } =
        new(StringComparer.Ordinal);

    public IReadOnlyList<QuranicFunctionalEvaluationSample> Samples
        { get; init; } = [];

    public required string EvaluationMerkleRoot { get; init; }

    public bool IsValid =>
        VerseCount == 6236
        && InvalidVerseCount == 0
        && InvalidEdgeCount == 0
        && DiagnosticCodeCounts.GetValueOrDefault("ADG-QUR2102") == 0;
}

public static class QuranicFunctionalDiacriticEvaluator
{
    private const int MaximumSamples = 50;

    public static QuranicFunctionalDiacriticEvaluation Evaluate(
        QacMorphologyLexicon lexicon)
    {
        ArgumentNullException.ThrowIfNull(lexicon);
        var corpus = QacVerseCorpus.Build(lexicon.Words);
        var parser = new QacDeterministicGrammarParser(
            lexicon,
            enableHeuristicFallback: false);
        var validator = new QuranicFunctionalDiacriticValidator(
            QacDiacriticEvidenceIndex.Build(lexicon));
        var parserStatuses = new SortedDictionary<string, long>(
            StringComparer.Ordinal);
        var functionalStatuses = new SortedDictionary<string, long>(
            StringComparer.Ordinal);
        var diagnosticCodes = new SortedDictionary<string, long>(
            StringComparer.Ordinal);
        var relationDiagnostics = new SortedDictionary<string, long>(
            StringComparer.Ordinal);
        var samples = new List<QuranicFunctionalEvaluationSample>();
        var invalidSamples =
            new List<QuranicFunctionalEvaluationSample>();
        var leaves = new List<byte[]>(corpus.Verses.Count);
        long valid = 0;
        long unverified = 0;
        long invalid = 0;
        long targetEdges = 0;
        long checkedEdges = 0;
        long verifiedEdges = 0;
        long skippedEdges = 0;
        long unverifiedEdges = 0;
        long invalidEdges = 0;

        foreach (var verse in corpus.Verses)
        {
            var parse = parser.Parse(verse.Text);
            var report = validator.Validate(parse);
            Increment(parserStatuses, parse.Status.ToString());
            Increment(functionalStatuses, report.Status.ToString());
            switch (report.Status)
            {
                case QuranicFunctionalValidationStatus.Valid:
                    valid++;
                    break;
                case QuranicFunctionalValidationStatus.Unverified:
                    unverified++;
                    break;
                case QuranicFunctionalValidationStatus.Invalid:
                    invalid++;
                    break;
                default:
                    throw new InvalidOperationException();
            }

            targetEdges += report.TargetEdgeCount;
            checkedEdges += report.CheckedEdgeCount;
            verifiedEdges += report.VerifiedEdgeCount;
            skippedEdges += report.SkippedEdgeCount;
            unverifiedEdges += report.UnverifiedEdgeCount;
            invalidEdges += report.InvalidEdgeCount;
            foreach (var diagnostic in report.Diagnostics)
            {
                Increment(diagnosticCodes, diagnostic.Code);
                Increment(
                    relationDiagnostics,
                    $"{diagnostic.Relation}:{diagnostic.Code}");
            }

            if (report.Diagnostics.Count > 0)
            {
                var sample = new QuranicFunctionalEvaluationSample(
                    verse.Location,
                    parse.Status.ToString(),
                    report.Status.ToString(),
                    report.Diagnostics
                        .Select(value => value.Code)
                        .Distinct(StringComparer.Ordinal)
                        .OrderBy(value => value, StringComparer.Ordinal)
                        .ToArray(),
                    report.Diagnostics
                        .Select(value => value.Relation)
                        .Distinct(StringComparer.Ordinal)
                        .OrderBy(value => value, StringComparer.Ordinal)
                        .ToArray(),
                    report.Diagnostics
                        .Select(value =>
                            $"{value.Code}:{value.Relation}:"
                            + $"expected={value.ExpectedCase}:"
                            + $"observed={value.ObservedCaseMarkClass ?? "none"}:"
                            + $"canonical={string.Join(",", value.CanonicalCaseMarkClasses)}:"
                            + string.Join(",", value.Differences))
                        .OrderBy(value => value, StringComparer.Ordinal)
                        .ToArray());
                if (report.Status
                    == QuranicFunctionalValidationStatus.Invalid)
                {
                    if (invalidSamples.Count < MaximumSamples)
                    {
                        invalidSamples.Add(sample);
                    }
                }
                else if (samples.Count < MaximumSamples)
                {
                    samples.Add(sample);
                }
            }

            leaves.Add(
                SHA256.HashData(
                    Encoding.UTF8.GetBytes(
                        Canonicalize(verse.Location, report))));
        }

        return new QuranicFunctionalDiacriticEvaluation
        {
            VerseCount = corpus.Verses.Count,
            ValidVerseCount = valid,
            UnverifiedVerseCount = unverified,
            InvalidVerseCount = invalid,
            TargetEdgeCount = targetEdges,
            CheckedEdgeCount = checkedEdges,
            VerifiedEdgeCount = verifiedEdges,
            SkippedEdgeCount = skippedEdges,
            UnverifiedEdgeCount = unverifiedEdges,
            InvalidEdgeCount = invalidEdges,
            ParserStatusCounts = parserStatuses,
            FunctionalStatusCounts = functionalStatuses,
            DiagnosticCodeCounts = diagnosticCodes,
            RelationDiagnosticCounts = relationDiagnostics,
            Samples = invalidSamples
                .Concat(samples)
                .Take(MaximumSamples)
                .ToArray(),
            EvaluationMerkleRoot = QacMerkle.ComputeRoot(leaves),
        };
    }

    private static string Canonicalize(
        string location,
        QuranicFunctionalValidationReport report) =>
        string.Join(
            "\t",
            location,
            report.ParserStatus,
            report.Status,
            report.TargetEdgeCount,
            report.CheckedEdgeCount,
            report.VerifiedEdgeCount,
            report.SkippedEdgeCount,
            report.UnverifiedEdgeCount,
            report.InvalidEdgeCount,
            string.Join(
                ",",
                report.Diagnostics
                    .Select(value =>
                        $"{value.Code}:{value.RuleId}:{value.Relation}:"
                        + $"{value.Range.Start}:{value.Range.Length}:"
                        + string.Join("|", value.Differences))
                    .OrderBy(value => value, StringComparer.Ordinal)));

    private static void Increment(
        IDictionary<string, long> counts,
        string key)
    {
        counts.TryGetValue(key, out var count);
        counts[key] = count + 1;
    }
}
