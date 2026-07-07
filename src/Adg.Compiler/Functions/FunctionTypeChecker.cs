namespace Adg.Compiler;

internal static class FunctionTypeChecker
{
    public static void Check(AdgFunctionProgram program)
    {
        if (program.Functions.Count == 0 || program.Calls.Count == 0)
        {
            throw new AdgTypeException(
                DiagnosticCode.EmptyFunctionProgram,
                "An ADG function program must declare at least one function and one call so the native module has an entry point.");
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var function in program.Functions)
        {
            if (!seen.Add(function.Name))
            {
                throw new AdgTypeException(
                    DiagnosticCode.DuplicateFunctionName,
                    $"Function '{function.Name}' is defined more than once.");
            }

            CheckFunction(function);
        }

        foreach (var call in program.Calls)
        {
            CheckCall(program, call);
        }
    }

    private static void CheckFunction(FunctionDefinition function)
    {
        if (string.IsNullOrWhiteSpace(function.BodyTemplate))
        {
            throw new AdgTypeException(
                DiagnosticCode.MissingFunctionBody,
                $"Function '{function.Name}' is missing its '{FunctionSyntax.BodyKeyword}' body statement.");
        }

        foreach (var name in FunctionTemplate.Placeholders(function.BodyTemplate))
        {
            RequireParameter(function, name, "body");
        }

        foreach (var condition in function.Conditions)
        {
            var parameter = RequireParameter(function, condition.ParameterName, "condition");
            if (parameter.Type != AdgParamType.Number)
            {
                throw new AdgTypeException(
                    DiagnosticCode.ConditionRequiresNumber,
                    $"Condition in function '{function.Name}' compares parameter '{condition.ParameterName}', " +
                    $"but only numeric ('{FunctionSyntax.NumberTypeKeyword}') parameters can be compared.");
            }

            foreach (var name in FunctionTemplate.Placeholders(condition.Template))
            {
                RequireParameter(function, name, "consequence");
            }
        }
    }

    private static FunctionParameter RequireParameter(FunctionDefinition function, string name, string context)
    {
        return function.FindParameter(name) ?? throw new AdgTypeException(
            DiagnosticCode.UndefinedFunctionParameter,
            $"The {context} of function '{function.Name}' references undefined parameter '{name}'.");
    }

    private static void CheckCall(AdgFunctionProgram program, CallSite call)
    {
        var function = program.FindFunction(call.FunctionName) ?? throw new AdgTypeException(
            DiagnosticCode.UndefinedFunctionCall,
            $"Call references undefined function '{call.FunctionName}'.");

        if (call.Arguments.Count != function.Parameters.Count)
        {
            throw new AdgTypeException(
                DiagnosticCode.FunctionArityMismatch,
                $"Function '{function.Name}' expects {function.Parameters.Count} argument(s) but the call supplies {call.Arguments.Count}.");
        }

        for (var index = 0; index < call.Arguments.Count; index++)
        {
            var parameter = function.Parameters[index];
            var argument = call.Arguments[index];
            var expected = parameter.Type == AdgParamType.Number ? ArgumentKind.Number : ArgumentKind.Text;

            if (argument.Kind != expected)
            {
                throw new AdgTypeException(
                    DiagnosticCode.FunctionArgumentKindMismatch,
                    $"Argument {index + 1} of the call to '{function.Name}' must be " +
                    $"{(expected == ArgumentKind.Number ? "an integer" : "a quoted string")} for parameter '{parameter.Name}'.");
            }
        }
    }
}

