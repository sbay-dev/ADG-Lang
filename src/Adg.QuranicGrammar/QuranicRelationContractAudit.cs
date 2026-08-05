using System.Security.Cryptography;
using System.Text;
using Adg.QuranicCorpus;

namespace Adg.QuranicGrammar;

public sealed class QuranicRelationContractCoverage
{
    public required string Relation { get; init; }

    public long EvidenceCount { get; init; }

    public long AcceptedEvidenceCount { get; init; }

    public long DeferredEvidenceCount { get; init; }

    public double Coverage =>
        EvidenceCount == 0
            ? 0
            : (double)AcceptedEvidenceCount / EvidenceCount;
}

public sealed record QuranicRelationContractAuditIssue(
    string GraphId,
    string Relation,
    string DependentId,
    string HeadId,
    string Code,
    string Message);

public sealed class QuranicRelationContractAuditReport
{
    public required string ContractId { get; init; }

    public required string TreebankGraphMerkleRoot { get; init; }

    public long RelationCount { get; init; }

    public long EvidenceCount { get; init; }

    public long AcceptedEvidenceCount { get; init; }

    public long DeferredEvidenceCount { get; init; }

    public IReadOnlyList<QuranicRelationContractCoverage> Relations
        { get; init; } = [];

    public IReadOnlyList<QuranicRelationContractAuditIssue> IssueSamples
        { get; init; } = [];

    public SortedDictionary<string, long> IssueCounts { get; init; } =
        new(StringComparer.Ordinal);

    public required string AuditMerkleRoot { get; init; }

    public bool IsFullCoverage => DeferredEvidenceCount == 0;

    public bool IsValid =>
        RelationCount == QacSyntaxCatalog.DependencyRelations.Count
        && Relations.Count == RelationCount
        && EvidenceCount
            == AcceptedEvidenceCount + DeferredEvidenceCount
        && Relations.Sum(relation => relation.EvidenceCount)
            == EvidenceCount
        && Relations.Sum(relation => relation.AcceptedEvidenceCount)
            == AcceptedEvidenceCount
        && Relations.Sum(relation => relation.DeferredEvidenceCount)
            == DeferredEvidenceCount;
}

public static class QuranicRelationContractAuditor
{
    public const string ContractId =
        "adg-quranic-relation-contract-audit-v1";

    private const int MaximumIssueSamples = 200;

    public static QuranicRelationContractAuditReport Audit(
        QacSyntaxTreebank treebank)
    {
        ArgumentNullException.ThrowIfNull(treebank);
        var relationEvidence =
            QacSyntaxCatalog.DependencyRelations.Keys.ToDictionary(
                relation => relation,
                _ => new CoverageAccumulator(),
                StringComparer.Ordinal);
        var samples = new List<QuranicRelationContractAuditIssue>();
        var issueCounts =
            new SortedDictionary<string, long>(StringComparer.Ordinal);
        var leaves = new List<byte[]>();
        foreach (var sourceGraph in treebank.Graphs)
        {
            var nodes = sourceGraph.Graph.Nodes.ToDictionary(
                node => node.Id,
                StringComparer.Ordinal);
            foreach (var edge in sourceGraph.Graph.Edges)
            {
                var accumulator = relationEvidence[edge.Relation];
                accumulator.EvidenceCount++;
                var issues =
                    !nodes.TryGetValue(edge.DependentId, out var dependent)
                    || !nodes.TryGetValue(edge.HeadId, out var head)
                        ?
                        [
                            new QacSyntaxIssue(
                                "ADG-QS1102",
                                "Dependency edge references a missing node.",
                                Edge:
                                    $"{edge.DependentId}-[{edge.Relation}]"
                                    + $"->{edge.HeadId}"),
                        ]
                        : QacSyntaxValidator.ValidateCanonicalRelationEdge(
                            edge,
                            dependent,
                            head);
                if (issues.Count == 0)
                {
                    accumulator.AcceptedEvidenceCount++;
                }
                else
                {
                    accumulator.DeferredEvidenceCount++;
                    foreach (var issue in issues)
                    {
                        var issueKey =
                            $"{edge.Relation}|{issue.Code}|{issue.Message}";
                        issueCounts.TryGetValue(issueKey, out var count);
                        issueCounts[issueKey] = count + 1;
                    }

                    if (samples.Count < MaximumIssueSamples)
                    {
                        samples.AddRange(
                            issues
                                .Take(MaximumIssueSamples - samples.Count)
                                .Select(issue =>
                                    new QuranicRelationContractAuditIssue(
                                        sourceGraph.Graph.Id,
                                        edge.Relation,
                                        edge.DependentId,
                                        edge.HeadId,
                                        issue.Code,
                                        issue.Message)));
                    }
                }

                var canonical = string.Join(
                    "\t",
                    sourceGraph.Graph.Id,
                    edge.DependentId,
                    edge.Relation,
                    edge.HeadId,
                    issues.Count == 0,
                    string.Join(
                        "|",
                        issues.Select(issue =>
                            $"{issue.Code}:{issue.Message}")));
                leaves.Add(
                    SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));
            }
        }

        var relations = relationEvidence
            .OrderBy(pair => pair.Key, StringComparer.Ordinal)
            .Select(pair =>
                new QuranicRelationContractCoverage
                {
                    Relation = pair.Key,
                    EvidenceCount = pair.Value.EvidenceCount,
                    AcceptedEvidenceCount =
                        pair.Value.AcceptedEvidenceCount,
                    DeferredEvidenceCount =
                        pair.Value.DeferredEvidenceCount,
                })
            .ToArray();
        return new QuranicRelationContractAuditReport
        {
            ContractId = ContractId,
            TreebankGraphMerkleRoot = treebank.GraphMerkleRoot,
            RelationCount = relations.Length,
            EvidenceCount = relations.Sum(relation =>
                relation.EvidenceCount),
            AcceptedEvidenceCount = relations.Sum(relation =>
                relation.AcceptedEvidenceCount),
            DeferredEvidenceCount = relations.Sum(relation =>
                relation.DeferredEvidenceCount),
            Relations = relations,
            IssueSamples = samples,
            IssueCounts = issueCounts,
            AuditMerkleRoot = QacMerkle.ComputeRoot(leaves),
        };
    }

    private sealed class CoverageAccumulator
    {
        public long EvidenceCount { get; set; }

        public long AcceptedEvidenceCount { get; set; }

        public long DeferredEvidenceCount { get; set; }
    }
}
