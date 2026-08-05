namespace Adg.NativeCompiler;

internal static class AdgFunctionParser
{
    public static AdgFunctionProgram ParseFile(string path) => ParseLines(File.ReadAllLines(path));

    public static AdgFunctionProgram ParseLines(IReadOnlyList<string> lines)
    {
        var functions = new List<FunctionDefinition>();
        var calls = new List<CallSite>();
        var directionHeaderValidated = false;
        FunctionBuilder? current = null;

        foreach (var rawLine in lines)
        {
            var line = StripComment(rawLine).Trim();
            if (line.Length == 0)
            {
                continue;
            }

            if (!directionHeaderValidated)
            {
                TextDirectionHeader.Validate(line);
                directionHeaderValidated = true;
                continue;
            }

            if (line.StartsWith("adg ", StringComparison.OrdinalIgnoreCase) || line.StartsWith("program ", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var tokens = FunctionSyntax.Tokenize(line);
            if (tokens.Count == 0)
            {
                continue;
            }

            var head = tokens[0];
            if (head.IsQuoted)
            {
                throw new AdgParseException($"ADG function statement must start with a keyword, not a string: {line}");
            }

            if (FunctionSyntax.IsKeyword(head.Text, FunctionSyntax.DefinitionKeyword))
            {
                FlushFunction(functions, ref current);
                current = ParseDefinitionHeader(tokens, line);
                continue;
            }

            if (FunctionSyntax.IsKeyword(head.Text, FunctionSyntax.CallKeyword))
            {
                FlushFunction(functions, ref current);
                calls.Add(ParseCall(tokens, line));
                continue;
            }

            if (FunctionSyntax.IsKeyword(head.Text, FunctionSyntax.BodyKeyword))
            {
                RequireCurrent(current, FunctionSyntax.BodyKeyword).SetBody(ParseBody(tokens, line));
                continue;
            }

            if (FunctionSyntax.IsKeyword(head.Text, FunctionSyntax.ConditionKeyword))
            {
                RequireCurrent(current, FunctionSyntax.ConditionKeyword).Conditions.Add(ParseCondition(tokens, line));
                continue;
            }

            if (FunctionSyntax.IsKeyword(head.Text, FunctionSyntax.OutputKeyword))
            {
                RequireCurrent(current, FunctionSyntax.OutputKeyword).SetReturn(ParseReturn(tokens, line));
                continue;
            }

            throw new AdgParseException($"Unsupported ADG function statement: {line}");
        }

        FlushFunction(functions, ref current);

        if (!directionHeaderValidated)
        {
            throw new AdgParseException(
                DiagnosticCode.MissingTextDirectionHeader,
                $"Missing mandatory text direction header. First non-empty line must be '{TextDirectionHeader.Canonical}'.");
        }

        return new AdgFunctionProgram(functions, calls);
    }

    private static FunctionBuilder ParseDefinitionHeader(IReadOnlyList<FunctionToken> tokens, string line)
    {
        if (tokens.Count < 2 || !tokens[1].IsQuoted)
        {
            throw new AdgParseException($"Function definition requires a quoted name: {line}");
        }

        var builder = new FunctionBuilder(tokens[1].Text);
        if (tokens.Count == 2)
        {
            return builder;
        }

        if (!FunctionSyntax.IsKeyword(tokens[2].Text, FunctionSyntax.ParametersKeyword))
        {
            throw new AdgParseException(
                $"Function parameters must be introduced by '{FunctionSyntax.ParametersKeyword}': {line}");
        }

        var index = 3;
        while (index < tokens.Count)
        {
            var nameToken = tokens[index];
            if (!nameToken.IsQuoted)
            {
                throw new AdgParseException($"Function parameter name must be quoted: {line}");
            }

            if (index + 1 >= tokens.Count)
            {
                throw new AdgParseException($"Function parameter '{nameToken.Text}' is missing a type label: {line}");
            }

            var typeToken = tokens[index + 1];
            if (typeToken.IsQuoted)
            {
                throw new AdgParseException($"Function parameter '{nameToken.Text}' is missing a type label: {line}");
            }

            builder.Parameters.Add(ParseParameter(nameToken.Text, typeToken.Text));
            index += 2;
        }

        return builder;
    }

    private static FunctionParameter ParseParameter(string name, string typeLabel)
    {
        if (FunctionSyntax.IsKeyword(typeLabel, FunctionSyntax.NumberTypeKeyword))
        {
            return new FunctionParameter(name, AdgParamType.Number, AdgCase.None);
        }

        if (FunctionSyntax.IsKeyword(typeLabel, FunctionSyntax.RafLabel))
        {
            return new FunctionParameter(name, AdgParamType.Text, AdgCase.Raf);
        }

        if (FunctionSyntax.IsKeyword(typeLabel, FunctionSyntax.NasbLabel))
        {
            return new FunctionParameter(name, AdgParamType.Text, AdgCase.Nasb);
        }

        if (FunctionSyntax.IsKeyword(typeLabel, FunctionSyntax.JarrLabel))
        {
            return new FunctionParameter(name, AdgParamType.Text, AdgCase.Jarr);
        }

        throw new AdgParseException(
            DiagnosticCode.InvalidParameterType,
            $"Parameter '{name}' has an invalid type label '{typeLabel}'. Expected one of " +
            $"'{FunctionSyntax.RafLabel}', '{FunctionSyntax.NasbLabel}', '{FunctionSyntax.JarrLabel}', '{FunctionSyntax.NumberTypeKeyword}'.");
    }

    private static string ParseBody(IReadOnlyList<FunctionToken> tokens, string line)
    {
        if (tokens.Count != 2 || !tokens[1].IsQuoted)
        {
            throw new AdgParseException($"Body statement requires a single quoted template: {line}");
        }

        return tokens[1].Text;
    }

    private static ConditionStatement ParseCondition(IReadOnlyList<FunctionToken> tokens, string line)
    {
        if (tokens.Count != 6
            || !tokens[1].IsQuoted
            || tokens[2].IsQuoted
            || tokens[3].IsQuoted
            || tokens[4].IsQuoted
            || !tokens[5].IsQuoted)
        {
            throw new AdgParseException(
                $"Condition statement must be '{FunctionSyntax.ConditionKeyword} \"<param>\" <op> <number> " +
                $"{FunctionSyntax.ConsequenceKeyword} \"<template>\"': {line}");
        }

        var parameterName = tokens[1].Text;
        var comparison = ParseComparison(tokens[2].Text, line);

        if (!FunctionSyntax.TryParseInteger(tokens[3].Text, out var value))
        {
            throw new AdgParseException($"Condition comparison value '{tokens[3].Text}' is not an integer: {line}");
        }

        if (!FunctionSyntax.IsKeyword(tokens[4].Text, FunctionSyntax.ConsequenceKeyword))
        {
            throw new AdgParseException(
                $"Condition consequence must be introduced by '{FunctionSyntax.ConsequenceKeyword}': {line}");
        }

        return new ConditionStatement(parameterName, comparison, value, tokens[5].Text);
    }

    private static ComparisonOperator ParseComparison(string token, string line)
    {
        if (FunctionSyntax.IsKeyword(token, FunctionSyntax.GreaterKeyword))
        {
            return ComparisonOperator.Greater;
        }

        if (FunctionSyntax.IsKeyword(token, FunctionSyntax.LessKeyword))
        {
            return ComparisonOperator.Less;
        }

        if (FunctionSyntax.IsKeyword(token, FunctionSyntax.EqualKeyword))
        {
            return ComparisonOperator.Equal;
        }

        throw new AdgParseException(
            $"Unknown comparison operator '{token}'. Expected '{FunctionSyntax.GreaterKeyword}', " +
            $"'{FunctionSyntax.LessKeyword}', or '{FunctionSyntax.EqualKeyword}': {line}");
    }

    private static AdgParamType ParseReturn(IReadOnlyList<FunctionToken> tokens, string line)
    {
        if (tokens.Count != 2 || tokens[1].IsQuoted)
        {
            throw new AdgParseException($"Return statement requires a single type keyword: {line}");
        }

        if (FunctionSyntax.IsKeyword(tokens[1].Text, FunctionSyntax.TextTypeKeyword))
        {
            return AdgParamType.Text;
        }

        if (FunctionSyntax.IsKeyword(tokens[1].Text, FunctionSyntax.NumberTypeKeyword))
        {
            return AdgParamType.Number;
        }

        throw new AdgParseException(
            DiagnosticCode.InvalidParameterType,
            $"Return type '{tokens[1].Text}' is invalid. Expected '{FunctionSyntax.TextTypeKeyword}' or '{FunctionSyntax.NumberTypeKeyword}': {line}");
    }

    private static CallSite ParseCall(IReadOnlyList<FunctionToken> tokens, string line)
    {
        if (tokens.Count < 2 || !tokens[1].IsQuoted)
        {
            throw new AdgParseException($"Call statement requires a quoted function name: {line}");
        }

        var arguments = new List<CallArgument>();
        for (var index = 2; index < tokens.Count; index++)
        {
            var token = tokens[index];
            if (token.IsQuoted)
            {
                arguments.Add(new CallArgument(ArgumentKind.Text, token.Text, 0));
                continue;
            }

            if (FunctionSyntax.TryParseInteger(token.Text, out var value))
            {
                arguments.Add(new CallArgument(ArgumentKind.Number, string.Empty, value));
                continue;
            }

            throw new AdgParseException(
                $"Call argument '{token.Text}' must be a quoted string or an integer: {line}");
        }

        return new CallSite(tokens[1].Text, arguments);
    }

    private static FunctionBuilder RequireCurrent(FunctionBuilder? current, string keyword)
    {
        return current ?? throw new AdgParseException(
            $"'{keyword}' statement requires a preceding '{FunctionSyntax.DefinitionKeyword}' definition.");
    }

    private static void FlushFunction(List<FunctionDefinition> functions, ref FunctionBuilder? current)
    {
        if (current is not null)
        {
            functions.Add(current.Build());
            current = null;
        }
    }

    private static string StripComment(string line)
    {
        var index = line.IndexOf('#', StringComparison.Ordinal);
        return index < 0 ? line : line[..index];
    }

    private sealed class FunctionBuilder(string name)
    {
        private string? _bodyTemplate;
        private AdgParamType _returnType = AdgParamType.Text;

        public string Name { get; } = name;

        public List<FunctionParameter> Parameters { get; } = [];

        public List<ConditionStatement> Conditions { get; } = [];

        public void SetBody(string template)
        {
            if (_bodyTemplate is not null)
            {
                throw new AdgParseException($"Function '{Name}' declares '{FunctionSyntax.BodyKeyword}' more than once.");
            }

            _bodyTemplate = template;
        }

        public void SetReturn(AdgParamType returnType) => _returnType = returnType;

        public FunctionDefinition Build() =>
            new(Name, Parameters, _bodyTemplate ?? string.Empty, Conditions, _returnType);
    }
}
