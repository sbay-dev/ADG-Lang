namespace Adg.Compiler;

internal static class DiagnosticFormatter
{
    public static string Format(DiagnosticCode code, string message)
    {
        if (code == DiagnosticCode.Unknown)
        {
            return message;
        }

        return $"{Id(code)} {Name(code)}: {message}";
    }

    public static string Id(DiagnosticCode code) => code switch
    {
        DiagnosticCode.InvalidKeywordIrab => "ADG-K001",
        DiagnosticCode.UnknownArabicKeyword => "ADG-K002",
        DiagnosticCode.MixedSurfaceSyntax => "ADG-K003",
        DiagnosticCode.MissingTextDirectionHeader => "ADG-K004",
        DiagnosticCode.NonRtlTextDirection => "ADG-K005",
        DiagnosticCode.InvalidFaelCase => "ADG1001",
        DiagnosticCode.InvalidMafulCase => "ADG1002",
        DiagnosticCode.InvalidJarrOperand => "ADG1003",
        DiagnosticCode.MissingConditionalConsequence => "ADG1004",
        DiagnosticCode.ExplanationCaseMismatch => "ADG1005",
        DiagnosticCode.MissingInterrogativeTarget => "ADG1006",
        DiagnosticCode.MissingNegationTarget => "ADG1007",
        DiagnosticCode.InvalidOperatorArity => "ADG1008",
        DiagnosticCode.UnresolvedHiddenReference => "ADG1009",
        DiagnosticCode.InvalidSemanticFrame => "ADG1010",
        DiagnosticCode.InvalidParameterType => "ADG-F001",
        DiagnosticCode.UndefinedFunctionParameter => "ADG-F002",
        DiagnosticCode.ConditionRequiresNumber => "ADG-F003",
        DiagnosticCode.MissingFunctionBody => "ADG-F004",
        DiagnosticCode.UndefinedFunctionCall => "ADG-F005",
        DiagnosticCode.FunctionArityMismatch => "ADG-F006",
        DiagnosticCode.FunctionArgumentKindMismatch => "ADG-F007",
        DiagnosticCode.DuplicateFunctionName => "ADG-F008",
        DiagnosticCode.EmptyFunctionProgram => "ADG-F009",
        _ => "ADG0000"
    };

    public static string Name(DiagnosticCode code) => code switch
    {
        DiagnosticCode.InvalidKeywordIrab => nameof(DiagnosticCode.InvalidKeywordIrab),
        DiagnosticCode.UnknownArabicKeyword => nameof(DiagnosticCode.UnknownArabicKeyword),
        DiagnosticCode.MixedSurfaceSyntax => nameof(DiagnosticCode.MixedSurfaceSyntax),
        DiagnosticCode.MissingTextDirectionHeader => nameof(DiagnosticCode.MissingTextDirectionHeader),
        DiagnosticCode.NonRtlTextDirection => nameof(DiagnosticCode.NonRtlTextDirection),
        DiagnosticCode.InvalidFaelCase => nameof(DiagnosticCode.InvalidFaelCase),
        DiagnosticCode.InvalidMafulCase => nameof(DiagnosticCode.InvalidMafulCase),
        DiagnosticCode.InvalidJarrOperand => nameof(DiagnosticCode.InvalidJarrOperand),
        DiagnosticCode.MissingConditionalConsequence => nameof(DiagnosticCode.MissingConditionalConsequence),
        DiagnosticCode.ExplanationCaseMismatch => nameof(DiagnosticCode.ExplanationCaseMismatch),
        DiagnosticCode.MissingInterrogativeTarget => nameof(DiagnosticCode.MissingInterrogativeTarget),
        DiagnosticCode.MissingNegationTarget => nameof(DiagnosticCode.MissingNegationTarget),
        DiagnosticCode.InvalidOperatorArity => nameof(DiagnosticCode.InvalidOperatorArity),
        DiagnosticCode.UnresolvedHiddenReference => nameof(DiagnosticCode.UnresolvedHiddenReference),
        DiagnosticCode.InvalidSemanticFrame => nameof(DiagnosticCode.InvalidSemanticFrame),
        DiagnosticCode.InvalidParameterType => nameof(DiagnosticCode.InvalidParameterType),
        DiagnosticCode.UndefinedFunctionParameter => nameof(DiagnosticCode.UndefinedFunctionParameter),
        DiagnosticCode.ConditionRequiresNumber => nameof(DiagnosticCode.ConditionRequiresNumber),
        DiagnosticCode.MissingFunctionBody => nameof(DiagnosticCode.MissingFunctionBody),
        DiagnosticCode.UndefinedFunctionCall => nameof(DiagnosticCode.UndefinedFunctionCall),
        DiagnosticCode.FunctionArityMismatch => nameof(DiagnosticCode.FunctionArityMismatch),
        DiagnosticCode.FunctionArgumentKindMismatch => nameof(DiagnosticCode.FunctionArgumentKindMismatch),
        DiagnosticCode.DuplicateFunctionName => nameof(DiagnosticCode.DuplicateFunctionName),
        DiagnosticCode.EmptyFunctionProgram => nameof(DiagnosticCode.EmptyFunctionProgram),
        _ => nameof(DiagnosticCode.Unknown)
    };
}
