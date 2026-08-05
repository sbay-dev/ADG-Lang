using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Adg.QuranicCorpus;
using Adg.QuranicGrammar;

namespace Adg.QuranicTraining;

public sealed class QuranicKnowledgeRootRecord
{
    public required string RecordId { get; init; }

    public int SchemaVersion { get; init; }

    public required string InventoryRoot { get; init; }

    public required string ContractSetRoot { get; init; }

    public required string CorpusRoot { get; init; }

    public required string TreebankGraphRoot { get; init; }

    public required string Task { get; init; }

    public required string AnchorKind { get; init; }

    public required string Anchor { get; init; }

    public string? ArabicAnchor { get; init; }

    public required string Role { get; init; }

    public required string Family { get; init; }

    public required string Polarity { get; init; }

    public required string Status { get; init; }

    public IReadOnlyList<string> RuleIds { get; init; } = [];

    public IReadOnlyList<string> Relations { get; init; } = [];

    public IReadOnlyList<string> Lemmas { get; init; } = [];

    public IReadOnlyList<string> Tags { get; init; } = [];

    public IReadOnlyList<string> Features { get; init; } = [];

    public IReadOnlyList<string> DiagnosticCodes { get; init; } = [];

    public long EvidenceCount { get; init; }

    public required string SourceKind { get; init; }

    public required string SourceId { get; init; }

    public required string ProjectionText { get; init; }

    public required string ProjectionSha256 { get; init; }

    public required string IndexKey { get; init; }

    public int Shard { get; init; }

    public required string EmbeddingPolicy { get; init; }

    public required string Split { get; init; }

    public bool Normative { get; init; }
}

public sealed class QuranicKnowledgeRootCatalogReport
{
    public const string CatalogId =
        "adg-cns-quranic-knowledge-roots-v2";

    public required string Id { get; init; }

    public required string InventoryRoot { get; init; }

    public required string ContractSetRoot { get; init; }

    public required string CorpusRoot { get; init; }

    public required string TreebankGraphRoot { get; init; }

    public long RecordCount { get; init; }

    public long RuleAssertionRecordCount { get; init; }

    public long LexicalAssociationRecordCount { get; init; }

    public long ControlledNegativeRecordCount { get; init; }

    public long DistinctMorphologicalRootCount { get; init; }

    public long PositiveRecordCount { get; init; }

    public long NegativeRecordCount { get; init; }

    public long UnverifiedRecordCount { get; init; }

    public long NormativeRecordCount { get; init; }

    public long EmbeddingVectorCount { get; init; }

    public SortedDictionary<string, long> ShardCounts { get; init; } =
        new(StringComparer.Ordinal);

    public IReadOnlyList<QuranicKnowledgeRootRecord> Records
        { get; init; } = [];

    public required string KnowledgeMerkleRoot { get; init; }

    public bool IsValid =>
        Records.Count == RecordCount
        && RecordCount
            == RuleAssertionRecordCount
                + LexicalAssociationRecordCount
                + ControlledNegativeRecordCount
        && RuleAssertionRecordCount
            == QacSyntaxCatalog.DependencyRelations.Count
                + QacSyntaxCatalog.PhraseTags.Count
        && RecordCount
            == PositiveRecordCount
                + NegativeRecordCount
                + UnverifiedRecordCount
        && ControlledNegativeRecordCount == NegativeRecordCount
        && PositiveRecordCount > 0
        && NegativeRecordCount > 0
        && UnverifiedRecordCount > 0
        && DistinctMorphologicalRootCount > 0
        && NormativeRecordCount == 0
        && EmbeddingVectorCount == 0
        && ShardCounts.Count == 256
        && Records.Select(record => record.RecordId)
            .Distinct(StringComparer.Ordinal)
            .LongCount() == RecordCount
        && Records.All(record =>
            record.InventoryRoot == InventoryRoot
            && record.ContractSetRoot == ContractSetRoot
            && record.CorpusRoot == CorpusRoot
            && record.TreebankGraphRoot == TreebankGraphRoot
            && record.Split == "research"
            && !record.Normative
            && record.EmbeddingPolicy == "ProjectionOnlyNoVector"
            && record.Shard is >= 0 and <= 255
            && record.RuleIds.Count > 0
            && record.Relations.Count > 0
            && HasValidProjection(record));

    private static bool HasValidProjection(
        QuranicKnowledgeRootRecord record)
    {
        var hashBytes = SHA256.HashData(
            Encoding.UTF8.GetBytes(record.ProjectionText));
        var hash = Convert.ToHexString(hashBytes).ToLowerInvariant();
        return record.ProjectionSha256 == hash
            && record.RecordId == $"QKR-{hash[..24]}"
            && record.Shard == hashBytes[0]
            && record.IndexKey
                == $"qkr-v2/{hashBytes[0]:x2}/{hash}";
    }
}

public sealed class QuranicKnowledgeRootCatalogArtifact
{
    public required string Path { get; init; }

    public long Bytes { get; init; }

    public required string Sha256 { get; init; }

    public required string KnowledgeMerkleRoot { get; init; }

    public long RecordCount { get; init; }

    public long NormativeRecordCount { get; init; }

    public long EmbeddingVectorCount { get; init; }

    public bool IsValid { get; init; }
}

public static class QuranicKnowledgeRootCatalogBuilder
{
    private const string Positive = "Positive";
    private const string Negative = "Negative";
    private const string Unverified = "Unverified";

    public static QuranicKnowledgeRootCatalogReport Build(
        QacSyntaxTreebank treebank,
        QuranicGrammarRuleInventoryReport inventory,
        QuranicGrammarContractSetReport contracts,
        QuranicGrammarCorpusReport corpus)
    {
        ArgumentNullException.ThrowIfNull(treebank);
        ArgumentNullException.ThrowIfNull(inventory);
        ArgumentNullException.ThrowIfNull(contracts);
        ArgumentNullException.ThrowIfNull(corpus);
        if (!inventory.IsInventoryComplete)
        {
            throw new InvalidDataException(
                "Knowledge-root generation requires a complete rule inventory.");
        }

        if (!contracts.IsComplete
            || contracts.InventoryMerkleRoot != inventory.InventoryMerkleRoot)
        {
            throw new InvalidDataException(
                "Knowledge-root generation requires contracts bound to the inventory.");
        }

        if (!corpus.IsValid
            || corpus.ContractSetRoot != contracts.ContractSetMerkleRoot)
        {
            throw new InvalidDataException(
                "Knowledge-root generation requires a corpus bound to the contracts.");
        }

        var contractByCode = contracts.Contracts.ToDictionary(
            contract => contract.QacCode,
            StringComparer.Ordinal);
        var records = contracts.Contracts
            .OrderBy(contract => contract.RuleId, StringComparer.Ordinal)
            .Select(contract => RuleRecord(
                inventory.InventoryMerkleRoot,
                contracts.ContractSetMerkleRoot,
                corpus.CorpusMerkleRoot,
                treebank.GraphMerkleRoot,
                contract))
            .Concat(
                corpus.Records
                    .Where(record => record.Target.Status == "Invalid")
                    .OrderBy(record => record.RecordId, StringComparer.Ordinal)
                    .Select(record => NegativeRecord(
                        inventory.InventoryMerkleRoot,
                        contracts.ContractSetMerkleRoot,
                        corpus.CorpusMerkleRoot,
                        treebank.GraphMerkleRoot,
                        record,
                        contractByCode)))
            .Concat(BuildLexicalRecords(
                treebank.Graphs,
                inventory.InventoryMerkleRoot,
                contracts.ContractSetMerkleRoot,
                corpus.CorpusMerkleRoot,
                treebank.GraphMerkleRoot,
                contractByCode))
            .OrderBy(record => record.RecordId, StringComparer.Ordinal)
            .ToArray();
        if (records.Select(record => record.RecordId)
            .Distinct(StringComparer.Ordinal)
            .Count() != records.Length)
        {
            throw new InvalidDataException(
                "Knowledge-root projections produced duplicate record IDs.");
        }

        var leaves = records
            .Select(record =>
                SHA256.HashData(
                    Encoding.UTF8.GetBytes(Canonicalize(record))))
            .ToArray();
        return new QuranicKnowledgeRootCatalogReport
        {
            Id = QuranicKnowledgeRootCatalogReport.CatalogId,
            InventoryRoot = inventory.InventoryMerkleRoot,
            ContractSetRoot = contracts.ContractSetMerkleRoot,
            CorpusRoot = corpus.CorpusMerkleRoot,
            TreebankGraphRoot = treebank.GraphMerkleRoot,
            RecordCount = records.LongLength,
            RuleAssertionRecordCount = records.LongCount(record =>
                record.AnchorKind == "rule"),
            LexicalAssociationRecordCount = records.LongCount(record =>
                record.AnchorKind == "morphology-root"),
            ControlledNegativeRecordCount = records.LongCount(record =>
                record.AnchorKind == "rule-counterexample"),
            DistinctMorphologicalRootCount = records
                .Where(record => record.AnchorKind == "morphology-root")
                .Select(record => record.Anchor)
                .Distinct(StringComparer.Ordinal)
                .LongCount(),
            PositiveRecordCount = records.LongCount(record =>
                record.Polarity == Positive),
            NegativeRecordCount = records.LongCount(record =>
                record.Polarity == Negative),
            UnverifiedRecordCount = records.LongCount(record =>
                record.Polarity == Unverified),
            NormativeRecordCount = records.LongCount(record =>
                record.Normative),
            EmbeddingVectorCount = 0,
            ShardCounts = CountShards(records),
            Records = records,
            KnowledgeMerkleRoot = QacMerkle.ComputeRoot(leaves),
        };
    }

    public static bool SelfTest()
    {
        var contract = new QuranicGrammarRuleContract
        {
            RuleId = "QUR-QAC-REL-SUBJ",
            Kind = "dependency-relation",
            QacCode = "subj",
            Family = "subject",
            Description = "subject",
            Source = "self-test",
            Status = "CanonicalValidator",
            EvidenceCount = 1,
            Direction = "dependent-to-head",
            Dependent = new QuranicGrammarNodeConstraint
            {
                AllowedTags = ["N"],
                RequiredCase = "NOM",
            },
            Head = new QuranicGrammarNodeConstraint
            {
                AllowedTags = ["V"],
            },
            ValidatorDiagnosticCodes = ["ADG-QS1201", "ADG-QS1202"],
            CorrectionPolicy = "None",
            IsNormativeForCns = false,
            CnsConsumptionPolicy = "ResearchMetadataOnly",
        };
        var noun = new QacSyntaxNode(
            "noun",
            QacSyntaxNodeKind.Terminal,
            "N",
            Morphology: new QacNormalizedMorphologyRecord(
                "(1:1:1:1)",
                "kitaAbu",
                "N",
                "Stem",
                ["STEM", "POS:N", "NOM", "LEM:kitaAb", "ROOT:ktb"],
                "kitaAb",
                "ktb",
                null,
                "MS",
                null,
                null,
                null,
                null,
                null,
                null,
                "NOM",
                null));
        var verb = new QacSyntaxNode(
            "verb",
            QacSyntaxNodeKind.Terminal,
            "V",
            Morphology: new QacNormalizedMorphologyRecord(
                "(1:1:2:1)",
                "qaAla",
                "V",
                "Stem",
                ["STEM", "POS:V", "PERF", "LEM:qaAla", "ROOT:qwl"],
                "qaAla",
                "qwl",
                null,
                "3MS",
                null,
                "PERF",
                null,
                "ACT",
                "I",
                null,
                null,
                null));
        var graphs = new[]
        {
            new QacSyntaxTreebankGraph(
                1,
                1,
                1,
                new QacDependencyGraph(
                    "self-test",
                    [noun, verb],
                    [
                        new QacDependencyEdge("noun", "verb", "subj"),
                        new QacDependencyEdge("verb", "noun", "subj"),
                    ])),
        };
        var contracts = new Dictionary<string, QuranicGrammarRuleContract>(
            StringComparer.Ordinal)
        {
            ["subj"] = contract,
        };
        var first = BuildLexicalRecords(
            graphs,
            new string('1', 64),
            new string('2', 64),
            new string('3', 64),
            new string('4', 64),
            contracts);
        var second = BuildLexicalRecords(
            graphs,
            new string('1', 64),
            new string('2', 64),
            new string('3', 64),
            new string('4', 64),
            contracts);
        return first.Count == 4
            && first.Select(record => record.RecordId)
                .SequenceEqual(
                    second.Select(record => record.RecordId),
                    StringComparer.Ordinal)
            && first.Any(record =>
                record.Anchor == "ktb"
                && record.ArabicAnchor == "كتب"
                && record.Polarity == Positive)
            && first.Any(record =>
                record.Polarity == Unverified
                && record.DiagnosticCodes.Contains(
                    "ADG-QS1201",
                    StringComparer.Ordinal))
            && first.All(record =>
                record.EmbeddingPolicy == "ProjectionOnlyNoVector"
                && !record.Normative);
    }

    private static QuranicKnowledgeRootRecord RuleRecord(
        string inventoryRoot,
        string contractRoot,
        string corpusRoot,
        string graphRoot,
        QuranicGrammarRuleContract contract)
    {
        var polarity = contract.Status == "CanonicalValidator"
            ? Positive
            : Unverified;
        return CreateRecord(
            inventoryRoot,
            contractRoot,
            corpusRoot,
            graphRoot,
            task: "index-rule-contract",
            anchorKind: "rule",
            anchor: contract.RuleId,
            arabicAnchor: null,
            role: contract.Direction,
            family: contract.Family,
            polarity,
            status: polarity == Positive ? "Valid" : "Unverified",
            ruleIds: [contract.RuleId],
            relations: [contract.QacCode],
            lemmas: [],
            tags: [],
            features: ContractFeatures(contract),
            diagnostics: contract.ValidatorDiagnosticCodes,
            evidenceCount: contract.EvidenceCount,
            sourceKind: "contract-derived",
            sourceId: $"{contractRoot}:{contract.RuleId}");
    }

    private static QuranicKnowledgeRootRecord NegativeRecord(
        string inventoryRoot,
        string contractRoot,
        string corpusRoot,
        string graphRoot,
        QuranicGrammarCorpusRecord record,
        IReadOnlyDictionary<string, QuranicGrammarRuleContract>
            contractByCode)
    {
        if (!contractByCode.TryGetValue(
                record.Input.Relation,
                out var contract))
        {
            throw new InvalidDataException(
                $"Corpus relation '{record.Input.Relation}' has no contract.");
        }

        return CreateRecord(
            inventoryRoot,
            contractRoot,
            corpusRoot,
            graphRoot,
            task: "index-controlled-counterexample",
            anchorKind: "rule-counterexample",
            anchor: record.RecordId,
            arabicAnchor: null,
            role: "mutation",
            family: contract.Family,
            polarity: Negative,
            status: "Invalid",
            ruleIds: record.RuleIds,
            relations: [record.Input.Relation],
            lemmas: [],
            tags: Tags(record.Input),
            features: CorpusFeatures(record),
            diagnostics: record.Target.DiagnosticCodes,
            evidenceCount: 1,
            sourceKind: "corpus-record",
            sourceId: $"{corpusRoot}:{record.RecordId}");
    }

    private static IReadOnlyList<QuranicKnowledgeRootRecord>
        BuildLexicalRecords(
            IEnumerable<QacSyntaxTreebankGraph> graphs,
            string inventoryRoot,
            string contractRoot,
            string corpusRoot,
            string graphRoot,
            IReadOnlyDictionary<string, QuranicGrammarRuleContract>
                contractByCode)
    {
        var accumulators = new Dictionary<
            LexicalAssociationKey,
            LexicalAssociationAccumulator>();
        foreach (var sourceGraph in graphs)
        {
            var nodes = sourceGraph.Graph.Nodes.ToDictionary(
                node => node.Id,
                StringComparer.Ordinal);
            foreach (var edge in sourceGraph.Graph.Edges)
            {
                if (!contractByCode.TryGetValue(
                        edge.Relation,
                        out var contract)
                    || !nodes.TryGetValue(
                        edge.DependentId,
                        out var dependent)
                    || !nodes.TryGetValue(edge.HeadId, out var head))
                {
                    continue;
                }

                var issues =
                    contract.Status == "CanonicalValidator"
                        ? QacSyntaxValidator.ValidateCanonicalRelationEdge(
                            edge,
                            dependent,
                            head)
                        : [];
                var polarity =
                    contract.Status == "CanonicalValidator"
                    && issues.Count == 0
                        ? Positive
                        : Unverified;
                var diagnostics = issues.Count > 0
                    ? issues.Select(issue => issue.Code)
                    : contract.Status == "CanonicalValidator"
                        ? []
                        : contract.ValidatorDiagnosticCodes;
                Add(
                    dependent,
                    "dependent",
                    contract,
                    polarity,
                    diagnostics);
                Add(
                    head,
                    "head",
                    contract,
                    polarity,
                    diagnostics);
            }
        }

        return accumulators
            .OrderBy(pair => pair.Key.Root, StringComparer.Ordinal)
            .ThenBy(pair => pair.Key.Relation, StringComparer.Ordinal)
            .ThenBy(pair => pair.Key.Role, StringComparer.Ordinal)
            .Select(pair =>
            {
                var key = pair.Key;
                var value = pair.Value;
                return CreateRecord(
                    inventoryRoot,
                    contractRoot,
                    corpusRoot,
                    graphRoot,
                    task: "index-morphology-rule-association",
                    anchorKind: "morphology-root",
                    anchor: key.Root,
                    arabicAnchor: ExtendedBuckwalter.Decode(key.Root),
                    role: key.Role,
                    family: value.Family,
                    polarity: key.Polarity,
                    status: key.Polarity == Positive
                        ? "Valid"
                        : "Unverified",
                    ruleIds: [value.RuleId],
                    relations: [key.Relation],
                    lemmas: value.Lemmas,
                    tags: value.Tags,
                    features: value.Features,
                    diagnostics: value.Diagnostics,
                    evidenceCount: value.EvidenceCount,
                    sourceKind: "qac-treebank-derived",
                    sourceId:
                        $"{graphRoot}:{key.Root}:{key.Relation}:{key.Role}");
            })
            .OrderBy(record => record.RecordId, StringComparer.Ordinal)
            .ToArray();

        void Add(
            QacSyntaxNode node,
            string role,
            QuranicGrammarRuleContract contract,
            string polarity,
            IEnumerable<string> diagnostics)
        {
            if (node.Morphology?.Root is not { Length: > 0 } root
                || root == "-")
            {
                return;
            }

            var key = new LexicalAssociationKey(
                root,
                contract.QacCode,
                role,
                polarity);
            if (!accumulators.TryGetValue(key, out var accumulator))
            {
                accumulator = new LexicalAssociationAccumulator(
                    contract.RuleId,
                    contract.Family);
                accumulators.Add(key, accumulator);
            }

            accumulator.Add(node, diagnostics);
        }
    }

    private static QuranicKnowledgeRootRecord CreateRecord(
        string inventoryRoot,
        string contractRoot,
        string corpusRoot,
        string graphRoot,
        string task,
        string anchorKind,
        string anchor,
        string? arabicAnchor,
        string role,
        string family,
        string polarity,
        string status,
        IEnumerable<string> ruleIds,
        IEnumerable<string> relations,
        IEnumerable<string> lemmas,
        IEnumerable<string> tags,
        IEnumerable<string> features,
        IEnumerable<string> diagnostics,
        long evidenceCount,
        string sourceKind,
        string sourceId)
    {
        var orderedRuleIds = Ordered(ruleIds);
        var orderedRelations = Ordered(relations);
        var orderedLemmas = Ordered(lemmas);
        var orderedTags = Ordered(tags);
        var orderedFeatures = Ordered(features);
        var orderedDiagnostics = Ordered(diagnostics);
        var projection = Projection(
            task,
            anchorKind,
            anchor,
            arabicAnchor,
            role,
            family,
            polarity,
            status,
            orderedRuleIds,
            orderedRelations,
            orderedLemmas,
            orderedTags,
            orderedFeatures,
            orderedDiagnostics,
            evidenceCount);
        var projectionBytes = Encoding.UTF8.GetBytes(projection);
        var projectionHashBytes = SHA256.HashData(projectionBytes);
        var projectionHash = Convert.ToHexString(projectionHashBytes)
            .ToLowerInvariant();
        var shard = projectionHashBytes[0];
        return new QuranicKnowledgeRootRecord
        {
            RecordId = $"QKR-{projectionHash[..24]}",
            SchemaVersion = 2,
            InventoryRoot = inventoryRoot,
            ContractSetRoot = contractRoot,
            CorpusRoot = corpusRoot,
            TreebankGraphRoot = graphRoot,
            Task = task,
            AnchorKind = anchorKind,
            Anchor = anchor,
            ArabicAnchor = arabicAnchor,
            Role = role,
            Family = family,
            Polarity = polarity,
            Status = status,
            RuleIds = orderedRuleIds,
            Relations = orderedRelations,
            Lemmas = orderedLemmas,
            Tags = orderedTags,
            Features = orderedFeatures,
            DiagnosticCodes = orderedDiagnostics,
            EvidenceCount = evidenceCount,
            SourceKind = sourceKind,
            SourceId = sourceId,
            ProjectionText = projection,
            ProjectionSha256 = projectionHash,
            IndexKey = $"qkr-v2/{shard:x2}/{projectionHash}",
            Shard = shard,
            EmbeddingPolicy = "ProjectionOnlyNoVector",
            Split = "research",
            Normative = false,
        };
    }

    private static IReadOnlyList<string> ContractFeatures(
        QuranicGrammarRuleContract contract)
    {
        var features = new List<string>
        {
            $"status={contract.Status}",
            $"direction={contract.Direction}",
            $"correction={contract.CorrectionPolicy}",
            $"consumption={contract.CnsConsumptionPolicy}",
        };
        AddNode(features, "dependent", contract.Dependent);
        AddNode(features, "head", contract.Head);
        AddPhrase(features, contract.Phrase);
        features.AddRange(contract.Invariants.Select(invariant =>
            $"invariant={invariant}"));
        features.AddRange(contract.Conditions.Select(condition =>
            $"if:{condition.IfNode}.{condition.IfFeature}"
            + $"={condition.IfValue}"
            + $"->then:{condition.ThenNode}.{condition.RequiredFeature}"
            + $"={condition.RequiredValue}"));
        foreach (var exception in contract.Exceptions)
        {
            features.Add($"exception={exception.Code}");
            features.AddRange(exception.Match.Select(pair =>
                $"exception:{exception.Code}:{pair.Key}={pair.Value}"));
        }

        return Ordered(features);
    }

    private static void AddNode(
        ICollection<string> features,
        string prefix,
        QuranicGrammarNodeConstraint? node)
    {
        if (node is null)
        {
            return;
        }

        foreach (var tag in node.AllowedTags)
        {
            features.Add($"{prefix}.tag={tag}");
        }

        Add(features, $"{prefix}.case", node.RequiredCase);
        foreach (var tag in node.AllowUnmarkedCaseTags)
        {
            features.Add($"{prefix}.allowUnmarkedCaseTag={tag}");
        }

        Add(features, $"{prefix}.aspect", node.RequiredAspect);
        Add(features, $"{prefix}.mood", node.RequiredMood);
        Add(features, $"{prefix}.voice", node.RequiredVoice);
    }

    private static IReadOnlyList<string> CorpusFeatures(
        QuranicGrammarCorpusRecord record)
    {
        var features = new List<string>
        {
            $"contractStatus={record.Input.ContractStatus}",
            $"mutation.kind={record.Mutation.Kind}",
            $"mutation.feature={record.Mutation.Feature}",
        };
        Add(features, "mutation.from", record.Mutation.From);
        Add(features, "mutation.to", record.Mutation.To);
        AddNode(features, "dependent", record.Input.Dependent);
        AddNode(features, "head", record.Input.Head);
        AddPhrase(features, record.Input.Phrase);
        return Ordered(features);
    }

    private static void AddNode(
        ICollection<string> features,
        string prefix,
        QuranicGrammarCorpusNodeState? node)
    {
        if (node is null)
        {
            return;
        }

        Add(features, $"{prefix}.tag", node.Tag);
        Add(features, $"{prefix}.lemma", node.Lemma);
        Add(features, $"{prefix}.case", node.GrammaticalCase);
        Add(features, $"{prefix}.aspect", node.Aspect);
        Add(features, $"{prefix}.mood", node.Mood);
        Add(features, $"{prefix}.voice", node.Voice);
    }

    private static void AddPhrase(
        ICollection<string> features,
        QuranicGrammarPhraseConstraint? phrase)
    {
        if (phrase is null)
        {
            return;
        }

        features.Add(
            $"phrase.requiresResolvedContiguousSpan="
            + phrase.RequiresResolvedContiguousSpan);
        features.Add(
            $"phrase.requiresLaminarSpanSet="
            + phrase.RequiresLaminarSpanSet);
        foreach (var value in phrase.AllowedStartNodeSignatures)
        {
            features.Add($"phrase.allowedStart={value}");
        }

        foreach (var value in phrase.AllowedEndNodeSignatures)
        {
            features.Add($"phrase.allowedEnd={value}");
        }

        foreach (var value in phrase.RequiredMemberTags)
        {
            features.Add($"phrase.requiredMemberTag={value}");
        }

        foreach (var value in phrase.AllowedParentRelations)
        {
            features.Add($"phrase.allowedParentRelation={value}");
        }

        foreach (var value in phrase.AllowedChildRelations)
        {
            features.Add($"phrase.allowedChildRelation={value}");
        }
    }

    private static void AddPhrase(
        ICollection<string> features,
        QuranicGrammarCorpusPhraseState? phrase)
    {
        if (phrase is null)
        {
            return;
        }

        features.Add($"phrase.tag={phrase.Tag}");
        features.Add(
            $"phrase.resolvedContiguousSpan="
            + phrase.ResolvedContiguousSpan);
        features.Add($"phrase.laminarSpanSet={phrase.LaminarSpanSet}");
        Add(features, "phrase.startNodeSignature", phrase.StartNodeSignature);
        Add(features, "phrase.endNodeSignature", phrase.EndNodeSignature);
        foreach (var value in phrase.RequiredMemberTags)
        {
            features.Add($"phrase.requiredMemberTag={value}");
        }
        Add(features, "phrase.parentRelation", phrase.ParentRelation);
        Add(features, "phrase.childRelation", phrase.ChildRelation);
    }

    private static IReadOnlyList<string> Tags(
        QuranicGrammarCorpusInput input) =>
        Ordered(
            new[]
                {
                    input.Dependent?.Tag,
                    input.Head?.Tag,
                    input.Phrase?.Tag,
                }
                .Where(value => value is not null)
                .Cast<string>());

    private static IEnumerable<string> MorphologyFeatures(
        QacNormalizedMorphologyRecord morphology)
    {
        foreach (var feature in morphology.RawFeatures.Where(feature =>
                     !feature.StartsWith("LEM:", StringComparison.Ordinal)
                     && !feature.StartsWith("ROOT:", StringComparison.Ordinal)))
        {
            yield return feature;
        }

        yield return $"segmentKind={morphology.SegmentKind}";
        if (morphology.GrammaticalCase is not null)
        {
            yield return $"case={morphology.GrammaticalCase}";
        }

        if (morphology.Aspect is not null)
        {
            yield return $"aspect={morphology.Aspect}";
        }

        if (morphology.Mood is not null)
        {
            yield return $"mood={morphology.Mood}";
        }

        if (morphology.Voice is not null)
        {
            yield return $"voice={morphology.Voice}";
        }

        if (morphology.SpecialClass is not null)
        {
            yield return $"specialClass={morphology.SpecialClass}";
        }

        if (morphology.PersonGenderNumber is not null)
        {
            yield return $"personGenderNumber={morphology.PersonGenderNumber}";
        }
    }

    private static void Add(
        ICollection<string> values,
        string key,
        string? value)
    {
        if (!string.IsNullOrEmpty(value))
        {
            values.Add($"{key}={value}");
        }
    }

    private static string Projection(
        string task,
        string anchorKind,
        string anchor,
        string? arabicAnchor,
        string role,
        string family,
        string polarity,
        string status,
        IReadOnlyList<string> ruleIds,
        IReadOnlyList<string> relations,
        IReadOnlyList<string> lemmas,
        IReadOnlyList<string> tags,
        IReadOnlyList<string> features,
        IReadOnlyList<string> diagnostics,
        long evidenceCount) =>
        string.Join(
            "\n",
            "schema=adg-cns-quranic-knowledge-root-v2",
            $"task={task}",
            $"anchorKind={anchorKind}",
            $"anchor={anchor}",
            $"arabicAnchor={arabicAnchor ?? "-"}",
            $"role={role}",
            $"family={family}",
            $"polarity={polarity}",
            $"status={status}",
            $"rules={string.Join(",", ruleIds)}",
            $"relations={string.Join(",", relations)}",
            $"lemmas={string.Join(",", lemmas)}",
            $"tags={string.Join(",", tags)}",
            $"features={string.Join(",", features)}",
            $"diagnostics={string.Join(",", diagnostics)}",
            $"evidenceCount={evidenceCount}",
            "normative=false",
            "embeddingPolicy=ProjectionOnlyNoVector");

    private static IReadOnlyList<string> Ordered(
        IEnumerable<string> values) =>
        values
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Distinct(StringComparer.Ordinal)
            .OrderBy(value => value, StringComparer.Ordinal)
            .ToArray();

    private static SortedDictionary<string, long> CountShards(
        IEnumerable<QuranicKnowledgeRootRecord> records)
    {
        var counts = new SortedDictionary<string, long>(
            StringComparer.Ordinal);
        foreach (var record in records)
        {
            var key = record.Shard.ToString("x2");
            counts[key] = counts.GetValueOrDefault(key) + 1;
        }

        return counts;
    }

    private static string Canonicalize(
        QuranicKnowledgeRootRecord record) =>
        string.Join(
            "\t",
            record.RecordId,
            record.SchemaVersion,
            record.InventoryRoot,
            record.ContractSetRoot,
            record.CorpusRoot,
            record.TreebankGraphRoot,
            record.Task,
            record.AnchorKind,
            record.Anchor,
            record.ArabicAnchor,
            record.Role,
            record.Family,
            record.Polarity,
            record.Status,
            string.Join(",", record.RuleIds),
            string.Join(",", record.Relations),
            string.Join(",", record.Lemmas),
            string.Join(",", record.Tags),
            string.Join(",", record.Features),
            string.Join(",", record.DiagnosticCodes),
            record.EvidenceCount,
            record.SourceKind,
            record.SourceId,
            record.ProjectionText,
            record.ProjectionSha256,
            record.IndexKey,
            record.Shard,
            record.EmbeddingPolicy,
            record.Split,
            record.Normative);

    private sealed record LexicalAssociationKey(
        string Root,
        string Relation,
        string Role,
        string Polarity);

    private sealed class LexicalAssociationAccumulator
    {
        private readonly HashSet<string> lemmas =
            new(StringComparer.Ordinal);
        private readonly HashSet<string> tags =
            new(StringComparer.Ordinal);
        private readonly HashSet<string> features =
            new(StringComparer.Ordinal);
        private readonly HashSet<string> diagnostics =
            new(StringComparer.Ordinal);

        public LexicalAssociationAccumulator(
            string ruleId,
            string family)
        {
            RuleId = ruleId;
            Family = family;
        }

        public string RuleId { get; }

        public string Family { get; }

        public IReadOnlyList<string> Diagnostics => Ordered(diagnostics);

        public long EvidenceCount { get; private set; }

        public IReadOnlyList<string> Lemmas => Ordered(lemmas);

        public IReadOnlyList<string> Tags => Ordered(tags);

        public IReadOnlyList<string> Features => Ordered(features);

        public void Add(
            QacSyntaxNode node,
            IEnumerable<string> diagnosticCodes)
        {
            EvidenceCount++;
            foreach (var diagnosticCode in diagnosticCodes)
            {
                diagnostics.Add(diagnosticCode);
            }

            tags.Add(node.Tag);
            if (node.Morphology?.Lemma is { Length: > 0 } lemma)
            {
                lemmas.Add(lemma);
            }

            if (node.Morphology is { } morphology)
            {
                foreach (var feature in MorphologyFeatures(morphology))
                {
                    features.Add(feature);
                }
            }
        }
    }
}

public static class QuranicKnowledgeRootCatalogArtifactWriter
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    };

    public static QuranicKnowledgeRootCatalogArtifact WriteJsonLines(
        QuranicKnowledgeRootCatalogReport report,
        string outputPath)
    {
        ArgumentNullException.ThrowIfNull(report);
        ArgumentException.ThrowIfNullOrWhiteSpace(outputPath);
        var directory = Path.GetDirectoryName(Path.GetFullPath(outputPath));
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        using (var writer = new StreamWriter(
                   outputPath,
                   append: false,
                   new UTF8Encoding(encoderShouldEmitUTF8Identifier: false)))
        {
            writer.NewLine = "\n";
            foreach (var record in report.Records)
            {
                writer.WriteLine(JsonSerializer.Serialize(record, JsonOptions));
            }
        }

        var bytes = File.ReadAllBytes(outputPath);
        return new QuranicKnowledgeRootCatalogArtifact
        {
            Path = outputPath,
            Bytes = bytes.LongLength,
            Sha256 = Convert.ToHexString(SHA256.HashData(bytes))
                .ToLowerInvariant(),
            KnowledgeMerkleRoot = report.KnowledgeMerkleRoot,
            RecordCount = report.RecordCount,
            NormativeRecordCount = report.NormativeRecordCount,
            EmbeddingVectorCount = report.EmbeddingVectorCount,
            IsValid = report.IsValid,
        };
    }
}
