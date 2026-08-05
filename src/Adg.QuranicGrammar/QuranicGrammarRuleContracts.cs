using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Adg.QuranicCorpus;

namespace Adg.QuranicGrammar;

public sealed class QuranicGrammarNodeConstraint
{
    public IReadOnlyList<string> AllowedTags { get; init; } = [];

    public string? RequiredCase { get; init; }

    public IReadOnlyList<string> AllowUnmarkedCaseTags { get; init; } = [];

    public string? RequiredAspect { get; init; }

    public string? RequiredMood { get; init; }

    public string? RequiredVoice { get; init; }
}

public sealed record QuranicGrammarConditionalConstraint(
    string IfNode,
    string IfFeature,
    string IfValue,
    string ThenNode,
    string RequiredFeature,
    string RequiredValue);

public sealed record QuranicGrammarContractException(
    string Code,
    string Description,
    IReadOnlyDictionary<string, string> Match);

public sealed class QuranicGrammarPhraseConstraint
{
    public bool RequiresResolvedContiguousSpan { get; init; }

    public bool RequiresLaminarSpanSet { get; init; }

    public IReadOnlyList<string> AllowedStartNodeSignatures { get; init; } = [];

    public IReadOnlyList<string> AllowedEndNodeSignatures { get; init; } = [];

    public IReadOnlyList<string> RequiredMemberTags { get; init; } = [];

    public IReadOnlyList<string> AllowedParentRelations { get; init; } = [];

    public IReadOnlyList<string> AllowedChildRelations { get; init; } = [];
}

public sealed class QuranicGrammarRuleContract
{
    public required string RuleId { get; init; }

    public required string Kind { get; init; }

    public required string QacCode { get; init; }

    public required string Family { get; init; }

    public required string Description { get; init; }

    public required string Source { get; init; }

    public required string Status { get; init; }

    public long EvidenceCount { get; init; }

    public required string Direction { get; init; }

    public QuranicGrammarNodeConstraint? Dependent { get; init; }

    public QuranicGrammarNodeConstraint? Head { get; init; }

    public QuranicGrammarPhraseConstraint? Phrase { get; init; }

    public IReadOnlyList<QuranicGrammarConditionalConstraint> Conditions
        { get; init; } = [];

    public IReadOnlyList<QuranicGrammarContractException> Exceptions
        { get; init; } = [];

    public IReadOnlyList<string> Invariants { get; init; } = [];

    public IReadOnlyList<string> ValidatorDiagnosticCodes { get; init; } = [];

    public required string CorrectionPolicy { get; init; }

    public bool IsNormativeForCns { get; init; }

    public required string CnsConsumptionPolicy { get; init; }
}

public sealed class QuranicGrammarContractSetReport
{
    public const string ContractSetId =
        "adg-quranic-grammar-contracts-v3";

    public required string Id { get; init; }

    public required string InventoryContractId { get; init; }

    public required string InventoryMerkleRoot { get; init; }

    public long ContractCount { get; init; }

    public long CanonicalValidatorContractCount { get; init; }

    public long EvidenceOnlyContractCount { get; init; }

    public long NormativeForCnsContractCount { get; init; }

    public IReadOnlyList<QuranicGrammarRuleContract> Contracts { get; init; } = [];

    public required string ContractSetMerkleRoot { get; init; }

    public bool IsComplete =>
        ContractCount
            == QacSyntaxCatalog.DependencyRelations.Count
                + QacSyntaxCatalog.PhraseTags.Count
        && CanonicalValidatorContractCount
            == QacSyntaxValidator.CanonicalRelationCodes.Count
                + QacSyntaxValidator.CanonicalPhraseCodes.Count
        && CanonicalValidatorContractCount + EvidenceOnlyContractCount
            == ContractCount
        && NormativeForCnsContractCount == 0;
}

public sealed class QuranicGrammarContractArtifact
{
    public required string Path { get; init; }

    public long Bytes { get; init; }

    public required string Sha256 { get; init; }

    public required string ContractSetMerkleRoot { get; init; }

    public long ContractCount { get; init; }

    public long CanonicalValidatorContractCount { get; init; }

    public long EvidenceOnlyContractCount { get; init; }

    public long NormativeForCnsContractCount { get; init; }

    public bool IsComplete { get; init; }
}

public static class QuranicGrammarContractCatalog
{
    private static readonly IReadOnlyList<string> UnmarkedCaseTags =
        ["DEM", "IMPN", "LOC", "PRON", "REL", "T"];

    public static QuranicGrammarContractSetReport Build(
        QuranicGrammarRuleInventoryReport inventory)
    {
        ArgumentNullException.ThrowIfNull(inventory);
        if (!inventory.IsInventoryComplete)
        {
            throw new InvalidDataException(
                "Quranic grammar contracts require a complete rule inventory.");
        }

        var contracts = inventory.Rules
            .OrderBy(rule => rule.RuleId, StringComparer.Ordinal)
            .Select(BuildContract)
            .ToArray();
        var canonicalCount = contracts.LongCount(contract =>
            contract.Status == "CanonicalValidator");
        var evidenceOnlyCount = contracts.LongCount(contract =>
            contract.Status == "EvidenceOnly");
        var leaves = new[]
            {
                SHA256.HashData(
                    Encoding.UTF8.GetBytes(
                        $"inventory\t{inventory.InventoryMerkleRoot}")),
            }
            .Concat(contracts
            .Select(contract =>
                SHA256.HashData(
                    Encoding.UTF8.GetBytes(Canonicalize(contract)))))
            .ToArray();
        return new QuranicGrammarContractSetReport
        {
            Id = QuranicGrammarContractSetReport.ContractSetId,
            InventoryContractId = inventory.InventoryContractId,
            InventoryMerkleRoot = inventory.InventoryMerkleRoot,
            ContractCount = contracts.LongLength,
            CanonicalValidatorContractCount = canonicalCount,
            EvidenceOnlyContractCount = evidenceOnlyCount,
            NormativeForCnsContractCount =
                contracts.LongCount(contract => contract.IsNormativeForCns),
            Contracts = contracts,
            ContractSetMerkleRoot = QacMerkle.ComputeRoot(leaves),
        };
    }

    public static bool SelfTest()
    {
        var rules = QacSyntaxCatalog.DependencyRelations.Values
            .Select(definition =>
                new QuranicGrammarRuleEvidence
                {
                    RuleId =
                        $"QUR-QAC-REL-{definition.Code.ToUpperInvariant()}",
                    Kind = "dependency-relation",
                    QacCode = definition.Code,
                    Family = definition.Family,
                    Description = definition.Description,
                    Source = QacSyntaxCatalog.RelationSource,
                    EvidenceCount = 1,
                    HasCanonicalValidatorContract =
                        QacSyntaxValidator.CanonicalRelationCodes.Contains(
                            definition.Code),
                })
            .Concat(
                QacSyntaxCatalog.PhraseTags.Values.Select(definition =>
                    new QuranicGrammarRuleEvidence
                    {
                        RuleId = $"QUR-QAC-PHRASE-{definition.Code}",
                        Kind = "phrase",
                        QacCode = definition.Code,
                        Family = "phrase",
                        Description = definition.Description,
                        Source = QacSyntaxCatalog.PhraseTagSource,
                        EvidenceCount = 1,
                        HasCanonicalValidatorContract = true,
                    }))
            .OrderBy(rule => rule.RuleId, StringComparer.Ordinal)
            .ToArray();
        var inventory = new QuranicGrammarRuleInventoryReport
        {
            InventoryContractId =
                QuranicGrammarRuleInventoryReport.ContractId,
            EvidenceBoundary = "self-test",
            SyntaxInputSha256 = new string('0', 64),
            TreebankGraphMerkleRoot = new string('0', 64),
            GraphCount = 1,
            DependencyRuleCount =
                QacSyntaxCatalog.DependencyRelations.Count,
            ObservedDependencyRuleCount =
                QacSyntaxCatalog.DependencyRelations.Count,
            PhraseRuleCount = QacSyntaxCatalog.PhraseTags.Count,
            ObservedPhraseRuleCount = QacSyntaxCatalog.PhraseTags.Count,
            CanonicalValidatorRuleCount =
                QacSyntaxValidator.CanonicalRelationCodes.Count
                + QacSyntaxValidator.CanonicalPhraseCodes.Count,
            DependencyEvidenceCount =
                QacSyntaxCatalog.DependencyRelations.Count,
            PhraseEvidenceCount = QacSyntaxCatalog.PhraseTags.Count,
            Rules = rules,
            InventoryMerkleRoot = new string('0', 64),
        };
        var report = Build(inventory);
        var subject = report.Contracts.Single(contract =>
            contract.QacCode == "subj");
        var extendedSubject = report.Contracts.Single(contract =>
            contract.QacCode == "subjx");
        var causal = report.Contracts.Single(contract =>
            contract.QacCode == "caus");
        var prepositionalPhrase = report.Contracts.Single(contract =>
            contract.Kind == "phrase"
            && contract.QacCode == "PP");
        return report.IsComplete
            && subject.Dependent?.RequiredCase is "NOM"
            && subject.Head?.AllowedTags.Contains(
                "V",
                StringComparer.Ordinal) == true
            && extendedSubject.Status == "CanonicalValidator"
            && extendedSubject.Conditions.Count == 2
            && causal.Conditions.Count == 1
            && prepositionalPhrase.Status == "CanonicalValidator"
            && prepositionalPhrase.Phrase?.AllowedStartNodeSignatures
                .Contains("Terminal:P", StringComparer.Ordinal) == true
            && QuranicGrammarRuntime.SelfTest(report);
    }

    public static QuranicGrammarRuleContract GetCanonicalContract(
        string relation)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(relation);
        if (!QacSyntaxValidator.CanonicalRelationCodes.Contains(relation)
            || !QacSyntaxCatalog.DependencyRelations.TryGetValue(
                relation,
                out var definition))
        {
            throw new ArgumentException(
                $"Relation '{relation}' has no canonical validator contract.",
                nameof(relation));
        }

        return BuildContract(
            new QuranicGrammarRuleEvidence
            {
                RuleId =
                    $"QUR-QAC-REL-{definition.Code.ToUpperInvariant()}",
                Kind = "dependency-relation",
                QacCode = definition.Code,
                Family = definition.Family,
                Description = definition.Description,
                Source = QacSyntaxCatalog.RelationSource,
                EvidenceCount = 0,
                HasCanonicalValidatorContract = true,
            });
    }

    private static QuranicGrammarRuleContract BuildContract(
        QuranicGrammarRuleEvidence evidence)
    {
        if (!evidence.HasCanonicalValidatorContract)
        {
            return BaseContract(evidence, "EvidenceOnly");
        }

        var contract = BaseContract(evidence, "CanonicalValidator");
        if (evidence.Kind == "phrase")
        {
            return WithPhraseConstraints(
                contract,
                new QuranicGrammarPhraseConstraint
                {
                    RequiresResolvedContiguousSpan = true,
                    RequiresLaminarSpanSet = true,
                    AllowedStartNodeSignatures =
                        QacSyntaxValidator
                            .CanonicalPhraseStartSignatures[evidence.QacCode]
                            .Order(StringComparer.Ordinal)
                            .ToArray(),
                    AllowedEndNodeSignatures =
                        QacSyntaxValidator
                            .CanonicalPhraseEndSignatures[evidence.QacCode]
                            .Order(StringComparer.Ordinal)
                            .ToArray(),
                    RequiredMemberTags = evidence.QacCode == "VS"
                        ? ["V"]
                        : [],
                    AllowedParentRelations =
                        QacSyntaxValidator
                            .CanonicalPhraseParentRelations[evidence.QacCode]
                            .Order(StringComparer.Ordinal)
                            .ToArray(),
                    AllowedChildRelations =
                        QacSyntaxValidator
                            .CanonicalPhraseChildRelations[evidence.QacCode]
                            .Order(StringComparer.Ordinal)
                            .ToArray(),
                });
        }

        return evidence.QacCode switch
        {
            "amd" => WithConstraints(
                contract,
                null,
                Node(tags: ["AMD"])),
            "ans" => WithConstraints(
                contract,
                null,
                Node(tags: ["ANS"])),
            "app" => WithConstraints(
                contract,
                Node(tags:
                    QacSyntaxValidator.CanonicalNominalTags.Concat(
                        ["CS", "INTG", "NS", "PP", "S", "SC", "VS"])),
                Node(tags:
                    QacSyntaxValidator.CanonicalNominalTags.Concat(
                        ["CS", "INTG", "NS", "PP", "S", "SC", "VS"])),
                invariants:
                [
                    "dependent-after-head-when-ordered",
                    "nominal-case-agreement-when-marked",
                ]),
            "avr" => WithConstraints(
                contract,
                null,
                Node(tags: ["AVR"])),
            "adj" => WithConstraints(
                contract,
                Node(tags:
                    QacSyntaxValidator.CanonicalAdjectivalDependentTags.Concat(
                        ["CS", "NS", "S", "SC", "VS"])),
                Node(tags: QacSyntaxValidator.CanonicalNominalTags)),
            "poss" => WithConstraints(
                contract,
                CaseNode(
                    "GEN",
                    QacSyntaxValidator.CanonicalNominalTags.Concat(
                        ["CS", "NS", "S", "SC", "VS"])),
                Node(tags:
                    QacSyntaxValidator.CanonicalNominalTags.Concat(["INTG"])),
                exceptions:
                [
                    new QuranicGrammarContractException(
                        "QUR-EX-POSS-DUAL-OBLIQUE-SOURCE-CASE",
                        "QAC can annotate a dual as nominative although its observed ending is oblique; the runtime keeps the functional edge Unverified.",
                        new SortedDictionary<string, string>(
                            StringComparer.Ordinal)
                        {
                            ["dependent.case"] = "NOM",
                            ["dependent.number"] = "FD|MD",
                            ["dependent.surfaceEnding"] = "ين",
                        }),
                ],
                invariants: ["case-applies-only-to-overt-nominal"]),
            "cpnd" => WithConstraints(
                contract,
                CaseNode("ACC", ["N"]),
                CaseNode("ACC", ["N"])),
            "conj" => WithConstraints(
                contract,
                null,
                null,
                invariants:
                [
                    "dependent-after-head-when-ordered",
                    "nominal-case-agreement-when-marked",
                    "imperfect-mood-agreement",
                ]),
            "subj" => WithConstraints(
                contract,
                CaseNode(
                    "NOM",
                    QacSyntaxValidator.CanonicalNominalTags.Concat(
                        ["PP", "S", "SC"])),
                Node(tags: ["ADJ", "N", "V"]),
                invariants: ["case-applies-only-to-overt-nominal"]),
            "pass" => WithConstraints(
                contract,
                CaseNode(
                    "NOM",
                    QacSyntaxValidator.CanonicalNominalTags.Concat(
                        ["NS", "PP", "VS"])),
                Node(tags: ["N", "V"]),
                conditions:
                [
                    new QuranicGrammarConditionalConstraint(
                        "head",
                        "tag",
                        "V",
                        "head",
                        "voice",
                        "PASS"),
                ],
                invariants: ["case-applies-only-to-overt-nominal"]),
            "obj" => WithConstraints(
                contract,
                CaseNode(
                    "ACC",
                    QacSyntaxValidator.CanonicalNominalTags.Concat(
                        ["CS", "INTG", "NS", "PP", "S", "SC", "VS"])),
                Node(tags: ["N", "V"]),
                invariants: ["case-applies-only-to-overt-nominal"]),
            "gen" => WithConstraints(
                contract,
                CaseNode(
                    "GEN",
                    QacSyntaxValidator.CanonicalNominalTags.Concat(
                        ["ACC", "INTG", "SUB", "VS"])),
                Node(tags: ["P"]),
                invariants: ["case-applies-only-to-overt-nominal"]),
            "cond" => WithConstraints(
                contract,
                Node(tags: ["NS", "SC", "VS"]),
                Node(tags: ["COND", "REL", "T"])),
            "rslt" => WithConstraints(
                contract,
                Node(tags: ["CS", "NS", "S", "VS"]),
                Node(tags: ["COND", "REL", "T"])),
            "sub" => WithConstraints(
                contract,
                Node(tags: ["CS", "N", "NS", "S", "SC", "V", "VS"]),
                Node(tags: ["COND", "PRP", "REL", "SUB"])),
            "circ" => WithConstraints(
                contract,
                CaseNode(
                    "ACC",
                    QacSyntaxValidator.CanonicalNominalTags.Concat(
                        ["CS", "NS", "S", "SC", "VS"])),
                null,
                invariants:
                [
                    "case-applies-only-to-overt-nominal",
                    "terminal-implicit-or-clause-attachment-head",
                ]),
            "cog" or "prp" => WithConstraints(
                contract,
                CaseNode(
                    "ACC",
                    QacSyntaxValidator.CanonicalNominalTags.Concat(["SC"])),
                Node(tags:
                    QacSyntaxValidator.CanonicalNominalTags.Concat(["V"])),
                invariants: ["case-applies-only-to-overt-nominal"]),
            "com" => WithConstraints(
                contract,
                CaseNode("ACC", QacSyntaxValidator.CanonicalNominalTags),
                Node(tags: ["REL", "V"]),
                invariants: ["case-applies-only-to-overt-nominal"]),
            "spec" => WithConstraints(
                contract,
                CaseNode(
                    "ACC",
                    QacSyntaxValidator.CanonicalNominalTags.Concat(["PP"])),
                null,
                invariants: ["case-applies-only-to-overt-nominal"]),
            "caus" => WithConstraints(
                contract,
                Node(tags: ["CAUS", "REM"]),
                Node(tags: ["PRO", "V"]),
                conditions:
                [
                    new QuranicGrammarConditionalConstraint(
                        "head",
                        "aspect",
                        "IMPF",
                        "head",
                        "mood",
                        "SUBJ"),
                ],
                invariants:
                [
                    "subjunctive-condition-applies-to-CAUS-imperfect-only",
                ]),
            "cert" => WithConstraints(
                contract,
                null,
                Node(tags: ["CERT"])),
            "emph" => WithConstraints(
                contract,
                Node(tags:
                    QacSyntaxValidator.CanonicalNominalTags.Concat(
                        ["EMPH", "INTG", "NEG"])),
                null,
                invariants:
                [
                    "particle-or-nominal-emphasis-family",
                    "nominal-case-agreement-when-marked",
                ]),
            "eq" => WithConstraints(
                contract,
                Node(tags: ["V"]),
                Node(tags: ["EQ"])),
            "exh" => WithConstraints(
                contract,
                Node(tags: ["T", "V"]),
                Node(tags: ["EXH"])),
            "exl" => WithConstraints(
                contract,
                null,
                null,
                invariants:
                [
                    "one-oriented-endpoint-is-EXL",
                    "explanation-content-family",
                ]),
            "exp" => WithConstraints(
                contract,
                null,
                null,
                invariants:
                [
                    "at-least-one-endpoint-is-EXP-or-RES",
                    "exceptive-content-family",
                ]),
            "impv" => WithConstraints(
                contract,
                Node(tags: ["IMPV"]),
                Node(tags: ["V"], aspect: "IMPF", mood: "JUS")),
            "imrs" => WithConstraints(
                contract,
                Node(tags: ["NS", "VS"]),
                Node(tags: ["V"])),
            "inc" => WithConstraints(
                contract,
                null,
                Node(tags: ["INC"])),
            "int" => WithConstraints(
                contract,
                Node(tags: ["NS", "VS"]),
                Node(tags: ["INT"])),
            "intg" => WithConstraints(
                contract,
                null,
                Node(tags: ["INTG"])),
            "link" => WithConstraints(
                contract,
                Node(tags:
                [
                    "DEM", "INTG", "LOC", "N", "PP", "S", "SC", "T", "VOC",
                ]),
                Node(tags:
                [
                    "ADJ", "N", "NEG", "PP", "PRON", "T", "V", "VS",
                ]),
                invariants: ["attachment-dependent-and-head-families"]),
            "neg" => WithConstraints(
                contract,
                null,
                null,
                conditions:
                [
                    new QuranicGrammarConditionalConstraint(
                        "head",
                        "lemma",
                        "lam",
                        "dependent",
                        "mood",
                        "JUS"),
                    new QuranicGrammarConditionalConstraint(
                        "head",
                        "lemma",
                        "lan",
                        "dependent",
                        "mood",
                        "SUBJ"),
                ],
                invariants:
                [
                    "at-least-one-endpoint-is-NEG",
                    "content-after-negative-when-ordered",
                ]),
            "prev" => WithConstraints(
                contract,
                Node(tags: ["PREV"]),
                Node(tags: ["ACC", "P"])),
            "pro" => WithConstraints(
                contract,
                Node(tags: ["V"], aspect: "IMPF", mood: "JUS"),
                Node(tags: ["PRO"])),
            "res" => WithConstraints(
                contract,
                Node(tags: ["RES"]),
                null),
            "pred" => WithConstraints(
                contract,
                Node(tags:
                    QacSyntaxValidator.CanonicalNominalTags.Concat(
                        ["INTG", "NS", "PP", "SC", "VS"])),
                Node(tags:
                    QacSyntaxValidator.CanonicalNominalTags.Concat(
                        ["INTG", "PP", "SC"])),
                invariants:
                [
                    "nominal-predicate-family",
                    "marked-nominals-are-nominative",
                ]),
            "subjx" => WithConstraints(
                contract,
                Node(tags:
                    QacSyntaxValidator.CanonicalNominalTags.Concat(
                        ["INTG", "NS", "PP", "SC"])),
                Node(tags: ["ACC", "NEG", "V"]),
                conditions:
                [
                    new QuranicGrammarConditionalConstraint(
                        "head",
                        "tag",
                        "ACC",
                        "dependent",
                        "case",
                        "ACC"),
                    new QuranicGrammarConditionalConstraint(
                        "head",
                        "tag",
                        "V",
                        "dependent",
                        "case",
                        "NOM"),
                ]),
            "predx" => WithConstraints(
                contract,
                Node(tags:
                    QacSyntaxValidator.CanonicalNominalTags.Concat(
                        ["CS", "INTG", "NS", "PP", "SC", "VS"])),
                Node(tags: ["ACC", "NEG", "V"]),
                conditions:
                [
                    new QuranicGrammarConditionalConstraint(
                        "head",
                        "tag",
                        "ACC",
                        "dependent",
                        "case",
                        "NOM"),
                    new QuranicGrammarConditionalConstraint(
                        "head",
                        "tag",
                        "V",
                        "dependent",
                        "case",
                        "ACC"),
                    new QuranicGrammarConditionalConstraint(
                        "head",
                        "tag",
                        "NEG",
                        "dependent",
                        "case",
                        "ACC"),
                ]),
            "ret" => WithConstraints(
                contract,
                null,
                Node(tags: ["RET"])),
            "sup" => WithConstraints(
                contract,
                Node(tags: ["CONJ", "REM", "SUP"]),
                null),
            "sur" => WithConstraints(
                contract,
                Node(tags: ["N", "PRON"]),
                Node(tags: ["SUR"])),
            "fut" => WithConstraints(
                contract,
                Node(tags: ["FUT"]),
                Node(tags: ["V"], aspect: "IMPF")),
            "voc" => WithConstraints(
                contract,
                Node(tags: QacSyntaxValidator.CanonicalNominalTags),
                Node(tags: ["VOC"])),
            _ => throw new InvalidDataException(
                $"Canonical relation '{evidence.QacCode}' has no contract mapping."),
        };
    }

    private static QuranicGrammarRuleContract BaseContract(
        QuranicGrammarRuleEvidence evidence,
        string status) =>
        new()
        {
            RuleId = evidence.RuleId,
            Kind = evidence.Kind,
            QacCode = evidence.QacCode,
            Family = evidence.Family,
            Description = evidence.Description,
            Source = evidence.Source,
            Status = status,
            EvidenceCount = evidence.EvidenceCount,
            Direction = evidence.Kind == "dependency-relation"
                ? "dependent-to-head"
                : "contiguous-span",
            CorrectionPolicy = "None",
            IsNormativeForCns = false,
            CnsConsumptionPolicy = "ResearchMetadataOnly",
        };

    private static QuranicGrammarRuleContract WithConstraints(
        QuranicGrammarRuleContract source,
        QuranicGrammarNodeConstraint? dependent,
        QuranicGrammarNodeConstraint? head,
        IReadOnlyList<QuranicGrammarConditionalConstraint>? conditions = null,
        IReadOnlyList<QuranicGrammarContractException>? exceptions = null,
        IReadOnlyList<string>? invariants = null)
    {
        var diagnostics = new List<string> { "ADG-QS1201" };
        if (dependent?.RequiredCase is not null
            || head?.RequiredCase is not null)
        {
            diagnostics.Add("ADG-QS1202");
        }

        return new QuranicGrammarRuleContract
        {
            RuleId = source.RuleId,
            Kind = source.Kind,
            QacCode = source.QacCode,
            Family = source.Family,
            Description = source.Description,
            Source = source.Source,
            Status = source.Status,
            EvidenceCount = source.EvidenceCount,
            Direction = source.Direction,
            Dependent = dependent,
            Head = head,
            Conditions = conditions ?? [],
            Exceptions = exceptions ?? [],
            Invariants = invariants ?? [],
            ValidatorDiagnosticCodes = diagnostics,
            CorrectionPolicy = source.CorrectionPolicy,
            IsNormativeForCns = source.IsNormativeForCns,
            CnsConsumptionPolicy = source.CnsConsumptionPolicy,
        };
    }

    private static QuranicGrammarRuleContract WithPhraseConstraints(
        QuranicGrammarRuleContract source,
        QuranicGrammarPhraseConstraint phrase) =>
        new()
        {
            RuleId = source.RuleId,
            Kind = source.Kind,
            QacCode = source.QacCode,
            Family = source.Family,
            Description = source.Description,
            Source = source.Source,
            Status = source.Status,
            EvidenceCount = source.EvidenceCount,
            Direction = source.Direction,
            Phrase = phrase,
            ValidatorDiagnosticCodes =
            [
                "ADG-QS1005",
                "ADG-QS1008",
                "ADG-QS1009",
                "ADG-QS1203",
                "ADG-QS1204",
            ],
            CorrectionPolicy = source.CorrectionPolicy,
            IsNormativeForCns = source.IsNormativeForCns,
            CnsConsumptionPolicy = source.CnsConsumptionPolicy,
        };

    private static QuranicGrammarNodeConstraint CaseNode(
        string grammaticalCase,
        IEnumerable<string>? tags = null) =>
        Node(
            tags,
            grammaticalCase,
            allowUnmarkedCaseTags: UnmarkedCaseTags);

    private static QuranicGrammarNodeConstraint Node(
        IEnumerable<string>? tags = null,
        string? grammaticalCase = null,
        IEnumerable<string>? allowUnmarkedCaseTags = null,
        string? aspect = null,
        string? mood = null,
        string? voice = null) =>
        new()
        {
            AllowedTags = tags?
                .OrderBy(value => value, StringComparer.Ordinal)
                .ToArray() ?? [],
            RequiredCase = grammaticalCase,
            AllowUnmarkedCaseTags = allowUnmarkedCaseTags?
                .OrderBy(value => value, StringComparer.Ordinal)
                .ToArray() ?? [],
            RequiredAspect = aspect,
            RequiredMood = mood,
            RequiredVoice = voice,
        };

    private static string Canonicalize(QuranicGrammarRuleContract contract)
    {
        var builder = new StringBuilder();
        builder
            .Append(contract.RuleId).Append('\t')
            .Append(contract.Kind).Append('\t')
            .Append(contract.QacCode).Append('\t')
            .Append(contract.Family).Append('\t')
            .Append(contract.Description).Append('\t')
            .Append(contract.Source).Append('\t')
            .Append(contract.Status).Append('\t')
            .Append(contract.EvidenceCount).Append('\t')
            .Append(contract.Direction).Append('\t')
            .Append(contract.CorrectionPolicy).Append('\t')
            .Append(contract.IsNormativeForCns).Append('\t')
            .Append(contract.CnsConsumptionPolicy)
            .Append('\n');
        AppendNode(builder, "D", contract.Dependent);
        AppendNode(builder, "H", contract.Head);
        AppendPhrase(builder, contract.Phrase);
        foreach (var condition in contract.Conditions)
        {
            builder
                .Append("C\t")
                .Append(condition.IfNode).Append('\t')
                .Append(condition.IfFeature).Append('\t')
                .Append(condition.IfValue).Append('\t')
                .Append(condition.ThenNode).Append('\t')
                .Append(condition.RequiredFeature).Append('\t')
                .Append(condition.RequiredValue).Append('\n');
        }

        foreach (var exception in contract.Exceptions
                     .OrderBy(value => value.Code, StringComparer.Ordinal))
        {
            builder
                .Append("E\t")
                .Append(exception.Code).Append('\t')
                .Append(exception.Description).Append('\n');
            foreach (var pair in exception.Match
                         .OrderBy(value => value.Key, StringComparer.Ordinal))
            {
                builder
                    .Append("M\t")
                    .Append(pair.Key).Append('\t')
                    .Append(pair.Value).Append('\n');
            }
        }

        foreach (var invariant in contract.Invariants
                     .Order(StringComparer.Ordinal))
        {
            builder.Append("I\t").Append(invariant).Append('\n');
        }

        foreach (var code in contract.ValidatorDiagnosticCodes
                     .OrderBy(value => value, StringComparer.Ordinal))
        {
            builder.Append("V\t").Append(code).Append('\n');
        }

        return builder.ToString();
    }

    private static void AppendNode(
        StringBuilder builder,
        string prefix,
        QuranicGrammarNodeConstraint? node)
    {
        if (node is null)
        {
            return;
        }

        builder
            .Append(prefix).Append('\t')
            .Append(string.Join(",", node.AllowedTags)).Append('\t')
            .Append(node.RequiredCase ?? "-").Append('\t')
            .Append(string.Join(",", node.AllowUnmarkedCaseTags)).Append('\t')
            .Append(node.RequiredAspect ?? "-").Append('\t')
            .Append(node.RequiredMood ?? "-").Append('\t')
            .Append(node.RequiredVoice ?? "-").Append('\n');
    }

    private static void AppendPhrase(
        StringBuilder builder,
        QuranicGrammarPhraseConstraint? phrase)
    {
        if (phrase is null)
        {
            return;
        }

        builder
            .Append("P\t")
            .Append(phrase.RequiresResolvedContiguousSpan).Append('\t')
            .Append(phrase.RequiresLaminarSpanSet).Append('\t')
            .Append(string.Join(",", phrase.AllowedStartNodeSignatures))
            .Append('\t')
            .Append(string.Join(",", phrase.AllowedEndNodeSignatures))
            .Append('\t')
            .Append(string.Join(",", phrase.RequiredMemberTags))
            .Append('\t')
            .Append(string.Join(",", phrase.AllowedParentRelations))
            .Append('\t')
            .Append(string.Join(",", phrase.AllowedChildRelations))
            .Append('\n');
    }
}

public static class QuranicGrammarContractArtifactWriter
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    };

    public static QuranicGrammarContractArtifact WriteJsonLines(
        QuranicGrammarContractSetReport report,
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
            foreach (var contract in report.Contracts)
            {
                writer.WriteLine(JsonSerializer.Serialize(contract, JsonOptions));
            }
        }

        var bytes = File.ReadAllBytes(outputPath);
        return new QuranicGrammarContractArtifact
        {
            Path = outputPath,
            Bytes = bytes.LongLength,
            Sha256 = Convert.ToHexString(SHA256.HashData(bytes))
                .ToLowerInvariant(),
            ContractSetMerkleRoot = report.ContractSetMerkleRoot,
            ContractCount = report.ContractCount,
            CanonicalValidatorContractCount =
                report.CanonicalValidatorContractCount,
            EvidenceOnlyContractCount = report.EvidenceOnlyContractCount,
            NormativeForCnsContractCount =
                report.NormativeForCnsContractCount,
            IsComplete = report.IsComplete,
        };
    }
}
