namespace Adg.Compiler;

internal enum DiagnosticCode
{
    Unknown = 0,
    InvalidKeywordIrab,
    MissingTextDirectionHeader,
    NonRtlTextDirection,
    InvalidFaelCase,
    InvalidMafulCase,
    InvalidJarrOperand,
    MissingConditionalConsequence,
    ExplanationCaseMismatch,
    MissingInterrogativeTarget,
    MissingNegationTarget,
    InvalidOperatorArity,
    UnresolvedHiddenReference,
    InvalidSemanticFrame,
    InvalidParameterType,
    UndefinedFunctionParameter,
    ConditionRequiresNumber,
    MissingFunctionBody,
    UndefinedFunctionCall,
    FunctionArityMismatch,
    FunctionArgumentKindMismatch,
    DuplicateFunctionName,
    EmptyFunctionProgram
}
