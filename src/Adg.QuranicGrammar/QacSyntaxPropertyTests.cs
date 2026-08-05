using System.Security.Cryptography;
using System.Text;
using Adg.QuranicCore;
using Adg.QuranicCorpus;

namespace Adg.QuranicGrammar;

public sealed class QacSyntaxPropertyTestReport
{
    public long RelationCatalogTestCount { get; init; }

    public long PhraseCatalogTestCount { get; init; }

    public long MutationTestCount { get; init; }

    public long PassedTestCount { get; init; }

    public IReadOnlyList<string> Failures { get; init; } = [];

    public required string EvidenceMerkleRoot { get; init; }

    public bool IsValid =>
        RelationCatalogTestCount == QacSyntaxCatalog.DependencyRelations.Count
        && PhraseCatalogTestCount == QacSyntaxCatalog.PhraseTags.Count
        && Failures.Count == 0
        && PassedTestCount
            == RelationCatalogTestCount
                + PhraseCatalogTestCount
                + MutationTestCount;
}

public static class QacSyntaxPropertyTests
{
    public static QacSyntaxPropertyTestReport Run()
    {
        var failures = new List<string>();
        var evidence = new List<byte[]>();
        long passed = 0;
        long relationTests = 0;
        long phraseTests = 0;
        long mutationTests = 0;

        void Test(string name, Func<bool> predicate, TestKind kind)
        {
            bool result;
            string? error = null;
            try
            {
                result = predicate();
            }
            catch (Exception exception)
            {
                result = false;
                error = $"{exception.GetType().Name}:{exception.Message}";
            }

            switch (kind)
            {
                case TestKind.Relation:
                    relationTests++;
                    break;
                case TestKind.Phrase:
                    phraseTests++;
                    break;
                case TestKind.Mutation:
                    mutationTests++;
                    break;
                default:
                    throw new InvalidOperationException();
            }

            if (result)
            {
                passed++;
            }
            else
            {
                failures.Add(error is null ? name : $"{name}:{error}");
            }

            evidence.Add(
                SHA256.HashData(
                    Encoding.UTF8.GetBytes(
                        $"{kind}\t{name}\t{result}\t{error ?? string.Empty}")));
        }

        foreach (var relation in QacSyntaxCatalog.DependencyRelations.Keys
                     .Order(StringComparer.Ordinal))
        {
            Test(
                $"relation-catalog:{relation}",
                () => QacSyntaxValidator.Validate(
                    Graph(
                        [
                            Terminal("dependent", "N", 0),
                            Terminal("head", "V", 2),
                        ],
                        [new QacDependencyEdge("dependent", "head", relation)]),
                    QacSyntaxValidationProfile.Structural).IsValid,
                TestKind.Relation);
        }

        foreach (var phrase in QacSyntaxCatalog.PhraseTags.Keys
                     .Order(StringComparer.Ordinal))
        {
            Test(
                $"phrase-catalog:{phrase}",
                () => QacSyntaxValidator.Validate(
                    new QacDependencyGraph(
                        $"phrase-{phrase}",
                        [new QacSyntaxNode(
                            "phrase",
                            QacSyntaxNodeKind.Phrase,
                            phrase,
                            SpanStartTerminal: 0,
                            SpanEndTerminal: 0)],
                        []),
                    QacSyntaxValidationProfile.Structural).IsValid,
                TestKind.Phrase);
        }

        TestPhraseContract("CS", "COND", "N", "sub", "N", "V");
        TestPhraseContract("NS", "PRON", "N", "sub", "CAUS", "V");
        TestPhraseContract("PP", "P", "N", "link", "N", "V");
        TestPhraseContract("S", "VOC", "PRON", "link", "CAUS", "V");
        TestPhraseContract("SC", "SUB", "N", "link", "N", "V");
        TestPhraseContract("VS", "V", "PRON", "sub", "CAUS", "P");
        Test(
            "vs-phrase-without-verbal-member-rejected",
            () => HasError(
                Graph(
                    [
                        Terminal("start", "NEG", 0),
                        Terminal("end", "PRON", 2),
                        PhraseNode("phrase", "VS", 0, 1),
                    ],
                    []),
                "ADG-QS1203"),
            TestKind.Mutation);
        Test(
            "phrase-unresolved-boundary-rejected",
            () => HasError(
                Graph(
                    [
                        Terminal("start", "P", 0),
                        Terminal("end", "N", 2),
                        PhraseNode("phrase", "PP", 0, 2),
                    ],
                    []),
                "ADG-QS1008"),
            TestKind.Mutation);
        Test(
            "duplicate-phrase-interval-rejected",
            () => HasError(
                Graph(
                    [
                        Terminal("start", "P", 0),
                        Terminal("end", "N", 2),
                        PhraseNode("first", "PP", 0, 1),
                        PhraseNode("second", "PP", 0, 1),
                    ],
                    []),
                "ADG-QS1009"),
            TestKind.Mutation);
        Test(
            "crossing-phrase-interval-rejected",
            () => HasError(
                Graph(
                    [
                        Terminal("pp-start", "P", 0),
                        Terminal("sc-start", "SUB", 2),
                        Terminal("pp-end", "N", 4),
                        Terminal("sc-end", "N", 6),
                        PhraseNode("pp", "PP", 0, 2),
                        PhraseNode("sc", "SC", 1, 3),
                    ],
                    []),
                "ADG-QS1009"),
            TestKind.Mutation);

        Test(
            "unknown-relation-rejected",
            () => HasError(
                Graph(
                    [Terminal("a", "N", 0), Terminal("b", "V", 2)],
                    [new QacDependencyEdge("a", "b", "unknown")]),
                "ADG-QS1101"),
            TestKind.Mutation);
        Test(
            "missing-node-rejected",
            () => HasError(
                Graph(
                    [Terminal("a", "N", 0)],
                    [new QacDependencyEdge("a", "missing", "subj")]),
                "ADG-QS1102"),
            TestKind.Mutation);
        Test(
            "self-edge-rejected",
            () => HasError(
                Graph(
                    [Terminal("a", "N", 0)],
                    [new QacDependencyEdge("a", "a", "subj")]),
                "ADG-QS1103"),
            TestKind.Mutation);
        Test(
            "multi-head-rejected",
            () => HasError(
                Graph(
                    [
                        Terminal("a", "N", 0),
                        Terminal("b", "V", 2),
                        Terminal("c", "V", 4),
                    ],
                    [
                        new QacDependencyEdge("a", "b", "subj"),
                        new QacDependencyEdge("a", "c", "obj"),
                    ]),
                "ADG-QS1104"),
            TestKind.Mutation);
        Test(
            "cycle-rejected",
            () => HasError(
                Graph(
                    [Terminal("a", "N", 0), Terminal("b", "V", 2)],
                    [
                        new QacDependencyEdge("a", "b", "subj"),
                        new QacDependencyEdge("b", "a", "pred"),
                    ]),
                "ADG-QS1105"),
            TestKind.Mutation);
        Test(
            "duplicate-node-rejected",
            () => HasError(
                Graph(
                    [Terminal("a", "N", 0), Terminal("a", "N", 2)],
                    []),
                "ADG-QS1001"),
            TestKind.Mutation);
        Test(
            "invalid-phrase-interval-rejected",
            () => HasError(
                new QacDependencyGraph(
                    "invalid-phrase",
                    [new QacSyntaxNode(
                        "phrase",
                        QacSyntaxNodeKind.Phrase,
                        "S",
                        SpanStartTerminal: 2,
                        SpanEndTerminal: 1)],
                    []),
                "ADG-QS1005"),
            TestKind.Mutation);
        Test(
            "unknown-phrase-rejected",
            () => HasError(
                new QacDependencyGraph(
                    "unknown-phrase",
                    [new QacSyntaxNode(
                        "phrase",
                        QacSyntaxNodeKind.Phrase,
                        "UNKNOWN",
                        SpanStartTerminal: 0,
                        SpanEndTerminal: 0)],
                    []),
                "ADG-QS1003"),
            TestKind.Mutation);
        Test(
            "phrase-text-rejected",
            () => HasError(
                new QacDependencyGraph(
                    "phrase-text",
                    [new QacSyntaxNode(
                        "phrase",
                        QacSyntaxNodeKind.Phrase,
                        "S",
                        Text: "نص",
                        SpanStartTerminal: 0,
                        SpanEndTerminal: 0)],
                    []),
                "ADG-QS1004"),
            TestKind.Mutation);
        Test(
            "terminal-without-source-rejected",
            () => HasError(
                Graph(
                    [new QacSyntaxNode("a", QacSyntaxNodeKind.Terminal, "N")],
                    []),
                "ADG-QS1007"),
            TestKind.Mutation);
        Test(
            "det-terminal-rejected",
            () => HasError(
                Graph([Terminal("a", "DET", 0)], []),
                "ADG-QS1006"),
            TestKind.Mutation);
        Test(
            "hidden-source-rejected",
            () => HasError(
                Graph(
                    [new QacSyntaxNode(
                        "a",
                        QacSyntaxNodeKind.Hidden,
                        "PRON",
                        TextRange: new SourceRange(0, 1))],
                    []),
                "ADG-QS1008"),
            TestKind.Mutation);
        Test(
            "empty-text-rejected",
            () => HasError(
                Graph(
                    [new QacSyntaxNode(
                        "a",
                        QacSyntaxNodeKind.Empty,
                        "PRON",
                        Text: "هو")],
                    []),
                "ADG-QS1009"),
            TestKind.Mutation);

        TestCanonicalPair(
            "subj",
            Nominal("dependent", "NOM", 0),
            Verb("head", "IMPF", "IND", "ACT", 2),
            Nominal("bad", "ACC", 0),
            expectedError: "ADG-QS1202");
        TestCanonicalPair(
            "obj",
            Nominal("dependent", "ACC", 0),
            Verb("head", "PERF", null, "ACT", 2),
            Nominal("bad", "NOM", 0),
            expectedError: "ADG-QS1202");
        TestCanonicalPair(
            "gen",
            Nominal("dependent", "GEN", 0),
            Terminal("head", "P", 2),
            Nominal("bad", "NOM", 0),
            expectedError: "ADG-QS1202");
        TestCanonicalPair(
            "poss",
            Nominal("dependent", "GEN", 0),
            Nominal("head", "NOM", 2),
            Nominal("bad", "ACC", 0),
            expectedError: "ADG-QS1202");
        TestRelationContract(
            "amd",
            Terminal("dependent", "V", 0),
            Terminal("head", "AMD", 2),
            invalidHead: Terminal("bad-head", "N", 2));
        TestRelationContract(
            "ans",
            Terminal("dependent", "V", 0),
            Terminal("head", "ANS", 2),
            invalidHead: Terminal("bad-head", "N", 2));
        TestRelationContract(
            "avr",
            Terminal("dependent", "V", 0),
            Terminal("head", "AVR", 2),
            invalidHead: Terminal("bad-head", "N", 2));
        TestRelationContract(
            "cert",
            Terminal("dependent", "V", 0),
            Terminal("head", "CERT", 2),
            invalidHead: Terminal("bad-head", "N", 2));
        TestRelationContract(
            "cpnd",
            Nominal("dependent", "ACC", 2),
            Nominal("head", "ACC", 0),
            invalidDependent: Terminal("bad-dependent", "V", 0),
            invalidHead: Terminal("bad-head", "V", 2));
        TestPhraseRelationContract(
            "cond",
            "VS",
            "V",
            "PRON",
            Terminal("head", "COND", 2),
            invalidHead: Terminal("bad-head", "V", 2));
        TestRelationContract(
            "eq",
            Terminal("dependent", "V", 0),
            Terminal("head", "EQ", 2),
            invalidDependent: Terminal("bad-dependent", "N", 0),
            invalidHead: Terminal("bad-head", "N", 2));
        TestRelationContract(
            "exh",
            Terminal("dependent", "V", 0),
            Terminal("head", "EXH", 2),
            invalidDependent: Terminal("bad-dependent", "N", 0),
            invalidHead: Terminal("bad-head", "N", 2));
        TestPhraseRelationContract(
            "imrs",
            "VS",
            "V",
            "PRON",
            Terminal("head", "V", 2),
            invalidHead: Terminal("bad-head", "N", 2));
        TestPhraseRelationContract(
            "int",
            "NS",
            "PRON",
            "N",
            Terminal("head", "INT", 2),
            invalidHead: Terminal("bad-head", "N", 2));
        TestRelationContract(
            "intg",
            Terminal("dependent", "V", 0),
            Terminal("head", "INTG", 2),
            invalidHead: Terminal("bad-head", "N", 2));
        TestRelationContract(
            "prev",
            Terminal("dependent", "PREV", 0),
            Terminal("head", "ACC", 2),
            invalidDependent: Terminal("bad-dependent", "N", 0),
            invalidHead: Terminal("bad-head", "V", 2));
        TestRelationContract(
            "res",
            Terminal("dependent", "RES", 0),
            Terminal("head", "N", 2),
            invalidDependent: Terminal("bad-dependent", "N", 0));
        TestRelationContract(
            "ret",
            Terminal("dependent", "V", 0),
            Terminal("head", "RET", 2),
            invalidHead: Terminal("bad-head", "N", 2));
        TestPhraseRelationContract(
            "rslt",
            "NS",
            "PRON",
            "N",
            Terminal("head", "COND", 2),
            invalidHead: Terminal("bad-head", "V", 2));
        TestRelationContract(
            "voc",
            Terminal("dependent", "N", 0),
            Terminal("head", "VOC", 2),
            invalidDependent: Terminal("bad-dependent", "V", 0),
            invalidHead: Terminal("bad-head", "N", 2));
        TestRelationContract(
            "app",
            Nominal("dependent", "NOM", 2),
            Nominal("head", "NOM", 0),
            invalidDependent: Terminal("bad-dependent", "V", 2),
            invalidHead: Terminal("bad-head", "V", 0));
        Test(
            "app-case-agreement-rejected",
            () => HasError(
                CanonicalGraph(
                    "app",
                    Nominal("dependent", "ACC", 2),
                    Nominal("head", "NOM", 0)),
                "ADG-QS1202"),
            TestKind.Mutation);
        Test(
            "conj-ordered-valid",
            () => Canonical(
                "conj",
                Nominal("dependent", "GEN", 2),
                Nominal("head", "GEN", 0)).IsValid,
            TestKind.Mutation);
        Test(
            "conj-direction-reversal-rejected",
            () => HasError(
                CanonicalGraph(
                    "conj",
                    Nominal("dependent", "GEN", 0),
                    Nominal("head", "GEN", 2)),
                "ADG-QS1201"),
            TestKind.Mutation);
        Test(
            "conj-case-agreement-rejected",
            () => HasError(
                CanonicalGraph(
                    "conj",
                    Nominal("dependent", "ACC", 2),
                    Nominal("head", "NOM", 0)),
                "ADG-QS1202"),
            TestKind.Mutation);
        Test(
            "conj-mood-agreement-rejected",
            () => HasError(
                CanonicalGraph(
                    "conj",
                    Verb("dependent", "IMPF", "SUBJ", "ACT", 2),
                    Verb("head", "IMPF", "IND", "ACT", 0)),
                "ADG-QS1201"),
            TestKind.Mutation);
        TestRelationContract(
            "emph",
            Terminal("dependent", "EMPH", 0),
            Terminal("head", "V", 2),
            invalidDependent: Terminal("bad-dependent", "V", 0));
        TestRelationContract(
            "inc",
            Terminal("dependent", "V", 2),
            Terminal("head", "INC", 0),
            invalidHead: Terminal("bad-head", "N", 0));
        TestPhraseRelationContract(
            "link",
            "PP",
            "P",
            "N",
            Terminal("head", "V", 4),
            invalidHead: Terminal("bad-head", "ACC", 4));
        TestPhraseRelationContract(
            "sub",
            "VS",
            "V",
            "PRON",
            Terminal("head", "REL", 4),
            invalidHead: Terminal("bad-head", "V", 4));
        TestCanonicalPair(
            "subjx",
            Nominal("dependent", "ACC", 2),
            Terminal("head", "ACC", 0) with
            {
                Morphology = Morphology(
                    "ACC",
                    specialClass: "<in~"),
            },
            Nominal("bad", "NOM", 2),
            expectedError: "ADG-QS1202");
        TestCanonicalPair(
            "predx",
            Nominal("dependent", "NOM", 2),
            Terminal("head", "ACC", 0) with
            {
                Morphology = Morphology(
                    "ACC",
                    specialClass: "<in~"),
            },
            Nominal("bad", "ACC", 2),
            expectedError: "ADG-QS1202");
        Test(
            "pred-nominative-valid",
            () => Canonical(
                "pred",
                Nominal("dependent", "NOM", 2),
                Terminal("head", "PRON", 0)).IsValid,
            TestKind.Mutation);
        Test(
            "pred-nonnominative-rejected",
            () => HasError(
                CanonicalGraph(
                    "pred",
                    Nominal("dependent", "GEN", 2),
                    Terminal("head", "PRON", 0)),
                "ADG-QS1202"),
            TestKind.Mutation);
        Test(
            "neg-lam-jussive-valid",
            () => Canonical(
                "neg",
                Verb("dependent", "IMPF", "JUS", "ACT", 2),
                Terminal("head", "NEG", 0) with
                {
                    Morphology = Morphology(
                        "NEG",
                        lemma: "lam"),
                }).IsValid,
            TestKind.Mutation);
        Test(
            "neg-lam-indicative-rejected",
            () => HasError(
                CanonicalGraph(
                    "neg",
                    Verb("dependent", "IMPF", "IND", "ACT", 2),
                    Terminal("head", "NEG", 0) with
                    {
                        Morphology = Morphology(
                            "NEG",
                            lemma: "lam"),
                    }),
                "ADG-QS1201"),
            TestKind.Mutation);
        Test(
            "neg-without-negative-endpoint-rejected",
            () => HasError(
                CanonicalGraph(
                    "neg",
                    Verb("dependent", "IMPF", "IND", "ACT", 2),
                    Terminal("head", "PRO", 0)),
                "ADG-QS1201"),
            TestKind.Mutation);
        Test(
            "exl-content-dependent-valid",
            () => Canonical(
                "exl",
                Terminal("dependent", "COND", 2),
                Terminal("head", "EXL", 0)).IsValid,
            TestKind.Mutation);
        Test(
            "exl-particle-dependent-valid",
            () => Canonical(
                "exl",
                Terminal("dependent", "EXL", 0),
                Nominal("head", "NOM", 2)).IsValid,
            TestKind.Mutation);
        Test(
            "exl-without-explanation-endpoint-rejected",
            () => HasError(
                CanonicalGraph(
                    "exl",
                    Nominal("dependent", "NOM", 2),
                    Terminal("head", "V", 0)),
                "ADG-QS1201"),
            TestKind.Mutation);
        Test(
            "exp-content-dependent-valid",
            () => Canonical(
                "exp",
                Nominal("dependent", "ACC", 2),
                Terminal("head", "EXP", 0)).IsValid,
            TestKind.Mutation);
        Test(
            "exp-particle-dependent-valid",
            () => Canonical(
                "exp",
                Terminal("dependent", "EXP", 0),
                Nominal("head", "NOM", 2)).IsValid,
            TestKind.Mutation);
        Test(
            "exp-without-exceptive-endpoint-rejected",
            () => HasError(
                CanonicalGraph(
                    "exp",
                    Nominal("dependent", "NOM", 2),
                    Terminal("head", "V", 0)),
                "ADG-QS1201"),
            TestKind.Mutation);
        TestRelationContract(
            "sup",
            Terminal("dependent", "SUP", 0),
            Terminal("head", "V", 2),
            invalidDependent: Terminal("bad-dependent", "N", 0));
        TestRelationContract(
            "sur",
            Terminal("dependent", "PRON", 2),
            Terminal("head", "SUR", 0),
            invalidDependent: Terminal("bad-dependent", "V", 2),
            invalidHead: Terminal("bad-head", "N", 0));
        Test(
            "poss-dual-oblique-source-case-generalized",
            () => Canonical(
                "poss",
                DualNominal(
                    "dependent",
                    form: "rajulayoni",
                    grammaticalCase: "NOM",
                    start: 0),
                Nominal("head", "NOM", 2)).IsValid,
            TestKind.Mutation);
        Test(
            "poss-dual-nominative-surface-not-exempt",
            () => HasError(
                CanonicalGraph(
                    "poss",
                    DualNominal(
                        "dependent",
                        form: "rajulaAni",
                        grammaticalCase: "NOM",
                        start: 0),
                    Nominal("head", "NOM", 2)),
                "ADG-QS1202"),
            TestKind.Mutation);
        Test(
            "adj-relative-valid",
            () => Canonical(
                "adj",
                Terminal("dependent", "REL", 0),
                Nominal("head", "NOM", 2)).IsValid,
            TestKind.Mutation);
        Test(
            "adj-verbal-dependent-rejected",
            () => HasError(
                CanonicalGraph(
                    "adj",
                    Verb("dependent", "IMPF", "IND", "ACT", 0),
                    Nominal("head", "NOM", 2)),
                "ADG-QS1201"),
            TestKind.Mutation);

        Test(
            "pass-valid",
            () => Canonical(
                "pass",
                Nominal("dependent", "NOM", 0),
                Verb("head", "PERF", null, "PASS", 2)).IsValid,
            TestKind.Mutation);
        Test(
            "pass-active-rejected",
            () => HasError(
                CanonicalGraph(
                    "pass",
                    Nominal("dependent", "NOM", 0),
                    Verb("head", "PERF", null, "ACT", 2)),
                "ADG-QS1201"),
            TestKind.Mutation);

        Test(
            "caus-valid",
            () => Canonical(
                "caus",
                Terminal("dependent", "CAUS", 0),
                Verb("head", "IMPF", "SUBJ", "ACT", 2)).IsValid,
            TestKind.Mutation);
        Test(
            "caus-indicative-rejected",
            () => HasError(
                CanonicalGraph(
                    "caus",
                    Terminal("dependent", "CAUS", 0),
                    Verb("head", "IMPF", "IND", "ACT", 2)),
                "ADG-QS1201"),
            TestKind.Mutation);
        Test(
            "caus-perfect-valid",
            () => QacSyntaxValidator.Validate(
                CanonicalGraph(
                    "caus",
                    Terminal("dependent", "CAUS", 0),
                    Verb("head", "PERF", null, "ACT", 2))).IsValid,
            TestKind.Mutation);
        Test(
            "caus-reversed-rejected",
            () => HasError(
                CanonicalGraph(
                    "caus",
                    Verb("dependent", "IMPF", "SUBJ", "ACT", 0),
                    Terminal("head", "CAUS", 2)),
                "ADG-QS1201"),
            TestKind.Mutation);

        Test(
            "impv-valid",
            () => Canonical(
                "impv",
                Terminal("dependent", "IMPV", 0),
                Verb("head", "IMPF", "JUS", "ACT", 2)).IsValid,
            TestKind.Mutation);
        Test(
            "impv-indicative-rejected",
            () => HasError(
                CanonicalGraph(
                    "impv",
                    Terminal("dependent", "IMPV", 0),
                    Verb("head", "IMPF", "IND", "ACT", 2)),
                "ADG-QS1201"),
            TestKind.Mutation);

        Test(
            "pro-valid",
            () => Canonical(
                "pro",
                Verb("dependent", "IMPF", "JUS", "ACT", 0),
                Terminal("head", "PRO", 2)).IsValid,
            TestKind.Mutation);
        Test(
            "pro-indicative-rejected",
            () => HasError(
                CanonicalGraph(
                    "pro",
                    Verb("dependent", "IMPF", "IND", "ACT", 0),
                    Terminal("head", "PRO", 2)),
                "ADG-QS1201"),
            TestKind.Mutation);

        Test(
            "fut-valid",
            () => Canonical(
                "fut",
                Terminal("dependent", "FUT", 0),
                Verb("head", "IMPF", "IND", "ACT", 2)).IsValid,
            TestKind.Mutation);
        Test(
            "fut-perfect-rejected",
            () => HasError(
                CanonicalGraph(
                    "fut",
                    Terminal("dependent", "FUT", 0),
                    Verb("head", "PERF", null, "ACT", 2)),
                "ADG-QS1201"),
            TestKind.Mutation);

        foreach (var relation in new[] { "circ", "cog", "prp", "com", "spec" })
        {
            Test(
                $"{relation}-accusative-valid",
                () => Canonical(
                    relation,
                    Nominal("dependent", "ACC", 0),
                    relation == "spec"
                        ? Nominal("head", "NOM", 2)
                        : Verb("head", "PERF", null, "ACT", 2)).IsValid,
                TestKind.Mutation);
            Test(
                $"{relation}-nominative-rejected",
                () => HasError(
                    CanonicalGraph(
                        relation,
                        Nominal("dependent", "NOM", 0),
                        relation == "spec"
                            ? Nominal("head", "NOM", 2)
                            : Verb("head", "PERF", null, "ACT", 2)),
                    "ADG-QS1202"),
                TestKind.Mutation);
        }

        Test(
            "natural-clause-isolation",
            NaturalClauseIsolation,
            TestKind.Mutation);
        Test(
            "natural-heuristic-requires-explicit-opt-in",
            NaturalHeuristicRequiresExplicitOptIn,
            TestKind.Mutation);
        Test(
            "lexeme-allowlist-audit-replays",
            QuranicLexemeAllowlistAuditor.SelfTest,
            TestKind.Mutation);
        Test(
            "morphology-score-policy-replays",
            QacMorphologySelectionScorePolicy.SelfTest,
            TestKind.Mutation);
        Test(
            "runtime-constraint-discovery-correction-replays",
            QuranicGrammarContractCatalog.SelfTest,
            TestKind.Mutation);
        Test(
            "natural-phrase-generation",
            NaturalPhraseGeneration,
            TestKind.Mutation);
        Test(
            "heuristic-conditional-phrase-rejected",
            HeuristicConditionalPhraseRejected,
            TestKind.Mutation);
        Test(
            "conditional-temporal-allowlist",
            ConditionalTemporalAllowlist,
            TestKind.Mutation);
        Test(
            "conditional-host-skips-invalid-nearest",
            ConditionalHostSkipsInvalidNearest,
            TestKind.Mutation);
        Test(
            "passive-prescription-temporal-conditional",
            PassivePrescriptionTemporalConditional,
            TestKind.Mutation);
        Test(
            "passive-prescription-requires-following-in",
            PassivePrescriptionRequiresFollowingIn,
            TestKind.Mutation);
        Test(
            "kaan-verbal-predicate-nominal-phrase",
            KaanVerbalPredicateNominalPhrase,
            TestKind.Mutation);
        Test(
            "kaan-hidden-subject-nominal-phrase",
            KaanHiddenSubjectNominalPhrase,
            TestKind.Mutation);
        Test(
            "kaan-hidden-subject-requires-missing-subject",
            KaanHiddenSubjectRequiresMissingSubject,
            TestKind.Mutation);
        Test(
            "kaan-prepositional-predicate-nominal-phrase",
            KaanPrepositionalPredicateNominalPhrase,
            TestKind.Mutation);
        Test(
            "kaan-pp-predicate-requires-nominative-subject",
            KaanPpPredicateRequiresNominativeSubject,
            TestKind.Mutation);
        Test(
            "relative-pronoun-prepositional-predicate",
            RelativePronounPrepositionalPredicate,
            TestKind.Mutation);
        Test(
            "relative-predicate-requires-active-nominative",
            RelativePredicateRequiresActiveNominative,
            TestKind.Mutation);
        Test(
            "relative-pronoun-clitic-prepositional-predicate",
            RelativePronounCliticPrepositionalPredicate,
            TestKind.Mutation);
        Test(
            "prepositional-nominal-adjective-predicate",
            PrepositionalNominalAdjectivePredicate,
            TestKind.Mutation);
        Test(
            "prepositional-predicate-requires-adjective-agreement",
            PrepositionalPredicateRequiresAdjectiveAgreement,
            TestKind.Mutation);
        Test(
            "temporal-woe-prepositional-predicate",
            TemporalWoePrepositionalPredicate,
            TestKind.Mutation);
        Test(
            "temporal-woe-requires-attested-lemma",
            TemporalWoeRequiresAttestedLemma,
            TestKind.Mutation);
        Test(
            "temporal-face-participle-predicate",
            TemporalFaceParticiplePredicate,
            TestKind.Mutation);
        Test(
            "temporal-face-requires-face-lemma",
            TemporalFaceRequiresFaceLemma,
            TestKind.Mutation);
        Test(
            "interrogative-nominal-predicate",
            InterrogativeNominalPredicate,
            TestKind.Mutation);
        Test(
            "interrogative-predicate-requires-defined-nominative",
            InterrogativePredicateRequiresDefinedNominative,
            TestKind.Mutation);
        Test(
            "interposed-pp-nominal-predicate",
            InterposedPpNominalPredicate,
            TestKind.Mutation);
        Test(
            "interposed-pronominal-pp-nominal-predicate",
            InterposedPronominalPpNominalPredicate,
            TestKind.Mutation);
        Test(
            "interposed-pp-rejects-prepositional-pronoun-subject",
            InterposedPpRejectsPrepositionalPronounSubject,
            TestKind.Mutation);
        Test(
            "knowledge-interrogative-verbal-phrase",
            KnowledgeInterrogativeVerbalPhrase,
            TestKind.Mutation);
        Test(
            "standalone-vocative-sentence-valid",
            StandaloneVocativeSentenceValid,
            TestKind.Mutation);
        Test(
            "partial-vocative-sentence-unverified",
            PartialVocativeSentenceUnverified,
            TestKind.Mutation);
        Test(
            "restricted-pronoun-nominal-predicate",
            RestrictedPronounNominalPredicate,
            TestKind.Mutation);
        Test(
            "restricted-demonstrative-nominal-predicate",
            RestrictedDemonstrativeNominalPredicate,
            TestKind.Mutation);
        Test(
            "restricted-predicate-requires-genitive-complement",
            RestrictedPredicateRequiresGenitiveComplement,
            TestKind.Mutation);
        Test(
            "peace-prepositional-predicate",
            PeacePrepositionalPredicate,
            TestKind.Mutation);
        Test(
            "peace-predicate-requires-salaam-lemma",
            PeacePredicateRequiresSalaamLemma,
            TestKind.Mutation);
        Test(
            "audited-pronoun-nominal-predicate",
            () => AuditedPronounNominalPredicate("NOM", expected: true),
            TestKind.Mutation);
        Test(
            "audited-pronoun-predicate-requires-nominative",
            () => AuditedPronounNominalPredicate("ACC", expected: false),
            TestKind.Mutation);
        Test(
            "conjoined-lexical-nominal-predicate",
            () => ConjoinedLexicalNominalPredicate(
                "ganiY~",
                expected: true),
            TestKind.Mutation);
        Test(
            "conjoined-lexical-predicate-requires-attested-pair",
            () => ConjoinedLexicalNominalPredicate(
                "kariym",
                expected: false),
            TestKind.Mutation);
        Test(
            "relative-ma-does-not-authorize-extended-subject",
            () => RelativeMaPredicateSubject("2MS", expected: false),
            TestKind.Mutation);
        Test(
            "relative-ma-rejects-first-person-subject",
            () => RelativeMaPredicateSubject("1S", expected: false),
            TestKind.Mutation);
        Test(
            "inverted-peace-pronoun-predicate",
            () => InvertedPeacePronounPredicate(
                "sala`m",
                expected: true),
            TestKind.Mutation);
        Test(
            "inverted-peace-requires-salaam-lemma",
            () => InvertedPeacePronounPredicate(
                "qawol",
                expected: false),
            TestKind.Mutation);
        Test(
            "direct-woe-prepositional-predicate",
            () => DirectWoePrepositionalPredicate(
                "wayol",
                expected: true),
            TestKind.Mutation);
        Test(
            "direct-woe-predicate-requires-wayl-lemma",
            () => DirectWoePrepositionalPredicate(
                "qawol",
                expected: false),
            TestKind.Mutation);
        Test(
            "temporal-demonstrative-nominal-predicate",
            () => TemporalDemonstrativeNominalPredicate(
                "yawoma}i*",
                expected: true),
            TestKind.Mutation);
        Test(
            "temporal-demonstrative-requires-yawmaidh",
            () => TemporalDemonstrativeNominalPredicate(
                "yawom",
                expected: false),
            TestKind.Mutation);
        Test(
            "chained-relative-genitive-predicate",
            () => ChainedRelativeGenitivePredicate(
                "GEN",
                expected: true),
            TestKind.Mutation);
        Test(
            "chained-relative-requires-genitive-complements",
            () => ChainedRelativeGenitivePredicate(
                "ACC",
                expected: false),
            TestKind.Mutation);
        Test(
            "conjoined-divine-nominal-predicate",
            () => ConjoinedDivineNominalPredicate(
                "{ll~ah",
                expected: true),
            TestKind.Mutation);
        Test(
            "conjoined-divine-rejects-nondivine-proper-noun",
            () => ConjoinedDivineNominalPredicate(
                "zayod",
                expected: false),
            TestKind.Mutation);
        Test(
            "comparative-interrogative-nominal-predicate",
            () => ComparativeInterrogativeNominalPredicate(
                "NOM",
                expected: true),
            TestKind.Mutation);
        Test(
            "comparative-interrogative-requires-nominative",
            () => ComparativeInterrogativeNominalPredicate(
                "ACC",
                expected: false),
            TestKind.Mutation);
        Test(
            "interposed-clitic-pronoun-predicate",
            () => InterposedCliticPronounPredicate(
                includePreposition: true,
                expected: true),
            TestKind.Mutation);
        Test(
            "interposed-clitic-pronoun-requires-preposition",
            () => InterposedCliticPronounPredicate(
                includePreposition: false,
                expected: false),
            TestKind.Mutation);
        Test(
            "guarded-universal-nominal-predicate",
            () => GuardedUniversalNominalPredicate(
                includeAttachedPronoun: true,
                expected: true),
            TestKind.Mutation);
        Test(
            "guarded-universal-requires-attached-pronoun",
            () => GuardedUniversalNominalPredicate(
                includeAttachedPronoun: false,
                expected: false),
            TestKind.Mutation);
        Test(
            "night-of-decree-nominal-predicate",
            () => NightOfDecreeNominalPredicate(
                "ADJ",
                expected: true),
            TestKind.Mutation);
        Test(
            "night-of-decree-requires-adjectival-khayr",
            () => NightOfDecreeNominalPredicate(
                "N",
                expected: false),
            TestKind.Mutation);
        Test(
            "unverified-edge-preserves-structural-safety",
            () => QacSyntaxValidator.Validate(
                Graph(
                    [
                        Terminal("dependent", "N", 0) with
                        {
                            Morphology = Morphology("N"),
                        },
                        Verb("head", "PERF", null, "ACT", 2),
                    ],
                    [new QacDependencyEdge(
                        "dependent",
                        "head",
                        "subj",
                        IsVerified: false)])).IsValid,
            TestKind.Mutation);
        Test(
            "natural-replay-deterministic",
            NaturalReplayDeterministic,
            TestKind.Mutation);
        Test(
            "functional-diacritics-canonical-subject-object",
            FunctionalCanonicalSubjectObject,
            TestKind.Mutation);
        Test(
            "functional-diacritics-replaced-subject-mark-rejected",
            FunctionalReplacedSubjectMark,
            TestKind.Mutation);
        Test(
            "functional-diacritics-removed-object-mark-unverified",
            FunctionalRemovedObjectMark,
            TestKind.Mutation);
        Test(
            "functional-diacritics-canonical-genitive-possessive",
            FunctionalCanonicalGenitivePossessive,
            TestKind.Mutation);
        Test(
            "functional-diacritics-contract-case-mismatch-fails-closed",
            FunctionalContractCaseMismatchFailsClosed,
            TestKind.Mutation);
        Test(
            "functional-mutation-diagnostics-are-target-scoped",
            MutationDiagnosticsAreTargetScoped,
            TestKind.Mutation);
        Test(
            "functional-mutation-skips-unmarked-case-tags",
            MutationSkipsUnmarkedCaseTags,
            TestKind.Mutation);
        Test(
            "morphology-selection-prefers-surface-compatible-case",
            MorphologySelectionPrefersSurfaceCompatibleCase,
            TestKind.Mutation);
        Test(
            "morphology-selection-rejects-false-passive-subject",
            MorphologySelectionRejectsFalsePassiveSubject,
            TestKind.Mutation);
        Test(
            "surface-incompatible-morphology-is-unverified",
            SurfaceIncompatibleMorphologyIsUnverified,
            TestKind.Mutation);
        Test(
            "diacritic-comparison-rejects-duplicate-mark",
            DiacriticComparisonRejectsDuplicateMark,
            TestKind.Mutation);
        Test(
            "diacritic-comparison-rejects-reordered-marks",
            DiacriticComparisonRejectsReorderedMarks,
            TestKind.Mutation);
        Test(
            "deterministic-diacritizer-round-trip",
            DeterministicDiacritizerRoundTrip,
            TestKind.Mutation);
        Test(
            "deterministic-diacritizer-rejects-contradictory-mark",
            DeterministicDiacritizerRejectsContradictoryMark,
            TestKind.Mutation);
        Test(
            "deterministic-diacritizer-rejects-unstable-missing-scope",
            DeterministicDiacritizerRejectsUnstableMissingScope,
            TestKind.Mutation);

        return new QacSyntaxPropertyTestReport
        {
            RelationCatalogTestCount = relationTests,
            PhraseCatalogTestCount = phraseTests,
            MutationTestCount = mutationTests,
            PassedTestCount = passed,
            Failures = failures,
            EvidenceMerkleRoot = QacMerkle.ComputeRoot(evidence),
        };

        void TestCanonicalPair(
            string relation,
            QacSyntaxNode validDependent,
            QacSyntaxNode head,
            QacSyntaxNode invalidDependent,
            string expectedError)
        {
            Test(
                $"{relation}-valid",
                () => Canonical(relation, validDependent, head).IsValid,
                TestKind.Mutation);
            Test(
                $"{relation}-case-mutation-rejected",
                () => HasError(
                    CanonicalGraph(relation, invalidDependent, head),
                    expectedError),
                TestKind.Mutation);
            Test(
                $"{relation}-reversed-rejected",
                () => !QacSyntaxValidator.Validate(
                    CanonicalGraph(
                        relation,
                        head with { Id = "dependent", TextRange = new SourceRange(0, 1) },
                        validDependent with
                        {
                            Id = "head",
                            TextRange = new SourceRange(2, 1),
                        })).IsValid,
                TestKind.Mutation);
        }

        void TestPhraseContract(
            string phraseTag,
            string startTag,
            string endTag,
            string parentRelation,
            string invalidStartTag,
            string invalidEndTag)
        {
            Test(
                $"{phraseTag}-phrase-contract-valid",
                () => QacSyntaxValidator.Validate(
                    Graph(
                        [
                            Terminal("start", startTag, 0),
                            Terminal("end", endTag, 2),
                            PhraseNode("phrase", phraseTag, 0, 1),
                        ],
                        [])).IsValid,
                TestKind.Mutation);
            Test(
                $"{phraseTag}-phrase-start-boundary-rejected",
                () => HasError(
                    Graph(
                        [
                            Terminal("start", invalidStartTag, 0),
                            Terminal("end", endTag, 2),
                            PhraseNode("phrase", phraseTag, 0, 1),
                        ],
                        []),
                    "ADG-QS1203"),
                TestKind.Mutation);
            Test(
                $"{phraseTag}-phrase-end-boundary-rejected",
                () => HasError(
                    Graph(
                        [
                            Terminal("start", startTag, 0),
                            Terminal("end", invalidEndTag, 2),
                            PhraseNode("phrase", phraseTag, 0, 1),
                        ],
                        []),
                    "ADG-QS1203"),
                TestKind.Mutation);
            Test(
                $"{phraseTag}-phrase-parent-role-valid",
                () =>
                {
                    var headTag = parentRelation == "sub"
                        ? "REL"
                        : "V";
                    return QacSyntaxValidator.Validate(
                        Graph(
                            [
                                Terminal("start", startTag, 0),
                                Terminal("end", endTag, 2),
                                PhraseNode("phrase", phraseTag, 0, 1),
                                Terminal("head", headTag, 4),
                            ],
                            [
                                new QacDependencyEdge(
                                    "phrase",
                                    "head",
                                    parentRelation),
                            ])).IsValid;
                },
                TestKind.Mutation);
            Test(
                $"{phraseTag}-phrase-parent-role-rejected",
                () => HasError(
                    Graph(
                        [
                            Terminal("start", startTag, 0),
                            Terminal("end", endTag, 2),
                            PhraseNode("phrase", phraseTag, 0, 1),
                            Terminal("head", "AMD", 4),
                        ],
                        [new QacDependencyEdge("phrase", "head", "amd")]),
                    "ADG-QS1204"),
                TestKind.Mutation);
            Test(
                $"{phraseTag}-phrase-head-role-rejected",
                () => HasError(
                    Graph(
                        [
                            Terminal("start", startTag, 0),
                            Terminal("end", endTag, 2),
                            PhraseNode("phrase", phraseTag, 0, 1),
                            Terminal("dependent", "V", 4),
                        ],
                        [new QacDependencyEdge("dependent", "phrase", "amd")]),
                    "ADG-QS1204"),
                TestKind.Mutation);
        }

        void TestPhraseRelationContract(
            string relation,
            string phraseTag,
            string startTag,
            string endTag,
            QacSyntaxNode validHead,
            QacSyntaxNode invalidHead)
        {
            QacDependencyGraph PhraseRelationGraph(
                QacSyntaxNode head,
                bool usePhraseDependent = true,
                bool reverse = false)
            {
                var dependentId = usePhraseDependent
                    ? "dependent"
                    : "bad-dependent";
                var nodes = new List<QacSyntaxNode>
                {
                    Terminal("start", startTag, 0),
                    Terminal("end", endTag, 2),
                    PhraseNode("dependent", phraseTag, 0, 1),
                    head,
                };
                if (!usePhraseDependent)
                {
                    nodes.Add(Terminal("bad-dependent", "V", 6));
                }

                return Graph(
                    nodes,
                    [
                        reverse
                            ? new QacDependencyEdge(
                                head.Id,
                                dependentId,
                                relation)
                            : new QacDependencyEdge(
                                dependentId,
                                head.Id,
                                relation),
                    ]);
            }

            Test(
                $"{relation}-typed-contract-valid",
                () => QacSyntaxValidator.Validate(
                    PhraseRelationGraph(validHead)).IsValid,
                TestKind.Mutation);
            Test(
                $"{relation}-dependent-contract-rejected",
                () => HasError(
                    PhraseRelationGraph(
                        validHead,
                        usePhraseDependent: false),
                    "ADG-QS1201"),
                TestKind.Mutation);
            Test(
                $"{relation}-head-contract-rejected",
                () => HasError(
                    PhraseRelationGraph(invalidHead),
                    "ADG-QS1201"),
                TestKind.Mutation);
            Test(
                $"{relation}-typed-contract-reversed",
                () => !QacSyntaxValidator.Validate(
                    PhraseRelationGraph(validHead, reverse: true))
                    .IsValid,
                TestKind.Mutation);
        }

        void TestRelationContract(
            string relation,
            QacSyntaxNode validDependent,
            QacSyntaxNode validHead,
            QacSyntaxNode? invalidDependent = null,
            QacSyntaxNode? invalidHead = null)
        {
            Test(
                $"{relation}-typed-contract-valid",
                () => Canonical(
                    relation,
                    validDependent,
                    validHead).IsValid,
                TestKind.Mutation);
            if (invalidDependent is not null)
            {
                Test(
                    $"{relation}-dependent-contract-rejected",
                    () => HasError(
                        CanonicalGraph(
                            relation,
                            invalidDependent,
                            validHead),
                        "ADG-QS1201"),
                    TestKind.Mutation);
            }

            if (invalidHead is not null)
            {
                Test(
                    $"{relation}-head-contract-rejected",
                    () => HasError(
                        CanonicalGraph(
                            relation,
                            validDependent,
                            invalidHead),
                        "ADG-QS1201"),
                    TestKind.Mutation);
            }

            Test(
                $"{relation}-typed-contract-reversed",
                () => !QacSyntaxValidator.Validate(
                    CanonicalGraph(
                        relation,
                        validHead with { Id = "reversed-dependent" },
                        validDependent with { Id = "reversed-head" }))
                    .IsValid,
                TestKind.Mutation);
        }
    }

    private static bool FunctionalCanonicalSubjectObject()
    {
        var report = FunctionalValidation(
            FunctionalSubjectObjectRecords(),
            static text => text);
        return report.Status == QuranicFunctionalValidationStatus.Valid
            && report.TargetEdgeCount >= 2
            && report.VerifiedEdgeCount >= 2
            && report.Diagnostics.Count == 0;
    }

    private static bool FunctionalReplacedSubjectMark()
    {
        var records = FunctionalSubjectObjectRecords();
        var report = FunctionalValidation(
            records,
            text => ReplaceLastMark(
                text,
                Surface(records, 2),
                'ُ',
                'َ'));
        return report.Status == QuranicFunctionalValidationStatus.Invalid
            && report.Diagnostics.Any(diagnostic =>
                diagnostic.Code == "ADG-QUR2102"
                && diagnostic.Relation == "subj");
    }

    private static bool FunctionalRemovedObjectMark()
    {
        var records = FunctionalSubjectObjectRecords();
        var report = FunctionalValidation(
            records,
            text => RemoveLastMark(
                text,
                Surface(records, 3),
                'َ'));
        return report.Status == QuranicFunctionalValidationStatus.Unverified
            && report.Diagnostics.Any(diagnostic =>
                diagnostic.Code == "ADG-QUR2101"
                && diagnostic.Relation == "obj");
    }

    private static bool FunctionalCanonicalGenitivePossessive()
    {
        var report = FunctionalValidation(
            [
                SyntheticRecord(
                    1,
                    1,
                    "kataba",
                    "V",
                    QacSegmentKind.Stem,
                    "PERF",
                    "ACT",
                    "3MS",
                    "LEM:kataba",
                    "ROOT:ktb"),
                SyntheticRecord(
                    2,
                    1,
                    "rajulu",
                    "N",
                    QacSegmentKind.Stem,
                    "M",
                    "NOM",
                    "DEF",
                    "LEM:rajul",
                    "ROOT:rjl"),
                SyntheticRecord(
                    3,
                    1,
                    "fiy",
                    "P",
                    QacSegmentKind.Stem,
                    "LEM:fiy"),
                SyntheticRecord(
                    4,
                    1,
                    "bayoti",
                    "N",
                    QacSegmentKind.Stem,
                    "M",
                    "GEN",
                    "DEF",
                    "LEM:bayot",
                    "ROOT:byt"),
                SyntheticRecord(
                    5,
                    1,
                    "rajuli",
                    "N",
                    QacSegmentKind.Stem,
                    "M",
                    "GEN",
                    "DEF",
                    "LEM:rajul",
                    "ROOT:rjl"),
            ],
            static text => text);
        return report.Status == QuranicFunctionalValidationStatus.Valid
            && report.Diagnostics.Count == 0
            && report.TargetEdgeCount >= 2;
    }

    private static bool FunctionalContractCaseMismatchFailsClosed()
    {
        var records = FunctionalSubjectObjectRecords()
            .Select(record =>
                record.Location.Word == 2
                    ? record with { Form = "rajula" }
                    : record)
            .ToArray();
        var report = FunctionalValidation(records, static text => text);
        return report.Status == QuranicFunctionalValidationStatus.Unverified
            && report.Diagnostics.Any(diagnostic =>
                diagnostic.Code == "ADG-QUR2105"
                && diagnostic.Relation == "subj"
                && diagnostic.ExpectedCase == "NOM");
    }

    private static bool MutationDiagnosticsAreTargetScoped()
    {
        var target = new SourceRange(10, 3);
        var diagnostics = new[]
        {
            MutationDiagnostic(
                "ADG-QUR2101",
                "subj",
                new SourceRange(0, 3)),
            MutationDiagnostic("ADG-QUR2102", "subj", target),
            MutationDiagnostic("ADG-QUR2101", "obj", target),
            MutationDiagnostic("ADG-QUR2102", "subj", target),
        };
        return QuranicDiacriticMutationEvaluator
            .TargetDiagnosticCodes(diagnostics, "subj", target)
            .SequenceEqual(["ADG-QUR2102"], StringComparer.Ordinal);
    }

    private static bool MutationSkipsUnmarkedCaseTags()
    {
        var edge = new QacDependencyEdge("dependent", "head", "poss");
        return QuranicDiacriticMutationEvaluator.IsFunctionallySkipped(
                edge,
                Terminal("dependent", "PRON", 0))
            && !QuranicDiacriticMutationEvaluator.IsFunctionallySkipped(
                edge,
                Terminal("dependent", "N", 0));
    }

    private static QuranicFunctionalDiagnostic MutationDiagnostic(
        string code,
        string relation,
        SourceRange range) =>
        new(
            code,
            "property:test",
            relation,
            "property test diagnostic",
            range,
            "x",
            "NOM",
            null,
            [],
            [],
            [],
            null,
            "None");

    private static bool MorphologySelectionPrefersSurfaceCompatibleCase()
    {
        var records = new[]
        {
            SyntheticRecord(
                1,
                1,
                "qa`Sira`tu",
                "N",
                QacSegmentKind.Stem,
                "ACT",
                "PCPL",
                "FP",
                "GEN",
                "LEM:qa`Sira`t",
                "ROOT:qSr"),
            SyntheticRecord(
                2,
                1,
                "qa`Sira`tu",
                "N",
                QacSegmentKind.Stem,
                "ACT",
                "PCPL",
                "FP",
                "NOM",
                "LEM:qa`Sira`t",
                "ROOT:qSr"),
        };
        var lexicon = QacMorphologyLexicon.Build(
            records.OrderBy(record => record.Location));
        var parse = new QacDeterministicGrammarParser(
            lexicon,
            enableHeuristicFallback: false).Parse(
                lexicon.Words[0].ArabicSurface);
        return parse.SelectedAlternative.Selection
            .Single()
            .Candidate.Segments
            .Single(segment =>
                segment.SegmentKind == nameof(QacSegmentKind.Stem))
            .GrammaticalCase == "NOM";
    }

    private static bool MorphologySelectionRejectsFalsePassiveSubject()
    {
        var records = new[]
        {
            SyntheticRecord(
                1,
                1,
                "kita`biya",
                "N",
                QacSegmentKind.Stem,
                "M",
                "NOM",
                "LEM:kita`b",
                "ROOT:ktb"),
            SyntheticRecord(
                1,
                2,
                "ho",
                "PRON",
                QacSegmentKind.Suffix,
                "PRON:3MS"),
            SyntheticRecord(
                2,
                1,
                "kita`bi",
                "N",
                QacSegmentKind.Stem,
                "M",
                "ACC",
                "LEM:kita`b",
                "ROOT:ktb"),
            SyntheticRecord(
                2,
                2,
                "yaho",
                "PRON",
                QacSegmentKind.Suffix,
                "PRON:1S"),
        };
        var lexicon = QacMorphologyLexicon.Build(
            records.OrderBy(record => record.Location));
        var parse = new QacDeterministicGrammarParser(
            lexicon,
            enableHeuristicFallback: false).Parse(
                lexicon.Words[0].ArabicSurface);
        var selected = parse.SelectedAlternative.Selection.Single();
        return selected.Candidate.Segments.Any(segment =>
                segment.GrammaticalCase == "ACC")
            && selected.Candidate.Segments.Any(segment =>
                segment.AttachedPronoun == "1S");
    }

    private static bool SurfaceIncompatibleMorphologyIsUnverified()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    1,
                    1,
                    "Einda",
                    "LOC",
                    QacSegmentKind.Stem,
                    "ACC",
                    "LEM:Eind",
                    "ROOT:End"),
                SyntheticRecord(
                    2,
                    1,
                    "qa`Sira`tu",
                    "N",
                    QacSegmentKind.Stem,
                    "ACT",
                    "PCPL",
                    "FP",
                    "GEN",
                    "LEM:qa`Sira`t",
                    "ROOT:qSr"),
            ]);
        return parse.Status == QacGrammarStatus.Unverified
            && parse.Diagnostics.Any(diagnostic =>
                diagnostic.Code == "ADG-QC2004")
            && parse.Graph.Edges.Any(edge =>
                edge.Relation == "poss"
                && !edge.IsVerified);
    }

    private static bool DiacriticComparisonRejectsDuplicateMark()
    {
        var comparison = QuranicDiacriticAnalyzer.Compare(
            QuranicDiacriticAnalyzer.Analyze("بّّ"),
            QuranicDiacriticAnalyzer.Analyze("بُّ"));
        return !comparison.IsEquivalent
            && !comparison.IsMissingOnly
            && comparison.UnexpectedMarks.Count == 1
            && comparison.MissingMarks.Count == 1;
    }

    private static bool DiacriticComparisonRejectsReorderedMarks()
    {
        var comparison = QuranicDiacriticAnalyzer.Compare(
            QuranicDiacriticAnalyzer.Analyze("بُّ"),
            QuranicDiacriticAnalyzer.Analyze("بُّ"));
        return !comparison.IsEquivalent
            && !comparison.IsMissingOnly
            && comparison.HasOrderMismatch;
    }

    private static bool DeterministicDiacritizerRoundTrip()
    {
        var records = FunctionalSubjectObjectRecords();
        var lexicon = QacMorphologyLexicon.Build(
            records.OrderBy(record => record.Location));
        var canonical = string.Join(
            " ",
            lexicon.Words.Select(word => word.ArabicSurface));
        var diacritizer = new QuranicDeterministicDiacritizer(lexicon);
        var scoped = diacritizer.StripReconstructableMarks(canonical);
        var report = diacritizer.Diacritize(scoped.StrippedText);
        return scoped.UnitCount >= 2
            && scoped.StrippedText != canonical
            && report.IsValid
            && report.AppliedEditCount == scoped.UnitCount
            && report.OutputText == canonical
            && report.GraphEquivalent
            && report.InputFingerprint.CombinedMerkleRoot
                == report.OutputFingerprint.CombinedMerkleRoot;
    }

    private static bool DeterministicDiacritizerRejectsContradictoryMark()
    {
        var records = FunctionalSubjectObjectRecords();
        var lexicon = QacMorphologyLexicon.Build(
            records.OrderBy(record => record.Location));
        var canonical = string.Join(
            " ",
            lexicon.Words.Select(word => word.ArabicSurface));
        var mutated = ReplaceLastMark(
            canonical,
            Surface(records, 2),
            'ُ',
            'َ');
        var report =
            new QuranicDeterministicDiacritizer(lexicon)
                .Diacritize(mutated);
        return report.Status == QuranicDiacritizationStatus.Invalid
            && report.AppliedEditCount == 0
            && report.OutputText == mutated
            && report.Diagnostics.Any(diagnostic =>
                diagnostic.Code == "ADG-QUR2206");
    }

    private static bool DeterministicDiacritizerRejectsUnstableMissingScope()
    {
        var records = FunctionalSubjectObjectRecords();
        var lexicon = QacMorphologyLexicon.Build(
            records.OrderBy(record => record.Location));
        var canonical = string.Join(
            " ",
            lexicon.Words.Select(word => word.ArabicSurface));
        var verb = Surface(records, 1);
        var strippedVerb =
            QuranicDiacriticAnalyzer.StripSignificantMarks(verb);
        var input = canonical.Replace(
            verb,
            strippedVerb,
            StringComparison.Ordinal);
        var report =
            new QuranicDeterministicDiacritizer(lexicon)
                .Diacritize(input);
        return report.Status == QuranicDiacritizationStatus.Unverified
            && report.AppliedEditCount == 0
            && report.OutputText == input
            && report.Diagnostics.Any(diagnostic =>
                diagnostic.Code == "ADG-QUR2207");
    }

    private static IReadOnlyList<QacMorphologyRecord>
        FunctionalSubjectObjectRecords() =>
        [
            SyntheticRecord(
                1,
                1,
                "kataba",
                "V",
                QacSegmentKind.Stem,
                "PERF",
                "ACT",
                "3MS",
                "LEM:kataba",
                "ROOT:ktb"),
            SyntheticRecord(
                2,
                1,
                "rajulu",
                "N",
                QacSegmentKind.Stem,
                "M",
                "NOM",
                "DEF",
                "LEM:rajul",
                "ROOT:rjl"),
            SyntheticRecord(
                3,
                1,
                "darosa",
                "N",
                QacSegmentKind.Stem,
                "M",
                "ACC",
                "DEF",
                "LEM:daros",
                "ROOT:drs"),
        ];

    private static QuranicFunctionalValidationReport FunctionalValidation(
        IReadOnlyList<QacMorphologyRecord> records,
        Func<string, string> mutate)
    {
        var ordered = records
            .OrderBy(record => record.Location)
            .ToArray();
        var lexicon = QacMorphologyLexicon.Build(ordered);
        var canonical = string.Join(
            " ",
            lexicon.Words.Select(word => word.ArabicSurface));
        var parser = new QacDeterministicGrammarParser(
            lexicon,
            enableHeuristicFallback: false);
        var parse = parser.Parse(mutate(canonical));
        return new QuranicFunctionalDiacriticValidator(
            QacDiacriticEvidenceIndex.Build(lexicon)).Validate(parse);
    }

    private static string Surface(
        IReadOnlyList<QacMorphologyRecord> records,
        int word) =>
        string.Concat(
            records
                .Where(record => record.Location.Word == word)
                .OrderBy(record => record.Location.Segment)
                .Select(record => ExtendedBuckwalter.Decode(record.Form)));

    private static string ReplaceLastMark(
        string text,
        string surface,
        char expected,
        char replacement)
    {
        var surfaceIndex = text.IndexOf(surface, StringComparison.Ordinal);
        var markIndex = surface.LastIndexOf(expected);
        if (surfaceIndex < 0 || markIndex < 0)
        {
            return text;
        }

        var absolute = surfaceIndex + markIndex;
        return text[..absolute] + replacement + text[(absolute + 1)..];
    }

    private static string RemoveLastMark(
        string text,
        string surface,
        char mark)
    {
        var surfaceIndex = text.IndexOf(surface, StringComparison.Ordinal);
        var markIndex = surface.LastIndexOf(mark);
        if (surfaceIndex < 0 || markIndex < 0)
        {
            return text;
        }

        var absolute = surfaceIndex + markIndex;
        return text[..absolute] + text[(absolute + 1)..];
    }

    private static bool NaturalClauseIsolation()
    {
        var parser = new QacDeterministicGrammarParser(
            QacMorphologyLexicon.Build([]),
            enableHeuristicFallback: true);
        const string text = "قال الرجل. ذكر الولد";
        var parse = parser.Parse(text);
        var boundary = text.IndexOf('.', StringComparison.Ordinal);
        var nodes = parse.Graph.Nodes.ToDictionary(node => node.Id);
        return parse.Validation.IsValid
            && parse.Validation.UnverifiedEdgeCount > 0
            && parse.Graph.Edges.All(edge =>
            {
                var dependent = nodes[edge.DependentId].TextRange;
                var head = nodes[edge.HeadId].TextRange;
                if (dependent is null || head is null)
                {
                    return true;
                }

                return (dependent.Start < boundary) == (head.Start < boundary);
            });
    }

    private static bool NaturalHeuristicRequiresExplicitOptIn()
    {
        var lexicon = QacMorphologyLexicon.Build([]);
        var defaultParse =
            new QacDeterministicGrammarParser(lexicon).Parse("قال");
        var optInParse = new QacDeterministicGrammarParser(
            lexicon,
            enableHeuristicFallback: true).Parse("قال");
        return defaultParse.Morphology.Units.Count == 1
            && defaultParse.Morphology.Units[0].Candidates.Count == 0
            && optInParse.SelectedAlternative.Selection.Any(selection =>
                selection.Source == QacMorphologyCandidateSource.Heuristic)
            && optInParse.Status == QacGrammarStatus.Unverified;
    }

    private static bool NaturalReplayDeterministic()
    {
        var parser = new QacDeterministicGrammarParser(
            QacMorphologyLexicon.Build([]),
            enableHeuristicFallback: true);
        const string text = "قال الرجل. ذكر الولد";
        var first = parser.Parse(text);
        var second = parser.Parse(text);
        return first.Status == second.Status
            && first.SelectedAlternative.Signature
                == second.SelectedAlternative.Signature
            && first.Graph.Nodes.Select(NodeSignature)
                .SequenceEqual(second.Graph.Nodes.Select(NodeSignature))
            && first.Graph.Edges.SequenceEqual(second.Graph.Edges);
    }

    private static bool NaturalPhraseGeneration()
    {
        var parser = new QacDeterministicGrammarParser(
            QacMorphologyLexicon.Build([]),
            enableHeuristicFallback: true);
        var verbal = parser.Parse("قال الرجل");
        var prepositional = parser.Parse("في البيت");
        return verbal.Validation.IsValid
            && prepositional.Validation.IsValid
            && verbal.Graph.Nodes.Any(node =>
                node.Kind == QacSyntaxNodeKind.Phrase
                && node.Tag == "VS")
            && prepositional.Graph.Nodes.Any(node =>
                node.Kind == QacSyntaxNodeKind.Phrase
                && node.Tag == "PP")
            && verbal.Graph.Nodes
                .Concat(prepositional.Graph.Nodes)
                .Where(node => node.Kind == QacSyntaxNodeKind.Phrase)
                .All(node =>
                    node.SpanStartTerminal is not null
                    && node.SpanEndTerminal >= node.SpanStartTerminal);
    }

    private static bool HeuristicConditionalPhraseRejected()
    {
        var (parser, text) = SyntheticParser(
            RelativeConditionalRecords(
                markerForm: "law",
                markerTag: "COND",
                markerLemma: "law"),
            enableHeuristicFallback: true);
        var verified = parser.Parse(text);
        var mixed = parser.Parse($"{text}. كتاب");
        return HasPhrase(verified, "CS")
            && mixed.SelectedAlternative.Selection.Any(selection =>
                selection.Source == QacMorphologyCandidateSource.Heuristic)
            && !HasPhrase(mixed, "CS");
    }

    private static bool ConditionalTemporalAllowlist()
    {
        var (_, allowedText, allowed) = SyntheticParse(
            RelativeConditionalRecords(
                markerForm: "<i*aA",
                markerTag: "T",
                markerLemma: "<i*aA"));
        var (_, blockedText, blocked) = SyntheticParse(
            RelativeConditionalRecords(
                markerForm: "yawom",
                markerTag: "T",
                markerLemma: "yawom"));
        return allowedText.Length > 0
            && blockedText.Length > 0
            && HasPhrase(allowed, "CS")
            && !HasPhrase(blocked, "CS");
    }

    private static bool ConditionalHostSkipsInvalidNearest()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "qaAl",
                    tag: "V",
                    QacSegmentKind.Stem,
                    "PERF",
                    "3MS",
                    "LEM:qaAla",
                    "ROOT:qwl"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "raA",
                    tag: "V",
                    QacSegmentKind.Stem,
                    "PERF",
                    "3MS",
                    "LEM:ra>aY",
                    "ROOT:rAy"),
                SyntheticRecord(
                    word: 3,
                    segment: 1,
                    form: "maA",
                    tag: "COND",
                    QacSegmentKind.Stem,
                    "LEM:mahomaA"),
                SyntheticRecord(
                    word: 4,
                    segment: 1,
                    form: "yak*ib",
                    tag: "V",
                    QacSegmentKind.Stem,
                    "IMPF",
                    "MOOD:IND",
                    "3MP",
                    "LEM:ka*aba",
                    "ROOT:k*b"),
                SyntheticRecord(
                    word: 4,
                    segment: 2,
                    form: "wna",
                    tag: "PRON",
                    QacSegmentKind.Suffix,
                    "PRON:3MP"),
            ]);
        return parse.Validation.IsValid
            && HasPhrase(parse, "CS");
    }

    private static bool PassivePrescriptionTemporalConditional()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "kutiba",
                    tag: "V",
                    QacSegmentKind.Stem,
                    "PERF",
                    "PASS",
                    "3MS",
                    "LEM:kataba",
                    "ROOT:ktb"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "EalaY",
                    tag: "P",
                    QacSegmentKind.Stem,
                    "LEM:EalaY`"),
                SyntheticRecord(
                    word: 2,
                    segment: 2,
                    form: "kum",
                    tag: "PRON",
                    QacSegmentKind.Suffix,
                    "PRON:2MP"),
                SyntheticRecord(
                    word: 3,
                    segment: 1,
                    form: "<i*aA",
                    tag: "T",
                    QacSegmentKind.Stem,
                    "LEM:<i*aA"),
                SyntheticRecord(
                    word: 4,
                    segment: 1,
                    form: "HaDara",
                    tag: "V",
                    QacSegmentKind.Stem,
                    "PERF",
                    "3MS",
                    "LEM:HaDara",
                    "ROOT:HDr"),
                SyntheticRecord(
                    word: 5,
                    segment: 1,
                    form: "xayor",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "ACC",
                    "INDEF",
                    "LEM:xayor",
                    "ROOT:xyr"),
                SyntheticRecord(
                    word: 5,
                    segment: 2,
                    form: "hu",
                    tag: "PRON",
                    QacSegmentKind.Suffix,
                    "PRON:3MS"),
                SyntheticRecord(
                    word: 6,
                    segment: 1,
                    form: "mawot",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "DEF",
                    "LEM:mawot",
                    "ROOT:mwt"),
                SyntheticRecord(
                    word: 7,
                    segment: 1,
                    form: "<in",
                    tag: "COND",
                    QacSegmentKind.Stem,
                    "LEM:<in"),
            ]);
        return parse.Validation.IsValid
            && HasPhrase(parse, "CS");
    }

    private static bool PassivePrescriptionRequiresFollowingIn()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "kutiba",
                    tag: "V",
                    QacSegmentKind.Stem,
                    "PERF",
                    "PASS",
                    "3MS",
                    "LEM:kataba",
                    "ROOT:ktb"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "EalaY",
                    tag: "P",
                    QacSegmentKind.Stem,
                    "LEM:EalaY`"),
                SyntheticRecord(
                    word: 2,
                    segment: 2,
                    form: "kum",
                    tag: "PRON",
                    QacSegmentKind.Suffix,
                    "PRON:2MP"),
                SyntheticRecord(
                    word: 3,
                    segment: 1,
                    form: "<i*aA",
                    tag: "T",
                    QacSegmentKind.Stem,
                    "LEM:<i*aA"),
                SyntheticRecord(
                    word: 4,
                    segment: 1,
                    form: "HaDara",
                    tag: "V",
                    QacSegmentKind.Stem,
                    "PERF",
                    "3MS",
                    "LEM:HaDara",
                    "ROOT:HDr"),
                SyntheticRecord(
                    word: 5,
                    segment: 1,
                    form: "xayor",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "ACC",
                    "INDEF",
                    "LEM:xayor",
                    "ROOT:xyr"),
                SyntheticRecord(
                    word: 5,
                    segment: 2,
                    form: "hu",
                    tag: "PRON",
                    QacSegmentKind.Suffix,
                    "PRON:3MS"),
                SyntheticRecord(
                    word: 6,
                    segment: 1,
                    form: "mawot",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "DEF",
                    "LEM:mawot",
                    "ROOT:mwt"),
                SyntheticRecord(
                    word: 7,
                    segment: 1,
                    form: ">an",
                    tag: "SUB",
                    QacSegmentKind.Stem,
                    "LEM:>an"),
            ]);
        return parse.Validation.IsValid
            && !HasPhrase(parse, "CS");
    }

    private static bool KaanVerbalPredicateNominalPhrase()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "kaAn",
                    tag: "V",
                    QacSegmentKind.Stem,
                    "PERF",
                    "3MP",
                    "LEM:kaAna",
                    "ROOT:kwn",
                    "SP:kaAn"),
                SyntheticRecord(
                    word: 1,
                    segment: 2,
                    form: "uwA",
                    tag: "PRON",
                    QacSegmentKind.Suffix,
                    "PRON:3MP"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "yak*ib",
                    tag: "V",
                    QacSegmentKind.Stem,
                    "IMPF",
                    "MOOD:IND",
                    "3MP",
                    "LEM:ka*aba",
                    "ROOT:k*b"),
                SyntheticRecord(
                    word: 2,
                    segment: 2,
                    form: "wna",
                    tag: "PRON",
                    QacSegmentKind.Suffix,
                    "PRON:3MP"),
            ]);
        return parse.Validation.IsValid
            && HasPhrase(parse, "VS")
            && HasNominalPhraseBoundary(parse, "kaAn", "PRON");
    }

    private static bool KaanHiddenSubjectNominalPhrase()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "kaAn",
                    tag: "V",
                    QacSegmentKind.Stem,
                    "PERF",
                    "3MS",
                    "LEM:kaAna",
                    "ROOT:kwn",
                    "SP:kaAn"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "Huwob",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "ACC",
                    "INDEF",
                    "LEM:Huwb",
                    "ROOT:Hwb"),
                SyntheticRecord(
                    word: 3,
                    segment: 1,
                    form: "kabiyr",
                    tag: "ADJ",
                    QacSegmentKind.Stem,
                    "ACC",
                    "INDEF",
                    "LEM:kabiyr",
                    "ROOT:kbr"),
            ]);
        var nodes = parse.Graph.Nodes.ToDictionary(node => node.Id);
        var special = parse.Graph.Nodes.Single(node =>
            node.Kind == QacSyntaxNodeKind.Terminal
            && node.Morphology?.SpecialClass == "kaAn");
        return EnsureValid(parse)
            && parse.Graph.Edges.Any(edge =>
                edge.HeadId == special.Id
                && edge.Relation == "subjx"
                && edge.IsVerified
                && nodes[edge.DependentId].Kind == QacSyntaxNodeKind.Hidden)
            && HasNominalPhraseBoundary(parse, "kaAn", "ADJ");
    }

    private static bool KaanHiddenSubjectRequiresMissingSubject()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "kaAn",
                    tag: "V",
                    QacSegmentKind.Stem,
                    "PERF",
                    "3MS",
                    "LEM:kaAna",
                    "ROOT:kwn",
                    "SP:kaAn"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "rajul",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "DEF",
                    "LEM:rajul",
                    "ROOT:rjl"),
                SyntheticRecord(
                    word: 3,
                    segment: 1,
                    form: "kabiyr",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "ACC",
                    "INDEF",
                    "LEM:kabiyr",
                    "ROOT:kbr"),
            ]);
        return EnsureValid(parse)
            && !parse.Graph.Nodes.Any(node =>
                node.Kind == QacSyntaxNodeKind.Hidden
                && node.Tag == "PRON"
                && node.Text == "implicit-subject");
    }

    private static bool KaanPrepositionalPredicateNominalPhrase()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "kaAn",
                    tag: "V",
                    QacSegmentKind.Stem,
                    "PERF",
                    "3MS",
                    "LEM:kaAna",
                    "ROOT:kwn",
                    "SP:kaAn"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "la",
                    tag: "P",
                    QacSegmentKind.Stem,
                    "LEM:l"),
                SyntheticRecord(
                    word: 2,
                    segment: 2,
                    form: "hu",
                    tag: "PRON",
                    QacSegmentKind.Suffix,
                    "PRON:3MS"),
                SyntheticRecord(
                    word: 3,
                    segment: 1,
                    form: "walad",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "INDEF",
                    "LEM:walad",
                    "ROOT:wld"),
            ]);
        var nodes = parse.Graph.Nodes.ToDictionary(node => node.Id);
        var special = parse.Graph.Nodes.Single(node =>
            node.Kind == QacSyntaxNodeKind.Terminal
            && node.Morphology?.SpecialClass == "kaAn");
        return EnsureValid(parse)
            && parse.Graph.Edges.Any(edge =>
                edge.HeadId == special.Id
                && edge.Relation == "predx"
                && edge.IsVerified
                && nodes[edge.DependentId].Kind == QacSyntaxNodeKind.Phrase
                && nodes[edge.DependentId].Tag == "PP")
            && HasNominalPhraseBoundary(parse, "kaAn", "N");
    }

    private static bool KaanPpPredicateRequiresNominativeSubject()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "kaAn",
                    tag: "V",
                    QacSegmentKind.Stem,
                    "PERF",
                    "3MS",
                    "LEM:kaAna",
                    "ROOT:kwn",
                    "SP:kaAn"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "la",
                    tag: "P",
                    QacSegmentKind.Stem,
                    "LEM:l"),
                SyntheticRecord(
                    word: 2,
                    segment: 2,
                    form: "hu",
                    tag: "PRON",
                    QacSegmentKind.Suffix,
                    "PRON:3MS"),
                SyntheticRecord(
                    word: 3,
                    segment: 1,
                    form: "walad",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "ACC",
                    "INDEF",
                    "LEM:walad",
                    "ROOT:wld"),
            ]);
        var nodes = parse.Graph.Nodes.ToDictionary(node => node.Id);
        return EnsureValid(parse)
            && !parse.Graph.Edges.Any(edge =>
                edge.Relation == "predx"
                && nodes[edge.DependentId].Kind == QacSyntaxNodeKind.Phrase
                && nodes[edge.DependentId].Tag == "PP");
    }

    private static bool RelativePronounPrepositionalPredicate()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "wa",
                    tag: "CONJ",
                    QacSegmentKind.Prefix,
                    "LEM:wa"),
                SyntheticRecord(
                    word: 1,
                    segment: 2,
                    form: "Al~a*iyna",
                    tag: "REL",
                    QacSegmentKind.Stem,
                    "LEM:{l~a*iY"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "hum",
                    tag: "PRON",
                    QacSegmentKind.Stem,
                    "PRON:3MP"),
                SyntheticRecord(
                    word: 3,
                    segment: 1,
                    form: "fiY",
                    tag: "P",
                    QacSegmentKind.Stem,
                    "LEM:fiY"),
                SyntheticRecord(
                    word: 4,
                    segment: 1,
                    form: "SalaAt",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "GEN",
                    "DEF",
                    "LEM:Salaw`p",
                    "ROOT:Slw"),
                SyntheticRecord(
                    word: 5,
                    segment: 1,
                    form: "xaA$iEuwn",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "PCPL",
                    "3MP",
                    "LEM:xaA$iE",
                    "ROOT:x$E"),
            ]);
        var subject = parse.Graph.Nodes.Single(node =>
            node.Kind == QacSyntaxNodeKind.Terminal
            && node.Tag == "PRON");
        var predicate = parse.Graph.Nodes.Single(node =>
            node.Kind == QacSyntaxNodeKind.Terminal
            && node.Tag == "N"
            && node.Morphology?.Voice == "ACT");
        return parse.Status == QacGrammarStatus.Valid
            && parse.Validation.IsValid
            && parse.Graph.Edges.Any(edge =>
                edge.DependentId == predicate.Id
                && edge.HeadId == subject.Id
                && edge.Relation == "pred"
                && edge.IsVerified)
            && HasPhrase(parse, "NS");
    }

    private static bool RelativePredicateRequiresActiveNominative()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "Al~a*iyna",
                    tag: "REL",
                    QacSegmentKind.Stem,
                    "LEM:{l~a*iY"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "hum",
                    tag: "PRON",
                    QacSegmentKind.Stem,
                    "PRON:3MP"),
                SyntheticRecord(
                    word: 3,
                    segment: 1,
                    form: "fiY",
                    tag: "P",
                    QacSegmentKind.Stem,
                    "LEM:fiY"),
                SyntheticRecord(
                    word: 4,
                    segment: 1,
                    form: "SalaAt",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "GEN",
                    "DEF",
                    "LEM:Salaw`p",
                    "ROOT:Slw"),
                SyntheticRecord(
                    word: 5,
                    segment: 1,
                    form: "xaA$iEiyna",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "ACC",
                    "PCPL",
                    "3MP",
                    "LEM:xaA$iE",
                    "ROOT:x$E"),
            ]);
        var subject = parse.Graph.Nodes.Single(node =>
            node.Kind == QacSyntaxNodeKind.Terminal
            && node.Tag == "PRON");
        var predicate = parse.Graph.Nodes.Single(node =>
            node.Kind == QacSyntaxNodeKind.Terminal
            && node.Morphology?.Lemma == "xaA$iE");
        return parse.Validation.IsValid
            && !parse.Graph.Edges.Any(edge =>
                edge.DependentId == predicate.Id
                && edge.HeadId == subject.Id
                && edge.Relation == "pred");
    }

    private static bool RelativePronounCliticPrepositionalPredicate()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "Al~a*iyna",
                    tag: "REL",
                    QacSegmentKind.Stem,
                    "LEM:{l~a*iY"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "hum",
                    tag: "PRON",
                    QacSegmentKind.Stem,
                    "PRON:3MP"),
                SyntheticRecord(
                    word: 3,
                    segment: 1,
                    form: "li",
                    tag: "P",
                    QacSegmentKind.Prefix,
                    "LEM:l"),
                SyntheticRecord(
                    word: 3,
                    segment: 2,
                    form: "zakaw`p",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "GEN",
                    "DEF",
                    "LEM:zakaw`p",
                    "ROOT:zkw"),
                SyntheticRecord(
                    word: 4,
                    segment: 1,
                    form: "faAEiluwn",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "PCPL",
                    "3MP",
                    "LEM:faAEil",
                    "ROOT:fEl"),
            ]);
        var subject = parse.Graph.Nodes.Single(node =>
            node.Kind == QacSyntaxNodeKind.Terminal
            && node.Tag == "PRON");
        var predicate = parse.Graph.Nodes.Single(node =>
            node.Kind == QacSyntaxNodeKind.Terminal
            && node.Tag == "N"
            && node.Morphology?.Voice == "ACT");
        return parse.Status == QacGrammarStatus.Valid
            && parse.Validation.IsValid
            && parse.Graph.Edges.Any(edge =>
                edge.DependentId == predicate.Id
                && edge.HeadId == subject.Id
                && edge.Relation == "pred"
                && edge.IsVerified)
            && HasPhrase(parse, "NS");
    }

    private static bool PrepositionalNominalAdjectivePredicate()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "fiY",
                    tag: "P",
                    QacSegmentKind.Stem,
                    "LEM:fiY"),
                SyntheticRecord(
                    word: 1,
                    segment: 2,
                    form: "himaA",
                    tag: "PRON",
                    QacSegmentKind.Suffix,
                    "PRON:3D"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "EayonaAni",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "INDEF",
                    "3D",
                    "LEM:Eayon",
                    "ROOT:Eyn"),
                SyntheticRecord(
                    word: 3,
                    segment: 1,
                    form: "naD~aAxataAni",
                    tag: "ADJ",
                    QacSegmentKind.Stem,
                    "NOM",
                    "INDEF",
                    "3D",
                    "LEM:naD~aAxataAn",
                    "ROOT:nDx"),
            ]);
        var nodes = parse.Graph.Nodes.ToDictionary(node => node.Id);
        var subject = parse.Graph.Nodes.Single(node =>
            node.Kind == QacSyntaxNodeKind.Terminal
            && node.Tag == "N");
        return parse.Status == QacGrammarStatus.Valid
            && parse.Validation.IsValid
            && parse.Graph.Edges.Any(edge =>
                edge.HeadId == subject.Id
                && edge.Relation == "pred"
                && edge.IsVerified
                && nodes[edge.DependentId].Kind == QacSyntaxNodeKind.Phrase
                && nodes[edge.DependentId].Tag == "PP");
    }

    private static bool PrepositionalPredicateRequiresAdjectiveAgreement()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "fiY",
                    tag: "P",
                    QacSegmentKind.Stem,
                    "LEM:fiY"),
                SyntheticRecord(
                    word: 1,
                    segment: 2,
                    form: "himaA",
                    tag: "PRON",
                    QacSegmentKind.Suffix,
                    "PRON:3D"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "EayonaAni",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "INDEF",
                    "3D",
                    "LEM:Eayon",
                    "ROOT:Eyn"),
                SyntheticRecord(
                    word: 3,
                    segment: 1,
                    form: "naD~aAxatayoni",
                    tag: "ADJ",
                    QacSegmentKind.Stem,
                    "GEN",
                    "INDEF",
                    "3D",
                    "LEM:naD~aAxataAn",
                    "ROOT:nDx"),
            ]);
        var nodes = parse.Graph.Nodes.ToDictionary(node => node.Id);
        var subject = parse.Graph.Nodes.Single(node =>
            node.Kind == QacSyntaxNodeKind.Terminal
            && node.Tag == "N");
        return parse.Validation.IsValid
            && !parse.Graph.Edges.Any(edge =>
                edge.HeadId == subject.Id
                && edge.Relation == "pred"
                && nodes[edge.DependentId].Kind == QacSyntaxNodeKind.Phrase
                && nodes[edge.DependentId].Tag == "PP");
    }

    private static bool TemporalWoePrepositionalPredicate()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "wayol",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "INDEF",
                    "LEM:wayol",
                    "ROOT:wyl"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "yawoma}i*",
                    tag: "T",
                    QacSegmentKind.Stem,
                    "LEM:yawoma}i*"),
                SyntheticRecord(
                    word: 3,
                    segment: 1,
                    form: "li",
                    tag: "P",
                    QacSegmentKind.Prefix,
                    "LEM:l"),
                SyntheticRecord(
                    word: 3,
                    segment: 2,
                    form: "muka*~ibiyn",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "GEN",
                    "DEF",
                    "LEM:m~uka*~ibiyn",
                    "ROOT:k*b"),
            ]);
        var nodes = parse.Graph.Nodes.ToDictionary(node => node.Id);
        var subject = parse.Graph.Nodes.Single(node =>
            node.Kind == QacSyntaxNodeKind.Terminal
            && node.Morphology?.Lemma == "wayol");
        return parse.Status == QacGrammarStatus.Valid
            && parse.Validation.IsValid
            && parse.Graph.Edges.Any(edge =>
                edge.HeadId == subject.Id
                && edge.Relation == "pred"
                && edge.IsVerified
                && nodes[edge.DependentId].Kind == QacSyntaxNodeKind.Phrase
                && nodes[edge.DependentId].Tag == "PP");
    }

    private static bool TemporalWoeRequiresAttestedLemma()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "wayol",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "INDEF",
                    "LEM:wayol",
                    "ROOT:wyl"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "yawom",
                    tag: "T",
                    QacSegmentKind.Stem,
                    "LEM:yawom"),
                SyntheticRecord(
                    word: 3,
                    segment: 1,
                    form: "li",
                    tag: "P",
                    QacSegmentKind.Prefix,
                    "LEM:l"),
                SyntheticRecord(
                    word: 3,
                    segment: 2,
                    form: "muka*~ibiyn",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "GEN",
                    "DEF",
                    "LEM:m~uka*~ibiyn",
                    "ROOT:k*b"),
            ]);
        var nodes = parse.Graph.Nodes.ToDictionary(node => node.Id);
        var subject = parse.Graph.Nodes.Single(node =>
            node.Kind == QacSyntaxNodeKind.Terminal
            && node.Morphology?.Lemma == "wayol");
        return parse.Validation.IsValid
            && !parse.Graph.Edges.Any(edge =>
                edge.HeadId == subject.Id
                && edge.Relation == "pred"
                && nodes[edge.DependentId].Kind == QacSyntaxNodeKind.Phrase
                && nodes[edge.DependentId].Tag == "PP");
    }

    private static bool TemporalFaceParticiplePredicate()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "wujuwh",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "INDEF",
                    "LEM:wajoh",
                    "ROOT:wjh"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "yawoma}i*",
                    tag: "T",
                    QacSegmentKind.Stem,
                    "LEM:yawoma}i*"),
                SyntheticRecord(
                    word: 3,
                    segment: 1,
                    form: "naADirap",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "INDEF",
                    "PCPL",
                    "3FS",
                    "LEM:n~aADirap",
                    "ROOT:nDr"),
            ]);
        var subject = parse.Graph.Nodes.Single(node =>
            node.Kind == QacSyntaxNodeKind.Terminal
            && node.Morphology?.Lemma == "wajoh");
        var predicate = parse.Graph.Nodes.Single(node =>
            node.Kind == QacSyntaxNodeKind.Terminal
            && node.Morphology?.Lemma == "n~aADirap");
        return parse.Status == QacGrammarStatus.Valid
            && parse.Validation.IsValid
            && parse.Graph.Edges.Any(edge =>
                edge.DependentId == predicate.Id
                && edge.HeadId == subject.Id
                && edge.Relation == "pred"
                && edge.IsVerified);
    }

    private static bool TemporalFaceRequiresFaceLemma()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "ruw}uws",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "INDEF",
                    "LEM:ra>os",
                    "ROOT:r>s"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "yawoma}i*",
                    tag: "T",
                    QacSegmentKind.Stem,
                    "LEM:yawoma}i*"),
                SyntheticRecord(
                    word: 3,
                    segment: 1,
                    form: "naADirap",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "INDEF",
                    "PCPL",
                    "3FS",
                    "LEM:n~aADirap",
                    "ROOT:nDr"),
            ]);
        var subject = parse.Graph.Nodes.Single(node =>
            node.Kind == QacSyntaxNodeKind.Terminal
            && node.Morphology?.Lemma == "ra>os");
        var predicate = parse.Graph.Nodes.Single(node =>
            node.Kind == QacSyntaxNodeKind.Terminal
            && node.Morphology?.Lemma == "n~aADirap");
        return parse.Validation.IsValid
            && !parse.Graph.Edges.Any(edge =>
                edge.DependentId == predicate.Id
                && edge.HeadId == subject.Id
                && edge.Relation == "pred");
    }

    private static bool InterrogativeNominalPredicate()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "maA",
                    tag: "INTG",
                    QacSegmentKind.Stem,
                    "LEM:maA"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "Al",
                    tag: "DET",
                    QacSegmentKind.Prefix,
                    "LEM:Al"),
                SyntheticRecord(
                    word: 2,
                    segment: 2,
                    form: "HaAq~ap",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "ACT",
                    "PCPL",
                    "LEM:HaA^q~ap",
                    "ROOT:Hqq"),
            ]);
        var subject = parse.Graph.Nodes.Single(node =>
            node.Kind == QacSyntaxNodeKind.Terminal
            && node.Tag == "INTG");
        var predicate = parse.Graph.Nodes.Single(node =>
            node.Kind == QacSyntaxNodeKind.Terminal
            && node.Morphology?.Lemma == "HaA^q~ap");
        return parse.Status == QacGrammarStatus.Valid
            && parse.Validation.IsValid
            && parse.Graph.Edges.Any(edge =>
                edge.DependentId == predicate.Id
                && edge.HeadId == subject.Id
                && edge.Relation == "pred"
                && edge.IsVerified)
            && HasPhrase(parse, "NS");
    }

    private static bool InterrogativePredicateRequiresDefinedNominative()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "maA",
                    tag: "INTG",
                    QacSegmentKind.Stem,
                    "LEM:maA"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "Al",
                    tag: "DET",
                    QacSegmentKind.Prefix,
                    "LEM:Al"),
                SyntheticRecord(
                    word: 2,
                    segment: 2,
                    form: "HaAq~apa",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "ACC",
                    "ACT",
                    "PCPL",
                    "LEM:HaA^q~ap",
                    "ROOT:Hqq"),
            ]);
        var subject = parse.Graph.Nodes.Single(node =>
            node.Kind == QacSyntaxNodeKind.Terminal
            && node.Tag == "INTG");
        var predicate = parse.Graph.Nodes.Single(node =>
            node.Kind == QacSyntaxNodeKind.Terminal
            && node.Morphology?.Lemma == "HaA^q~ap");
        return parse.Validation.IsValid
            && !parse.Graph.Edges.Any(edge =>
                edge.DependentId == predicate.Id
                && edge.HeadId == subject.Id
                && edge.Relation == "pred")
            && !HasPhrase(parse, "NS");
    }

    private static bool InterposedPpNominalPredicate()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: ">uwlaA}ika",
                    tag: "DEM",
                    QacSegmentKind.Stem,
                    "LEM:>uwla`^}ik"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "fiY",
                    tag: "P",
                    QacSegmentKind.Stem,
                    "LEM:fiY"),
                SyntheticRecord(
                    word: 3,
                    segment: 1,
                    form: "jan~aAt",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "GEN",
                    "INDEF",
                    "LEM:jan~ap",
                    "ROOT:jnn"),
                SyntheticRecord(
                    word: 4,
                    segment: 1,
                    form: "mukoramuwn",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "PASS",
                    "PCPL",
                    "LEM:m~ukoramuwn",
                    "ROOT:krm"),
            ]);
        return HasTerminalPredicate(parse, "DEM", "m~ukoramuwn");
    }

    private static bool InterposedPronominalPpNominalPredicate()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "hum",
                    tag: "PRON",
                    QacSegmentKind.Stem,
                    "PRON:3MP"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "fiY",
                    tag: "P",
                    QacSegmentKind.Stem,
                    "LEM:fiY"),
                SyntheticRecord(
                    word: 2,
                    segment: 2,
                    form: "haA",
                    tag: "PRON",
                    QacSegmentKind.Suffix,
                    "PRON:3FS"),
                SyntheticRecord(
                    word: 3,
                    segment: 1,
                    form: "xaAliduwn",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "ACT",
                    "PCPL",
                    "3MP",
                    "LEM:xa`lid",
                    "ROOT:xld"),
            ]);
        return HasTerminalPredicate(parse, "PRON", "xa`lid");
    }

    private static bool InterposedPpRejectsPrepositionalPronounSubject()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "li",
                    tag: "P",
                    QacSegmentKind.Prefix,
                    "LEM:l"),
                SyntheticRecord(
                    word: 1,
                    segment: 2,
                    form: "hum",
                    tag: "PRON",
                    QacSegmentKind.Stem,
                    "PRON:3MP"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "fiY",
                    tag: "P",
                    QacSegmentKind.Stem,
                    "LEM:fiY"),
                SyntheticRecord(
                    word: 2,
                    segment: 2,
                    form: "haA",
                    tag: "PRON",
                    QacSegmentKind.Suffix,
                    "PRON:3FS"),
                SyntheticRecord(
                    word: 3,
                    segment: 1,
                    form: ">azowaAj",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "INDEF",
                    "LEM:zawoj",
                    "ROOT:zwj"),
            ]);
        var subject = parse.Graph.Nodes.Single(node =>
            node.Kind == QacSyntaxNodeKind.Terminal
            && node.Tag == "PRON"
            && node.Morphology?.AttachedPronoun == "3MP");
        var predicate = parse.Graph.Nodes.Single(node =>
            node.Kind == QacSyntaxNodeKind.Terminal
            && node.Morphology?.Lemma == "zawoj");
        return parse.Validation.IsValid
            && !parse.Graph.Edges.Any(edge =>
                edge.DependentId == predicate.Id
                && edge.HeadId == subject.Id
                && edge.Relation == "pred");
    }

    private static bool KnowledgeInterrogativeVerbalPhrase()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "maA",
                    tag: "INTG",
                    QacSegmentKind.Stem,
                    "LEM:maA"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: ">adoraY",
                    tag: "V",
                    QacSegmentKind.Stem,
                    "PERF",
                    "3MS",
                    "LEM:>adoraY`",
                    "ROOT:dry"),
                SyntheticRecord(
                    word: 2,
                    segment: 2,
                    form: "ka",
                    tag: "PRON",
                    QacSegmentKind.Suffix,
                    "PRON:2MS"),
                SyntheticRecord(
                    word: 3,
                    segment: 1,
                    form: "maA",
                    tag: "INTG",
                    QacSegmentKind.Stem,
                    "LEM:maA"),
                SyntheticRecord(
                    word: 4,
                    segment: 1,
                    form: "Al",
                    tag: "DET",
                    QacSegmentKind.Prefix,
                    "LEM:Al"),
                SyntheticRecord(
                    word: 4,
                    segment: 2,
                    form: "qaAriEap",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "LEM:qaAriEap",
                    "ROOT:qrE"),
            ]);
        return parse.Status == QacGrammarStatus.Valid
            && parse.Validation.IsValid
            && HasPhrase(parse, "NS")
            && HasPhrase(parse, "VS");
    }

    private static bool HasTerminalPredicate(
        QacDeterministicGrammarParse parse,
        string subjectTag,
        string predicateLemma)
    {
        var nodes = parse.Graph.Nodes.ToDictionary(node => node.Id);
        var predicate = parse.Graph.Nodes.Single(node =>
            node.Kind == QacSyntaxNodeKind.Terminal
            && node.Morphology?.Lemma == predicateLemma);
        return parse.Status == QacGrammarStatus.Valid
            && parse.Validation.IsValid
            && parse.Graph.Edges.Any(edge =>
                edge.DependentId == predicate.Id
                && edge.Relation == "pred"
                && edge.IsVerified
                && nodes[edge.HeadId].Kind == QacSyntaxNodeKind.Terminal
                && nodes[edge.HeadId].Tag == subjectTag);
    }

    private static bool StandaloneVocativeSentenceValid()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "yaA",
                    tag: "VOC",
                    QacSegmentKind.Prefix,
                    "LEM:yaA"),
                SyntheticRecord(
                    word: 1,
                    segment: 2,
                    form: ">ay~uhaA",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "LEM:>ay~uhaA"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "Al",
                    tag: "DET",
                    QacSegmentKind.Prefix,
                    "LEM:Al"),
                SyntheticRecord(
                    word: 2,
                    segment: 2,
                    form: "munaAdaY",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "PCPL",
                    "LEM:munaAdaY",
                    "ROOT:ndw"),
            ]);
        var terminalCount = parse.Graph.Nodes.Count(node =>
            node.Kind == QacSyntaxNodeKind.Terminal);
        return parse.Status == QacGrammarStatus.Valid
            && parse.Validation.IsValid
            && parse.Graph.Nodes.Any(node =>
                node.Kind == QacSyntaxNodeKind.Phrase
                && node.Tag == "S"
                && node.SpanStartTerminal == 0
                && node.SpanEndTerminal == terminalCount - 1);
    }

    private static bool PartialVocativeSentenceUnverified()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "yaA",
                    tag: "VOC",
                    QacSegmentKind.Prefix,
                    "LEM:yaA"),
                SyntheticRecord(
                    word: 1,
                    segment: 2,
                    form: "zayod",
                    tag: "PN",
                    QacSegmentKind.Stem,
                    "ACC",
                    "LEM:zayod",
                    "ROOT:zyd"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "laA",
                    tag: "NEG",
                    QacSegmentKind.Stem,
                    "LEM:laA"),
            ]);
        var terminalCount = parse.Graph.Nodes.Count(node =>
            node.Kind == QacSyntaxNodeKind.Terminal);
        return parse.Validation.IsValid
            && parse.Status == QacGrammarStatus.Unverified
            && parse.Graph.Nodes.Any(node =>
                node.Kind == QacSyntaxNodeKind.Phrase
                && node.Tag == "S")
            && !parse.Graph.Nodes.Any(node =>
                node.Kind == QacSyntaxNodeKind.Phrase
                && node.Tag == "S"
                && node.SpanStartTerminal == 0
                && node.SpanEndTerminal == terminalCount - 1);
    }

    private static bool RestrictedPronounNominalPredicate()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "<in",
                    tag: "NEG",
                    QacSegmentKind.Stem,
                    "LEM:<in"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "huwa",
                    tag: "PRON",
                    QacSegmentKind.Stem,
                    "3MS"),
                SyntheticRecord(
                    word: 3,
                    segment: 1,
                    form: "<il~aA",
                    tag: "RES",
                    QacSegmentKind.Stem,
                    "LEM:<il~aA"),
                SyntheticRecord(
                    word: 4,
                    segment: 1,
                    form: "*ikor",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "INDEF",
                    "LEM:*ikor",
                    "ROOT:*kr"),
                SyntheticRecord(
                    word: 5,
                    segment: 1,
                    form: "li",
                    tag: "P",
                    QacSegmentKind.Prefix,
                    "LEM:l"),
                SyntheticRecord(
                    word: 5,
                    segment: 2,
                    form: "EaAlamiyn",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "GEN",
                    "DEF",
                    "LEM:Ea`lamiyn",
                    "ROOT:Elm"),
            ]);
        return HasRestrictedPredicate(parse, "PRON", "*ikor");
    }

    private static bool RestrictedDemonstrativeNominalPredicate()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "<in",
                    tag: "NEG",
                    QacSegmentKind.Stem,
                    "LEM:<in"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "haA*aA",
                    tag: "DEM",
                    QacSegmentKind.Stem,
                    "LEM:ha`*aA"),
                SyntheticRecord(
                    word: 3,
                    segment: 1,
                    form: "<il~aA",
                    tag: "RES",
                    QacSegmentKind.Stem,
                    "LEM:<il~aA"),
                SyntheticRecord(
                    word: 4,
                    segment: 1,
                    form: "qawol",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "INDEF",
                    "LEM:qawol",
                    "ROOT:qwl"),
                SyntheticRecord(
                    word: 5,
                    segment: 1,
                    form: "ba$ar",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "GEN",
                    "DEF",
                    "LEM:ba$ar",
                    "ROOT:b$r"),
            ]);
        return HasRestrictedPredicate(parse, "DEM", "qawol");
    }

    private static bool RestrictedPredicateRequiresGenitiveComplement()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "<in",
                    tag: "NEG",
                    QacSegmentKind.Stem,
                    "LEM:<in"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "huwa",
                    tag: "PRON",
                    QacSegmentKind.Stem,
                    "3MS"),
                SyntheticRecord(
                    word: 3,
                    segment: 1,
                    form: "<il~aA",
                    tag: "RES",
                    QacSegmentKind.Stem,
                    "LEM:<il~aA"),
                SyntheticRecord(
                    word: 4,
                    segment: 1,
                    form: "*ikor",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "INDEF",
                    "LEM:*ikor",
                    "ROOT:*kr"),
                SyntheticRecord(
                    word: 5,
                    segment: 1,
                    form: "li",
                    tag: "P",
                    QacSegmentKind.Prefix,
                    "LEM:l"),
                SyntheticRecord(
                    word: 5,
                    segment: 2,
                    form: "EaAlamiyn",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "ACC",
                    "DEF",
                    "LEM:Ea`lamiyn",
                    "ROOT:Elm"),
            ]);
        var subject = parse.Graph.Nodes.Single(node =>
            node.Kind == QacSyntaxNodeKind.Terminal
            && node.Tag == "PRON");
        var predicate = parse.Graph.Nodes.Single(node =>
            node.Kind == QacSyntaxNodeKind.Terminal
            && node.Morphology?.Lemma == "*ikor");
        return parse.Validation.IsValid
            && !parse.Graph.Edges.Any(edge =>
                edge.DependentId == predicate.Id
                && edge.HeadId == subject.Id
                && edge.Relation == "pred");
    }

    private static bool HasRestrictedPredicate(
        QacDeterministicGrammarParse parse,
        string subjectTag,
        string predicateLemma)
    {
        var subject = parse.Graph.Nodes.Single(node =>
            node.Kind == QacSyntaxNodeKind.Terminal
            && node.Tag == subjectTag);
        var predicate = parse.Graph.Nodes.Single(node =>
            node.Kind == QacSyntaxNodeKind.Terminal
            && node.Morphology?.Lemma == predicateLemma);
        return parse.Status == QacGrammarStatus.Valid
            && parse.Validation.IsValid
            && parse.Graph.Edges.Any(edge =>
                edge.DependentId == predicate.Id
                && edge.HeadId == subject.Id
                && edge.Relation == "pred"
                && edge.IsVerified);
    }

    private static bool PeacePrepositionalPredicate()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "salaAm",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "INDEF",
                    "LEM:sala`m",
                    "ROOT:slm"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "EalaY",
                    tag: "P",
                    QacSegmentKind.Stem,
                    "LEM:EalaY`"),
                SyntheticRecord(
                    word: 3,
                    segment: 1,
                    form: "murasaliyn",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "GEN",
                    "DEF",
                    "LEM:m~urosal",
                    "ROOT:rsl"),
            ]);
        var nodes = parse.Graph.Nodes.ToDictionary(node => node.Id);
        var subject = parse.Graph.Nodes.Single(node =>
            node.Kind == QacSyntaxNodeKind.Terminal
            && node.Morphology?.Lemma == "sala`m");
        return parse.Status == QacGrammarStatus.Valid
            && parse.Validation.IsValid
            && parse.Graph.Edges.Any(edge =>
                edge.HeadId == subject.Id
                && edge.Relation == "pred"
                && edge.IsVerified
                && nodes[edge.DependentId].Kind == QacSyntaxNodeKind.Phrase
                && nodes[edge.DependentId].Tag == "PP");
    }

    private static bool PeacePredicateRequiresSalaamLemma()
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "nuzul",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "INDEF",
                    "LEM:nuzul",
                    "ROOT:nzl"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "EalaY",
                    tag: "P",
                    QacSegmentKind.Stem,
                    "LEM:EalaY`"),
                SyntheticRecord(
                    word: 3,
                    segment: 1,
                    form: "murasaliyn",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "GEN",
                    "DEF",
                    "LEM:m~urosal",
                    "ROOT:rsl"),
            ]);
        var nodes = parse.Graph.Nodes.ToDictionary(node => node.Id);
        var subject = parse.Graph.Nodes.Single(node =>
            node.Kind == QacSyntaxNodeKind.Terminal
            && node.Morphology?.Lemma == "nuzul");
        return parse.Validation.IsValid
            && !parse.Graph.Edges.Any(edge =>
                edge.HeadId == subject.Id
                && edge.Relation == "pred"
                && nodes[edge.DependentId].Kind == QacSyntaxNodeKind.Phrase
                && nodes[edge.DependentId].Tag == "PP");
    }

    private static bool AuditedPronounNominalPredicate(
        string predicateCase,
        bool expected)
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "huwa",
                    tag: "PRON",
                    QacSegmentKind.Stem,
                    "3MS"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "gaAfir",
                    tag: "N",
                    QacSegmentKind.Stem,
                    predicateCase,
                    "INDEF",
                    "ACT",
                    "PCPL",
                    "3MS",
                    "LEM:gaAfir",
                    "ROOT:gfr"),
            ]);
        return MatchesExpectedRelation(
            parse,
            expected,
            "pred",
            node => node.Morphology?.Lemma == "gaAfir",
            node => node.Morphology?.PersonGenderNumber == "3MS",
            rejectNominalPhrase: expected);
    }

    private static bool ConjoinedLexicalNominalPredicate(
        string predicateLemma,
        bool expected)
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "wa",
                    tag: "CONJ",
                    QacSegmentKind.Prefix,
                    "LEM:wa"),
                SyntheticRecord(
                    word: 1,
                    segment: 2,
                    form: "rab~",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "DEF",
                    "LEM:rab~",
                    "ROOT:rbb"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: predicateLemma,
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "INDEF",
                    $"LEM:{predicateLemma}"),
            ]);
        return MatchesExpectedRelation(
            parse,
            expected,
            "pred",
            node => node.Morphology?.Lemma == predicateLemma,
            node => node.Morphology?.Lemma == "rab~");
    }

    private static bool RelativeMaPredicateSubject(
        string personGenderNumber,
        bool expected)
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "maA",
                    tag: "REL",
                    QacSegmentKind.Stem,
                    "LEM:maA"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: personGenderNumber == "2MS" ? ">anta" : ">anaA",
                    tag: "PRON",
                    QacSegmentKind.Stem,
                    personGenderNumber),
                SyntheticRecord(
                    word: 3,
                    segment: 1,
                    form: "bi",
                    tag: "P",
                    QacSegmentKind.Prefix,
                    "LEM:bi"),
                SyntheticRecord(
                    word: 3,
                    segment: 2,
                    form: "muhayomin",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "GEN",
                    "INDEF",
                    "ACT",
                    "PCPL",
                    "LEM:muhayomin",
                    "ROOT:hmn"),
            ]);
        return MatchesExpectedRelation(
            parse,
            expected,
            "subjx",
            node =>
                node.Morphology?.PersonGenderNumber == personGenderNumber,
            node => node.Morphology?.Lemma == "maA");
    }

    private static bool InvertedPeacePronounPredicate(
        string subjectLemma,
        bool expected)
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: subjectLemma,
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "INDEF",
                    $"LEM:{subjectLemma}"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "hiya",
                    tag: "PRON",
                    QacSegmentKind.Stem,
                    "3FS"),
            ]);
        return MatchesExpectedRelation(
            parse,
            expected,
            "pred",
            node => node.Morphology?.Lemma == subjectLemma,
            node => node.Morphology?.PersonGenderNumber == "3FS");
    }

    private static bool DirectWoePrepositionalPredicate(
        string subjectLemma,
        bool expected)
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: subjectLemma,
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "INDEF",
                    $"LEM:{subjectLemma}"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "li",
                    tag: "P",
                    QacSegmentKind.Prefix,
                    "LEM:l"),
                SyntheticRecord(
                    word: 2,
                    segment: 2,
                    form: "kaAfiriyn",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "GEN",
                    "DEF",
                    "LEM:ka`fir",
                    "ROOT:kfr"),
            ]);
        return MatchesExpectedRelation(
            parse,
            expected,
            "pred",
            node =>
                node.Kind == QacSyntaxNodeKind.Phrase
                && node.Tag == "PP",
            node => node.Morphology?.Lemma == subjectLemma);
    }

    private static bool TemporalDemonstrativeNominalPredicate(
        string temporalLemma,
        bool expected)
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "*aAlika",
                    tag: "DEM",
                    QacSegmentKind.Stem,
                    "LEM:*a`lik"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: temporalLemma == "yawom"
                        ? "yawoma"
                        : temporalLemma,
                    tag: "T",
                    QacSegmentKind.Stem,
                    $"LEM:{temporalLemma}"),
                SyntheticRecord(
                    word: 3,
                    segment: 1,
                    form: "yawom",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "INDEF",
                    "LEM:yawom",
                    "ROOT:ywm"),
            ]);
        return MatchesExpectedRelation(
            parse,
            expected,
            "pred",
            node => node.Morphology?.Lemma == "yawom",
            node => node.Morphology?.Lemma == "*a`lik");
    }

    private static bool ChainedRelativeGenitivePredicate(
        string intermediateCase,
        bool expected)
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "Al~a*iyna",
                    tag: "REL",
                    QacSegmentKind.Stem,
                    "LEM:{l~a*iY"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "hum",
                    tag: "PRON",
                    QacSegmentKind.Stem,
                    "3MP"),
                SyntheticRecord(
                    word: 3,
                    segment: 1,
                    form: "li",
                    tag: "P",
                    QacSegmentKind.Prefix,
                    "LEM:l"),
                SyntheticRecord(
                    word: 3,
                    segment: 2,
                    form: ">amaAnaAt",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "GEN",
                    "DEF",
                    "LEM:>ama`nap",
                    "ROOT:Amn"),
                SyntheticRecord(
                    word: 4,
                    segment: 1,
                    form: "Eahod",
                    tag: "N",
                    QacSegmentKind.Stem,
                    intermediateCase,
                    "DEF",
                    "LEM:Eahod",
                    "ROOT:Ehd"),
                SyntheticRecord(
                    word: 5,
                    segment: 1,
                    form: "raAEuwn",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "INDEF",
                    "ACT",
                    "PCPL",
                    "3MP",
                    "LEM:ra`E",
                    "ROOT:rEy"),
            ]);
        return MatchesExpectedRelation(
            parse,
            expected,
            "pred",
            node => node.Morphology?.Lemma == "ra`E",
            node => node.Morphology?.PersonGenderNumber == "3MP");
    }

    private static bool ConjoinedDivineNominalPredicate(
        string subjectLemma,
        bool expected)
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "wa",
                    tag: "CONJ",
                    QacSegmentKind.Prefix,
                    "LEM:wa"),
                SyntheticRecord(
                    word: 1,
                    segment: 2,
                    form: subjectLemma,
                    tag: "PN",
                    QacSegmentKind.Stem,
                    "NOM",
                    $"LEM:{subjectLemma}"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "samiyE",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "INDEF",
                    "ACT",
                    "PCPL",
                    "LEM:samiyE",
                    "ROOT:smE"),
            ]);
        return MatchesExpectedRelation(
            parse,
            expected,
            "pred",
            node => node.Morphology?.Lemma == "samiyE",
            node => node.Morphology?.Lemma == subjectLemma,
            rejectNominalPhrase: expected);
    }

    private static bool ComparativeInterrogativeNominalPredicate(
        string predicateCase,
        bool expected)
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "man",
                    tag: "REL",
                    QacSegmentKind.Stem,
                    "LEM:man"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: ">aHosan",
                    tag: "N",
                    QacSegmentKind.Stem,
                    predicateCase,
                    "INDEF",
                    "LEM:>aHosan",
                    "ROOT:Hsn"),
            ]);
        return MatchesExpectedRelation(
            parse,
            expected,
            "pred",
            node => node.Morphology?.Lemma == ">aHosan",
            node => node.Morphology?.Lemma == "man",
            rejectNominalPhrase: expected);
    }

    private static bool InterposedCliticPronounPredicate(
        bool includePreposition,
        bool expected)
    {
        var records = new List<QacMorphologyRecord>
        {
            SyntheticRecord(
                word: 1,
                segment: 1,
                form: "naHonu",
                tag: "PRON",
                QacSegmentKind.Stem,
                "1P"),
        };
        if (includePreposition)
        {
            records.Add(
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "la",
                    tag: "P",
                    QacSegmentKind.Prefix,
                    "LEM:l"));
            records.Add(
                SyntheticRecord(
                    word: 2,
                    segment: 2,
                    form: "hu",
                    tag: "PRON",
                    QacSegmentKind.Stem,
                    "3MS"));
        }
        else
        {
            records.Add(
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "huwa",
                    tag: "PRON",
                    QacSegmentKind.Stem,
                    "3MS"));
        }

        records.Add(
            SyntheticRecord(
                word: 3,
                segment: 1,
                form: "EaAbiduwn",
                tag: "N",
                QacSegmentKind.Stem,
                "NOM",
                "INDEF",
                "ACT",
                "PCPL",
                "1P",
                "LEM:EaAbid",
                "ROOT:Ebd"));
        var (_, _, parse) = SyntheticParse(records);
        return MatchesExpectedRelation(
            parse,
            expected,
            "pred",
            node => node.Morphology?.Lemma == "EaAbid",
            node => node.Morphology?.PersonGenderNumber == "1P",
            rejectNominalPhrase: expected);
    }

    private static bool GuardedUniversalNominalPredicate(
        bool includeAttachedPronoun,
        bool expected)
    {
        var records = new List<QacMorphologyRecord>
        {
            SyntheticRecord(
                word: 1,
                segment: 1,
                form: "kul~",
                tag: "N",
                QacSegmentKind.Stem,
                "NOM",
                "LEM:kul~",
                "ROOT:kll"),
            SyntheticRecord(
                word: 2,
                segment: 1,
                form: "nafos",
                tag: "N",
                QacSegmentKind.Stem,
                "GEN",
                "INDEF",
                "LEM:nafos",
                "ROOT:nfs"),
            SyntheticRecord(
                word: 3,
                segment: 1,
                form: "lam~aA",
                tag: "T",
                QacSegmentKind.Stem,
                "LEM:lam~aA"),
            SyntheticRecord(
                word: 4,
                segment: 1,
                form: "EalaY",
                tag: "P",
                QacSegmentKind.Stem,
                "LEM:EalaY`"),
        };
        if (includeAttachedPronoun)
        {
            records.Add(
                SyntheticRecord(
                    word: 4,
                    segment: 2,
                    form: "haA",
                    tag: "PRON",
                    QacSegmentKind.Suffix,
                    "PRON:3FS"));
        }

        records.Add(
            SyntheticRecord(
                word: 5,
                segment: 1,
                form: "HaAfiZ",
                tag: "N",
                QacSegmentKind.Stem,
                "NOM",
                "INDEF",
                "LEM:Ha`fiZ",
                "ROOT:HfZ"));
        var (_, _, parse) = SyntheticParse(records);
        return MatchesExpectedRelation(
            parse,
            expected,
            "pred",
            node => node.Morphology?.Lemma == "Ha`fiZ",
            node => node.Morphology?.Lemma == "kul~");
    }

    private static bool NightOfDecreeNominalPredicate(
        string predicateTag,
        bool expected)
    {
        var (_, _, parse) = SyntheticParse(
            [
                SyntheticRecord(
                    word: 1,
                    segment: 1,
                    form: "layolap",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "NOM",
                    "LEM:layolap",
                    "ROOT:lyl"),
                SyntheticRecord(
                    word: 2,
                    segment: 1,
                    form: "qador",
                    tag: "N",
                    QacSegmentKind.Stem,
                    "GEN",
                    "DEF",
                    "LEM:qador",
                    "ROOT:qdr"),
                SyntheticRecord(
                    word: 3,
                    segment: 1,
                    form: "xayor",
                    tag: predicateTag,
                    QacSegmentKind.Stem,
                    "NOM",
                    "INDEF",
                    "LEM:xayor",
                    "ROOT:xyr"),
            ]);
        return MatchesExpectedRelation(
            parse,
            expected,
            "pred",
            node => node.Morphology?.Lemma == "xayor",
            node => node.Morphology?.Lemma == "layolap");
    }

    private static bool MatchesExpectedRelation(
        QacDeterministicGrammarParse parse,
        bool expected,
        string relation,
        Func<QacSyntaxNode, bool> dependentPredicate,
        Func<QacSyntaxNode, bool> headPredicate,
        bool rejectNominalPhrase = false)
    {
        var nodes = parse.Graph.Nodes.ToDictionary(node => node.Id);
        var matchingEdges = parse.Graph.Edges
            .Where(edge =>
                edge.Relation == relation
                && nodes.TryGetValue(edge.DependentId, out var dependent)
                && dependentPredicate(dependent)
                && nodes.TryGetValue(edge.HeadId, out var head)
                && headPredicate(head))
            .ToArray();
        return parse.Validation.IsValid
            && (expected
                ? parse.Status == QacGrammarStatus.Valid
                    && matchingEdges.Any(edge => edge.IsVerified)
                : matchingEdges.Length == 0)
            && (!rejectNominalPhrase || !HasPhrase(parse, "NS"));
    }

    private static IReadOnlyList<QacMorphologyRecord>
        RelativeConditionalRecords(
            string markerForm,
            string markerTag,
            string markerLemma) =>
        [
            SyntheticRecord(
                word: 1,
                segment: 1,
                form: "man",
                tag: "REL",
                QacSegmentKind.Stem,
                "LEM:man"),
            SyntheticRecord(
                word: 2,
                segment: 1,
                form: markerForm,
                tag: markerTag,
                QacSegmentKind.Stem,
                $"LEM:{markerLemma}"),
            SyntheticRecord(
                word: 3,
                segment: 1,
                form: "qaAl",
                tag: "V",
                QacSegmentKind.Stem,
                "PERF",
                "3MS",
                "LEM:qaAla",
                "ROOT:qwl"),
            SyntheticRecord(
                word: 4,
                segment: 1,
                form: "rajul",
                tag: "N",
                QacSegmentKind.Stem,
                "NOM",
                "DEF",
                "LEM:rajul",
                "ROOT:rjl"),
        ];

    private static (
        QacDeterministicGrammarParser Parser,
        string Text)
        SyntheticParser(
            IReadOnlyList<QacMorphologyRecord> records,
            bool enableHeuristicFallback = false)
    {
        var ordered = records
            .OrderBy(record => record.Location)
            .ToArray();
        var lexicon = QacMorphologyLexicon.Build(ordered);
        var text = string.Join(
            " ",
            lexicon.Words.Select(word => word.ArabicSurface));
        return (
            new QacDeterministicGrammarParser(
                lexicon,
                enableHeuristicFallback),
            text);
    }

    private static (
        QacDeterministicGrammarParser Parser,
        string Text,
        QacDeterministicGrammarParse Parse)
        SyntheticParse(
            IReadOnlyList<QacMorphologyRecord> records,
            bool enableHeuristicFallback = false)
    {
        var (parser, text) = SyntheticParser(
            records,
            enableHeuristicFallback);
        return (parser, text, parser.Parse(text));
    }

    private static QacMorphologyRecord SyntheticRecord(
        int word,
        int segment,
        string form,
        string tag,
        QacSegmentKind segmentKind,
        params string[] features)
    {
        var allFeatures = new[]
            {
                segmentKind.ToString().ToUpperInvariant(),
                $"POS:{tag}",
            }
            .Concat(features)
            .ToArray();
        return new QacMorphologyRecord(
            new QacLocation(1, 1, word, segment),
            form,
            tag,
            segmentKind,
            allFeatures,
            string.Join("|", allFeatures),
            word * 10 + segment);
    }

    private static bool HasPhrase(
        QacDeterministicGrammarParse parse,
        string tag) =>
        parse.Graph.Nodes.Any(node =>
            node.Kind == QacSyntaxNodeKind.Phrase
            && node.Tag == tag);

    private static bool EnsureValid(QacDeterministicGrammarParse parse)
    {
        if (parse.Validation.IsValid)
        {
            return true;
        }

        throw new InvalidOperationException(
            string.Join(
                " | ",
                parse.Validation.Errors.Select(error =>
                    $"{error.Code}:{error.NodeId}:{error.Edge}:{error.Message}")));
    }

    private static bool HasNominalPhraseBoundary(
        QacDeterministicGrammarParse parse,
        string specialClass,
        string endTag)
    {
        var terminals = parse.Graph.Nodes
            .Where(node => node.Kind == QacSyntaxNodeKind.Terminal)
            .ToArray();
        return parse.Graph.Nodes.Any(node =>
            node.Kind == QacSyntaxNodeKind.Phrase
            && node.Tag == "NS"
            && node.SpanStartTerminal is { } start
            && node.SpanEndTerminal is { } end
            && start >= 0
            && end >= start
            && end < terminals.Length
            && terminals[start].Morphology?.SpecialClass == specialClass
            && terminals[end].Tag == endTag);
    }

    private static string NodeSignature(QacSyntaxNode node) =>
        string.Join(
            "\t",
            node.Id,
            node.Kind,
            node.Tag,
            node.Text,
            node.TextRange?.Start,
            node.TextRange?.Length,
            node.Morphology?.Aspect,
            node.Morphology?.Mood,
            node.Morphology?.Voice,
            node.Morphology?.GrammaticalCase);

    private static QacSyntaxValidationReport Canonical(
        string relation,
        QacSyntaxNode dependent,
        QacSyntaxNode head) =>
        QacSyntaxValidator.Validate(
            CanonicalGraph(relation, dependent, head));

    private static QacDependencyGraph CanonicalGraph(
        string relation,
        QacSyntaxNode dependent,
        QacSyntaxNode head) =>
        Graph(
            [dependent, head],
            [new QacDependencyEdge(dependent.Id, head.Id, relation)]);

    private static bool HasError(QacDependencyGraph graph, string code) =>
        QacSyntaxValidator.Validate(graph).Errors.Any(error => error.Code == code);

    private static QacDependencyGraph Graph(
        IReadOnlyList<QacSyntaxNode> nodes,
        IReadOnlyList<QacDependencyEdge> edges) =>
        new("property-test", nodes, edges);

    private static QacSyntaxNode Terminal(string id, string tag, int start) =>
        new(
            id,
            QacSyntaxNodeKind.Terminal,
            tag,
            tag,
            TextRange: new SourceRange(start, 1));

    private static QacSyntaxNode PhraseNode(
        string id,
        string tag,
        int start = 0,
        int end = 0) =>
        new(
            id,
            QacSyntaxNodeKind.Phrase,
            tag,
            SpanStartTerminal: start,
            SpanEndTerminal: end);

    private static QacSyntaxNode Nominal(
        string id,
        string grammaticalCase,
        int start) =>
        Terminal(id, "N", start) with
        {
            Morphology = Morphology(
                "N",
                grammaticalCase: grammaticalCase),
        };

    private static QacSyntaxNode DualNominal(
        string id,
        string form,
        string grammaticalCase,
        int start) =>
        Terminal(id, "N", start) with
        {
            Morphology = Morphology(
                "N",
                grammaticalCase: grammaticalCase,
                form: form,
                rawFeatures: ["STEM", "POS:N", "MD", grammaticalCase]),
        };

    private static QacSyntaxNode Verb(
        string id,
        string aspect,
        string? mood,
        string voice,
        int start) =>
        Terminal(id, "V", start) with
        {
            Morphology = Morphology(
                "V",
                aspect: aspect,
                mood: mood,
                voice: voice),
        };

    private static QacNormalizedMorphologyRecord Morphology(
        string tag,
        string? grammaticalCase = null,
        string? aspect = null,
        string? mood = null,
        string? voice = null,
        string form = "",
        IReadOnlyList<string>? rawFeatures = null,
        string? lemma = null,
        string? specialClass = null) =>
        new(
            "property:test",
            form,
            tag,
            nameof(QacSegmentKind.Stem),
            rawFeatures ?? ["STEM", $"POS:{tag}"],
            lemma,
            null,
            specialClass,
            null,
            null,
            aspect,
            mood,
            voice,
            null,
            null,
            grammaticalCase,
            null);

    private enum TestKind
    {
        Relation,
        Phrase,
        Mutation,
    }
}
