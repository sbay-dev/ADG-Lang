using System.Security.Cryptography;
using System.Text;
using Adg.QuranicCorpus;

namespace Adg.QuranicGrammar;

public sealed record QuranicPhraseContractAuditIssue(
    string GraphId,
    string Code,
    string Message,
    string? NodeId,
    string? Edge);

public sealed class QuranicPhraseContractAuditReport
{
    public required string ContractId { get; init; }

    public required string TreebankGraphMerkleRoot { get; init; }

    public long GraphCount { get; init; }

    public long PhraseCount { get; init; }

    public long ValidGraphCount { get; init; }

    public long ErrorCount { get; init; }

    public IReadOnlyList<QuranicPhraseContractAuditIssue> Errors
        { get; init; } = [];

    public required string AuditMerkleRoot { get; init; }

    public bool IsValid =>
        GraphCount == ValidGraphCount
        && PhraseCount > 0
        && ErrorCount == 0
        && Errors.Count == 0;
}

public static class QuranicPhraseContractAuditor
{
    public const string ContractId =
        "adg-quranic-phrase-contract-audit-v1";

    public static QuranicPhraseContractAuditReport Audit(
        QacSyntaxTreebank treebank)
    {
        ArgumentNullException.ThrowIfNull(treebank);
        var errors = new List<QuranicPhraseContractAuditIssue>();
        var leaves = new List<byte[]>(treebank.Graphs.Count);
        long phraseCount = 0;
        long validGraphCount = 0;
        foreach (var sourceGraph in treebank.Graphs)
        {
            var report = QacSyntaxValidator.Validate(
                sourceGraph.Graph,
                QacSyntaxValidationProfile.PhraseContracts);
            var graphPhraseCount = sourceGraph.Graph.Nodes.LongCount(node =>
                node.Kind == QacSyntaxNodeKind.Phrase);
            phraseCount += graphPhraseCount;
            if (report.IsValid)
            {
                validGraphCount++;
            }

            foreach (var issue in report.Errors)
            {
                errors.Add(
                    new QuranicPhraseContractAuditIssue(
                        sourceGraph.Graph.Id,
                        issue.Code,
                        issue.Message,
                        issue.NodeId,
                        issue.Edge));
            }

            var canonical = string.Join(
                "\t",
                sourceGraph.Graph.Id,
                graphPhraseCount,
                report.IsValid,
                string.Join(
                    "|",
                    report.Errors.Select(issue =>
                        $"{issue.Code}:{issue.NodeId}:{issue.Edge}")));
            leaves.Add(
                SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));
        }

        return new QuranicPhraseContractAuditReport
        {
            ContractId = ContractId,
            TreebankGraphMerkleRoot = treebank.GraphMerkleRoot,
            GraphCount = treebank.Graphs.Count,
            PhraseCount = phraseCount,
            ValidGraphCount = validGraphCount,
            ErrorCount = errors.Count,
            Errors = errors,
            AuditMerkleRoot = QacMerkle.ComputeRoot(leaves),
        };
    }
}
