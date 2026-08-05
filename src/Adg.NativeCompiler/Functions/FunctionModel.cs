namespace Adg.NativeCompiler;

internal enum AdgParamType
{
    Text,
    Number
}

internal enum ComparisonOperator
{
    Greater,
    Less,
    Equal
}

internal enum ArgumentKind
{
    Text,
    Number
}

internal sealed record FunctionParameter(string Name, AdgParamType Type, AdgCase Case);

internal sealed record ConditionStatement(string ParameterName, ComparisonOperator Operator, long Value, string Template);

internal sealed record FunctionDefinition(
    string Name,
    IReadOnlyList<FunctionParameter> Parameters,
    string BodyTemplate,
    IReadOnlyList<ConditionStatement> Conditions,
    AdgParamType ReturnType)
{
    public FunctionParameter? FindParameter(string name)
    {
        foreach (var parameter in Parameters)
        {
            if (string.Equals(parameter.Name, name, StringComparison.Ordinal))
            {
                return parameter;
            }
        }

        return null;
    }
}

internal sealed record CallArgument(ArgumentKind Kind, string Text, long Number);

internal sealed record CallSite(string FunctionName, IReadOnlyList<CallArgument> Arguments);

internal sealed record AdgFunctionProgram(
    IReadOnlyList<FunctionDefinition> Functions,
    IReadOnlyList<CallSite> Calls)
{
    public FunctionDefinition? FindFunction(string name)
    {
        foreach (var function in Functions)
        {
            if (string.Equals(function.Name, name, StringComparison.Ordinal))
            {
                return function;
            }
        }

        return null;
    }
}
