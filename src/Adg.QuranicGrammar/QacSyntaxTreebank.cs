using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Diagnostics.CodeAnalysis;
using Adg.QuranicCorpus;

namespace Adg.QuranicGrammar;

public static class QacSyntaxTreebankSource
{
    public const string Repository =
        "https://github.com/kaisdukes/quranic-corpus-api";

    public const string Commit =
        "17a9062416eccc332111ef3e84f74072d709e187";

    public const string ResourcePath =
        "src/main/resources/data/syntax.txt";

    public const string RawUrl =
        "https://raw.githubusercontent.com/kaisdukes/quranic-corpus-api/"
        + Commit
        + "/"
        + ResourcePath;

    public const string PinnedSha256 =
        "9a9037b23c2d8309838171af1b1d4d99528a4f07f8298e97a9d7fa04ce952491";

    public const string CompactMorphologyResourcePath =
        "src/main/resources/data/morphology.txt";

    public const string CompactMorphologyRawUrl =
        "https://raw.githubusercontent.com/kaisdukes/quranic-corpus-api/"
        + Commit
        + "/"
        + CompactMorphologyResourcePath;

    public const string CompactMorphologyPinnedSha256 =
        "f1d3417be9aac22d54fff9ddc34db0818d7f490d836471a0d9163b3a2c11c065";
}

public sealed record QacSyntaxTreebankIssue(
    string Code,
    int Line,
    string Message,
    int? Graph = null);

public sealed record QacSyntaxTreebankGraph(
    int SequenceNumber,
    int StartLine,
    int EndLine,
    QacDependencyGraph Graph);

public sealed class QacSyntaxTreebank
{
    internal QacSyntaxTreebank(
        IReadOnlyList<QacSyntaxTreebankGraph> graphs,
        string inputSha256,
        string? compactMorphologyInputSha256,
        string graphMerkleRoot)
    {
        Graphs = graphs;
        InputSha256 = inputSha256;
        CompactMorphologyInputSha256 = compactMorphologyInputSha256;
        GraphMerkleRoot = graphMerkleRoot;
    }

    public IReadOnlyList<QacSyntaxTreebankGraph> Graphs { get; }

    public string InputSha256 { get; }

    public string? CompactMorphologyInputSha256 { get; }

    public string GraphMerkleRoot { get; }

    public static QacSyntaxTreebank Load(
        string syntaxPath,
        IEnumerable<QacMorphologyRecord> morphologyRecords,
        string? compactMorphologyPath = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(syntaxPath);
        ArgumentNullException.ThrowIfNull(morphologyRecords);

        var inputSha256 = Convert.ToHexString(
            SHA256.HashData(File.ReadAllBytes(syntaxPath))).ToLowerInvariant();
        var morphology = BuildMorphologyIndex(
            morphologyRecords,
            compactMorphologyPath,
            out var compactMorphologyInputSha256);
        var parser = new Parser(syntaxPath, morphology);
        var graphs = parser.Parse();
        var leaves = graphs
            .Select(graph => SHA256.HashData(
                Encoding.UTF8.GetBytes(Canonicalize(graph))))
            .ToArray();
        return new QacSyntaxTreebank(
            graphs,
            inputSha256,
            compactMorphologyInputSha256,
            QacMerkle.ComputeRoot(leaves));
    }

    private static QacSyntaxMorphologyIndex
        BuildMorphologyIndex(
            IEnumerable<QacMorphologyRecord> records,
            string? compactMorphologyPath,
            out string? compactMorphologyInputSha256)
    {
        var materialized = records.ToArray();
        var baseline = materialized
            .Where(record => record.Tag != "DET")
            .GroupBy(record => record.Location.WordKey)
            .ToDictionary(
                group => group.Key,
                group => (IReadOnlyList<QacNormalizedMorphologyRecord>)group
                    .OrderBy(record => record.Location.Segment)
                    .Select(QacMorphologyResolver.Resolve)
                    .ToArray());
        if (compactMorphologyPath is not null)
        {
            compactMorphologyInputSha256 = Convert.ToHexString(
                SHA256.HashData(File.ReadAllBytes(compactMorphologyPath)))
                .ToLowerInvariant();
            return new QacSyntaxMorphologyIndex(
                baseline,
                QacCompactMorphologyReader.Read(
                    compactMorphologyPath,
                    materialized));
        }

        compactMorphologyInputSha256 = null;
        return new QacSyntaxMorphologyIndex(baseline, null);
    }

    private static string Canonicalize(QacSyntaxTreebankGraph source)
    {
        var builder = new StringBuilder();
        builder.Append(source.SequenceNumber).Append('\n');
        foreach (var node in source.Graph.Nodes)
        {
            builder
                .Append(node.Id).Append('\t')
                .Append(node.Kind).Append('\t')
                .Append(node.Tag).Append('\t')
                .Append(node.Location?.ToString() ?? string.Empty).Append('\t')
                .Append(node.Text ?? string.Empty).Append('\t')
                .Append(node.SpanStartTerminal?.ToString() ?? string.Empty).Append('\t')
                .Append(node.SpanEndTerminal?.ToString() ?? string.Empty)
                .Append('\n');
        }

        foreach (var edge in source.Graph.Edges)
        {
            builder
                .Append(edge.DependentId).Append('\t')
                .Append(edge.Relation).Append('\t')
                .Append(edge.HeadId)
                .Append('\n');
        }

        return builder.ToString();
    }

    private sealed class Parser
    {
        private static readonly Regex EdgePattern = new(
            @"^(?<relation>[a-z]+)\(n(?<dependent>\d+) - n(?<head>\d+)\)$",
            RegexOptions.CultureInvariant);

        private static readonly Regex IntervalPattern = new(
            @"^n(?<start>\d+) - n(?<end>\d+)$",
            RegexOptions.CultureInvariant);

        private readonly string syntaxPath;
        private readonly QacSyntaxMorphologyIndex morphology;
        private readonly List<QacSyntaxTreebankGraph> graphs = [];
        private readonly List<QacSyntaxNode> nodes = [];
        private readonly List<QacDependencyEdge> edges = [];
        private readonly Dictionary<int, QacSyntaxNode> aliases = [];
        private int lineNumber;
        private int graphStartLine;
        private int nextNodeNumber;

        public Parser(
            string syntaxPath,
            QacSyntaxMorphologyIndex morphology)
        {
            this.syntaxPath = Path.GetFullPath(syntaxPath);
            this.morphology = morphology;
        }

        public IReadOnlyList<QacSyntaxTreebankGraph> Parse()
        {
            using var stream = File.OpenRead(syntaxPath);
            using var reader = new StreamReader(
                stream,
                new UTF8Encoding(
                    encoderShouldEmitUTF8Identifier: false,
                    throwOnInvalidBytes: true),
                detectEncodingFromByteOrderMarks: true);

            string? line;
            while ((line = reader.ReadLine()) is not null)
            {
                lineNumber++;
                var value = line.Trim();
                if (value.Length == 0 || value.StartsWith("--", StringComparison.Ordinal))
                {
                    continue;
                }

                graphStartLine = graphStartLine == 0 ? lineNumber : graphStartLine;
                if (value == "go")
                {
                    CompleteGraph();
                }
                else if (value.Contains(" = ", StringComparison.Ordinal))
                {
                    ParseNode(value);
                }
                else
                {
                    ParseEdge(value);
                }
            }

            if (nodes.Count != 0 || edges.Count != 0 || aliases.Count != 0)
            {
                Fail("QAC-SYN0001", "The final graph is missing its 'go' terminator.");
            }

            return graphs;
        }

        private void ParseNode(string line)
        {
            var parts = line.Split(" = ", 2, StringSplitOptions.None);
            if (parts.Length != 2)
            {
                Fail("QAC-SYN0002", "Expected one node definition separator ' = '.");
            }

            var names = parts[0]
                .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
                .Select(ParseNodeName)
                .ToArray();
            if (names.Length == 0)
            {
                Fail("QAC-SYN0003", "A node definition requires at least one node name.");
            }

            foreach (var name in names)
            {
                var expected = ++nextNodeNumber;
                if (name != expected)
                {
                    Fail(
                        "QAC-SYN0004",
                        $"Expected node n{expected} but found n{name}.");
                }
            }

            var definition = parts[1];
            var open = definition.IndexOf('(');
            if (open <= 0 || definition[^1] != ')')
            {
                Fail("QAC-SYN0005", "A node definition must use tag(value) syntax.");
            }

            var tag = definition[..open];
            var argument = definition[(open + 1)..^1];
            if (tag is "word" or "reference")
            {
                AddCorpusNodes(names, tag == "reference", argument);
                return;
            }

            if (QacSyntaxCatalog.PhraseTags.ContainsKey(tag))
            {
                AddPhraseNode(names, tag, argument);
                return;
            }

            AddElidedNode(names, tag, argument);
        }

        private void AddCorpusNodes(
            IReadOnlyList<int> names,
            bool reference,
            string value)
        {
            var key = ParseWordKey(value);
            if (!morphology.TryResolve(key, names.Count, out var segments))
            {
                Fail(
                    "QAC-SYN0007",
                    $"Word {key} defines {names.Count} syntax nodes but no compatible "
                    + "baseline or compact morphology segmentation was found.");
            }

            for (var index = 0; index < names.Count; index++)
            {
                var morphologyRecord = segments[index];
                if (!QacLocation.TryParse(morphologyRecord.Location, out var location))
                {
                    Fail(
                        "QAC-SYN0008",
                        $"Resolved morphology location '{morphologyRecord.Location}' is invalid.");
                }

                AddNode(
                    names[index],
                    new QacSyntaxNode(
                        NodeId(names[index]),
                        reference
                            ? QacSyntaxNodeKind.Reference
                            : QacSyntaxNodeKind.Terminal,
                        morphologyRecord.Tag,
                        morphologyRecord.Form.Length == 0
                            ? null
                            : ExtendedBuckwalter.Decode(morphologyRecord.Form),
                        location,
                        Morphology: morphologyRecord));
            }
        }

        private void AddPhraseNode(
            IReadOnlyList<int> names,
            string tag,
            string value)
        {
            if (names.Count != 1)
            {
                Fail("QAC-SYN0009", "A phrase definition requires exactly one node name.");
            }

            var (start, end) = ParseInterval(value);
            RequireExistingAlias(start);
            RequireExistingAlias(end);
            if (aliases[start].Kind == QacSyntaxNodeKind.Phrase
                || aliases[end].Kind == QacSyntaxNodeKind.Phrase)
            {
                Fail(
                    "QAC-SYN0010",
                    "Phrase intervals must be bounded by terminal, reference, hidden, or empty nodes.");
            }

            AddNode(
                names[0],
                new QacSyntaxNode(
                    NodeId(names[0]),
                    QacSyntaxNodeKind.Phrase,
                    tag,
                    SpanStartTerminal: start,
                    SpanEndTerminal: end));
        }

        private void AddElidedNode(
            IReadOnlyList<int> names,
            string tag,
            string value)
        {
            if (names.Count != 1)
            {
                Fail("QAC-SYN0011", "An elided definition requires exactly one node name.");
            }

            if (!QacMorphologyCatalog.Tags.ContainsKey(tag) || tag == "DET")
            {
                Fail("QAC-SYN0012", $"Unknown elided part-of-speech tag '{tag}'.");
            }

            AddNode(
                names[0],
                new QacSyntaxNode(
                    NodeId(names[0]),
                    value == "*"
                        ? QacSyntaxNodeKind.Empty
                        : QacSyntaxNodeKind.Hidden,
                    tag,
                    value == "*" ? null : value));
        }

        private void ParseEdge(string line)
        {
            var match = EdgePattern.Match(line);
            if (!match.Success)
            {
                Fail(
                    "QAC-SYN0013",
                    "An edge must use relation(nDependent - nHead) syntax.");
            }

            var relation = match.Groups["relation"].Value;
            if (!QacSyntaxCatalog.DependencyRelations.ContainsKey(relation))
            {
                Fail("QAC-SYN0014", $"Unknown dependency relation '{relation}'.");
            }

            var dependent = int.Parse(
                match.Groups["dependent"].Value,
                System.Globalization.CultureInfo.InvariantCulture);
            var head = int.Parse(
                match.Groups["head"].Value,
                System.Globalization.CultureInfo.InvariantCulture);
            RequireExistingAlias(dependent);
            RequireExistingAlias(head);
            edges.Add(
                new QacDependencyEdge(
                    aliases[dependent].Id,
                    aliases[head].Id,
                    relation));
        }

        private void CompleteGraph()
        {
            if (nodes.Count == 0)
            {
                Fail("QAC-SYN0015", "A syntax graph cannot be empty.");
            }

            var sequence = graphs.Count + 1;
            var graph = new QacDependencyGraph(
                $"qac-syntax-{sequence:D5}",
                nodes.ToArray(),
                edges.ToArray());
            graphs.Add(
                new QacSyntaxTreebankGraph(
                    sequence,
                    graphStartLine,
                    lineNumber,
                    graph));
            nodes.Clear();
            edges.Clear();
            aliases.Clear();
            nextNodeNumber = 0;
            graphStartLine = 0;
        }

        private void AddNode(int alias, QacSyntaxNode node)
        {
            if (!aliases.TryAdd(alias, node))
            {
                Fail("QAC-SYN0016", $"Duplicate node alias n{alias}.");
            }

            nodes.Add(node);
        }

        private void RequireExistingAlias(int alias)
        {
            if (!aliases.ContainsKey(alias))
            {
                Fail("QAC-SYN0017", $"Node alias n{alias} has not been defined.");
            }
        }

        private int ParseNodeName(string value)
        {
            var number = 0;
            if (value.Length < 2
                || value[0] != 'n'
                || !int.TryParse(
                    value.AsSpan(1),
                    System.Globalization.NumberStyles.None,
                    System.Globalization.CultureInfo.InvariantCulture,
                    out number)
                || number < 1)
            {
                Fail("QAC-SYN0018", $"Invalid node name '{value}'.");
            }

            return number;
        }

        private (int Start, int End) ParseInterval(string value)
        {
            var match = IntervalPattern.Match(value);
            if (!match.Success)
            {
                Fail("QAC-SYN0019", $"Invalid node interval '{value}'.");
            }

            return (
                int.Parse(
                    match.Groups["start"].Value,
                    System.Globalization.CultureInfo.InvariantCulture),
                int.Parse(
                    match.Groups["end"].Value,
                    System.Globalization.CultureInfo.InvariantCulture));
        }

        private QacWordKey ParseWordKey(string value)
        {
            var parts = value.Split(':');
            var chapter = 0;
            var verse = 0;
            var word = 0;
            if (parts.Length != 3
                || !int.TryParse(parts[0], out chapter)
                || !int.TryParse(parts[1], out verse)
                || !int.TryParse(parts[2], out word)
                || chapter is < 1 or > 114
                || verse < 1
                || word < 1)
            {
                Fail("QAC-SYN0020", $"Invalid Quranic word location '{value}'.");
            }

            return new QacWordKey(chapter, verse, word);
        }

        private string NodeId(int alias) =>
            $"g{graphs.Count + 1:D5}n{alias}";

        [DoesNotReturn]
        private void Fail(string code, string message) =>
            throw new InvalidDataException(
                $"{code} at line {lineNumber}, graph {graphs.Count + 1}: {message}");
    }
}

internal sealed class QacSyntaxMorphologyIndex
{
    private readonly IReadOnlyDictionary<
        QacWordKey,
        IReadOnlyList<QacNormalizedMorphologyRecord>> baseline;
    private readonly IReadOnlyDictionary<
        QacWordKey,
        IReadOnlyList<QacNormalizedMorphologyRecord>>? compact;

    public QacSyntaxMorphologyIndex(
        IReadOnlyDictionary<
            QacWordKey,
            IReadOnlyList<QacNormalizedMorphologyRecord>> baseline,
        IReadOnlyDictionary<
            QacWordKey,
            IReadOnlyList<QacNormalizedMorphologyRecord>>? compact)
    {
        this.baseline = baseline;
        this.compact = compact;
    }

    public bool TryResolve(
        QacWordKey key,
        int expectedCount,
        out IReadOnlyList<QacNormalizedMorphologyRecord> segments)
    {
        segments = [];
        if (!baseline.TryGetValue(key, out var baselineSegments))
        {
            return false;
        }

        if (baselineSegments.Count == expectedCount)
        {
            segments = baselineSegments;
            return true;
        }

        if (compact is null
            || !compact.TryGetValue(key, out var compactSegments))
        {
            return false;
        }

        if (compactSegments.Count == expectedCount)
        {
            segments = compactSegments;
            return true;
        }

        if (compactSegments.Count + 1 == expectedCount
            && compactSegments.Count > 0
            && compactSegments[0].Tag == "V"
            && compactSegments[0].PersonGenderNumber is { } pgn
            && QacLocation.TryParse(compactSegments[0].Location, out var verbLocation))
        {
            var pronoun = QacMorphologyResolver.Resolve(
                new QacMorphologyRecord(
                    new QacLocation(
                        verbLocation.Chapter,
                        verbLocation.Verse,
                        verbLocation.Word,
                        verbLocation.Segment + 1),
                    string.Empty,
                    "PRON",
                    QacSegmentKind.Suffix,
                    ["SUFFIX", $"PRON:{pgn}"],
                    $"SUFFIX|PRON:{pgn}",
                    0));
            segments = [compactSegments[0], pronoun, .. compactSegments.Skip(1)];
            return true;
        }

        return false;
    }
}

internal static class QacCompactMorphologyReader
{
    private static readonly IReadOnlyDictionary<string, string> PrefixTags =
        QacMorphologyCatalog.PrefixFeaturesByTag
            .SelectMany(pair => pair.Value.Select(feature => (feature, pair.Key)))
            .ToDictionary(pair => pair.feature, pair => pair.Key, StringComparer.Ordinal);

    public static IReadOnlyDictionary<
        QacWordKey,
        IReadOnlyList<QacNormalizedMorphologyRecord>> Read(
        string path,
        IReadOnlyList<QacMorphologyRecord> locationSource)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        ArgumentNullException.ThrowIfNull(locationSource);

        var words = locationSource
            .GroupBy(record => record.Location.WordKey)
            .OrderBy(group => group.Key.Chapter)
            .ThenBy(group => group.Key.Verse)
            .ThenBy(group => group.Key.Word)
            .Select(group => group.Key)
            .ToArray();
        var lines = File.ReadAllLines(
            path,
            new UTF8Encoding(
                encoderShouldEmitUTF8Identifier: false,
                throwOnInvalidBytes: true));
        if (lines.Length != words.Length)
        {
            throw new InvalidDataException(
                $"QAC-CMP0001: Compact morphology has {lines.Length} lines but "
                + $"the location source has {words.Length} words.");
        }

        var result = new Dictionary<
            QacWordKey,
            IReadOnlyList<QacNormalizedMorphologyRecord>>();
        for (var index = 0; index < words.Length; index++)
        {
            result.Add(
                words[index],
                ParseWord(words[index], lines[index], index + 1));
        }

        return result;
    }

    private static IReadOnlyList<QacNormalizedMorphologyRecord> ParseWord(
        QacWordKey word,
        string line,
        int lineNumber)
    {
        var tokens = line.Split(
            ' ',
            StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (tokens.Length == 0)
        {
            throw new InvalidDataException(
                $"QAC-CMP0002 at line {lineNumber}: A word cannot have empty morphology.");
        }

        var segments = new List<(string Tag, QacSegmentKind Kind, IReadOnlyList<string> Features)>();
        List<string>? stem = null;

        void FlushStem()
        {
            if (stem is null)
            {
                return;
            }

            var tag = stem[0]["POS:".Length..];
            segments.Add((tag, QacSegmentKind.Stem, ["STEM", .. stem]));
            stem = null;
        }

        foreach (var token in tokens)
        {
            if (token.StartsWith("POS:", StringComparison.Ordinal))
            {
                FlushStem();
                var tag = token["POS:".Length..];
                if (!QacMorphologyCatalog.Tags.ContainsKey(tag))
                {
                    throw new InvalidDataException(
                        $"QAC-CMP0003 at line {lineNumber}: Unknown POS tag '{tag}'.");
                }

                stem = [token];
                continue;
            }

            if (PrefixTags.TryGetValue(token, out var prefixTag))
            {
                FlushStem();
                segments.Add(
                    (prefixTag, QacSegmentKind.Prefix, ["PREFIX", token]));
                continue;
            }

            if (token.StartsWith("PRON:", StringComparison.Ordinal)
                || token == "+n:EMPH")
            {
                FlushStem();
                var suffixTag = token == "+n:EMPH" ? "EMPH" : "PRON";
                segments.Add(
                    (suffixTag, QacSegmentKind.Suffix, ["SUFFIX", token]));
                continue;
            }

            if (stem is null)
            {
                throw new InvalidDataException(
                    $"QAC-CMP0004 at line {lineNumber}: Feature '{token}' has no stem.");
            }

            if (!QacMorphologyCatalog.IsKnownFeature(token))
            {
                throw new InvalidDataException(
                    $"QAC-CMP0005 at line {lineNumber}: Unknown feature '{token}'.");
            }

            stem.Add(token);
        }

        FlushStem();
        if (segments.Count == 0)
        {
            throw new InvalidDataException(
                $"QAC-CMP0006 at line {lineNumber}: No morphology segments were parsed.");
        }

        var normalized = new List<QacNormalizedMorphologyRecord>();
        for (var index = 0; index < segments.Count; index++)
        {
            var segment = segments[index];
            if (segment.Tag == "DET")
            {
                continue;
            }

            var location = new QacLocation(
                word.Chapter,
                word.Verse,
                word.Word,
                index + 1);
            normalized.Add(
                QacMorphologyResolver.Resolve(
                    new QacMorphologyRecord(
                        location,
                        string.Empty,
                        segment.Tag,
                        segment.Kind,
                        segment.Features,
                        string.Join('|', segment.Features),
                        lineNumber)));
        }

        return normalized;
    }
}

public sealed class QacSyntaxTreebankVerificationReport
{
    public required string SourceRepository { get; init; }

    public required string SourceCommit { get; init; }

    public required string SourceResourcePath { get; init; }

    public required string InputSha256 { get; init; }

    public string? CompactMorphologyInputSha256 { get; init; }

    public bool MatchesPinnedSyntaxSource { get; init; }

    public bool MatchesPinnedCompactMorphology { get; init; }

    public long GraphCount { get; init; }

    public long NodeCount { get; init; }

    public long EdgeCount { get; init; }

    public long TerminalNodeCount { get; init; }

    public long ReferenceNodeCount { get; init; }

    public long HiddenNodeCount { get; init; }

    public long EmptyNodeCount { get; init; }

    public long PhraseNodeCount { get; init; }

    public long ChapterCount { get; init; }

    public long VerseCount { get; init; }

    public long WordCount { get; init; }

    public long RelationCatalogCoverage { get; init; }

    public long PhraseTagCatalogCoverage { get; init; }

    public SortedDictionary<string, long> NodeKindCounts { get; init; } =
        new(StringComparer.Ordinal);

    public SortedDictionary<string, long> PhraseTagCounts { get; init; } =
        new(StringComparer.Ordinal);

    public SortedDictionary<string, long> RelationCounts { get; init; } =
        new(StringComparer.Ordinal);

    public SortedDictionary<string, long> RelationNodeSignatureCounts { get; init; } =
        new(StringComparer.Ordinal);

    public SortedDictionary<string, long> ValidationIssueCounts { get; init; } =
        new(StringComparer.Ordinal);

    public SortedDictionary<string, long> ValidationRelationIssueCounts { get; init; } =
        new(StringComparer.Ordinal);

    public long GraphValidationErrorCount { get; init; }

    public long CanonicalContractMismatchCount { get; init; }

    public IReadOnlyList<QacSyntaxTreebankIssue> Errors { get; init; } = [];

    public IReadOnlyList<QacSyntaxTreebankIssue> CanonicalContractSamples { get; init; } = [];

    public required string GraphMerkleRoot { get; init; }

    public bool IsValid => Errors.Count == 0 && GraphValidationErrorCount == 0;
}

public static class QacSyntaxTreebankVerifier
{
    public static QacSyntaxTreebankVerificationReport VerifyFile(
        string syntaxPath,
        IEnumerable<QacMorphologyRecord> morphologyRecords,
        string? compactMorphologyPath = null,
        bool requirePinnedSource = false,
        int maxReportedErrors = 100)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(syntaxPath);
        ArgumentNullException.ThrowIfNull(morphologyRecords);
        if (maxReportedErrors < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(maxReportedErrors));
        }

        QacSyntaxTreebank treebank;
        try
        {
            treebank = QacSyntaxTreebank.Load(
                syntaxPath,
                morphologyRecords,
                compactMorphologyPath);
        }
        catch (InvalidDataException exception)
        {
            var hash = File.Exists(syntaxPath)
                ? Convert.ToHexString(
                    SHA256.HashData(File.ReadAllBytes(syntaxPath))).ToLowerInvariant()
                : string.Empty;
            return new QacSyntaxTreebankVerificationReport
            {
                SourceRepository = QacSyntaxTreebankSource.Repository,
                SourceCommit = QacSyntaxTreebankSource.Commit,
                SourceResourcePath = QacSyntaxTreebankSource.ResourcePath,
                InputSha256 = hash,
                CompactMorphologyInputSha256 =
                    compactMorphologyPath is not null && File.Exists(compactMorphologyPath)
                        ? Convert.ToHexString(
                            SHA256.HashData(File.ReadAllBytes(compactMorphologyPath)))
                            .ToLowerInvariant()
                        : null,
                MatchesPinnedSyntaxSource =
                    hash == QacSyntaxTreebankSource.PinnedSha256,
                MatchesPinnedCompactMorphology =
                    compactMorphologyPath is not null
                    && File.Exists(compactMorphologyPath)
                    && Convert.ToHexString(
                        SHA256.HashData(File.ReadAllBytes(compactMorphologyPath)))
                        .ToLowerInvariant()
                    == QacSyntaxTreebankSource.CompactMorphologyPinnedSha256,
                Errors = [new QacSyntaxTreebankIssue("QAC-SYN0099", 0, exception.Message)],
                GraphMerkleRoot = string.Empty,
            };
        }

        var nodeKinds = new SortedDictionary<string, long>(StringComparer.Ordinal);
        var phraseTags = new SortedDictionary<string, long>(StringComparer.Ordinal);
        var relations = new SortedDictionary<string, long>(StringComparer.Ordinal);
        var relationNodeSignatures =
            new SortedDictionary<string, long>(StringComparer.Ordinal);
        var validationIssues = new SortedDictionary<string, long>(StringComparer.Ordinal);
        var validationRelationIssues =
            new SortedDictionary<string, long>(StringComparer.Ordinal);
        var errors = new List<QacSyntaxTreebankIssue>();
        var canonicalContractSamples = new List<QacSyntaxTreebankIssue>();
        var chapters = new HashSet<int>();
        var verses = new HashSet<QacVerseKey>();
        var words = new HashSet<QacWordKey>();
        long nodeCount = 0;
        long edgeCount = 0;
        long graphValidationErrorCount = 0;

        foreach (var sourceGraph in treebank.Graphs)
        {
            var graph = sourceGraph.Graph;
            nodeCount += graph.Nodes.Count;
            edgeCount += graph.Edges.Count;
            foreach (var node in graph.Nodes)
            {
                var kind = node.Kind.ToString();
                nodeKinds.TryGetValue(kind, out var kindCount);
                nodeKinds[kind] = kindCount + 1;
                if (node.Kind == QacSyntaxNodeKind.Phrase)
                {
                    phraseTags.TryGetValue(node.Tag, out var phraseCount);
                    phraseTags[node.Tag] = phraseCount + 1;
                }

                if (node.Kind == QacSyntaxNodeKind.Terminal && node.Location is { } location)
                {
                    chapters.Add(location.Chapter);
                    verses.Add(location.VerseKey);
                    words.Add(location.WordKey);
                }
            }

            var nodesById = graph.Nodes.ToDictionary(node => node.Id);
            foreach (var edge in graph.Edges)
            {
                relations.TryGetValue(edge.Relation, out var relationCount);
                relations[edge.Relation] = relationCount + 1;
                var dependent = nodesById[edge.DependentId];
                var head = nodesById[edge.HeadId];
                var signature = string.Concat(
                    edge.Relation,
                    "|",
                    dependent.Kind,
                    ":",
                    dependent.Tag,
                    ":",
                    dependent.Morphology?.GrammaticalCase ?? "-",
                    "->",
                    head.Kind,
                    ":",
                    head.Tag,
                    ":",
                    head.Morphology?.GrammaticalCase ?? "-");
                relationNodeSignatures.TryGetValue(signature, out var signatureCount);
                relationNodeSignatures[signature] = signatureCount + 1;
            }

            var structuralValidation = QacSyntaxValidator.Validate(
                graph,
                QacSyntaxValidationProfile.Structural);
            graphValidationErrorCount += structuralValidation.Errors.Count;
            foreach (var issue in structuralValidation.Errors)
            {
                if (errors.Count < maxReportedErrors)
                {
                    errors.Add(
                        new QacSyntaxTreebankIssue(
                            issue.Code,
                            sourceGraph.StartLine,
                            issue.Message,
                            sourceGraph.SequenceNumber));
                }
            }

            var canonicalValidation = QacSyntaxValidator.Validate(
                graph,
                QacSyntaxValidationProfile.Canonical);
            foreach (var issue in canonicalValidation.Errors)
            {
                var issueKey = $"{issue.Code}|{issue.Message}";
                validationIssues.TryGetValue(issueKey, out var issueCount);
                validationIssues[issueKey] = issueCount + 1;
                if (TryReadRelation(issue.Edge, out var relation))
                {
                    var relationKey = $"{relation}|{issue.Code}";
                    validationRelationIssues.TryGetValue(
                        relationKey,
                        out var relationIssueCount);
                    validationRelationIssues[relationKey] = relationIssueCount + 1;
                }

                if (canonicalContractSamples.Count < maxReportedErrors)
                {
                    canonicalContractSamples.Add(
                        new QacSyntaxTreebankIssue(
                            issue.Code,
                            sourceGraph.StartLine,
                            issue.Message,
                            sourceGraph.SequenceNumber));
                }
            }
        }

        var matchesPinnedSyntax =
            treebank.InputSha256 == QacSyntaxTreebankSource.PinnedSha256;
        var matchesPinnedCompactMorphology =
            treebank.CompactMorphologyInputSha256
            == QacSyntaxTreebankSource.CompactMorphologyPinnedSha256;
        if (requirePinnedSource
            && (!matchesPinnedSyntax || !matchesPinnedCompactMorphology))
        {
            errors.Add(
                new QacSyntaxTreebankIssue(
                    "QAC-SYN0021",
                    0,
                    "The syntax or compact morphology input does not match the pinned "
                    + "official source SHA-256."));
        }

        return new QacSyntaxTreebankVerificationReport
        {
            SourceRepository = QacSyntaxTreebankSource.Repository,
            SourceCommit = QacSyntaxTreebankSource.Commit,
            SourceResourcePath = QacSyntaxTreebankSource.ResourcePath,
            InputSha256 = treebank.InputSha256,
            CompactMorphologyInputSha256 = treebank.CompactMorphologyInputSha256,
            MatchesPinnedSyntaxSource = matchesPinnedSyntax,
            MatchesPinnedCompactMorphology = matchesPinnedCompactMorphology,
            GraphCount = treebank.Graphs.Count,
            NodeCount = nodeCount,
            EdgeCount = edgeCount,
            TerminalNodeCount = nodeKinds.GetValueOrDefault(
                QacSyntaxNodeKind.Terminal.ToString()),
            ReferenceNodeCount = nodeKinds.GetValueOrDefault(
                QacSyntaxNodeKind.Reference.ToString()),
            HiddenNodeCount = nodeKinds.GetValueOrDefault(
                QacSyntaxNodeKind.Hidden.ToString()),
            EmptyNodeCount = nodeKinds.GetValueOrDefault(
                QacSyntaxNodeKind.Empty.ToString()),
            PhraseNodeCount = nodeKinds.GetValueOrDefault(
                QacSyntaxNodeKind.Phrase.ToString()),
            ChapterCount = chapters.Count,
            VerseCount = verses.Count,
            WordCount = words.Count,
            RelationCatalogCoverage = relations.Keys.Count(
                QacSyntaxCatalog.DependencyRelations.ContainsKey),
            PhraseTagCatalogCoverage = phraseTags.Keys.Count(
                QacSyntaxCatalog.PhraseTags.ContainsKey),
            NodeKindCounts = nodeKinds,
            PhraseTagCounts = phraseTags,
            RelationCounts = relations,
            RelationNodeSignatureCounts = relationNodeSignatures,
            ValidationIssueCounts = validationIssues,
            ValidationRelationIssueCounts = validationRelationIssues,
            GraphValidationErrorCount = graphValidationErrorCount,
            CanonicalContractMismatchCount = validationIssues.Values.Sum(),
            Errors = errors,
            CanonicalContractSamples = canonicalContractSamples,
            GraphMerkleRoot = treebank.GraphMerkleRoot,
        };
    }

    private static bool TryReadRelation(string? edge, out string relation)
    {
        relation = string.Empty;
        if (edge is null)
        {
            return false;
        }

        var start = edge.IndexOf("-[", StringComparison.Ordinal);
        var end = edge.IndexOf("]->", StringComparison.Ordinal);
        if (start < 0 || end <= start + 2)
        {
            return false;
        }

        relation = edge[(start + 2)..end];
        return true;
    }
}
