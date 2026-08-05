namespace Adg.LanguageEditor;

internal sealed class SuggestionEngine(RewriteValidator validator, SemanticConservationGate conservationGate)
{
    public IEnumerable<RefinementSuggestion> Generate(GrammarAnalysis analysis)
    {
        if (analysis.Diagnostics.Count == 0)
        {
            yield break;
        }

        var correctedTokens = analysis.Tokens.Select(token => token.Surface).ToArray();
        var changes = new List<RefinementChange>();

        foreach (var diagnostic in analysis.Diagnostics)
        {
            var index = diagnostic.Position;
            if (index < 0 || index >= correctedTokens.Length)
            {
                continue;
            }

            var targetCase = diagnostic.Code switch
            {
                "ADG1001" => GrammarCase.Raf,
                "ADG1002" => GrammarCase.Nasb,
                "ADG1003" => GrammarCase.Jarr,
                "ADG1005" => ResolveExplanationTargetCase(analysis.Tokens, index),
                _ => GrammarCase.None
            };

            if (targetCase == GrammarCase.None)
            {
                continue;
            }

            var before = correctedTokens[index];
            var after = CaseDetector.SetCase(before, targetCase);
            correctedTokens[index] = after;
            changes.Add(new RefinementChange(before, after, diagnostic.Message));
        }

        if (changes.Count == 0)
        {
            yield break;
        }

        var candidateText = RenderTokens(correctedTokens);
        var verified = validator.Verify(candidateText);
        if (!verified)
        {
            yield break;
        }

        var conservation = conservationGate.EvaluateCaseOnlyCandidate(
            analysis.Tokens.Select(token => token.Surface).ToArray(),
            correctedTokens,
            changes);

        if (!conservation.CanBecomeCorrection)
        {
            yield return new RefinementSuggestion(
                candidateText,
                true,
                "medium",
                changes,
                analysis.Diagnostics.Select(diagnostic => diagnostic.Code).ToArray(),
                conservation.Kind,
                conservation.Decision,
                conservation.Reason);
            yield break;
        }

        yield return new RefinementSuggestion(
            candidateText,
            true,
            "high",
            changes,
            analysis.Diagnostics.Select(diagnostic => diagnostic.Code).ToArray(),
            conservation.Kind,
            conservation.Decision,
            conservation.Reason);
    }

    private static GrammarCase ResolveExplanationTargetCase(IReadOnlyList<TokenInfo> tokens, int explanationIndex)
    {
        if (explanationIndex < 2)
        {
            return GrammarCase.None;
        }

        return tokens[explanationIndex - 2].Case;
    }

    private static string RenderTokens(IEnumerable<string> tokens)
    {
        var text = string.Join(' ', tokens);
        return text.Replace(" ،", "،", StringComparison.Ordinal).Replace(" .", ".", StringComparison.Ordinal);
    }
}
