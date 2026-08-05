namespace Adg.LanguageEditor;

internal enum GrammarCase
{
    None,
    Raf,
    Nasb,
    Jarr,
    Jazm
}

internal sealed record TokenInfo(string Surface, string NormalizedSurface, int Index, GrammarCase Case, bool LooksLikeVerb);

internal sealed record GrammarAnalysis(string Original, string Normalized, IReadOnlyList<TokenInfo> Tokens, IReadOnlyList<GrammarDiagnostic> Diagnostics);

internal sealed record GrammarDiagnostic(string Code, string Name, string Message, string Token, int Position, string Explanation)
{
    public static GrammarDiagnostic Raw(string code, string name, string token, int position, string message) =>
        new(code, name, message, token, position, "");
}

internal sealed record RefinementSuggestion(
    string Text,
    bool Verified,
    string Confidence,
    IReadOnlyList<RefinementChange> Changes,
    IReadOnlyList<string> RulesSatisfied,
    string Kind = "CaseOnlyCorrection",
    string Decision = "ApprovedCorrection",
    string SemanticConservation = "Only case marks changed; lexical items and relations are preserved.");

internal sealed record RefinementChange(string From, string To, string Reason);

internal sealed record SemanticConservationDecision(
    string Kind,
    string Decision,
    string Reason,
    bool CanBecomeCorrection);

internal sealed record RefinementResult(
    string Original,
    string Normalized,
    string Corrected,
    bool Valid,
    IReadOnlyList<GrammarDiagnostic> Diagnostics,
    RefinementSuggestion? VerifiedSuggestion,
    IReadOnlyList<RefinementSuggestion> Suggestions);

internal sealed record TraceStep(
    int Index,
    string Stage,
    string Description,
    object Data);

internal sealed record TraceResult(
    string Original,
    IReadOnlyList<TraceStep> Steps,
    RefinementResult Result);
