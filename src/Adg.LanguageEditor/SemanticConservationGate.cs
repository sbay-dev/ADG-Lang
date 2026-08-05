namespace Adg.LanguageEditor;

internal sealed class SemanticConservationGate
{
    public SemanticConservationDecision EvaluateCaseOnlyCandidate(
        IReadOnlyList<string> originalTokens,
        IReadOnlyList<string> candidateTokens,
        IReadOnlyList<RefinementChange> changes)
    {
        if (changes.Count == 0)
        {
            return new SemanticConservationDecision(
                "NoChange",
                "ShadowMode",
                "No correction was produced.",
                false);
        }

        if (originalTokens.Count != candidateTokens.Count)
        {
            return RequiresAuthorDecision("The suggestion adds or removes lexical tokens.");
        }

        for (var index = 0; index < originalTokens.Count; index++)
        {
            if (!string.Equals(
                    CaseDetector.NormalizeSurface(originalTokens[index]),
                    CaseDetector.NormalizeSurface(candidateTokens[index]),
                    StringComparison.Ordinal))
            {
                return RequiresAuthorDecision("The suggestion changes at least one lexical item, not only its case mark.");
            }
        }

        return new SemanticConservationDecision(
            "CaseOnlyCorrection",
            "ApprovedCorrection",
            "Only case marks changed; word count and lexical items are preserved.",
            true);
    }

    public SemanticConservationDecision RequiresAuthorDecision(string reason) =>
        new(
            "StructuralSuggestion",
            "RequiresAuthorDecision",
            reason,
            false);

    public SemanticConservationDecision ShadowMode(string reason) =>
        new(
            "ShadowObservation",
            "ShadowMode",
            reason,
            false);
}
