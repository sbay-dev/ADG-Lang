using Adg.QuranicCore;
using Adg.QuranicCorpus;
using static Adg.QuranicGrammar.QacMorphologySelectionScorePolicy;

namespace Adg.QuranicGrammar;

public enum QacGrammarStatus
{
    Valid,
    Invalid,
    Unverified,
}

public sealed record QacSelectedMorphology(
    int UnitIndex,
    string Surface,
    string MorphologySignature,
    QacMorphologyCandidateSource Source,
    string PrimaryTag,
    QacLexicalCandidate Candidate);

public sealed record QacGrammarAlternative(
    int Score,
    string Signature,
    IReadOnlyList<QacSelectedMorphology> Selection);

public sealed class QacDeterministicGrammarParse
{
    public required QacGrammarStatus Status { get; init; }

    public required QacMorphologyParse Morphology { get; init; }

    public required QacGrammarAlternative SelectedAlternative { get; init; }

    public IReadOnlyList<QacGrammarAlternative> Alternatives { get; init; } = [];

    public required QacDependencyGraph Graph { get; init; }

    public required QacSyntaxValidationReport Validation { get; init; }

    public IReadOnlyList<QacParserDiagnostic> Diagnostics { get; init; } = [];
}

public sealed class QacDeterministicGrammarParser
{
    private static readonly HashSet<string> ConditionalTemporalLemmas =
        new(StringComparer.Ordinal)
        {
            "<i*aA",
            "<i*",
            "kul~amaA",
            "lam~aA",
        };
    private static readonly HashSet<string> CaselessSubjectPreferredVerbRoots =
        new(StringComparer.Ordinal)
        {
            "*kr",
            "A*n",
            "Ady",
            "Drr",
            "Efw",
            "Hsb",
            "Hyy",
            "Hzn",
            "ftn",
            "hlk",
            "jwb",
            "mll",
            "qwl",
            "rAy",
            "rwd",
            "ryb",
            "wdd",
            "x$y",
            "yqn",
            "zyd",
        };
    private static readonly HashSet<string> CaselessPerfectObjectVerbRoots =
        new(StringComparer.Ordinal)
        {
            "Aty",
            "Elm",
        };
    private static readonly HashSet<string> CircumstantialAccusativeLemmas =
        new(StringComparer.Ordinal)
        {
            ">a$otaAt",
            ">aTowaAr",
            "Saf~",
            "TawoE",
            "Tawol",
            "jamiyE",
            "jamoE",
            "kaA^f~ap",
            "waHod",
        };
    private static readonly HashSet<string>
        CircumstantialActiveParticipleVerbRoots =
            new(StringComparer.Ordinal)
            {
                "Evw",
                "bEv",
                "dxl",
                "gdw",
                "jyA",
                "m$y",
                "ndw",
                "qwm",
                "rjE",
                "xrj",
            };
    private static readonly HashSet<(string Lemma, string VerbRoot)>
        CircumstantialLexemeVerbPairs =
        [
            ("Eudowa`n", "fEl"),
            ("Hakam", "bgy"),
            ("kita`b", "HSy"),
            ("mivol", "rAy"),
            ("Sidoq", "tmm"),
            ("fakihiyn", "qlb"),
            ("fawoj", "Aty"),
            ("fawoj", "dxl"),
            ("jazuwE", "mss"),
            ("manuwE", "mss"),
            ("masoruwr", "qlb"),
            ("muSad~iq", "nzl"),
            ("muba$~ir", "rsl"),
            ("mukal~ibiyn", "Elm"),
            ("m~aroDiy~ap", "rjE"),
            ("m~idoraAr", "rsl"),
            ("m~utaEam~id", "qtl"),
            ("nuwr", "jyA"),
            ("sir~", "nfq"),
            ("xaAsi}", "qlb"),
        ];
    private static readonly HashSet<string> RelativeAdjectivalHeadLemmas =
        new(StringComparer.Ordinal)
        {
            "$ariyk",
            ">um~",
            "mala>",
            "n~abiY~",
            "qawom",
            "raba`^}ib",
            "yawom",
        };
    private static readonly HashSet<string> RelativePossessiveHeadLemmas =
        new(StringComparer.Ordinal)
        {
            "TaEaAm",
            "fu&aAd",
            "jazaA^'",
            "maval",
            "mivol",
            "naba>",
            "niSof",
            "v~uluv",
            "waliY~",
        };
    private static readonly HashSet<(string Head, string Dependent)>
        NominalPredicateLemmaPairs =
        [
            ("$aha`dap", ">aHaq~"),
            ("*a`lik", "hudFY"),
            ("*a`lik", "qaroyap"),
            ("<ivom", ">akobar"),
            ("A^xir", "xayor"),
            ("PRON", ">adonaY`"),
            ("PRON", "hudFY"),
            ("PRON", "ma>owaY`"),
            ("PRON", "mawolaY`"),
            ("SuloH", "xayor"),
            ("baEol", ">aHaq~"),
            ("baEoD", ">awolaY`"),
            ("fitonap", ">akobar"),
            ("ha`*aA", "rab~"),
            ("quTuwf", "daAniyap"),
            ("rab~", "ganiY~"),
        ];
    private static readonly HashSet<(string Lemma, string VerbRoot)>
        TemporalLocativeLinkPairs =
        [
            (">arobaEap", "syH"),
            (">aw~al", "Amn"),
            (">aw~al", "rDw"),
            ("Eind", "kbr"),
            ("Hiyn", "sAl"),
            ("baEod", "Amn"),
            ("baEod", "dHw"),
            ("bayon", "Akl"),
            ("bukorap", "*kr"),
            ("fawoq", "Drb"),
            ("fawoq", "Hml"),
            ("kul~", "qEd"),
            ("layol", "dEw"),
            ("saAEap", "Axr"),
            ("tiloqaA^'", "Srf"),
            ("xila`l", "wDE"),
            ("yawom", "E*r"),
            ("yawom", "Hkm"),
            ("yawom", "Sly"),
            ("yawom", "Swb"),
            ("yawom", "dxl"),
            ("yawom", "nfE"),
            ("yawom", "nzl"),
            ("yawom", "wly"),
        ];
    private static readonly HashSet<(string Head, string Dependent)>
        PossessiveLemmaPairs =
        [
            ("<iHodaY", "Husonayayon"),
            ("Eind", "gayor"),
            ("Hub~", "xayor"),
            ("baEoD", "ZaAlim"),
            ("daAbir", "ka`firuwn"),
            ("daAr", "faAsiq"),
            ("duwn", "r~aHoma`n"),
            ("kayod", "ka`firuwn"),
            ("kul~", "wa`Hid"),
            ("mata`E", "d~unoyaA"),
            ("muxoziY", "ka`firuwn"),
            ("naba>", "m~urosal"),
            ("qalob", "ka`firuwn"),
            ("vawaAb", "d~unoyaA"),
            ("wizor", "A^xar"),
            ("xaloq", "r~aHoma`n"),
        ];
    private static readonly HashSet<(string Noun, string Verb)>
        CognateLemmaVerbPairs =
        [
            ("<isoraAr", ">asar~a"),
            ("Eilom", "Ealima"),
            ("Sabor", "Sabara"),
            ("SuloH", ">aSolaHa"),
            ("baEoD", "taqaw~ala"),
            ("jahod", ">aqosamu"),
            ("kar~ap", "rajaEa"),
            ("kayod", "kiydu"),
            ("ki*~aAb", "ka*~aba"),
            ("kul~", "yamiylu"),
            ("makor", "makara"),
            ("m~ayolap", "yamiylu"),
            ("qaA^}im", "jaEala"),
            ("saboE", "{sotagofara"),
            ("tabotiyl", "tabat~alo"),
            ("takoliym", "kal~ama"),
            ("taqodiyr", "qad~ara"),
            ("{sotikobaAr", "{sotakobara"),
        ];
    private static readonly HashSet<(string Noun, string Verb)>
        SpecificationLemmaVerbPairs =
        [
            ("<ivom", "{zodaAdu"),
            ("darajap", "rafaEa"),
            ("rab~", "bagaY`"),
            ("sabiyl", "'aAmana"),
        ];
    private static readonly HashSet<(string Noun, string Verb)>
        PurposeLemmaVerbPairs =
        [
            ("ba`Til", "xalaqa"),
            ("jihaAd", "xaraja"),
            ("man~", ">anfaqa"),
        ];
    private static readonly HashSet<(string Head, string Dependent)>
        AppositionalLemmaPairs =
        [
            (">abN", "A^zar"),
            (">ax", "ha`ruwn"),
            (">axo*", "r~ibaw`A"),
            ("Hadiyv", "gayor"),
            ("buruwj", "m~u$ay~adap"),
            ("diyn", "kul~"),
            ("humazap", "l~umazap"),
            ("mawolaY`", "Haq~"),
            ("rasuwl", "n~abiY~"),
        ];
    private static readonly HashSet<(string Head, string Dependent)>
        AdjectivalLemmaPairs =
        [
            ("<iram", "*uw"),
            (">aroD", "*uw"),
            ("firoEawon", "*uw"),
            ("m~uka*~ibiyn", ">uwliY"),
            ("naAr", "*uw"),
            ("qawom", "Sa`liH"),
            ("qawom", "ZaAlim"),
            ("samaA^'", "*uw"),
        ];
    private readonly QacMorphologyTextParser morphologyParser;

    public QacDeterministicGrammarParser(
        QacMorphologyLexicon lexicon,
        bool enableHeuristicFallback = false)
    {
        ArgumentNullException.ThrowIfNull(lexicon);
        morphologyParser = new QacMorphologyTextParser(
            lexicon,
            enableHeuristicFallback ? new QacHeuristicMorphologyGuesser() : null);
    }

    public QacDeterministicGrammarParse Parse(string text)
    {
        var morphology = morphologyParser.Parse(text);
        if (morphology.Units.Count == 0)
        {
            return EmptyResult(morphology);
        }

        if (morphology.Units.Any(unit => unit.Candidates.Count == 0))
        {
            return UnresolvedResult(morphology);
        }

        var clauseIndexes = ComputeClauseIndexes(text, morphology.Units);
        var alternatives = SelectAlternatives(morphology, clauseIndexes);
        var selected = alternatives[0];
        var graph = BuildGraph(morphology, selected, clauseIndexes);
        var validation = QacSyntaxValidator.Validate(graph);
        var diagnostics = morphology.Diagnostics.ToList();
        var surfaceIncompatibleSelections = selected.Selection
            .Where(selection =>
                QuranicFunctionalDiacriticValidator
                    .HasCanonicalSurfaceCompatibleCase(selection) == false)
            .ToArray();
        foreach (var selection in surfaceIncompatibleSelections)
        {
            diagnostics.Add(
                new QacParserDiagnostic(
                    "ADG-QC2004",
                    $"The selected morphology case for '{selection.Surface}' "
                    + "contradicts its observed Quranic case mark.",
                    morphology.Units[selection.UnitIndex].Range));
        }

        var terminalCount = graph.Nodes.Count(node =>
            node.Kind == QacSyntaxNodeKind.Terminal);
        var hasCompleteSentencePhrase = graph.Nodes.Any(node =>
            node.Kind == QacSyntaxNodeKind.Phrase
            && node.Tag == "S"
            && node.SpanStartTerminal == 0
            && node.SpanEndTerminal == terminalCount - 1);
        var hasCoreRelation = graph.Edges.Any(edge =>
                edge.IsVerified
                && edge.Relation
                    is "subj" or "pass" or "pred" or "subjx" or "predx")
            || hasCompleteSentencePhrase;
        var hasHeuristic = selected.Selection.Any(item =>
            item.Source == QacMorphologyCandidateSource.Heuristic);

        var status = validation.IsValid
            ? hasHeuristic
                || surfaceIncompatibleSelections.Length > 0
                || validation.UnverifiedEdgeCount > 0
                || (!hasCoreRelation && morphology.Units.Count > 1)
                ? QacGrammarStatus.Unverified
                : QacGrammarStatus.Valid
            : QacGrammarStatus.Invalid;

        if (!hasCoreRelation && morphology.Units.Count > 1)
        {
            diagnostics.Add(
                new QacParserDiagnostic(
                    "ADG-QS2001",
                    "No complete nominal or verbal predicate structure was proven.",
                    new SourceRange(0, text.Length)));
        }

        foreach (var issue in validation.Errors)
        {
            diagnostics.Add(
                new QacParserDiagnostic(
                    issue.Code,
                    issue.Message,
                    new SourceRange(0, text.Length)));
        }

        var graphNodes = graph.Nodes.ToDictionary(
            node => node.Id,
            StringComparer.Ordinal);
        foreach (var edge in graph.Edges.Where(edge => !edge.IsVerified))
        {
            if (!graphNodes.TryGetValue(edge.DependentId, out var dependent)
                || !graphNodes.TryGetValue(edge.HeadId, out var head))
            {
                continue;
            }

            foreach (var issue in QacSyntaxValidator
                         .ValidateCanonicalRelationEdge(
                             edge,
                             dependent,
                             head))
            {
                diagnostics.Add(
                    new QacParserDiagnostic(
                        issue.Code,
                        $"Unverified relation: {issue.Message}",
                        dependent.TextRange
                        ?? head.TextRange
                        ?? new SourceRange(0, text.Length)));
            }
        }

        return new QacDeterministicGrammarParse
        {
            Status = status,
            Morphology = morphology,
            SelectedAlternative = selected,
            Alternatives = alternatives,
            Graph = graph,
            Validation = validation,
            Diagnostics = diagnostics,
        };
    }

    private static IReadOnlyList<QacGrammarAlternative> SelectAlternatives(
        QacMorphologyParse morphology,
        IReadOnlyList<int> clauseIndexes)
    {
        var paths = morphology.Units[0].Candidates
            .Select(candidate =>
            {
                var selection = CreateSelection(morphology.Units[0], candidate);
                return new CandidatePath(
                    ScoreCandidate(selection),
                    [selection]);
            })
            .OrderByDescending(path => path.Score)
            .ThenBy(path => path.Signature, StringComparer.Ordinal)
            .Take(MaxAlternatives)
            .ToArray();

        for (var unitIndex = 1; unitIndex < morphology.Units.Count; unitIndex++)
        {
            var unit = morphology.Units[unitIndex];
            var sameClause = clauseIndexes[unitIndex] == clauseIndexes[unitIndex - 1];
            paths = paths
                .SelectMany(path => unit.Candidates.Select(candidate =>
                {
                    var selection = CreateSelection(unit, candidate);
                    var pairScore = sameClause
                        ? ScorePair(path.Selection[^1], selection)
                        : 0;
                    return new CandidatePath(
                        path.Score + ScoreCandidate(selection) + pairScore,
                        [.. path.Selection, selection]);
                }))
                .OrderByDescending(path => path.Score)
                .ThenBy(path => path.Signature, StringComparer.Ordinal)
                .Take(MaxAlternatives)
                .ToArray();
        }

        return paths.Select(path =>
            new QacGrammarAlternative(
                path.Score,
                path.Signature,
                path.Selection)).ToArray();
    }

    private static QacSelectedMorphology CreateSelection(
        QacParsedMorphologyUnit unit,
        QacLexicalCandidate candidate)
    {
        var stem = candidate.Segments.FirstOrDefault(segment =>
            segment.SegmentKind == nameof(QacSegmentKind.Stem));
        var primary = stem ?? candidate.Segments.First();
        return new QacSelectedMorphology(
            unit.Index,
            unit.Surface,
            candidate.MorphologySignature,
            candidate.Source,
            primary.Tag,
            candidate);
    }

    private static int ScoreCandidate(QacSelectedMorphology selection)
    {
        var view = new CandidateView(selection);
        var score = selection.Source == QacMorphologyCandidateSource.QuranicCorpus
            ? QuranicCorpusBase
                + QuranicCorpusFrequencyMultiplier * Math.Min(
                QuranicCorpusFrequencyLog2Cap,
                (int)Math.Log2(selection.Candidate.OccurrenceCount + 1))
            : HeuristicBase + selection.Candidate.SelectionScore;

        if (view.HasTag("DET") && view.IsNominal)
        {
            score += DefiniteNominalBonus;
        }

        if (view.HasTag("P") && view.IsNominal)
        {
            score += view.Case == "GEN"
                ? PrepositionGenitiveBonus
                : PrepositionNonGenitivePenalty;
        }

        if (view.HasTag("CAUS") && view.PrimaryTag == "V")
        {
            score += view.Aspect == "IMPF"
                ? view.Mood == "SUBJ"
                    ? CausalImperfectSubjunctiveBonus
                    : CausalImperfectWrongMoodPenalty
                : CausalNonImperfectBonus;
        }

        if (view.HasTag("FUT") && view.PrimaryTag == "V")
        {
            score += view.Aspect == "IMPF"
                ? FutureImperfectBonus
                : FutureNonImperfectPenalty;
        }

        if (view.HasTag("PRO") && view.PrimaryTag == "V")
        {
            score += view.Aspect == "IMPF" && view.Mood == "JUS"
                ? ProhibitionJussiveBonus
                : ProhibitionMismatchPenalty;
        }

        score += QuranicFunctionalDiacriticValidator
            .HasSurfaceCompatibleCase(selection) switch
        {
            true => SurfaceCompatibleCaseBonus,
            false => SurfaceIncompatibleCasePenalty,
            null => 0,
        };

        return score;
    }

    private static int ScorePair(
        QacSelectedMorphology leftSelection,
        QacSelectedMorphology rightSelection)
    {
        var left = new CandidateView(leftSelection);
        var right = new CandidateView(rightSelection);
        var score = 0;

        if (left.PrimaryTag == "P"
            && !left.HasAttachedPronounSuffix
            && right.IsNominal)
        {
            score += CanBeGenitiveDependent(right)
                ? PairPrepositionGenitiveBonus
                : PairPrepositionMismatchPenalty;
        }

        if (left.PrimaryTag == "INC" && right.PrimaryTag == "T")
        {
            score += PairInceptiveTemporalBonus;
        }

        if (left.PrimaryTag == "CAUS" && right.PrimaryTag == "V")
        {
            score += right.Aspect == "IMPF"
                ? right.Mood == "SUBJ"
                    ? PairCausalSubjunctiveBonus
                    : PairCausalWrongMoodPenalty
                : PairCausalNonImperfectBonus;
        }

        if (left.PrimaryTag == "FUT" && right.PrimaryTag == "V")
        {
            score += right.Aspect == "IMPF"
                ? PairFutureImperfectBonus
                : PairFutureNonImperfectPenalty;
        }

        if (left.PrimaryTag is "PRO" or "IMPV" && right.PrimaryTag == "V")
        {
            score += right.Aspect == "IMPF" && right.Mood == "JUS"
                ? PairProhibitionJussiveBonus
                : PairProhibitionMismatchPenalty;
        }

        if (left.SpecialClass == "<in~"
            && right.IsNominal)
        {
            var expectedCase = left.HasAttachedPronounSuffix ? "NOM" : "ACC";
            score += right.Case == expectedCase
                ? PairSpecialExpectedCaseBonus
                : right.PrimaryTag is "REL" or "DEM"
                    ? PairSpecialCaselessBonus
                    : PairSpecialCaseMismatchPenalty;
        }

        if (left.PrimaryTag == "NEG"
            && left.SpecialClass == "kaAn"
            && right.IsNominal)
        {
            score += right.Case == "NOM"
                ? PairSpecialExpectedCaseBonus
                : right.PrimaryTag is "PRON" or "REL" or "DEM"
                    ? PairSpecialCaselessBonus
                    : PairSpecialCaseMismatchPenalty;
        }

        if (left.Lemma is not null
            && right.Lemma is not null
            && right.Selection.Source
                == QacMorphologyCandidateSource.QuranicCorpus
            && PossessiveLemmaPairs.Contains((left.Lemma, right.Lemma)))
        {
            score += right.Case == "GEN"
                ? PairLexicalPossessiveGenitiveBonus
                : PairLexicalPossessiveMismatchPenalty;
        }

        if (left.IsNominal
            && right.PrimaryTag == "N"
            && right.Lemma == "*uw"
            && right.Case == left.Case)
        {
            score += PairDhuAgreementBonus;
        }

        if (right.PrimaryTag == "ADJ"
            && right.Selection.Source == QacMorphologyCandidateSource.QuranicCorpus
            && left.IsNominal)
        {
            score += AgreementScore(left, right);
            score += left.PrimaryTag is "N" or "PN" or "T"
                ? PairAdjectiveNominalHeadBonus
                : PairAdjectiveNonNominalHeadPenalty;
        }

        if (left.IsNominal && right.IsNominal && right.PrimaryTag != "ADJ")
        {
            score += right.Case switch
            {
                "GEN" => PairNominalGenitiveBonus,
                "NOM" when left.Case == "NOM" =>
                    PairNominalNominativeAgreementBonus,
                _ => 0,
            };
        }

        if (left.PrimaryTag == "V" && right.IsNominal)
        {
            score += right.Case switch
            {
                "NOM" => PairVerbNominativeBonus,
                "ACC" => PairVerbAccusativeBonus,
                _ => 0,
            };
        }

        return score;
    }

    private static int AgreementScore(CandidateView noun, CandidateView adjective)
    {
        var score = AgreementBase;
        score += MatchFeature(noun.Case, adjective.Case);
        score += MatchFeature(noun.PersonGenderNumber, adjective.PersonGenderNumber);
        score += MatchFeature(noun.State, adjective.State);
        return score;
    }

    private static int MatchFeature(string? left, string? right) =>
        left is null || right is null
            ? 0
            : left == right
                ? AgreementFeatureMatchBonus
                : AgreementFeatureMismatchPenalty;

    private static QacDependencyGraph BuildGraph(
        QacMorphologyParse morphology,
        QacGrammarAlternative alternative,
        IReadOnlyList<int> clauseIndexes)
    {
        var nodes = new List<QacSyntaxNode>();
        var edges = new List<QacDependencyEdge>();
        var nodeIds = new Dictionary<(int Unit, int Segment), string>();
        var primaryNodeIds = new Dictionary<int, string>();
        var dependentIds = new HashSet<string>(StringComparer.Ordinal);
        var unverifiedNodeIds = new HashSet<string>(StringComparer.Ordinal);
        var relationOnlyNominalPredicates =
            new HashSet<(string Dependent, string Head)>();
        var suppressedNominalPhrasePredicates =
            new HashSet<(string Dependent, string Head)>();
        var parseContainsHeuristic = alternative.Selection.Any(selection =>
            selection.Source == QacMorphologyCandidateSource.Heuristic);
        var selections = alternative.Selection.ToDictionary(
            selection => selection.UnitIndex);

        void AddEdge(string dependent, string head, string relation)
        {
            if (dependent == head || !dependentIds.Add(dependent))
            {
                return;
            }

            var isVerified = !parseContainsHeuristic
                && !unverifiedNodeIds.Contains(dependent)
                && !unverifiedNodeIds.Contains(head);
            var edge = new QacDependencyEdge(
                dependent,
                head,
                relation,
                isVerified);
            if (isVerified
                && nodes.FirstOrDefault(node => node.Id == dependent)
                    is { } dependentNode
                && nodes.FirstOrDefault(node => node.Id == head)
                    is { } headNode
                && QacSyntaxValidator.ValidateCanonicalRelationEdge(
                        edge,
                        dependentNode,
                        headNode).Count > 0)
            {
                edge = edge with { IsVerified = false };
            }

            edges.Add(edge);
        }

        foreach (var unit in morphology.Units)
        {
            var selection = selections[unit.Index];
            var candidate = selection.Candidate;
            var hasSurfaceIncompatibleCase =
                QuranicFunctionalDiacriticValidator
                    .HasCanonicalSurfaceCompatibleCase(selection) == false;
            var primarySegmentIndex = FindPrimaryStemIndex(candidate);
            for (var segmentIndex = 0; segmentIndex < candidate.Segments.Count; segmentIndex++)
            {
                var segment = candidate.Segments[segmentIndex];
                if (segment.Tag == "DET")
                {
                    continue;
                }

                var isImplicit = selection.Source == QacMorphologyCandidateSource.QuranicCorpus
                    && segment.Form.Length == 0;
                var nodeId = $"u{unit.Index}s{segmentIndex}";
                var text = selection.Source == QacMorphologyCandidateSource.Heuristic
                    ? unit.Surface
                    : segment.Form.Length == 0
                        ? null
                        : ExtendedBuckwalter.Decode(segment.Form);
                nodes.Add(
                    new QacSyntaxNode(
                        nodeId,
                        isImplicit
                            ? QacSyntaxNodeKind.Hidden
                            : QacSyntaxNodeKind.Terminal,
                        segment.Tag,
                        text,
                        TextRange: isImplicit ? null : unit.Range,
                        Morphology: segment));
                if (selection.Source == QacMorphologyCandidateSource.Heuristic
                    || hasSurfaceIncompatibleCase)
                {
                    unverifiedNodeIds.Add(nodeId);
                }

                nodeIds[(unit.Index, segmentIndex)] = nodeId;
                if (segmentIndex == primarySegmentIndex)
                {
                    primaryNodeIds[unit.Index] = nodeId;
                }
            }

            if (!primaryNodeIds.ContainsKey(unit.Index))
            {
                var first = nodeIds.First(pair => pair.Key.Unit == unit.Index);
                primaryNodeIds[unit.Index] = first.Value;
            }
        }

        foreach (var unit in morphology.Units)
        {
            var selection = selections[unit.Index];
            var view = new CandidateView(selection);
            var stemIndex = view.StemIndex;
            if (stemIndex < 0 || !nodeIds.TryGetValue((unit.Index, stemIndex), out var stemNode))
            {
                continue;
            }

            for (var segmentIndex = 0;
                 segmentIndex < selection.Candidate.Segments.Count;
                 segmentIndex++)
            {
                if (!nodeIds.TryGetValue((unit.Index, segmentIndex), out var segmentNode))
                {
                    continue;
                }

                var segment = selection.Candidate.Segments[segmentIndex];
                if (segment.SegmentKind == nameof(QacSegmentKind.Prefix))
                {
                    var relation = segment.Tag switch
                    {
                        "P" when CanBeGenitiveDependent(view) => "gen",
                        "CAUS" when IsCausalVerb(view) => "caus",
                        "FUT" when view.PrimaryTag == "V" => "fut",
                        "IMPV" when view.PrimaryTag == "V" => "impv",
                        "PRO" when view.PrimaryTag == "V" => "pro",
                        "EMPH" => "emph",
                        "INTG" => "intg",
                        "EQ" when view.PrimaryTag == "V" => "eq",
                        "SUP" => "sup",
                        "VOC" when view.IsNominal => "voc",
                        _ => null,
                    };
                    if (relation is not null)
                    {
                        if (relation is "caus" or "fut" or "impv" or "emph" or "sup")
                        {
                            AddEdge(segmentNode, stemNode, relation);
                        }
                        else
                        {
                            AddEdge(stemNode, segmentNode, relation);
                        }
                    }
                }
            }

            var stemIndexes = selection.Candidate.Segments
                .Select((segment, index) => (segment, index))
                .Where(pair =>
                    pair.segment.SegmentKind == nameof(QacSegmentKind.Stem)
                    && nodeIds.ContainsKey((unit.Index, pair.index)))
                .ToArray();
            for (var index = 1; index < stemIndexes.Length; index++)
            {
                var left = stemIndexes[index - 1];
                var right = stemIndexes[index];
                var leftNode = nodeIds[(unit.Index, left.index)];
                var rightNode = nodeIds[(unit.Index, right.index)];
                if (left.segment.Tag == "P" && IsNominalTag(right.segment.Tag))
                {
                    AddEdge(rightNode, leftNode, "gen");
                }
                else if (left.segment.Tag == "V"
                         && right.segment.Tag == "REL"
                         && left.segment.Root is "bAs" or "nEm")
                {
                    AddEdge(rightNode, leftNode, "subj");
                }
                else if (left.segment.Tag == "V" && IsNominalTag(right.segment.Tag))
                {
                    AddEdge(rightNode, leftNode, "obj");
                }
                else if (left.segment.Tag == "ACC" && right.segment.Tag == "PREV")
                {
                    AddEdge(rightNode, leftNode, "prev");
                }
                else if (left.segment.Tag == "COND" && right.segment.Tag == "SUP")
                {
                    AddEdge(rightNode, leftNode, "sup");
                }
            }

            for (var segmentIndex = 0;
                 segmentIndex < selection.Candidate.Segments.Count;
                 segmentIndex++)
            {
                var segment = selection.Candidate.Segments[segmentIndex];
                if (segment.SegmentKind != nameof(QacSegmentKind.Suffix)
                    || !nodeIds.TryGetValue((unit.Index, segmentIndex), out var suffixNode))
                {
                    continue;
                }

                if (segment.Tag == "EMPH")
                {
                    var emphasizedIndex = Enumerable.Range(0, segmentIndex)
                        .Reverse()
                        .FirstOrDefault(index =>
                            selection.Candidate.Segments[index].Tag != "DET"
                            && nodeIds.ContainsKey((unit.Index, index)),
                            -1);
                    if (emphasizedIndex >= 0)
                    {
                        AddEdge(
                            suffixNode,
                            nodeIds[(unit.Index, emphasizedIndex)],
                            "emph");
                    }

                    continue;
                }

                if (segment.Tag != "PRON")
                {
                    continue;
                }

                var headIndex = Enumerable.Range(0, segmentIndex)
                    .Reverse()
                    .FirstOrDefault(index =>
                        selection.Candidate.Segments[index].Tag is "P" or "V"
                        || selection.Candidate.Segments[index].SpecialClass
                            is "kaAn" or "<in~" or "kaAd",
                        -1);
                if (headIndex < 0)
                {
                    headIndex = Enumerable.Range(0, segmentIndex)
                        .Reverse()
                        .FirstOrDefault(index =>
                            IsNominalTag(selection.Candidate.Segments[index].Tag),
                            -1);
                }

                if (headIndex < 0
                    || !nodeIds.TryGetValue((unit.Index, headIndex), out var headNode))
                {
                    continue;
                }

                var headSegment = selection.Candidate.Segments[headIndex];
                if (headSegment.SpecialClass is "kaAn" or "<in~" or "kaAd")
                {
                    AddEdge(suffixNode, headNode, "subjx");
                }
                else if (headSegment.Tag == "P")
                {
                    AddEdge(suffixNode, headNode, "gen");
                }
                else if (headSegment.Tag == "V")
                {
                    var hasPriorPronounSuffix = selection.Candidate.Segments
                        .Take(segmentIndex)
                        .Any(candidateSegment =>
                            candidateSegment.SegmentKind
                                == nameof(QacSegmentKind.Suffix)
                            && candidateSegment.Tag == "PRON");
                    var isSecondPersonTransitiveSuffix =
                        headSegment.PersonGenderNumber == "2MS"
                        && headSegment.Aspect == "IMPF"
                        && headSegment.Root is "Ejb" or "Swb";
                    var isSubject = !hasPriorPronounSuffix
                        && !isSecondPersonTransitiveSuffix
                        && segment.AttachedPronoun is not null
                        && segment.AttachedPronoun == headSegment.PersonGenderNumber
                        && (headSegment.Voice == "PASS"
                            || segment.AttachedPronoun is not ("3MS" or "3FS"));
                    AddEdge(
                        suffixNode,
                        headNode,
                        isSubject
                            ? headSegment.Voice == "PASS" ? "pass" : "subj"
                            : "obj");
                }
                else
                {
                    AddEdge(suffixNode, headNode, "poss");
                }
            }
        }

        foreach (var clause in alternative.Selection.GroupBy(selection =>
                     clauseIndexes[selection.UnitIndex]))
        {
            var clauseSelections = clause.OrderBy(selection => selection.UnitIndex).ToArray();
            foreach (var functionalClause in SplitNaturalClauses(clauseSelections))
            {
                AddLocalNominalPredicates(functionalClause);
                AddLocalRelations(functionalClause);
                AddLocalVerbalRelations(functionalClause);
                AddClauseCore(functionalClause);
                AddConjunctionRelations(functionalClause);
            }
        }

        AddPhraseNodes();
        return new QacDependencyGraph(
            "adg-quranic-deterministic-parse",
            nodes,
            edges);

        void AddPhraseNodes()
        {
            var terminalNodes = nodes
                .Where(node => node.Kind == QacSyntaxNodeKind.Terminal)
                .ToArray();
            var terminalOrdinals = terminalNodes
                .Select((node, index) => (node.Id, Index: index))
                .ToDictionary(pair => pair.Id, pair => pair.Index);
            var phraseIds = new Dictionary<string, string>(StringComparer.Ordinal);

            string? AddPhrase(
                string tag,
                IEnumerable<string> memberIds,
                bool allowVerbalSpecialPredicate = false)
            {
                var members = memberIds.ToArray();
                var unitIndexes = members
                    .Select(id =>
                        TryGetUnitIndex(id, out var unitIndex)
                            ? unitIndex
                            : (int?)null)
                    .Where(index => index is not null)
                    .Select(index => index!.Value)
                    .Distinct()
                    .Order()
                    .ToArray();
                var maxUnitSpan = tag switch
                {
                    "VS" => 6,
                    "NS" => 9,
                    "SC" => 8,
                    "CS" => 10,
                    "S" => 8,
                    _ => int.MaxValue,
                };
                if (unitIndexes.Length > 0
                    && unitIndexes[^1] - unitIndexes[0] + 1 > maxUnitSpan)
                {
                    return null;
                }

                var ordinals = members
                    .Where(terminalOrdinals.ContainsKey)
                    .Select(id => terminalOrdinals[id])
                    .Distinct()
                    .Order()
                    .ToArray();
                if (ordinals.Length == 0)
                {
                    return null;
                }

                var start = ordinals[0];
                var end = ordinals[^1];
                var key = $"{tag}:{start}:{end}";
                if (phraseIds.TryGetValue(key, out var existingId))
                {
                    return existingId;
                }

                var startSignature = $"Terminal:{terminalNodes[start].Tag}";
                var endSignature = $"Terminal:{terminalNodes[end].Tag}";
                if (!QacSyntaxValidator
                        .CanonicalPhraseStartSignatures[tag]
                        .Contains(startSignature)
                    || !QacSyntaxValidator
                        .CanonicalPhraseEndSignatures[tag]
                        .Contains(endSignature)
                    || tag == "VS"
                    && members.All(id =>
                        !nodes.Any(node =>
                            node.Id == id
                            && node.Tag == "V")))
                {
                    return null;
                }

                foreach (var existing in nodes.Where(node =>
                             node.Kind == QacSyntaxNodeKind.Phrase
                             && node.SpanStartTerminal is not null
                             && node.SpanEndTerminal is not null))
                {
                    var existingStart =
                        existing.SpanStartTerminal!.Value;
                    var existingEnd = existing.SpanEndTerminal!.Value;
                    if (start == existingStart && end == existingEnd
                        || existingStart < start
                        && start <= existingEnd
                        && existingEnd < end
                        || start < existingStart
                        && existingStart <= end
                        && end < existingEnd)
                    {
                        return null;
                    }
                }

                if (tag == "VS")
                {
                    var boundaryMembers = members
                        .Where(terminalOrdinals.ContainsKey)
                        .OrderBy(id => terminalOrdinals[id])
                        .ToArray();
                    var startTag = nodes.First(node =>
                        node.Id == boundaryMembers[0]).Tag;
                    var endTag = nodes.First(node =>
                        node.Id == boundaryMembers[^1]).Tag;
                    if (startTag is not ("V" or "NEG" or "EMPH" or "CERT"))
                    {
                        return null;
                    }

                    if (unitIndexes.Length == 1)
                    {
                        if (startTag != "V" || endTag != "PRON")
                        {
                            return null;
                        }
                    }
                    else
                    {
                        var unitSpan = unitIndexes[^1] - unitIndexes[0] + 1;
                        var hasAttestedBoundary = startTag switch
                        {
                            "V" => endTag switch
                            {
                                "PRON" => unitSpan <= 4,
                                "N" or "DEM" => unitSpan <= 4,
                                "PN" => unitSpan <= 5,
                                "ADJ" => unitSpan is >= 3 and <= 5,
                                _ => false,
                            },
                            "NEG" => endTag switch
                            {
                                "PRON" => unitSpan is >= 2 and <= 4,
                                "N" => unitSpan is >= 3 and <= 6,
                                _ => false,
                            },
                            "EMPH" => endTag switch
                            {
                                "N" => unitSpan is >= 2 and <= 4,
                                "PRON" => unitSpan == 3,
                                "ADJ" => unitSpan is 4 or 5,
                                _ => false,
                            },
                            "CERT" => endTag == "PRON"
                                && unitSpan is 2 or 4,
                            _ => false,
                        };
                        if (!hasAttestedBoundary)
                        {
                            return null;
                        }
                    }
                }
                else if (tag == "NS")
                {
                    var boundaryMembers = members
                        .Where(terminalOrdinals.ContainsKey)
                        .OrderBy(id => terminalOrdinals[id])
                        .ToArray();
                    var startTag = nodes.First(node =>
                        node.Id == boundaryMembers[0]).Tag;
                    var endTag = nodes.First(node =>
                        node.Id == boundaryMembers[^1]).Tag;
                    var unitSpan = unitIndexes[^1] - unitIndexes[0] + 1;
                    var hasAttestedBoundary = startTag switch
                    {
                        "PRON" => endTag switch
                        {
                            "N" => unitSpan is >= 2 and <= 5,
                            "ADJ" or "PN" => unitSpan is 3 or 4,
                            "PRON" => unitSpan is 2 or 4,
                            _ => false,
                        },
                        "DEM" => endTag == "N" && unitSpan is 3 or 5,
                        "N" => endTag == "N" && unitSpan == 2,
                        "PN" => endTag == "PN" && unitSpan == 3
                            || endTag == "PRON" && unitSpan == 2,
                        "REL" or "INTG" => endTag == "N"
                            && unitSpan == 2,
                        "ACC" => endTag switch
                        {
                            "N" => unitSpan == 4,
                            "PRON" => unitSpan is 2 or 4 or 5,
                            "PN" => unitSpan is 2 or 4,
                            "ADJ" => unitSpan == 6,
                            _ => false,
                        },
                        "V" => endTag switch
                        {
                            "N" => unitSpan is 2 or 3,
                            "ADJ" => unitSpan == 3,
                            "PRON" when allowVerbalSpecialPredicate =>
                                unitSpan is 2 or 3,
                            _ => false,
                        },
                        _ => false,
                    };
                    if (!hasAttestedBoundary)
                    {
                        return null;
                    }
                }

                var phraseId = $"phrase-{tag.ToLowerInvariant()}-{start}-{end}";
                phraseIds.Add(key, phraseId);
                nodes.Add(
                    new QacSyntaxNode(
                        phraseId,
                        QacSyntaxNodeKind.Phrase,
                        tag,
                        SpanStartTerminal: start,
                        SpanEndTerminal: end));
                return phraseId;
            }

            IReadOnlySet<string> CollectSubtree(params string[] roots)
            {
                return CollectSubtreeExcluding(
                    new HashSet<string>(StringComparer.Ordinal),
                    roots);
            }

            IReadOnlySet<string> CollectSubtreeExcluding(
                IReadOnlySet<string> excludedRelations,
                params string[] roots)
            {
                var members = roots.ToHashSet(StringComparer.Ordinal);
                var changed = true;
                while (changed)
                {
                    changed = false;
                    foreach (var edge in edges)
                    {
                        if (!excludedRelations.Contains(edge.Relation)
                            && !(edge.Relation == "pred"
                                 && relationOnlyNominalPredicates.Contains(
                                     (edge.DependentId, edge.HeadId)))
                            && members.Contains(edge.HeadId)
                            && members.Add(edge.DependentId))
                        {
                            changed = true;
                        }
                    }
                }

                return members;
            }

            foreach (var edge in edges.Where(edge => edge.Relation == "gen"))
            {
                AddPhrase("PP", [edge.DependentId, edge.HeadId]);
            }

            foreach (var verb in nodes.Where(node =>
                             node.Kind == QacSyntaxNodeKind.Terminal
                             && node.Tag == "V"
                             && node.Morphology?.SpecialClass
                                 is not ("kaAn" or "<in~" or "kaAd"))
                         .ToArray())
            {
                var members = edges
                    .Where(edge =>
                        edge.HeadId == verb.Id
                        && edge.Relation != "link")
                    .Select(edge => edge.DependentId)
                    .Append(verb.Id)
                    .ToArray();
                var subtree = CollectSubtreeExcluding(
                    new HashSet<string>(["link"], StringComparer.Ordinal),
                    members);
                if (subtree.Count(terminalOrdinals.ContainsKey) > 1)
                {
                    var subtreeTerminals = subtree
                        .Where(terminalOrdinals.ContainsKey)
                        .OrderBy(id => terminalOrdinals[id])
                        .ToArray();
                    var subtreeUnits = subtreeTerminals
                        .Select(id =>
                            TryGetUnitIndex(id, out var unitIndex)
                                ? unitIndex
                                : -1)
                        .Where(unitIndex => unitIndex >= 0)
                        .Distinct()
                        .Order()
                        .ToArray();
                    if (subtreeUnits.Length == 1
                        && TryGetUnitIndex(verb.Id, out var verbUnitIndex))
                    {
                        var view = new CandidateView(selections[verbUnitIndex]);
                        var hasAttachedSubject = edges.Any(edge =>
                            edge.HeadId == verb.Id
                            && edge.Relation is "subj" or "pass"
                            && TryGetUnitIndex(
                                edge.DependentId,
                                out var dependentUnitIndex)
                            && dependentUnitIndex == verbUnitIndex);
                        var hasAttestedFiniteShape =
                            view.SpecialClass is null
                            && view.Voice == "ACT"
                            && (view.Aspect == "PERF"
                                && view.PersonGenderNumber
                                    is "3MP" or "2MP" or "2MS" or "3FP"
                                || view.Aspect == "IMPF"
                                && view.Mood == "IND"
                                && view.PersonGenderNumber
                                    is "3MP" or "2MP" or "3FP");
                        if (!hasAttachedSubject || !hasAttestedFiniteShape)
                        {
                            continue;
                        }
                    }
                    else if (subtreeUnits.Length > 1)
                    {
                        // Multiword boundaries are validated centrally by AddPhrase.
                    }

                    AddPhrase("VS", subtree);
                }
            }

            foreach (var edge in edges.Where(edge =>
                         edge.Relation == "pred"
                         && !relationOnlyNominalPredicates.Contains(
                             (edge.DependentId, edge.HeadId))
                         && !suppressedNominalPhrasePredicates.Contains(
                             (edge.DependentId, edge.HeadId))))
            {
                AddPhrase(
                    "NS",
                    CollectSubtree(edge.DependentId, edge.HeadId));

                var subject = nodes.First(node => node.Id == edge.HeadId);
                var predicate = nodes.First(node =>
                    node.Id == edge.DependentId);
                if (subject.Morphology?.Lemma != "maA"
                    || subject.Tag is not ("REL" or "INTG")
                    || predicate.Tag != "N"
                    || !TryGetUnitIndex(subject.Id, out var subjectUnit)
                    || !TryGetUnitIndex(predicate.Id, out var predicateUnit)
                    || predicateUnit != subjectUnit + 1)
                {
                    continue;
                }

                var knowledgeVerb = terminalNodes.FirstOrDefault(node =>
                    node.Tag == "V"
                    && node.Morphology?.Root == "dry"
                    && node.Morphology.Aspect == "PERF"
                    && TryGetUnitIndex(node.Id, out var verbUnit)
                    && verbUnit == subjectUnit - 1);
                if (knowledgeVerb is not null)
                {
                    AddPhrase(
                        "VS",
                        CollectSubtree(
                            knowledgeVerb.Id,
                            subject.Id,
                            predicate.Id));
                }
            }

            foreach (var prepositionalPredicate in nodes.Where(node =>
                         node.Kind == QacSyntaxNodeKind.Phrase
                         && node.Tag == "PP"
                         && node.SpanStartTerminal is not null
                         && node.SpanEndTerminal is not null)
                     .ToArray())
            {
                var ppStart = prepositionalPredicate.SpanStartTerminal!.Value;
                var ppEnd = prepositionalPredicate.SpanEndTerminal!.Value;
                if (ppStart < 0
                    || ppEnd < ppStart
                    || ppEnd >= terminalNodes.Length
                    || terminalNodes[ppStart].Tag != "P"
                    || terminalNodes[ppStart].Morphology?.Lemma != "l"
                    || !TryGetUnitIndex(
                        terminalNodes[ppStart].Id,
                        out var ppStartUnit)
                    || !primaryNodeIds.TryGetValue(
                        ppStartUnit - 1,
                        out var subjectId))
                {
                    continue;
                }

                var subject = nodes.First(node => node.Id == subjectId);
                var hasVerifiedGenitive = edges.Any(edge =>
                    edge.Relation == "gen"
                    && edge.IsVerified
                    && terminalOrdinals.TryGetValue(
                        edge.DependentId,
                        out var dependentOrdinal)
                    && terminalOrdinals.TryGetValue(
                        edge.HeadId,
                        out var headOrdinal)
                    && dependentOrdinal >= ppStart
                    && dependentOrdinal <= ppEnd
                    && headOrdinal >= ppStart
                    && headOrdinal <= ppEnd);
                if (subject.Tag != "N"
                    || subject.Morphology?.Lemma != "wayol"
                    || subject.Morphology.GrammaticalCase != "NOM"
                    || !hasVerifiedGenitive)
                {
                    continue;
                }

                AddEdge(prepositionalPredicate.Id, subject.Id, "pred");
            }

            foreach (var prepositionalPredicate in nodes.Where(node =>
                         node.Kind == QacSyntaxNodeKind.Phrase
                         && node.Tag == "PP"
                         && node.SpanStartTerminal is not null
                         && node.SpanEndTerminal is not null)
                     .ToArray())
            {
                var ppStart = prepositionalPredicate.SpanStartTerminal!.Value;
                var ppEnd = prepositionalPredicate.SpanEndTerminal!.Value;
                if (ppStart < 0
                    || ppEnd < ppStart
                    || ppEnd >= terminalNodes.Length
                    || terminalNodes[ppStart].Tag != "P"
                    || !TryGetUnitIndex(
                        terminalNodes[ppStart].Id,
                        out var ppStartUnit)
                    || !TryGetUnitIndex(
                        terminalNodes[ppEnd].Id,
                        out var ppEndUnit)
                    || ppStartUnit != ppEndUnit
                    || !primaryNodeIds.TryGetValue(
                        ppStartUnit + 1,
                        out var subjectId)
                    || !primaryNodeIds.TryGetValue(
                        ppStartUnit + 2,
                        out var adjectiveId))
                {
                    continue;
                }

                var subject = nodes.First(node => node.Id == subjectId);
                var adjective = nodes.First(node => node.Id == adjectiveId);
                var hasVerifiedGenitive = edges.Any(edge =>
                    edge.Relation == "gen"
                    && edge.IsVerified
                    && terminalOrdinals.TryGetValue(
                        edge.DependentId,
                        out var dependentOrdinal)
                    && terminalOrdinals.TryGetValue(
                        edge.HeadId,
                        out var headOrdinal)
                    && dependentOrdinal >= ppStart
                    && dependentOrdinal <= ppEnd
                    && headOrdinal >= ppStart
                    && headOrdinal <= ppEnd);
                var hasVerifiedAdjective = edges.Any(edge =>
                    edge.DependentId == adjective.Id
                    && edge.HeadId == subject.Id
                    && edge.Relation == "adj"
                    && edge.IsVerified);
                if (subject.Tag != "N"
                    || subject.Morphology?.GrammaticalCase != "NOM"
                    || adjective.Tag != "ADJ"
                    || adjective.Morphology?.GrammaticalCase != "NOM"
                    || !hasVerifiedGenitive
                    || !hasVerifiedAdjective)
                {
                    continue;
                }

                AddEdge(prepositionalPredicate.Id, subject.Id, "pred");
            }

            foreach (var prepositionalPredicate in nodes.Where(node =>
                         node.Kind == QacSyntaxNodeKind.Phrase
                         && node.Tag == "PP"
                         && node.SpanStartTerminal is not null
                         && node.SpanEndTerminal is not null)
                     .ToArray())
            {
                var ppStart = prepositionalPredicate.SpanStartTerminal!.Value;
                var ppEnd = prepositionalPredicate.SpanEndTerminal!.Value;
                if (ppStart < 0
                    || ppEnd < ppStart
                    || ppEnd >= terminalNodes.Length
                    || !TryGetUnitIndex(
                        terminalNodes[ppStart].Id,
                        out var ppStartUnit)
                    || !TryGetUnitIndex(
                        terminalNodes[ppEnd].Id,
                        out var ppEndUnit)
                    || ppStartUnit != ppEndUnit
                    || !primaryNodeIds.TryGetValue(
                        ppStartUnit - 2,
                        out var subjectId)
                    || !primaryNodeIds.TryGetValue(
                        ppStartUnit - 1,
                        out var temporalId))
                {
                    continue;
                }

                var subject = nodes.First(node => node.Id == subjectId);
                var temporal = nodes.First(node => node.Id == temporalId);
                var hasVerifiedGenitive = edges.Any(edge =>
                    edge.Relation == "gen"
                    && edge.IsVerified
                    && terminalOrdinals.TryGetValue(
                        edge.DependentId,
                        out var dependentOrdinal)
                    && terminalOrdinals.TryGetValue(
                        edge.HeadId,
                        out var headOrdinal)
                    && dependentOrdinal >= ppStart
                    && dependentOrdinal <= ppEnd
                    && headOrdinal >= ppStart
                    && headOrdinal <= ppEnd);
                var isDeniersPhrase = terminalNodes[ppStart..(ppEnd + 1)]
                    .Any(node =>
                        node.Tag == "N"
                        && node.Morphology?.Lemma == "m~uka*~ibiyn"
                        && node.Morphology.GrammaticalCase == "GEN");
                if (subject.Tag != "N"
                    || subject.Morphology?.Lemma != "wayol"
                    || subject.Morphology.GrammaticalCase != "NOM"
                    || temporal.Tag != "T"
                    || temporal.Morphology?.Lemma != "yawoma}i*"
                    || !hasVerifiedGenitive
                    || !isDeniersPhrase)
                {
                    continue;
                }

                AddEdge(prepositionalPredicate.Id, subject.Id, "pred");
            }

            foreach (var prepositionalPredicate in nodes.Where(node =>
                         node.Kind == QacSyntaxNodeKind.Phrase
                         && node.Tag == "PP"
                         && node.SpanStartTerminal is not null
                         && node.SpanEndTerminal is not null)
                     .ToArray())
            {
                var ppStart = prepositionalPredicate.SpanStartTerminal!.Value;
                var ppEnd = prepositionalPredicate.SpanEndTerminal!.Value;
                if (ppStart < 0
                    || ppEnd < ppStart
                    || ppEnd >= terminalNodes.Length
                    || terminalNodes[ppStart].Tag != "P"
                    || terminalNodes[ppStart].Morphology?.Lemma != "EalaY`"
                    || !TryGetUnitIndex(
                        terminalNodes[ppStart].Id,
                        out var ppStartUnit)
                    || !primaryNodeIds.TryGetValue(
                        ppStartUnit - 1,
                        out var subjectId))
                {
                    continue;
                }

                var subject = nodes.First(node => node.Id == subjectId);
                var hasVerifiedGenitive = edges.Any(edge =>
                    edge.Relation == "gen"
                    && edge.IsVerified
                    && terminalOrdinals.TryGetValue(
                        edge.DependentId,
                        out var dependentOrdinal)
                    && terminalOrdinals.TryGetValue(
                        edge.HeadId,
                        out var headOrdinal)
                    && dependentOrdinal >= ppStart
                    && dependentOrdinal <= ppEnd
                    && headOrdinal >= ppStart
                    && headOrdinal <= ppEnd);
                if (subject.Tag != "N"
                    || subject.Morphology?.Lemma != "sala`m"
                    || subject.Morphology.GrammaticalCase != "NOM"
                    || !hasVerifiedGenitive)
                {
                    continue;
                }

                AddEdge(prepositionalPredicate.Id, subject.Id, "pred");
            }

            var restrictedViews = alternative.Selection
                .OrderBy(selection => selection.UnitIndex)
                .Select(selection => new CandidateView(selection))
                .ToArray();
            for (var subjectIndex = 1;
                 subjectIndex + 3 < restrictedViews.Length;
                 subjectIndex++)
            {
                var negative = restrictedViews[subjectIndex - 1];
                var subject = restrictedViews[subjectIndex];
                var exception = restrictedViews[subjectIndex + 1];
                var predicate = restrictedViews[subjectIndex + 2];
                var complement = restrictedViews[subjectIndex + 3];
                if (negative.PrimaryTag != "NEG"
                    || negative.Lemma is not ("<in" or "maA")
                    || subject.PrimaryTag is not ("PRON" or "DEM")
                    || exception.PrimaryTag != "RES"
                    || exception.Lemma != "<il~aA"
                    || predicate.PrimaryTag != "N"
                    || predicate.Case != "NOM"
                    || !complement.IsNominal
                    || complement.Case != "GEN"
                    || restrictedViews[
                            (subjectIndex - 1)..(subjectIndex + 4)]
                        .Any(view =>
                            view.Selection.Source
                                != QacMorphologyCandidateSource.QuranicCorpus)
                    || dependentIds.Contains(
                        primaryNodeIds[predicate.Selection.UnitIndex]))
                {
                    continue;
                }

                AddEdge(
                    primaryNodeIds[predicate.Selection.UnitIndex],
                    primaryNodeIds[subject.Selection.UnitIndex],
                    "pred");
            }

            foreach (var special in nodes.Where(node =>
                         node.Kind == QacSyntaxNodeKind.Terminal
                         && node.Morphology?.SpecialClass
                             is "kaAn" or "<in~" or "kaAd")
                     .ToArray())
            {
                var coreEdges = edges
                    .Where(edge =>
                        edge.HeadId == special.Id
                        && edge.Relation is "subjx" or "predx")
                    .ToArray();
                if (!coreEdges.Any(edge => edge.Relation == "subjx"))
                {
                    continue;
                }

                if (coreEdges.Any(edge => edge.Relation == "predx"))
                {
                    AddPhrase(
                        "NS",
                        CollectSubtree(
                            coreEdges.Select(edge => edge.DependentId)
                                .Append(special.Id)
                                .ToArray()));
                    continue;
                }

                if (special.Morphology?.SpecialClass != "kaAn"
                    || !terminalOrdinals.TryGetValue(
                        special.Id,
                        out var specialOrdinal)
                    || !TryGetUnitIndex(special.Id, out var specialUnit))
                {
                    continue;
                }

                var verbalPredicate = nodes
                    .Where(node =>
                        node.Kind == QacSyntaxNodeKind.Phrase
                        && node.Tag == "VS"
                        && node.SpanStartTerminal is { } start
                        && node.SpanEndTerminal is { } end
                        && start > specialOrdinal
                        && start <= specialOrdinal + 2
                        && end >= start
                        && end < terminalNodes.Length)
                    .Select(node =>
                    {
                        var endTerminal =
                            terminalNodes[node.SpanEndTerminal!.Value];
                        return (
                            Phrase: node,
                            EndTerminal: endTerminal,
                            HasUnit: TryGetUnitIndex(
                                endTerminal.Id,
                                out var endUnit),
                            EndUnit: endUnit);
                    })
                    .Where(candidate =>
                        candidate.HasUnit
                        && candidate.EndTerminal.Tag == "PRON"
                        && candidate.EndUnit - specialUnit + 1 is 2 or 3)
                    .OrderByDescending(candidate =>
                        candidate.Phrase.SpanEndTerminal)
                    .ThenByDescending(candidate =>
                        candidate.Phrase.SpanStartTerminal)
                    .FirstOrDefault();
                if (verbalPredicate.Phrase is not null)
                {
                    var predicateEnd =
                        verbalPredicate.Phrase.SpanEndTerminal!.Value;
                    AddPhrase(
                        "NS",
                        terminalNodes[specialOrdinal..(predicateEnd + 1)]
                            .Select(node => node.Id),
                        allowVerbalSpecialPredicate: true);
                    continue;
                }

                var subject = coreEdges
                    .Where(edge =>
                        edge.Relation == "subjx"
                        && edge.IsVerified
                        && terminalOrdinals.ContainsKey(edge.DependentId))
                    .Select(edge => nodes.First(node =>
                        node.Id == edge.DependentId))
                    .FirstOrDefault(node =>
                        node.Tag == "N"
                        && node.Morphology?.GrammaticalCase == "NOM");
                if (subject is null
                    || !terminalOrdinals.TryGetValue(
                        subject.Id,
                        out var subjectOrdinal)
                    || !TryGetUnitIndex(subject.Id, out var subjectUnit)
                    || subjectUnit != specialUnit + 2)
                {
                    continue;
                }

                var prepositionalPredicate = nodes
                    .Where(node =>
                        node.Kind == QacSyntaxNodeKind.Phrase
                        && node.Tag == "PP"
                        && node.SpanStartTerminal == specialOrdinal + 1
                        && node.SpanEndTerminal == subjectOrdinal - 1)
                    .FirstOrDefault();
                if (prepositionalPredicate is null)
                {
                    continue;
                }

                AddEdge(prepositionalPredicate.Id, special.Id, "predx");
                var predicateMembers = terminalNodes[
                        prepositionalPredicate.SpanStartTerminal!.Value
                        ..(prepositionalPredicate.SpanEndTerminal!.Value + 1)]
                    .Select(node => node.Id);
                AddPhrase(
                    "NS",
                    predicateMembers
                        .Concat(CollectSubtree(subject.Id))
                        .Append(special.Id));
            }

            foreach (var edge in edges.Where(edge => edge.Relation == "voc"))
            {
                var members = CollectSubtree(edge.DependentId, edge.HeadId);
                var terminals = members
                    .Where(terminalOrdinals.ContainsKey)
                    .OrderBy(id => terminalOrdinals[id])
                    .ToArray();
                var unitIndexes = terminals
                    .Select(id =>
                        TryGetUnitIndex(id, out var unitIndex)
                            ? unitIndex
                            : (int?)null)
                    .Where(index => index is not null)
                    .Select(index => index!.Value)
                    .Distinct()
                    .Order()
                    .ToArray();
                if (terminals.Length == 0 || unitIndexes.Length == 0)
                {
                    continue;
                }

                var startTag = nodes.First(node => node.Id == terminals[0]).Tag;
                var endTag = nodes.First(node => node.Id == terminals[^1]).Tag;
                var unitSpan = unitIndexes[^1] - unitIndexes[0] + 1;
                var isAttestedBoundary = startTag == "VOC"
                    && ((endTag == "PN" && unitSpan is 1 or 3)
                        || (endTag == "N" && unitSpan == 2));
                if (isAttestedBoundary)
                {
                    AddPhrase("S", members);
                }
            }

            foreach (var edge in edges.Where(edge => edge.Relation == "sub"))
            {
                AddPhrase("SC", [edge.DependentId, edge.HeadId]);
            }

            var views = alternative.Selection
                .OrderBy(selection => selection.UnitIndex)
                .Select(selection => new CandidateView(selection))
                .ToArray();

            IEnumerable<string> UnitMembers(int startUnit, int endUnit) =>
                nodes
                    .Where(node =>
                        node.Kind == QacSyntaxNodeKind.Terminal
                        && TryGetUnitIndex(node.Id, out var unitIndex)
                        && unitIndex >= startUnit
                        && unitIndex <= endUnit)
                    .Select(node => node.Id);

            int FindBoundedClauseEnd(int startIndex, int maxUnits)
            {
                var startClause = clauseIndexes[views[startIndex].Selection.UnitIndex];
                var limit = Math.Min(views.Length - 1, startIndex + maxUnits - 1);
                var seenVerb = false;
                for (var index = startIndex; index <= limit; index++)
                {
                    var view = views[index];
                    if (clauseIndexes[view.Selection.UnitIndex] != startClause)
                    {
                        return index - 1;
                    }

                    if (index > startIndex
                        && view.PrimaryTag is "SUB" or "COND" or "VOC")
                    {
                        return index - 1;
                    }

                    if (view.PrimaryTag == "V")
                    {
                        if (seenVerb)
                        {
                            return index - 1;
                        }

                        seenVerb = true;
                    }

                    if (seenVerb
                        && index > startIndex
                        && view.HasTag("CONJ"))
                    {
                        return index - 1;
                    }
                }

                return limit;
            }

            for (var markerIndex = 0; markerIndex < views.Length - 1; markerIndex++)
            {
                var marker = views[markerIndex];
                var relation = marker.PrimaryTag switch
                {
                    "COND" => "cond",
                    "SUB" or "REL" or "PRP" => "sub",
                    _ => null,
                };
                if (relation is null)
                {
                    continue;
                }

                var bodyStart = markerIndex + 1;
                var bodyEnd = FindBoundedClauseEnd(bodyStart, maxUnits: 6);
                if (bodyEnd < bodyStart)
                {
                    continue;
                }

                var bodyViews = views[bodyStart..(bodyEnd + 1)];
                var bodyTag = bodyViews.Any(view => view.PrimaryTag == "V")
                    ? "VS"
                    : "NS";
                var bodyPhrase = AddPhrase(
                    bodyTag,
                    UnitMembers(
                        bodyViews[0].Selection.UnitIndex,
                        bodyViews[^1].Selection.UnitIndex));
                if (bodyPhrase is null)
                {
                    continue;
                }

                AddEdge(
                    bodyPhrase,
                    primaryNodeIds[marker.Selection.UnitIndex],
                    relation);
                if (marker.PrimaryTag is "SUB" or "PRP")
                {
                    void AddSubordinatePhrase(
                        string markerNode,
                        int endIndex)
                    {
                        var subordinateMembers =
                            new[] { markerNode }
                                .Concat(UnitMembers(
                                    bodyViews[0].Selection.UnitIndex,
                                    views[endIndex].Selection.UnitIndex))
                                .ToArray();
                        var endTag = subordinateMembers
                            .Where(terminalOrdinals.ContainsKey)
                            .OrderBy(id => terminalOrdinals[id])
                            .Select(id => nodes.First(node => node.Id == id).Tag)
                            .Last();
                        if (endTag is "PRON" or "N" or "PN" or "ADJ" or "T")
                        {
                            AddPhrase("SC", subordinateMembers);
                        }
                    }

                    AddSubordinatePhrase(
                        primaryNodeIds[marker.Selection.UnitIndex],
                        bodyEnd);
                    var purposeIndex = Enumerable.Range(
                            0,
                            marker.Selection.Candidate.Segments.Count)
                        .FirstOrDefault(
                            index =>
                                marker.Selection.Candidate.Segments[index].Tag
                                    == "PRP"
                                && nodeIds.ContainsKey((
                                    marker.Selection.UnitIndex,
                                    index)),
                            -1);
                    if (purposeIndex >= 0)
                    {
                        AddSubordinatePhrase(
                            nodeIds[(
                                marker.Selection.UnitIndex,
                                purposeIndex)],
                            bodyEnd);
                    }
                }
            }

            AddDependencyDrivenConditionalPhrases();

            void AddDependencyDrivenConditionalPhrases()
            {
                if (parseContainsHeuristic)
                {
                    return;
                }

                var terminals = terminalNodes;
                var terminalIndexes = terminals
                    .Select((node, index) => (node.Id, Index: index))
                    .ToDictionary(pair => pair.Id, pair => pair.Index);
                var bodyPhrases = nodes
                    .Where(node =>
                        node.Kind == QacSyntaxNodeKind.Phrase
                        && node.Tag is "VS" or "NS"
                        && node.SpanStartTerminal is not null
                        && node.SpanEndTerminal is not null)
                    .ToArray();

                QacSyntaxNode? FindPreceding(
                    int markerIndex,
                    int maxDistance,
                    Func<QacSyntaxNode, bool> predicate) =>
                    terminals
                        .Select((node, index) => (node, index))
                        .Where(pair =>
                            pair.index < markerIndex
                            && markerIndex - pair.index <= maxDistance
                            && predicate(pair.node))
                        .OrderByDescending(pair => pair.index)
                        .Select(pair => pair.node)
                        .FirstOrDefault();

                string[] DependentRelations(QacSyntaxNode head) =>
                    edges
                        .Where(edge =>
                            edge.IsVerified
                            && edge.HeadId == head.Id)
                        .Select(edge => edge.Relation)
                        .Order(StringComparer.Ordinal)
                        .ToArray();

                static bool RelationsEqual(
                    IReadOnlyList<string> actual,
                    params string[] expected) =>
                    actual.SequenceEqual(expected, StringComparer.Ordinal);

                static QacSyntaxNode? SelectLongest(
                    IEnumerable<QacSyntaxNode> candidates) =>
                    candidates
                        .OrderByDescending(node => node.SpanEndTerminal)
                        .ThenByDescending(node => node.SpanStartTerminal)
                        .FirstOrDefault();

                foreach (var marker in terminals.Where(node =>
                             node.Tag is "COND" or "T"))
                {
                    if (marker.Tag == "T"
                        && !ConditionalTemporalLemmas.Contains(
                            marker.Morphology?.Lemma ?? string.Empty))
                    {
                        continue;
                    }

                    var markerIndex = terminalIndexes[marker.Id];
                    var candidates = bodyPhrases
                        .Where(body =>
                            body.SpanStartTerminal is { } start
                            && body.SpanEndTerminal is { } end
                            && start > markerIndex
                            && start <= markerIndex + 3
                            && end >= start
                            && end < terminals.Length
                            && end - markerIndex + 1 <= 10)
                        .ToArray();
                    if (candidates.Length == 0)
                    {
                        continue;
                    }

                    var selected = new List<QacSyntaxNode>();
                    void SelectForContract(Func<QacSyntaxNode, bool> predicate)
                    {
                        var body = SelectLongest(candidates.Where(predicate));
                        if (body is not null)
                        {
                            selected.Add(body);
                        }
                    }

                    QacSyntaxNode? FindHost(
                        int maxDistance,
                        Func<QacSyntaxNode, int, bool> predicate) =>
                        FindPreceding(
                            markerIndex,
                            maxDistance,
                            node => predicate(
                                node,
                                markerIndex - terminalIndexes[node.Id]));

                    var annaSpecial = FindHost(
                        maxDistance: 4,
                        (node, distance) =>
                            node.Morphology?.SpecialClass == "<in~"
                            && node.Morphology.Lemma == ">an~"
                            && distance == 2
                            && marker.Tag == "T"
                            && DependentRelations(node).Contains(
                                "subjx",
                                StringComparer.Ordinal));
                    if (annaSpecial is not null)
                    {
                        SelectForContract(_ => true);
                    }

                    var innaSpecial = FindHost(
                        maxDistance: 4,
                        (node, distance) =>
                            node.Morphology?.SpecialClass == "<in~"
                            && node.Morphology.Lemma == "<in~"
                            && distance <= 4);
                    if (innaSpecial is not null)
                    {
                        SelectForContract(body =>
                            body.SpanStartTerminal - markerIndex == 3
                            && terminals[body.SpanEndTerminal!.Value].Tag
                                == "PRON");
                    }

                    var relativeSubordinator = FindHost(
                        maxDistance: 1,
                        (node, distance) =>
                            distance == 1
                            && node.Tag == "REL"
                            && DependentRelations(node).Length == 0);
                    if (relativeSubordinator is not null)
                    {
                        SelectForContract(body =>
                        {
                            var followingIndex =
                                body.SpanEndTerminal!.Value + 1;
                            if (followingIndex >= terminals.Length)
                            {
                                return true;
                            }

                            var following = terminals[followingIndex];
                            return following.Tag != "P"
                                && (following.Tag != "CONJ"
                                    || following.Morphology?.Lemma is null);
                        });
                    }

                    var subordinateParticle = FindHost(
                        maxDistance: 1,
                        (node, distance) =>
                            distance == 1
                            && node.Tag == "SUB"
                            && DependentRelations(node).Contains(
                                "sub",
                                StringComparer.Ordinal));
                    if (subordinateParticle is not null)
                    {
                        SelectForContract(_ => true);
                    }

                    var markerLemma = marker.Morphology?.Lemma;
                    var adjacentLawQawl = FindHost(
                        maxDistance: 1,
                        (node, distance) =>
                            node.Tag == "V"
                            && node.Morphology?.Root == "qwl"
                            && distance == 1
                            && markerLemma == "law"
                            && DependentRelations(node).Length == 0);
                    if (adjacentLawQawl is not null)
                    {
                        SelectForContract(_ => true);
                    }

                    var transitiveLawQawl = FindHost(
                        maxDistance: 4,
                        (node, distance) =>
                            node.Tag == "V"
                            && node.Morphology?.Root == "qwl"
                            && distance == 4
                            && markerLemma == "law"
                            && RelationsEqual(
                                DependentRelations(node),
                                "fut",
                                "obj",
                                "obj",
                                "subj"));
                    if (transitiveLawQawl is not null)
                    {
                        SelectForContract(_ => true);
                    }

                    var mahomaQawl = FindHost(
                        maxDistance: 2,
                        (node, distance) =>
                            node.Tag == "V"
                            && node.Morphology?.Root == "qwl"
                            && distance == 2
                            && markerLemma == "mahomaA"
                            && RelationsEqual(
                                DependentRelations(node),
                                "subj"));
                    if (mahomaQawl is not null)
                    {
                        SelectForContract(_ => true);
                    }

                    var subjectLawQawl = FindHost(
                        maxDistance: 2,
                        (node, distance) =>
                            node.Tag == "V"
                            && node.Morphology?.Root == "qwl"
                            && distance == 2
                            && markerLemma == "law"
                            && RelationsEqual(
                                DependentRelations(node),
                                "subj"));
                    if (subjectLawQawl is not null)
                    {
                        SelectForContract(body =>
                        {
                            var startDistance =
                                body.SpanStartTerminal!.Value - markerIndex;
                            var terminalSpan =
                                body.SpanEndTerminal!.Value - markerIndex + 1;
                            var endTag =
                                terminals[body.SpanEndTerminal.Value].Tag;
                            return endTag == "N"
                                && startDistance == 3
                                && terminalSpan >= 5;
                        });
                    }

                    var subjectInRaA = FindHost(
                        maxDistance: 2,
                        (node, distance) =>
                            node.Tag == "V"
                            && node.Morphology?.Root == "rAy"
                            && distance == 2
                            && markerLemma == "<in"
                            && RelationsEqual(
                                DependentRelations(node),
                                "subj"));
                    if (subjectInRaA is not null)
                    {
                        SelectForContract(body =>
                            terminals[body.SpanEndTerminal!.Value].Tag
                                == "N");
                    }

                    var passivePrescription = FindHost(
                        maxDistance: 3,
                        (node, distance) =>
                            node.Tag == "V"
                            && node.Morphology?.Root == "ktb"
                            && distance == 3
                            && marker.Tag == "T"
                            && markerLemma == "<i*aA"
                            && RelationsEqual(
                                DependentRelations(node),
                                "pass"));
                    if (passivePrescription is not null)
                    {
                        SelectForContract(body =>
                        {
                            var startDistance =
                                body.SpanStartTerminal!.Value - markerIndex;
                            var terminalSpan =
                                body.SpanEndTerminal!.Value - markerIndex + 1;
                            var followingIndex =
                                body.SpanEndTerminal.Value + 1;
                            return startDistance == 1
                                && terminalSpan == 5
                                && terminals[body.SpanEndTerminal.Value].Tag
                                    == "N"
                                && followingIndex < terminals.Length
                                && terminals[followingIndex].Tag == "COND"
                                && terminals[followingIndex].Morphology?.Lemma
                                    == "<in";
                        });
                    }

                    var selectedBody = SelectLongest(selected);
                    if (selectedBody?.SpanEndTerminal is not { } endIndex)
                    {
                        continue;
                    }

                    AddPhrase(
                        "CS",
                        terminals[markerIndex..(endIndex + 1)]
                            .Select(node => node.Id));
                }
            }

        }

        void AddLocalRelations(IReadOnlyList<QacSelectedMorphology> clauseSelections)
        {
            var localViews = clauseSelections
                .Select(selection => new CandidateView(selection))
                .ToArray();

            bool IsAuditedRestrictionSubordinator(int subordinatorIndex)
            {
                var recentStart = Math.Max(0, subordinatorIndex - 7);
                var precedingVerb = localViews[recentStart..(subordinatorIndex - 1)]
                    .Reverse()
                    .FirstOrDefault(view => view.PrimaryTag == "V");
                var embeddedVerb = localViews
                    .Skip(subordinatorIndex + 1)
                    .Take(2)
                    .FirstOrDefault(view => view.PrimaryTag == "V");
                return (precedingVerb?.Root, embeddedVerb?.Root) switch
                {
                    ("nqm", "Amn") =>
                        precedingVerb.PersonGenderNumber is "2MP" or "3MP",
                    ("kwn", "qwl")
                        or ("nhy", "kwn")
                        or ("*kr", "$yA")
                        or ("$yA", "$yA") => true,
                    _ => false,
                };
            }

            for (var index = 1; index < clauseSelections.Count; index++)
            {
                var left = localViews[index - 1];
                var right = localViews[index];
                var leftNode = primaryNodeIds[left.Selection.UnitIndex];
                var rightNode = primaryNodeIds[right.Selection.UnitIndex];
                var hasNearPredicateBa = localViews
                    .Skip(index + 1)
                    .Take(3)
                    .Any(view => view.Selection.Candidate.Segments.Any(segment =>
                        segment.Tag == "P" && segment.Form == "bi"));

                if (left.PrimaryTag == "P"
                    && !left.HasAttachedPronounSuffix
                    && CanBeGenitiveDependent(right))
                {
                    AddEdge(rightNode, leftNode, "gen");
                }
                else if (left.PrimaryTag == "CAUS"
                    && right.PrimaryTag == "V"
                    && IsCausalVerb(right))
                {
                    AddEdge(leftNode, rightNode, "caus");
                }
                else if (left.PrimaryTag == "FUT" && right.PrimaryTag == "V")
                {
                    AddEdge(leftNode, rightNode, "fut");
                }
                else if (left.PrimaryTag == "PRO"
                         && right.PrimaryTag == "V"
                         && (right.HasTag("EMPH")
                             && right.Root is "kwn" or "mwt"
                             || IsAuditedNegativeJussive(right)))
                {
                    AddEdge(rightNode, leftNode, "neg");
                }
                else if (left.PrimaryTag == "PRO"
                         && right.PrimaryTag == "V"
                         && right.Mood == "JUS"
                         && (right.PersonGenderNumber
                                 is "2MP" or "2MS" or "2D" or "3MS"
                             || IsAuditedThirdPersonProhibition(right)))
                {
                    AddEdge(rightNode, leftNode, "pro");
                }
                else if (left.PrimaryTag == "PRO" && right.PrimaryTag == "V")
                {
                    AddEdge(rightNode, leftNode, "neg");
                }
                else if (left.PrimaryTag == "IMPV" && right.PrimaryTag == "V")
                {
                    AddEdge(leftNode, rightNode, "impv");
                }
                else if (left.PrimaryTag == "CERT" && right.PrimaryTag == "V")
                {
                    AddEdge(rightNode, leftNode, "cert");
                }
                else if (left.PrimaryTag == "NEG"
                         && left.Lemma == "maA"
                         && right.PrimaryTag is "PRON" or "DEM"
                         && !right.HasTag("P")
                         && hasNearPredicateBa)
                {
                    AddEdge(rightNode, leftNode, "subjx");
                }
                else if (left.PrimaryTag == "NEG"
                         && left.SpecialClass != "kaAn"
                         && (right.PrimaryTag is "V" or "PRON" or "DEM" or "REL"
                             || right.PrimaryTag == "N"
                             && right.Case == "NOM"
                             && right.State == "INDEF"))
                {
                    AddEdge(rightNode, leftNode, "neg");
                }
                else if (left.PrimaryTag == "INTG"
                         && (right.PrimaryTag == "T"
                             || right.PrimaryTag == "PRON"
                             && right.PersonGenderNumber == "2MP"))
                {
                    AddEdge(rightNode, leftNode, "intg");
                }
                else if (left.PrimaryTag == "VOC" && right.IsNominal)
                {
                    AddEdge(rightNode, leftNode, "voc");
                }
                else if (left.PrimaryTag == "AMD")
                {
                    AddEdge(rightNode, leftNode, "amd");
                }
                else if (left.PrimaryTag == "ANS")
                {
                    AddEdge(rightNode, leftNode, "ans");
                }
                else if (left.PrimaryTag == "AVR")
                {
                    AddEdge(rightNode, leftNode, "avr");
                }
                else if (left.PrimaryTag == "EXL"
                         && (right.PrimaryTag is "COND" or "SUB" or "T"
                             || right.PrimaryTag is "N" or "PN"
                             && right.Case == "NOM"))
                {
                    AddEdge(rightNode, leftNode, "exl");
                }
                else if (left.PrimaryTag == "EXL"
                         && right.PrimaryTag == "N"
                         && right.Case == "ACC")
                {
                    AddEdge(leftNode, rightNode, "exl");
                }
                else if (left.PrimaryTag == "SUR"
                         && right.PrimaryTag == "PRON"
                         && right.PersonGenderNumber is "3MP" or "3FS")
                {
                    AddEdge(rightNode, leftNode, "sur");
                }
                else if (left.PrimaryTag == "INC")
                {
                    AddEdge(rightNode, leftNode, "inc");
                }
                else if (left.PrimaryTag == "RET")
                {
                    AddEdge(rightNode, leftNode, "ret");
                }
                else if (left.PrimaryTag == "EXH"
                         && right.PrimaryTag is "T" or "V")
                {
                    AddEdge(rightNode, leftNode, "exh");
                }
                else if (left.PrimaryTag == "EQ" && right.PrimaryTag == "V")
                {
                    AddEdge(rightNode, leftNode, "eq");
                }
                else if (left.PrimaryTag == "SUP")
                {
                    AddEdge(leftNode, rightNode, "sup");
                }
                else if (left.PrimaryTag is "EXP" or "RES"
                         && right.PrimaryTag == "SUB"
                         && IsAuditedRestrictionSubordinator(index))
                {
                    AddEdge(leftNode, rightNode, "res");
                }
                else if (left.PrimaryTag == "EXP")
                {
                    if (right.PrimaryTag is "PRON" or "SUB" or "PRP")
                    {
                        AddEdge(leftNode, rightNode, "exp");
                    }
                    else if (right.IsNominal)
                    {
                        AddEdge(rightNode, leftNode, "exp");
                    }
                }
                else if (left.PrimaryTag == "RES")
                {
                    var recentStart = Math.Max(0, index - 6);
                    var recentViews = localViews[recentStart..(index - 1)];
                    var hasRecentNegation =
                        recentViews.Any(view => view.PrimaryTag == "NEG");
                    var recentVerb = recentViews
                        .Reverse()
                        .FirstOrDefault(view => view.PrimaryTag == "V");
                    if (right.Lemma == "wusoE")
                    {
                        AddEdge(
                            leftNode,
                            rightNode,
                            recentVerb?.Voice == "PASS" ? "res" : "exp");
                    }
                    else if (right.PrimaryTag == "PRON"
                             && recentVerb?.Root is "Elm" or "jlw")
                    {
                        AddEdge(leftNode, rightNode, "res");
                    }
                    else if (right.IsNominal
                        && right.Case == "ACC"
                        && !hasRecentNegation)
                    {
                        AddEdge(rightNode, leftNode, "exp");
                    }
                    else if (right.PrimaryTag is "PRON" or "SUB" or "PRP")
                    {
                        AddEdge(leftNode, rightNode, "exp");
                    }
                    else if (right.PrimaryTag == "REL")
                    {
                        AddEdge(rightNode, leftNode, "exp");
                    }
                    else if (right.IsNominal)
                    {
                        AddEdge(leftNode, rightNode, "res");
                    }
                }
                else if (left.PrimaryTag == "EMPH")
                {
                    AddEdge(leftNode, rightNode, "emph");
                }
                else if (left.PrimaryTag == "V"
                         && right.PrimaryTag is "LOC" or "T"
                         && left.SpecialClass != "kaAn"
                         && !(right.PrimaryTag == "T"
                              && right.Case is null
                              && left.PersonGenderNumber == "3MP"
                              && left.Aspect == "PERF"
                              && left.Voice == "ACT")
                         && !right.HasTag("CONJ"))
                {
                    AddEdge(rightNode, leftNode, "link");
                }
                else if (left.PrimaryTag == "N"
                         && left.Case == "NOM"
                         && left.State == "INDEF"
                         && right.PrimaryTag == "LOC"
                         && right.Case == "ACC"
                         && !right.HasTag("CONJ"))
                {
                    AddEdge(rightNode, leftNode, "link");
                }
                else if (left.PrimaryTag == "ADJ"
                         && left.Case == "GEN"
                         && left.State == "INDEF"
                         && right.PrimaryTag == "LOC"
                         && right.Case == "ACC"
                         && !right.HasTag("CONJ"))
                {
                    AddEdge(rightNode, leftNode, "link");
                }
                else if (left.PrimaryTag == "N"
                         && left.Case == "NOM"
                         && left.Lemma == ">ay~uhaA"
                         && left.Voice is null
                         && right.PrimaryTag == "REL"
                         && right.Lemma == "{l~a*iY"
                         && !right.HasTag("CONJ"))
                {
                    AddEdge(rightNode, leftNode, "app");
                }
                else if (left.PrimaryTag == "N"
                         && right.PrimaryTag == "REL"
                         && left.Lemma is not null
                         && RelativePossessiveHeadLemmas.Contains(left.Lemma)
                         && !right.HasTag("CONJ"))
                {
                    AddEdge(rightNode, leftNode, "poss");
                }
                else if (left.PrimaryTag == "N"
                         && right.PrimaryTag == "REL"
                         && left.Lemma is not null
                         && RelativeAdjectivalHeadLemmas.Contains(left.Lemma)
                         && !right.HasTag("CONJ"))
                {
                    AddEdge(rightNode, leftNode, "adj");
                }
                else if (left.PrimaryTag == "N"
                         && right.PrimaryTag == "REL"
                         && (left.Lemma == "Hasob" && right.Lemma == "maA"
                             || left.Lemma == "rab~"
                             && right.Lemma == "{l~a*iY")
                         && !right.HasTag("CONJ"))
                {
                    AddEdge(rightNode, leftNode, "pred");
                }
                else if (IsNominalAppositionPair(
                             left,
                             right,
                             index + 1 < localViews.Length
                                 ? localViews[index + 1]
                                 : null,
                             index >= 2 ? localViews[index - 2] : null)
                         && !right.HasTag("CONJ"))
                {
                    AddEdge(rightNode, leftNode, "app");
                }
                else if (IsLexicalAdjective(left, right)
                         && !right.HasTag("CONJ"))
                {
                    AddEdge(rightNode, leftNode, "adj");
                }
                else if (!right.HasTag("CONJ")
                         && right.PrimaryTag == "N"
                         && (left.PrimaryTag == "DEM"
                             && right.Case == "GEN"
                             || left.PrimaryTag == "PN"
                             && left.Case is "ACC" or "GEN"
                             && right.State != "INDEF"
                             && right.Case == left.Case))
                {
                    AddEdge(rightNode, leftNode, "app");
                }
                else if (left.Lemma is not null
                         && right.Lemma is not null
                         && PossessiveLemmaPairs.Contains(
                             (left.Lemma, right.Lemma))
                         && !right.HasTag("CONJ"))
                {
                    AddEdge(rightNode, leftNode, "poss");
                }
                else if (right.PrimaryTag == "ADJ"
                         && left.IsNominal
                         && !right.HasTag("CONJ")
                         && CanAttachAdjective(left, right))
                {
                    AddEdge(rightNode, leftNode, "adj");
                }
                else if (left.IsNominal
                    && right.IsNominal
                    && right.Case == "GEN"
                    && !right.HasTag("CONJ")
                    && right.PrimaryTag != "ADJ")
                {
                    AddEdge(rightNode, leftNode, "poss");
                }
            }
        }

        IReadOnlyList<IReadOnlyList<QacSelectedMorphology>> SplitNaturalClauses(
            IReadOnlyList<QacSelectedMorphology> selections)
        {
            if (!selections.Any(selection =>
                    selection.Source == QacMorphologyCandidateSource.Heuristic))
            {
                return [selections];
            }

            var clauses = new List<IReadOnlyList<QacSelectedMorphology>>();
            var current = new List<QacSelectedMorphology>();
            var containsVerb = false;
            foreach (var selection in selections)
            {
                var isVerb = new CandidateView(selection).PrimaryTag == "V";
                if (isVerb && containsVerb)
                {
                    clauses.Add(current.ToArray());
                    current.Clear();
                    containsVerb = false;
                }

                current.Add(selection);
                containsVerb |= isVerb;
            }

            if (current.Count > 0)
            {
                clauses.Add(current.ToArray());
            }

            return clauses;
        }

        void AddClauseCore(IReadOnlyList<QacSelectedMorphology> clauseSelections)
        {
            var views = clauseSelections.Select(selection => new CandidateView(selection)).ToArray();
            var specialIndexes = views
                .Select((view, index) => (view, index))
                .Where(pair =>
                    pair.view.SpecialClass is "kaAn" or "<in~" or "kaAd")
                .ToArray();
            if (specialIndexes.Length > 0)
            {
                for (var specialOffset = 0;
                     specialOffset < specialIndexes.Length;
                     specialOffset++)
                {
                    var (special, specialIndex) = specialIndexes[specialOffset];
                    var nextSpecialIndex = specialOffset + 1 < specialIndexes.Length
                        ? specialIndexes[specialOffset + 1].index
                        : views.Length;
                    var endExclusive = Math.Min(
                        nextSpecialIndex,
                        specialIndex + 6);
                    AddSpecialCore(
                        views[specialIndex..endExclusive],
                        special);
                }

                return;
            }

            var verb = views.FirstOrDefault(view => view.PrimaryTag == "V");
            if (verb is not null)
            {
                AddVerbalCore(views, verb);
                return;
            }

        }

        void AddLocalVerbalRelations(
            IReadOnlyList<QacSelectedMorphology> clauseSelections)
        {
            var views = clauseSelections
                .Select(selection => new CandidateView(selection))
                .ToArray();
            for (var index = 0; index < views.Length - 1; index++)
            {
                var verb = views[index];
                if (verb.PrimaryTag != "V"
                    || verb.SpecialClass is "kaAn" or "kaAd")
                {
                    continue;
                }

                var verbNode = primaryNodeIds[verb.Selection.UnitIndex];
                var hasInternalSubject = edges.Any(edge =>
                    edge.HeadId == verbNode
                    && edge.Relation is "subj" or "pass");
                var hasDirectObject = edges.Any(edge =>
                    edge.HeadId == verbNode
                    && edge.Relation is "obj" or "cog");
                var limit = Math.Min(views.Length - 1, index + 4);
                for (var argumentIndex = index + 1;
                     argumentIndex <= limit;
                     argumentIndex++)
                {
                    var argument = views[argumentIndex];
                    if (argument.PrimaryTag == "V"
                        || argument.HasTag("CONJ")
                        || argument.SpecialClass is "kaAn" or "<in~" or "kaAd")
                    {
                        break;
                    }

                    if (!IsNaturalArgumentNominal(argument))
                    {
                        continue;
                    }

                    var argumentNode =
                        primaryNodeIds[argument.Selection.UnitIndex];
                    if (dependentIds.Contains(argumentNode))
                    {
                        continue;
                    }

                    var isCaselessObject =
                        argument.PrimaryTag == "REL"
                        && (verb.Aspect != "PERF" || hasInternalSubject);
                    var followingEnd = Math.Min(views.Length, argumentIndex + 5);
                    var hasFollowingNominative =
                        views[(argumentIndex + 1)..followingEnd]
                            .Any(view =>
                                view.IsNominal
                                && view.Case == "NOM"
                                && !view.HasTag("CONJ"));
                    var isCaselessPerfectSubject =
                        argument.PrimaryTag == "REL"
                        && argumentIndex == index + 1
                        && verb.PersonGenderNumber == "3MS"
                        && verb.Aspect == "PERF"
                        && verb.Voice == "ACT"
                        && (verb.Root is null
                            || !CaselessPerfectObjectVerbRoots.Contains(verb.Root))
                        && !hasFollowingNominative
                        && !hasInternalSubject;
                    var isLexicallyCaselessSubject =
                        argument.PrimaryTag == "REL"
                        && argumentIndex == index + 1
                        && verb.PersonGenderNumber == "3MS"
                        && verb.Aspect == "IMPF"
                        && verb.Voice == "ACT"
                        && verb.Root is not null
                        && CaselessSubjectPreferredVerbRoots.Contains(verb.Root)
                        && !hasFollowingNominative
                        && !hasInternalSubject;
                    if (isCaselessPerfectSubject || isLexicallyCaselessSubject)
                    {
                        AddEdge(argumentNode, verbNode, "subj");
                        hasInternalSubject = true;
                    }
                    else if (isCaselessObject
                        && argumentIndex == index + 1
                        && verb.Voice != "PASS"
                        && !hasDirectObject)
                    {
                        AddEdge(argumentNode, verbNode, "obj");
                        hasDirectObject = true;
                    }
                    else if (argument.Case == "NOM" && !hasInternalSubject)
                    {
                        AddEdge(
                            argumentNode,
                            verbNode,
                            verb.Voice == "PASS" ? "pass" : "subj");
                        hasInternalSubject = true;
                    }
                    else if (argument.Case == "ACC"
                             && verb.Voice != "PASS"
                             && !hasDirectObject)
                    {
                        AddEdge(
                            argumentNode,
                            verbNode,
                            ClassifyAccusativeVerbalRelation(
                                verb,
                                argument,
                                argumentIndex - index,
                                includeCognate: false));
                        hasDirectObject = true;
                    }
                }
            }
        }

        void AddLocalNominalPredicates(
            IReadOnlyList<QacSelectedMorphology> clauseSelections)
        {
            var views = clauseSelections
                .Select(selection => new CandidateView(selection))
                .ToArray();
            for (var index = 0; index < views.Length - 1; index++)
            {
                var subject = views[index];
                var predicate = views[index + 1];
                var previous = index > 0 ? views[index - 1] : null;
                var following = index + 2 < views.Length ? views[index + 2] : null;
                var isInvertedPeacePredicate =
                    subject.PrimaryTag == "N"
                    && subject.Lemma == "sala`m"
                    && subject.Case == "NOM"
                    && predicate.PrimaryTag == "PRON"
                    && !predicate.HasTag("P")
                    && subject.Selection.Source
                        == QacMorphologyCandidateSource.QuranicCorpus
                    && predicate.Selection.Source
                        == QacMorphologyCandidateSource.QuranicCorpus
                    && !dependentIds.Contains(
                        primaryNodeIds[subject.Selection.UnitIndex]);
                if (isInvertedPeacePredicate)
                {
                    AddEdge(
                        primaryNodeIds[subject.Selection.UnitIndex],
                        primaryNodeIds[predicate.Selection.UnitIndex],
                        "pred");
                    continue;
                }

                var isInterrogativeNominalPredicate =
                    subject.PrimaryTag is "INTG" or "REL"
                    && subject.Lemma is "maA" or ">aY~"
                    && (subject.Lemma != ">aY~"
                        || subject.HasAttachedPronounSuffix)
                    && predicate.PrimaryTag == "N"
                    && predicate.Case == "NOM"
                    && predicate.HasTag("DET")
                    && subject.Selection.Source
                        == QacMorphologyCandidateSource.QuranicCorpus
                    && predicate.Selection.Source
                        == QacMorphologyCandidateSource.QuranicCorpus
                    && !subject.HasTag("CONJ")
                    && !predicate.HasTag("CONJ")
                    && !dependentIds.Contains(
                        primaryNodeIds[predicate.Selection.UnitIndex]);
                if (isInterrogativeNominalPredicate)
                {
                    AddEdge(
                        primaryNodeIds[predicate.Selection.UnitIndex],
                        primaryNodeIds[subject.Selection.UnitIndex],
                        "pred");
                    continue;
                }

                var isComparativeInterrogativePredicate =
                    subject.PrimaryTag is "REL" or "INTG"
                    && subject.Lemma == "man"
                    && predicate.PrimaryTag == "N"
                    && predicate.Case == "NOM"
                    && predicate.Lemma is ">aZolam" or ">aHosan"
                    && subject.Selection.Source
                        == QacMorphologyCandidateSource.QuranicCorpus
                    && predicate.Selection.Source
                        == QacMorphologyCandidateSource.QuranicCorpus
                    && !predicate.HasTag("CONJ")
                    && !dependentIds.Contains(
                        primaryNodeIds[predicate.Selection.UnitIndex]);
                if (isComparativeInterrogativePredicate)
                {
                    var dependent =
                        primaryNodeIds[predicate.Selection.UnitIndex];
                    var head = primaryNodeIds[subject.Selection.UnitIndex];
                    var edgeCount = edges.Count;
                    AddEdge(dependent, head, "pred");
                    if (edges.Count > edgeCount)
                    {
                        suppressedNominalPhrasePredicates.Add(
                            (dependent, head));
                    }

                    continue;
                }

                var isAuditedDivinePredicate =
                    subject.PrimaryTag == "PN"
                    && subject.Lemma == "{ll~ah"
                    && subject.Case == "NOM"
                    && subject.HasTag("CONJ")
                    && predicate.PrimaryTag is "N" or "ADJ"
                    && predicate.Case == "NOM"
                    && !predicate.HasTag("CONJ")
                    && !IsNominalAppositionPair(
                        subject,
                        predicate,
                        following,
                        previous)
                    && !IsLexicalAdjective(subject, predicate)
                    && subject.Selection.Source
                        == QacMorphologyCandidateSource.QuranicCorpus
                    && predicate.Selection.Source
                        == QacMorphologyCandidateSource.QuranicCorpus
                    && !dependentIds.Contains(
                        primaryNodeIds[predicate.Selection.UnitIndex]);
                if (isAuditedDivinePredicate)
                {
                    var dependent =
                        primaryNodeIds[predicate.Selection.UnitIndex];
                    var head = primaryNodeIds[subject.Selection.UnitIndex];
                    var edgeCount = edges.Count;
                    AddEdge(dependent, head, "pred");
                    if (edges.Count > edgeCount)
                    {
                        suppressedNominalPhrasePredicates.Add(
                            (dependent, head));
                    }

                    continue;
                }

                var requiresAuditedPronounOverride =
                    subject.HasTag("CONJ")
                    || subject.PersonGenderNumber == "3MS"
                    && predicate.Voice == "ACT"
                    || subject.PersonGenderNumber is "3MP" or "3FP" or "3D"
                    && predicate.State is null
                    && predicate.Voice is null
                    || predicate.State == "INDEF"
                    && predicate.Voice is null;
                var isAuditedPronounPredicate =
                    subject.PrimaryTag == "PRON"
                    && !subject.HasTag("P")
                    && predicate.PrimaryTag == "N"
                    && predicate.Case == "NOM"
                    && (predicate.Voice is not null
                        || predicate.HasTag("DET")
                        || predicate.Lemma == "Hil~")
                    && (previous?.PrimaryTag != "V"
                        || subject.HasTag("CONJ"))
                    && previous?.SpecialClass
                        is not ("kaAn" or "<in~" or "kaAd")
                    && requiresAuditedPronounOverride
                    && subject.Selection.Source
                        == QacMorphologyCandidateSource.QuranicCorpus
                    && predicate.Selection.Source
                        == QacMorphologyCandidateSource.QuranicCorpus
                    && !predicate.HasTag("CONJ")
                    && !dependentIds.Contains(
                        primaryNodeIds[predicate.Selection.UnitIndex]);
                if (isAuditedPronounPredicate)
                {
                    var dependent =
                        primaryNodeIds[predicate.Selection.UnitIndex];
                    var head = primaryNodeIds[subject.Selection.UnitIndex];
                    var edgeCount = edges.Count;
                    AddEdge(dependent, head, "pred");
                    if (edges.Count > edgeCount)
                    {
                        suppressedNominalPhrasePredicates.Add(
                            (dependent, head));
                    }

                    continue;
                }

                if (IsLexicalNominalPredicate(subject, predicate)
                    && !predicate.HasTag("CONJ"))
                {
                    AddEdge(
                        primaryNodeIds[predicate.Selection.UnitIndex],
                        primaryNodeIds[subject.Selection.UnitIndex],
                        "pred");
                    continue;
                }

                var isDeicticSubject =
                    subject.PrimaryTag is "PRON" or "DEM";
                var isNominalSubject =
                    subject.PrimaryTag is "PN" or "N"
                    && subject.Case == "NOM"
                    && subject.State != "INDEF"
                    && predicate.PrimaryTag == "N"
                    && predicate.Case == "NOM"
                    && !(subject.PrimaryTag == "N"
                         && subject.State is null
                         && subject.Voice is null
                         && predicate.State is null
                         && predicate.Voice is null);
                var unsupportedPronounPredicate =
                    subject.PrimaryTag == "PRON"
                    && predicate.PrimaryTag == "N"
                    && (subject.PersonGenderNumber == "3MS"
                        && predicate.Voice == "ACT"
                        || subject.PersonGenderNumber is "3MP" or "3FP" or "3D"
                        && predicate.State is null
                        && predicate.Voice is null);
                if (!isDeicticSubject
                    && !isNominalSubject
                    || unsupportedPronounPredicate
                    || IsNominalAppositionPair(
                        subject,
                        predicate,
                        following,
                        previous)
                    || IsLexicalAdjective(subject, predicate)
                    || previous?.PrimaryTag == "V"
                    || previous?.SpecialClass is "kaAn" or "<in~" or "kaAd"
                    || subject.HasTag("CONJ")
                    || predicate.HasTag("CONJ")
                    || !IsNaturalArgumentNominal(predicate)
                    || predicate.Case != "NOM" && predicate.PrimaryTag != "REL"
                    || subject.PrimaryTag == "PRON"
                    && predicate.PrimaryTag == "N"
                    && predicate.State == "INDEF"
                    && predicate.Voice is null)
                {
                    continue;
                }

                AddEdge(
                    primaryNodeIds[predicate.Selection.UnitIndex],
                    primaryNodeIds[subject.Selection.UnitIndex],
                    "pred");
            }

            for (var subjectIndex = 0;
                 subjectIndex + 2 < views.Length;
                 subjectIndex++)
            {
                var subject = views[subjectIndex];
                var previous = subjectIndex > 0 ? views[subjectIndex - 1] : null;
                var preposition = views[subjectIndex + 1];
                var isDeicticSubject = subject.PrimaryTag is "PRON" or "DEM";
                var isDefiniteNominalSubject =
                    subject.PrimaryTag is "N" or "PN"
                    && subject.Case == "NOM"
                    && subject.State != "INDEF";
                if ((!isDeicticSubject && !isDefiniteNominalSubject)
                    || preposition.PrimaryTag != "P"
                    || subject.PrimaryTag == "PRON"
                    && subject.HasTag("P")
                    || subject.PrimaryTag is "N" or "DEM"
                    && subjectIndex > 0
                    && previous?.PrimaryTag
                        is not ("RET" or "T" or "REL" or "NEG"
                            or "COND" or "ANS" or "AMD")
                    || previous?.PrimaryTag == "V"
                    || previous?.SpecialClass is "kaAn" or "<in~" or "kaAd"
                    || preposition.HasTag("CONJ")
                    || subject.Selection.Source
                        != QacMorphologyCandidateSource.QuranicCorpus
                    || preposition.Selection.Source
                        != QacMorphologyCandidateSource.QuranicCorpus)
                {
                    continue;
                }

                var maxPredicateIndex = Math.Min(
                    views.Length - 1,
                    subjectIndex + 4);
                for (var predicateIndex = subjectIndex + 2;
                     predicateIndex <= maxPredicateIndex;
                     predicateIndex++)
                {
                    var predicate = views[predicateIndex];
                    var complements = views[
                        (subjectIndex + 2)..predicateIndex];
                    if (predicate.PrimaryTag != "N"
                        || predicate.Case != "NOM"
                        || predicate.State != "INDEF"
                        && predicate.Voice is null
                        || predicate.HasTag("CONJ")
                        || predicate.Selection.Source
                            != QacMorphologyCandidateSource.QuranicCorpus
                        || complements.Any(complement =>
                            !complement.IsNominal
                            || complement.Case != "GEN"
                            || complement.HasTag("CONJ")
                            || complement.Selection.Source
                                != QacMorphologyCandidateSource.QuranicCorpus)
                        || complements.Length == 0
                        && !preposition.HasAttachedPronounSuffix
                        || subject.PrimaryTag != "PRON"
                        && complements.Length == 0
                        && preposition.HasAttachedPronounSuffix
                        || dependentIds.Contains(
                            primaryNodeIds[predicate.Selection.UnitIndex]))
                    {
                        continue;
                    }

                    var dependent =
                        primaryNodeIds[predicate.Selection.UnitIndex];
                    var head = primaryNodeIds[subject.Selection.UnitIndex];
                    var edgeCount = edges.Count;
                    AddEdge(dependent, head, "pred");
                    if (edges.Count > edgeCount)
                    {
                        relationOnlyNominalPredicates.Add((dependent, head));
                    }

                    break;
                }
            }

            for (var subjectIndex = 1;
                 subjectIndex + 3 < views.Length;
                 subjectIndex++)
            {
                var relative = views[subjectIndex - 1];
                var subject = views[subjectIndex];
                var preposition = views[subjectIndex + 1];
                var complement = views[subjectIndex + 2];
                var predicate = views[subjectIndex + 3];
                if (relative.PrimaryTag != "REL"
                    || subject.PrimaryTag != "PRON"
                    || preposition.PrimaryTag != "P"
                    || !complement.IsNominal
                    || complement.Case != "GEN"
                    || predicate.PrimaryTag != "N"
                    || predicate.Case != "NOM"
                    || predicate.Voice != "ACT"
                    || views[(subjectIndex - 1)..(subjectIndex + 4)]
                        .Any(view =>
                            view.Selection.Source
                                != QacMorphologyCandidateSource.QuranicCorpus)
                    || subject.HasTag("CONJ")
                    || preposition.HasTag("CONJ")
                    || complement.HasTag("CONJ")
                    || predicate.HasTag("CONJ")
                    || dependentIds.Contains(
                        primaryNodeIds[predicate.Selection.UnitIndex]))
                {
                    continue;
                }

                AddEdge(
                    primaryNodeIds[predicate.Selection.UnitIndex],
                    primaryNodeIds[subject.Selection.UnitIndex],
                    "pred");
            }

            for (var subjectIndex = 1;
                 subjectIndex + 2 < views.Length;
                 subjectIndex++)
            {
                var relative = views[subjectIndex - 1];
                var subject = views[subjectIndex];
                var complement = views[subjectIndex + 1];
                var predicate = views[subjectIndex + 2];
                if (relative.PrimaryTag != "REL"
                    || subject.PrimaryTag != "PRON"
                    || !complement.IsNominal
                    || complement.Case != "GEN"
                    || !complement.HasTag("P")
                    || predicate.PrimaryTag != "N"
                    || predicate.Case != "NOM"
                    || predicate.Voice != "ACT"
                    || views[(subjectIndex - 1)..(subjectIndex + 3)]
                        .Any(view =>
                            view.Selection.Source
                                != QacMorphologyCandidateSource.QuranicCorpus)
                    || subject.HasTag("CONJ")
                    || complement.HasTag("CONJ")
                    || predicate.HasTag("CONJ")
                    || dependentIds.Contains(
                        primaryNodeIds[predicate.Selection.UnitIndex]))
                {
                    continue;
                }

                AddEdge(
                    primaryNodeIds[predicate.Selection.UnitIndex],
                    primaryNodeIds[subject.Selection.UnitIndex],
                    "pred");
            }

            for (var subjectIndex = 1;
                 subjectIndex + 3 < views.Length;
                 subjectIndex++)
            {
                var relative = views[subjectIndex - 1];
                var subject = views[subjectIndex];
                var firstComplement = views[subjectIndex + 1];
                if (relative.PrimaryTag != "REL"
                    || subject.PrimaryTag != "PRON"
                    || !firstComplement.IsNominal
                    || firstComplement.Case != "GEN"
                    || !firstComplement.HasTag("P")
                    || relative.Selection.Source
                        != QacMorphologyCandidateSource.QuranicCorpus
                    || subject.Selection.Source
                        != QacMorphologyCandidateSource.QuranicCorpus
                    || firstComplement.Selection.Source
                        != QacMorphologyCandidateSource.QuranicCorpus
                    || subject.HasTag("CONJ"))
                {
                    continue;
                }

                var maxPredicateIndex = Math.Min(
                    views.Length - 1,
                    subjectIndex + 4);
                for (var predicateIndex = subjectIndex + 3;
                     predicateIndex <= maxPredicateIndex;
                     predicateIndex++)
                {
                    var predicate = views[predicateIndex];
                    var additionalComplements = views[
                        (subjectIndex + 2)..predicateIndex];
                    if (additionalComplements.Any(complement =>
                            !complement.IsNominal
                            || complement.Case != "GEN"
                            || complement.Selection.Source
                                != QacMorphologyCandidateSource.QuranicCorpus)
                        || predicate.PrimaryTag != "N"
                        || predicate.Case != "NOM"
                        || predicate.Voice != "ACT"
                        || predicate.HasTag("CONJ")
                        || predicate.Selection.Source
                            != QacMorphologyCandidateSource.QuranicCorpus
                        || dependentIds.Contains(
                            primaryNodeIds[predicate.Selection.UnitIndex]))
                    {
                        continue;
                    }

                    AddEdge(
                        primaryNodeIds[predicate.Selection.UnitIndex],
                        primaryNodeIds[subject.Selection.UnitIndex],
                        "pred");
                    break;
                }
            }

            for (var subjectIndex = 0;
                 subjectIndex + 2 < views.Length;
                 subjectIndex++)
            {
                var subject = views[subjectIndex];
                var temporal = views[subjectIndex + 1];
                var predicate = views[subjectIndex + 2];
                if (subject.PrimaryTag != "N"
                    || subject.Case != "NOM"
                    || subject.Lemma != "wajoh"
                    || temporal.PrimaryTag != "T"
                    || temporal.Lemma != "yawoma}i*"
                    || predicate.PrimaryTag != "N"
                    || predicate.Case != "NOM"
                    || predicate.Voice != "ACT"
                    || views[subjectIndex..(subjectIndex + 3)]
                        .Any(view =>
                            view.Selection.Source
                                != QacMorphologyCandidateSource.QuranicCorpus)
                    || dependentIds.Contains(
                        primaryNodeIds[predicate.Selection.UnitIndex]))
                {
                    continue;
                }

                AddEdge(
                    primaryNodeIds[predicate.Selection.UnitIndex],
                    primaryNodeIds[subject.Selection.UnitIndex],
                    "pred");
            }

            for (var subjectIndex = 0;
                 subjectIndex + 2 < views.Length;
                 subjectIndex++)
            {
                var subject = views[subjectIndex];
                var cliticPreposition = views[subjectIndex + 1];
                var predicate = views[subjectIndex + 2];
                if (subject.PrimaryTag != "PRON"
                    || subject.HasTag("P")
                    || cliticPreposition.PrimaryTag != "PRON"
                    || !cliticPreposition.HasTag("P")
                    || predicate.PrimaryTag != "N"
                    || predicate.Case != "NOM"
                    || predicate.Voice != "ACT"
                    || views[subjectIndex..(subjectIndex + 3)]
                        .Any(view =>
                            view.Selection.Source
                                != QacMorphologyCandidateSource.QuranicCorpus)
                    || dependentIds.Contains(
                        primaryNodeIds[predicate.Selection.UnitIndex]))
                {
                    continue;
                }

                var dependent =
                    primaryNodeIds[predicate.Selection.UnitIndex];
                var head = primaryNodeIds[subject.Selection.UnitIndex];
                var edgeCount = edges.Count;
                AddEdge(dependent, head, "pred");
                if (edges.Count > edgeCount)
                {
                    suppressedNominalPhrasePredicates.Add((dependent, head));
                }
            }

            for (var subjectIndex = 0;
                 subjectIndex + 4 < views.Length;
                 subjectIndex++)
            {
                var subject = views[subjectIndex];
                var possessive = views[subjectIndex + 1];
                var temporal = views[subjectIndex + 2];
                var preposition = views[subjectIndex + 3];
                var predicate = views[subjectIndex + 4];
                if (subject.PrimaryTag != "N"
                    || subject.Lemma != "kul~"
                    || subject.Case != "NOM"
                    || possessive.PrimaryTag != "N"
                    || possessive.Lemma != "nafos"
                    || possessive.Case != "GEN"
                    || temporal.PrimaryTag != "T"
                    || temporal.Lemma != "lam~aA"
                    || preposition.PrimaryTag != "P"
                    || preposition.Lemma != "EalaY`"
                    || !preposition.HasAttachedPronounSuffix
                    || predicate.PrimaryTag != "N"
                    || predicate.Lemma != "Ha`fiZ"
                    || predicate.Case != "NOM"
                    || views[subjectIndex..(subjectIndex + 5)]
                        .Any(view =>
                            view.Selection.Source
                                != QacMorphologyCandidateSource.QuranicCorpus)
                    || dependentIds.Contains(
                        primaryNodeIds[predicate.Selection.UnitIndex]))
                {
                    continue;
                }

                AddEdge(
                    primaryNodeIds[predicate.Selection.UnitIndex],
                    primaryNodeIds[subject.Selection.UnitIndex],
                    "pred");
            }

            for (var subjectIndex = 0;
                 subjectIndex + 2 < views.Length;
                 subjectIndex++)
            {
                var subject = views[subjectIndex];
                var possessive = views[subjectIndex + 1];
                var predicate = views[subjectIndex + 2];
                if (subject.PrimaryTag != "N"
                    || subject.Lemma != "layolap"
                    || subject.Case != "NOM"
                    || possessive.PrimaryTag != "N"
                    || possessive.Lemma != "qador"
                    || possessive.Case != "GEN"
                    || predicate.PrimaryTag != "ADJ"
                    || predicate.Lemma != "xayor"
                    || predicate.Case != "NOM"
                    || views[subjectIndex..(subjectIndex + 3)]
                        .Any(view =>
                            view.Selection.Source
                                != QacMorphologyCandidateSource.QuranicCorpus)
                    || dependentIds.Contains(
                        primaryNodeIds[predicate.Selection.UnitIndex]))
                {
                    continue;
                }

                AddEdge(
                    primaryNodeIds[predicate.Selection.UnitIndex],
                    primaryNodeIds[subject.Selection.UnitIndex],
                    "pred");
            }

            for (var subjectIndex = 0;
                 subjectIndex + 2 < views.Length;
                 subjectIndex++)
            {
                var subject = views[subjectIndex];
                var temporal = views[subjectIndex + 1];
                var predicate = views[subjectIndex + 2];
                if (subject.PrimaryTag != "DEM"
                    || subject.Lemma != "*a`lik"
                    || temporal.PrimaryTag != "T"
                    || temporal.Lemma != "yawoma}i*"
                    || predicate.PrimaryTag != "N"
                    || predicate.Lemma != "yawom"
                    || predicate.Case != "NOM"
                    || views[subjectIndex..(subjectIndex + 3)]
                        .Any(view =>
                            view.Selection.Source
                                != QacMorphologyCandidateSource.QuranicCorpus)
                    || dependentIds.Contains(
                        primaryNodeIds[predicate.Selection.UnitIndex]))
                {
                    continue;
                }

                AddEdge(
                    primaryNodeIds[predicate.Selection.UnitIndex],
                    primaryNodeIds[subject.Selection.UnitIndex],
                    "pred");
            }
        }

        void AddConjunctionRelations(
            IReadOnlyList<QacSelectedMorphology> clauseSelections)
        {
            var views = clauseSelections.Select(selection => new CandidateView(selection)).ToArray();
            for (var index = 1; index < views.Length; index++)
            {
                var current = views[index];
                var currentNode = primaryNodeIds[current.Selection.UnitIndex];
                if (!current.HasTag("CONJ") || dependentIds.Contains(currentNode))
                {
                    continue;
                }

                var head = views
                    .Skip(Math.Max(0, index - 3))
                    .Take(Math.Min(index, 3))
                    .Where(candidate =>
                        CanCoordinate(candidate, current)
                        && !(current.PrimaryTag == "PN"
                             && candidate.PrimaryTag == "N")
                        && (current.PrimaryTag is not ("PN" or "LOC")
                            || current.Selection.UnitIndex
                                - candidate.Selection.UnitIndex == 1)
                        && (current.Selection.UnitIndex
                                - candidate.Selection.UnitIndex <= 2
                            || current.PrimaryTag == "N"
                            && candidate.PrimaryTag == "N"
                            && current.Case == candidate.Case
                            && (current.State == "INDEF"
                                && candidate.State == "INDEF"
                                || current.Case == "NOM"))
                        && (current.PrimaryTag != "V"
                            || current.Selection.UnitIndex
                                - candidate.Selection.UnitIndex <= 2))
                    .OrderByDescending(candidate =>
                        CoordinationScore(candidate, current))
                    .ThenBy(candidate =>
                        index - Array.IndexOf(views, candidate))
                    .FirstOrDefault();
                if (head is null)
                {
                    continue;
                }

                AddEdge(
                    currentNode,
                    primaryNodeIds[head.Selection.UnitIndex],
                    "conj");
            }
        }

        void AddSpecialCore(
            IReadOnlyList<CandidateView> views,
            CandidateView special)
        {
            var expectedSubjectCase = special.SpecialClass == "<in~"
                ? "ACC"
                : "NOM";
            var expectedPredicateCase = special.SpecialClass == "<in~"
                ? "NOM"
                : "ACC";
            bool IsPredicateCandidate(CandidateView view) =>
                view.PrimaryTag is "N" or "PN" or "ADJ"
                && view.Case == expectedPredicateCase;
            var candidates = views
                .Where(view =>
                    view.IsNominal
                    && !view.HasTag("CONJ")
                    && view.Selection.UnitIndex > special.Selection.UnitIndex
                    && !dependentIds.Contains(
                        primaryNodeIds[view.Selection.UnitIndex]))
                .ToArray();
            if (candidates.Length == 0)
            {
                return;
            }

            var head = primaryNodeIds[special.Selection.UnitIndex];
            var hasInternalSubject = edges.Any(edge =>
                edge.HeadId == head && edge.Relation == "subjx");
            if (hasInternalSubject)
            {
                var internalPredicate = candidates
                    .Where(IsPredicateCandidate)
                    .OrderBy(view => view.Selection.UnitIndex)
                    .FirstOrDefault();
                if (internalPredicate is not null)
                {
                    AddEdge(
                        primaryNodeIds[internalPredicate.Selection.UnitIndex],
                        head,
                        "predx");
                }

                return;
            }

            var subject = candidates
                .Where(view => view.Case == expectedSubjectCase)
                .OrderBy(view => view.Selection.UnitIndex)
                .FirstOrDefault()
                ?? candidates
                    .Where(view => view.PrimaryTag is "REL" or "DEM")
                    .OrderBy(view => view.Selection.UnitIndex)
                    .FirstOrDefault();
            if (subject is null)
            {
                var predicateOnly = candidates
                    .Where(IsPredicateCandidate)
                    .OrderBy(view => view.Selection.UnitIndex)
                    .FirstOrDefault();
                if (predicateOnly is not null)
                {
                    if (special.SpecialClass == "kaAn")
                    {
                        var hiddenId =
                            $"hidden-special-subject-{special.Selection.UnitIndex}";
                        nodes.Add(
                            new QacSyntaxNode(
                                hiddenId,
                                QacSyntaxNodeKind.Hidden,
                                "PRON",
                                HiddenPronoun(special.PersonGenderNumber),
                                Morphology: HiddenPronounMorphology(
                                    special.PersonGenderNumber)));
                        AddEdge(hiddenId, head, "subjx");
                    }

                    AddEdge(
                        primaryNodeIds[predicateOnly.Selection.UnitIndex],
                        head,
                        "predx");
                }

                return;
            }

            var predicate = candidates
                .Where(view =>
                    view.Selection.UnitIndex != subject.Selection.UnitIndex
                    && IsPredicateCandidate(view))
                .OrderBy(view => view.Selection.UnitIndex)
                .FirstOrDefault();
            AddEdge(primaryNodeIds[subject.Selection.UnitIndex], head, "subjx");
            if (predicate is not null)
            {
                AddEdge(primaryNodeIds[predicate.Selection.UnitIndex], head, "predx");
            }
        }

        void AddVerbalCore(
            IReadOnlyList<CandidateView> views,
            CandidateView verb)
        {
            var verbNode = primaryNodeIds[verb.Selection.UnitIndex];
            var nominalViews = views.Where(view =>
                view.IsNominal
                && !view.HasTag("CONJ")
                && !dependentIds.Contains(primaryNodeIds[view.Selection.UnitIndex]))
                .ToArray();
            var hasHeuristic = views.Any(view =>
                view.Selection.Source == QacMorphologyCandidateSource.Heuristic);
            var subject = nominalViews
                .Where(view => view.Case == "NOM")
                .OrderBy(view =>
                    view.Selection.UnitIndex > verb.Selection.UnitIndex ? 0 : 1)
                .ThenBy(view =>
                    Math.Abs(view.Selection.UnitIndex - verb.Selection.UnitIndex))
                .FirstOrDefault();
            if (subject is null && hasHeuristic)
            {
                subject = nominalViews
                    .Where(view =>
                        IsNaturalArgumentNominal(view)
                        && view.Selection.UnitIndex < verb.Selection.UnitIndex
                        && verb.Selection.UnitIndex - view.Selection.UnitIndex <= 4)
                    .OrderByDescending(view => view.Selection.UnitIndex)
                    .FirstOrDefault()
                    ?? nominalViews
                        .Where(view =>
                            IsNaturalArgumentNominal(view)
                            && view.Selection.UnitIndex > verb.Selection.UnitIndex
                            && view.Selection.UnitIndex - verb.Selection.UnitIndex <= 4)
                        .OrderBy(view => view.Selection.UnitIndex)
                        .FirstOrDefault();
            }

            var hasInternalSubject = edges.Any(edge =>
                edge.HeadId == verbNode && edge.Relation is "subj" or "pass");
            if (subject is not null && !hasInternalSubject)
            {
                AddEdge(
                    primaryNodeIds[subject.Selection.UnitIndex],
                    verbNode,
                    verb.Voice == "PASS" ? "pass" : "subj");
            }
            else if (!hasInternalSubject)
            {
                var hiddenId = $"hidden-subject-{verb.Selection.UnitIndex}";
                nodes.Add(
                    new QacSyntaxNode(
                        hiddenId,
                        QacSyntaxNodeKind.Hidden,
                        "PRON",
                        HiddenPronoun(verb.PersonGenderNumber),
                        Morphology: HiddenPronounMorphology(verb.PersonGenderNumber)));
                AddEdge(hiddenId, verbNode, verb.Voice == "PASS" ? "pass" : "subj");
            }

            var directObject = nominalViews
                .Where(view =>
                    view.Case == "ACC"
                    && view.Selection.UnitIndex > verb.Selection.UnitIndex
                    && (subject is null
                        || view.Selection.UnitIndex != subject.Selection.UnitIndex))
                .OrderBy(view => view.Selection.UnitIndex)
                .FirstOrDefault();
            if (directObject is null
                && !hasHeuristic
                && verb.Voice != "PASS")
            {
                directObject = nominalViews
                    .Where(view =>
                        view.Case == "ACC"
                        && view.Selection.UnitIndex < verb.Selection.UnitIndex
                        && (subject is null
                            || view.Selection.UnitIndex
                                != subject.Selection.UnitIndex))
                    .OrderByDescending(view => view.Selection.UnitIndex)
                    .FirstOrDefault();
            }

            if (directObject is null
                && hasHeuristic
                && subject is not null
                && subject.Selection.UnitIndex < verb.Selection.UnitIndex
                && verb.Voice != "PASS")
            {
                directObject = nominalViews
                    .Where(view =>
                        IsNaturalArgumentNominal(view)
                        && view.Selection.UnitIndex > verb.Selection.UnitIndex
                        && view.Selection.UnitIndex - verb.Selection.UnitIndex <= 4
                        && view.Selection.UnitIndex != subject.Selection.UnitIndex)
                    .OrderBy(view => view.Selection.UnitIndex)
                    .FirstOrDefault();
            }

            if (directObject is not null)
            {
                var objectDistance =
                    directObject.Selection.UnitIndex - verb.Selection.UnitIndex;
                string? relation = ClassifyAccusativeVerbalRelation(
                    verb,
                    directObject,
                    objectDistance,
                    includeCognate: true);
                if (verb.Voice == "PASS"
                    && relation is not ("cog" or "link"))
                {
                    relation = null;
                }
                if (relation is null)
                {
                    return;
                }

                AddEdge(
                    primaryNodeIds[directObject.Selection.UnitIndex],
                    verbNode,
                    relation);
            }
        }
    }

    private static IReadOnlyList<int> ComputeClauseIndexes(
        string text,
        IReadOnlyList<QacParsedMorphologyUnit> units)
    {
        var clauses = new int[units.Count];
        var clause = 0;
        for (var index = 1; index < units.Count; index++)
        {
            var gapStart = units[index - 1].Range.End;
            var gapLength = units[index].Range.Start - gapStart;
            if (gapLength > 0
                && text.AsSpan(gapStart, gapLength).IndexOfAny(
                    ['.', '!', '؟', '؛', '،', '\n', '\r']) >= 0)
            {
                clause++;
            }

            clauses[index] = clause;
        }

        return clauses;
    }

    private static QacNormalizedMorphologyRecord HiddenPronounMorphology(string? pgn) =>
        new(
            "natural:hidden",
            string.Empty,
            "PRON",
            "Stem",
            pgn is null ? ["STEM", "POS:PRON"] : ["STEM", "POS:PRON", pgn],
            null,
            null,
            null,
            pgn,
            null,
            null,
            null,
            null,
            null,
            null,
            "NOM",
            "DEF");

    private static string HiddenPronoun(string? pgn) =>
        pgn switch
        {
            "1S" => "أنا",
            "1P" => "نحن",
            "2MS" => "أنت",
            "2MP" => "أنتم",
            "3FS" => "هي",
            "3MP" => "هم",
            _ => "هو",
        };

    private static bool TryGetUnitIndex(string nodeId, out int unitIndex)
    {
        unitIndex = -1;
        if (nodeId.Length < 4 || nodeId[0] != 'u')
        {
            return false;
        }

        var separator = nodeId.IndexOf('s', 1);
        return separator > 1
            && int.TryParse(nodeId.AsSpan(1, separator - 1), out unitIndex);
    }

    private static bool CanBeGenitiveDependent(CandidateView view) =>
        view.IsNominal
        && (view.Case == "GEN"
            || view.Case is null
            && view.Selection.Source == QacMorphologyCandidateSource.Heuristic
            || view.Case is null
            && view.PrimaryTag is "PRON" or "DEM" or "REL");

    private static bool IsNaturalArgumentNominal(CandidateView view) =>
        view.PrimaryTag is "N" or "PN" or "IMPN" or "PRON" or "DEM" or "REL";

    private static bool IsAuditedNegativeJussive(CandidateView verb) =>
        (verb.Root, verb.PersonGenderNumber, verb.Voice) switch
        {
            ("Aby", "3MS", _) => true,
            ("Ady", "3MS", _) => true,
            ("Ax*", "3MS", "PASS") => true,
            ("jdl", "2MS", _) => true,
            ("kfr", "2MS", _) => true,
            ("wjd", "3MS", _) => true,
            _ => false,
        };

    private static bool IsAuditedThirdPersonProhibition(CandidateView verb) =>
        (verb.Root, verb.PersonGenderNumber) is
            ("$mt", "3FS")
            or ("Hzn", "3FS")
            or ("qrb", "3MP")
            or ("xrj", "3FP");

    private static bool IsNominalAppositionPair(
        CandidateView head,
        CandidateView dependent,
        CandidateView? following = null,
        CandidateView? previous = null) =>
        head.Lemma == ">ay~uhaA"
        && dependent.Lemma is "mud~av~ir" or "muz~am~il"
        || head.Lemma == "{ll~ah"
        && (dependent.Lemma == "rab~"
            || dependent.Lemma == ">aHad"
            && head.Case == dependent.Case)
        || head.Lemma == "ha`*aA"
        && dependent.Lemma is "quro'aAn" or "waEod"
        || head.Lemma == "*a`lik"
        && dependent.Lemma == "kita`b"
        || head.Lemma is not null
        && dependent.Lemma is not null
        && AppositionalLemmaPairs.Contains(
            (head.Lemma, dependent.Lemma))
        || head.Lemma is "EiysaY" or "masiyH"
        && dependent.Root == "bny"
        && following?.Lemma == "maroyam"
        || head.PrimaryTag == "DEM"
        && dependent.PrimaryTag == "REL"
        && previous?.HasTag("INTG") == true;

    private static bool IsLexicalNominalPredicate(
        CandidateView head,
        CandidateView dependent)
    {
        if (dependent.Lemma is null)
        {
            return false;
        }

        var headKey = head.PrimaryTag == "PRON"
            ? "PRON"
            : head.Lemma;
        return headKey is not null
            && NominalPredicateLemmaPairs.Contains((headKey, dependent.Lemma));
    }

    private static bool IsLexicalAdjective(
        CandidateView head,
        CandidateView dependent) =>
        head.Lemma is not null
        && dependent.Lemma is not null
        && (AdjectivalLemmaPairs.Contains((head.Lemma, dependent.Lemma))
            || dependent.PrimaryTag == "N"
            && dependent.Lemma == "*uw"
            && head.Case == "GEN"
            && dependent.Case == "GEN"
            || head.Lemma == "{ll~ah"
            && dependent.Lemma is "Eaziyz" or "r~aHoma`n"
            && head.Case == "GEN"
            && dependent.Case == "GEN");

    private static string ClassifyAccusativeVerbalRelation(
        CandidateView verb,
        CandidateView argument,
        int distance,
        bool includeCognate)
    {
        if (argument.Lemma is not null
            && verb.Root is not null
            && (TemporalLocativeLinkPairs.Contains(
                    (argument.Lemma, verb.Root))
                || argument.Lemma == "yawom"
                && (verb.Root == "qwl" && distance == 1
                    || verb.Root == "nZr" && distance == 2)))
        {
            return "link";
        }

        if (argument.Lemma is not null
            && verb.Lemma is not null
            && CognateLemmaVerbPairs.Contains(
                (argument.Lemma, verb.Lemma)))
        {
            return "cog";
        }

        if (argument.Lemma is not null
            && verb.Lemma is not null
            && SpecificationLemmaVerbPairs.Contains(
                (argument.Lemma, verb.Lemma)))
        {
            return "spec";
        }

        if (argument.Lemma is not null
            && verb.Lemma is not null
            && PurposeLemmaVerbPairs.Contains(
                (argument.Lemma, verb.Lemma)))
        {
            return "prp";
        }

        if (includeCognate
            && argument.Root is not null
            && argument.Root == verb.Root
            && distance is >= 2 and <= 3)
        {
            return "cog";
        }

        if (argument.PrimaryTag == "N"
            && argument.State == "INDEF"
            && verb.Aspect == "PERF"
            && (verb.Root == "kfy" && distance == 2
                || verb.Root == "swA" && distance == 1
                || verb.Root == "kbr"
                && argument.Root == "mqt"
                && distance == 1
                || verb.Root == "zyd"
                && argument.Root == "Avm"
                && distance == 1))
        {
            return "spec";
        }

        if (argument.Lemma == "{botigaA^'" && distance == 2)
        {
            return "prp";
        }

        if (argument.PrimaryTag == "N"
            && (CircumstantialAccusativeLemmas.Contains(argument.Lemma ?? string.Empty)
                && distance is >= 1 and <= 5
                || argument.Lemma is not null
                && verb.Root is not null
                && CircumstantialLexemeVerbPairs.Contains(
                    (argument.Lemma, verb.Root))
                && distance is >= 1 and <= 4
                || argument.Voice == "ACT"
                && verb.Root is not null
                && CircumstantialActiveParticipleVerbRoots.Contains(verb.Root)
                && distance is >= 1 and <= 4))
        {
            return "circ";
        }

        return "obj";
    }

    private static bool IsCausalVerb(CandidateView view) =>
        view.PrimaryTag == "V"
        && (view.Aspect != "IMPF" || view.Mood == "SUBJ");

    private static bool IsNominalTag(string tag) =>
        tag is "N" or "PN" or "ADJ" or "IMPN" or "PRON" or "DEM" or "REL" or "T" or "LOC";

    private static bool CanAttachAdjective(
        CandidateView nominal,
        CandidateView adjective)
    {
        if (nominal.PrimaryTag is not ("N" or "PN" or "T"))
        {
            return false;
        }

        if (nominal.PrimaryTag == "PN"
            && nominal.Case != "GEN"
            && adjective.Voice != "ACT"
            && (nominal.State is null || nominal.State != adjective.State))
        {
            return false;
        }

        return FeaturesCompatible(nominal.Case, adjective.Case)
            && FeaturesCompatible(
                nominal.PersonGenderNumber,
                adjective.PersonGenderNumber)
            && FeaturesCompatible(nominal.State, adjective.State);
    }

    private static bool CanCoordinate(CandidateView left, CandidateView right)
    {
        if (left.PrimaryTag == "V" || right.PrimaryTag == "V")
        {
            return left.PrimaryTag == right.PrimaryTag
                && FeaturesCompatible(left.Aspect, right.Aspect)
                && FeaturesCompatible(left.Voice, right.Voice);
        }

        if (left.IsNominal || right.IsNominal)
        {
            var isNominalPair =
                left.PrimaryTag is "N" or "PN"
                && right.PrimaryTag is "N" or "PN";
            var isSameClassModifier =
                left.PrimaryTag == right.PrimaryTag
                && left.PrimaryTag is "ADJ" or "LOC" or "T";
            return (isNominalPair || isSameClassModifier)
                && FeaturesCompatible(left.Case, right.Case)
                && FeaturesCompatible(
                    left.PersonGenderNumber,
                    right.PersonGenderNumber)
                && FeaturesCompatible(left.State, right.State);
        }

        return false;
    }

    private static int CoordinationScore(CandidateView left, CandidateView right)
    {
        var score = left.PrimaryTag == right.PrimaryTag
            ? CoordinationSameTagBonus
            : 0;
        score += MatchingFeatureScore(left.Case, right.Case);
        score += MatchingFeatureScore(
            left.PersonGenderNumber,
            right.PersonGenderNumber);
        score += MatchingFeatureScore(left.State, right.State);
        score += MatchingFeatureScore(left.Aspect, right.Aspect);
        return score;
    }

    private static bool FeaturesCompatible(string? left, string? right) =>
        left is null || right is null || left == right;

    private static int MatchingFeatureScore(string? left, string? right) =>
        left is not null && left == right
            ? CoordinationFeatureMatchBonus
            : 0;

    private static int FindPrimaryStemIndex(QacLexicalCandidate candidate) =>
        candidate.Segments
            .Select((segment, index) => (segment, index))
            .Where(pair => pair.segment.SegmentKind == nameof(QacSegmentKind.Stem))
            .Select(pair => pair.index)
            .DefaultIfEmpty(-1)
            .First();

    private static QacDeterministicGrammarParse EmptyResult(QacMorphologyParse morphology)
    {
        var graph = new QacDependencyGraph("empty", [], []);
        return new QacDeterministicGrammarParse
        {
            Status = QacGrammarStatus.Unverified,
            Morphology = morphology,
            SelectedAlternative = new QacGrammarAlternative(0, string.Empty, []),
            Graph = graph,
            Validation = QacSyntaxValidator.Validate(graph),
            Diagnostics =
            [
                new QacParserDiagnostic(
                    "ADG-QS2002",
                    "No Arabic word units were available for parsing.",
                    new SourceRange(0, morphology.OriginalText.Length)),
            ],
        };
    }

    private static QacDeterministicGrammarParse UnresolvedResult(
        QacMorphologyParse morphology)
    {
        var graph = new QacDependencyGraph("unresolved", [], []);
        return new QacDeterministicGrammarParse
        {
            Status = QacGrammarStatus.Unverified,
            Morphology = morphology,
            SelectedAlternative = new QacGrammarAlternative(0, string.Empty, []),
            Graph = graph,
            Validation = QacSyntaxValidator.Validate(graph),
            Diagnostics = morphology.Diagnostics,
        };
    }

    private sealed record CandidatePath(
        int Score,
        IReadOnlyList<QacSelectedMorphology> Selection)
    {
        public string Signature => string.Join(
            "\u001F",
            Selection.Select(item => item.MorphologySignature));
    }

    private sealed class CandidateView
    {
        public CandidateView(QacSelectedMorphology selection)
        {
            Selection = selection;
            StemIndex = FindPrimaryStemIndex(selection.Candidate);
            Stem = StemIndex >= 0
                ? selection.Candidate.Segments[StemIndex]
                : selection.Candidate.Segments.First();
        }

        public QacSelectedMorphology Selection { get; }

        public int StemIndex { get; }

        public QacNormalizedMorphologyRecord Stem { get; }

        public string PrimaryTag => Stem.Tag;

        public string? Case => Stem.GrammaticalCase;

        public string? Aspect => Stem.Aspect;

        public string? Mood => Stem.Mood;

        public string? Voice => Stem.Voice;

        public string? State => Stem.State;

        public string? PersonGenderNumber => Stem.PersonGenderNumber;

        public string? SpecialClass => Stem.SpecialClass;

        public string? Root => Stem.Root;

        public string? Lemma => Stem.Lemma;

        public bool IsNominal => PrimaryTag is
            "N" or "PN" or "ADJ" or "IMPN" or "PRON" or "DEM" or "REL" or "T" or "LOC";

        public bool HasTag(string tag) =>
            Selection.Candidate.Segments.Any(segment => segment.Tag == tag);

        public bool HasAttachedPronounSuffix =>
            Selection.Candidate.Segments.Any(segment =>
                segment.SegmentKind == nameof(QacSegmentKind.Suffix)
                && segment.Tag == "PRON");
    }
}
