using System.Security.Cryptography;
using System.Text;
using Adg.QuranicCore;
using Adg.QuranicCorpus;

namespace Adg.QuranicGrammar;

public sealed record QuranicDiacriticMutationResult(
    string Operation,
    string Feature,
    string Location,
    string Relation,
    int TargetStart,
    int TargetLength,
    string ObservedSurfaceSha256,
    string MutatedSurfaceSha256,
    string ExpectedDiagnosticCode,
    string FunctionalStatus,
    IReadOnlyList<string> DiagnosticCodes,
    bool Detected);

public sealed class QuranicDiacriticMutationEvaluation
{
    public long VerseCountScanned { get; init; }

    public long ExpectedMutationCount { get; init; }

    public long ExecutedMutationCount { get; init; }

    public long DetectedMutationCount { get; init; }

    public SortedDictionary<string, long> OperationCounts { get; init; } =
        new(StringComparer.Ordinal);

    public SortedDictionary<string, long> FeatureCounts { get; init; } =
        new(StringComparer.Ordinal);

    public IReadOnlyList<QuranicDiacriticMutationResult> Results
        { get; init; } = [];

    public required string EvaluationMerkleRoot { get; init; }

    public bool IsValid =>
        ExecutedMutationCount == ExpectedMutationCount
        && DetectedMutationCount == ExpectedMutationCount
        && Results.All(result => result.Detected);
}

public static class QuranicDiacriticMutationEvaluator
{
    private static readonly string[] Operations =
        ["add", "remove", "replace"];

    public static QuranicDiacriticMutationEvaluation Evaluate(
        QacMorphologyLexicon lexicon)
    {
        ArgumentNullException.ThrowIfNull(lexicon);
        var corpus = QacVerseCorpus.Build(lexicon.Words);
        var parser = new QacDeterministicGrammarParser(
            lexicon,
            enableHeuristicFallback: false);
        var validator = new QuranicFunctionalDiacriticValidator(
            QacDiacriticEvidenceIndex.Build(lexicon));
        var pending = Operations
            .SelectMany(operation =>
                QuranicDiacriticAnalyzer.SupportedMarks.Keys.Select(feature =>
                    (Operation: operation, Feature: feature)))
            .ToHashSet();
        var results = new List<QuranicDiacriticMutationResult>();
        var firstFailures = new Dictionary<
            (string Operation, string Feature),
            QuranicDiacriticMutationResult>();
        long scanned = 0;

        foreach (var verse in corpus.Verses)
        {
            scanned++;
            var parse = parser.Parse(verse.Text);
            var baseline = validator.Validate(parse);
            var blockedTargets = baseline.Diagnostics
                .Select(diagnostic => (
                    diagnostic.Relation,
                    diagnostic.Range.Start,
                    diagnostic.Range.Length))
                .ToHashSet();
            var nodes = parse.Graph.Nodes.ToDictionary(
                node => node.Id,
                StringComparer.Ordinal);
            var units = parse.Morphology.Units.ToDictionary(
                unit => RangeKey(unit.Range),
                StringComparer.Ordinal);
            foreach (var edge in parse.Graph.Edges.Where(edge =>
                         edge.IsVerified
                         && QuranicFunctionalDiacriticValidator
                             .SupportedRelations
                             .Contains(edge.Relation)))
            {
                if (!nodes.TryGetValue(edge.DependentId, out var dependent)
                    || dependent.TextRange is not { } range
                    || IsFunctionallySkipped(edge, dependent)
                    || blockedTargets.Contains(
                        (edge.Relation, range.Start, range.Length))
                    || !units.TryGetValue(RangeKey(range), out var unit))
                {
                    continue;
                }

                var profile = QuranicDiacriticAnalyzer.Analyze(unit.Surface);
                foreach (var mark in profile.Marks)
                {
                    TryEvaluate(
                        "remove",
                        mark.Name,
                        () => RemoveAt(
                            unit.Surface,
                            mark.Utf16Offset,
                            mark.Mark.Length),
                        "ADG-QUR2101");
                    TryEvaluate(
                        "replace",
                        mark.Name,
                        () => ReplaceAt(
                            unit.Surface,
                            mark.Utf16Offset,
                            mark.Mark.Length,
                            AlternateMark(mark.Name)),
                        "ADG-QUR2102");
                }

                foreach (var pair in QuranicDiacriticAnalyzer.SupportedMarks)
                {
                    var anchor = profile.Marks.FirstOrDefault(mark =>
                        mark.Mark != pair.Value);
                    if (anchor is null)
                    {
                        continue;
                    }

                    TryEvaluate(
                        "add",
                        pair.Key,
                        () => InsertAt(
                            unit.Surface,
                            anchor.Utf16Offset + anchor.Mark.Length,
                            pair.Value),
                        "ADG-QUR2102");
                }

                if (pending.Count == 0)
                {
                    break;
                }

                void TryEvaluate(
                    string operation,
                    string feature,
                    Func<string> mutateSurface,
                    string expectedDiagnostic)
                {
                    var key = (operation, feature);
                    if (!pending.Contains(key))
                    {
                        return;
                    }

                    var mutatedSurface = mutateSurface();
                    var mutatedText =
                        verse.Text[..range.Start]
                        + mutatedSurface
                        + verse.Text[range.End..];
                    var mutatedParse = parser.Parse(mutatedText);
                    var validation = validator.Validate(mutatedParse);
                    var mutatedRange = new SourceRange(
                        range.Start,
                        mutatedSurface.Length);
                    var diagnosticCodes = TargetDiagnosticCodes(
                        validation.Diagnostics,
                        edge.Relation,
                        mutatedRange);
                    var result = new QuranicDiacriticMutationResult(
                        operation,
                        feature,
                        verse.Location,
                        edge.Relation,
                        range.Start,
                        range.Length,
                        Sha256(unit.Surface),
                        Sha256(mutatedSurface),
                        expectedDiagnostic,
                        validation.Status.ToString(),
                        diagnosticCodes,
                        diagnosticCodes.Contains(
                            expectedDiagnostic,
                            StringComparer.Ordinal));
                    if (result.Detected)
                    {
                        pending.Remove(key);
                        firstFailures.Remove(key);
                        results.Add(result);
                    }
                    else
                    {
                        firstFailures.TryAdd(key, result);
                    }
                }
            }

            if (pending.Count == 0)
            {
                break;
            }
        }

        results.AddRange(
            pending
                .OrderBy(key => key.Operation, StringComparer.Ordinal)
                .ThenBy(key => key.Feature, StringComparer.Ordinal)
                .Where(firstFailures.ContainsKey)
                .Select(key => firstFailures[key]));
        var ordered = results
            .OrderBy(result => result.Operation, StringComparer.Ordinal)
            .ThenBy(result => result.Feature, StringComparer.Ordinal)
            .ToArray();
        var leaves = ordered
            .Select(result =>
                SHA256.HashData(
                    Encoding.UTF8.GetBytes(Canonicalize(result))))
            .ToArray();
        return new QuranicDiacriticMutationEvaluation
        {
            VerseCountScanned = scanned,
            ExpectedMutationCount =
                Operations.LongLength
                * QuranicDiacriticAnalyzer.SupportedMarks.Count,
            ExecutedMutationCount = ordered.LongLength,
            DetectedMutationCount =
                ordered.LongCount(result => result.Detected),
            OperationCounts = Count(
                ordered.Select(result => result.Operation)),
            FeatureCounts = Count(
                ordered
                    .Where(result => result.Detected)
                    .Select(result => result.Feature)),
            Results = ordered,
            EvaluationMerkleRoot = QacMerkle.ComputeRoot(leaves),
        };
    }

    internal static bool IsFunctionallySkipped(
        QacDependencyEdge edge,
        QacSyntaxNode dependent) =>
        QuranicGrammarContractCatalog
            .GetCanonicalContract(edge.Relation)
            .Dependent?
            .AllowUnmarkedCaseTags
            .Contains(dependent.Tag, StringComparer.Ordinal) == true;

    internal static IReadOnlyList<string> TargetDiagnosticCodes(
        IReadOnlyList<QuranicFunctionalDiagnostic> diagnostics,
        string relation,
        SourceRange range) =>
        diagnostics
            .Where(diagnostic =>
                diagnostic.Relation == relation
                && diagnostic.Range.Start == range.Start
                && diagnostic.Range.Length == range.Length)
            .Select(diagnostic => diagnostic.Code)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(code => code, StringComparer.Ordinal)
            .ToArray();

    private static string AlternateMark(string feature) =>
        feature switch
        {
            "Fatha" => QuranicDiacriticAnalyzer.SupportedMarks["Damma"],
            "Damma" => QuranicDiacriticAnalyzer.SupportedMarks["Fatha"],
            "Kasra" => QuranicDiacriticAnalyzer.SupportedMarks["Fatha"],
            "Fathatan" => QuranicDiacriticAnalyzer.SupportedMarks["Dammatan"],
            "Dammatan" => QuranicDiacriticAnalyzer.SupportedMarks["Fathatan"],
            "Kasratan" => QuranicDiacriticAnalyzer.SupportedMarks["Fathatan"],
            "Shadda" => QuranicDiacriticAnalyzer.SupportedMarks["Sukun"],
            "Sukun" => QuranicDiacriticAnalyzer.SupportedMarks["Shadda"],
            _ => throw new InvalidDataException(
                $"Unsupported diacritic feature '{feature}'."),
        };

    private static string RemoveAt(
        string value,
        int offset,
        int length) =>
        value[..offset] + value[(offset + length)..];

    private static string ReplaceAt(
        string value,
        int offset,
        int length,
        string replacement) =>
        value[..offset] + replacement + value[(offset + length)..];

    private static string InsertAt(
        string value,
        int offset,
        string insertion) =>
        value[..offset] + insertion + value[offset..];

    private static string RangeKey(SourceRange range) =>
        FormattableString.Invariant($"{range.Start}:{range.Length}");

    private static string Sha256(string value) =>
        Convert.ToHexString(
                SHA256.HashData(Encoding.UTF8.GetBytes(value)))
            .ToLowerInvariant();

    private static string Canonicalize(
        QuranicDiacriticMutationResult result) =>
        string.Join(
            "\t",
            result.Operation,
            result.Feature,
            result.Location,
            result.Relation,
            result.TargetStart,
            result.TargetLength,
            result.ObservedSurfaceSha256,
            result.MutatedSurfaceSha256,
            result.ExpectedDiagnosticCode,
            result.FunctionalStatus,
            string.Join(",", result.DiagnosticCodes),
            result.Detected);

    private static SortedDictionary<string, long> Count(
        IEnumerable<string> values)
    {
        var counts = new SortedDictionary<string, long>(
            StringComparer.Ordinal);
        foreach (var value in values)
        {
            counts.TryGetValue(value, out var count);
            counts[value] = count + 1;
        }

        return counts;
    }
}
