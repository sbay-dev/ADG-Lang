using System.Collections.Frozen;
using Adg.QuranicCore;
using Adg.QuranicCorpus;

namespace Adg.QuranicGrammar;

public enum QacSyntaxNodeKind
{
    Terminal,
    Phrase,
    Reference,
    Hidden,
    Empty,
}

public sealed record QacPhraseTagDefinition(
    string Code,
    string Description);

public sealed record QacDependencyRelationDefinition(
    string Code,
    string Family,
    string Description);

public sealed record QacSyntaxNode(
    string Id,
    QacSyntaxNodeKind Kind,
    string Tag,
    string? Text = null,
    QacLocation? Location = null,
    SourceRange? TextRange = null,
    int? SpanStartTerminal = null,
    int? SpanEndTerminal = null,
    QacNormalizedMorphologyRecord? Morphology = null);

public sealed record QacDependencyEdge(
    string DependentId,
    string HeadId,
    string Relation,
    bool IsVerified = true);

public sealed record QacDependencyGraph(
    string Id,
    IReadOnlyList<QacSyntaxNode> Nodes,
    IReadOnlyList<QacDependencyEdge> Edges);

public sealed record QacSyntaxIssue(
    string Code,
    string Message,
    string? NodeId = null,
    string? Edge = null);

public sealed class QacSyntaxValidationReport
{
    public required string GraphId { get; init; }

    public long NodeCount { get; init; }

    public long EdgeCount { get; init; }

    public long RootCount { get; init; }

    public long UnverifiedEdgeCount { get; init; }

    public IReadOnlyList<QacSyntaxIssue> Errors { get; init; } = [];

    public bool IsValid => Errors.Count == 0;
}

public enum QacSyntaxValidationProfile
{
    Structural,
    PhraseContracts,
    Canonical,
}

public static class QacSyntaxCatalog
{
    public const string PhraseTagSource =
        "https://corpus.quran.com/documentation/phrasetags.jsp";

    public const string RelationSource =
        "https://corpus.quran.com/documentation/syntaxrelation.jsp";

    public const string GraphSource =
        "https://corpus.quran.com/documentation/dependencygraph.jsp";

    public static FrozenDictionary<string, QacPhraseTagDefinition> PhraseTags { get; } =
        new[]
        {
            new QacPhraseTagDefinition("CS", "Conditional sentence"),
            new QacPhraseTagDefinition("NS", "Nominal sentence"),
            new QacPhraseTagDefinition("PP", "Preposition phrase"),
            new QacPhraseTagDefinition("S", "Sentence"),
            new QacPhraseTagDefinition("SC", "Subordinate clause"),
            new QacPhraseTagDefinition("VS", "Verbal sentence"),
        }.ToFrozenDictionary(definition => definition.Code, StringComparer.Ordinal);

    public static FrozenDictionary<string, QacDependencyRelationDefinition>
        DependencyRelations { get; } =
        CreateRelations().ToFrozenDictionary(
            definition => definition.Code,
            StringComparer.Ordinal);

    private static IEnumerable<QacDependencyRelationDefinition> CreateRelations()
    {
        static QacDependencyRelationDefinition Relation(
            string code,
            string family,
            string description) =>
            new(code, family, description);

        yield return Relation("adj", "nominal", "Adjective");
        yield return Relation("poss", "nominal", "Possessive construction");
        yield return Relation("pred", "nominal", "Predicate");
        yield return Relation("app", "nominal", "Apposition");
        yield return Relation("spec", "nominal", "Specification");
        yield return Relation("cpnd", "nominal", "Compound");

        yield return Relation("subj", "verbal", "Active subject");
        yield return Relation("pass", "verbal", "Passive subject representative");
        yield return Relation("obj", "verbal", "Object");
        yield return Relation("subjx", "verbal", "Subject of a special verb or particle");
        yield return Relation("predx", "verbal", "Predicate of a special verb or particle");
        yield return Relation("impv", "verbal", "Imperative");
        yield return Relation("imrs", "verbal", "Imperative result");
        yield return Relation("pro", "verbal", "Prohibition");

        yield return Relation("gen", "phrase", "Preposition and genitive nominal");
        yield return Relation("link", "phrase", "Preposition phrase attachment");
        yield return Relation("conj", "phrase", "Coordinating conjunction");
        yield return Relation("sub", "phrase", "Subordinate clause");
        yield return Relation("cond", "phrase", "Condition");
        yield return Relation("rslt", "phrase", "Conditional result");

        yield return Relation("circ", "adverbial", "Circumstantial accusative");
        yield return Relation("cog", "adverbial", "Cognate accusative");
        yield return Relation("prp", "adverbial", "Accusative of purpose");
        yield return Relation("com", "adverbial", "Comitative object");

        yield return Relation("emph", "particle", "Emphasis");
        yield return Relation("intg", "particle", "Interrogation");
        yield return Relation("neg", "particle", "Negation");
        yield return Relation("fut", "particle", "Future");
        yield return Relation("voc", "particle", "Vocative");
        yield return Relation("exp", "particle", "Exceptive");
        yield return Relation("res", "particle", "Restriction");
        yield return Relation("avr", "particle", "Aversion");
        yield return Relation("cert", "particle", "Certainty");
        yield return Relation("ret", "particle", "Retraction");
        yield return Relation("prev", "particle", "Preventive");
        yield return Relation("ans", "particle", "Answer");
        yield return Relation("inc", "particle", "Inceptive");
        yield return Relation("sur", "particle", "Surprise");
        yield return Relation("sup", "particle", "Supplemental");
        yield return Relation("exh", "particle", "Exhortation");
        yield return Relation("exl", "particle", "Explanation");
        yield return Relation("eq", "particle", "Equalization");
        yield return Relation("caus", "particle", "Cause");
        yield return Relation("amd", "particle", "Amendment");
        yield return Relation("int", "particle", "Interpretation");
    }
}

public static class QacSyntaxValidator
{
    public static FrozenSet<string> CanonicalAdjectivalDependentTags { get; } =
        new[]
    {
        "ADJ",
        "DEM",
        "N",
        "REL",
    }.ToFrozenSet(StringComparer.Ordinal);

    public static FrozenSet<string> CanonicalNominalTags { get; } = new[]
    {
        "ADJ",
        "DEM",
        "IMPN",
        "LOC",
        "N",
        "PN",
        "PRON",
        "REL",
        "T",
    }.ToFrozenSet(StringComparer.Ordinal);

    public static FrozenSet<string> CanonicalRelationCodes { get; } = new[]
    {
        "adj",
        "amd",
        "ans",
        "app",
        "avr",
        "caus",
        "cert",
        "circ",
        "cog",
        "com",
        "cond",
        "conj",
        "cpnd",
        "emph",
        "eq",
        "exh",
        "exl",
        "exp",
        "fut",
        "gen",
        "impv",
        "imrs",
        "inc",
        "int",
        "intg",
        "link",
        "neg",
        "obj",
        "pass",
        "poss",
        "pred",
        "predx",
        "prev",
        "pro",
        "prp",
        "res",
        "ret",
        "rslt",
        "spec",
        "sub",
        "subj",
        "subjx",
        "sup",
        "sur",
        "voc",
    }.ToFrozenSet(StringComparer.Ordinal);

    public static FrozenSet<string> CanonicalPhraseCodes { get; } =
        QacSyntaxCatalog.PhraseTags.Keys.ToFrozenSet(StringComparer.Ordinal);

    public static FrozenDictionary<string, FrozenSet<string>>
        CanonicalPhraseStartSignatures { get; } = FreezePhraseMap(
            new Dictionary<string, string[]>(StringComparer.Ordinal)
            {
                ["CS"] =
                [
                    "Terminal:COND",
                    "Terminal:EMPH",
                    "Terminal:INTG",
                    "Terminal:T",
                ],
                ["NS"] =
                [
                    "Empty:N",
                    "Empty:V",
                    "Empty:VOC",
                    "Hidden:PRON",
                    "Reference:ACC",
                    "Reference:EQ",
                    "Terminal:ACC",
                    "Terminal:ANS",
                    "Terminal:COND",
                    "Terminal:DEM",
                    "Terminal:EMPH",
                    "Terminal:EQ",
                    "Terminal:FUT",
                    "Terminal:IMPV",
                    "Terminal:INTG",
                    "Terminal:LOC",
                    "Terminal:N",
                    "Terminal:NEG",
                    "Terminal:P",
                    "Terminal:PN",
                    "Terminal:PRON",
                    "Terminal:REL",
                    "Terminal:SUP",
                    "Terminal:SUR",
                    "Terminal:T",
                    "Terminal:V",
                    "Terminal:VOC",
                ],
                ["PP"] = ["Empty:P", "Reference:P", "Terminal:P"],
                ["S"] =
                [
                    "Empty:VOC",
                    "Terminal:ACC",
                    "Terminal:COND",
                    "Terminal:DEM",
                    "Terminal:EMPH",
                    "Terminal:EQ",
                    "Terminal:INT",
                    "Terminal:INTG",
                    "Terminal:N",
                    "Terminal:NEG",
                    "Terminal:P",
                    "Terminal:PN",
                    "Terminal:REL",
                    "Terminal:RES",
                    "Terminal:SUR",
                    "Terminal:V",
                    "Terminal:VOC",
                ],
                ["SC"] = ["Empty:SUB", "Terminal:PRP", "Terminal:SUB"],
                ["VS"] =
                [
                    "Empty:V",
                    "Empty:VOC",
                    "Reference:EQ",
                    "Reference:IMPV",
                    "Reference:NEG",
                    "Reference:V",
                    "Terminal:ACC",
                    "Terminal:ANS",
                    "Terminal:AVR",
                    "Terminal:CERT",
                    "Terminal:CONJ",
                    "Terminal:EMPH",
                    "Terminal:EQ",
                    "Terminal:EXH",
                    "Terminal:FUT",
                    "Terminal:IMPN",
                    "Terminal:IMPV",
                    "Terminal:INTG",
                    "Terminal:N",
                    "Terminal:NEG",
                    "Terminal:P",
                    "Terminal:PN",
                    "Terminal:PRO",
                    "Terminal:PRON",
                    "Terminal:REM",
                    "Terminal:RET",
                    "Terminal:SUP",
                    "Terminal:T",
                    "Terminal:V",
                    "Terminal:VOC",
                ],
            });

    public static FrozenDictionary<string, FrozenSet<string>>
        CanonicalPhraseEndSignatures { get; } = FreezePhraseMap(
            new Dictionary<string, string[]>(StringComparer.Ordinal)
            {
                ["CS"] =
                [
                    "Empty:V",
                    "Hidden:PRON",
                    "Terminal:ADJ",
                    "Terminal:DEM",
                    "Terminal:N",
                    "Terminal:PN",
                    "Terminal:PRON",
                ],
                ["NS"] =
                [
                    "Empty:N",
                    "Hidden:PRON",
                    "Reference:N",
                    "Reference:PRON",
                    "Terminal:ADJ",
                    "Terminal:DEM",
                    "Terminal:N",
                    "Terminal:PN",
                    "Terminal:PRON",
                    "Terminal:REL",
                    "Terminal:T",
                ],
                ["PP"] =
                [
                    "Reference:DEM",
                    "Reference:N",
                    "Reference:PN",
                    "Reference:PRON",
                    "Reference:REL",
                    "Reference:SUB",
                    "Terminal:ACC",
                    "Terminal:ADJ",
                    "Terminal:DEM",
                    "Terminal:INTG",
                    "Terminal:N",
                    "Terminal:PN",
                    "Terminal:PRON",
                    "Terminal:REL",
                    "Terminal:SUB",
                ],
                ["S"] =
                [
                    "Hidden:PRON",
                    "Terminal:ADJ",
                    "Terminal:N",
                    "Terminal:PN",
                    "Terminal:PRON",
                    "Terminal:VOC",
                ],
                ["SC"] =
                [
                    "Hidden:PRON",
                    "Terminal:ADJ",
                    "Terminal:N",
                    "Terminal:PN",
                    "Terminal:PRON",
                    "Terminal:T",
                ],
                ["VS"] =
                [
                    "Empty:N",
                    "Empty:V",
                    "Hidden:PRON",
                    "Reference:N",
                    "Reference:PN",
                    "Reference:PRON",
                    "Terminal:ADJ",
                    "Terminal:DEM",
                    "Terminal:LOC",
                    "Terminal:N",
                    "Terminal:PN",
                    "Terminal:PRON",
                    "Terminal:T",
                    "Terminal:V",
                    "Terminal:VOC",
                ],
            });

    public static FrozenDictionary<string, FrozenSet<string>>
        CanonicalPhraseParentRelations { get; } = FreezePhraseMap(
            new Dictionary<string, string[]>(StringComparer.Ordinal)
            {
                ["CS"] =
                [
                    "adj", "circ", "obj", "poss", "pred", "predx", "rslt", "sub",
                ],
                ["NS"] =
                [
                    "adj", "app", "circ", "cond", "conj", "imrs", "int", "intg",
                    "neg", "obj", "pass", "poss", "pred", "predx", "rslt", "sub",
                    "subjx",
                ],
                ["PP"] =
                [
                    "adj", "app", "circ", "conj", "exp", "intg", "link", "neg",
                    "obj", "pass", "pred", "predx", "spec", "subj", "subjx",
                ],
                ["S"] =
                [
                    "circ", "link", "obj", "pred", "predx", "rslt", "sub", "subj",
                ],
                ["SC"] =
                [
                    "adj", "app", "circ", "cond", "conj", "exp", "intg", "link",
                    "obj", "poss", "pred", "predx", "prp", "sub", "subj", "subjx",
                ],
                ["VS"] =
                [
                    "adj", "app", "cert", "circ", "cond", "conj", "gen", "imrs",
                    "int", "intg", "obj", "pass", "poss", "pred", "predx", "res",
                    "ret", "rslt", "sub",
                ],
            });

    public static FrozenDictionary<string, FrozenSet<string>>
        CanonicalPhraseChildRelations { get; } = FreezePhraseMap(
            new Dictionary<string, string[]>(StringComparer.Ordinal)
            {
                ["CS"] = [],
                ["NS"] = ["app", "conj", "pred", "res"],
                ["PP"] =
                [
                    "app", "conj", "emph", "exl", "exp", "link", "neg", "pred",
                    "res",
                ],
                ["S"] = ["pred", "res", "spec"],
                ["SC"] = ["conj", "pred", "res"],
                ["VS"] = ["conj", "exp", "link", "pred", "res"],
            });

    public static QacSyntaxValidationReport Validate(
        QacDependencyGraph graph,
        QacSyntaxValidationProfile profile = QacSyntaxValidationProfile.Canonical)
    {
        ArgumentNullException.ThrowIfNull(graph);
        var errors = new List<QacSyntaxIssue>();
        var nodes = new Dictionary<string, QacSyntaxNode>(StringComparer.Ordinal);

        foreach (var node in graph.Nodes)
        {
            if (!nodes.TryAdd(node.Id, node))
            {
                errors.Add(
                    new QacSyntaxIssue(
                        "ADG-QS1001",
                        $"Duplicate node id '{node.Id}'.",
                        node.Id));
                continue;
            }

            ValidateNode(node, errors);
        }

        foreach (var edge in graph.Edges)
        {
            var edgeText = $"{edge.DependentId}-[{edge.Relation}]->{edge.HeadId}";
            if (!QacSyntaxCatalog.DependencyRelations.ContainsKey(edge.Relation))
            {
                errors.Add(
                    new QacSyntaxIssue(
                        "ADG-QS1101",
                        $"Unknown dependency relation '{edge.Relation}'.",
                        Edge: edgeText));
                continue;
            }

            if (!nodes.TryGetValue(edge.DependentId, out var dependent)
                || !nodes.TryGetValue(edge.HeadId, out var head))
            {
                errors.Add(
                    new QacSyntaxIssue(
                        "ADG-QS1102",
                        "Dependency edge references a missing node.",
                        Edge: edgeText));
                continue;
            }

            if (edge.DependentId == edge.HeadId)
            {
                errors.Add(
                    new QacSyntaxIssue(
                        "ADG-QS1103",
                        "A node cannot depend on itself.",
                        Edge: edgeText));
                continue;
            }

            if (profile == QacSyntaxValidationProfile.Canonical
                && edge.IsVerified)
            {
                ValidateRelation(edge, dependent, head, errors);
            }
        }

        if (profile is QacSyntaxValidationProfile.Canonical
            or QacSyntaxValidationProfile.PhraseContracts)
        {
            ValidatePhraseContracts(graph, nodes, errors);
        }

        foreach (var group in graph.Edges.GroupBy(edge => edge.DependentId))
        {
            if (group.Count() > 1)
            {
                errors.Add(
                    new QacSyntaxIssue(
                        "ADG-QS1104",
                        $"Node '{group.Key}' has more than one head.",
                        group.Key));
            }
        }

        if (HasCycle(graph, nodes))
        {
            errors.Add(
                new QacSyntaxIssue(
                    "ADG-QS1105",
                    "The dependency graph contains a cycle."));
        }

        var dependents = graph.Edges
            .Select(edge => edge.DependentId)
            .ToHashSet(StringComparer.Ordinal);
        return new QacSyntaxValidationReport
        {
            GraphId = graph.Id,
            NodeCount = nodes.Count,
            EdgeCount = graph.Edges.Count,
            RootCount = nodes.Keys.Count(nodeId => !dependents.Contains(nodeId)),
            UnverifiedEdgeCount = graph.Edges.Count(edge => !edge.IsVerified),
            Errors = errors,
        };
    }

    public static IReadOnlyList<QacSyntaxIssue> ValidateCanonicalRelationEdge(
        QacDependencyEdge edge,
        QacSyntaxNode dependent,
        QacSyntaxNode head)
    {
        ArgumentNullException.ThrowIfNull(edge);
        ArgumentNullException.ThrowIfNull(dependent);
        ArgumentNullException.ThrowIfNull(head);
        var errors = new List<QacSyntaxIssue>();
        if (!QacSyntaxCatalog.DependencyRelations.ContainsKey(edge.Relation))
        {
            errors.Add(
                new QacSyntaxIssue(
                    "ADG-QS1101",
                    $"Unknown dependency relation '{edge.Relation}'.",
                    Edge:
                        $"{edge.DependentId}-[{edge.Relation}]->{edge.HeadId}"));
            return errors;
        }

        ValidateRelation(edge, dependent, head, errors);
        return errors;
    }

    private static void ValidatePhraseContracts(
        QacDependencyGraph graph,
        IReadOnlyDictionary<string, QacSyntaxNode> nodes,
        ICollection<QacSyntaxIssue> errors)
    {
        var phrases = graph.Nodes
            .Where(node =>
                node.Kind == QacSyntaxNodeKind.Phrase
                && CanonicalPhraseCodes.Contains(node.Tag)
                && node.SpanStartTerminal is not null
                && node.SpanEndTerminal is not null)
            .ToArray();
        foreach (var phrase in phrases)
        {
            if (!TryResolvePhraseMembers(
                    graph,
                    nodes,
                    phrase,
                    out var members))
            {
                errors.Add(
                    new QacSyntaxIssue(
                        "ADG-QS1008",
                        "Phrase boundaries must resolve to one contiguous "
                        + "non-phrase interval.",
                        phrase.Id));
                continue;
            }

            var first = members[0];
            var last = members[^1];
            if (!CanonicalPhraseStartSignatures[phrase.Tag].Contains(
                    NodeSignature(first))
                || !CanonicalPhraseEndSignatures[phrase.Tag].Contains(
                    NodeSignature(last)))
            {
                errors.Add(
                    new QacSyntaxIssue(
                        "ADG-QS1203",
                        $"Phrase '{phrase.Tag}' has an unattested boundary family.",
                        phrase.Id));
            }

            if (phrase.Tag == "VS"
                && members.All(node => node.Tag != "V"))
            {
                errors.Add(
                    new QacSyntaxIssue(
                        "ADG-QS1203",
                        "A VS phrase requires a verbal member.",
                        phrase.Id));
            }
        }

        for (var leftIndex = 0; leftIndex < phrases.Length; leftIndex++)
        {
            var left = phrases[leftIndex];
            var leftStart = left.SpanStartTerminal!.Value;
            var leftEnd = left.SpanEndTerminal!.Value;
            for (var rightIndex = leftIndex + 1;
                 rightIndex < phrases.Length;
                 rightIndex++)
            {
                var right = phrases[rightIndex];
                var rightStart = right.SpanStartTerminal!.Value;
                var rightEnd = right.SpanEndTerminal!.Value;
                if (leftStart == rightStart && leftEnd == rightEnd
                    || leftStart < rightStart
                    && rightStart <= leftEnd
                    && leftEnd < rightEnd
                    || rightStart < leftStart
                    && leftStart <= rightEnd
                    && rightEnd < leftEnd)
                {
                    errors.Add(
                        new QacSyntaxIssue(
                            "ADG-QS1009",
                            $"Phrase intervals '{left.Id}' and '{right.Id}' "
                            + "must be unique and laminar.",
                            right.Id));
                }
            }
        }

        foreach (var edge in graph.Edges.Where(edge => edge.IsVerified))
        {
            if (!nodes.TryGetValue(edge.DependentId, out var dependent)
                || !nodes.TryGetValue(edge.HeadId, out var head))
            {
                continue;
            }

            if (dependent.Kind == QacSyntaxNodeKind.Phrase
                && CanonicalPhraseCodes.Contains(dependent.Tag)
                && !CanonicalPhraseParentRelations[dependent.Tag].Contains(
                    edge.Relation))
            {
                errors.Add(
                    new QacSyntaxIssue(
                        "ADG-QS1204",
                        $"Phrase '{dependent.Tag}' cannot fill the "
                        + $"'{edge.Relation}' dependent role.",
                        dependent.Id,
                        $"{edge.DependentId}-[{edge.Relation}]->{edge.HeadId}"));
            }

            if (head.Kind == QacSyntaxNodeKind.Phrase
                && CanonicalPhraseCodes.Contains(head.Tag)
                && !CanonicalPhraseChildRelations[head.Tag].Contains(
                    edge.Relation))
            {
                errors.Add(
                    new QacSyntaxIssue(
                        "ADG-QS1204",
                        $"Phrase '{head.Tag}' cannot fill the "
                        + $"'{edge.Relation}' head role.",
                        head.Id,
                        $"{edge.DependentId}-[{edge.Relation}]->{edge.HeadId}"));
            }
        }
    }

    private static bool TryResolvePhraseMembers(
        QacDependencyGraph graph,
        IReadOnlyDictionary<string, QacSyntaxNode> nodes,
        QacSyntaxNode phrase,
        out QacSyntaxNode[] members)
    {
        members = [];
        if (phrase.SpanStartTerminal is not { } start
            || phrase.SpanEndTerminal is not { } end
            || start < 0
            || start > end)
        {
            return false;
        }

        var separator = phrase.Id.LastIndexOf('n');
        if (separator > 0
            && int.TryParse(
                phrase.Id.AsSpan(separator + 1),
                out _))
        {
            var prefix = phrase.Id[..(separator + 1)];
            var resolved = new List<QacSyntaxNode>(end - start + 1);
            for (var alias = start; alias <= end; alias++)
            {
                if (!nodes.TryGetValue($"{prefix}{alias}", out var node))
                {
                    return false;
                }

                resolved.Add(node);
            }

            if (resolved[0].Kind == QacSyntaxNodeKind.Phrase
                || resolved[^1].Kind == QacSyntaxNodeKind.Phrase)
            {
                return false;
            }

            members = resolved.ToArray();
            return true;
        }

        var terminals = graph.Nodes
            .Where(node => node.Kind == QacSyntaxNodeKind.Terminal)
            .ToArray();
        if (end >= terminals.Length)
        {
            return false;
        }

        members = terminals[start..(end + 1)];
        return members.Length > 0;
    }

    private static string NodeSignature(QacSyntaxNode node) =>
        $"{node.Kind}:{node.Tag}";

    private static FrozenDictionary<string, FrozenSet<string>> FreezePhraseMap(
        IReadOnlyDictionary<string, string[]> source) =>
        source.ToFrozenDictionary(
            pair => pair.Key,
            pair => pair.Value.ToFrozenSet(StringComparer.Ordinal),
            StringComparer.Ordinal);

    private static void ValidateNode(
        QacSyntaxNode node,
        ICollection<QacSyntaxIssue> errors)
    {
        if (string.IsNullOrWhiteSpace(node.Id))
        {
            errors.Add(
                new QacSyntaxIssue(
                    "ADG-QS1002",
                    "Node id must not be empty."));
        }

        if (node.Kind == QacSyntaxNodeKind.Phrase)
        {
            if (!QacSyntaxCatalog.PhraseTags.ContainsKey(node.Tag))
            {
                errors.Add(
                    new QacSyntaxIssue(
                        "ADG-QS1003",
                        $"Unknown phrase tag '{node.Tag}'.",
                        node.Id));
            }

            if (node.Text is not null || node.Location is not null)
            {
                errors.Add(
                    new QacSyntaxIssue(
                        "ADG-QS1004",
                        "Phrase nodes cannot carry Quranic text or a segment location.",
                        node.Id));
            }

            if (node.SpanStartTerminal is null
                || node.SpanEndTerminal is null
                || node.SpanStartTerminal > node.SpanEndTerminal)
            {
                errors.Add(
                    new QacSyntaxIssue(
                        "ADG-QS1005",
                        "A phrase node must span a valid contiguous terminal interval.",
                        node.Id));
            }

            return;
        }

        if (!QacMorphologyCatalog.Tags.ContainsKey(node.Tag) || node.Tag == "DET")
        {
            errors.Add(
                new QacSyntaxIssue(
                    "ADG-QS1006",
                    $"Node kind {node.Kind} requires a non-DET QAC POS tag.",
                    node.Id));
        }

        if (node.Kind == QacSyntaxNodeKind.Terminal
            && node.Location is null
            && node.TextRange is null)
        {
            errors.Add(
                new QacSyntaxIssue(
                    "ADG-QS1007",
                    "Terminal nodes require a Quranic location or a natural-text range.",
                    node.Id));
        }

        if (node.Kind == QacSyntaxNodeKind.Reference && node.Location is null)
        {
            errors.Add(
                new QacSyntaxIssue(
                    "ADG-QS1007",
                    "Reference nodes require a Quranic segment location.",
                    node.Id));
        }

        if (node.Kind is QacSyntaxNodeKind.Hidden or QacSyntaxNodeKind.Empty
            && (node.Location is not null || node.TextRange is not null))
        {
            errors.Add(
                new QacSyntaxIssue(
                    "ADG-QS1008",
                    $"{node.Kind} nodes cannot claim a Quranic segment location.",
                    node.Id));
        }

        if (node.Kind == QacSyntaxNodeKind.Empty && node.Text is not null)
        {
            errors.Add(
                new QacSyntaxIssue(
                    "ADG-QS1009",
                    "Empty nodes cannot carry reconstructed text.",
                    node.Id));
        }
    }

    private static void ValidateRelation(
        QacDependencyEdge edge,
        QacSyntaxNode dependent,
        QacSyntaxNode head,
        ICollection<QacSyntaxIssue> errors)
    {
        var edgeText = $"{edge.DependentId}-[{edge.Relation}]->{edge.HeadId}";

        void Require(bool condition, string message)
        {
            if (!condition)
            {
                errors.Add(
                    new QacSyntaxIssue(
                        "ADG-QS1201",
                        message,
                        Edge: edgeText));
            }
        }

        switch (edge.Relation)
        {
            case "amd":
                Require(
                    head.Tag == "AMD",
                    "amd requires an amendment-particle head.");
                break;
            case "ans":
                Require(
                    head.Tag == "ANS",
                    "ans requires an answer-particle head.");
                break;
            case "avr":
                Require(
                    head.Tag == "AVR",
                    "avr requires an aversion-particle head.");
                break;
            case "adj":
                Require(
                    CanonicalAdjectivalDependentTags.Contains(dependent.Tag)
                    || dependent.Kind == QacSyntaxNodeKind.Empty
                    && dependent.Tag == "ADJ"
                    || dependent.Kind == QacSyntaxNodeKind.Phrase
                    && dependent.Tag is "CS" or "NS" or "S" or "SC" or "VS",
                    "adj requires an adjectival nominal dependent.");
                Require(
                    CanonicalNominalTags.Contains(head.Tag),
                    "adj requires a nominal head.");
                break;
            case "app":
                Require(
                    IsAppositionNode(dependent),
                    "app requires a nominal or nominal-phrase dependent.");
                Require(
                    IsAppositionNode(head),
                    "app requires a nominal or nominal-phrase head.");
                Require(
                    IsDependentAfterHeadWhenOrdered(dependent, head),
                    "app requires the apposition to follow its ordered head.");
                RequireCaseAgreement(dependent, head, edgeText, errors);
                break;
            case "conj":
                Require(
                    IsDependentAfterHeadWhenOrdered(dependent, head),
                    "conj requires the conjoined dependent to follow "
                    + "its ordered head.");
                RequireCaseAgreement(dependent, head, edgeText, errors);
                RequireMoodAgreement(dependent, head, edgeText, errors);
                break;
            case "poss":
                Require(
                    CanonicalNominalTags.Contains(dependent.Tag)
                    || dependent.Kind == QacSyntaxNodeKind.Phrase
                    && dependent.Tag
                        is "CS" or "NS" or "S" or "SC" or "VS",
                    "poss requires a nominal dependent.");
                Require(
                    CanonicalNominalTags.Contains(head.Tag)
                    || head.Tag == "INTG",
                    "poss requires a nominal head.");
                RequireCase(dependent, "GEN", edgeText, errors);
                break;
            case "cpnd":
                Require(
                    dependent.Kind == QacSyntaxNodeKind.Terminal
                    && dependent.Tag == "N",
                    "cpnd requires a terminal noun dependent.");
                Require(
                    head.Kind == QacSyntaxNodeKind.Terminal
                    && head.Tag == "N",
                    "cpnd requires a terminal noun head.");
                RequireCase(dependent, "ACC", edgeText, errors);
                RequireCase(head, "ACC", edgeText, errors);
                Require(
                    IsDependentAfterHeadWhenOrdered(dependent, head),
                    "cpnd requires the compound dependent to follow its head.");
                break;
            case "subj":
                Require(
                    CanonicalNominalTags.Contains(dependent.Tag)
                    || dependent.Kind == QacSyntaxNodeKind.Phrase
                    && dependent.Tag is "PP" or "S" or "SC",
                    "subj requires a nominal dependent.");
                Require(
                    head.Tag is "ADJ" or "N" or "V",
                    "subj requires a verbal or predicative head.");
                RequireCase(dependent, "NOM", edgeText, errors);
                break;
            case "pass":
                Require(
                    CanonicalNominalTags.Contains(dependent.Tag)
                    || dependent.Kind == QacSyntaxNodeKind.Phrase
                    && dependent.Tag is "NS" or "PP" or "VS",
                    "pass requires a nominal dependent.");
                Require(
                    head.Tag is "N" or "V",
                    "pass requires a verbal or passive-nominal head.");
                RequireCase(dependent, "NOM", edgeText, errors);
                if (head.Tag == "V")
                {
                    Require(
                        head.Morphology?.Voice == "PASS",
                        "pass requires a passive verbal head.");
                }

                break;
            case "obj":
                Require(
                    CanonicalNominalTags.Contains(dependent.Tag)
                    || dependent.Kind == QacSyntaxNodeKind.Empty
                    && dependent.Tag == "N"
                    || dependent.Kind == QacSyntaxNodeKind.Phrase
                    && dependent.Tag
                        is "CS" or "NS" or "PP" or "S" or "SC" or "VS"
                    || dependent.Tag == "INTG",
                    "obj requires a nominal or clause dependent.");
                Require(
                    head.Tag is "N" or "V",
                    "obj requires a verbal or event-nominal head.");
                if (CanonicalNominalTags.Contains(dependent.Tag))
                {
                    RequireCase(dependent, "ACC", edgeText, errors);
                }

                break;
            case "gen":
                Require(
                    CanonicalNominalTags.Contains(dependent.Tag)
                    || dependent.Tag is "ACC" or "INTG" or "SUB"
                    || dependent.Kind == QacSyntaxNodeKind.Phrase
                    && dependent.Tag == "VS",
                    "gen requires a nominal or clause complement.");
                Require(head.Tag == "P", "gen requires a preposition head.");
                if (CanonicalNominalTags.Contains(dependent.Tag))
                {
                    RequireCase(dependent, "GEN", edgeText, errors);
                }

                break;
            case "cond":
                Require(
                    dependent.Kind == QacSyntaxNodeKind.Phrase
                    && dependent.Tag is "NS" or "SC" or "VS",
                    "cond requires a nominal, subordinate, or verbal clause dependent.");
                Require(
                    head.Tag is "COND" or "REL" or "T",
                    "cond requires a conditional, relative, or time head.");
                break;
            case "sub":
                Require(
                    dependent.Kind == QacSyntaxNodeKind.Phrase
                    && dependent.Tag is "CS" or "NS" or "S" or "SC" or "VS"
                    || dependent.Kind == QacSyntaxNodeKind.Empty
                    && dependent.Tag is "N" or "V",
                    "sub requires a clause or an explicitly elided clause.");
                Require(
                    head.Tag is "COND" or "PRP" or "REL" or "SUB",
                    "sub requires a conditional, purpose, relative, "
                    + "or subordinating head.");
                break;
            case "rslt":
                Require(
                    dependent.Kind == QacSyntaxNodeKind.Phrase
                    && dependent.Tag is "CS" or "NS" or "S" or "VS",
                    "rslt requires a sentence or clause dependent.");
                Require(
                    head.Tag is "COND" or "REL" or "T",
                    "rslt requires a conditional, relative, or time head.");
                break;
            case "circ":
            case "cog":
            case "prp":
            case "com":
            case "spec":
                if (CanonicalNominalTags.Contains(dependent.Tag))
                {
                    RequireCase(dependent, "ACC", edgeText, errors);
                }

                if (edge.Relation == "circ")
                {
                    Require(
                        dependent.Kind == QacSyntaxNodeKind.Phrase
                        && dependent.Tag
                            is "CS" or "NS" or "S" or "SC" or "VS"
                        || IsNominalContractNode(dependent),
                        "circ requires a nominal or clause dependent.");
                    Require(
                        head.Kind != QacSyntaxNodeKind.Phrase
                        || head.Tag is "NS" or "PP" or "VS",
                        "circ requires a terminal, implicit, "
                        + "or clause attachment head.");
                }
                else if (edge.Relation is "cog" or "prp")
                {
                    Require(
                        IsNominalContractNode(dependent)
                        || dependent.Kind == QacSyntaxNodeKind.Phrase
                        && dependent.Tag == "SC",
                        $"{edge.Relation} requires a nominal or clause dependent.");
                    Require(
                        head.Tag == "V" || IsNominalContractNode(head),
                        $"{edge.Relation} requires a verbal or nominal head.");
                }
                else if (edge.Relation == "com")
                {
                    Require(
                        head.Tag is "REL" or "V",
                        "com requires a verbal or relative head.");
                }

                break;
            case "caus":
                Require(
                    dependent.Tag is "CAUS" or "REM",
                    "caus requires a causal or resumptive particle dependent.");
                Require(
                    head.Tag is "PRO" or "V",
                    "caus requires a verbal or prohibition head.");
                if (dependent.Tag == "CAUS"
                    && head.Morphology?.Aspect == "IMPF")
                {
                    Require(
                        head.Morphology.Mood == "SUBJ",
                        "caus requires subjunctive mood for an imperfect verb.");
                }

                break;
            case "cert":
                Require(
                    head.Tag == "CERT",
                    "cert requires a certainty-particle head.");
                break;
            case "emph":
                Require(
                    dependent.Tag is "EMPH" or "NEG"
                    || IsNominalContractNode(dependent),
                    "emph requires an emphatic particle, negative "
                    + "reinforcer, or nominal emphasis dependent.");
                Require(
                    dependent.Tag is "EMPH" or "NEG"
                    || IsNominalContractNode(head),
                    "nominal emph requires a nominal head.");
                if (IsNominalContractNode(dependent)
                    && IsNominalContractNode(head))
                {
                    RequireCaseAgreement(
                        dependent,
                        head,
                        edgeText,
                        errors);
                }

                break;
            case "eq":
                Require(
                    dependent.Tag == "V",
                    "eq requires a verbal dependent.");
                Require(
                    head.Tag == "EQ",
                    "eq requires an equalization-particle head.");
                break;
            case "exh":
                Require(
                    dependent.Tag is "T" or "V",
                    "exh requires a time-nominal or verbal dependent.");
                Require(
                    head.Tag == "EXH",
                    "exh requires an exhortation-particle head.");
                break;
            case "exl":
                if (dependent.Tag == "EXL")
                {
                    Require(
                        IsNominalContractNode(head)
                        || head.Kind == QacSyntaxNodeKind.Phrase
                        && head.Tag == "PP",
                        "exl particle-dependent form requires a nominal "
                        + "or prepositional-phrase head.");
                }
                else
                {
                    Require(
                        head.Tag == "EXL",
                        "exl content-dependent form requires an EXL head.");
                    Require(
                        dependent.Tag is "COND" or "N" or "PN" or "SUB" or "T",
                        "exl requires explanatory conditional, nominal, "
                        + "subordinating, or time content.");
                }

                break;
            case "exp":
                Require(
                    dependent.Tag is "EXP" or "RES"
                    || head.Tag is "EXP" or "RES",
                    "exp requires an exceptive or restriction endpoint.");
                if (dependent.Tag is "EXP" or "RES")
                {
                    Require(
                        IsNominalContractNode(head)
                        || head.Tag is "PRP" or "SUB" or "REL"
                        || head.Kind == QacSyntaxNodeKind.Phrase,
                        "exp particle-dependent form requires nominal "
                        + "or clause content.");
                }
                else
                {
                    Require(
                        IsNominalContractNode(dependent)
                        || dependent.Kind
                            is QacSyntaxNodeKind.Empty
                                or QacSyntaxNodeKind.Phrase,
                        "exp content-dependent form requires nominal "
                        + "or clause content.");
                }

                break;
            case "impv":
                Require(dependent.Tag == "IMPV", "impv requires an imperative-lam dependent.");
                Require(head.Tag == "V", "impv requires a verbal head.");
                Require(head.Morphology?.Aspect == "IMPF", "impv requires an imperfect verb.");
                Require(head.Morphology?.Mood == "JUS", "impv requires jussive mood.");
                break;
            case "imrs":
                Require(
                    dependent.Kind == QacSyntaxNodeKind.Phrase
                    && dependent.Tag is "NS" or "VS",
                    "imrs requires a nominal or verbal sentence dependent.");
                Require(
                    head.Tag == "V",
                    "imrs requires a verbal head.");
                break;
            case "inc":
                Require(
                    head.Tag == "INC",
                    "inc requires an inceptive-particle head.");
                break;
            case "int":
                Require(
                    dependent.Kind == QacSyntaxNodeKind.Phrase
                    && dependent.Tag is "NS" or "VS",
                    "int requires a nominal or verbal sentence dependent.");
                Require(
                    head.Tag == "INT",
                    "int requires an interpretation-particle head.");
                break;
            case "intg":
                Require(
                    head.Tag == "INTG",
                    "intg requires an interrogative-particle head.");
                break;
            case "link":
                Require(
                    dependent.Kind == QacSyntaxNodeKind.Phrase
                    && dependent.Tag is "PP" or "S" or "SC"
                    || dependent.Tag
                        is "ADJ" or "DEM" or "INTG" or "LOC" or "N" or "T" or "VOC",
                    "link requires a prepositional/subordinate phrase "
                    + "or locative/temporal attachment dependent.");
                Require(
                    head.Kind == QacSyntaxNodeKind.Phrase
                    && head.Tag is "PP" or "VS"
                    || IsNominalContractNode(head)
                    || head.Tag is "EMPH" or "NEG" or "V",
                    "link requires a verbal or nominal attachment head.");
                break;
            case "neg":
                Require(
                    dependent.Tag == "NEG" || head.Tag == "NEG",
                    "neg requires a negative-particle endpoint.");
                if (head.Tag == "NEG")
                {
                    Require(
                        IsDependentAfterHeadWhenOrdered(dependent, head),
                        "neg content must follow its ordered negative head.");
                    if (dependent.Tag == "V"
                        && head.Morphology?.Lemma == "lam")
                    {
                        Require(
                            dependent.Morphology?.Aspect == "IMPF"
                            && dependent.Morphology.Mood == "JUS",
                            "neg with lam requires an imperfect jussive verb.");
                    }
                    else if (dependent.Tag == "V"
                             && head.Morphology?.Lemma == "lan")
                    {
                        Require(
                            dependent.Morphology?.Aspect == "IMPF"
                            && dependent.Morphology.Mood == "SUBJ",
                            "neg with lan requires an imperfect "
                            + "subjunctive verb.");
                    }
                }

                break;
            case "prev":
                Require(
                    dependent.Tag == "PREV",
                    "prev requires a preventive-particle dependent.");
                Require(
                    head.Tag is "ACC" or "P",
                    "prev requires an accusative-particle or preposition head.");
                break;
            case "pro":
                Require(dependent.Tag == "V", "pro requires a verbal dependent.");
                Require(head.Tag == "PRO", "pro requires a prohibition particle head.");
                Require(dependent.Morphology?.Aspect == "IMPF", "pro requires an imperfect verb.");
                Require(dependent.Morphology?.Mood == "JUS", "pro requires jussive mood.");
                break;
            case "res":
                Require(
                    dependent.Tag == "RES",
                    "res requires a restriction-particle dependent.");
                break;
            case "pred":
                Require(
                    IsPredicateNode(dependent),
                    "pred requires a nominal or clause predicate.");
                Require(
                    IsPredicateHead(head),
                    "pred requires a nominal subject head.");
                RequireNominalCaseIfMarked(
                    dependent,
                    "NOM",
                    edgeText,
                    errors);
                RequireNominalCaseIfMarked(
                    head,
                    "NOM",
                    edgeText,
                    errors);
                break;
            case "subjx":
                Require(
                    IsExtendedArgumentNode(dependent),
                    "subjx requires a nominal or subordinate-clause subject.");
                Require(
                    head.Tag is "ACC" or "NEG" or "V",
                    "subjx requires a special particle, negative, "
                    + "or special-verb head.");
                if (head.Tag == "ACC")
                {
                    RequireCase(dependent, "ACC", edgeText, errors);
                }
                else if (head.Tag == "V"
                         && dependent.Kind
                             is not QacSyntaxNodeKind.Phrase)
                {
                    RequireCase(dependent, "NOM", edgeText, errors);
                }

                break;
            case "predx":
                Require(
                    IsExtendedPredicateNode(dependent),
                    "predx requires a nominal or clause predicate.");
                Require(
                    head.Tag is "ACC" or "NEG" or "V",
                    "predx requires a special particle, negative, "
                    + "or special-verb head.");
                if (head.Tag == "ACC")
                {
                    RequireNominalCaseIfMarked(
                        dependent,
                        "NOM",
                        edgeText,
                        errors);
                }
                else if (head.Tag is "V" or "NEG")
                {
                    RequireNominalCaseIfMarked(
                        dependent,
                        "ACC",
                        edgeText,
                        errors);
                }

                break;
            case "ret":
                Require(
                    head.Tag == "RET",
                    "ret requires a retraction-particle head.");
                break;
            case "sup":
                Require(
                    dependent.Tag is "CONJ" or "REM" or "SUP",
                    "sup requires a supplemental-particle dependent.");
                break;
            case "sur":
                Require(
                    dependent.Tag is "N" or "PRON",
                    "sur requires a nominal dependent.");
                Require(
                    head.Tag == "SUR",
                    "sur requires a surprise-particle head.");
                break;
            case "fut":
                Require(dependent.Tag == "FUT", "fut requires a future particle dependent.");
                Require(head.Tag == "V", "fut requires a verbal head.");
                Require(head.Morphology?.Aspect == "IMPF", "fut requires an imperfect verb.");
                break;
            case "voc":
                Require(
                    CanonicalNominalTags.Contains(dependent.Tag),
                    "voc requires a nominal dependent.");
                Require(
                    head.Tag == "VOC",
                    "voc requires a vocative-particle head.");
                break;
        }
    }

    private static bool IsNominalContractNode(QacSyntaxNode node) =>
        CanonicalNominalTags.Contains(node.Tag)
        || node.Tag == "INTG"
        || node.Kind == QacSyntaxNodeKind.Empty
        && node.Tag == "N";

    private static bool IsAppositionNode(QacSyntaxNode node) =>
        IsNominalContractNode(node)
        || node.Kind == QacSyntaxNodeKind.Phrase
        && node.Tag is "CS" or "NS" or "PP" or "S" or "SC" or "VS";

    private static bool IsPredicateNode(QacSyntaxNode node) =>
        IsNominalContractNode(node)
        || node.Kind == QacSyntaxNodeKind.Phrase
        && node.Tag is "CS" or "NS" or "PP" or "S" or "SC" or "VS";

    private static bool IsPredicateHead(QacSyntaxNode node) =>
        IsNominalContractNode(node)
        || node.Kind == QacSyntaxNodeKind.Phrase
        && node.Tag is "NS" or "PP" or "SC" or "VS";

    private static bool IsExtendedArgumentNode(QacSyntaxNode node) =>
        IsNominalContractNode(node)
        || node.Kind == QacSyntaxNodeKind.Phrase
        && node.Tag is "NS" or "PP" or "SC";

    private static bool IsExtendedPredicateNode(QacSyntaxNode node) =>
        IsPredicateNode(node)
        || node.Kind == QacSyntaxNodeKind.Phrase
        && node.Tag == "CS";

    private static bool IsDependentAfterHeadWhenOrdered(
        QacSyntaxNode dependent,
        QacSyntaxNode head)
    {
        if (dependent.Location is { } dependentLocation
            && head.Location is { } headLocation)
        {
            return CompareLocation(dependentLocation, headLocation) > 0;
        }

        if (dependent.TextRange is { } dependentRange
            && head.TextRange is { } headRange)
        {
            return dependentRange.Start >= headRange.Start;
        }

        return true;
    }

    private static int CompareLocation(
        QacLocation left,
        QacLocation right)
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

    private static void RequireCaseAgreement(
        QacSyntaxNode dependent,
        QacSyntaxNode head,
        string edge,
        ICollection<QacSyntaxIssue> errors)
    {
        var dependentCase = dependent.Morphology?.GrammaticalCase;
        var headCase = head.Morphology?.GrammaticalCase;
        if (dependentCase is null
            || headCase is null
            || !IsNominalContractNode(dependent)
            || !IsNominalContractNode(head)
            || dependentCase == headCase)
        {
            return;
        }

        errors.Add(
            new QacSyntaxIssue(
                "ADG-QS1202",
                $"Expected case agreement but found "
                + $"{dependentCase} and {headCase}.",
                dependent.Id,
                edge));
    }

    private static void RequireMoodAgreement(
        QacSyntaxNode dependent,
        QacSyntaxNode head,
        string edge,
        ICollection<QacSyntaxIssue> errors)
    {
        if (dependent.Tag != "V"
            || head.Tag != "V"
            || dependent.Morphology?.Aspect != "IMPF"
            || head.Morphology?.Aspect != "IMPF"
            || dependent.Morphology.Mood == head.Morphology.Mood)
        {
            return;
        }

        errors.Add(
            new QacSyntaxIssue(
                "ADG-QS1201",
                $"Expected verbal mood agreement but found "
                + $"{dependent.Morphology.Mood ?? "unmarked"} and "
                + $"{head.Morphology.Mood ?? "unmarked"}.",
                dependent.Id,
                edge));
    }

    private static void RequireNominalCaseIfMarked(
        QacSyntaxNode node,
        string expectedCase,
        string edge,
        ICollection<QacSyntaxIssue> errors)
    {
        if (!IsNominalContractNode(node)
            || node.Morphology?.GrammaticalCase is null)
        {
            return;
        }

        RequireCase(node, expectedCase, edge, errors);
    }

    private static void RequireCase(
        QacSyntaxNode node,
        string expectedCase,
        string edge,
        ICollection<QacSyntaxIssue> errors)
    {
        if (node.Kind
            is QacSyntaxNodeKind.Empty
                or QacSyntaxNodeKind.Hidden
                or QacSyntaxNodeKind.Phrase)
        {
            return;
        }

        if (node.Tag is "PRON" or "DEM" or "REL"
            && node.Morphology?.GrammaticalCase is null)
        {
            return;
        }

        if (expectedCase == "GEN"
            && edge.Contains("-[poss]->", StringComparison.Ordinal)
            && HasDualObliqueSurfaceWithNominativeAnnotation(
                node.Morphology))
        {
            return;
        }

        if (node.Morphology?.GrammaticalCase != expectedCase)
        {
            errors.Add(
                new QacSyntaxIssue(
                    "ADG-QS1202",
                    $"Expected case {expectedCase} but found {node.Morphology?.GrammaticalCase ?? "unmarked"}.",
                    node.Id,
                    edge));
        }
    }

    internal static bool HasDualObliqueSurfaceWithNominativeAnnotation(
        QacNormalizedMorphologyRecord? morphology)
    {
        if (morphology?.GrammaticalCase != "NOM"
            || !morphology.RawFeatures.Any(
                feature => feature is "FD" or "MD"))
        {
            return false;
        }

        var surface = ExtendedBuckwalter.Decode(morphology.Form);
        var letters = QuranicDiacriticAnalyzer.Analyze(surface).BaseLetters;
        return letters.Count >= 2
            && letters[^2] == "\u064A"
            && letters[^1] == "\u0646";
    }

    private static bool HasCycle(
        QacDependencyGraph graph,
        IReadOnlyDictionary<string, QacSyntaxNode> nodes)
    {
        var heads = graph.Edges
            .Where(edge =>
                nodes.ContainsKey(edge.DependentId)
                && nodes.ContainsKey(edge.HeadId))
            .GroupBy(edge => edge.DependentId)
            .ToDictionary(
                group => group.Key,
                group => group.First().HeadId,
                StringComparer.Ordinal);

        foreach (var nodeId in nodes.Keys)
        {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            var current = nodeId;
            while (heads.TryGetValue(current, out var head))
            {
                if (!seen.Add(current))
                {
                    return true;
                }

                current = head;
            }
        }

        return false;
    }
}
