using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using Adg.QuranicCorpus;

namespace Adg.QuranicGrammar;

public sealed record QacScoreFactor(
    string Id,
    int Value,
    string Scope,
    string Rationale);

public sealed class QacMorphologySelectionScorePolicyReport
{
    public const string PolicyId =
        "adg-quranic-morphology-score-policy-v1";

    public required string Id { get; init; }

    public long FactorCount { get; init; }

    public int MaxAlternatives { get; init; }

    public IReadOnlyList<string> TieBreakers { get; init; } = [];

    public IReadOnlyList<QacScoreFactor> Factors { get; init; } = [];

    public IReadOnlyList<string> UnregisteredConstants { get; init; } = [];

    public bool NormativeForCns { get; init; }

    public required string PolicyMerkleRoot { get; init; }

    public bool IsValid =>
        Factors.Count == FactorCount
        && FactorCount > 0
        && Factors.Select(factor => factor.Id)
            .Distinct(StringComparer.Ordinal)
            .LongCount() == FactorCount
        && UnregisteredConstants.Count == 0
        && MaxAlternatives > 0
        && TieBreakers.SequenceEqual(
            ["ScoreDescending", "SignatureOrdinal"],
            StringComparer.Ordinal)
        && !NormativeForCns;
}

public static class QacMorphologySelectionScorePolicy
{
    public const int MaxAlternatives = 32;

    public const int QuranicCorpusBase = 5;
    public const int QuranicCorpusFrequencyMultiplier = 2;
    public const int QuranicCorpusFrequencyLog2Cap = 8;
    public const int HeuristicBase = -5;
    public const int HeuristicNominalNounScore = 8;
    public const int HeuristicLikelyAdjectiveScore = 12;
    public const int HeuristicFallbackAdjectiveScore = 2;
    public const int HeuristicProperNounScore = 0;
    public const int HeuristicPerfectVerbScore = 13;
    public const int HeuristicImperfectYaScore = 11;
    public const int HeuristicImperfectTaScore = 7;
    public const int HeuristicImperfectNunScore = 6;
    public const int HeuristicImperfectOtherScore = 4;
    public const int HeuristicCliticVerbScore = 16;
    public const int HeuristicPrepositionalCliticNounScore = 18;
    public const int HeuristicCliticNounScore = 13;
    public const int HeuristicLikelyPrepositionalCliticAdjectiveScore = 20;
    public const int HeuristicLikelyCliticAdjectiveScore = 15;
    public const int HeuristicFallbackPrepositionalCliticAdjectiveScore = 12;
    public const int HeuristicFallbackCliticAdjectiveScore = 7;
    public const int HeuristicClosedFunctionWordScore = 20;
    public const int HeuristicClosedTemporalWordScore = 18;
    public const int HeuristicRegisteredPerfectVerbScore = 24;
    public const int DefiniteNominalBonus = 2;
    public const int PrepositionGenitiveBonus = 5;
    public const int PrepositionNonGenitivePenalty = -4;
    public const int CausalImperfectSubjunctiveBonus = 14;
    public const int CausalImperfectWrongMoodPenalty = -15;
    public const int CausalNonImperfectBonus = 2;
    public const int FutureImperfectBonus = 6;
    public const int FutureNonImperfectPenalty = -8;
    public const int ProhibitionJussiveBonus = 8;
    public const int ProhibitionMismatchPenalty = -10;
    public const int SurfaceCompatibleCaseBonus = 4;
    public const int SurfaceIncompatibleCasePenalty = -16;

    public const int PairPrepositionGenitiveBonus = 10;
    public const int PairPrepositionMismatchPenalty = -10;
    public const int PairInceptiveTemporalBonus = 10;
    public const int PairCausalSubjunctiveBonus = 18;
    public const int PairCausalWrongMoodPenalty = -12;
    public const int PairCausalNonImperfectBonus = 1;
    public const int PairFutureImperfectBonus = 8;
    public const int PairFutureNonImperfectPenalty = -8;
    public const int PairProhibitionJussiveBonus = 10;
    public const int PairProhibitionMismatchPenalty = -10;
    public const int PairSpecialExpectedCaseBonus = 10;
    public const int PairSpecialCaselessBonus = 8;
    public const int PairSpecialCaseMismatchPenalty = -8;
    public const int PairLexicalPossessiveGenitiveBonus = 16;
    public const int PairLexicalPossessiveMismatchPenalty = -12;
    public const int PairDhuAgreementBonus = 4;
    public const int PairAdjectiveNominalHeadBonus = 4;
    public const int PairAdjectiveNonNominalHeadPenalty = -4;
    public const int PairNominalGenitiveBonus = 4;
    public const int PairNominalNominativeAgreementBonus = 3;
    public const int PairVerbNominativeBonus = 5;
    public const int PairVerbAccusativeBonus = 4;

    public const int AgreementBase = 2;
    public const int AgreementFeatureMatchBonus = 2;
    public const int AgreementFeatureMismatchPenalty = -4;
    public const int CoordinationSameTagBonus = 8;
    public const int CoordinationFeatureMatchBonus = 2;

    private static readonly IReadOnlyDictionary<string, FactorPolicy>
        Policies = CreatePolicies();

    public static QacMorphologySelectionScorePolicyReport BuildReport()
    {
        var fields = typeof(QacMorphologySelectionScorePolicy)
            .GetFields(BindingFlags.Public | BindingFlags.Static)
            .Where(field =>
                field.IsLiteral
                && field.FieldType == typeof(int))
            .OrderBy(field => field.Name, StringComparer.Ordinal)
            .ToArray();
        var unregistered = fields
            .Where(field => !Policies.ContainsKey(field.Name))
            .Select(field => field.Name)
            .ToArray();
        var factors = fields
            .Where(field => Policies.ContainsKey(field.Name))
            .Select(field =>
            {
                var policy = Policies[field.Name];
                return new QacScoreFactor(
                    field.Name,
                    (int)(field.GetRawConstantValue()
                        ?? throw new InvalidDataException(
                            $"Score constant '{field.Name}' has no value.")),
                    policy.Scope,
                    policy.Rationale);
            })
            .ToArray();
        var leafPayloads = factors
            .Select(factor =>
                string.Join(
                    "\t",
                    "factor",
                    factor.Id,
                    factor.Value,
                    factor.Scope,
                    factor.Rationale))
            .Concat(
            [
                $"policy\t{QacMorphologySelectionScorePolicyReport.PolicyId}",
                $"max-alternatives\t{MaxAlternatives}",
                "tie-breakers\tScoreDescending\tSignatureOrdinal",
                "normative-for-cns\tfalse",
            ]);
        var leaves = leafPayloads
            .Select(payload =>
                SHA256.HashData(Encoding.UTF8.GetBytes(payload)))
            .ToArray();
        return new QacMorphologySelectionScorePolicyReport
        {
            Id = QacMorphologySelectionScorePolicyReport.PolicyId,
            FactorCount = factors.LongLength,
            MaxAlternatives = MaxAlternatives,
            TieBreakers = ["ScoreDescending", "SignatureOrdinal"],
            Factors = factors,
            UnregisteredConstants = unregistered,
            NormativeForCns = false,
            PolicyMerkleRoot = QacMerkle.ComputeRoot(leaves),
        };
    }

    public static bool SelfTest()
    {
        var first = BuildReport();
        var second = BuildReport();
        return first.IsValid
            && first.PolicyMerkleRoot == second.PolicyMerkleRoot;
    }

    private static IReadOnlyDictionary<string, FactorPolicy> CreatePolicies()
    {
        var policies =
            new Dictionary<string, FactorPolicy>(StringComparer.Ordinal);

        void Add(string id, string scope, string rationale) =>
            policies.Add(id, new FactorPolicy(scope, rationale));

        Add(
            nameof(MaxAlternatives),
            "beam",
            "Bound ambiguity while preserving deterministic replay.");
        Add(
            nameof(QuranicCorpusBase),
            "candidate-source",
            "Prefer analyses attested in the Quranic morphology source.");
        Add(
            nameof(QuranicCorpusFrequencyMultiplier),
            "candidate-source",
            "Use bounded source frequency only as a deterministic tie signal.");
        Add(
            nameof(QuranicCorpusFrequencyLog2Cap),
            "candidate-source",
            "Prevent high-frequency entries from dominating grammar constraints.");
        Add(
            nameof(HeuristicBase),
            "candidate-source",
            "Keep opt-in natural heuristics below attested Quranic analyses.");
        Add(
            nameof(HeuristicNominalNounScore),
            "natural-heuristic",
            "Rank the generic opt-in noun analysis above weak alternatives.");
        Add(
            nameof(HeuristicLikelyAdjectiveScore),
            "natural-heuristic",
            "Prefer an adjective when the opt-in surface test supports it.");
        Add(
            nameof(HeuristicFallbackAdjectiveScore),
            "natural-heuristic",
            "Retain a low-ranked adjective alternative without surface support.");
        Add(
            nameof(HeuristicProperNounScore),
            "natural-heuristic",
            "Keep unsupported proper-noun guessing as the weakest nominal option.");
        Add(
            nameof(HeuristicPerfectVerbScore),
            "natural-heuristic",
            "Prefer a surface-supported perfect-verb analysis.");
        Add(
            nameof(HeuristicImperfectYaScore),
            "natural-heuristic",
            "Rank ya-prefixed imperfect guesses above ambiguous nominal forms.");
        Add(
            nameof(HeuristicImperfectTaScore),
            "natural-heuristic",
            "Retain a bounded ta-prefixed imperfect preference.");
        Add(
            nameof(HeuristicImperfectNunScore),
            "natural-heuristic",
            "Retain a bounded nun-prefixed imperfect preference.");
        Add(
            nameof(HeuristicImperfectOtherScore),
            "natural-heuristic",
            "Use the weakest score for other imperfect prefixes.");
        Add(
            nameof(HeuristicCliticVerbScore),
            "natural-heuristic",
            "Prefer an explicitly segmented opt-in clitic verb.");
        Add(
            nameof(HeuristicPrepositionalCliticNounScore),
            "natural-heuristic",
            "Prefer a segmented noun under an opt-in prepositional clitic.");
        Add(
            nameof(HeuristicCliticNounScore),
            "natural-heuristic",
            "Prefer a segmented noun under a non-prepositional clitic.");
        Add(
            nameof(HeuristicLikelyPrepositionalCliticAdjectiveScore),
            "natural-heuristic",
            "Prefer a likely adjective under a prepositional clitic.");
        Add(
            nameof(HeuristicLikelyCliticAdjectiveScore),
            "natural-heuristic",
            "Prefer a likely adjective under a non-prepositional clitic.");
        Add(
            nameof(HeuristicFallbackPrepositionalCliticAdjectiveScore),
            "natural-heuristic",
            "Retain a weaker adjective under a prepositional clitic.");
        Add(
            nameof(HeuristicFallbackCliticAdjectiveScore),
            "natural-heuristic",
            "Retain the weakest segmented adjective alternative.");
        Add(
            nameof(HeuristicClosedFunctionWordScore),
            "natural-heuristic",
            "Prefer an exact opt-in closed-function-word registration.");
        Add(
            nameof(HeuristicClosedTemporalWordScore),
            "natural-heuristic",
            "Prefer an exact temporal registration below closed operators.");
        Add(
            nameof(HeuristicRegisteredPerfectVerbScore),
            "natural-heuristic",
            "Prefer an exact registered perfect verb in the opt-in lexicon.");
        Add(
            nameof(DefiniteNominalBonus),
            "candidate-shape",
            "Prefer a nominal stem when a definite article is present.");
        Add(
            nameof(PrepositionGenitiveBonus),
            "case-governance",
            "Reward genitive realization inside a prepositional candidate.");
        Add(
            nameof(PrepositionNonGenitivePenalty),
            "case-governance",
            "Penalize case that contradicts prepositional governance.");
        Add(
            nameof(CausalImperfectSubjunctiveBonus),
            "mood-governance",
            "Prefer verified subjunctive imperfect after governing causal fa.");
        Add(
            nameof(CausalImperfectWrongMoodPenalty),
            "mood-governance",
            "Penalize a governed causal imperfect with the wrong mood.");
        Add(
            nameof(CausalNonImperfectBonus),
            "mood-governance",
            "Allow the broader non-governing causal connective family.");
        Add(
            nameof(FutureImperfectBonus),
            "aspect-governance",
            "Prefer imperfect aspect after a future marker.");
        Add(
            nameof(FutureNonImperfectPenalty),
            "aspect-governance",
            "Penalize non-imperfect future-marker analyses.");
        Add(
            nameof(ProhibitionJussiveBonus),
            "mood-governance",
            "Prefer imperfect jussive after prohibition.");
        Add(
            nameof(ProhibitionMismatchPenalty),
            "mood-governance",
            "Penalize prohibition analyses without imperfect jussive.");
        Add(
            nameof(SurfaceCompatibleCaseBonus),
            "surface-compatibility",
            "Prefer case analyses compatible with the observed Quranic marks.");
        Add(
            nameof(SurfaceIncompatibleCasePenalty),
            "surface-compatibility",
            "Strongly demote surface-contradictory case before fail-closed status.");
        Add(
            nameof(PairPrepositionGenitiveBonus),
            "pair-case",
            "Prefer a genitive nominal after an unattached preposition.");
        Add(
            nameof(PairPrepositionMismatchPenalty),
            "pair-case",
            "Penalize a non-genitive nominal after an unattached preposition.");
        Add(
            nameof(PairInceptiveTemporalBonus),
            "pair-tag",
            "Prefer the observed inceptive-particle plus temporal pattern.");
        Add(
            nameof(PairCausalSubjunctiveBonus),
            "pair-mood",
            "Prefer subjunctive imperfect immediately after governing causal fa.");
        Add(
            nameof(PairCausalWrongMoodPenalty),
            "pair-mood",
            "Penalize the wrong mood after governing causal fa.");
        Add(
            nameof(PairCausalNonImperfectBonus),
            "pair-mood",
            "Retain bounded support for non-governing causal uses.");
        Add(
            nameof(PairFutureImperfectBonus),
            "pair-aspect",
            "Prefer an imperfect verb after a future marker.");
        Add(
            nameof(PairFutureNonImperfectPenalty),
            "pair-aspect",
            "Penalize a non-imperfect verb after a future marker.");
        Add(
            nameof(PairProhibitionJussiveBonus),
            "pair-mood",
            "Prefer imperfect jussive after prohibition or imperative result.");
        Add(
            nameof(PairProhibitionMismatchPenalty),
            "pair-mood",
            "Penalize a non-jussive prohibited or imperative-result verb.");
        Add(
            nameof(PairSpecialExpectedCaseBonus),
            "special-particle-case",
            "Prefer the overt case governed by special particles and verbs.");
        Add(
            nameof(PairSpecialCaselessBonus),
            "special-particle-case",
            "Permit inherently caseless pronoun, relative, or demonstrative tags.");
        Add(
            nameof(PairSpecialCaseMismatchPenalty),
            "special-particle-case",
            "Penalize overt case that contradicts a special head.");
        Add(
            nameof(PairLexicalPossessiveGenitiveBonus),
            "development-lexical",
            "Prefer genitive realization for a registered evidence-only pair.");
        Add(
            nameof(PairLexicalPossessiveMismatchPenalty),
            "development-lexical",
            "Penalize non-genitive realization for a registered evidence-only pair.");
        Add(
            nameof(PairDhuAgreementBonus),
            "agreement",
            "Prefer case agreement for the bounded dhu nominal construction.");
        Add(
            nameof(PairAdjectiveNominalHeadBonus),
            "agreement",
            "Prefer an adjective attached to a nominal head.");
        Add(
            nameof(PairAdjectiveNonNominalHeadPenalty),
            "agreement",
            "Penalize adjectival attachment to a non-nominal head.");
        Add(
            nameof(PairNominalGenitiveBonus),
            "nominal-sequence",
            "Use genitive as a bounded nominal-sequence preference.");
        Add(
            nameof(PairNominalNominativeAgreementBonus),
            "nominal-sequence",
            "Use matching nominative case as a bounded nominal preference.");
        Add(
            nameof(PairVerbNominativeBonus),
            "verbal-sequence",
            "Prefer nominative nominal candidates after a verb when ambiguous.");
        Add(
            nameof(PairVerbAccusativeBonus),
            "verbal-sequence",
            "Retain accusative object candidates after a verb.");
        Add(
            nameof(AgreementBase),
            "agreement",
            "Give a bounded base preference to adjective agreement.");
        Add(
            nameof(AgreementFeatureMatchBonus),
            "agreement",
            "Reward an observed matching agreement feature.");
        Add(
            nameof(AgreementFeatureMismatchPenalty),
            "agreement",
            "Penalize an observed contradictory agreement feature.");
        Add(
            nameof(CoordinationSameTagBonus),
            "coordination",
            "Prefer identical tags only as a tie signal, not a contract.");
        Add(
            nameof(CoordinationFeatureMatchBonus),
            "coordination",
            "Reward matching visible coordination features.");
        return policies;
    }

    private sealed record FactorPolicy(
        string Scope,
        string Rationale);
}
