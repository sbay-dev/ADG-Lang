namespace Adg.QuranicCore;

public enum QuranicTokenKind
{
    Word,
    Punctuation,
    Number,
    Other
}

public enum QuranicSegmentKind
{
    ConjunctionFa,
    ConjunctionWa,
    PrepositionBa,
    PrepositionKa,
    PrepositionLam,
    FutureSin,
    Stem
}

public enum QuranicCausalMarkerKind
{
    FaSababiyya,
    FaSababiyyaCandidate,
    FaConsequence,
    FaResumption,
    BaSababiyya,
    BaInstrument,
    BaAmbiguous
}

public enum QuranicCausalDirection
{
    None,
    LeftCauseToRightEffect,
    RightCauseToLeftEffect
}

public enum QuranicVerbMood
{
    Unknown,
    Nasb,
    Past
}

public sealed record SourceRange(int Start, int Length)
{
    public int End => Start + Length;
}

public sealed record QuranicSegment(
    QuranicSegmentKind Kind,
    string Surface,
    string NormalizedSurface,
    SourceRange Range);

public sealed record QuranicToken(
    int Index,
    QuranicTokenKind Kind,
    string Surface,
    string NormalizedSurface,
    SourceRange Range,
    IReadOnlyList<QuranicSegment> Segments);

public sealed record QuranicCausalMarker(
    QuranicCausalMarkerKind Kind,
    QuranicCausalDirection Direction,
    QuranicVerbMood Mood,
    int TokenIndex,
    string SourceToken,
    string MarkerSurface,
    SourceRange MarkerRange,
    SourceRange? CauseRange,
    SourceRange? EffectRange,
    string RuleId,
    string Evidence);

public sealed record QuranicDiagnostic(
    string Code,
    string Message,
    SourceRange Range);

public sealed record QuranicAnalysis(
    string OriginalText,
    string NormalizedText,
    IReadOnlyList<QuranicToken> Tokens,
    IReadOnlyList<QuranicCausalMarker> CausalMarkers,
    IReadOnlyList<QuranicDiagnostic> Diagnostics);
