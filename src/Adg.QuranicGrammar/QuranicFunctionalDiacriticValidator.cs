using System.Collections.Frozen;
using System.Globalization;
using System.Text;
using Adg.QuranicCore;
using Adg.QuranicCorpus;

namespace Adg.QuranicGrammar;

public sealed record QuranicSignificantMark(
    int BaseIndex,
    int Utf16Offset,
    string Mark,
    string Name,
    string? CaseClass);

public sealed class QuranicDiacriticProfile
{
    public required string Surface { get; init; }

    public required string NormalizedSkeleton { get; init; }

    public IReadOnlyList<string> BaseLetters { get; init; } = [];

    public IReadOnlyList<QuranicSignificantMark> Marks { get; init; } = [];

    public required string Signature { get; init; }

    public bool HasSignificantMarks => Marks.Count > 0;

    public string? FinalCaseMarkClass
    {
        get => CaseMarkClassAtBaseIndex(BaseLetters.Count - 1);
    }

    public string? CaseMarkClassAtBaseIndex(int baseIndex)
    {
        if (baseIndex < 0 || baseIndex >= BaseLetters.Count)
        {
            return null;
        }

        var direct = Marks
            .Where(mark =>
                mark.BaseIndex == baseIndex
                && mark.CaseClass is not null)
            .OrderBy(mark => mark.Utf16Offset)
            .LastOrDefault();
        if (direct is not null)
        {
            return direct.CaseClass;
        }

        if (baseIndex > 0
            && BaseLetters[baseIndex] is "ا" or "ى")
        {
            return Marks
                .Where(mark =>
                    mark.BaseIndex == baseIndex - 1
                    && mark.Name == "Fathatan")
                .OrderBy(mark => mark.Utf16Offset)
                .LastOrDefault()
                ?.CaseClass;
        }

        return null;
    }
}

public sealed class QuranicDiacriticComparison
{
    public IReadOnlyList<QuranicSignificantMark> MissingMarks { get; init; } = [];

    public IReadOnlyList<QuranicSignificantMark> UnexpectedMarks { get; init; } = [];

    public bool HasOrderMismatch { get; init; }

    public bool IsEquivalent =>
        MissingMarks.Count == 0
        && UnexpectedMarks.Count == 0
        && !HasOrderMismatch;

    public bool IsMissingOnly =>
        MissingMarks.Count > 0
        && UnexpectedMarks.Count == 0
        && !HasOrderMismatch;

    public int DifferenceCount =>
        MissingMarks.Count
        + UnexpectedMarks.Count
        + (HasOrderMismatch ? 1 : 0);
}

public static class QuranicDiacriticAnalyzer
{
    private sealed record MarkDefinition(string Name, string? CaseClass);

    private static readonly FrozenDictionary<int, MarkDefinition>
        SignificantMarks =
            new Dictionary<int, MarkDefinition>
            {
                [0x064B] = new("Fathatan", "ACC"),
                [0x064C] = new("Dammatan", "NOM"),
                [0x064D] = new("Kasratan", "GEN"),
                [0x064E] = new("Fatha", "ACC"),
                [0x064F] = new("Damma", "NOM"),
                [0x0650] = new("Kasra", "GEN"),
                [0x0651] = new("Shadda", null),
                [0x0652] = new("Sukun", null),
            }.ToFrozenDictionary();

    public static FrozenDictionary<string, string> SupportedMarks { get; } =
        SignificantMarks.ToFrozenDictionary(
            pair => pair.Value.Name,
            pair => char.ConvertFromUtf32(pair.Key),
            StringComparer.Ordinal);

    public static string StripSignificantMarks(string surface)
    {
        ArgumentNullException.ThrowIfNull(surface);
        var builder = new StringBuilder(surface.Length);
        foreach (var rune in surface.EnumerateRunes())
        {
            if (!SignificantMarks.ContainsKey(rune.Value))
            {
                builder.Append(rune);
            }
        }

        return builder.ToString();
    }

    public static bool IsAdditiveSignificantCompletion(
        string observed,
        string canonical)
    {
        ArgumentNullException.ThrowIfNull(observed);
        ArgumentNullException.ThrowIfNull(canonical);
        var observedRunes = observed.EnumerateRunes().ToArray();
        var observedIndex = 0;
        foreach (var canonicalRune in canonical.EnumerateRunes())
        {
            if (observedIndex < observedRunes.Length
                && observedRunes[observedIndex] == canonicalRune)
            {
                observedIndex++;
                continue;
            }

            if (!SignificantMarks.ContainsKey(canonicalRune.Value))
            {
                return false;
            }
        }

        return observedIndex == observedRunes.Length;
    }

    public static QuranicDiacriticProfile Analyze(string surface)
    {
        ArgumentNullException.ThrowIfNull(surface);
        var marks = new List<QuranicSignificantMark>();
        var baseLetters = new List<string>();
        var baseIndex = -1;
        var utf16Offset = 0;

        foreach (var rune in surface.EnumerateRunes())
        {
            if (SignificantMarks.TryGetValue(
                    rune.Value,
                    out var definition))
            {
                marks.Add(
                    new QuranicSignificantMark(
                        baseIndex,
                        utf16Offset,
                        rune.ToString(),
                        definition.Name,
                        definition.CaseClass));
            }
            else if (rune.Value != '\u0640'
                     && !QuranicTextNormalizer.IsArabicMark(rune)
                     && QuranicTextNormalizer.IsArabicRune(rune)
                     && IsLetter(rune))
            {
                baseIndex++;
                baseLetters.Add(NormalizeBaseLetter(rune));
            }

            utf16Offset += rune.Utf16SequenceLength;
        }

        var orderedMarks = marks.ToArray();
        return new QuranicDiacriticProfile
        {
            Surface = surface,
            NormalizedSkeleton =
                QuranicTextNormalizer.NormalizeForAnalysis(surface),
            BaseLetters = baseLetters,
            Marks = orderedMarks,
            Signature = string.Join(
                "|",
                orderedMarks.Select(mark =>
                    FormattableString.Invariant(
                        $"{mark.BaseIndex}:{char.ConvertToUtf32(mark.Mark, 0):X4}"))),
        };
    }

    public static QuranicDiacriticComparison Compare(
        QuranicDiacriticProfile observed,
        QuranicDiacriticProfile canonical)
    {
        ArgumentNullException.ThrowIfNull(observed);
        ArgumentNullException.ThrowIfNull(canonical);
        if (observed.NormalizedSkeleton != canonical.NormalizedSkeleton)
        {
            throw new ArgumentException(
                "Diacritic profiles must share the same normalized skeleton.");
        }

        return new QuranicDiacriticComparison
        {
            MissingMarks = Difference(canonical.Marks, observed.Marks),
            UnexpectedMarks = Difference(observed.Marks, canonical.Marks),
            HasOrderMismatch = HasOrderMismatch(
                observed.Marks,
                canonical.Marks),
        };
    }

    private static IReadOnlyList<QuranicSignificantMark> Difference(
        IReadOnlyList<QuranicSignificantMark> source,
        IReadOnlyList<QuranicSignificantMark> matched)
    {
        var counts = matched
            .GroupBy(mark => (mark.BaseIndex, mark.Mark))
            .ToDictionary(group => group.Key, group => group.Count());
        var difference = new List<QuranicSignificantMark>();
        foreach (var mark in source)
        {
            var key = (mark.BaseIndex, mark.Mark);
            if (counts.TryGetValue(key, out var count)
                && count > 0)
            {
                counts[key] = count - 1;
            }
            else
            {
                difference.Add(mark);
            }
        }

        return difference;
    }

    private static bool HasOrderMismatch(
        IReadOnlyList<QuranicSignificantMark> observed,
        IReadOnlyList<QuranicSignificantMark> canonical)
    {
        foreach (var baseIndex in observed
                     .Select(mark => mark.BaseIndex)
                     .Concat(canonical.Select(mark => mark.BaseIndex))
                     .Distinct()
                     .Order())
        {
            var observedMarks = observed
                .Where(mark => mark.BaseIndex == baseIndex)
                .Select(mark => mark.Mark)
                .ToArray();
            var canonicalMarks = canonical
                .Where(mark => mark.BaseIndex == baseIndex)
                .Select(mark => mark.Mark)
                .ToArray();
            var canonicalIndex = 0;
            foreach (var observedMark in observedMarks)
            {
                while (canonicalIndex < canonicalMarks.Length
                       && canonicalMarks[canonicalIndex] != observedMark)
                {
                    canonicalIndex++;
                }

                if (canonicalIndex == canonicalMarks.Length)
                {
                    return true;
                }

                canonicalIndex++;
            }
        }

        return false;
    }

    private static bool IsLetter(Rune rune)
    {
        var category = Rune.GetUnicodeCategory(rune);
        return category is UnicodeCategory.UppercaseLetter
            or UnicodeCategory.LowercaseLetter
            or UnicodeCategory.TitlecaseLetter
            or UnicodeCategory.ModifierLetter
            or UnicodeCategory.OtherLetter;
    }

    private static string NormalizeBaseLetter(Rune rune) =>
        rune.Value switch
        {
            0x0671 or 0x0622 or 0x0623 or 0x0625 => "ا",
            0x0649 => "ى",
            _ => rune.ToString(),
        };
}

public sealed class QacDiacriticEvidenceIndex
{
    private readonly FrozenDictionary<string, IReadOnlyList<string>> surfaces;

    private QacDiacriticEvidenceIndex(
        FrozenDictionary<string, IReadOnlyList<string>> surfaces)
    {
        this.surfaces = surfaces;
    }

    public static QacDiacriticEvidenceIndex Build(
        QacMorphologyLexicon lexicon)
    {
        ArgumentNullException.ThrowIfNull(lexicon);
        return new QacDiacriticEvidenceIndex(
            lexicon.Words
                .GroupBy(
                    word => Key(
                        word.NormalizedSurface,
                        word.MorphologySignature),
                    StringComparer.Ordinal)
                .ToFrozenDictionary(
                    group => group.Key,
                    group => (IReadOnlyList<string>)group
                        .Select(word => word.ArabicSurface)
                        .Distinct(StringComparer.Ordinal)
                        .OrderBy(surface => surface, StringComparer.Ordinal)
                        .ToArray(),
                    StringComparer.Ordinal));
    }

    public IReadOnlyList<string> GetCanonicalSurfaces(
        string normalizedSurface,
        string morphologySignature) =>
        surfaces.GetValueOrDefault(
            Key(normalizedSurface, morphologySignature),
            []);

    private static string Key(
        string normalizedSurface,
        string morphologySignature) =>
        string.Concat(
            normalizedSurface,
            "\u001F",
            morphologySignature);
}

public enum QuranicFunctionalValidationStatus
{
    Valid,
    Invalid,
    Unverified,
}

public sealed record QuranicFunctionalDiagnostic(
    string Code,
    string RuleId,
    string Relation,
    string Message,
    SourceRange Range,
    string ObservedSurface,
    string ExpectedCase,
    string? ObservedCaseMarkClass,
    IReadOnlyList<string> CanonicalCaseMarkClasses,
    IReadOnlyList<string> CanonicalSurfaces,
    IReadOnlyList<string> Differences,
    string? SuggestedSurface,
    string CorrectionPolicy);

public sealed class QuranicFunctionalValidationReport
{
    public required QuranicFunctionalValidationStatus Status { get; init; }

    public required QacGrammarStatus ParserStatus { get; init; }

    public long TargetEdgeCount { get; init; }

    public long CheckedEdgeCount { get; init; }

    public long VerifiedEdgeCount { get; init; }

    public long SkippedEdgeCount { get; init; }

    public long UnverifiedEdgeCount { get; init; }

    public long InvalidEdgeCount { get; init; }

    public IReadOnlyList<QuranicFunctionalDiagnostic> Diagnostics
        { get; init; } = [];

    public bool IsValid =>
        Status == QuranicFunctionalValidationStatus.Valid;
}

public sealed class QuranicFunctionalDiacriticValidator
{
    public static FrozenSet<string> SupportedRelations { get; } =
        QacSyntaxValidator.CanonicalRelationCodes
            .Where(relation =>
                QuranicGrammarContractCatalog
                    .GetCanonicalContract(relation)
                    .Dependent
                    ?.RequiredCase is not null)
            .ToFrozenSet(StringComparer.Ordinal);

    private readonly QacDiacriticEvidenceIndex evidence;

    public QuranicFunctionalDiacriticValidator(
        QacDiacriticEvidenceIndex evidence)
    {
        this.evidence =
            evidence ?? throw new ArgumentNullException(nameof(evidence));
    }

    public QuranicFunctionalValidationReport Validate(
        QacDeterministicGrammarParse parse)
    {
        ArgumentNullException.ThrowIfNull(parse);
        var diagnostics = new List<QuranicFunctionalDiagnostic>();
        var nodes = parse.Graph.Nodes.ToDictionary(
            node => node.Id,
            StringComparer.Ordinal);
        var units = parse.Morphology.Units.ToDictionary(
            unit => RangeKey(unit.Range),
            StringComparer.Ordinal);
        var selections = parse.SelectedAlternative.Selection.ToDictionary(
            selection => selection.UnitIndex);
        long targets = 0;
        long checkedEdges = 0;
        long verified = 0;
        long skipped = 0;
        long unverified = 0;
        long invalid = 0;

        foreach (var edge in parse.Graph.Edges.Where(edge =>
                     SupportedRelations.Contains(edge.Relation)))
        {
            targets++;
            var contract =
                QuranicGrammarContractCatalog.GetCanonicalContract(
                    edge.Relation);
            if (!nodes.TryGetValue(edge.DependentId, out var dependent)
                || contract.Dependent?.RequiredCase is not { } expectedCase)
            {
                unverified++;
                continue;
            }

            if (contract.Dependent.AllowUnmarkedCaseTags.Contains(
                    dependent.Tag,
                    StringComparer.Ordinal))
            {
                skipped++;
                continue;
            }

            if (dependent.TextRange is not { } range)
            {
                unverified++;
                diagnostics.Add(
                    Diagnostic(
                        "ADG-QUR2104",
                        contract,
                        edge,
                        new SourceRange(0, 0),
                        string.Empty,
                        expectedCase,
                        null,
                        [],
                        [],
                        ["No observed surface range is available."],
                        null,
                        "None",
                        "The required diacritic evidence is not observable."));
                continue;
            }

            checkedEdges++;
            if (!edge.IsVerified)
            {
                unverified++;
                diagnostics.Add(
                    Diagnostic(
                        "ADG-QUR2105",
                        contract,
                        edge,
                        range,
                        string.Empty,
                        expectedCase,
                        null,
                        [],
                        [],
                        ["The morphology or dependency evidence is unverified."],
                        null,
                        "None",
                        "The edge cannot be used as verified diacritic evidence."));
                continue;
            }

            if (!units.TryGetValue(RangeKey(range), out var unit)
                || !selections.TryGetValue(
                    unit.Index,
                    out var selection)
                || selection.Source
                    != QacMorphologyCandidateSource.QuranicCorpus)
            {
                unverified++;
                diagnostics.Add(
                    Diagnostic(
                        "ADG-QUR2105",
                        contract,
                        edge,
                        range,
                        unit?.Surface ?? string.Empty,
                        expectedCase,
                        null,
                        [],
                        [],
                        ["The morphology or dependency evidence is unverified."],
                        null,
                        "None",
                        "The edge cannot be used as verified diacritic evidence."));
                continue;
            }

            var caseBaseIndex = DependentCaseBaseIndex(
                selection,
                dependent.Morphology);
            if (caseBaseIndex is null)
            {
                unverified++;
                diagnostics.Add(
                    Diagnostic(
                        "ADG-QUR2104",
                        contract,
                        edge,
                        range,
                        unit.Surface,
                        expectedCase,
                        null,
                        [],
                        [],
                        ["The dependent segment case position is not observable."],
                        null,
                        "None",
                        "The required case-bearing segment could not be located."));
                continue;
            }

            var canonicalSurfaces = evidence.GetCanonicalSurfaces(
                unit.NormalizedSurface,
                selection.MorphologySignature);
            if (canonicalSurfaces.Count == 0)
            {
                unverified++;
                diagnostics.Add(
                    Diagnostic(
                        "ADG-QUR2106",
                        contract,
                        edge,
                        range,
                        unit.Surface,
                        expectedCase,
                        null,
                        [],
                        [],
                        ["No canonical surface was found for the selected morphology."],
                        null,
                        "None",
                        "Canonical diacritic evidence is missing."));
                continue;
            }

            var observed = QuranicDiacriticAnalyzer.Analyze(unit.Surface);
            var candidates = canonicalSurfaces
                .Select(surface =>
                {
                    var profile = QuranicDiacriticAnalyzer.Analyze(surface);
                    return new CandidateComparison(
                        surface,
                        profile,
                        QuranicDiacriticAnalyzer.Compare(
                            observed,
                            profile));
                })
                .OrderBy(candidate =>
                    candidate.Comparison.DifferenceCount)
                .ThenBy(candidate => candidate.Surface, StringComparer.Ordinal)
                .ToArray();
            var observedCaseClass =
                observed.CaseMarkClassAtBaseIndex(caseBaseIndex.Value);
            var canonicalCaseClasses = candidates
                .Select(candidate =>
                    candidate.Profile.CaseMarkClassAtBaseIndex(
                        caseBaseIndex.Value))
                .Where(value => value is not null)
                .Cast<string>()
                .Distinct(StringComparer.Ordinal)
                .OrderBy(value => value, StringComparer.Ordinal)
                .ToArray();
            if (dependent.Morphology?.GrammaticalCase is null)
            {
                unverified++;
                diagnostics.Add(
                    Diagnostic(
                        "ADG-QUR2107",
                        contract,
                        edge,
                        range,
                        unit.Surface,
                        expectedCase,
                        observedCaseClass,
                        canonicalCaseClasses,
                        canonicalSurfaces,
                        ["The selected morphology does not expose an inflectional case."],
                        null,
                        "None",
                        "The dependent is indeclinable or its case is not morphologically observable."));
                continue;
            }

            if (dependent.Morphology.GrammaticalCase != expectedCase)
            {
                if (edge.Relation == "poss"
                    && expectedCase == "GEN"
                    && QacSyntaxValidator
                        .HasDualObliqueSurfaceWithNominativeAnnotation(
                            dependent.Morphology))
                {
                    unverified++;
                    diagnostics.Add(
                        Diagnostic(
                            "ADG-QUR2107",
                            contract,
                            edge,
                            range,
                            unit.Surface,
                            expectedCase,
                            observedCaseClass,
                            canonicalCaseClasses,
                            canonicalSurfaces,
                            ["The parser carries a reviewed dual-oblique source-case exception."],
                            null,
                            "None",
                            "The dual oblique surface is not represented by the selected morphology case."));
                    continue;
                }

                invalid++;
                diagnostics.Add(
                    Diagnostic(
                        "ADG-QUR2103",
                        contract,
                        edge,
                        range,
                        unit.Surface,
                        expectedCase,
                        observedCaseClass,
                        canonicalCaseClasses,
                        canonicalSurfaces,
                        [
                            $"morphology-case:{dependent.Morphology?.GrammaticalCase ?? "none"}",
                            $"required-case:{expectedCase}",
                        ],
                        null,
                        "None",
                        "Selected morphology contradicts the dependency contract case."));
                continue;
            }

            var expectedSurfaceCaseClass =
                ExpectedSurfaceCaseClass(
                    selection,
                    dependent.Morphology,
                    expectedCase);
            if (expectedSurfaceCaseClass is null)
            {
                unverified++;
                diagnostics.Add(
                    Diagnostic(
                        "ADG-QUR2107",
                        contract,
                        edge,
                        range,
                        unit.Surface,
                        expectedCase,
                        observedCaseClass,
                        canonicalCaseClasses,
                        canonicalSurfaces,
                        ["This inflection class has no simple final-mark case mapping."],
                        null,
                        "None",
                        "The grammatical case is encoded by an unsupported or non-final inflection pattern."));
                continue;
            }

            if (canonicalCaseClasses.Length != 1)
            {
                unverified++;
                diagnostics.Add(
                    Diagnostic(
                        "ADG-QUR2107",
                        contract,
                        edge,
                        range,
                        unit.Surface,
                        expectedCase,
                        observedCaseClass,
                        canonicalCaseClasses,
                        canonicalSurfaces,
                        ["Canonical case-mark evidence is absent or ambiguous."],
                        null,
                        "None",
                        "The canonical surface does not expose one unambiguous supported case mark."));
                continue;
            }

            if (canonicalCaseClasses[0] != expectedSurfaceCaseClass)
            {
                if (expectedCase == "GEN"
                    && canonicalCaseClasses[0] == "ACC")
                {
                    unverified++;
                    diagnostics.Add(
                        Diagnostic(
                            "ADG-QUR2107",
                            contract,
                            edge,
                            range,
                            unit.Surface,
                            expectedCase,
                            observedCaseClass,
                            canonicalCaseClasses,
                            canonicalSurfaces,
                            ["Genitive fatha may require a diptote-specific contract."],
                            null,
                            "None",
                            "The surface may use a non-regular genitive realization."));
                    continue;
                }

                invalid++;
                diagnostics.Add(
                    Diagnostic(
                        "ADG-QUR2103",
                        contract,
                        edge,
                        range,
                        unit.Surface,
                        expectedCase,
                        observedCaseClass,
                        canonicalCaseClasses,
                        canonicalSurfaces,
                        [
                            $"canonical-case:{canonicalCaseClasses[0]}",
                            $"required-surface-case:{expectedSurfaceCaseClass}",
                        ],
                        null,
                        "None",
                        "Canonical Quranic marks contradict the dependency contract case."));
                continue;
            }

            if (candidates.Any(candidate =>
                    candidate.Comparison.IsEquivalent))
            {
                verified++;
                continue;
            }

            var best = candidates[0];
            var differences = DescribeDifferences(best.Comparison);
            var observedWithoutSignificantMarks =
                QuranicDiacriticAnalyzer.StripSignificantMarks(unit.Surface);
            var compatibleSurfaces = candidates
                .Select(candidate => candidate.Surface)
                .Where(surface =>
                    QuranicDiacriticAnalyzer.StripSignificantMarks(surface)
                        == observedWithoutSignificantMarks
                    && QuranicDiacriticAnalyzer
                        .IsAdditiveSignificantCompletion(
                            unit.Surface,
                            surface))
                .Distinct(StringComparer.Ordinal)
                .ToArray();
            var suggestedSurface = compatibleSurfaces.Length == 1
                ? compatibleSurfaces[0]
                : null;

            if (best.Comparison.IsMissingOnly)
            {
                unverified++;
                diagnostics.Add(
                    Diagnostic(
                        "ADG-QUR2101",
                        contract,
                        edge,
                        range,
                        unit.Surface,
                        expectedCase,
                        observedCaseClass,
                        canonicalCaseClasses,
                        canonicalSurfaces,
                        differences,
                        suggestedSurface,
                        suggestedSurface is null
                            ? "None"
                            : "DiacriticOnlyCandidate",
                        "Required Quranic diacritics are missing."));
            }
            else
            {
                invalid++;
                diagnostics.Add(
                    Diagnostic(
                        "ADG-QUR2102",
                        contract,
                        edge,
                        range,
                        unit.Surface,
                        expectedCase,
                        observedCaseClass,
                        canonicalCaseClasses,
                        canonicalSurfaces,
                        differences,
                        suggestedSurface,
                        suggestedSurface is null
                            ? "None"
                            : "DiacriticOnlyCandidate",
                        "Observed Quranic diacritics contradict the selected grammatical evidence."));
            }
        }

        var status = invalid > 0
            || parse.Status == QacGrammarStatus.Invalid
                ? QuranicFunctionalValidationStatus.Invalid
                : unverified > 0
                  || parse.Status != QacGrammarStatus.Valid
                  || checkedEdges == 0
                    ? QuranicFunctionalValidationStatus.Unverified
                    : QuranicFunctionalValidationStatus.Valid;
        return new QuranicFunctionalValidationReport
        {
            Status = status,
            ParserStatus = parse.Status,
            TargetEdgeCount = targets,
            CheckedEdgeCount = checkedEdges,
            VerifiedEdgeCount = verified,
            SkippedEdgeCount = skipped,
            UnverifiedEdgeCount = unverified,
            InvalidEdgeCount = invalid,
            Diagnostics = diagnostics,
        };
    }

    private static QuranicFunctionalDiagnostic Diagnostic(
        string code,
        QuranicGrammarRuleContract contract,
        QacDependencyEdge edge,
        SourceRange range,
        string observedSurface,
        string expectedCase,
        string? observedCaseClass,
        IReadOnlyList<string> canonicalCaseClasses,
        IReadOnlyList<string> canonicalSurfaces,
        IReadOnlyList<string> differences,
        string? suggestedSurface,
        string correctionPolicy,
        string message) =>
        new(
            code,
            contract.RuleId,
            edge.Relation,
            message,
            range,
            observedSurface,
            expectedCase,
            observedCaseClass,
            canonicalCaseClasses,
            canonicalSurfaces,
            differences,
            suggestedSurface,
            correctionPolicy);

    private static IReadOnlyList<string> DescribeDifferences(
        QuranicDiacriticComparison comparison) =>
        comparison.MissingMarks
            .Select(mark =>
                $"missing:{mark.Name}@{mark.BaseIndex}")
            .Concat(
                comparison.UnexpectedMarks.Select(mark =>
                    $"unexpected:{mark.Name}@{mark.BaseIndex}"))
            .Concat(
                comparison.HasOrderMismatch
                    ? ["order:mismatch"]
                    : [])
            .ToArray();

    internal static bool? HasSurfaceCompatibleCase(
        QacSelectedMorphology selection) =>
        HasSurfaceCompatibleCase(selection, selection.Surface);

    internal static bool? HasCanonicalSurfaceCompatibleCase(
        QacSelectedMorphology selection) =>
        HasSurfaceCompatibleCase(
            selection,
            selection.Candidate.ArabicSurface);

    private static bool? HasSurfaceCompatibleCase(
        QacSelectedMorphology selection,
        string surface)
    {
        var morphology = selection.Candidate.Segments.FirstOrDefault(
            segment =>
                segment.SegmentKind == nameof(QacSegmentKind.Stem));
        if (morphology?.GrammaticalCase is not { } grammaticalCase)
        {
            return null;
        }

        var expected = ExpectedSurfaceCaseClass(
            selection,
            morphology,
            grammaticalCase);
        var caseBaseIndex = DependentCaseBaseIndex(selection, morphology);
        if (expected is null || caseBaseIndex is null)
        {
            return null;
        }

        var observed = QuranicDiacriticAnalyzer
            .Analyze(surface)
            .CaseMarkClassAtBaseIndex(caseBaseIndex.Value);
        if (observed is null
            || grammaticalCase == "GEN" && observed == "ACC")
        {
            return null;
        }

        return observed == expected;
    }

    private static int? DependentCaseBaseIndex(
        QacSelectedMorphology selection,
        QacNormalizedMorphologyRecord? morphology)
    {
        if (morphology is null)
        {
            return null;
        }

        var segmentIndex = selection.Candidate.Segments
            .Select((segment, index) => (segment, index))
            .Where(pair => pair.segment == morphology)
            .Select(pair => pair.index)
            .DefaultIfEmpty(-1)
            .First();
        if (segmentIndex < 0)
        {
            return null;
        }

        var baseCount = selection.Candidate.Segments
            .Take(segmentIndex + 1)
            .Sum(segment =>
                QuranicDiacriticAnalyzer
                    .Analyze(
                        segment.Form.Length == 0
                            ? string.Empty
                            : ExtendedBuckwalter.Decode(segment.Form))
                    .BaseLetters
                    .Count);
        return baseCount > 0 ? baseCount - 1 : null;
    }

    private static string? ExpectedSurfaceCaseClass(
        QacSelectedMorphology selection,
        QacNormalizedMorphologyRecord morphology,
        string grammaticalCase)
    {
        if (selection.Candidate.Segments.Any(segment =>
                segment.SegmentKind == nameof(QacSegmentKind.Suffix)
                && segment.AttachedPronoun == "1S"))
        {
            return null;
        }

        if (grammaticalCase == "NOM"
            && morphology.Form.EndsWith(
                "K",
                StringComparison.Ordinal))
        {
            return null;
        }

        if (grammaticalCase is "NOM" or "GEN"
            && morphology.Root is { Length: > 0 } root
            && root[^1] is 'w' or 'y'
            && morphology.Form.EndsWith("i", StringComparison.Ordinal)
            && morphology.RawFeatures.Contains("ACT", StringComparer.Ordinal)
            && morphology.RawFeatures.Contains("PCPL", StringComparer.Ordinal))
        {
            return null;
        }

        var segmentSurface = morphology.Form.Length == 0
            ? string.Empty
            : ExtendedBuckwalter.Decode(morphology.Form);
        var profile = QuranicDiacriticAnalyzer.Analyze(segmentSurface);
        var finalLetters = string.Concat(profile.BaseLetters.TakeLast(2));
        if ((morphology.RawFeatures.Contains("MP", StringComparer.Ordinal)
             && finalLetters is "ون" or "ين")
            || ((morphology.RawFeatures.Contains("MD", StringComparer.Ordinal)
                 || morphology.RawFeatures.Contains("FD", StringComparer.Ordinal))
                && finalLetters is "ان" or "ين"))
        {
            return null;
        }

        if (profile.BaseLetters.LastOrDefault() is "ا" or "ى")
        {
            return null;
        }

        var hasDeclaredNominalClass = morphology.RawFeatures.Any(feature =>
            feature is "M" or "F" or "MS" or "FS"
                or "MP" or "FP" or "MD" or "FD");
        if (!hasDeclaredNominalClass)
        {
            return null;
        }

        if (morphology.RawFeatures.Contains("FP", StringComparer.Ordinal)
            && (finalLetters == "ات"
                || morphology.Form.Contains("a`t", StringComparison.Ordinal))
            && grammaticalCase is "ACC" or "GEN")
        {
            return "GEN";
        }

        return grammaticalCase;
    }

    private static string RangeKey(SourceRange range) =>
        FormattableString.Invariant($"{range.Start}:{range.Length}");

    private sealed record CandidateComparison(
        string Surface,
        QuranicDiacriticProfile Profile,
        QuranicDiacriticComparison Comparison);
}
