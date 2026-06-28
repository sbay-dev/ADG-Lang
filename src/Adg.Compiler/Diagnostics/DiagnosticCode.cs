namespace Adg.Compiler;

internal enum DiagnosticCode
{
    Unknown = 0,
    InvalidFaelCase,
    InvalidMafulCase,
    InvalidJarrOperand,
    MissingConditionalConsequence,
    ExplanationCaseMismatch,
    MissingInterrogativeTarget,
    MissingNegationTarget,
    InvalidOperatorArity,
    UnresolvedHiddenReference,
    InvalidSemanticFrame
}

