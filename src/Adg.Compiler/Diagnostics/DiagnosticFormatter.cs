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
        _ => "ADG0000"
    };

    public static string Name(DiagnosticCode code) => code switch
    {
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
        _ => nameof(DiagnosticCode.Unknown)
    };
}

