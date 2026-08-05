using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Adg.QuranicCorpus;

namespace Adg.QuranicTraining;

public sealed class QuranicCorpusSplitGroup
{
    public required string GroupId { get; init; }

    public required string GroupKeySha256 { get; init; }

    public required string ProvenanceSourceId { get; init; }

    public IReadOnlyList<string> RuleIds { get; init; } = [];

    public IReadOnlyList<string> RecordIds { get; init; } = [];

    public long RecordCount { get; init; }

    public required string CurrentSplit { get; init; }

    public required string ReservedNormativeSplit { get; init; }

    public bool Normative { get; init; }
}

public sealed class QuranicCorpusSplitManifestReport
{
    public const string ManifestId =
        "adg-cns-quranic-corpus-split-manifest-v1";

    public const string AssignmentSeed =
        "adg-cns-quranic-corpus-split-zero-seed-v1";

    public required string Id { get; init; }

    public required string CorpusId { get; init; }

    public required string CorpusRoot { get; init; }

    public required string GroupingPolicy { get; init; }

    public required string AssignmentPolicy { get; init; }

    public required string Seed { get; init; }

    public long RecordCount { get; init; }

    public long GroupCount { get; init; }

    public long CrossSplitLeakageCount { get; init; }

    public SortedDictionary<string, long> CurrentRecordSplitCounts
        { get; init; } = new(StringComparer.Ordinal);

    public SortedDictionary<string, long> ReservedRecordSplitCounts
        { get; init; } = new(StringComparer.Ordinal);

    public IReadOnlyList<QuranicCorpusSplitGroup> Groups { get; init; } = [];

    public required string SplitMerkleRoot { get; init; }

    public bool IsValid =>
        RecordCount > 0
        && Groups.Count == GroupCount
        && Groups.Sum(group => group.RecordCount) == RecordCount
        && Groups.Select(group => group.GroupId)
            .Distinct(StringComparer.Ordinal)
            .LongCount() == GroupCount
        && Groups.SelectMany(group => group.RecordIds)
            .Distinct(StringComparer.Ordinal)
            .LongCount() == RecordCount
        && CurrentRecordSplitCounts.Values.Sum() == RecordCount
        && ReservedRecordSplitCounts.Values.Sum() == RecordCount
        && CrossSplitLeakageCount == 0
        && Groups.All(group =>
            group.RecordIds.Count == group.RecordCount
            && group.CurrentSplit == "research"
            && !group.Normative
            && group.ReservedNormativeSplit is
                "train" or "development" or "holdout");
}

public sealed class QuranicCorpusSplitManifestArtifact
{
    public required string Path { get; init; }

    public long Bytes { get; init; }

    public required string Sha256 { get; init; }

    public required string SplitMerkleRoot { get; init; }

    public long RecordCount { get; init; }

    public long GroupCount { get; init; }

    public long CrossSplitLeakageCount { get; init; }

    public bool IsValid { get; init; }
}

public static class QuranicCorpusSplitManifestBuilder
{
    public static QuranicCorpusSplitManifestReport Build(
        QuranicGrammarCorpusReport corpus)
    {
        ArgumentNullException.ThrowIfNull(corpus);
        if (!corpus.IsValid)
        {
            throw new InvalidDataException(
                "Split grouping requires a valid non-normative corpus.");
        }

        var groups = corpus.Records
            .GroupBy(
                record => record.Provenance.SourceId,
                StringComparer.Ordinal)
            .Select(group => CreateGroup(corpus, group))
            .OrderBy(group => group.GroupId, StringComparer.Ordinal)
            .ToArray();
        var recordIds = groups
            .SelectMany(group => group.RecordIds)
            .ToArray();
        var crossSplitLeakageCount = groups
            .GroupBy(
                group => group.ProvenanceSourceId,
                StringComparer.Ordinal)
            .LongCount(group =>
                group.Select(value => value.ReservedNormativeSplit)
                    .Distinct(StringComparer.Ordinal)
                    .Skip(1)
                    .Any());
        var leaves = new[]
            {
                SHA256.HashData(
                    Encoding.UTF8.GetBytes(
                        $"corpus\t{corpus.CorpusMerkleRoot}")),
                SHA256.HashData(
                    Encoding.UTF8.GetBytes(
                        $"seed\t{QuranicCorpusSplitManifestReport.AssignmentSeed}")),
            }
            .Concat(groups.Select(group =>
                SHA256.HashData(
                    Encoding.UTF8.GetBytes(Canonicalize(group)))))
            .ToArray();
        var report = new QuranicCorpusSplitManifestReport
        {
            Id = QuranicCorpusSplitManifestReport.ManifestId,
            CorpusId = corpus.Id,
            CorpusRoot = corpus.CorpusMerkleRoot,
            GroupingPolicy =
                "GroupByProvenanceSourceAndRuleSet; mutations stay with parent rule.",
            AssignmentPolicy =
                "ResearchOnly; reserve 80/10/10 normative buckets by SHA-256.",
            Seed = QuranicCorpusSplitManifestReport.AssignmentSeed,
            RecordCount = recordIds.LongLength,
            GroupCount = groups.LongLength,
            CrossSplitLeakageCount = crossSplitLeakageCount,
            CurrentRecordSplitCounts = Count(
                groups,
                group => group.CurrentSplit),
            ReservedRecordSplitCounts = Count(
                groups,
                group => group.ReservedNormativeSplit),
            Groups = groups,
            SplitMerkleRoot = QacMerkle.ComputeRoot(leaves),
        };
        if (!report.IsValid
            || recordIds.Length != corpus.RecordCount)
        {
            throw new InvalidDataException(
                "Split grouping failed its leakage or coverage contract.");
        }

        return report;
    }

    public static bool SelfTest()
    {
        var records = new[]
        {
            Record("A", "rule-1", "Valid", "source-1"),
            Record("B", "rule-1", "Invalid", "source-1"),
            Record("C", "rule-2", "Valid", "source-2"),
        };
        var corpus = new QuranicGrammarCorpusReport
        {
            Id = QuranicGrammarCorpusReport.CorpusId,
            ContractSetRoot = new string('1', 64),
            RecordCount = records.LongLength,
            PositiveRecordCount = 2,
            NegativeRecordCount = 1,
            EvidenceOnlyRecordCount = 0,
            NormativeRecordCount = 0,
            Records = records,
            CorpusMerkleRoot = new string('2', 64),
        };
        var first = Build(corpus);
        var second = Build(corpus);
        return first.IsValid
            && first.GroupCount == 2
            && first.RecordCount == 3
            && first.Groups.Any(group =>
                group.RecordIds.SequenceEqual(
                    ["A", "B"],
                    StringComparer.Ordinal))
            && first.SplitMerkleRoot == second.SplitMerkleRoot;
    }

    private static QuranicCorpusSplitGroup CreateGroup(
        QuranicGrammarCorpusReport corpus,
        IGrouping<string, QuranicGrammarCorpusRecord> sourceGroup)
    {
        var records = sourceGroup
            .OrderBy(record => record.RecordId, StringComparer.Ordinal)
            .ToArray();
        if (records.Any(record => record.Normative)
            || records.Any(record => record.Split != "research"))
        {
            throw new InvalidDataException(
                "The v1 split manifest accepts research-only records.");
        }

        var ruleIds = records
            .SelectMany(record => record.RuleIds)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(value => value, StringComparer.Ordinal)
            .ToArray();
        var groupKey = string.Join(
            "\t",
            "quranic-corpus-split-group-v1",
            corpus.ContractSetRoot,
            sourceGroup.Key,
            string.Join(",", ruleIds));
        var groupHashBytes = SHA256.HashData(
            Encoding.UTF8.GetBytes(groupKey));
        var groupHash = Convert.ToHexString(groupHashBytes)
            .ToLowerInvariant();
        return new QuranicCorpusSplitGroup
        {
            GroupId = $"QSG-{groupHash[..24]}",
            GroupKeySha256 = groupHash,
            ProvenanceSourceId = sourceGroup.Key,
            RuleIds = ruleIds,
            RecordIds = records
                .Select(record => record.RecordId)
                .ToArray(),
            RecordCount = records.LongLength,
            CurrentSplit = "research",
            ReservedNormativeSplit = ReservedSplit(groupHash),
            Normative = false,
        };
    }

    private static string ReservedSplit(string groupHash)
    {
        var assignmentBytes = SHA256.HashData(
            Encoding.UTF8.GetBytes(
                $"{QuranicCorpusSplitManifestReport.AssignmentSeed}\t{groupHash}"));
        var bucket =
            BinaryPrimitives.ReadUInt32BigEndian(assignmentBytes) % 10_000;
        return bucket switch
        {
            < 8_000 => "train",
            < 9_000 => "development",
            _ => "holdout",
        };
    }

    private static SortedDictionary<string, long> Count(
        IEnumerable<QuranicCorpusSplitGroup> groups,
        Func<QuranicCorpusSplitGroup, string> selector)
    {
        var counts =
            new SortedDictionary<string, long>(StringComparer.Ordinal);
        foreach (var group in groups)
        {
            var key = selector(group);
            counts.TryGetValue(key, out var count);
            counts[key] = count + group.RecordCount;
        }

        return counts;
    }

    private static QuranicGrammarCorpusRecord Record(
        string id,
        string ruleId,
        string status,
        string sourceId) =>
        new()
        {
            RecordId = id,
            SchemaVersion = 2,
            ContractSetRoot = new string('1', 64),
            RuleIds = [ruleId],
            Task = status == "Valid"
                ? "validate-grammar-state"
                : "diagnose-grammar-mutation",
            Input = new QuranicGrammarCorpusInput
            {
                Relation = ruleId,
                ContractStatus = "CanonicalValidator",
            },
            Target = new QuranicGrammarCorpusTarget
            {
                Status = status,
                ConsumptionPolicy = "ResearchMetadataOnly",
            },
            Provenance = new QuranicGrammarCorpusProvenance
            {
                Kind = "contract-derived",
                SourceId = sourceId,
                LicenseId = "ADG-Lang-derived-contracts",
            },
            Mutation = new QuranicGrammarCorpusMutation
            {
                Kind = status == "Valid" ? "none" : "replace",
                Feature = status == "Valid" ? "none" : "dependent.tag",
            },
            Split = "research",
            Normative = false,
        };

    private static string Canonicalize(
        QuranicCorpusSplitGroup group) =>
        string.Join(
            "\t",
            group.GroupId,
            group.GroupKeySha256,
            group.ProvenanceSourceId,
            string.Join(",", group.RuleIds),
            string.Join(",", group.RecordIds),
            group.RecordCount,
            group.CurrentSplit,
            group.ReservedNormativeSplit,
            group.Normative);
}

public static class QuranicCorpusSplitManifestArtifactWriter
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    };

    public static QuranicCorpusSplitManifestArtifact WriteJsonLines(
        QuranicCorpusSplitManifestReport report,
        string outputPath)
    {
        ArgumentNullException.ThrowIfNull(report);
        ArgumentException.ThrowIfNullOrWhiteSpace(outputPath);
        if (!report.IsValid)
        {
            throw new InvalidDataException(
                "Cannot write an invalid corpus split manifest.");
        }

        var fullPath = Path.GetFullPath(outputPath);
        Directory.CreateDirectory(
            Path.GetDirectoryName(fullPath)
            ?? throw new InvalidOperationException(
                "The output path has no directory."));
        using (var writer = new StreamWriter(
                   fullPath,
                   append: false,
                   new UTF8Encoding(encoderShouldEmitUTF8Identifier: false)))
        {
            foreach (var group in report.Groups
                         .OrderBy(value =>
                             value.GroupId,
                             StringComparer.Ordinal))
            {
                writer.WriteLine(JsonSerializer.Serialize(group, JsonOptions));
            }
        }

        var bytes = File.ReadAllBytes(fullPath);
        return new QuranicCorpusSplitManifestArtifact
        {
            Path = fullPath,
            Bytes = bytes.LongLength,
            Sha256 = Convert.ToHexString(SHA256.HashData(bytes))
                .ToLowerInvariant(),
            SplitMerkleRoot = report.SplitMerkleRoot,
            RecordCount = report.RecordCount,
            GroupCount = report.GroupCount,
            CrossSplitLeakageCount = report.CrossSplitLeakageCount,
            IsValid = report.IsValid,
        };
    }
}
