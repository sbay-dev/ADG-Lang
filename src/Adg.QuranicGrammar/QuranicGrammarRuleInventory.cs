using System.Security.Cryptography;
using System.Text;
using Adg.QuranicCorpus;

namespace Adg.QuranicGrammar;

public sealed record QuranicGrammarObservedPattern(
    string Signature,
    long Count,
    IReadOnlyList<string> Samples);

public sealed class QuranicGrammarRuleEvidence
{
    public required string RuleId { get; init; }

    public required string Kind { get; init; }

    public required string QacCode { get; init; }

    public required string Family { get; init; }

    public required string Description { get; init; }

    public required string Source { get; init; }

    public long EvidenceCount { get; init; }

    public bool HasCanonicalValidatorContract { get; init; }

    public IReadOnlyList<QuranicGrammarObservedPattern> StructuralPatterns
        { get; init; } = [];

    public IReadOnlyList<QuranicGrammarObservedPattern> LexicalPatterns
        { get; init; } = [];
}

public sealed class QuranicGrammarRuleInventoryReport
{
    public const string ContractId =
        "adg-quranic-grammar-rule-inventory-v2";

    public required string InventoryContractId { get; init; }

    public required string EvidenceBoundary { get; init; }

    public required string SyntaxInputSha256 { get; init; }

    public string? CompactMorphologyInputSha256 { get; init; }

    public required string TreebankGraphMerkleRoot { get; init; }

    public long GraphCount { get; init; }

    public long DependencyRuleCount { get; init; }

    public long ObservedDependencyRuleCount { get; init; }

    public long PhraseRuleCount { get; init; }

    public long ObservedPhraseRuleCount { get; init; }

    public long CanonicalValidatorRuleCount { get; init; }

    public long DependencyEvidenceCount { get; init; }

    public long PhraseEvidenceCount { get; init; }

    public IReadOnlyList<QuranicGrammarRuleEvidence> Rules { get; init; } = [];

    public required string InventoryMerkleRoot { get; init; }

    public bool IsInventoryComplete =>
        DependencyRuleCount == QacSyntaxCatalog.DependencyRelations.Count
        && ObservedDependencyRuleCount == DependencyRuleCount
        && PhraseRuleCount == QacSyntaxCatalog.PhraseTags.Count
        && ObservedPhraseRuleCount == PhraseRuleCount
        && Rules.Count == DependencyRuleCount + PhraseRuleCount;
}

public static class QuranicGrammarRuleInventory
{
    private const int MaximumSamplesPerPattern = 3;

    public static QuranicGrammarRuleInventoryReport Build(
        QacSyntaxTreebank treebank)
    {
        ArgumentNullException.ThrowIfNull(treebank);

        var relationEvidence =
            QacSyntaxCatalog.DependencyRelations.Keys.ToDictionary(
                code => code,
                _ => new RuleAccumulator(),
                StringComparer.Ordinal);
        var phraseEvidence =
            QacSyntaxCatalog.PhraseTags.Keys.ToDictionary(
                code => code,
                _ => new RuleAccumulator(),
                StringComparer.Ordinal);

        foreach (var sourceGraph in treebank.Graphs)
        {
            var graph = sourceGraph.Graph;
            var nodes = graph.Nodes.ToDictionary(
                node => node.Id,
                StringComparer.Ordinal);
            foreach (var edge in graph.Edges)
            {
                if (!relationEvidence.TryGetValue(
                        edge.Relation,
                        out var accumulator)
                    || !nodes.TryGetValue(edge.DependentId, out var dependent)
                    || !nodes.TryGetValue(edge.HeadId, out var head))
                {
                    continue;
                }

                var sample = string.Concat(
                    "graph:",
                    sourceGraph.SequenceNumber,
                    "|",
                    DescribeNode(dependent),
                    "-[",
                    edge.Relation,
                    "]->",
                    DescribeNode(head));
                accumulator.Add(
                    StructuralEdgeSignature(dependent, head),
                    LexicalEdgeSignature(dependent, head),
                    sample);
            }

            foreach (var phrase in graph.Nodes.Where(node =>
                         node.Kind == QacSyntaxNodeKind.Phrase))
            {
                if (!phraseEvidence.TryGetValue(
                        phrase.Tag,
                        out var accumulator))
                {
                    continue;
                }

                var structural = PhraseSignature(phrase, nodes);
                var sample = string.Concat(
                    "graph:",
                    sourceGraph.SequenceNumber,
                    "|",
                    phrase.Tag,
                    ":",
                    phrase.SpanStartTerminal,
                    "-",
                    phrase.SpanEndTerminal);
                accumulator.Add(structural, structural, sample);
            }
        }

        var rules = new List<QuranicGrammarRuleEvidence>(
            relationEvidence.Count + phraseEvidence.Count);
        foreach (var definition in QacSyntaxCatalog.DependencyRelations.Values
                     .OrderBy(value => value.Code, StringComparer.Ordinal))
        {
            var evidence = relationEvidence[definition.Code];
            rules.Add(
                new QuranicGrammarRuleEvidence
                {
                    RuleId =
                        $"QUR-QAC-REL-{definition.Code.ToUpperInvariant()}",
                    Kind = "dependency-relation",
                    QacCode = definition.Code,
                    Family = definition.Family,
                    Description = definition.Description,
                    Source = QacSyntaxCatalog.RelationSource,
                    EvidenceCount = evidence.Count,
                    HasCanonicalValidatorContract =
                        QacSyntaxValidator.CanonicalRelationCodes.Contains(
                            definition.Code),
                    StructuralPatterns = evidence.StructuralPatterns(),
                    LexicalPatterns = evidence.LexicalPatterns(),
                });
        }

        foreach (var definition in QacSyntaxCatalog.PhraseTags.Values
                     .OrderBy(value => value.Code, StringComparer.Ordinal))
        {
            var evidence = phraseEvidence[definition.Code];
            rules.Add(
                new QuranicGrammarRuleEvidence
                {
                    RuleId = $"QUR-QAC-PHRASE-{definition.Code}",
                    Kind = "phrase",
                    QacCode = definition.Code,
                    Family = "phrase",
                    Description = definition.Description,
                    Source = QacSyntaxCatalog.PhraseTagSource,
                    EvidenceCount = evidence.Count,
                    HasCanonicalValidatorContract =
                        QacSyntaxValidator.CanonicalPhraseCodes.Contains(
                            definition.Code),
                    StructuralPatterns = evidence.StructuralPatterns(),
                    LexicalPatterns = [],
                });
        }

        var orderedRules = rules
            .OrderBy(rule => rule.RuleId, StringComparer.Ordinal)
            .ToArray();
        var leaves = orderedRules
            .Select(rule =>
                SHA256.HashData(
                    Encoding.UTF8.GetBytes(Canonicalize(rule))))
            .ToArray();
        return new QuranicGrammarRuleInventoryReport
        {
            InventoryContractId =
                QuranicGrammarRuleInventoryReport.ContractId,
            EvidenceBoundary =
                "This inventory binds observed QAC annotations. "
                + "An observed pattern is evidence for rule induction, "
                + "not by itself a universal Arabic grammar claim.",
            SyntaxInputSha256 = treebank.InputSha256,
            CompactMorphologyInputSha256 =
                treebank.CompactMorphologyInputSha256,
            TreebankGraphMerkleRoot = treebank.GraphMerkleRoot,
            GraphCount = treebank.Graphs.Count,
            DependencyRuleCount = relationEvidence.Count,
            ObservedDependencyRuleCount =
                relationEvidence.Values.LongCount(value => value.Count > 0),
            PhraseRuleCount = phraseEvidence.Count,
            ObservedPhraseRuleCount =
                phraseEvidence.Values.LongCount(value => value.Count > 0),
            CanonicalValidatorRuleCount =
                QacSyntaxValidator.CanonicalRelationCodes.Count
                + QacSyntaxValidator.CanonicalPhraseCodes.Count,
            DependencyEvidenceCount =
                relationEvidence.Values.Sum(value => value.Count),
            PhraseEvidenceCount =
                phraseEvidence.Values.Sum(value => value.Count),
            Rules = orderedRules,
            InventoryMerkleRoot = QacMerkle.ComputeRoot(leaves),
        };
    }

    private static string StructuralEdgeSignature(
        QacSyntaxNode dependent,
        QacSyntaxNode head) =>
        string.Concat(
            NodeFeatureSignature(dependent),
            "->",
            NodeFeatureSignature(head),
            "|",
            LinearDirection(dependent.Location, head.Location));

    private static string LexicalEdgeSignature(
        QacSyntaxNode dependent,
        QacSyntaxNode head) =>
        string.Concat(
            LexicalNodeSignature(dependent),
            "->",
            LexicalNodeSignature(head),
            "|",
            LinearDirection(dependent.Location, head.Location));

    private static string NodeFeatureSignature(QacSyntaxNode node) =>
        string.Join(
            ":",
            node.Kind,
            node.Tag,
            node.Morphology?.GrammaticalCase ?? "-",
            node.Morphology?.Aspect ?? "-",
            node.Morphology?.Mood ?? "-",
            node.Morphology?.Voice ?? "-",
            node.Morphology?.SpecialClass ?? "-",
            node.Morphology?.PersonGenderNumber ?? "-");

    private static string LexicalNodeSignature(QacSyntaxNode node) =>
        string.Join(
            ":",
            node.Kind,
            node.Tag,
            node.Morphology?.Lemma ?? "-",
            node.Morphology?.Root ?? "-");

    private static string PhraseSignature(
        QacSyntaxNode phrase,
        IReadOnlyDictionary<string, QacSyntaxNode> nodes)
    {
        if (phrase.SpanStartTerminal is not { } start
            || phrase.SpanEndTerminal is not { } end
            || !TryResolvePhraseBoundary(phrase.Id, start, nodes, out var first)
            || !TryResolvePhraseBoundary(phrase.Id, end, nodes, out var last))
        {
            return $"{phrase.Tag}|invalid-span";
        }

        var length = first.Location is { } firstLocation
            && last.Location is { } lastLocation
            && firstLocation.VerseKey == lastLocation.VerseKey
                ? lastLocation.Word - firstLocation.Word + 1
                : -1;
        return string.Concat(
            phrase.Tag,
            "|",
            NodeFeatureSignature(first),
            "->",
            NodeFeatureSignature(last),
            "|length:",
            length);
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

    private static string DescribeNode(QacSyntaxNode node) =>
        node.Location?.ToString()
        ?? string.Concat(node.Kind, ":", node.Tag, ":", node.Id);

    private static string LinearDirection(
        QacLocation? dependent,
        QacLocation? head)
    {
        if (dependent is null || head is null)
        {
            return "nonterminal";
        }

        var comparison = Compare(dependent.Value, head.Value);
        return comparison < 0
            ? "left"
            : comparison > 0
                ? "right"
                : "same";
    }

    private static int Compare(QacLocation left, QacLocation right)
    {
        var result = left.Chapter.CompareTo(right.Chapter);
        if (result != 0)
        {
            return result;
        }

        result = left.Verse.CompareTo(right.Verse);
        if (result != 0)
        {
            return result;
        }

        result = left.Word.CompareTo(right.Word);
        return result != 0
            ? result
            : left.Segment.CompareTo(right.Segment);
    }

    private static string Canonicalize(QuranicGrammarRuleEvidence rule)
    {
        var builder = new StringBuilder();
        builder
            .Append(rule.RuleId).Append('\t')
            .Append(rule.Kind).Append('\t')
            .Append(rule.QacCode).Append('\t')
            .Append(rule.Family).Append('\t')
            .Append(rule.Description).Append('\t')
            .Append(rule.Source).Append('\t')
            .Append(rule.EvidenceCount).Append('\t')
            .Append(rule.HasCanonicalValidatorContract)
            .Append('\n');
        foreach (var pattern in rule.StructuralPatterns)
        {
            builder
                .Append("S\t")
                .Append(pattern.Signature).Append('\t')
                .Append(pattern.Count).Append('\n');
            foreach (var sample in pattern.Samples)
            {
                builder.Append("SS\t").Append(sample).Append('\n');
            }
        }

        foreach (var pattern in rule.LexicalPatterns)
        {
            builder
                .Append("L\t")
                .Append(pattern.Signature).Append('\t')
                .Append(pattern.Count).Append('\n');
            foreach (var sample in pattern.Samples)
            {
                builder.Append("LS\t").Append(sample).Append('\n');
            }
        }

        return builder.ToString();
    }

    private sealed class RuleAccumulator
    {
        private readonly Dictionary<string, PatternAccumulator> structural =
            new(StringComparer.Ordinal);
        private readonly Dictionary<string, PatternAccumulator> lexical =
            new(StringComparer.Ordinal);

        public long Count { get; private set; }

        public void Add(
            string structuralSignature,
            string lexicalSignature,
            string sample)
        {
            Count++;
            Add(structural, structuralSignature, sample);
            Add(lexical, lexicalSignature, sample);
        }

        public IReadOnlyList<QuranicGrammarObservedPattern>
            StructuralPatterns() =>
            Materialize(structural);

        public IReadOnlyList<QuranicGrammarObservedPattern>
            LexicalPatterns() =>
            Materialize(lexical);

        private static void Add(
            IDictionary<string, PatternAccumulator> patterns,
            string signature,
            string sample)
        {
            if (!patterns.TryGetValue(signature, out var accumulator))
            {
                accumulator = new PatternAccumulator();
                patterns.Add(signature, accumulator);
            }

            accumulator.Count++;
            if (accumulator.Samples.Count < MaximumSamplesPerPattern)
            {
                accumulator.Samples.Add(sample);
            }
        }

        private static IReadOnlyList<QuranicGrammarObservedPattern>
            Materialize(
                IReadOnlyDictionary<string, PatternAccumulator> patterns) =>
            patterns
                .OrderBy(pair => pair.Key, StringComparer.Ordinal)
                .Select(pair =>
                    new QuranicGrammarObservedPattern(
                        pair.Key,
                        pair.Value.Count,
                        pair.Value.Samples.ToArray()))
                .ToArray();
    }

    private sealed class PatternAccumulator
    {
        public long Count { get; set; }

        public List<string> Samples { get; } = [];
    }
}
