using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Adg.QuranicCorpus;
using Adg.QuranicGrammar;

namespace Adg.QuranicTraining;

public sealed class QuranicGrammarCorpusNodeState
{
    public string? Tag { get; init; }

    public string? Lemma { get; init; }

    public string? GrammaticalCase { get; init; }

    public string? Aspect { get; init; }

    public string? Mood { get; init; }

    public string? Voice { get; init; }
}

public sealed class QuranicGrammarCorpusPhraseState
{
    public required string Tag { get; init; }

    public bool ResolvedContiguousSpan { get; init; }

    public bool LaminarSpanSet { get; init; }

    public string? StartNodeSignature { get; init; }

    public string? EndNodeSignature { get; init; }

    public IReadOnlyList<string> RequiredMemberTags { get; init; } = [];

    public string? ParentRelation { get; init; }

    public string? ChildRelation { get; init; }
}

public sealed class QuranicGrammarCorpusInput
{
    public required string Relation { get; init; }

    public required string ContractStatus { get; init; }

    public QuranicGrammarCorpusNodeState? Dependent { get; init; }

    public QuranicGrammarCorpusNodeState? Head { get; init; }

    public QuranicGrammarCorpusPhraseState? Phrase { get; init; }
}

public sealed class QuranicGrammarCorpusTarget
{
    public required string Status { get; init; }

    public IReadOnlyList<string> DiagnosticCodes { get; init; } = [];

    public required string ConsumptionPolicy { get; init; }
}

public sealed class QuranicGrammarCorpusProvenance
{
    public required string Kind { get; init; }

    public required string SourceId { get; init; }

    public required string LicenseId { get; init; }
}

public sealed class QuranicGrammarCorpusMutation
{
    public required string Kind { get; init; }

    public required string Feature { get; init; }

    public string? From { get; init; }

    public string? To { get; init; }
}

public sealed class QuranicGrammarCorpusRecord
{
    public required string RecordId { get; init; }

    public int SchemaVersion { get; init; }

    public required string ContractSetRoot { get; init; }

    public IReadOnlyList<string> RuleIds { get; init; } = [];

    public required string Task { get; init; }

    public required QuranicGrammarCorpusInput Input { get; init; }

    public required QuranicGrammarCorpusTarget Target { get; init; }

    public required QuranicGrammarCorpusProvenance Provenance { get; init; }

    public required QuranicGrammarCorpusMutation Mutation { get; init; }

    public required string Split { get; init; }

    public bool Normative { get; init; }
}

public sealed class QuranicGrammarCorpusReport
{
    public const string CorpusId =
        "adg-cns-quranic-grammar-corpus-v3";

    public required string Id { get; init; }

    public required string ContractSetRoot { get; init; }

    public long RecordCount { get; init; }

    public long PositiveRecordCount { get; init; }

    public long NegativeRecordCount { get; init; }

    public long EvidenceOnlyRecordCount { get; init; }

    public long NormativeRecordCount { get; init; }

    public SortedDictionary<string, long> TaskCounts { get; init; } =
        new(StringComparer.Ordinal);

    public SortedDictionary<string, long> MutationCounts { get; init; } =
        new(StringComparer.Ordinal);

    public IReadOnlyList<QuranicGrammarCorpusRecord> Records { get; init; } = [];

    public required string CorpusMerkleRoot { get; init; }

    public bool IsValid =>
        Records.Count == RecordCount
        && RecordCount
            == PositiveRecordCount
                + NegativeRecordCount
                + EvidenceOnlyRecordCount
        && NormativeRecordCount == 0
        && Records.All(record =>
            record.Split == "research"
            && !record.Normative
            && record.RuleIds.Count > 0);
}

public sealed class QuranicGrammarCorpusArtifact
{
    public required string Path { get; init; }

    public long Bytes { get; init; }

    public required string Sha256 { get; init; }

    public required string CorpusMerkleRoot { get; init; }

    public long RecordCount { get; init; }

    public long NormativeRecordCount { get; init; }

    public bool IsValid { get; init; }
}

public static class QuranicGrammarCorpusBuilder
{
    public static QuranicGrammarCorpusReport Build(
        QuranicGrammarContractSetReport contracts)
    {
        ArgumentNullException.ThrowIfNull(contracts);
        if (!contracts.IsComplete)
        {
            throw new InvalidDataException(
                "Corpus generation requires a complete contract inventory.");
        }

        var records = new List<QuranicGrammarCorpusRecord>();
        foreach (var contract in contracts.Contracts
                     .OrderBy(value => value.RuleId, StringComparer.Ordinal))
        {
            if (contract.Status == "EvidenceOnly")
            {
                records.Add(
                    Record(
                        contracts.ContractSetMerkleRoot,
                        contract,
                        "classify-contract",
                        State(contract),
                        "Unverified",
                        [],
                        Mutation("none", "none"),
                        records.Count));
                continue;
            }

            records.Add(
                Record(
                    contracts.ContractSetMerkleRoot,
                    contract,
                    "validate-grammar-state",
                    State(contract),
                    "Valid",
                    [],
                    Mutation("none", "none"),
                    records.Count));
            if (contract.Phrase is not null)
            {
                AddPhraseMutations(
                    records,
                    contracts.ContractSetMerkleRoot,
                    contract);
                continue;
            }

            AddNodeMutations(
                records,
                contracts.ContractSetMerkleRoot,
                contract,
                "dependent",
                contract.Dependent);
            AddNodeMutations(
                records,
                contracts.ContractSetMerkleRoot,
                contract,
                "head",
                contract.Head);
            foreach (var condition in contract.Conditions)
            {
                records.Add(
                    Record(
                        contracts.ContractSetMerkleRoot,
                        contract,
                        "validate-conditional-constraint",
                        ConditionalViolation(contract, condition),
                        "Invalid",
                        ExpectedDiagnostics(
                            condition.RequiredFeature),
                        Mutation(
                            "replace",
                            $"{condition.ThenNode}.{condition.RequiredFeature}",
                            condition.RequiredValue,
                            Alternate(condition.RequiredFeature, condition.RequiredValue)),
                        records.Count));
            }
        }

        var ordered = records
            .OrderBy(record => record.RecordId, StringComparer.Ordinal)
            .ToArray();
        var leaves = ordered
            .Select(record =>
                SHA256.HashData(
                    Encoding.UTF8.GetBytes(Canonicalize(record))))
            .ToArray();
        return new QuranicGrammarCorpusReport
        {
            Id = QuranicGrammarCorpusReport.CorpusId,
            ContractSetRoot = contracts.ContractSetMerkleRoot,
            RecordCount = ordered.LongLength,
            PositiveRecordCount = ordered.LongCount(record =>
                record.Target.Status == "Valid"),
            NegativeRecordCount = ordered.LongCount(record =>
                record.Target.Status == "Invalid"),
            EvidenceOnlyRecordCount = ordered.LongCount(record =>
                record.Target.Status == "Unverified"),
            NormativeRecordCount = ordered.LongCount(record =>
                record.Normative),
            TaskCounts = Count(ordered.Select(record => record.Task)),
            MutationCounts = Count(
                ordered.Select(record => record.Mutation.Feature)),
            Records = ordered,
            CorpusMerkleRoot = QacMerkle.ComputeRoot(leaves),
        };
    }

    private static void AddPhraseMutations(
        ICollection<QuranicGrammarCorpusRecord> records,
        string contractRoot,
        QuranicGrammarRuleContract contract)
    {
        var phrase = contract.Phrase
            ?? throw new InvalidOperationException();
        AddPhraseMutation(
            records,
            contractRoot,
            contract,
            "phrase.resolvedContiguousSpan",
            "true",
            "false",
            ["ADG-QS1008"],
            state => CopyPhrase(
                state,
                resolvedContiguousSpan: false));
        AddPhraseMutation(
            records,
            contractRoot,
            contract,
            "phrase.laminarSpanSet",
            "true",
            "false",
            ["ADG-QS1009"],
            state => CopyPhrase(state, laminarSpanSet: false));
        AddPhraseMutation(
            records,
            contractRoot,
            contract,
            "phrase.startNodeSignature",
            phrase.AllowedStartNodeSignatures.FirstOrDefault() ?? "none",
            "INVALID",
            ["ADG-QS1203"],
            state => CopyPhrase(state, startNodeSignature: "INVALID"));
        AddPhraseMutation(
            records,
            contractRoot,
            contract,
            "phrase.endNodeSignature",
            phrase.AllowedEndNodeSignatures.FirstOrDefault() ?? "none",
            "INVALID",
            ["ADG-QS1203"],
            state => CopyPhrase(state, endNodeSignature: "INVALID"));
        if (phrase.RequiredMemberTags.Count > 0)
        {
            AddPhraseMutation(
                records,
                contractRoot,
                contract,
                "phrase.requiredMemberTags",
                string.Join(",", phrase.RequiredMemberTags),
                "none",
                ["ADG-QS1203"],
                state => CopyPhrase(state, requiredMemberTags: []));
        }

        AddPhraseMutation(
            records,
            contractRoot,
            contract,
            "phrase.parentRelation",
            phrase.AllowedParentRelations.FirstOrDefault() ?? "none",
            "INVALID",
            ["ADG-QS1204"],
            state => CopyPhrase(state, parentRelation: "INVALID"));
        AddPhraseMutation(
            records,
            contractRoot,
            contract,
            "phrase.childRelation",
            phrase.AllowedChildRelations.FirstOrDefault() ?? "none",
            "INVALID",
            ["ADG-QS1204"],
            state => CopyPhrase(state, childRelation: "INVALID"));
    }

    private static void AddPhraseMutation(
        ICollection<QuranicGrammarCorpusRecord> records,
        string contractRoot,
        QuranicGrammarRuleContract contract,
        string feature,
        string from,
        string to,
        IReadOnlyList<string> diagnostics,
        Func<QuranicGrammarCorpusPhraseState,
            QuranicGrammarCorpusPhraseState> mutate)
    {
        var state = State(contract);
        state = new QuranicGrammarCorpusInput
        {
            Relation = state.Relation,
            ContractStatus = state.ContractStatus,
            Dependent = state.Dependent,
            Head = state.Head,
            Phrase = mutate(
                state.Phrase
                ?? throw new InvalidOperationException()),
        };
        records.Add(
            Record(
                contractRoot,
                contract,
                "diagnose-phrase-mutation",
                state,
                "Invalid",
                diagnostics,
                Mutation("replace", feature, from, to),
                records.Count));
    }

    private static void AddNodeMutations(
        ICollection<QuranicGrammarCorpusRecord> records,
        string contractRoot,
        QuranicGrammarRuleContract contract,
        string nodeName,
        QuranicGrammarNodeConstraint? node)
    {
        if (node is null)
        {
            return;
        }

        if (node.AllowedTags.Count > 0)
        {
            AddMutation(
                records,
                contractRoot,
                contract,
                nodeName,
                "tag",
                node.AllowedTags[0],
                "INVALID");
        }

        AddRequiredMutation(
            records,
            contractRoot,
            contract,
            nodeName,
            "case",
            node.RequiredCase);
        AddRequiredMutation(
            records,
            contractRoot,
            contract,
            nodeName,
            "aspect",
            node.RequiredAspect);
        AddRequiredMutation(
            records,
            contractRoot,
            contract,
            nodeName,
            "mood",
            node.RequiredMood);
        AddRequiredMutation(
            records,
            contractRoot,
            contract,
            nodeName,
            "voice",
            node.RequiredVoice);
    }

    private static void AddRequiredMutation(
        ICollection<QuranicGrammarCorpusRecord> records,
        string contractRoot,
        QuranicGrammarRuleContract contract,
        string nodeName,
        string feature,
        string? value)
    {
        if (value is null)
        {
            return;
        }

        AddMutation(
            records,
            contractRoot,
            contract,
            nodeName,
            feature,
            value,
            Alternate(feature, value));
    }

    private static void AddMutation(
        ICollection<QuranicGrammarCorpusRecord> records,
        string contractRoot,
        QuranicGrammarRuleContract contract,
        string nodeName,
        string feature,
        string from,
        string to)
    {
        var state = State(contract);
        state = Mutate(state, nodeName, feature, to);
        records.Add(
            Record(
                contractRoot,
                contract,
                "diagnose-grammar-mutation",
                state,
                "Invalid",
                ExpectedDiagnostics(feature),
                Mutation(
                    "replace",
                    $"{nodeName}.{feature}",
                    from,
                    to),
                records.Count));
    }

    private static QuranicGrammarCorpusRecord Record(
        string contractRoot,
        QuranicGrammarRuleContract contract,
        string task,
        QuranicGrammarCorpusInput input,
        string status,
        IReadOnlyList<string> diagnostics,
        QuranicGrammarCorpusMutation mutation,
        int ordinal)
    {
        var seed = string.Join(
            "\t",
            contractRoot,
            contract.RuleId,
            task,
            mutation.Feature,
            mutation.From,
            mutation.To,
            ordinal);
        var id = Convert.ToHexString(
                SHA256.HashData(Encoding.UTF8.GetBytes(seed)))
            .ToLowerInvariant()[..24];
        return new QuranicGrammarCorpusRecord
        {
            RecordId = $"QRC-{id}",
            SchemaVersion = 2,
            ContractSetRoot = contractRoot,
            RuleIds = [contract.RuleId],
            Task = task,
            Input = input,
            Target = new QuranicGrammarCorpusTarget
            {
                Status = status,
                DiagnosticCodes = diagnostics,
                ConsumptionPolicy = contract.CnsConsumptionPolicy,
            },
            Provenance = new QuranicGrammarCorpusProvenance
            {
                Kind = "contract-derived",
                SourceId = $"{contractRoot}:{contract.RuleId}",
                LicenseId = "ADG-Lang-derived-contracts",
            },
            Mutation = mutation,
            Split = "research",
            Normative = false,
        };
    }

    private static QuranicGrammarCorpusInput State(
        QuranicGrammarRuleContract contract) =>
        new()
        {
            Relation = contract.QacCode,
            ContractStatus = contract.Status,
            Dependent = State(contract.Dependent),
            Head = State(contract.Head),
            Phrase = State(contract.QacCode, contract.Phrase),
        };

    private static QuranicGrammarCorpusNodeState? State(
        QuranicGrammarNodeConstraint? node) =>
        node is null
            ? null
            : new QuranicGrammarCorpusNodeState
            {
                Tag = node.AllowedTags.FirstOrDefault(),
                GrammaticalCase = node.RequiredCase,
                Aspect = node.RequiredAspect,
                Mood = node.RequiredMood,
                Voice = node.RequiredVoice,
            };

    private static QuranicGrammarCorpusPhraseState? State(
        string tag,
        QuranicGrammarPhraseConstraint? phrase) =>
        phrase is null
            ? null
            : new QuranicGrammarCorpusPhraseState
            {
                Tag = tag,
                ResolvedContiguousSpan =
                    phrase.RequiresResolvedContiguousSpan,
                LaminarSpanSet = phrase.RequiresLaminarSpanSet,
                StartNodeSignature =
                    phrase.AllowedStartNodeSignatures.FirstOrDefault(),
                EndNodeSignature =
                    phrase.AllowedEndNodeSignatures.FirstOrDefault(),
                RequiredMemberTags = phrase.RequiredMemberTags,
                ParentRelation =
                    phrase.AllowedParentRelations.FirstOrDefault(),
                ChildRelation =
                    phrase.AllowedChildRelations.FirstOrDefault(),
            };

    private static QuranicGrammarCorpusInput ConditionalViolation(
        QuranicGrammarRuleContract contract,
        QuranicGrammarConditionalConstraint condition)
    {
        var state = State(contract);
        state = Mutate(
            state,
            condition.IfNode,
            condition.IfFeature,
            condition.IfValue);
        return Mutate(
            state,
            condition.ThenNode,
            condition.RequiredFeature,
            Alternate(
                condition.RequiredFeature,
                condition.RequiredValue));
    }

    private static QuranicGrammarCorpusInput Mutate(
        QuranicGrammarCorpusInput input,
        string nodeName,
        string feature,
        string value)
    {
        var dependent = Copy(input.Dependent);
        var head = Copy(input.Head);
        if (nodeName == "dependent")
        {
            dependent = Mutate(dependent, feature, value);
        }
        else if (nodeName == "head")
        {
            head = Mutate(head, feature, value);
        }
        else
        {
            throw new InvalidDataException(
                $"Unknown corpus node '{nodeName}'.");
        }

        return new QuranicGrammarCorpusInput
        {
            Relation = input.Relation,
            ContractStatus = input.ContractStatus,
            Dependent = dependent,
            Head = head,
            Phrase = input.Phrase,
        };
    }

    private static QuranicGrammarCorpusNodeState Mutate(
        QuranicGrammarCorpusNodeState? source,
        string feature,
        string value)
    {
        var node = Copy(source) ?? new QuranicGrammarCorpusNodeState();
        return feature switch
        {
            "tag" => Copy(node, tag: value),
            "lemma" => Copy(node, lemma: value),
            "case" => Copy(node, grammaticalCase: value),
            "aspect" => Copy(node, aspect: value),
            "mood" => Copy(node, mood: value),
            "voice" => Copy(node, voice: value),
            _ => throw new InvalidDataException(
                $"Unknown corpus feature '{feature}'."),
        };
    }

    private static QuranicGrammarCorpusNodeState? Copy(
        QuranicGrammarCorpusNodeState? source) =>
        source is null
            ? null
            : Copy(
                source,
                source.Tag,
                source.Lemma,
                source.GrammaticalCase,
                source.Aspect,
                source.Mood,
                source.Voice);

    private static QuranicGrammarCorpusNodeState Copy(
        QuranicGrammarCorpusNodeState source,
        string? tag = null,
        string? lemma = null,
        string? grammaticalCase = null,
        string? aspect = null,
        string? mood = null,
        string? voice = null) =>
        new()
        {
            Tag = tag ?? source.Tag,
            Lemma = lemma ?? source.Lemma,
            GrammaticalCase =
                grammaticalCase ?? source.GrammaticalCase,
            Aspect = aspect ?? source.Aspect,
            Mood = mood ?? source.Mood,
            Voice = voice ?? source.Voice,
        };

    private static QuranicGrammarCorpusPhraseState CopyPhrase(
        QuranicGrammarCorpusPhraseState source,
        bool? resolvedContiguousSpan = null,
        bool? laminarSpanSet = null,
        string? startNodeSignature = null,
        string? endNodeSignature = null,
        IReadOnlyList<string>? requiredMemberTags = null,
        string? parentRelation = null,
        string? childRelation = null) =>
        new()
        {
            Tag = source.Tag,
            ResolvedContiguousSpan =
                resolvedContiguousSpan ?? source.ResolvedContiguousSpan,
            LaminarSpanSet = laminarSpanSet ?? source.LaminarSpanSet,
            StartNodeSignature =
                startNodeSignature ?? source.StartNodeSignature,
            EndNodeSignature =
                endNodeSignature ?? source.EndNodeSignature,
            RequiredMemberTags =
                requiredMemberTags ?? source.RequiredMemberTags,
            ParentRelation = parentRelation ?? source.ParentRelation,
            ChildRelation = childRelation ?? source.ChildRelation,
        };

    private static QuranicGrammarCorpusMutation Mutation(
        string kind,
        string feature,
        string? from = null,
        string? to = null) =>
        new()
        {
            Kind = kind,
            Feature = feature,
            From = from,
            To = to,
        };

    private static string Alternate(string feature, string value) =>
        feature switch
        {
            "case" => value == "NOM" ? "ACC" : "NOM",
            "aspect" => value == "IMPF" ? "PERF" : "IMPF",
            "mood" => value == "JUS" ? "IND" : "JUS",
            "voice" => value == "PASS" ? "ACT" : "PASS",
            "tag" => "INVALID",
            _ => $"NOT-{value}",
        };

    private static IReadOnlyList<string> ExpectedDiagnostics(
        string feature) =>
        feature == "case"
            ? ["ADG-QS1202"]
            : ["ADG-QS1201"];

    private static SortedDictionary<string, long> Count(
        IEnumerable<string> values)
    {
        var counts = new SortedDictionary<string, long>(
            StringComparer.Ordinal);
        foreach (var value in values)
        {
            counts[value] = counts.GetValueOrDefault(value) + 1;
        }

        return counts;
    }

    private static string Canonicalize(
        QuranicGrammarCorpusRecord record) =>
        string.Join(
            "\t",
            record.RecordId,
            record.SchemaVersion,
            record.ContractSetRoot,
            string.Join(",", record.RuleIds),
            record.Task,
            record.Input.Relation,
            record.Input.ContractStatus,
            Node(record.Input.Dependent),
            Node(record.Input.Head),
            Phrase(record.Input.Phrase),
            record.Target.Status,
            string.Join(",", record.Target.DiagnosticCodes),
            record.Target.ConsumptionPolicy,
            record.Provenance.Kind,
            record.Provenance.SourceId,
            record.Provenance.LicenseId,
            record.Mutation.Kind,
            record.Mutation.Feature,
            record.Mutation.From,
            record.Mutation.To,
            record.Split,
            record.Normative);

    private static string Node(QuranicGrammarCorpusNodeState? node) =>
        node is null
            ? "-"
            : string.Join(
                ":",
                node.Tag,
                node.Lemma,
                node.GrammaticalCase,
                node.Aspect,
                node.Mood,
                node.Voice);

    private static string Phrase(
        QuranicGrammarCorpusPhraseState? phrase) =>
        phrase is null
            ? "-"
            : string.Join(
                ":",
                phrase.Tag,
                phrase.ResolvedContiguousSpan,
                phrase.LaminarSpanSet,
                phrase.StartNodeSignature,
                phrase.EndNodeSignature,
                string.Join(",", phrase.RequiredMemberTags),
                phrase.ParentRelation,
                phrase.ChildRelation);
}

public static class QuranicGrammarCorpusArtifactWriter
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    };

    public static QuranicGrammarCorpusArtifact WriteJsonLines(
        QuranicGrammarCorpusReport report,
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
        return new QuranicGrammarCorpusArtifact
        {
            Path = outputPath,
            Bytes = bytes.LongLength,
            Sha256 = Convert.ToHexString(SHA256.HashData(bytes))
                .ToLowerInvariant(),
            CorpusMerkleRoot = report.CorpusMerkleRoot,
            RecordCount = report.RecordCount,
            NormativeRecordCount = report.NormativeRecordCount,
            IsValid = report.IsValid,
        };
    }
}
