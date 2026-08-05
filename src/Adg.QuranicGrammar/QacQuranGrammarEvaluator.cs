using System.Security.Cryptography;
using System.Text;
using Adg.QuranicCorpus;

namespace Adg.QuranicGrammar;

public sealed class QacQuranGrammarEvaluation
{
    public long VerseCount { get; init; }

    public long WordCount { get; init; }

    public long GoldMorphologySelectionCount { get; init; }

    public double GoldMorphologySelectionRate { get; init; }

    public long ValidVerseCount { get; init; }

    public long InvalidVerseCount { get; init; }

    public long UnverifiedVerseCount { get; init; }

    public long GraphValidationErrorCount { get; init; }

    public long GeneratedNodeCount { get; init; }

    public long GeneratedEdgeCount { get; init; }

    public long GeneratedPhraseNodeCount { get; init; }

    public long UnverifiedEdgeCount { get; init; }

    public SortedDictionary<string, long> RelationCounts { get; init; } =
        new(StringComparer.Ordinal);

    public SortedDictionary<string, long> UnverifiedRelationCounts
        { get; init; } = new(StringComparer.Ordinal);

    public SortedDictionary<string, long> UnverifiedRelationIssueCounts
        { get; init; } = new(StringComparer.Ordinal);

    public SortedDictionary<string, long> PhraseTagCounts { get; init; } =
        new(StringComparer.Ordinal);

    public SortedDictionary<string, long> SyntaxIssueCounts { get; init; } =
        new(StringComparer.Ordinal);

    public IReadOnlyList<QacQuranGrammarSample> InvalidSamples { get; init; } = [];

    public required string EvaluationMerkleRoot { get; init; }
}

public sealed record QacQuranGrammarSample(
    string Verse,
    string Text,
    IReadOnlyList<QacSyntaxIssue> Issues);

public static class QacQuranGrammarEvaluator
{
    public static QacQuranGrammarEvaluation Evaluate(
        QacMorphologyLexicon lexicon,
        QacVerseCorpus corpus)
    {
        ArgumentNullException.ThrowIfNull(lexicon);
        ArgumentNullException.ThrowIfNull(corpus);
        var parser = new QacDeterministicGrammarParser(
            lexicon,
            enableHeuristicFallback: false);
        var relations = new SortedDictionary<string, long>(StringComparer.Ordinal);
        var unverifiedRelations =
            new SortedDictionary<string, long>(StringComparer.Ordinal);
        var unverifiedRelationIssues =
            new SortedDictionary<string, long>(StringComparer.Ordinal);
        var phraseTags = new SortedDictionary<string, long>(StringComparer.Ordinal);
        var syntaxIssues = new SortedDictionary<string, long>(StringComparer.Ordinal);
        var invalidSamples = new List<QacQuranGrammarSample>();
        var leaves = new List<byte[]>();
        long wordCount = 0;
        long goldMorphologySelectionCount = 0;
        long validVerseCount = 0;
        long invalidVerseCount = 0;
        long unverifiedVerseCount = 0;
        long graphValidationErrorCount = 0;
        long generatedNodeCount = 0;
        long generatedEdgeCount = 0;
        long generatedPhraseNodeCount = 0;
        long unverifiedEdgeCount = 0;

        foreach (var verse in corpus.Verses)
        {
            var parse = parser.Parse(verse.Text);
            wordCount += verse.Words.Count;
            generatedNodeCount += parse.Graph.Nodes.Count;
            generatedEdgeCount += parse.Graph.Edges.Count;
            unverifiedEdgeCount += parse.Graph.Edges.Count(edge => !edge.IsVerified);
            foreach (var phrase in parse.Graph.Nodes.Where(node =>
                         node.Kind == QacSyntaxNodeKind.Phrase))
            {
                generatedPhraseNodeCount++;
                phraseTags.TryGetValue(phrase.Tag, out var phraseCount);
                phraseTags[phrase.Tag] = phraseCount + 1;
            }

            graphValidationErrorCount += parse.Validation.Errors.Count;
            foreach (var issue in parse.Validation.Errors)
            {
                syntaxIssues.TryGetValue(issue.Code, out var count);
                syntaxIssues[issue.Code] = count + 1;
            }
            switch (parse.Status)
            {
                case QacGrammarStatus.Valid:
                    validVerseCount++;
                    break;
                case QacGrammarStatus.Invalid:
                    invalidVerseCount++;
                    if (invalidSamples.Count < 50)
                    {
                        invalidSamples.Add(
                            new QacQuranGrammarSample(
                                verse.Location,
                                verse.Text,
                                parse.Validation.Errors));
                    }
                    break;
                case QacGrammarStatus.Unverified:
                    unverifiedVerseCount++;
                    break;
                default:
                    throw new InvalidOperationException();
            }

            var comparable = Math.Min(
                verse.Words.Count,
                parse.SelectedAlternative.Selection.Count);
            for (var index = 0; index < comparable; index++)
            {
                if (verse.Words[index].MorphologySignature
                    == parse.SelectedAlternative.Selection[index].MorphologySignature)
                {
                    goldMorphologySelectionCount++;
                }
            }

            foreach (var edge in parse.Graph.Edges)
            {
                relations.TryGetValue(edge.Relation, out var count);
                relations[edge.Relation] = count + 1;
                if (!edge.IsVerified)
                {
                    unverifiedRelations.TryGetValue(
                        edge.Relation,
                        out var unverifiedCount);
                    unverifiedRelations[edge.Relation] =
                        unverifiedCount + 1;
                    var nodes = parse.Graph.Nodes.ToDictionary(
                        node => node.Id,
                        StringComparer.Ordinal);
                    if (nodes.TryGetValue(
                            edge.DependentId,
                            out var dependent)
                        && nodes.TryGetValue(edge.HeadId, out var head))
                    {
                        foreach (var issue in QacSyntaxValidator
                                     .ValidateCanonicalRelationEdge(
                                         edge,
                                         dependent,
                                         head))
                        {
                            var key =
                                $"{edge.Relation}|{issue.Code}|{issue.Message}";
                            unverifiedRelationIssues.TryGetValue(
                                key,
                                out var issueCount);
                            unverifiedRelationIssues[key] = issueCount + 1;
                        }
                    }
                }
            }

            leaves.Add(
                SHA256.HashData(
                    Encoding.UTF8.GetBytes(
                        string.Concat(
                            verse.Location,
                            "\t",
                            parse.Status,
                            "\t",
                            parse.SelectedAlternative.Signature,
                            "\t",
                            string.Join(
                                "\u001E",
                                parse.Graph.Edges.Select(edge =>
                                    $"{edge.DependentId}:{edge.Relation}:{edge.HeadId}:"
                                    + edge.IsVerified)),
                            "\t",
                            string.Join(
                                "\u001E",
                                parse.Graph.Nodes
                                    .Where(node =>
                                        node.Kind == QacSyntaxNodeKind.Phrase)
                                    .Select(node =>
                                        $"{node.Id}:{node.Tag}:"
                                        + $"{node.SpanStartTerminal}:"
                                        + node.SpanEndTerminal))))));
        }

        return new QacQuranGrammarEvaluation
        {
            VerseCount = corpus.Verses.Count,
            WordCount = wordCount,
            GoldMorphologySelectionCount = goldMorphologySelectionCount,
            GoldMorphologySelectionRate = wordCount == 0
                ? 0
                : (double)goldMorphologySelectionCount / wordCount,
            ValidVerseCount = validVerseCount,
            InvalidVerseCount = invalidVerseCount,
            UnverifiedVerseCount = unverifiedVerseCount,
            GraphValidationErrorCount = graphValidationErrorCount,
            GeneratedNodeCount = generatedNodeCount,
            GeneratedEdgeCount = generatedEdgeCount,
            GeneratedPhraseNodeCount = generatedPhraseNodeCount,
            UnverifiedEdgeCount = unverifiedEdgeCount,
            RelationCounts = relations,
            UnverifiedRelationCounts = unverifiedRelations,
            UnverifiedRelationIssueCounts = unverifiedRelationIssues,
            PhraseTagCounts = phraseTags,
            SyntaxIssueCounts = syntaxIssues,
            InvalidSamples = invalidSamples,
            EvaluationMerkleRoot = QacMerkle.ComputeRoot(leaves),
        };
    }
}
