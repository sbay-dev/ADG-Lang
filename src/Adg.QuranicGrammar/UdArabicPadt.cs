using System.Security.Cryptography;
using System.Text;
using Adg.QuranicCore;
using Adg.QuranicCorpus;

namespace Adg.QuranicGrammar;

public sealed record UdArabicSourceDescriptor(
    string Repository,
    string Commit,
    string Resource,
    string Sha256,
    string License,
    string EvaluationRole);

public static class UdArabicPadtSource
{
    public const string Repository =
        "https://github.com/UniversalDependencies/UD_Arabic-PADT";

    public const string Commit =
        "dfb6b4c547f1fe10f1857b39e44de3f86c47a2fe";

    public const string TestResource = "ar_padt-ud-test.conllu";

    public const string TestSha256 =
        "793c87bf173d491af2092ef7f87b04a2cf6c596490e7347a2065058a053a6389";

    public const string License = "CC BY-NC-SA 3.0";

    public static UdArabicSourceDescriptor Descriptor { get; } =
        new(
            Repository,
            Commit,
            TestResource,
            TestSha256,
            License,
            "external-development-benchmark");
}

public static class UdArabicPudSource
{
    public const string Repository =
        "https://github.com/UniversalDependencies/UD_Arabic-PUD";

    public const string Commit =
        "b5dbaa1fe386ae38d9b3c5f1de1b047d3cb31e0f";

    public const string TestResource = "ar_pud-ud-test.conllu";

    public const string TestSha256 =
        "befc6dd18b5b8803644ae8208e2e5f52c0957a36437627c05110914ec42281a3";

    public const string License = "CC BY-SA 3.0";

    public static UdArabicSourceDescriptor Descriptor { get; } =
        new(
            Repository,
            Commit,
            TestResource,
            TestSha256,
            License,
            "untouched-final-holdout");
}

public sealed record UdArabicToken(
    int Id,
    string Form,
    string Lemma,
    string UniversalPartOfSpeech,
    string Features,
    int Head,
    string DependencyRelation,
    string Misc);

public sealed record UdArabicOrthographicToken(
    int Index,
    string Form,
    SourceRange Range,
    int FirstSyntacticTokenId,
    int LastSyntacticTokenId);

public sealed record UdArabicSentence(
    string Id,
    string Text,
    IReadOnlyList<UdArabicToken> Tokens,
    IReadOnlyList<UdArabicOrthographicToken> OrthographicTokens);

public sealed class UdArabicCorpus
{
    private UdArabicCorpus(
        IReadOnlyList<UdArabicSentence> sentences,
        string inputSha256,
        string sentenceMerkleRoot)
    {
        Sentences = sentences;
        InputSha256 = inputSha256;
        SentenceMerkleRoot = sentenceMerkleRoot;
    }

    public IReadOnlyList<UdArabicSentence> Sentences { get; }

    public string InputSha256 { get; }

    public string SentenceMerkleRoot { get; }

    public static UdArabicCorpus Load(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        var sentences = new List<UdArabicSentence>();
        var sentenceIds = new HashSet<string>(StringComparer.Ordinal);
        var comments = new Dictionary<string, string>(StringComparer.Ordinal);
        var tokens = new List<UdArabicToken>();
        var multiwordTokens = new List<UdMultiwordToken>();
        var lineNumber = 0;

        void CompleteSentence()
        {
            if (comments.Count == 0 && tokens.Count == 0)
            {
                return;
            }

            if (!comments.TryGetValue("sent_id", out var sentenceId)
                || string.IsNullOrWhiteSpace(sentenceId))
            {
                throw new InvalidDataException(
                    $"UD-AR0001 at line {lineNumber}: Sentence id is missing.");
            }

            if (!comments.TryGetValue("text", out var text)
                || string.IsNullOrWhiteSpace(text))
            {
                throw new InvalidDataException(
                    $"UD-AR0002 at line {lineNumber}: Sentence text is missing.");
            }

            if (!sentenceIds.Add(sentenceId))
            {
                throw new InvalidDataException(
                    $"UD-AR0003 at line {lineNumber}: Duplicate sentence id '{sentenceId}'.");
            }

            ValidateTokens(tokens, multiwordTokens, sentenceId, lineNumber);
            var orthographicTokens = BuildOrthographicTokens(
                text,
                tokens,
                multiwordTokens,
                sentenceId,
                lineNumber);
            sentences.Add(
                new UdArabicSentence(
                    sentenceId,
                    text,
                    tokens.ToArray(),
                    orthographicTokens));
            comments.Clear();
            tokens.Clear();
            multiwordTokens.Clear();
        }

        using var stream = File.OpenRead(path);
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
            if (line.Length == 0)
            {
                CompleteSentence();
                continue;
            }

            if (line.StartsWith("# ", StringComparison.Ordinal))
            {
                var separator = line.IndexOf(" = ", StringComparison.Ordinal);
                if (separator > 2)
                {
                    comments[line[2..separator]] = line[(separator + 3)..];
                }

                continue;
            }

            var columns = line.Split('\t');
            if (columns.Length != 10)
            {
                throw new InvalidDataException(
                    $"UD-AR0004 at line {lineNumber}: Expected ten CoNLL-U columns.");
            }

            if (columns[0].Contains('-'))
            {
                var bounds = columns[0].Split('-');
                if (bounds.Length != 2
                    || !int.TryParse(bounds[0], out var first)
                    || !int.TryParse(bounds[1], out var last)
                    || first >= last)
                {
                    throw new InvalidDataException(
                        $"UD-AR0012 at line {lineNumber}: Invalid multiword token id.");
                }

                multiwordTokens.Add(
                    new UdMultiwordToken(first, last, columns[1], columns[9]));
                continue;
            }

            if (columns[0].Contains('.'))
            {
                continue;
            }

            if (!int.TryParse(columns[0], out var id)
                || !int.TryParse(columns[6], out var head))
            {
                throw new InvalidDataException(
                    $"UD-AR0005 at line {lineNumber}: Invalid token id or head.");
            }

            tokens.Add(
                new UdArabicToken(
                    id,
                    columns[1],
                    columns[2],
                    columns[3],
                    columns[5],
                    head,
                    columns[7],
                    columns[9]));
        }

        CompleteSentence();
        var leaves = sentences.Select(sentence =>
            SHA256.HashData(
                Encoding.UTF8.GetBytes(
                    string.Concat(
                        sentence.Id,
                        "\t",
                        sentence.Text,
                        "\t",
                        string.Join(
                            "\u001E",
                            sentence.Tokens.Select(token =>
                                $"{token.Id}:{token.Head}:{token.DependencyRelation}"))))))
            .ToArray();
        return new UdArabicCorpus(
            sentences,
            Convert.ToHexString(
                SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant(),
            QacMerkle.ComputeRoot(leaves));
    }

    private static void ValidateTokens(
        IReadOnlyList<UdArabicToken> tokens,
        IReadOnlyList<UdMultiwordToken> multiwordTokens,
        string sentenceId,
        int lineNumber)
    {
        if (tokens.Count == 0)
        {
            throw new InvalidDataException(
                $"UD-AR0006 at line {lineNumber}: Sentence '{sentenceId}' has no tokens.");
        }

        for (var index = 0; index < tokens.Count; index++)
        {
            var token = tokens[index];
            if (token.Id != index + 1)
            {
                throw new InvalidDataException(
                    $"UD-AR0007 at line {lineNumber}: Sentence '{sentenceId}' "
                    + $"expected token {index + 1} but found {token.Id}.");
            }

            if (token.Head < 0
                || token.Head > tokens.Count
                || token.Head == token.Id)
            {
                throw new InvalidDataException(
                    $"UD-AR0008 at line {lineNumber}: Token {token.Id} in "
                    + $"'{sentenceId}' has invalid head {token.Head}.");
            }

            if (string.IsNullOrWhiteSpace(token.UniversalPartOfSpeech)
                || string.IsNullOrWhiteSpace(token.DependencyRelation))
            {
                throw new InvalidDataException(
                    $"UD-AR0009 at line {lineNumber}: Token {token.Id} in "
                    + $"'{sentenceId}' lacks UPOS or DEPREL.");
            }
        }

        if (tokens.Count(token => token.Head == 0) != 1)
        {
            throw new InvalidDataException(
                $"UD-AR0010 at line {lineNumber}: Sentence '{sentenceId}' "
                + "must have exactly one root.");
        }

        foreach (var token in tokens)
        {
            var visited = new HashSet<int>();
            var current = token;
            while (current.Head != 0)
            {
                if (!visited.Add(current.Id))
                {
                    throw new InvalidDataException(
                        $"UD-AR0011 at line {lineNumber}: Sentence '{sentenceId}' "
                        + "contains a dependency cycle.");
                }

                current = tokens[current.Head - 1];
            }
        }

        var covered = new HashSet<int>();
        foreach (var multiword in multiwordTokens.OrderBy(item => item.First))
        {
            if (multiword.First < 1
                || multiword.Last > tokens.Count
                || !covered.Add(multiword.First))
            {
                throw new InvalidDataException(
                    $"UD-AR0013 at line {lineNumber}: Sentence '{sentenceId}' "
                    + "contains an invalid or overlapping multiword token.");
            }

            for (var id = multiword.First + 1; id <= multiword.Last; id++)
            {
                if (!covered.Add(id))
                {
                    throw new InvalidDataException(
                        $"UD-AR0013 at line {lineNumber}: Sentence '{sentenceId}' "
                        + "contains overlapping multiword tokens.");
                }
            }
        }
    }

    private static IReadOnlyList<UdArabicOrthographicToken> BuildOrthographicTokens(
        string text,
        IReadOnlyList<UdArabicToken> tokens,
        IReadOnlyList<UdMultiwordToken> multiwordTokens,
        string sentenceId,
        int lineNumber)
    {
        var multiwordByStart = multiwordTokens.ToDictionary(
            item => item.First);
        var result = new List<UdArabicOrthographicToken>();
        var textOffset = 0;
        for (var id = 1; id <= tokens.Count;)
        {
            string form;
            int first;
            int last;
            if (multiwordByStart.TryGetValue(id, out var multiword))
            {
                form = multiword.Form;
                first = multiword.First;
                last = multiword.Last;
                id = multiword.Last + 1;
            }
            else
            {
                var token = tokens[id - 1];
                form = token.Form;
                first = token.Id;
                last = token.Id;
                id++;
            }

            while (textOffset < text.Length && char.IsWhiteSpace(text[textOffset]))
            {
                textOffset++;
            }

            if (!text.AsSpan(textOffset).StartsWith(
                    form.AsSpan(),
                    StringComparison.Ordinal))
            {
                throw new InvalidDataException(
                    $"UD-AR0014 at line {lineNumber}: Sentence '{sentenceId}' "
                    + $"cannot align orthographic token '{form}' at offset {textOffset}.");
            }

            result.Add(
                new UdArabicOrthographicToken(
                    result.Count,
                    form,
                    new SourceRange(textOffset, form.Length),
                    first,
                    last));
            textOffset += form.Length;
        }

        while (textOffset < text.Length && char.IsWhiteSpace(text[textOffset]))
        {
            textOffset++;
        }

        if (textOffset != text.Length)
        {
            throw new InvalidDataException(
                $"UD-AR0015 at line {lineNumber}: Sentence '{sentenceId}' "
                + $"has unaligned text at offset {textOffset}.");
        }

        return result;
    }

    private sealed record UdMultiwordToken(
        int First,
        int Last,
        string Form,
        string Misc);
}

public sealed class UdArabicPadtVerificationReport
{
    public required string SourceRepository { get; init; }

    public required string SourceCommit { get; init; }

    public required string Resource { get; init; }

    public required string License { get; init; }

    public required string InputSha256 { get; init; }

    public bool MatchesPinnedTestSource { get; init; }

    public long SentenceCount { get; init; }

    public long TokenCount { get; init; }

    public SortedDictionary<string, long> UniversalPartOfSpeechCounts { get; init; } =
        new(StringComparer.Ordinal);

    public SortedDictionary<string, long> DependencyRelationCounts { get; init; } =
        new(StringComparer.Ordinal);

    public IReadOnlyList<string> Errors { get; init; } = [];

    public required string SentenceMerkleRoot { get; init; }

    public bool IsValid => Errors.Count == 0;
}

public static class UdArabicPadtVerifier
{
    public static UdArabicPadtVerificationReport VerifyTestFile(
        string path,
        bool requirePinnedSource = false) =>
        VerifyFile(path, UdArabicPadtSource.Descriptor, requirePinnedSource);

    public static UdArabicPadtVerificationReport VerifyFile(
        string path,
        UdArabicSourceDescriptor source,
        bool requirePinnedSource = false)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        ArgumentNullException.ThrowIfNull(source);
        try
        {
            var corpus = UdArabicCorpus.Load(path);
            var upos = new SortedDictionary<string, long>(StringComparer.Ordinal);
            var relations = new SortedDictionary<string, long>(StringComparer.Ordinal);
            long tokenCount = 0;
            foreach (var sentence in corpus.Sentences)
            {
                tokenCount += sentence.Tokens.Count;
                foreach (var token in sentence.Tokens)
                {
                    Increment(upos, token.UniversalPartOfSpeech);
                    Increment(relations, token.DependencyRelation);
                }
            }

            var matchesPinned = corpus.InputSha256 == source.Sha256;
            IReadOnlyList<string> errors = requirePinnedSource && !matchesPinned
                ? ["The UD Arabic input does not match the pinned SHA-256."]
                : [];
            return new UdArabicPadtVerificationReport
            {
                SourceRepository = source.Repository,
                SourceCommit = source.Commit,
                Resource = source.Resource,
                License = source.License,
                InputSha256 = corpus.InputSha256,
                MatchesPinnedTestSource = matchesPinned,
                SentenceCount = corpus.Sentences.Count,
                TokenCount = tokenCount,
                UniversalPartOfSpeechCounts = upos,
                DependencyRelationCounts = relations,
                Errors = errors,
                SentenceMerkleRoot = corpus.SentenceMerkleRoot,
            };
        }
        catch (InvalidDataException exception)
        {
            return new UdArabicPadtVerificationReport
            {
                SourceRepository = source.Repository,
                SourceCommit = source.Commit,
                Resource = source.Resource,
                License = source.License,
                InputSha256 = File.Exists(path)
                    ? Convert.ToHexString(
                        SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant()
                    : string.Empty,
                MatchesPinnedTestSource = false,
                Errors = [exception.Message],
                SentenceMerkleRoot = string.Empty,
            };
        }
    }

    private static void Increment(IDictionary<string, long> counts, string key)
    {
        counts.TryGetValue(key, out var count);
        counts[key] = count + 1;
    }
}

public sealed record UdArabicParserSample(
    string SentenceId,
    string Text,
    string Status,
    long UnitCount,
    long CorpusBackedUnitCount,
    long HeuristicUnitCount,
    long UnknownUnitCount,
    IReadOnlyList<string> DiagnosticCodes);

public sealed record UdMappedDependencyMetrics(
    string QacRelation,
    string UdRelation,
    long GoldCount,
    long PredictedCount,
    long TruePositiveCount,
    double Precision,
    double Recall,
    double F1);

public sealed record UdMappedDependencyErrorSample(
    string SentenceId,
    string Relation,
    string DependentForm,
    string HeadForm,
    string GoldRelation,
    string? GoldHeadForm);

public sealed class UdArabicParserEvaluation
{
    public string ParserRuleSetId => QacHeuristicMorphologyGuesser.RuleSetId;

    public string EvaluationContractId => "adg-ud-arabic-evaluation-v2";

    public required string SourceRepository { get; init; }

    public required string SourceCommit { get; init; }

    public required string License { get; init; }

    public required string EvaluationRole { get; init; }

    public string EvaluationBoundary =>
        "UD tokenization and dependency labels are not treated as identical to "
        + "QAC morphology or traditional i'rab relations. This gate measures "
        + "deterministic parsing safety and lexical verification; it does not "
        + "claim UD dependency accuracy.";

    public required string InputSha256 { get; init; }

    public required string CorpusMerkleRoot { get; init; }

    public long SentenceCount { get; init; }

    public long TokenCount { get; init; }

    public long ParsedUnitCount { get; init; }

    public long ExactUnitCount { get; init; }

    public long NormalizedUnitCount { get; init; }

    public long HeuristicUnitCount { get; init; }

    public long UnknownUnitCount { get; init; }

    public long FullyCorpusBackedSentenceCount { get; init; }

    public long ValidSentenceCount { get; init; }

    public long InvalidSentenceCount { get; init; }

    public long UnverifiedSentenceCount { get; init; }

    public long GraphValidationErrorCount { get; init; }

    public long GeneratedEdgeCount { get; init; }

    public long GeneratedPhraseNodeCount { get; init; }

    public long UnverifiedGeneratedEdgeCount { get; init; }

    public long AlignedPrimaryTagCount { get; init; }

    public long CorrectPrimaryTagCount { get; init; }

    public double PrimaryTagAccuracy { get; init; }

    public long MappedGoldEdgeCount { get; init; }

    public long MappedPredictedEdgeCount { get; init; }

    public long MappedTruePositiveEdgeCount { get; init; }

    public long UnalignedPredictedMappedEdgeCount { get; init; }

    public double MappedDependencyPrecision { get; init; }

    public double MappedDependencyRecall { get; init; }

    public double MappedDependencyF1 { get; init; }

    public double CorpusBackedUnitRate { get; init; }

    public double VerifiedSentenceRate { get; init; }

    public bool MeetsStructuralSafetyGate =>
        SentenceCount > 0
        && InvalidSentenceCount == 0
        && GraphValidationErrorCount == 0;

    public bool MeetsNaturalArabicReadinessGate =>
        MeetsStructuralSafetyGate
        && ValidSentenceCount == SentenceCount
        && UnknownUnitCount == 0;

    public SortedDictionary<string, long> UnknownSurfaceCounts { get; init; } =
        new(StringComparer.Ordinal);

    public SortedDictionary<string, long> HeuristicSurfaceCounts { get; init; } =
        new(StringComparer.Ordinal);

    public SortedDictionary<string, long> GeneratedPhraseTagCounts { get; init; } =
        new(StringComparer.Ordinal);

    public SortedDictionary<string, long> GraphValidationIssueCounts { get; init; } =
        new(StringComparer.Ordinal);

    public IReadOnlyList<string> InvalidSentenceIds { get; init; } = [];

    public SortedDictionary<string, long> PrimaryTagConfusionCounts { get; init; } =
        new(StringComparer.Ordinal);

    public SortedDictionary<string, long> PrimaryTagSourceConfusionCounts { get; init; } =
        new(StringComparer.Ordinal);

    public SortedDictionary<string, long> PrimaryTagErrorSurfaceCounts { get; init; } =
        new(StringComparer.Ordinal);

    public IReadOnlyList<UdMappedDependencyMetrics> MappedDependencies { get; init; } =
        [];

    public IReadOnlyList<UdMappedDependencyErrorSample> MappedDependencyErrors
    {
        get;
        init;
    } = [];

    public IReadOnlyList<UdArabicParserSample> Samples { get; init; } = [];

    public required string EvaluationMerkleRoot { get; init; }
}

public static class UdArabicParserEvaluator
{
    public static UdArabicParserEvaluation Evaluate(
        QacMorphologyLexicon lexicon,
        UdArabicCorpus corpus,
        UdArabicSourceDescriptor source)
    {
        ArgumentNullException.ThrowIfNull(lexicon);
        ArgumentNullException.ThrowIfNull(corpus);
        ArgumentNullException.ThrowIfNull(source);
        var parser = new QacDeterministicGrammarParser(
            lexicon,
            enableHeuristicFallback: true);
        var samples = new List<UdArabicParserSample>();
        var leaves = new List<byte[]>();
        long tokenCount = 0;
        long parsedUnitCount = 0;
        long exactUnitCount = 0;
        long normalizedUnitCount = 0;
        long heuristicUnitCount = 0;
        long unknownUnitCount = 0;
        long fullyCorpusBackedSentenceCount = 0;
        long validSentenceCount = 0;
        long invalidSentenceCount = 0;
        long unverifiedSentenceCount = 0;
        long graphValidationErrorCount = 0;
        long generatedEdgeCount = 0;
        long generatedPhraseNodeCount = 0;
        long unverifiedGeneratedEdgeCount = 0;
        long alignedPrimaryTagCount = 0;
        long correctPrimaryTagCount = 0;
        long unalignedPredictedMappedEdgeCount = 0;
        var unknownSurfaceCounts = new SortedDictionary<string, long>(
            StringComparer.Ordinal);
        var heuristicSurfaceCounts = new SortedDictionary<string, long>(
            StringComparer.Ordinal);
        var generatedPhraseTagCounts = new SortedDictionary<string, long>(
            StringComparer.Ordinal);
        var graphValidationIssueCounts = new SortedDictionary<string, long>(
            StringComparer.Ordinal);
        var invalidSentenceIds = new List<string>();
        var primaryTagConfusionCounts = new SortedDictionary<string, long>(
            StringComparer.Ordinal);
        var primaryTagSourceConfusionCounts = new SortedDictionary<string, long>(
            StringComparer.Ordinal);
        var primaryTagErrorSurfaceCounts = new SortedDictionary<string, long>(
            StringComparer.Ordinal);
        var mappedGold = new HashSet<MappedDependencyEdge>();
        var mappedPredicted = new HashSet<MappedDependencyEdge>();
        var mappedDependencyErrors = new List<UdMappedDependencyErrorSample>();

        foreach (var sentence in corpus.Sentences)
        {
            tokenCount += sentence.Tokens.Count;
            var parse = parser.Parse(sentence.Text);
            parsedUnitCount += parse.Morphology.Units.Count;
            graphValidationErrorCount += parse.Validation.Errors.Count;
            foreach (var issue in parse.Validation.Errors)
            {
                Increment(graphValidationIssueCounts, issue.Code);
            }
            generatedEdgeCount += parse.Graph.Edges.Count;
            foreach (var phrase in parse.Graph.Nodes.Where(node =>
                         node.Kind == QacSyntaxNodeKind.Phrase))
            {
                generatedPhraseNodeCount++;
                Increment(generatedPhraseTagCounts, phrase.Tag);
            }

            unverifiedGeneratedEdgeCount +=
                parse.Graph.Edges.Count(edge => !edge.IsVerified);
            long sentenceCorpusBacked = 0;
            long sentenceHeuristic = 0;
            long sentenceUnknown = 0;
            foreach (var unit in parse.Morphology.Units)
            {
                switch (unit.MatchKind)
                {
                    case QacLexiconMatchKind.Exact:
                        exactUnitCount++;
                        sentenceCorpusBacked++;
                        break;
                    case QacLexiconMatchKind.Normalized:
                        normalizedUnitCount++;
                        sentenceCorpusBacked++;
                        break;
                    case QacLexiconMatchKind.Heuristic:
                        heuristicUnitCount++;
                        sentenceHeuristic++;
                        Increment(heuristicSurfaceCounts, unit.NormalizedSurface);
                        break;
                    case QacLexiconMatchKind.Unknown:
                        unknownUnitCount++;
                        sentenceUnknown++;
                        Increment(unknownSurfaceCounts, unit.NormalizedSurface);
                        break;
                    default:
                        throw new InvalidOperationException();
                }
            }

            if (sentenceHeuristic == 0 && sentenceUnknown == 0)
            {
                fullyCorpusBackedSentenceCount++;
            }

            switch (parse.Status)
            {
                case QacGrammarStatus.Valid:
                    validSentenceCount++;
                    break;
                case QacGrammarStatus.Invalid:
                    invalidSentenceCount++;
                    if (invalidSentenceIds.Count < 100)
                    {
                        invalidSentenceIds.Add(sentence.Id);
                    }

                    break;
                case QacGrammarStatus.Unverified:
                    unverifiedSentenceCount++;
                    break;
                default:
                    throw new InvalidOperationException();
            }

            if (samples.Count < 50
                && (parse.Status != QacGrammarStatus.Valid
                    || sentenceHeuristic > 0
                    || sentenceUnknown > 0))
            {
                samples.Add(
                    new UdArabicParserSample(
                        sentence.Id,
                        sentence.Text,
                        parse.Status.ToString(),
                        parse.Morphology.Units.Count,
                        sentenceCorpusBacked,
                        sentenceHeuristic,
                        sentenceUnknown,
                        parse.Diagnostics
                            .Select(diagnostic => diagnostic.Code)
                            .Distinct(StringComparer.Ordinal)
                            .Order(StringComparer.Ordinal)
                            .ToArray()));
            }

            foreach (var selection in parse.SelectedAlternative.Selection)
            {
                var unit = parse.Morphology.Units[selection.UnitIndex];
                var goldPrimary = FindGoldPrimaryToken(unit.Range, sentence);
                if (goldPrimary is null)
                {
                    continue;
                }

                alignedPrimaryTagCount++;
                var confusion =
                    $"{selection.PrimaryTag}->{goldPrimary.UniversalPartOfSpeech}";
                Increment(primaryTagConfusionCounts, confusion);
                Increment(
                    primaryTagSourceConfusionCounts,
                    $"{selection.Source}:{confusion}");
                if (IsPrimaryTagCompatible(
                            selection.PrimaryTag,
                            goldPrimary.UniversalPartOfSpeech))
                {
                    correctPrimaryTagCount++;
                }
                else
                {
                    Increment(
                            primaryTagErrorSurfaceCounts,
                            $"{selection.Source}:{confusion}:{unit.NormalizedSurface}");
                }
            }

            foreach (var token in sentence.Tokens)
            {
                var qacRelation = token.DependencyRelation switch
                {
                    "nsubj" => "subj",
                    "nsubj:pass" => "pass",
                    "obj" => "obj",
                    "amod" => "adj",
                    _ => null,
                };
                if (qacRelation is not null)
                {
                    mappedGold.Add(
                        new MappedDependencyEdge(
                            sentence.Id,
                            token.Id,
                            token.Head,
                            qacRelation));
                }
            }

            var nodes = parse.Graph.Nodes.ToDictionary(
                node => node.Id,
                StringComparer.Ordinal);
            foreach (var edge in parse.Graph.Edges)
            {
                if (edge.Relation is not ("subj" or "pass" or "obj" or "adj"))
                {
                    continue;
                }

                var dependent = MapNodeToUdToken(
                    nodes[edge.DependentId],
                    sentence);
                var head = MapNodeToUdToken(nodes[edge.HeadId], sentence);
                if (dependent is null || head is null)
                {
                    unalignedPredictedMappedEdgeCount++;
                    continue;
                }

                mappedPredicted.Add(
                    new MappedDependencyEdge(
                        sentence.Id,
                        dependent.Value,
                        head.Value,
                        edge.Relation));
            }

            leaves.Add(
                SHA256.HashData(
                    Encoding.UTF8.GetBytes(
                        string.Concat(
                            sentence.Id,
                            "\t",
                            parse.Status,
                            "\t",
                            parse.SelectedAlternative.Signature,
                            "\t",
                            string.Join(
                                "\u001E",
                                parse.Graph.Edges.Select(edge =>
                                    $"{edge.DependentId}:{edge.Relation}:{edge.HeadId}:"
                                    + edge.IsVerified))))));
        }

        var corpusBackedUnitCount = exactUnitCount + normalizedUnitCount;
        var mappedTruePositive = mappedPredicted.Intersect(mappedGold).Count();
        var mappedPrecision = Rate(mappedTruePositive, mappedPredicted.Count);
        var mappedRecall = Rate(mappedTruePositive, mappedGold.Count);
        var mappedMetrics = new[]
        {
            CreateMappedMetrics("subj", "nsubj", mappedGold, mappedPredicted),
            CreateMappedMetrics(
                "pass",
                "nsubj:pass",
                mappedGold,
                mappedPredicted),
            CreateMappedMetrics("obj", "obj", mappedGold, mappedPredicted),
            CreateMappedMetrics("adj", "amod", mappedGold, mappedPredicted),
        };
        foreach (var predicted in mappedPredicted
                     .Where(edge => !mappedGold.Contains(edge))
                     .OrderBy(edge => edge.SentenceId, StringComparer.Ordinal)
                     .ThenBy(edge => edge.DependentId)
                     .ThenBy(edge => edge.Relation, StringComparer.Ordinal)
                     .Take(100))
        {
            var sentence = corpus.Sentences.Single(item =>
                item.Id == predicted.SentenceId);
            var dependent = sentence.Tokens[predicted.DependentId - 1];
            var head = sentence.Tokens[predicted.HeadId - 1];
            var goldHead = dependent.Head == 0
                ? null
                : sentence.Tokens[dependent.Head - 1].Form;
            mappedDependencyErrors.Add(
                new UdMappedDependencyErrorSample(
                    sentence.Id,
                    predicted.Relation,
                    dependent.Form,
                    head.Form,
                    dependent.DependencyRelation,
                    goldHead));
        }

        return new UdArabicParserEvaluation
        {
            SourceRepository = source.Repository,
            SourceCommit = source.Commit,
            License = source.License,
            EvaluationRole = source.EvaluationRole,
            InputSha256 = corpus.InputSha256,
            CorpusMerkleRoot = corpus.SentenceMerkleRoot,
            SentenceCount = corpus.Sentences.Count,
            TokenCount = tokenCount,
            ParsedUnitCount = parsedUnitCount,
            ExactUnitCount = exactUnitCount,
            NormalizedUnitCount = normalizedUnitCount,
            HeuristicUnitCount = heuristicUnitCount,
            UnknownUnitCount = unknownUnitCount,
            FullyCorpusBackedSentenceCount = fullyCorpusBackedSentenceCount,
            ValidSentenceCount = validSentenceCount,
            InvalidSentenceCount = invalidSentenceCount,
            UnverifiedSentenceCount = unverifiedSentenceCount,
            GraphValidationErrorCount = graphValidationErrorCount,
            GeneratedEdgeCount = generatedEdgeCount,
            GeneratedPhraseNodeCount = generatedPhraseNodeCount,
            UnverifiedGeneratedEdgeCount = unverifiedGeneratedEdgeCount,
            AlignedPrimaryTagCount = alignedPrimaryTagCount,
            CorrectPrimaryTagCount = correctPrimaryTagCount,
            PrimaryTagAccuracy = Rate(
                correctPrimaryTagCount,
                alignedPrimaryTagCount),
            MappedGoldEdgeCount = mappedGold.Count,
            MappedPredictedEdgeCount = mappedPredicted.Count,
            MappedTruePositiveEdgeCount = mappedTruePositive,
            UnalignedPredictedMappedEdgeCount =
                unalignedPredictedMappedEdgeCount,
            MappedDependencyPrecision = mappedPrecision,
            MappedDependencyRecall = mappedRecall,
            MappedDependencyF1 = F1(mappedPrecision, mappedRecall),
            CorpusBackedUnitRate = parsedUnitCount == 0
                ? 0
                : (double)corpusBackedUnitCount / parsedUnitCount,
            VerifiedSentenceRate = corpus.Sentences.Count == 0
                ? 0
                : (double)validSentenceCount / corpus.Sentences.Count,
            UnknownSurfaceCounts = unknownSurfaceCounts,
            HeuristicSurfaceCounts = heuristicSurfaceCounts,
            GeneratedPhraseTagCounts = generatedPhraseTagCounts,
            GraphValidationIssueCounts = graphValidationIssueCounts,
            InvalidSentenceIds = invalidSentenceIds,
            PrimaryTagConfusionCounts = primaryTagConfusionCounts,
            PrimaryTagSourceConfusionCounts = primaryTagSourceConfusionCounts,
            PrimaryTagErrorSurfaceCounts = primaryTagErrorSurfaceCounts,
            MappedDependencies = mappedMetrics,
            MappedDependencyErrors = mappedDependencyErrors,
            Samples = samples,
            EvaluationMerkleRoot = QacMerkle.ComputeRoot(leaves),
        };
    }

    private static int? MapNodeToUdToken(
        QacSyntaxNode node,
        UdArabicSentence sentence)
    {
        if (node.Kind != QacSyntaxNodeKind.Terminal || node.TextRange is null)
        {
            return null;
        }

        var orthographic = sentence.OrthographicTokens
            .Where(token =>
                token.Range.Start == node.TextRange.Start
                && token.Range.End == node.TextRange.End)
            .ToArray();
        if (orthographic.Length != 1)
        {
            return null;
        }

        var surface = orthographic[0];
        var tokens = sentence.Tokens
            .Where(token =>
                token.Id >= surface.FirstSyntacticTokenId
                && token.Id <= surface.LastSyntacticTokenId)
            .ToArray();
        var compatible = tokens
            .Where(token => IsCompatible(node.Tag, token.UniversalPartOfSpeech))
            .ToArray();
        if (compatible.Length == 1)
        {
            return compatible[0].Id;
        }

        if (compatible.Length > 1 && node.Text is not null)
        {
            var normalizedNode = QuranicTextNormalizer.NormalizeForAnalysis(
                node.Text);
            var textMatches = compatible
                .Where(token =>
                    QuranicTextNormalizer.NormalizeForAnalysis(token.Form)
                    == normalizedNode)
                .ToArray();
            if (textMatches.Length == 1)
            {
                return textMatches[0].Id;
            }
        }

        var nonPunctuation = tokens
            .Where(token => token.UniversalPartOfSpeech != "PUNCT")
            .ToArray();
        return nonPunctuation.Length == 1 ? nonPunctuation[0].Id : null;
    }

    private static bool IsCompatible(string qacTag, string universalPartOfSpeech) =>
        qacTag switch
        {
            "V" => universalPartOfSpeech is "VERB" or "AUX",
            "N" or "PN" or "IMPN" =>
                universalPartOfSpeech is "NOUN" or "PROPN" or "X",
            "ADJ" => universalPartOfSpeech == "ADJ",
            "PRON" or "DEM" or "REL" => universalPartOfSpeech == "PRON",
            "P" => universalPartOfSpeech == "ADP",
            "CONJ" => universalPartOfSpeech == "CCONJ",
            "SUB" => universalPartOfSpeech == "SCONJ",
            "NUM" => universalPartOfSpeech == "NUM",
            "T" or "LOC" => universalPartOfSpeech is "ADV" or "ADP",
            _ => false,
        };

    private static UdArabicToken? FindGoldPrimaryToken(
        SourceRange range,
        UdArabicSentence sentence)
    {
        var orthographic = sentence.OrthographicTokens
            .Where(token =>
                token.Range.Start == range.Start
                && token.Range.End == range.End)
            .ToArray();
        if (orthographic.Length != 1)
        {
            return null;
        }

        var surface = orthographic[0];
        return sentence.Tokens
            .Where(token =>
                token.Id >= surface.FirstSyntacticTokenId
                && token.Id <= surface.LastSyntacticTokenId)
            .OrderBy(token => PrimaryPriority(token.UniversalPartOfSpeech))
            .ThenBy(token => token.Id)
            .FirstOrDefault();
    }

    private static int PrimaryPriority(string universalPartOfSpeech) =>
        universalPartOfSpeech switch
        {
            "VERB" => 0,
            "AUX" => 1,
            "NOUN" => 2,
            "PROPN" => 3,
            "ADJ" => 4,
            "NUM" => 5,
            "ADV" => 6,
            "X" => 7,
            "PRON" => 8,
            "ADP" => 9,
            "SCONJ" => 10,
            "CCONJ" => 11,
            "PART" => 12,
            "DET" => 13,
            "SYM" => 14,
            "PUNCT" => 15,
            _ => 16,
        };

    private static bool IsPrimaryTagCompatible(
        string qacTag,
        string universalPartOfSpeech) =>
        qacTag switch
        {
            "V" => universalPartOfSpeech is "VERB" or "AUX",
            "N" or "PN" or "IMPN" =>
                universalPartOfSpeech is "NOUN" or "PROPN" or "X",
            "ADJ" => universalPartOfSpeech == "ADJ",
            "PRON" or "DEM" or "REL" => universalPartOfSpeech == "PRON",
            "P" => universalPartOfSpeech == "ADP",
            "CONJ" => universalPartOfSpeech == "CCONJ",
            "SUB" => universalPartOfSpeech == "SCONJ",
            "NUM" => universalPartOfSpeech == "NUM",
            "T" or "LOC" => universalPartOfSpeech is "ADV" or "ADP",
            "NEG" or "INTG" or "VOC" or "FUT" =>
                universalPartOfSpeech is "PART" or "SCONJ",
            _ => false,
        };

    private static UdMappedDependencyMetrics CreateMappedMetrics(
        string qacRelation,
        string udRelation,
        IReadOnlySet<MappedDependencyEdge> gold,
        IReadOnlySet<MappedDependencyEdge> predicted)
    {
        var goldCount = gold.Count(edge => edge.Relation == qacRelation);
        var predictedCount = predicted.Count(edge => edge.Relation == qacRelation);
        var truePositiveCount = predicted.Count(edge =>
            edge.Relation == qacRelation && gold.Contains(edge));
        var precision = Rate(truePositiveCount, predictedCount);
        var recall = Rate(truePositiveCount, goldCount);
        return new UdMappedDependencyMetrics(
            qacRelation,
            udRelation,
            goldCount,
            predictedCount,
            truePositiveCount,
            precision,
            recall,
            F1(precision, recall));
    }

    private static double Rate(long numerator, long denominator) =>
        denominator == 0 ? 0 : (double)numerator / denominator;

    private static double F1(double precision, double recall) =>
        precision + recall == 0
            ? 0
            : 2 * precision * recall / (precision + recall);

    private static void Increment(IDictionary<string, long> counts, string key)
    {
        counts.TryGetValue(key, out var count);
        counts[key] = count + 1;
    }

    private sealed record MappedDependencyEdge(
        string SentenceId,
        int DependentId,
        int HeadId,
        string Relation);
}
