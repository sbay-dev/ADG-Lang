using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Adg.QuranicCore;

internal static class QuranicCorpusVerifier
{
    public static QuranicCorpusReport Verify(
        string corpusPath,
        QuranicCausalityAnalyzer analyzer,
        JsonSerializerOptions options)
    {
        var corpus = JsonSerializer.Deserialize<QuranicCorpus>(
            File.ReadAllText(corpusPath),
            options)
            ?? throw new JsonException("Quranic corpus is empty.");

        var results = corpus.Cases.Select(testCase =>
        {
            var analysis = analyzer.Analyze(testCase.Snippet);
            var sourceMarkers = analysis.CausalMarkers
                .Where(candidate => candidate.SourceToken == testCase.MarkerToken)
                .ToArray();
            var marker = sourceMarkers.FirstOrDefault(
                candidate => candidate.Kind == testCase.ExpectedKind);
            var targetTokenExists = analysis.Tokens.Any(
                token => token.Surface == testCase.MarkerToken);
            var tokenSpanIntegrity = analysis.Tokens.All(
                token =>
                    RangeMatches(
                        analysis.OriginalText,
                        token.Range,
                        token.Surface));
            var segmentSpanIntegrity = analysis.Tokens
                .SelectMany(token => token.Segments)
                .All(segment =>
                    RangeMatches(
                        analysis.OriginalText,
                        segment.Range,
                        segment.Surface));
            var markerSpanIntegrity = analysis.CausalMarkers.All(
                candidate =>
                    RangeMatches(
                        analysis.OriginalText,
                        candidate.MarkerRange,
                        candidate.MarkerSurface));
            var causeEffectSpanIntegrity = analysis.CausalMarkers.All(
                candidate =>
                    RangeIsValid(
                        analysis.OriginalText,
                        candidate.CauseRange)
                    && RangeIsValid(
                        analysis.OriginalText,
                        candidate.EffectRange));
            var spanIntegrity = tokenSpanIntegrity
                && segmentSpanIntegrity
                && markerSpanIntegrity
                && causeEffectSpanIntegrity;
            var kindMatched = testCase.ExpectedMarker
                ? marker is not null
                : sourceMarkers.Length == 0;
            var directionMatched = !testCase.ExpectedMarker
                || marker?.Direction == testCase.ExpectedDirection;
            var moodMatched = !testCase.ExpectedMarker
                || marker?.Mood == testCase.ExpectedMood;
            var causeTextMatched = testCase.ExpectedCauseText is null
                || TextForRange(
                    analysis.OriginalText,
                    marker?.CauseRange) == testCase.ExpectedCauseText;
            var effectTextMatched = testCase.ExpectedEffectText is null
                || TextForRange(
                    analysis.OriginalText,
                    marker?.EffectRange) == testCase.ExpectedEffectText;
            var expectedDiagnostics = testCase.ExpectedDiagnostics
                ?? [];
            var actualDiagnostics = analysis.Diagnostics
                .Select(diagnostic => diagnostic.Code)
                .ToHashSet(StringComparer.Ordinal);
            var diagnosticsMatched = actualDiagnostics.SetEquals(
                expectedDiagnostics);
            var passed = kindMatched
                && directionMatched
                && moodMatched
                && targetTokenExists
                && spanIntegrity
                && causeTextMatched
                && effectTextMatched
                && diagnosticsMatched;

            return new QuranicCorpusCaseResult(
                testCase.Id,
                testCase.VerseKey,
                passed,
                kindMatched,
                directionMatched,
                moodMatched,
                targetTokenExists,
                spanIntegrity,
                segmentSpanIntegrity,
                markerSpanIntegrity,
                causeEffectSpanIntegrity,
                causeTextMatched,
                effectTextMatched,
                diagnosticsMatched,
                analysis.Diagnostics,
                marker,
                analysis.CausalMarkers);
        }).ToArray();

        var leaves = results.Select(result =>
            Sha256(
                "ADG-QURANIC-CORE-V1-LEAF\0"
                + JsonSerializer.Serialize(result, options)))
            .ToArray();
        var root = MerkleRoot(leaves);

        return new QuranicCorpusReport(
            corpus.Version,
            results.All(result => result.Passed),
            results.Count(result => result.Passed),
            results.Length,
            leaves,
            root,
            results);
    }

    private static string MerkleRoot(IReadOnlyList<string> input)
    {
        if (input.Count == 0)
        {
            return Sha256("ADG-QURANIC-CORE-V1-EMPTY");
        }

        var level = input.ToList();
        while (level.Count > 1)
        {
            if (level.Count % 2 != 0)
            {
                level.Add(level[^1]);
            }

            var next = new List<string>(level.Count / 2);
            for (var index = 0; index < level.Count; index += 2)
            {
                next.Add(Sha256(
                    "ADG-QURANIC-CORE-V1-NODE\0"
                    + level[index]
                    + level[index + 1]));
            }

            level = next;
        }

        return level[0];
    }

    private static string Sha256(string value) =>
        Convert.ToHexString(
            SHA256.HashData(Encoding.UTF8.GetBytes(value)))
            .ToLowerInvariant();

    private static bool RangeMatches(
        string text,
        SourceRange range,
        string expected) =>
        RangeIsValid(text, range)
        && text.Substring(range.Start, range.Length) == expected;

    private static bool RangeIsValid(
        string text,
        SourceRange? range) =>
        range is null
        || range.Start >= 0
        && range.Length > 0
        && range.End <= text.Length;

    private static string? TextForRange(
        string text,
        SourceRange? range) =>
        range is null
            ? null
            : text.Substring(range.Start, range.Length);
}

internal sealed record QuranicCorpus(
    string Version,
    IReadOnlyList<QuranicCorpusCase> Cases);

internal sealed record QuranicCorpusCase(
    string Id,
    string VerseKey,
    string Snippet,
    string MarkerToken,
    QuranicCausalMarkerKind ExpectedKind,
    QuranicCausalDirection ExpectedDirection,
    QuranicVerbMood ExpectedMood,
    IReadOnlyList<string> Sources,
    bool ExpectedMarker = true,
    IReadOnlyList<string>? ExpectedDiagnostics = null,
    string? ExpectedCauseText = null,
    string? ExpectedEffectText = null);

internal sealed record QuranicCorpusCaseResult(
    string Id,
    string VerseKey,
    bool Passed,
    bool KindMatched,
    bool DirectionMatched,
    bool MoodMatched,
    bool TargetTokenExists,
    bool SpanIntegrity,
    bool SegmentSpanIntegrity,
    bool MarkerSpanIntegrity,
    bool CauseEffectSpanIntegrity,
    bool CauseTextMatched,
    bool EffectTextMatched,
    bool DiagnosticsMatched,
    IReadOnlyList<QuranicDiagnostic> Diagnostics,
    QuranicCausalMarker? MatchedMarker,
    IReadOnlyList<QuranicCausalMarker> ObservedMarkers);

internal sealed record QuranicCorpusReport(
    string Version,
    bool Passed,
    int PassedCases,
    int TotalCases,
    IReadOnlyList<string> LeafHashes,
    string MerkleRoot,
    IReadOnlyList<QuranicCorpusCaseResult> Cases);
