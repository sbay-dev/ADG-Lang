using System.Text.Json.Serialization;
using Adg.QuranicCore;
using Adg.QuranicCorpus;

namespace Adg.QuranicGrammar;

[JsonConverter(typeof(JsonStringEnumConverter<QuranicGrammarRuntimeStatus>))]
public enum QuranicGrammarRuntimeStatus
{
    Valid,
    Invalid,
    Unverified,
}

[JsonConverter(typeof(JsonStringEnumConverter<QuranicGrammarRuntimeMode>))]
public enum QuranicGrammarRuntimeMode
{
    NormativeCns,
    ResearchValidation,
}

public sealed class QuranicGrammarRuntimeRequest
{
    public required string ContractSetId { get; init; }

    public required string ContractSetRoot { get; init; }

    public required QacDependencyGraph Graph { get; init; }

    public IReadOnlyList<string> RuleIds { get; init; } = [];

    public QuranicGrammarRuntimeMode Mode { get; init; } =
        QuranicGrammarRuntimeMode.NormativeCns;
}

public sealed class QuranicGrammarRuntimeResponse
{
    public QuranicGrammarRuntimeStatus Status { get; init; }

    public required string ContractSetId { get; init; }

    public required string ContractSetRoot { get; init; }

    public required string GraphId { get; init; }

    public QuranicGrammarRuntimeMode Mode { get; init; }

    public IReadOnlyList<string> RuleIds { get; init; } = [];

    public IReadOnlyList<string> ConsumptionPolicies { get; init; } = [];

    public bool NormativeForCns { get; init; }

    public IReadOnlyList<QacSyntaxIssue> Diagnostics { get; init; } = [];
}

public sealed class QuranicGrammarConstraintRequest
{
    public required string ContractSetId { get; init; }

    public required string ContractSetRoot { get; init; }

    public QacDependencyGraph? Graph { get; init; }

    public IReadOnlyList<string> RuleIds { get; init; } = [];

    public QuranicGrammarRuntimeMode Mode { get; init; } =
        QuranicGrammarRuntimeMode.NormativeCns;
}

public sealed class QuranicGrammarConstraintResponse
{
    public QuranicGrammarRuntimeStatus Status { get; init; }

    public required string ContractSetId { get; init; }

    public required string ContractSetRoot { get; init; }

    public QuranicGrammarRuntimeMode Mode { get; init; }

    public IReadOnlyList<string> RuleIds { get; init; } = [];

    public IReadOnlyList<QuranicGrammarRuleContract> Constraints
        { get; init; } = [];

    public bool NormativeForCns { get; init; }

    public IReadOnlyList<QacSyntaxIssue> Diagnostics { get; init; } = [];
}

public sealed record QuranicGrammarCorrectionDirective(
    string RuleId,
    string QacCode,
    string Policy,
    bool RequiresRevalidation);

public sealed class QuranicGrammarCorrectionResponse
{
    public QuranicGrammarRuntimeStatus Status { get; init; }

    public required string ContractSetId { get; init; }

    public required string ContractSetRoot { get; init; }

    public required string GraphId { get; init; }

    public QuranicGrammarRuntimeMode Mode { get; init; }

    public IReadOnlyList<string> RuleIds { get; init; } = [];

    public IReadOnlyList<QuranicGrammarCorrectionDirective> Directives
        { get; init; } = [];

    public bool OriginalGraphUnchanged { get; init; }

    public bool NormativeForCns { get; init; }

    public IReadOnlyList<QacSyntaxIssue> Diagnostics { get; init; } = [];
}

public sealed class QuranicGrammarRuntime
{
    private readonly QuranicGrammarContractSetReport contracts;
    private readonly IReadOnlyDictionary<string, QuranicGrammarRuleContract>
        contractByCode;
    private readonly IReadOnlyDictionary<string, QuranicGrammarRuleContract>
        contractByRuleId;

    public QuranicGrammarRuntime(
        QuranicGrammarContractSetReport contracts)
    {
        ArgumentNullException.ThrowIfNull(contracts);
        if (!contracts.IsComplete)
        {
            throw new InvalidDataException(
                "Runtime validation requires a complete contract set.");
        }

        this.contracts = contracts;
        contractByCode = contracts.Contracts.ToDictionary(
            contract => contract.QacCode,
            StringComparer.Ordinal);
        contractByRuleId = contracts.Contracts.ToDictionary(
            contract => contract.RuleId,
            StringComparer.Ordinal);
    }

    public QuranicGrammarRuntimeResponse Validate(
        QuranicGrammarRuntimeRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(request.Graph);
        if (!string.Equals(
                request.ContractSetId,
                contracts.Id,
                StringComparison.Ordinal))
        {
            return Unverified(
                request,
                [],
                new QacSyntaxIssue(
                    "ADG-QR1301",
                    $"Contract set '{request.ContractSetId}' does not match "
                    + $"runtime set '{contracts.Id}'."));
        }

        if (!string.Equals(
                request.ContractSetRoot,
                contracts.ContractSetMerkleRoot,
                StringComparison.Ordinal))
        {
            return Unverified(
                request,
                [],
                new QacSyntaxIssue(
                    "ADG-QR1302",
                    "The requested contract root does not match the runtime "
                    + "contract root."));
        }

        var requestedRuleIds = request.RuleIds
            .Distinct(StringComparer.Ordinal)
            .OrderBy(value => value, StringComparer.Ordinal)
            .ToArray();
        var unknownRuleIds = requestedRuleIds
            .Where(ruleId => !contractByRuleId.ContainsKey(ruleId))
            .ToArray();
        if (unknownRuleIds.Length > 0)
        {
            return Unverified(
                request,
                requestedRuleIds,
                new QacSyntaxIssue(
                    "ADG-QR1303",
                    "Unknown runtime rule IDs: "
                    + string.Join(", ", unknownRuleIds)));
        }

        var graphValidation = QacSyntaxValidator.Validate(
            request.Graph,
            QacSyntaxValidationProfile.Canonical);
        if (!graphValidation.IsValid)
        {
            return Response(
                request,
                QuranicGrammarRuntimeStatus.Invalid,
                requestedRuleIds,
                graphValidation.Errors);
        }

        var derivedRuleIds = request.Graph.Edges
            .Select(edge => edge.Relation)
            .Concat(
                request.Graph.Nodes
                    .Where(node =>
                        node.Kind == QacSyntaxNodeKind.Phrase
                        && QacSyntaxValidator.CanonicalPhraseCodes.Contains(
                            node.Tag))
                    .Select(node => node.Tag))
            .Distinct(StringComparer.Ordinal)
            .Select(code => contractByCode[code].RuleId)
            .OrderBy(value => value, StringComparer.Ordinal)
            .ToArray();
        if (derivedRuleIds.Length == 0)
        {
            return Unverified(
                request,
                requestedRuleIds,
                new QacSyntaxIssue(
                    "ADG-QR1305",
                    "The graph contains no executable grammar claim."));
        }

        var effectiveRuleIds = requestedRuleIds.Length == 0
            ? derivedRuleIds
            : requestedRuleIds;
        if (requestedRuleIds.Length > 0
            && !requestedRuleIds.SequenceEqual(
                derivedRuleIds,
                StringComparer.Ordinal))
        {
            return Response(
                request,
                QuranicGrammarRuntimeStatus.Invalid,
                effectiveRuleIds,
                [
                    new QacSyntaxIssue(
                        "ADG-QR1304",
                        "Declared rule IDs do not match the graph claims."),
                ]);
        }

        var effectiveContracts = effectiveRuleIds
            .Select(ruleId => contractByRuleId[ruleId])
            .ToArray();
        if (effectiveContracts.Any(contract =>
                contract.Status != "CanonicalValidator"))
        {
            return Unverified(
                request,
                effectiveRuleIds,
                new QacSyntaxIssue(
                    "ADG-QR1306",
                    "At least one graph claim lacks an executable contract."));
        }

        if (graphValidation.UnverifiedEdgeCount > 0)
        {
            return Unverified(
                request,
                effectiveRuleIds,
                new QacSyntaxIssue(
                    "ADG-QR1307",
                    "The graph contains one or more unverified edges."));
        }

        if (request.Graph.Nodes.Any(node =>
                node.Morphology?.Location == "natural:heuristic"))
        {
            return Unverified(
                request,
                effectiveRuleIds,
                new QacSyntaxIssue(
                    "ADG-QR1309",
                    "Natural-Arabic heuristic morphology cannot enter a "
                    + "verified Quranic runtime path."));
        }

        if (request.Mode == QuranicGrammarRuntimeMode.NormativeCns
            && effectiveContracts.Any(contract =>
                !contract.IsNormativeForCns))
        {
            return Unverified(
                request,
                effectiveRuleIds,
                new QacSyntaxIssue(
                    "ADG-QR1308",
                    "The graph is valid under research contracts, but the "
                    + "contracts are not normative for CNS."));
        }

        return Response(
            request,
            QuranicGrammarRuntimeStatus.Valid,
            effectiveRuleIds,
            []);
    }

    public QuranicGrammarConstraintResponse DiscoverConstraints(
        QuranicGrammarConstraintRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        var bindingIssue = ValidateContractBinding(
            request.ContractSetId,
            request.ContractSetRoot);
        if (bindingIssue is not null)
        {
            return ConstraintResponse(
                request,
                QuranicGrammarRuntimeStatus.Unverified,
                [],
                [],
                [bindingIssue]);
        }

        var requestedRuleIds = request.RuleIds
            .Distinct(StringComparer.Ordinal)
            .OrderBy(value => value, StringComparer.Ordinal)
            .ToArray();
        var unknownRuleIds = requestedRuleIds
            .Where(ruleId => !contractByRuleId.ContainsKey(ruleId))
            .ToArray();
        if (unknownRuleIds.Length > 0)
        {
            return ConstraintResponse(
                request,
                QuranicGrammarRuntimeStatus.Unverified,
                requestedRuleIds,
                [],
                [
                    new QacSyntaxIssue(
                        "ADG-QR1303",
                        "Unknown runtime rule IDs: "
                        + string.Join(", ", unknownRuleIds)),
                ]);
        }

        var graphRuleIds = Array.Empty<string>();
        if (request.Graph is not null)
        {
            var codes = GraphClaimCodes(request.Graph);
            var unknownCodes = codes
                .Where(code => !contractByCode.ContainsKey(code))
                .ToArray();
            if (unknownCodes.Length > 0)
            {
                return ConstraintResponse(
                    request,
                    QuranicGrammarRuntimeStatus.Unverified,
                    requestedRuleIds,
                    [],
                    [
                        new QacSyntaxIssue(
                            "ADG-QR1310",
                            "Unknown graph claim codes: "
                            + string.Join(", ", unknownCodes)),
                    ]);
            }

            graphRuleIds = codes
                .Select(code => contractByCode[code].RuleId)
                .OrderBy(value => value, StringComparer.Ordinal)
                .ToArray();
        }

        if (requestedRuleIds.Length > 0
            && graphRuleIds.Length > 0
            && !requestedRuleIds.SequenceEqual(
                graphRuleIds,
                StringComparer.Ordinal))
        {
            return ConstraintResponse(
                request,
                QuranicGrammarRuntimeStatus.Invalid,
                requestedRuleIds,
                [],
                [
                    new QacSyntaxIssue(
                        "ADG-QR1304",
                        "Declared rule IDs do not match the graph claims."),
                ]);
        }

        var effectiveRuleIds = requestedRuleIds.Length > 0
            ? requestedRuleIds
            : graphRuleIds;
        if (effectiveRuleIds.Length == 0)
        {
            return ConstraintResponse(
                request,
                QuranicGrammarRuntimeStatus.Unverified,
                [],
                [],
                [
                    new QacSyntaxIssue(
                        "ADG-QR1305",
                        "No executable grammar claim was supplied for "
                        + "constraint discovery."),
                ]);
        }

        var effectiveContracts = effectiveRuleIds
            .Select(ruleId => contractByRuleId[ruleId])
            .ToArray();
        if (effectiveContracts.Any(contract =>
                contract.Status != "CanonicalValidator"))
        {
            return ConstraintResponse(
                request,
                QuranicGrammarRuntimeStatus.Unverified,
                effectiveRuleIds,
                effectiveContracts,
                [
                    new QacSyntaxIssue(
                        "ADG-QR1306",
                        "At least one requested claim lacks an executable "
                        + "contract."),
                ]);
        }

        if (request.Mode == QuranicGrammarRuntimeMode.NormativeCns
            && effectiveContracts.Any(contract =>
                !contract.IsNormativeForCns))
        {
            return ConstraintResponse(
                request,
                QuranicGrammarRuntimeStatus.Unverified,
                effectiveRuleIds,
                effectiveContracts,
                [
                    new QacSyntaxIssue(
                        "ADG-QR1308",
                        "The constraints are available for research, but "
                        + "are not normative for CNS."),
                ]);
        }

        return ConstraintResponse(
            request,
            QuranicGrammarRuntimeStatus.Valid,
            effectiveRuleIds,
            effectiveContracts,
            []);
    }

    public QuranicGrammarCorrectionResponse RequestCorrection(
        QuranicGrammarRuntimeRequest request)
    {
        var validation = Validate(request);
        var ruleIds = validation.RuleIds.Count > 0
            ? validation.RuleIds
            : GraphClaimCodes(request.Graph)
                .Where(contractByCode.ContainsKey)
                .Select(code => contractByCode[code].RuleId)
                .Distinct(StringComparer.Ordinal)
                .OrderBy(value => value, StringComparer.Ordinal)
                .ToArray();
        var directives = ruleIds
            .Where(contractByRuleId.ContainsKey)
            .Select(ruleId => contractByRuleId[ruleId])
            .Where(contract =>
                !string.Equals(
                    contract.CorrectionPolicy,
                    "None",
                    StringComparison.Ordinal))
            .Select(contract =>
                new QuranicGrammarCorrectionDirective(
                    contract.RuleId,
                    contract.QacCode,
                    contract.CorrectionPolicy,
                    RequiresRevalidation: true))
            .ToArray();
        var diagnostics = validation.Diagnostics.ToList();
        if (validation.Status != QuranicGrammarRuntimeStatus.Valid)
        {
            diagnostics.Add(
                directives.Length == 0
                    ? new QacSyntaxIssue(
                        "ADG-QR1311",
                        "No approved automatic correction policy exists; "
                        + "the original graph is unchanged.")
                    : new QacSyntaxIssue(
                        "ADG-QR1312",
                        "Correction directives are advisory and require "
                        + "application followed by full re-validation."));
        }

        return new QuranicGrammarCorrectionResponse
        {
            Status = validation.Status,
            ContractSetId = contracts.Id,
            ContractSetRoot = contracts.ContractSetMerkleRoot,
            GraphId = request.Graph.Id,
            Mode = request.Mode,
            RuleIds = ruleIds,
            Directives = directives,
            OriginalGraphUnchanged = true,
            NormativeForCns = validation.NormativeForCns,
            Diagnostics = diagnostics,
        };
    }

    public static bool SelfTest(
        QuranicGrammarContractSetReport contracts)
    {
        var runtime = new QuranicGrammarRuntime(contracts);
        var noun = new QacSyntaxNode(
            "noun",
            QacSyntaxNodeKind.Terminal,
            "N",
            TextRange: new SourceRange(0, 1),
            Morphology: Morphology("N", grammaticalCase: "NOM"));
        var invalidNoun = noun with
        {
            Morphology = Morphology("N", grammaticalCase: "ACC"),
        };
        var verb = new QacSyntaxNode(
            "verb",
            QacSyntaxNodeKind.Terminal,
            "V",
            TextRange: new SourceRange(1, 1),
            Morphology: Morphology(
                "V",
                aspect: "PERF",
                voice: "ACT"));
        var validGraph = new QacDependencyGraph(
            "runtime-valid",
            [noun, verb],
            [new QacDependencyEdge("noun", "verb", "subj")]);
        var invalidGraph = new QacDependencyGraph(
            "runtime-invalid",
            [invalidNoun, verb],
            [new QacDependencyEdge("noun", "verb", "subj")]);
        var unverifiedGraph = new QacDependencyGraph(
            "runtime-unverified",
            [noun, verb],
            [new QacDependencyEdge(
                "noun",
                "verb",
                "subj",
                IsVerified: false)]);
        var heuristicGraph = new QacDependencyGraph(
            "runtime-heuristic",
            [
                noun with
                {
                    Morphology = noun.Morphology! with
                    {
                        Location = "natural:heuristic",
                    },
                },
                verb,
            ],
            [new QacDependencyEdge("noun", "verb", "subj")]);
        QuranicGrammarRuntimeRequest Request(
            QacDependencyGraph graph,
            QuranicGrammarRuntimeMode mode =
                QuranicGrammarRuntimeMode.ResearchValidation,
            string? root = null) =>
            new()
            {
                ContractSetId = contracts.Id,
                ContractSetRoot =
                    root ?? contracts.ContractSetMerkleRoot,
                Graph = graph,
                Mode = mode,
            };
        QuranicGrammarConstraintRequest ConstraintRequest(
            QacDependencyGraph graph,
            QuranicGrammarRuntimeMode mode =
                QuranicGrammarRuntimeMode.ResearchValidation,
            string? root = null) =>
            new()
            {
                ContractSetId = contracts.Id,
                ContractSetRoot =
                    root ?? contracts.ContractSetMerkleRoot,
                Graph = graph,
                Mode = mode,
            };
        var discovered = runtime.DiscoverConstraints(
            ConstraintRequest(validGraph));
        var normativeDiscovery = runtime.DiscoverConstraints(
            ConstraintRequest(
                validGraph,
                QuranicGrammarRuntimeMode.NormativeCns));
        var correction = runtime.RequestCorrection(Request(invalidGraph));

        return runtime.Validate(Request(validGraph)).Status
                == QuranicGrammarRuntimeStatus.Valid
            && runtime.Validate(
                    Request(
                        validGraph,
                        QuranicGrammarRuntimeMode.NormativeCns))
                .Status == QuranicGrammarRuntimeStatus.Unverified
            && runtime.Validate(Request(invalidGraph)).Status
                == QuranicGrammarRuntimeStatus.Invalid
            && runtime.Validate(Request(unverifiedGraph)).Status
                == QuranicGrammarRuntimeStatus.Unverified
            && runtime.Validate(Request(heuristicGraph)).Status
                == QuranicGrammarRuntimeStatus.Unverified
            && runtime.Validate(
                    Request(validGraph, root: new string('0', 64)))
                .Status == QuranicGrammarRuntimeStatus.Unverified
            && discovered.Status == QuranicGrammarRuntimeStatus.Valid
            && discovered.Constraints.Count == 1
            && normativeDiscovery.Status
                == QuranicGrammarRuntimeStatus.Unverified
            && correction.Status == QuranicGrammarRuntimeStatus.Invalid
            && correction.Directives.Count == 0
            && correction.OriginalGraphUnchanged
            && correction.Diagnostics.Any(issue =>
                issue.Code == "ADG-QR1311");
    }

    private QacSyntaxIssue? ValidateContractBinding(
        string contractSetId,
        string contractSetRoot)
    {
        if (!string.Equals(
                contractSetId,
                contracts.Id,
                StringComparison.Ordinal))
        {
            return new QacSyntaxIssue(
                "ADG-QR1301",
                $"Contract set '{contractSetId}' does not match runtime set "
                + $"'{contracts.Id}'.");
        }

        return !string.Equals(
            contractSetRoot,
            contracts.ContractSetMerkleRoot,
            StringComparison.Ordinal)
            ? new QacSyntaxIssue(
                "ADG-QR1302",
                "The requested contract root does not match the runtime "
                + "contract root.")
            : null;
    }

    private static string[] GraphClaimCodes(
        QacDependencyGraph graph) =>
        graph.Edges
            .Select(edge => edge.Relation)
            .Concat(
                graph.Nodes
                    .Where(node =>
                        node.Kind == QacSyntaxNodeKind.Phrase
                        && QacSyntaxValidator.CanonicalPhraseCodes.Contains(
                            node.Tag))
                    .Select(node => node.Tag))
            .Distinct(StringComparer.Ordinal)
            .OrderBy(value => value, StringComparer.Ordinal)
            .ToArray();

    private QuranicGrammarConstraintResponse ConstraintResponse(
        QuranicGrammarConstraintRequest request,
        QuranicGrammarRuntimeStatus status,
        IReadOnlyList<string> ruleIds,
        IReadOnlyList<QuranicGrammarRuleContract> effectiveContracts,
        IReadOnlyList<QacSyntaxIssue> diagnostics) =>
        new()
        {
            Status = status,
            ContractSetId = contracts.Id,
            ContractSetRoot = contracts.ContractSetMerkleRoot,
            Mode = request.Mode,
            RuleIds = ruleIds,
            Constraints = effectiveContracts,
            NormativeForCns = effectiveContracts.Count > 0
                && effectiveContracts.All(contract =>
                    contract.IsNormativeForCns),
            Diagnostics = diagnostics,
        };

    private QuranicGrammarRuntimeResponse Unverified(
        QuranicGrammarRuntimeRequest request,
        IReadOnlyList<string> ruleIds,
        QacSyntaxIssue diagnostic) =>
        Response(
            request,
            QuranicGrammarRuntimeStatus.Unverified,
            ruleIds,
            [diagnostic]);

    private QuranicGrammarRuntimeResponse Response(
        QuranicGrammarRuntimeRequest request,
        QuranicGrammarRuntimeStatus status,
        IReadOnlyList<string> ruleIds,
        IReadOnlyList<QacSyntaxIssue> diagnostics)
    {
        var effectiveContracts = ruleIds
            .Where(contractByRuleId.ContainsKey)
            .Select(ruleId => contractByRuleId[ruleId])
            .ToArray();
        return new QuranicGrammarRuntimeResponse
        {
            Status = status,
            ContractSetId = contracts.Id,
            ContractSetRoot = contracts.ContractSetMerkleRoot,
            GraphId = request.Graph.Id,
            Mode = request.Mode,
            RuleIds = ruleIds,
            ConsumptionPolicies = effectiveContracts
                .Select(contract => contract.CnsConsumptionPolicy)
                .Distinct(StringComparer.Ordinal)
                .OrderBy(value => value, StringComparer.Ordinal)
                .ToArray(),
            NormativeForCns = effectiveContracts.Length > 0
                && effectiveContracts.All(contract =>
                    contract.IsNormativeForCns),
            Diagnostics = diagnostics,
        };
    }

    private static QacNormalizedMorphologyRecord Morphology(
        string tag,
        string? grammaticalCase = null,
        string? aspect = null,
        string? voice = null) =>
        new(
            "runtime:self-test",
            "",
            tag,
            nameof(QacSegmentKind.Stem),
            ["STEM", $"POS:{tag}"],
            null,
            null,
            null,
            null,
            null,
            aspect,
            null,
            voice,
            null,
            null,
            grammaticalCase,
            null);
}
