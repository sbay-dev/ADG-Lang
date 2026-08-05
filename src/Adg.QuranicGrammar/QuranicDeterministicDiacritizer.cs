using System.Security.Cryptography;
using System.Text;
using Adg.QuranicCore;
using Adg.QuranicCorpus;

namespace Adg.QuranicGrammar;

public enum QuranicDiacritizationStatus
{
    Valid,
    Invalid,
    Unverified,
}

public sealed record QuranicDiacritizationDiagnostic(
    string Code,
    string Message,
    SourceRange Range,
    IReadOnlyList<string> RuleIds,
    IReadOnlyList<string> Relations);

public sealed record QuranicDiacritizationEdit(
    int UnitIndex,
    SourceRange Range,
    string OriginalSurface,
    string DiacritizedSurface,
    IReadOnlyList<string> RuleIds,
    IReadOnlyList<string> Relations);

public sealed class QuranicParseFingerprint
{
    public required string MorphologyMerkleRoot { get; init; }

    public required string GraphMerkleRoot { get; init; }

    public required string RuleMerkleRoot { get; init; }

    public required string CombinedMerkleRoot { get; init; }

    public IReadOnlyList<string> RuleIds { get; init; } = [];
}

public sealed class QuranicScopedDiacriticInput
{
    public required string CanonicalText { get; init; }

    public required string StrippedText { get; init; }

    public IReadOnlyList<int> UnitIndexes { get; init; } = [];

    public long UnitCount => UnitIndexes.Count;
}

public sealed class QuranicDiacritizationReport
{
    public required QuranicDiacritizationStatus Status { get; init; }

    public required string InputText { get; init; }

    public required string OutputText { get; init; }

    public required QacGrammarStatus InputParserStatus { get; init; }

    public required QacGrammarStatus OutputParserStatus { get; init; }

    public required QuranicFunctionalValidationStatus InputFunctionalStatus
        { get; init; }

    public required QuranicFunctionalValidationStatus OutputFunctionalStatus
        { get; init; }

    public long CandidateEditCount { get; init; }

    public long AppliedEditCount { get; init; }

    public bool GraphEquivalent { get; init; }

    public required QuranicParseFingerprint InputFingerprint { get; init; }

    public required QuranicParseFingerprint OutputFingerprint { get; init; }

    public IReadOnlyList<QuranicDiacritizationEdit> Edits { get; init; } = [];

    public IReadOnlyList<QuranicDiacritizationDiagnostic> Diagnostics
        { get; init; } = [];

    public bool IsValid =>
        Status == QuranicDiacritizationStatus.Valid
        && CandidateEditCount > 0
        && AppliedEditCount == CandidateEditCount
        && GraphEquivalent
        && InputParserStatus == QacGrammarStatus.Valid
        && OutputParserStatus == QacGrammarStatus.Valid
        && InputFunctionalStatus
            == QuranicFunctionalValidationStatus.Unverified
        && OutputFunctionalStatus
            == QuranicFunctionalValidationStatus.Valid;
}

public sealed class QuranicDeterministicDiacritizer
{
    private readonly QacDeterministicGrammarParser parser;
    private readonly QacDiacriticEvidenceIndex evidence;
    private readonly QuranicFunctionalDiacriticValidator validator;

    public QuranicDeterministicDiacritizer(QacMorphologyLexicon lexicon)
    {
        ArgumentNullException.ThrowIfNull(lexicon);
        parser = new QacDeterministicGrammarParser(
            lexicon,
            enableHeuristicFallback: false);
        evidence = QacDiacriticEvidenceIndex.Build(lexicon);
        validator = new QuranicFunctionalDiacriticValidator(evidence);
    }

    public QuranicScopedDiacriticInput StripReconstructableMarks(
        string canonicalText)
    {
        ArgumentNullException.ThrowIfNull(canonicalText);
        var parse = parser.Parse(canonicalText);
        var replacements = FindReconstructableReplacements(parse);
        var strippedText = ApplyReplacements(
            canonicalText,
            replacements.Values.Select(value =>
                (value.Range, value.StrippedSurface)));
        return new QuranicScopedDiacriticInput
        {
            CanonicalText = canonicalText,
            StrippedText = strippedText,
            UnitIndexes = replacements.Keys
                .Order()
                .ToArray(),
        };
    }

    public IReadOnlyList<QuranicScopedDiacriticInput>
        CreateSingleUnitInputs(string canonicalText)
    {
        ArgumentNullException.ThrowIfNull(canonicalText);
        var parse = parser.Parse(canonicalText);
        return FindReconstructableReplacements(parse)
            .OrderBy(pair => pair.Key)
            .Select(pair =>
                new QuranicScopedDiacriticInput
                {
                    CanonicalText = canonicalText,
                    StrippedText = ApplyReplacements(
                        canonicalText,
                        [
                            (
                                pair.Value.Range,
                                pair.Value.StrippedSurface),
                        ]),
                    UnitIndexes = [pair.Key],
                })
            .ToArray();
    }

    private Dictionary<
        int,
        (SourceRange Range, string StrippedSurface)>
        FindReconstructableReplacements(
            QacDeterministicGrammarParse parse)
    {
        if (parse.Status != QacGrammarStatus.Valid
            || !validator.Validate(parse).IsValid)
        {
            return [];
        }

        var nodes = parse.Graph.Nodes.ToDictionary(
            node => node.Id,
            StringComparer.Ordinal);
        var unitsByRange = parse.Morphology.Units.ToDictionary(
            unit => RangeKey(unit.Range),
            StringComparer.Ordinal);
        var selections = parse.SelectedAlternative.Selection.ToDictionary(
            selection => selection.UnitIndex);
        var replacements = new Dictionary<
            int,
            (SourceRange Range, string StrippedSurface)>();

        foreach (var edge in parse.Graph.Edges.Where(edge =>
                     edge.IsVerified
                     && QuranicFunctionalDiacriticValidator
                         .SupportedRelations
                         .Contains(edge.Relation)))
        {
            if (!nodes.TryGetValue(edge.DependentId, out var dependent)
                || dependent.TextRange is not { } range
                || !unitsByRange.TryGetValue(RangeKey(range), out var unit)
                || !selections.TryGetValue(unit.Index, out var selection)
                || selection.Source
                    != QacMorphologyCandidateSource.QuranicCorpus)
            {
                continue;
            }

            var stripped =
                QuranicDiacriticAnalyzer.StripSignificantMarks(unit.Surface);
            if (stripped == unit.Surface)
            {
                continue;
            }

            var compatible = CompatibleCanonicalSurfaces(unit);
            if (compatible.Length != 1
                || compatible[0] != unit.Surface)
            {
                continue;
            }

            replacements[unit.Index] = (unit.Range, stripped);
        }

        return replacements;
    }

    public QuranicDiacritizationReport Diacritize(string text)
    {
        ArgumentNullException.ThrowIfNull(text);
        var inputParse = parser.Parse(text);
        var inputValidation = validator.Validate(inputParse);
        var inputFingerprint = QuranicParseFingerprintBuilder.Create(inputParse);

        var contradictory = inputValidation.Diagnostics
            .Where(diagnostic => diagnostic.Code == "ADG-QUR2102")
            .ToArray();
        if (inputParse.Status != QacGrammarStatus.Valid
            || contradictory.Length > 0)
        {
            var diagnostics = contradictory
                .Select(diagnostic =>
                    OperationDiagnostic(
                        "ADG-QUR2206",
                        "Contradictory Quranic marks must be rejected before diacritization.",
                        [diagnostic]))
                .Concat(
                    inputParse.Status == QacGrammarStatus.Valid
                        ? []
                        :
                        [
                            new QuranicDiacritizationDiagnostic(
                                "ADG-QUR2208",
                                "Diacritization requires a fully valid deterministic parser state.",
                                new SourceRange(0, text.Length),
                                [],
                                []),
                        ])
                .ToArray();
            return Report(
                inputParse.Status == QacGrammarStatus.Invalid
                    || contradictory.Length > 0
                    ? QuranicDiacritizationStatus.Invalid
                    : QuranicDiacritizationStatus.Unverified,
                text,
                text,
                inputParse,
                inputParse,
                inputValidation,
                inputValidation,
                inputFingerprint,
                inputFingerprint,
                0,
                [],
                diagnostics);
        }

        var unsupportedFunctionalDiagnostics =
            inputValidation.Diagnostics
                .Where(diagnostic => diagnostic.Code != "ADG-QUR2101")
                .ToArray();
        if (unsupportedFunctionalDiagnostics.Length > 0)
        {
            return Report(
                QuranicDiacritizationStatus.Unverified,
                text,
                text,
                inputParse,
                inputParse,
                inputValidation,
                inputValidation,
                inputFingerprint,
                inputFingerprint,
                0,
                [],
                unsupportedFunctionalDiagnostics
                    .Select(diagnostic =>
                        OperationDiagnostic(
                            "ADG-QUR2208",
                            "The parser state contains unsupported or unverified diacritic evidence.",
                            [diagnostic]))
                    .ToArray());
        }

        var missingGroups = inputValidation.Diagnostics
            .Where(diagnostic => diagnostic.Code == "ADG-QUR2101")
            .GroupBy(diagnostic => RangeKey(diagnostic.Range))
            .OrderBy(group => group.First().Range.Start)
            .ToArray();
        var unitsByRange = inputParse.Morphology.Units.ToDictionary(
            unit => RangeKey(unit.Range),
            StringComparer.Ordinal);
        var grammaticalMissingRanges = missingGroups
            .Select(group => group.Key)
            .ToHashSet(StringComparer.Ordinal);
        var unstableMissingUnits = inputParse.Morphology.Units
            .Where(unit => !grammaticalMissingRanges.Contains(
                RangeKey(unit.Range)))
            .Select(unit =>
            {
                var compatible = CompatibleCanonicalSurfaces(unit);
                return (
                    Unit: unit,
                    HasMissingCandidate: compatible.Any(surface =>
                        surface != unit.Surface
                        && QuranicDiacriticAnalyzer.Compare(
                                QuranicDiacriticAnalyzer.Analyze(
                                    unit.Surface),
                                QuranicDiacriticAnalyzer.Analyze(surface))
                            .IsMissingOnly));
            })
            .Where(value => value.HasMissingCandidate)
            .ToArray();
        if (unstableMissingUnits.Length > 0)
        {
            return Report(
                QuranicDiacritizationStatus.Unverified,
                text,
                text,
                inputParse,
                inputParse,
                inputValidation,
                inputValidation,
                inputFingerprint,
                inputFingerprint,
                missingGroups.LongLength + unstableMissingUnits.LongLength,
                [],
                unstableMissingUnits
                    .Select(value =>
                        new QuranicDiacritizationDiagnostic(
                            "ADG-QUR2207",
                            "Canonical missing marks lack a stable supported grammatical edge.",
                            value.Unit.Range,
                            [],
                            []))
                    .ToArray());
        }

        if (missingGroups.Length == 0)
        {
            return Report(
                QuranicDiacritizationStatus.Unverified,
                text,
                text,
                inputParse,
                inputParse,
                inputValidation,
                inputValidation,
                inputFingerprint,
                inputFingerprint,
                0,
                [],
                [
                    new QuranicDiacritizationDiagnostic(
                        "ADG-QUR2201",
                        "No reconstructable missing marks were found in the supported Quranic scope.",
                        new SourceRange(0, text.Length),
                        [],
                        []),
                ]);
        }

        var edits = new List<QuranicDiacritizationEdit>();
        var operationDiagnostics =
            new List<QuranicDiacritizationDiagnostic>();
        foreach (var group in missingGroups)
        {
            var sourceDiagnostics = group.ToArray();
            var first = sourceDiagnostics[0];
            var suggestions = sourceDiagnostics
                .Select(diagnostic => diagnostic.SuggestedSurface)
                .Where(surface => surface is not null)
                .Cast<string>()
                .Distinct(StringComparer.Ordinal)
                .ToArray();
            if (!unitsByRange.TryGetValue(group.Key, out var unit)
                || suggestions.Length != 1)
            {
                operationDiagnostics.Add(
                    OperationDiagnostic(
                        "ADG-QUR2202",
                        "Canonical diacritics are ambiguous for this surface and morphology.",
                        sourceDiagnostics));
                continue;
            }

            var suggestion = suggestions[0];
            var compatible = CompatibleCanonicalSurfaces(unit);
            if (compatible.Length != 1
                || compatible[0] != suggestion
                || QuranicDiacriticAnalyzer.StripSignificantMarks(
                    unit.Surface)
                != QuranicDiacriticAnalyzer.StripSignificantMarks(
                    suggestion)
                || !QuranicDiacriticAnalyzer
                    .IsAdditiveSignificantCompletion(
                        unit.Surface,
                        suggestion)
                || !QuranicDiacriticAnalyzer.Compare(
                        QuranicDiacriticAnalyzer.Analyze(unit.Surface),
                        QuranicDiacriticAnalyzer.Analyze(suggestion))
                    .IsMissingOnly)
            {
                operationDiagnostics.Add(
                    OperationDiagnostic(
                        "ADG-QUR2203",
                        "The proposed reconstruction is not a diacritic-only completion.",
                        sourceDiagnostics));
                continue;
            }

            edits.Add(
                new QuranicDiacritizationEdit(
                    unit.Index,
                    unit.Range,
                    unit.Surface,
                    suggestion,
                    sourceDiagnostics
                        .Select(diagnostic => diagnostic.RuleId)
                        .Distinct(StringComparer.Ordinal)
                        .OrderBy(value => value, StringComparer.Ordinal)
                        .ToArray(),
                    sourceDiagnostics
                        .Select(diagnostic => diagnostic.Relation)
                        .Distinct(StringComparer.Ordinal)
                        .OrderBy(value => value, StringComparer.Ordinal)
                        .ToArray()));
        }

        if (operationDiagnostics.Count > 0
            || edits.Count != missingGroups.Length)
        {
            return Report(
                QuranicDiacritizationStatus.Unverified,
                text,
                text,
                inputParse,
                inputParse,
                inputValidation,
                inputValidation,
                inputFingerprint,
                inputFingerprint,
                missingGroups.LongLength,
                [],
                operationDiagnostics);
        }

        var outputText = ApplyReplacements(
            text,
            edits.Select(edit => (edit.Range, edit.DiacritizedSurface)));
        var outputParse = parser.Parse(outputText);
        var outputValidation = validator.Validate(outputParse);
        var outputFingerprint =
            QuranicParseFingerprintBuilder.Create(outputParse);
        var graphEquivalent =
            inputFingerprint.CombinedMerkleRoot
            == outputFingerprint.CombinedMerkleRoot;

        if (!graphEquivalent)
        {
            operationDiagnostics.Add(
                new QuranicDiacritizationDiagnostic(
                    "ADG-QUR2204",
                    "Diacritization changed the selected morphology or dependency graph.",
                    new SourceRange(0, outputText.Length),
                    edits.SelectMany(edit => edit.RuleIds)
                        .Distinct(StringComparer.Ordinal)
                        .OrderBy(value => value, StringComparer.Ordinal)
                        .ToArray(),
                    edits.SelectMany(edit => edit.Relations)
                        .Distinct(StringComparer.Ordinal)
                        .OrderBy(value => value, StringComparer.Ordinal)
                        .ToArray()));
        }

        var unresolved = outputValidation.Diagnostics
            .Where(diagnostic =>
                diagnostic.Code is "ADG-QUR2101" or "ADG-QUR2102")
            .ToArray();
        if (outputParse.Status != QacGrammarStatus.Valid
            || !outputValidation.IsValid
            || outputValidation.Diagnostics.Count > 0
            || unresolved.Length > 0)
        {
            operationDiagnostics.Add(
                new QuranicDiacritizationDiagnostic(
                    "ADG-QUR2205",
                    "The reconstructed surface failed deterministic re-verification.",
                    new SourceRange(0, outputText.Length),
                    unresolved.Select(diagnostic => diagnostic.RuleId)
                        .Distinct(StringComparer.Ordinal)
                        .OrderBy(value => value, StringComparer.Ordinal)
                        .ToArray(),
                    unresolved.Select(diagnostic => diagnostic.Relation)
                        .Distinct(StringComparer.Ordinal)
                        .OrderBy(value => value, StringComparer.Ordinal)
                        .ToArray()));
        }

        var status = operationDiagnostics.Count == 0
            ? QuranicDiacritizationStatus.Valid
            : QuranicDiacritizationStatus.Invalid;
        return Report(
            status,
            text,
            outputText,
            inputParse,
            outputParse,
            inputValidation,
            outputValidation,
            inputFingerprint,
            outputFingerprint,
            missingGroups.LongLength,
            edits,
            operationDiagnostics);
    }

    private string[] CompatibleCanonicalSurfaces(
        QacParsedMorphologyUnit unit)
    {
        var stripped =
            QuranicDiacriticAnalyzer.StripSignificantMarks(unit.Surface);
        return unit.Candidates
            .Where(candidate =>
                candidate.Source
                    == QacMorphologyCandidateSource.QuranicCorpus)
            .SelectMany(candidate =>
                evidence.GetCanonicalSurfaces(
                    unit.NormalizedSurface,
                    candidate.MorphologySignature))
            .Where(surface =>
                QuranicDiacriticAnalyzer.StripSignificantMarks(surface)
                    == stripped)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(surface => surface, StringComparer.Ordinal)
            .ToArray();
    }

    private static QuranicDiacritizationReport Report(
        QuranicDiacritizationStatus status,
        string inputText,
        string outputText,
        QacDeterministicGrammarParse inputParse,
        QacDeterministicGrammarParse outputParse,
        QuranicFunctionalValidationReport inputValidation,
        QuranicFunctionalValidationReport outputValidation,
        QuranicParseFingerprint inputFingerprint,
        QuranicParseFingerprint outputFingerprint,
        long candidateEditCount,
        IReadOnlyList<QuranicDiacritizationEdit> edits,
        IReadOnlyList<QuranicDiacritizationDiagnostic> diagnostics) =>
        new()
        {
            Status = status,
            InputText = inputText,
            OutputText = outputText,
            InputParserStatus = inputParse.Status,
            OutputParserStatus = outputParse.Status,
            InputFunctionalStatus = inputValidation.Status,
            OutputFunctionalStatus = outputValidation.Status,
            CandidateEditCount = candidateEditCount,
            AppliedEditCount = edits.Count,
            GraphEquivalent =
                inputFingerprint.CombinedMerkleRoot
                == outputFingerprint.CombinedMerkleRoot,
            InputFingerprint = inputFingerprint,
            OutputFingerprint = outputFingerprint,
            Edits = edits,
            Diagnostics = diagnostics,
        };

    private static QuranicDiacritizationDiagnostic OperationDiagnostic(
        string code,
        string message,
        IReadOnlyList<QuranicFunctionalDiagnostic> diagnostics)
    {
        var first = diagnostics[0];
        return new QuranicDiacritizationDiagnostic(
            code,
            message,
            first.Range,
            diagnostics.Select(diagnostic => diagnostic.RuleId)
                .Distinct(StringComparer.Ordinal)
                .OrderBy(value => value, StringComparer.Ordinal)
                .ToArray(),
            diagnostics.Select(diagnostic => diagnostic.Relation)
                .Distinct(StringComparer.Ordinal)
                .OrderBy(value => value, StringComparer.Ordinal)
                .ToArray());
    }

    private static string ApplyReplacements(
        string text,
        IEnumerable<(SourceRange Range, string Text)> replacements)
    {
        var output = text;
        foreach (var replacement in replacements
                     .OrderByDescending(value => value.Range.Start))
        {
            output =
                output[..replacement.Range.Start]
                + replacement.Text
                + output[replacement.Range.End..];
        }

        return output;
    }

    private static string RangeKey(SourceRange range) =>
        FormattableString.Invariant($"{range.Start}:{range.Length}");
}

public static class QuranicParseFingerprintBuilder
{
    public static QuranicParseFingerprint Create(
        QacDeterministicGrammarParse parse)
    {
        ArgumentNullException.ThrowIfNull(parse);
        var morphologyRoot = Root(
            parse.SelectedAlternative.Selection
                .OrderBy(selection => selection.UnitIndex)
                .Select(selection =>
                    string.Join(
                        "\t",
                        selection.UnitIndex,
                        selection.MorphologySignature,
                        selection.Source,
                        selection.PrimaryTag)));
        var graphRoot = Root(
            parse.Graph.Nodes
                .OrderBy(node => node.Id, StringComparer.Ordinal)
                .Select(node => $"N\t{Canonicalize(node)}")
                .Concat(
                    parse.Graph.Edges
                        .OrderBy(edge => edge.DependentId, StringComparer.Ordinal)
                        .ThenBy(edge => edge.HeadId, StringComparer.Ordinal)
                        .ThenBy(edge => edge.Relation, StringComparer.Ordinal)
                        .Select(edge =>
                            string.Join(
                                "\t",
                                "E",
                                edge.DependentId,
                                edge.HeadId,
                                edge.Relation,
                                edge.IsVerified))));
        var ruleIds = parse.Graph.Edges
            .Where(edge =>
                QuranicFunctionalDiacriticValidator
                    .SupportedRelations
                    .Contains(edge.Relation))
            .Select(edge =>
                QuranicGrammarContractCatalog
                    .GetCanonicalContract(edge.Relation)
                    .RuleId)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(value => value, StringComparer.Ordinal)
            .ToArray();
        var ruleRoot = Root(ruleIds);
        var combinedRoot = Root(
            [morphologyRoot, graphRoot, ruleRoot]);
        return new QuranicParseFingerprint
        {
            MorphologyMerkleRoot = morphologyRoot,
            GraphMerkleRoot = graphRoot,
            RuleMerkleRoot = ruleRoot,
            CombinedMerkleRoot = combinedRoot,
            RuleIds = ruleIds,
        };
    }

    private static string Canonicalize(QacSyntaxNode node)
    {
        var morphology = node.Morphology;
        return string.Join(
            "\t",
            node.Id,
            node.Kind,
            node.Tag,
            node.Text ?? string.Empty,
            node.SpanStartTerminal,
            node.SpanEndTerminal,
            morphology?.Form ?? string.Empty,
            morphology?.Tag ?? string.Empty,
            morphology?.SegmentKind ?? string.Empty,
            morphology?.Lemma ?? string.Empty,
            morphology?.Root ?? string.Empty,
            morphology?.SpecialClass ?? string.Empty,
            morphology?.PersonGenderNumber ?? string.Empty,
            morphology?.AttachedPronoun ?? string.Empty,
            morphology?.Aspect ?? string.Empty,
            morphology?.Mood ?? string.Empty,
            morphology?.Voice ?? string.Empty,
            morphology?.VerbForm ?? string.Empty,
            morphology?.Derivation ?? string.Empty,
            morphology?.GrammaticalCase ?? string.Empty,
            morphology?.State ?? string.Empty,
            morphology is null
                ? string.Empty
                : string.Join(",", morphology.RawFeatures));
    }

    private static string Root(IEnumerable<string> records)
    {
        var leaves = records
            .Select(record =>
                SHA256.HashData(Encoding.UTF8.GetBytes(record)))
            .ToArray();
        return QacMerkle.ComputeRoot(leaves);
    }
}

public sealed record QuranicDiacritizationRoundTripSample(
    string Location,
    long UnitCount,
    string CanonicalTextSha256,
    string StrippedTextSha256,
    string OutputTextSha256,
    string Status,
    bool ExactSurfaceRestored,
    bool GraphEquivalent,
    IReadOnlyList<string> DiagnosticCodes);

public sealed class QuranicDiacritizationRoundTripEvaluation
{
    public long VerseCount { get; init; }

    public long EligibleVerseCount { get; init; }

    public long SkippedVerseCount { get; init; }

    public long AcceptedVerseCount { get; init; }

    public long RejectedVerseCount { get; init; }

    public long CandidateUnitCount { get; init; }

    public long AcceptedUnitCount { get; init; }

    public long RejectedUnitCount { get; init; }

    public long ExactSurfaceRestoredUnitCount { get; init; }

    public long GraphEquivalentUnitCount { get; init; }

    public long UnsafeAcceptanceCount { get; init; }

    public SortedDictionary<string, long> RejectionCodeCounts { get; init; } =
        new(StringComparer.Ordinal);

    public IReadOnlyList<QuranicDiacritizationRoundTripSample>
        UnsafeAcceptanceSamples
        { get; init; } = [];

    public required string CorpusMerkleRoot { get; init; }

    public required string EvaluationMerkleRoot { get; init; }

    public bool IsValid =>
        VerseCount == 6236
        && EligibleVerseCount > 0
        && SkippedVerseCount + EligibleVerseCount == VerseCount
        && AcceptedVerseCount + RejectedVerseCount
            == EligibleVerseCount
        && CandidateUnitCount
            == AcceptedUnitCount + RejectedUnitCount
        && AcceptedUnitCount > 0
        && ExactSurfaceRestoredUnitCount == AcceptedUnitCount
        && GraphEquivalentUnitCount == AcceptedUnitCount
        && UnsafeAcceptanceCount == 0;
}

public static class QuranicDiacritizationRoundTripEvaluator
{
    private const int MaximumUnsafeSamples = 50;

    public static QuranicDiacritizationRoundTripEvaluation Evaluate(
        QacMorphologyLexicon lexicon)
    {
        ArgumentNullException.ThrowIfNull(lexicon);
        var corpus = QacVerseCorpus.Build(lexicon.Words);
        var diacritizer = new QuranicDeterministicDiacritizer(lexicon);
        var corpusMerkleRoot = QacMerkle.ComputeRoot(
            corpus.Verses
                .Select(verse =>
                    SHA256.HashData(
                        Encoding.UTF8.GetBytes(
                            $"{verse.Location}\t{Sha256(verse.Text)}")))
                .ToArray());
        var unsafeSamples =
            new List<QuranicDiacritizationRoundTripSample>();
        var rejectionCodes = new SortedDictionary<string, long>(
            StringComparer.Ordinal);
        var leaves = new List<byte[]>
        {
            SHA256.HashData(
                Encoding.UTF8.GetBytes(
                    $"corpus\t{corpusMerkleRoot}")),
        };
        long eligibleVerses = 0;
        long candidates = 0;
        long acceptedVerses = 0;
        long rejectedVerses = 0;
        long accepted = 0;
        long rejected = 0;
        long exact = 0;
        long equivalent = 0;
        long unsafeAcceptances = 0;

        foreach (var verse in corpus.Verses)
        {
            var scoped =
                diacritizer.StripReconstructableMarks(verse.Text);
            if (scoped.UnitCount == 0)
            {
                var skipped = new QuranicDiacritizationRoundTripSample(
                    verse.Location,
                    0,
                    Sha256(verse.Text),
                    Sha256(verse.Text),
                    Sha256(verse.Text),
                    "Skipped",
                    true,
                    true,
                    ["ADG-QUR2301"]);
                leaves.Add(
                    SHA256.HashData(
                        Encoding.UTF8.GetBytes(Canonicalize(skipped))));
                continue;
            }

            eligibleVerses++;
            candidates += scoped.UnitCount;
            var report =
                diacritizer.Diacritize(scoped.StrippedText);
            var exactRestored = report.OutputText == verse.Text;
            var sample = new QuranicDiacritizationRoundTripSample(
                verse.Location,
                scoped.UnitCount,
                Sha256(verse.Text),
                Sha256(scoped.StrippedText),
                Sha256(report.OutputText),
                report.Status.ToString(),
                exactRestored,
                report.GraphEquivalent,
                report.Diagnostics
                    .Select(diagnostic => diagnostic.Code)
                    .Distinct(StringComparer.Ordinal)
                    .OrderBy(value => value, StringComparer.Ordinal)
                    .ToArray());

            if (report.IsValid)
            {
                acceptedVerses++;
                accepted += scoped.UnitCount;
                if (exactRestored)
                {
                    exact += scoped.UnitCount;
                }

                if (report.GraphEquivalent)
                {
                    equivalent += scoped.UnitCount;
                }

                if (!exactRestored || !report.GraphEquivalent)
                {
                    unsafeAcceptances += scoped.UnitCount;
                    if (unsafeSamples.Count < MaximumUnsafeSamples)
                    {
                        unsafeSamples.Add(sample);
                    }
                }
            }
            else
            {
                rejectedVerses++;
                rejected += scoped.UnitCount;
                foreach (var code in sample.DiagnosticCodes)
                {
                    rejectionCodes.TryGetValue(code, out var count);
                    rejectionCodes[code] = count + 1;
                }
            }

            leaves.Add(
                SHA256.HashData(
                    Encoding.UTF8.GetBytes(Canonicalize(sample))));
        }

        return new QuranicDiacritizationRoundTripEvaluation
        {
            VerseCount = corpus.Verses.Count,
            EligibleVerseCount = eligibleVerses,
            SkippedVerseCount = corpus.Verses.Count - eligibleVerses,
            AcceptedVerseCount = acceptedVerses,
            RejectedVerseCount = rejectedVerses,
            CandidateUnitCount = candidates,
            AcceptedUnitCount = accepted,
            RejectedUnitCount = rejected,
            ExactSurfaceRestoredUnitCount = exact,
            GraphEquivalentUnitCount = equivalent,
            UnsafeAcceptanceCount = unsafeAcceptances,
            RejectionCodeCounts = rejectionCodes,
            UnsafeAcceptanceSamples = unsafeSamples,
            CorpusMerkleRoot = corpusMerkleRoot,
            EvaluationMerkleRoot = QacMerkle.ComputeRoot(leaves),
        };
    }

    private static string Canonicalize(
        QuranicDiacritizationRoundTripSample sample) =>
        string.Join(
            "\t",
            sample.Location,
            sample.UnitCount,
            sample.CanonicalTextSha256,
            sample.StrippedTextSha256,
            sample.OutputTextSha256,
            sample.Status,
            sample.ExactSurfaceRestored,
            sample.GraphEquivalent,
            string.Join(",", sample.DiagnosticCodes));

    private static string Sha256(string value) =>
        Convert.ToHexString(
                SHA256.HashData(Encoding.UTF8.GetBytes(value)))
            .ToLowerInvariant();
}
