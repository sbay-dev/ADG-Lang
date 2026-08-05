using System.Collections;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text;
using Adg.QuranicCorpus;

namespace Adg.QuranicGrammar;

public sealed class QuranicLexemeAllowlistEntry
{
    public required string EntryId { get; init; }

    public required string OwnerType { get; init; }

    public required string FieldName { get; init; }

    public required string Purpose { get; init; }

    public required string Scope { get; init; }

    public required string ProvenanceKind { get; init; }

    public required string SourceId { get; init; }

    public required string Status { get; init; }

    public IReadOnlyList<string> Values { get; init; } = [];

    public required string EffectMeasure { get; init; }

    public long MeasuredEffectCount { get; init; }

    public bool CanIndependentlyEstablishVerifiedQuranicState { get; init; }

    public bool Normative { get; init; }
}

public sealed class QuranicLexemeAllowlistAuditReport
{
    public const string ContractId =
        "adg-quranic-lexeme-allowlist-audit-v1";

    public required string Id { get; init; }

    public required string TreebankGraphRoot { get; init; }

    public long FieldCount { get; init; }

    public long EntryCount { get; init; }

    public long QuranicEvidenceOnlyEntryCount { get; init; }

    public long NaturalHeuristicEntryCount { get; init; }

    public long QuranicEvidenceMatchCount { get; init; }

    public long ZeroMatchQuranicEvidenceEntryCount { get; init; }

    public long NaturalHeuristicVerifiedAcceptanceCount { get; init; }

    public long NormativeEntryCount { get; init; }

    public long UnregisteredFieldCount { get; init; }

    public IReadOnlyList<string> UnregisteredFields { get; init; } = [];

    public IReadOnlyList<QuranicLexemeAllowlistEntry> Entries
        { get; init; } = [];

    public required string AuditMerkleRoot { get; init; }

    public bool IsValid =>
        Entries.Count == EntryCount
        && EntryCount
            == QuranicEvidenceOnlyEntryCount
                + NaturalHeuristicEntryCount
        && NormativeEntryCount == 0
        && UnregisteredFieldCount == 0
        && UnregisteredFields.Count == 0
        && Entries.All(entry =>
            !entry.Normative
            && entry.Status is "EvidenceOnly" or "NaturalHeuristic"
            && entry.Values.Count > 0
            && !string.IsNullOrWhiteSpace(entry.EffectMeasure)
            && entry.MeasuredEffectCount >= 0
            && !entry.CanIndependentlyEstablishVerifiedQuranicState)
        && NaturalHeuristicVerifiedAcceptanceCount == 0;
}

public static class QuranicLexemeAllowlistAuditor
{
    private static readonly IReadOnlyDictionary<
        (Type Owner, string Field),
        FieldPolicy> Policies =
        CreatePolicies();

    public static QuranicLexemeAllowlistAuditReport Audit(
        QacSyntaxTreebank treebank)
    {
        ArgumentNullException.ThrowIfNull(treebank);
        var evidence = TreebankEvidenceIndex.Build(treebank);
        var naturalHeuristicParser = new QacDeterministicGrammarParser(
            QacMorphologyLexicon.Build([]),
            enableHeuristicFallback: true);
        var candidateFields = new[]
            {
                typeof(QacDeterministicGrammarParser),
                typeof(QacHeuristicMorphologyGuesser),
            }
            .SelectMany(type => type.GetFields(
                BindingFlags.NonPublic
                | BindingFlags.Public
                | BindingFlags.Static))
            .Where(IsLexicalCollection)
            .OrderBy(field => field.DeclaringType!.FullName, StringComparer.Ordinal)
            .ThenBy(field => field.Name, StringComparer.Ordinal)
            .ToArray();
        var unregistered = candidateFields
            .Where(field => !Policies.ContainsKey(
                (field.DeclaringType!, field.Name)))
            .Select(field =>
                $"{field.DeclaringType!.FullName}.{field.Name}")
            .OrderBy(value => value, StringComparer.Ordinal)
            .ToArray();
        var entries = candidateFields
            .Where(field => Policies.ContainsKey(
                (field.DeclaringType!, field.Name)))
            .SelectMany(field => Entries(
                field,
                Policies[(field.DeclaringType!, field.Name)],
                treebank.GraphMerkleRoot,
                evidence,
                naturalHeuristicParser))
            .OrderBy(entry => entry.EntryId, StringComparer.Ordinal)
            .ToArray();
        var leaves = entries
            .Select(entry =>
                SHA256.HashData(
                    Encoding.UTF8.GetBytes(Canonicalize(entry))))
            .ToArray();
        return new QuranicLexemeAllowlistAuditReport
        {
            Id = QuranicLexemeAllowlistAuditReport.ContractId,
            TreebankGraphRoot = treebank.GraphMerkleRoot,
            FieldCount = candidateFields.LongLength,
            EntryCount = entries.LongLength,
            QuranicEvidenceOnlyEntryCount = entries.LongCount(entry =>
                entry.Status == "EvidenceOnly"),
            NaturalHeuristicEntryCount = entries.LongCount(entry =>
                entry.Status == "NaturalHeuristic"),
            QuranicEvidenceMatchCount = entries
                .Where(entry => entry.Status == "EvidenceOnly")
                .Sum(entry => entry.MeasuredEffectCount),
            ZeroMatchQuranicEvidenceEntryCount = entries.LongCount(entry =>
                entry.Status == "EvidenceOnly"
                && entry.MeasuredEffectCount == 0),
            NaturalHeuristicVerifiedAcceptanceCount = entries
                .Where(entry => entry.Status == "NaturalHeuristic")
                .Sum(entry => entry.MeasuredEffectCount),
            NormativeEntryCount = entries.LongCount(entry =>
                entry.Normative),
            UnregisteredFieldCount = unregistered.LongLength,
            UnregisteredFields = unregistered,
            Entries = entries,
            AuditMerkleRoot = QacMerkle.ComputeRoot(leaves),
        };
    }

    public static bool SelfTest()
    {
        var treebank = new QacSyntaxTreebank(
            [],
            new string('0', 64),
            null,
            new string('1', 64));
        var first = Audit(treebank);
        var second = Audit(treebank);
        return first.IsValid
            && first.FieldCount == Policies.Count
            && first.EntryCount > 0
            && first.AuditMerkleRoot == second.AuditMerkleRoot;
    }

    private static IEnumerable<QuranicLexemeAllowlistEntry> Entries(
        FieldInfo field,
        FieldPolicy policy,
        string treebankGraphRoot,
        TreebankEvidenceIndex evidence,
        QacDeterministicGrammarParser naturalHeuristicParser)
    {
        var value = field.GetValue(null)
            ?? throw new InvalidDataException(
                $"Lexical field '{field.Name}' is null.");
        var sourceId = policy.Scope == "QuranicDevelopment"
            ? treebankGraphRoot
            : QacHeuristicMorphologyGuesser.RuleSetId;
        foreach (var item in (IEnumerable)value)
        {
            var values = Values(item).ToArray();
            var measuredEffectCount =
                policy.Measure
                    == EvidenceMeasure.ForcedUnverifiedQuranicAcceptance
                ? naturalHeuristicParser.Parse(values[0]).Status
                    == QacGrammarStatus.Valid
                    ? 1
                    : 0
                : evidence.Count(policy.Measure, values);
            var canonicalValue = string.Join("\t", values);
            var idHash = Convert.ToHexString(
                    SHA256.HashData(
                        Encoding.UTF8.GetBytes(
                            $"{field.DeclaringType!.FullName}\t"
                            + $"{field.Name}\t{canonicalValue}")))
                .ToLowerInvariant();
            yield return new QuranicLexemeAllowlistEntry
            {
                EntryId = $"QLA-{idHash[..24]}",
                OwnerType = field.DeclaringType!.FullName
                    ?? field.DeclaringType.Name,
                FieldName = field.Name,
                Purpose = policy.Purpose,
                Scope = policy.Scope,
                ProvenanceKind = policy.ProvenanceKind,
                SourceId = sourceId,
                Status = policy.Status,
                Values = values,
                EffectMeasure = EffectMeasure(policy.Measure),
                MeasuredEffectCount = measuredEffectCount,
                CanIndependentlyEstablishVerifiedQuranicState = false,
                Normative = false,
            };
        }
    }

    private static IReadOnlyList<string> Values(object? item)
    {
        if (item is null)
        {
            return ["<null>"];
        }

        if (item is string text)
        {
            return [text];
        }

        if (item is ITuple tuple)
        {
            return Enumerable.Range(0, tuple.Length)
                .Select(index => tuple[index]?.ToString() ?? "<null>")
                .ToArray();
        }

        var key = item.GetType().GetProperty("Key")?.GetValue(item);
        return key is null
            ? [item.ToString() ?? item.GetType().Name]
            : [key.ToString() ?? "<null>"];
    }

    private static bool IsLexicalCollection(FieldInfo field)
    {
        if (field.DeclaringType == typeof(QacDeterministicGrammarParser))
        {
            return field.FieldType.IsGenericType
                && field.FieldType.GetGenericTypeDefinition()
                    == typeof(HashSet<>);
        }

        return field.DeclaringType == typeof(QacHeuristicMorphologyGuesser)
            && field.Name is
                "KnownPerfectVerbs" or "CommonAdjectives" or "ClosedWords";
    }

    private static IReadOnlyDictionary<(Type Owner, string Field), FieldPolicy>
        CreatePolicies()
    {
        var policies = new Dictionary<
            (Type Owner, string Field),
            FieldPolicy>();

        void Quranic(
            string field,
            string purpose,
            EvidenceMeasure measure) =>
            policies.Add(
                (typeof(QacDeterministicGrammarParser), field),
                new FieldPolicy(
                    purpose,
                    "QuranicDevelopment",
                    "QacTreebankDevelopmentObservation",
                    "EvidenceOnly",
                    measure));

        Quranic(
            "ConditionalTemporalLemmas",
            "Recognize bounded temporal condition markers.",
            EvidenceMeasure.NodeLemma);
        Quranic(
            "CaselessSubjectPreferredVerbRoots",
            "Rank caseless nominal arguments as subject candidates.",
            EvidenceMeasure.NodeRoot);
        Quranic(
            "CaselessPerfectObjectVerbRoots",
            "Rank caseless nominal arguments as object candidates.",
            EvidenceMeasure.NodeRoot);
        Quranic(
            "CircumstantialAccusativeLemmas",
            "Recognize bounded circumstantial accusative candidates.",
            EvidenceMeasure.NodeLemma);
        Quranic(
            "CircumstantialActiveParticipleVerbRoots",
            "Bind active-participle circumstances to observed verb roots.",
            EvidenceMeasure.NodeRoot);
        Quranic(
            "CircumstantialLexemeVerbPairs",
            "Bind observed circumstantial lexeme and verb-root pairs.",
            EvidenceMeasure.DependentLemmaHeadRoot);
        Quranic(
            "RelativeAdjectivalHeadLemmas",
            "Recognize observed relative adjectival heads.",
            EvidenceMeasure.NodeLemma);
        Quranic(
            "RelativePossessiveHeadLemmas",
            "Recognize observed relative possessive heads.",
            EvidenceMeasure.NodeLemma);
        Quranic(
            "NominalPredicateLemmaPairs",
            "Recognize bounded nominal predicate pairs.",
            EvidenceMeasure.HeadLemmaOrTagDependentLemma);
        Quranic(
            "TemporalLocativeLinkPairs",
            "Recognize observed temporal or locative attachments.",
            EvidenceMeasure.DependentLemmaHeadRoot);
        Quranic(
            "PossessiveLemmaPairs",
            "Recognize bounded possessive lemma pairs.",
            EvidenceMeasure.HeadLemmaDependentLemma);
        Quranic(
            "CognateLemmaVerbPairs",
            "Recognize observed cognate accusative pairs.",
            EvidenceMeasure.DependentLemmaHeadLemma);
        Quranic(
            "SpecificationLemmaVerbPairs",
            "Recognize observed specification pairs.",
            EvidenceMeasure.DependentLemmaHeadLemma);
        Quranic(
            "PurposeLemmaVerbPairs",
            "Recognize observed purpose accusative pairs.",
            EvidenceMeasure.DependentLemmaHeadLemma);
        Quranic(
            "AppositionalLemmaPairs",
            "Recognize bounded appositional pairs.",
            EvidenceMeasure.HeadLemmaDependentLemma);
        Quranic(
            "AdjectivalLemmaPairs",
            "Recognize bounded adjectival pairs.",
            EvidenceMeasure.HeadLemmaDependentLemma);

        void Natural(string field, string purpose) =>
            policies.Add(
                (typeof(QacHeuristicMorphologyGuesser), field),
                new FieldPolicy(
                    purpose,
                    "NaturalArabicOptIn",
                    "HandCuratedNaturalArabicDevelopmentHeuristic",
                    "NaturalHeuristic",
                    EvidenceMeasure.ForcedUnverifiedQuranicAcceptance));

        Natural(
            "KnownPerfectVerbs",
            "Opt-in unknown-token perfect-verb guesses.");
        Natural(
            "CommonAdjectives",
            "Opt-in unknown-token adjective guesses.");
        Natural(
            "ClosedWords",
            "Opt-in unknown-token closed-class guesses.");
        return policies;
    }

    private static string Canonicalize(
        QuranicLexemeAllowlistEntry entry) =>
        string.Join(
            "\t",
            entry.EntryId,
            entry.OwnerType,
            entry.FieldName,
            entry.Purpose,
            entry.Scope,
            entry.ProvenanceKind,
            entry.SourceId,
            entry.Status,
            string.Join("|", entry.Values),
            entry.EffectMeasure,
            entry.MeasuredEffectCount,
            entry.CanIndependentlyEstablishVerifiedQuranicState,
            entry.Normative);

    private static string EffectMeasure(EvidenceMeasure measure) =>
        measure switch
        {
            EvidenceMeasure.NodeLemma =>
                "qac-treebank-node-lemma-match-count",
            EvidenceMeasure.NodeRoot =>
                "qac-treebank-node-root-match-count",
            EvidenceMeasure.HeadLemmaDependentLemma =>
                "qac-treebank-edge-head-lemma-dependent-lemma-match-count",
            EvidenceMeasure.HeadLemmaOrTagDependentLemma =>
                "qac-treebank-edge-head-lemma-or-tag-dependent-lemma-match-count",
            EvidenceMeasure.DependentLemmaHeadRoot =>
                "qac-treebank-edge-dependent-lemma-head-root-match-count",
            EvidenceMeasure.DependentLemmaHeadLemma =>
                "qac-treebank-edge-dependent-lemma-head-lemma-match-count",
            EvidenceMeasure.ForcedUnverifiedQuranicAcceptance =>
                "explicit-opt-in-single-token-verified-quranic-acceptance-count",
            _ => throw new ArgumentOutOfRangeException(
                nameof(measure),
                measure,
                null),
        };

    private enum EvidenceMeasure
    {
        NodeLemma,
        NodeRoot,
        HeadLemmaDependentLemma,
        HeadLemmaOrTagDependentLemma,
        DependentLemmaHeadRoot,
        DependentLemmaHeadLemma,
        ForcedUnverifiedQuranicAcceptance,
    }

    private sealed class TreebankEvidenceIndex
    {
        private readonly IReadOnlyDictionary<string, long> nodeLemmas;
        private readonly IReadOnlyDictionary<string, long> nodeRoots;
        private readonly IReadOnlyDictionary<string, long>
            headLemmaDependentLemma;
        private readonly IReadOnlyDictionary<string, long>
            headLemmaOrTagDependentLemma;
        private readonly IReadOnlyDictionary<string, long>
            dependentLemmaHeadRoot;
        private readonly IReadOnlyDictionary<string, long>
            dependentLemmaHeadLemma;

        private TreebankEvidenceIndex(
            IReadOnlyDictionary<string, long> nodeLemmas,
            IReadOnlyDictionary<string, long> nodeRoots,
            IReadOnlyDictionary<string, long> headLemmaDependentLemma,
            IReadOnlyDictionary<string, long> headLemmaOrTagDependentLemma,
            IReadOnlyDictionary<string, long> dependentLemmaHeadRoot,
            IReadOnlyDictionary<string, long> dependentLemmaHeadLemma)
        {
            this.nodeLemmas = nodeLemmas;
            this.nodeRoots = nodeRoots;
            this.headLemmaDependentLemma = headLemmaDependentLemma;
            this.headLemmaOrTagDependentLemma =
                headLemmaOrTagDependentLemma;
            this.dependentLemmaHeadRoot = dependentLemmaHeadRoot;
            this.dependentLemmaHeadLemma = dependentLemmaHeadLemma;
        }

        public static TreebankEvidenceIndex Build(
            QacSyntaxTreebank treebank)
        {
            var nodeLemmas = new Dictionary<string, long>(
                StringComparer.Ordinal);
            var nodeRoots = new Dictionary<string, long>(
                StringComparer.Ordinal);
            var headLemmaDependentLemma =
                new Dictionary<string, long>(StringComparer.Ordinal);
            var headLemmaOrTagDependentLemma =
                new Dictionary<string, long>(StringComparer.Ordinal);
            var dependentLemmaHeadRoot =
                new Dictionary<string, long>(StringComparer.Ordinal);
            var dependentLemmaHeadLemma =
                new Dictionary<string, long>(StringComparer.Ordinal);

            static void Increment(
                IDictionary<string, long> counts,
                string? key)
            {
                if (string.IsNullOrEmpty(key))
                {
                    return;
                }

                counts[key] = counts.TryGetValue(key, out var count)
                    ? count + 1
                    : 1;
            }

            foreach (var treebankGraph in treebank.Graphs)
            {
                var graph = treebankGraph.Graph;
                var nodes = graph.Nodes.ToDictionary(
                    node => node.Id,
                    StringComparer.Ordinal);
                foreach (var node in graph.Nodes)
                {
                    Increment(nodeLemmas, node.Morphology?.Lemma);
                    Increment(nodeRoots, node.Morphology?.Root);
                }

                foreach (var edge in graph.Edges)
                {
                    if (!nodes.TryGetValue(edge.HeadId, out var head)
                        || !nodes.TryGetValue(
                            edge.DependentId,
                            out var dependent))
                    {
                        continue;
                    }

                    var headLemma = head.Morphology?.Lemma;
                    var dependentLemma = dependent.Morphology?.Lemma;
                    Increment(
                        headLemmaDependentLemma,
                        Pair(headLemma, dependentLemma));
                    Increment(
                        headLemmaOrTagDependentLemma,
                        Pair(headLemma, dependentLemma));
                    Increment(
                        headLemmaOrTagDependentLemma,
                        Pair(head.Tag, dependentLemma));
                    Increment(
                        dependentLemmaHeadRoot,
                        Pair(dependentLemma, head.Morphology?.Root));
                    Increment(
                        dependentLemmaHeadLemma,
                        Pair(dependentLemma, headLemma));
                }
            }

            return new TreebankEvidenceIndex(
                nodeLemmas,
                nodeRoots,
                headLemmaDependentLemma,
                headLemmaOrTagDependentLemma,
                dependentLemmaHeadRoot,
                dependentLemmaHeadLemma);
        }

        public long Count(
            EvidenceMeasure measure,
            IReadOnlyList<string> values)
        {
            if (measure == EvidenceMeasure.ForcedUnverifiedQuranicAcceptance)
            {
                return 0;
            }

            var counts = measure switch
            {
                EvidenceMeasure.NodeLemma => nodeLemmas,
                EvidenceMeasure.NodeRoot => nodeRoots,
                EvidenceMeasure.HeadLemmaDependentLemma =>
                    headLemmaDependentLemma,
                EvidenceMeasure.HeadLemmaOrTagDependentLemma =>
                    headLemmaOrTagDependentLemma,
                EvidenceMeasure.DependentLemmaHeadRoot =>
                    dependentLemmaHeadRoot,
                EvidenceMeasure.DependentLemmaHeadLemma =>
                    dependentLemmaHeadLemma,
                _ => throw new ArgumentOutOfRangeException(
                    nameof(measure),
                    measure,
                    null),
            };
            var key = values.Count == 1
                ? values[0]
                : Pair(
                    values.ElementAtOrDefault(0),
                    values.ElementAtOrDefault(1))
                    ?? string.Empty;
            return counts.TryGetValue(key, out var count)
                ? count
                : 0;
        }

        private static string? Pair(string? first, string? second) =>
            string.IsNullOrEmpty(first) || string.IsNullOrEmpty(second)
                ? null
                : $"{first}\u001f{second}";
    }

    private sealed record FieldPolicy(
        string Purpose,
        string Scope,
        string ProvenanceKind,
        string Status,
        EvidenceMeasure Measure);
}
