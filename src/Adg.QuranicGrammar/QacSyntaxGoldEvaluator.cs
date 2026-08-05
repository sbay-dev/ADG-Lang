using System.Security.Cryptography;
using System.Text;
using Adg.QuranicCorpus;

namespace Adg.QuranicGrammar;

public sealed record QacSyntaxRelationMetric(
    long GoldCount,
    long GeneratedCount,
    long TruePositiveCount,
    double Precision,
    double Recall,
    double F1);

public sealed record QacSyntaxGoldMissSample(
    string Verse,
    string Text,
    string Status,
    long GoldEdgeCount,
    long GeneratedEdgeCount,
    long TruePositiveCount,
    SortedDictionary<string, long> MissingRelationCounts);

public sealed class QacSyntaxGoldEvaluation
{
    public required string SyntaxInputSha256 { get; init; }

    public required string CompactMorphologyInputSha256 { get; init; }

    public required string TreebankGraphMerkleRoot { get; init; }

    public long TreebankGraphCount { get; init; }

    public long TreebankEdgeCount { get; init; }

    public long CoveredVerseCount { get; init; }

    public long CoveredTerminalNodeCount { get; init; }

    public long ComparableGoldEdgeCount { get; init; }

    public long DuplicateComparableGoldEdgeCount { get; init; }

    public long ExcludedGoldEdgeCount { get; init; }

    public SortedDictionary<string, long> ExcludedEndpointKindCounts { get; init; } =
        new(StringComparer.Ordinal);

    public long GeneratedComparableEdgeCount { get; init; }

    public long GoldUnlabeledComparableEdgeCount { get; init; }

    public long GeneratedUnlabeledComparableEdgeCount { get; init; }

    public long ExactTruePositiveCount { get; init; }

    public long UnlabeledTruePositiveCount { get; init; }

    public double ExactPrecision { get; init; }

    public double ExactRecall { get; init; }

    public double ExactF1 { get; init; }

    public double UnlabeledPrecision { get; init; }

    public double UnlabeledRecall { get; init; }

    public double UnlabeledF1 { get; init; }

    public long ComparableGoldPhraseCount { get; init; }

    public long ExcludedGoldPhraseCount { get; init; }

    public long GeneratedComparablePhraseCount { get; init; }

    public long PhraseTruePositiveCount { get; init; }

    public double PhrasePrecision { get; init; }

    public double PhraseRecall { get; init; }

    public double PhraseF1 { get; init; }

    public long ValidVerseCount { get; init; }

    public long InvalidVerseCount { get; init; }

    public long UnverifiedVerseCount { get; init; }

    public long GoldRelationCoverage { get; init; }

    public long GeneratedRelationCoverage { get; init; }

    public SortedDictionary<string, QacSyntaxRelationMetric> RelationMetrics { get; init; } =
        new(StringComparer.Ordinal);

    public SortedDictionary<string, QacSyntaxRelationMetric> PhraseMetrics { get; init; } =
        new(StringComparer.Ordinal);

    public SortedDictionary<string, QacSyntaxRelationMetric> PhraseSpanMetrics
    {
        get;
        init;
    } = new(StringComparer.Ordinal);

    public SortedDictionary<string, long> GoldPhraseBoundarySignatureCounts
    {
        get;
        init;
    } = new(StringComparer.Ordinal);

    public SortedDictionary<string, long> GeneratedPhraseBoundarySignatureCounts
    {
        get;
        init;
    } = new(StringComparer.Ordinal);

    public SortedDictionary<string, long> GoldMissingPhraseBoundarySignatureCounts
    {
        get;
        init;
    } = new(StringComparer.Ordinal);

    public SortedDictionary<string, List<string>> GoldMissingPhraseBoundarySamples
    {
        get;
        init;
    } = new(StringComparer.Ordinal);

    public SortedDictionary<string, long> GeneratedFalsePositivePhraseBoundarySignatureCounts
    {
        get;
        init;
    } = new(StringComparer.Ordinal);

    public SortedDictionary<string, long> ExactPhraseBoundarySignatureCounts
    {
        get;
        init;
    } = new(StringComparer.Ordinal);

    public SortedDictionary<string, long> GoldMissingEdgeSignatureCounts
    {
        get;
        init;
    } = new(StringComparer.Ordinal);

    public SortedDictionary<string, long> GoldMissingEdgeLexicalSignatureCounts
    {
        get;
        init;
    } = new(StringComparer.Ordinal);

    public SortedDictionary<string, List<string>> GoldMissingEdgeLexicalSamples
    {
        get;
        init;
    } = new(StringComparer.Ordinal);

    public SortedDictionary<string, long> GeneratedFalsePositiveEdgeSignatureCounts
    {
        get;
        init;
    } = new(StringComparer.Ordinal);

    public SortedDictionary<string, long> GeneratedFalsePositiveEdgeLexicalSignatureCounts
    {
        get;
        init;
    } = new(StringComparer.Ordinal);

    public SortedDictionary<string, long> ExactEdgeSignatureCounts
    {
        get;
        init;
    } = new(StringComparer.Ordinal);

    public SortedDictionary<string, long> ExactEdgeLexicalSignatureCounts
    {
        get;
        init;
    } = new(StringComparer.Ordinal);

    public SortedDictionary<string, List<string>> ExactEdgeLexicalSamples
    {
        get;
        init;
    } = new(StringComparer.Ordinal);

    public SortedDictionary<string, long> GeneratedEdgeErrorCategoryCounts
    {
        get;
        init;
    } = new(StringComparer.Ordinal);

    public SortedDictionary<string, long> GeneratedRelationConfusionCounts
    {
        get;
        init;
    } = new(StringComparer.Ordinal);

    public SortedDictionary<string, long> GeneratedRelationConfusionSignatureCounts
    {
        get;
        init;
    } = new(StringComparer.Ordinal);

    public SortedDictionary<string, long> GeneratedRelationConfusionLexicalSignatureCounts
    {
        get;
        init;
    } = new(StringComparer.Ordinal);

    public SortedDictionary<string, List<string>>
        GeneratedRelationConfusionLexicalSamples
    {
        get;
        init;
    } = new(StringComparer.Ordinal);

    public IReadOnlyList<QacSyntaxGoldMissSample> MissSamples { get; init; } = [];

    public required string EvaluationMerkleRoot { get; init; }
}

public static class QacSyntaxGoldEvaluator
{
    public static QacSyntaxGoldEvaluation Evaluate(
        QacMorphologyLexicon lexicon,
        QacVerseCorpus corpus,
        QacSyntaxTreebank treebank)
    {
        ArgumentNullException.ThrowIfNull(lexicon);
        ArgumentNullException.ThrowIfNull(corpus);
        ArgumentNullException.ThrowIfNull(treebank);

        var goldByVerse = new Dictionary<QacVerseKey, HashSet<EdgeKey>>();
        var goldPhrasesByVerse = new Dictionary<QacVerseKey, HashSet<PhraseKey>>();
        var terminalsByVerse = new Dictionary<QacVerseKey, HashSet<QacLocation>>();
        var goldTerminals = new Dictionary<QacLocation, QacSyntaxNode>();
        var excludedKinds = new SortedDictionary<string, long>(StringComparer.Ordinal);
        long treebankEdgeCount = 0;
        long duplicateComparableGoldEdgeCount = 0;
        long coveredTerminalNodeCount = 0;
        long excludedGoldPhraseCount = 0;
        var goldPhraseBoundarySignatures = new SortedDictionary<string, long>(
            StringComparer.Ordinal);
        var generatedPhraseBoundarySignatures =
            new SortedDictionary<string, long>(StringComparer.Ordinal);
        var goldMissingPhraseBoundarySignatures =
            new SortedDictionary<string, long>(StringComparer.Ordinal);
        var goldMissingPhraseBoundarySamples =
            new SortedDictionary<string, List<string>>(StringComparer.Ordinal);
        var generatedFalsePositivePhraseBoundarySignatures =
            new SortedDictionary<string, long>(StringComparer.Ordinal);
        var exactPhraseBoundarySignatures =
            new SortedDictionary<string, long>(StringComparer.Ordinal);
        var goldMissingEdgeSignatures =
            new SortedDictionary<string, long>(StringComparer.Ordinal);
        var goldMissingEdgeLexicalSignatures =
            new SortedDictionary<string, long>(StringComparer.Ordinal);
        var goldMissingEdgeLexicalSamples =
            new SortedDictionary<string, List<string>>(StringComparer.Ordinal);
        var generatedFalsePositiveEdgeSignatures =
            new SortedDictionary<string, long>(StringComparer.Ordinal);
        var generatedFalsePositiveEdgeLexicalSignatures =
            new SortedDictionary<string, long>(StringComparer.Ordinal);
        var exactEdgeSignatures =
            new SortedDictionary<string, long>(StringComparer.Ordinal);
        var exactEdgeLexicalSignatures =
            new SortedDictionary<string, long>(StringComparer.Ordinal);
        var exactEdgeLexicalSamples =
            new SortedDictionary<string, List<string>>(StringComparer.Ordinal);
        var generatedEdgeErrorCategories =
            new SortedDictionary<string, long>(StringComparer.Ordinal);
        var generatedRelationConfusions =
            new SortedDictionary<string, long>(StringComparer.Ordinal);
        var generatedRelationConfusionSignatures =
            new SortedDictionary<string, long>(StringComparer.Ordinal);
        var generatedRelationConfusionLexicalSignatures =
            new SortedDictionary<string, long>(StringComparer.Ordinal);
        var generatedRelationConfusionLexicalSamples =
            new SortedDictionary<string, List<string>>(StringComparer.Ordinal);

        foreach (var sourceGraph in treebank.Graphs)
        {
            var nodes = sourceGraph.Graph.Nodes.ToDictionary(node => node.Id);
            foreach (var node in sourceGraph.Graph.Nodes)
            {
                if (node.Kind != QacSyntaxNodeKind.Terminal || node.Location is not { } location)
                {
                    continue;
                }

                var terminals = GetOrAdd(terminalsByVerse, location.VerseKey);
                if (terminals.Add(location))
                {
                    coveredTerminalNodeCount++;
                }

                if (goldTerminals.TryGetValue(location, out var existingNode)
                    && existingNode.Tag != node.Tag)
                {
                    throw new InvalidDataException(
                        $"Treebank terminal {location} has conflicting tags "
                        + $"'{existingNode.Tag}' and '{node.Tag}'.");
                }

                goldTerminals[location] = node;
            }

            foreach (var phrase in sourceGraph.Graph.Nodes.Where(node =>
                         node.Kind == QacSyntaxNodeKind.Phrase))
            {
                if (phrase.SpanStartTerminal is not { } startAlias
                    || phrase.SpanEndTerminal is not { } endAlias
                    || !TryResolvePhraseBoundary(
                        phrase.Id,
                        startAlias,
                        nodes,
                        out var startNode)
                    || !TryResolvePhraseBoundary(
                        phrase.Id,
                        endAlias,
                        nodes,
                        out var endNode)
                    || startNode.Kind != QacSyntaxNodeKind.Terminal
                    || endNode.Kind != QacSyntaxNodeKind.Terminal
                    || startNode.Location is not { } startLocation
                    || endNode.Location is not { } endLocation
                    || startLocation.VerseKey != endLocation.VerseKey)
                {
                    excludedGoldPhraseCount++;
                    continue;
                }

                GetOrAdd(goldPhrasesByVerse, startLocation.VerseKey).Add(
                    new PhraseKey(startLocation, endLocation, phrase.Tag));
                Increment(
                    goldPhraseBoundarySignatures,
                    $"{phrase.Tag}|{startNode.Tag}->{endNode.Tag}|"
                    + $"{endLocation.Word - startLocation.Word + 1}");
            }

            foreach (var edge in sourceGraph.Graph.Edges)
            {
                treebankEdgeCount++;
                var dependent = nodes[edge.DependentId];
                var head = nodes[edge.HeadId];
                if (dependent.Kind == QacSyntaxNodeKind.Terminal
                    && head.Kind == QacSyntaxNodeKind.Terminal
                    && dependent.Location is { } dependentLocation
                    && head.Location is { } headLocation
                    && dependentLocation.VerseKey == headLocation.VerseKey)
                {
                    var edges = GetOrAdd(goldByVerse, dependentLocation.VerseKey);
                    if (!edges.Add(
                            new EdgeKey(
                                dependentLocation,
                                headLocation,
                                edge.Relation)))
                    {
                        duplicateComparableGoldEdgeCount++;
                    }

                    continue;
                }

                var exclusion = dependent.Kind == QacSyntaxNodeKind.Terminal
                    && head.Kind == QacSyntaxNodeKind.Terminal
                    ? "TerminalCrossVerse"
                    : $"{dependent.Kind}->{head.Kind}";
                excludedKinds.TryGetValue(exclusion, out var exclusionCount);
                excludedKinds[exclusion] = exclusionCount + 1;
            }
        }

        var parser = new QacDeterministicGrammarParser(
            lexicon,
            enableHeuristicFallback: false);
        var verses = corpus.Verses.ToDictionary(
            verse => new QacVerseKey(verse.Chapter, verse.Verse));
        var generatedByRelation = new Dictionary<string, long>(StringComparer.Ordinal);
        var goldByRelation = new Dictionary<string, long>(StringComparer.Ordinal);
        var truePositiveByRelation = new Dictionary<string, long>(StringComparer.Ordinal);
        var generatedPhrasesByTag = new Dictionary<string, long>(StringComparer.Ordinal);
        var goldPhrasesByTag = new Dictionary<string, long>(StringComparer.Ordinal);
        var truePositivePhrasesByTag = new Dictionary<string, long>(
            StringComparer.Ordinal);
        var generatedPhraseSpans = new Dictionary<string, long>(StringComparer.Ordinal);
        var goldPhraseSpans = new Dictionary<string, long>(StringComparer.Ordinal);
        var truePositivePhraseSpans = new Dictionary<string, long>(
            StringComparer.Ordinal);
        var missSamples = new List<QacSyntaxGoldMissSample>();
        var leaves = new List<byte[]>();
        long generatedComparableEdgeCount = 0;
        long goldUnlabeledComparableEdgeCount = 0;
        long generatedUnlabeledComparableEdgeCount = 0;
        long exactTruePositiveCount = 0;
        long unlabeledTruePositiveCount = 0;
        long validVerseCount = 0;
        long invalidVerseCount = 0;
        long unverifiedVerseCount = 0;
        long generatedComparablePhraseCount = 0;
        long phraseTruePositiveCount = 0;

        foreach (var verseKey in terminalsByVerse.Keys
                     .OrderBy(key => key.Chapter)
                     .ThenBy(key => key.Verse))
        {
            if (!verses.TryGetValue(verseKey, out var verse))
            {
                throw new InvalidDataException(
                    $"Treebank verse {verseKey} is absent from the reconstructed corpus.");
            }

            var parse = parser.Parse(verse.Text);
            switch (parse.Status)
            {
                case QacGrammarStatus.Valid:
                    validVerseCount++;
                    break;
                case QacGrammarStatus.Invalid:
                    invalidVerseCount++;
                    break;
                case QacGrammarStatus.Unverified:
                    unverifiedVerseCount++;
                    break;
                default:
                    throw new InvalidOperationException();
            }

            var gold = goldByVerse.GetValueOrDefault(verseKey) ?? [];
            var goldPhrases = goldPhrasesByVerse.GetValueOrDefault(verseKey) ?? [];
            var terminalCoverage = terminalsByVerse[verseKey];
            var generated = new HashSet<EdgeKey>();
            var generatedNodes = parse.Graph.Nodes.ToDictionary(node => node.Id);
            var generatedTerminalsByLocation =
                new Dictionary<QacLocation, QacSyntaxNode>();
            foreach (var node in generatedNodes.Values)
            {
                if (TryMapGeneratedNode(verse, node, out var location)
                    && terminalCoverage.Contains(location))
                {
                    generatedTerminalsByLocation[location] = node;
                }
            }

            foreach (var edge in parse.Graph.Edges)
            {
                if (!generatedNodes.TryGetValue(edge.DependentId, out var dependent)
                    || !generatedNodes.TryGetValue(edge.HeadId, out var head)
                    || !TryMapGeneratedNode(verse, dependent, out var dependentLocation)
                    || !TryMapGeneratedNode(verse, head, out var headLocation)
                    || !terminalCoverage.Contains(dependentLocation)
                    || !terminalCoverage.Contains(headLocation))
                {
                    continue;
                }

                generated.Add(
                    new EdgeKey(
                        dependentLocation,
                        headLocation,
                        edge.Relation));
            }

            var generatedPhrases = new HashSet<PhraseKey>();
            var generatedTerminals = parse.Graph.Nodes
                .Where(node => node.Kind == QacSyntaxNodeKind.Terminal)
                .ToArray();
            foreach (var phrase in parse.Graph.Nodes.Where(node =>
                         node.Kind == QacSyntaxNodeKind.Phrase))
            {
                if (phrase.SpanStartTerminal is not { } start
                    || phrase.SpanEndTerminal is not { } end
                    || start < 0
                    || end < start
                    || end >= generatedTerminals.Length
                    || !TryMapGeneratedNode(
                        verse,
                        generatedTerminals[start],
                        out var startLocation)
                    || !TryMapGeneratedNode(
                        verse,
                        generatedTerminals[end],
                        out var endLocation)
                    || !terminalCoverage.Contains(startLocation)
                    || !terminalCoverage.Contains(endLocation))
                {
                    continue;
                }

                if (generatedPhrases.Add(
                        new PhraseKey(startLocation, endLocation, phrase.Tag)))
                {
                    Increment(
                        generatedPhraseBoundarySignatures,
                        $"{phrase.Tag}|{generatedTerminals[start].Tag}->"
                        + $"{generatedTerminals[end].Tag}|"
                        + $"{endLocation.Word - startLocation.Word + 1}");
                }
            }

            foreach (var edge in gold)
            {
                Increment(goldByRelation, edge.Relation);
            }

            foreach (var edge in generated)
            {
                Increment(generatedByRelation, edge.Relation);
            }

            foreach (var phrase in goldPhrases)
            {
                Increment(goldPhrasesByTag, phrase.Tag);
                Increment(goldPhraseSpans, PhraseSpanSignature(phrase));
            }

            foreach (var phrase in generatedPhrases)
            {
                Increment(generatedPhrasesByTag, phrase.Tag);
                Increment(generatedPhraseSpans, PhraseSpanSignature(phrase));
            }

            var exact = generated.Intersect(gold).ToArray();
            foreach (var edge in exact)
            {
                Increment(truePositiveByRelation, edge.Relation);
                Increment(
                    exactEdgeSignatures,
                    EdgeSignature(edge, goldTerminals));
                Increment(
                    exactEdgeLexicalSignatures,
                    EdgeLexicalSignature(edge, goldTerminals));
                AddSample(
                    exactEdgeLexicalSamples,
                    EdgeLexicalSignature(edge, goldTerminals),
                    $"{verse.Location}\t{verse.Text}");
            }

            var exactPhrases = generatedPhrases.Intersect(goldPhrases).ToArray();
            foreach (var phrase in exactPhrases)
            {
                Increment(truePositivePhrasesByTag, phrase.Tag);
                Increment(
                    truePositivePhraseSpans,
                    PhraseSpanSignature(phrase));
                Increment(
                    exactPhraseBoundarySignatures,
                    PhraseBoundarySignature(phrase, goldTerminals));
            }

            foreach (var phrase in goldPhrases.Except(generatedPhrases))
            {
                var signature = PhraseBoundarySignature(phrase, goldTerminals);
                Increment(
                    goldMissingPhraseBoundarySignatures,
                    signature);
                AddSample(
                    goldMissingPhraseBoundarySamples,
                    signature,
                    $"{verse.Location}\t{verse.Text}");
            }

            foreach (var phrase in generatedPhrases.Except(goldPhrases))
            {
                Increment(
                    generatedFalsePositivePhraseBoundarySignatures,
                    PhraseBoundarySignature(
                        phrase,
                        generatedTerminalsByLocation));
            }

            var goldUnlabeled = gold
                .Select(edge => new UnlabeledEdgeKey(edge.Dependent, edge.Head))
                .ToHashSet();
            var generatedUnlabeled = generated
                .Select(edge => new UnlabeledEdgeKey(edge.Dependent, edge.Head))
                .ToHashSet();
            var unlabeled = generatedUnlabeled.Intersect(goldUnlabeled).Count();

            generatedComparableEdgeCount += generated.Count;
            goldUnlabeledComparableEdgeCount += goldUnlabeled.Count;
            generatedUnlabeledComparableEdgeCount += generatedUnlabeled.Count;
            exactTruePositiveCount += exact.Length;
            unlabeledTruePositiveCount += unlabeled;
            generatedComparablePhraseCount += generatedPhrases.Count;
            phraseTruePositiveCount += exactPhrases.Length;

            var missing = gold.Except(generated).ToArray();
            foreach (var edge in missing)
            {
                Increment(
                    goldMissingEdgeSignatures,
                    EdgeSignature(edge, goldTerminals));
                Increment(
                    goldMissingEdgeLexicalSignatures,
                    EdgeLexicalSignature(edge, goldTerminals));
                AddSample(
                    goldMissingEdgeLexicalSamples,
                    EdgeLexicalSignature(edge, goldTerminals),
                    $"{verse.Location}\t{verse.Text}");
            }

            foreach (var edge in generated.Except(gold))
            {
                Increment(
                    generatedFalsePositiveEdgeSignatures,
                    EdgeSignature(edge, generatedTerminalsByLocation));
                Increment(
                    generatedFalsePositiveEdgeLexicalSignatures,
                    EdgeLexicalSignature(edge, generatedTerminalsByLocation));
                Increment(
                    generatedEdgeErrorCategories,
                    ClassifyGeneratedEdgeError(edge, gold));
                foreach (var goldRelation in gold
                             .Where(goldEdge =>
                                 goldEdge.Dependent == edge.Dependent
                                 && goldEdge.Head == edge.Head)
                             .Select(goldEdge => goldEdge.Relation)
                             .Distinct(StringComparer.Ordinal))
                {
                    Increment(
                        generatedRelationConfusions,
                        $"{edge.Relation}->{goldRelation}");
                    Increment(
                        generatedRelationConfusionSignatures,
                        $"{edge.Relation}->{goldRelation}|"
                        + EdgeSignature(edge, goldTerminals));
                    Increment(
                        generatedRelationConfusionLexicalSignatures,
                        $"{edge.Relation}->{goldRelation}|"
                        + EdgeLexicalSignature(edge, goldTerminals));
                    AddSample(
                        generatedRelationConfusionLexicalSamples,
                        $"{edge.Relation}->{goldRelation}|"
                        + EdgeLexicalSignature(edge, goldTerminals),
                        $"{verse.Location}\t{verse.Text}");
                }
            }

            if (missing.Length > 0)
            {
                var missingRelations = new SortedDictionary<string, long>(
                    StringComparer.Ordinal);
                foreach (var edge in missing)
                {
                    missingRelations.TryGetValue(edge.Relation, out var count);
                    missingRelations[edge.Relation] = count + 1;
                }

                missSamples.Add(
                    new QacSyntaxGoldMissSample(
                        verse.Location,
                        verse.Text,
                        parse.Status.ToString(),
                        gold.Count,
                        generated.Count,
                        exact.Length,
                        missingRelations));
            }

            leaves.Add(
                SHA256.HashData(
                    Encoding.UTF8.GetBytes(
                        string.Concat(
                            verse.Location,
                            "\t",
                            parse.Status,
                            "\t",
                            string.Join(
                                "\u001E",
                                gold.Order().Select(FormatEdge)),
                            "\t",
                            string.Join(
                                "\u001E",
                                generated.Order().Select(FormatEdge)),
                            "\t",
                            string.Join(
                                "\u001E",
                                goldPhrases.Order().Select(FormatPhrase)),
                            "\t",
                            string.Join(
                                "\u001E",
                                generatedPhrases.Order().Select(FormatPhrase))))));
        }

        var comparableGoldEdgeCount = goldByVerse.Values.Sum(edges => edges.Count);
        var exactPrecision = Ratio(
            exactTruePositiveCount,
            generatedComparableEdgeCount);
        var exactRecall = Ratio(exactTruePositiveCount, comparableGoldEdgeCount);
        var unlabeledPrecision = Ratio(
            unlabeledTruePositiveCount,
            generatedUnlabeledComparableEdgeCount);
        var unlabeledRecall = Ratio(
            unlabeledTruePositiveCount,
            goldUnlabeledComparableEdgeCount);
        var comparableGoldPhraseCount =
            goldPhrasesByVerse.Values.Sum(phrases => phrases.Count);
        var phrasePrecision = Ratio(
            phraseTruePositiveCount,
            generatedComparablePhraseCount);
        var phraseRecall = Ratio(
            phraseTruePositiveCount,
            comparableGoldPhraseCount);
        var relations = QacSyntaxCatalog.DependencyRelations.Keys
            .Union(goldByRelation.Keys, StringComparer.Ordinal)
            .Union(generatedByRelation.Keys, StringComparer.Ordinal)
            .Order(StringComparer.Ordinal);
        var relationMetrics = new SortedDictionary<string, QacSyntaxRelationMetric>(
            StringComparer.Ordinal);
        foreach (var relation in relations)
        {
            var goldCount = goldByRelation.GetValueOrDefault(relation);
            var generatedCount = generatedByRelation.GetValueOrDefault(relation);
            var truePositiveCount = truePositiveByRelation.GetValueOrDefault(relation);
            var precision = Ratio(truePositiveCount, generatedCount);
            var recall = Ratio(truePositiveCount, goldCount);
            relationMetrics[relation] = new QacSyntaxRelationMetric(
                goldCount,
                generatedCount,
                truePositiveCount,
                precision,
                recall,
                HarmonicMean(precision, recall));
        }

        var phraseMetrics = new SortedDictionary<string, QacSyntaxRelationMetric>(
            StringComparer.Ordinal);
        foreach (var tag in QacSyntaxCatalog.PhraseTags.Keys.Order(StringComparer.Ordinal))
        {
            var goldCount = goldPhrasesByTag.GetValueOrDefault(tag);
            var generatedCount = generatedPhrasesByTag.GetValueOrDefault(tag);
            var truePositiveCount = truePositivePhrasesByTag.GetValueOrDefault(tag);
            var precision = Ratio(truePositiveCount, generatedCount);
            var recall = Ratio(truePositiveCount, goldCount);
            phraseMetrics[tag] = new QacSyntaxRelationMetric(
                goldCount,
                generatedCount,
                truePositiveCount,
                precision,
                recall,
                HarmonicMean(precision, recall));
        }

        var phraseSpanMetrics =
            new SortedDictionary<string, QacSyntaxRelationMetric>(
                StringComparer.Ordinal);
        foreach (var signature in goldPhraseSpans.Keys
                     .Union(generatedPhraseSpans.Keys, StringComparer.Ordinal)
                     .Order(StringComparer.Ordinal))
        {
            var goldCount = goldPhraseSpans.GetValueOrDefault(signature);
            var generatedCount = generatedPhraseSpans.GetValueOrDefault(signature);
            var truePositiveCount =
                truePositivePhraseSpans.GetValueOrDefault(signature);
            var precision = Ratio(truePositiveCount, generatedCount);
            var recall = Ratio(truePositiveCount, goldCount);
            phraseSpanMetrics[signature] = new QacSyntaxRelationMetric(
                goldCount,
                generatedCount,
                truePositiveCount,
                precision,
                recall,
                HarmonicMean(precision, recall));
        }

        return new QacSyntaxGoldEvaluation
        {
            SyntaxInputSha256 = treebank.InputSha256,
            CompactMorphologyInputSha256 =
                treebank.CompactMorphologyInputSha256 ?? string.Empty,
            TreebankGraphMerkleRoot = treebank.GraphMerkleRoot,
            TreebankGraphCount = treebank.Graphs.Count,
            TreebankEdgeCount = treebankEdgeCount,
            CoveredVerseCount = terminalsByVerse.Count,
            CoveredTerminalNodeCount = coveredTerminalNodeCount,
            ComparableGoldEdgeCount = comparableGoldEdgeCount,
            DuplicateComparableGoldEdgeCount = duplicateComparableGoldEdgeCount,
            ExcludedGoldEdgeCount = treebankEdgeCount - comparableGoldEdgeCount,
            ExcludedEndpointKindCounts = excludedKinds,
            GeneratedComparableEdgeCount = generatedComparableEdgeCount,
            GoldUnlabeledComparableEdgeCount = goldUnlabeledComparableEdgeCount,
            GeneratedUnlabeledComparableEdgeCount =
                generatedUnlabeledComparableEdgeCount,
            ExactTruePositiveCount = exactTruePositiveCount,
            UnlabeledTruePositiveCount = unlabeledTruePositiveCount,
            ExactPrecision = exactPrecision,
            ExactRecall = exactRecall,
            ExactF1 = HarmonicMean(exactPrecision, exactRecall),
            UnlabeledPrecision = unlabeledPrecision,
            UnlabeledRecall = unlabeledRecall,
            UnlabeledF1 = HarmonicMean(unlabeledPrecision, unlabeledRecall),
            ComparableGoldPhraseCount = comparableGoldPhraseCount,
            ExcludedGoldPhraseCount = excludedGoldPhraseCount,
            GeneratedComparablePhraseCount = generatedComparablePhraseCount,
            PhraseTruePositiveCount = phraseTruePositiveCount,
            PhrasePrecision = phrasePrecision,
            PhraseRecall = phraseRecall,
            PhraseF1 = HarmonicMean(phrasePrecision, phraseRecall),
            ValidVerseCount = validVerseCount,
            InvalidVerseCount = invalidVerseCount,
            UnverifiedVerseCount = unverifiedVerseCount,
            GoldRelationCoverage = goldByRelation.Count(pair => pair.Value > 0),
            GeneratedRelationCoverage = generatedByRelation.Count(pair => pair.Value > 0),
            RelationMetrics = relationMetrics,
            PhraseMetrics = phraseMetrics,
            PhraseSpanMetrics = phraseSpanMetrics,
            GoldPhraseBoundarySignatureCounts =
                goldPhraseBoundarySignatures,
            GeneratedPhraseBoundarySignatureCounts =
                generatedPhraseBoundarySignatures,
            GoldMissingPhraseBoundarySignatureCounts =
                goldMissingPhraseBoundarySignatures,
            GoldMissingPhraseBoundarySamples =
                goldMissingPhraseBoundarySamples,
            GeneratedFalsePositivePhraseBoundarySignatureCounts =
                generatedFalsePositivePhraseBoundarySignatures,
            ExactPhraseBoundarySignatureCounts =
                exactPhraseBoundarySignatures,
            GoldMissingEdgeSignatureCounts = goldMissingEdgeSignatures,
            GoldMissingEdgeLexicalSignatureCounts =
                goldMissingEdgeLexicalSignatures,
            GoldMissingEdgeLexicalSamples = goldMissingEdgeLexicalSamples,
            GeneratedFalsePositiveEdgeSignatureCounts =
                generatedFalsePositiveEdgeSignatures,
            GeneratedFalsePositiveEdgeLexicalSignatureCounts =
                generatedFalsePositiveEdgeLexicalSignatures,
            ExactEdgeSignatureCounts = exactEdgeSignatures,
            ExactEdgeLexicalSignatureCounts = exactEdgeLexicalSignatures,
            ExactEdgeLexicalSamples = exactEdgeLexicalSamples,
            GeneratedEdgeErrorCategoryCounts = generatedEdgeErrorCategories,
            GeneratedRelationConfusionCounts = generatedRelationConfusions,
            GeneratedRelationConfusionSignatureCounts =
                generatedRelationConfusionSignatures,
            GeneratedRelationConfusionLexicalSignatureCounts =
                generatedRelationConfusionLexicalSignatures,
            GeneratedRelationConfusionLexicalSamples =
                generatedRelationConfusionLexicalSamples,
            MissSamples = missSamples
                .OrderByDescending(sample => sample.GoldEdgeCount - sample.TruePositiveCount)
                .ThenBy(sample => sample.Verse, StringComparer.Ordinal)
                .Take(50)
                .ToArray(),
            EvaluationMerkleRoot = QacMerkle.ComputeRoot(leaves),
        };
    }

    private static bool TryMapGeneratedNode(
        QacVerseText verse,
        QacSyntaxNode node,
        out QacLocation location)
    {
        location = default;
        if (node.Kind != QacSyntaxNodeKind.Terminal
            || node.Id.Length < 4
            || node.Id[0] != 'u')
        {
            return false;
        }

        var separator = node.Id.IndexOf('s', 1);
        if (separator < 2
            || !int.TryParse(node.Id.AsSpan(1, separator - 1), out var unitIndex)
            || !int.TryParse(node.Id.AsSpan(separator + 1), out var segmentIndex)
            || unitIndex < 0
            || unitIndex >= verse.Words.Count
            || segmentIndex < 0)
        {
            return false;
        }

        location = new QacLocation(
            verse.Chapter,
            verse.Verse,
            verse.Words[unitIndex].Word,
            segmentIndex + 1);
        return true;
    }

    private static bool TryResolvePhraseBoundary(
        string phraseId,
        int alias,
        IReadOnlyDictionary<string, QacSyntaxNode> nodes,
        out QacSyntaxNode node)
    {
        node = null!;
        var separator = phraseId.LastIndexOf('n');
        if (separator <= 0
            || !nodes.TryGetValue(
                $"{phraseId[..(separator + 1)]}{alias}",
                out var resolved))
        {
            return false;
        }

        node = resolved;
        return true;
    }

    private static HashSet<TValue> GetOrAdd<TKey, TValue>(
        IDictionary<TKey, HashSet<TValue>> dictionary,
        TKey key)
        where TKey : notnull
    {
        if (!dictionary.TryGetValue(key, out var values))
        {
            values = [];
            dictionary.Add(key, values);
        }

        return values;
    }

    private static void Increment(IDictionary<string, long> counts, string key)
    {
        counts.TryGetValue(key, out var count);
        counts[key] = count + 1;
    }

    private static void AddSample(
        IDictionary<string, List<string>> samples,
        string key,
        string sample)
    {
        if (!samples.TryGetValue(key, out var values))
        {
            values = [];
            samples.Add(key, values);
        }

        if (values.Count < 10 && !values.Contains(sample, StringComparer.Ordinal))
        {
            values.Add(sample);
        }
    }

    private static double Ratio(long numerator, long denominator) =>
        denominator == 0 ? 0 : (double)numerator / denominator;

    private static double HarmonicMean(double precision, double recall) =>
        precision + recall == 0 ? 0 : 2 * precision * recall / (precision + recall);

    private static string FormatEdge(EdgeKey edge) =>
        $"{edge.Dependent}:{edge.Relation}:{edge.Head}";

    private static string FormatPhrase(PhraseKey phrase) =>
        $"{phrase.Start}:{phrase.Tag}:{phrase.End}";

    private static string PhraseSpanSignature(PhraseKey phrase) =>
        $"{phrase.Tag}:{phrase.End.Word - phrase.Start.Word + 1}";

    private static string PhraseBoundarySignature(
        PhraseKey phrase,
        IReadOnlyDictionary<QacLocation, QacSyntaxNode> terminals)
    {
        var startTag = terminals.TryGetValue(phrase.Start, out var start)
            ? TerminalSignature(start)
            : "?";
        var endTag = terminals.TryGetValue(phrase.End, out var end)
            ? TerminalSignature(end)
            : "?";
        return $"{phrase.Tag}|{startTag}->{endTag}|"
            + $"{phrase.End.Word - phrase.Start.Word + 1}";
    }

    private static string EdgeSignature(
        EdgeKey edge,
        IReadOnlyDictionary<QacLocation, QacSyntaxNode> terminals)
    {
        var dependentTag = terminals.TryGetValue(edge.Dependent, out var dependent)
            ? TerminalSignature(dependent)
            : "?";
        var headTag = terminals.TryGetValue(edge.Head, out var head)
            ? TerminalSignature(head)
            : "?";
        var wordDelta = edge.Head.Word - edge.Dependent.Word;
        var direction = wordDelta switch
        {
            < 0 => "left",
            > 0 => "right",
            _ => "same",
        };
        var distance = Math.Abs(wordDelta);
        return $"{edge.Relation}|{dependentTag}->{headTag}|{direction}:{distance}";
    }

    private static string EdgeLexicalSignature(
        EdgeKey edge,
        IReadOnlyDictionary<QacLocation, QacSyntaxNode> terminals)
    {
        var dependentTag = terminals.TryGetValue(edge.Dependent, out var dependent)
            ? TerminalLexicalSignature(dependent)
            : "?";
        var headTag = terminals.TryGetValue(edge.Head, out var head)
            ? TerminalLexicalSignature(head)
            : "?";
        var wordDelta = edge.Head.Word - edge.Dependent.Word;
        var direction = wordDelta switch
        {
            < 0 => "left",
            > 0 => "right",
            _ => "same",
        };
        return $"{edge.Relation}|{dependentTag}->{headTag}|{direction}:"
            + Math.Abs(wordDelta);
    }

    private static string TerminalLexicalSignature(QacSyntaxNode node)
    {
        if (node.Morphology is not { } morphology)
        {
            return node.Tag;
        }

        return $"{TerminalSignature(node)}"
            + $"[lemma={morphology.Lemma ?? "-"};root={morphology.Root ?? "-"}]";
    }

    private static string TerminalSignature(QacSyntaxNode node)
    {
        if (node.Morphology is not { } morphology)
        {
            return node.Tag;
        }

        var features = new[]
            {
                morphology.PersonGenderNumber,
                morphology.AttachedPronoun,
                morphology.GrammaticalCase,
                morphology.State,
                morphology.Aspect,
                morphology.Mood,
                morphology.Voice,
                morphology.SpecialClass,
            }
            .Where(value => value is not null)
            .ToArray();
        return features.Length == 0
            ? node.Tag
            : $"{node.Tag}[{string.Join(',', features)}]";
    }

    private static string ClassifyGeneratedEdgeError(
        EdgeKey generated,
        IReadOnlySet<EdgeKey> gold)
    {
        if (gold.Any(edge =>
                edge.Dependent == generated.Dependent
                && edge.Head == generated.Head))
        {
            return $"relation:{generated.Relation}";
        }

        if (gold.Any(edge =>
                edge.Dependent == generated.Dependent
                && edge.Relation == generated.Relation))
        {
            return $"head:{generated.Relation}";
        }

        if (gold.Any(edge =>
                edge.Head == generated.Head
                && edge.Relation == generated.Relation))
        {
            return $"dependent:{generated.Relation}";
        }

        return $"spurious:{generated.Relation}";
    }

    private readonly record struct EdgeKey(
        QacLocation Dependent,
        QacLocation Head,
        string Relation) : IComparable<EdgeKey>
    {
        public int CompareTo(EdgeKey other)
        {
            var dependent = Dependent.CompareTo(other.Dependent);
            if (dependent != 0)
            {
                return dependent;
            }

            var head = Head.CompareTo(other.Head);
            return head != 0
                ? head
                : string.Compare(Relation, other.Relation, StringComparison.Ordinal);
        }
    }

    private readonly record struct PhraseKey(
        QacLocation Start,
        QacLocation End,
        string Tag) : IComparable<PhraseKey>
    {
        public int CompareTo(PhraseKey other)
        {
            var start = Start.CompareTo(other.Start);
            if (start != 0)
            {
                return start;
            }

            var end = End.CompareTo(other.End);
            return end != 0
                ? end
                : string.Compare(Tag, other.Tag, StringComparison.Ordinal);
        }
    }

    private readonly record struct UnlabeledEdgeKey(
        QacLocation Dependent,
        QacLocation Head);
}
