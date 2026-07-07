using System.Globalization;
using System.Text;

namespace Adg.Compiler;

internal static class LlvmFunctionEmitter
{
    public static string Emit(AdgFunctionProgram program, string sourceName) =>
        new Emitter().Build(program, sourceName);

    private sealed class Emitter
    {
        private readonly Dictionary<string, string> _pool = new(StringComparer.Ordinal);
        private readonly List<string> _globals = [];
        private int _stringCounter;

        public string Build(AdgFunctionProgram program, string sourceName)
        {
            var functionSymbols = new Dictionary<string, string>(StringComparer.Ordinal);
            for (var index = 0; index < program.Functions.Count; index++)
            {
                functionSymbols[program.Functions[index].Name] = $"@adg_func{index}";
            }

            var definitions = new StringBuilder();
            foreach (var function in program.Functions)
            {
                definitions.Append(EmitFunction(function, functionSymbols[function.Name]));
            }

            definitions.Append(EmitMain(program, functionSymbols));

            var module = new StringBuilder();
            module.AppendLine($"; ADG-Lang native function module generated from {sourceName}");
            module.AppendLine($"source_filename = \"{LlvmText.EscapePlain(sourceName)}\"");
            module.AppendLine();
            foreach (var global in _globals)
            {
                module.AppendLine(global);
            }

            module.AppendLine();
            module.AppendLine("declare i32 @printf(ptr, ...)");
            module.AppendLine();
            module.Append(definitions);
            return module.ToString();
        }

        private string EmitFunction(FunctionDefinition function, string symbol)
        {
            var signature = string.Join(", ", function.Parameters.Select((parameter, index) =>
                $"{LlvmType(parameter.Type)} %p{index}"));

            var builder = new StringBuilder();
            builder.AppendLine($"; دالة: {function.Name}");
            builder.AppendLine($"define void {symbol}({signature}) {{");
            builder.AppendLine("entry:");
            EmitPrintf(builder, function, function.BodyTemplate);

            var conditionIndex = 0;
            foreach (var condition in function.Conditions)
            {
                var parameterIndex = IndexOfParameter(function, condition.ParameterName);
                var comparison = condition.Operator switch
                {
                    ComparisonOperator.Greater => "sgt",
                    ComparisonOperator.Less => "slt",
                    ComparisonOperator.Equal => "eq",
                    _ => "eq"
                };

                builder.AppendLine($"  %cmp{conditionIndex} = icmp {comparison} i32 %p{parameterIndex}, {condition.Value.ToString(CultureInfo.InvariantCulture)}");
                builder.AppendLine($"  br i1 %cmp{conditionIndex}, label %then{conditionIndex}, label %cont{conditionIndex}");
                builder.AppendLine($"then{conditionIndex}:");
                EmitPrintf(builder, function, condition.Template);
                builder.AppendLine($"  br label %cont{conditionIndex}");
                builder.AppendLine($"cont{conditionIndex}:");
                conditionIndex++;
            }

            builder.AppendLine("  ret void");
            builder.AppendLine("}");
            builder.AppendLine();
            return builder.ToString();
        }

        private string EmitMain(AdgFunctionProgram program, IReadOnlyDictionary<string, string> functionSymbols)
        {
            var builder = new StringBuilder();
            builder.AppendLine("define i32 @main() {");
            builder.AppendLine("entry:");

            var clauseNumber = 1;
            var newlineSymbol = Intern("\n");
            foreach (var call in program.Calls)
            {
                var function = program.FindFunction(call.FunctionName)!;
                var separator = Intern($"«البند رقم {clauseNumber.ToString(CultureInfo.InvariantCulture)}»\n");
                builder.AppendLine($"  call i32 (ptr, ...) @printf(ptr {separator})");

                var invocation = new StringBuilder();
                invocation.Append($"call void {functionSymbols[function.Name]}(");
                for (var index = 0; index < call.Arguments.Count; index++)
                {
                    if (index > 0)
                    {
                        invocation.Append(", ");
                    }

                    var argument = call.Arguments[index];
                    invocation.Append(argument.Kind == ArgumentKind.Text
                        ? $"ptr {Intern(argument.Text)}"
                        : $"i32 {argument.Number.ToString(CultureInfo.InvariantCulture)}");
                }

                invocation.Append(')');
                builder.AppendLine($"  {invocation}");
                builder.AppendLine($"  call i32 (ptr, ...) @printf(ptr {newlineSymbol})");
                clauseNumber++;
            }

            builder.AppendLine("  ret i32 0");
            builder.AppendLine("}");
            return builder.ToString();
        }

        private void EmitPrintf(StringBuilder builder, FunctionDefinition function, string template)
        {
            var format = new StringBuilder();
            var arguments = new List<(int Index, AdgParamType Type)>();

            foreach (var segment in FunctionTemplate.Parse(template))
            {
                if (!segment.IsPlaceholder)
                {
                    foreach (var ch in segment.Text)
                    {
                        format.Append(ch == '%' ? "%%" : ch.ToString());
                    }

                    continue;
                }

                var parameterIndex = IndexOfParameter(function, segment.Text);
                var parameter = function.Parameters[parameterIndex];
                format.Append(parameter.Type == AdgParamType.Number ? "%d" : "%s");
                arguments.Add((parameterIndex, parameter.Type));
            }

            format.Append('\n');
            var formatSymbol = Intern(format.ToString());

            var call = new StringBuilder();
            call.Append($"  call i32 (ptr, ...) @printf(ptr {formatSymbol}");
            foreach (var (index, type) in arguments)
            {
                call.Append($", {LlvmType(type)} %p{index}");
            }

            call.Append(')');
            builder.AppendLine(call.ToString());
        }

        private string Intern(string content)
        {
            if (_pool.TryGetValue(content, out var existing))
            {
                return existing;
            }

            var symbol = $"@.adg.s{_stringCounter++}";
            var bytes = Encoding.UTF8.GetBytes(content);
            var length = bytes.Length + 1;
            _globals.Add($"{symbol} = private unnamed_addr constant [{length} x i8] c\"{LlvmText.EscapeCString(bytes)}\\00\", align 1");
            _pool[content] = symbol;
            return symbol;
        }

        private static int IndexOfParameter(FunctionDefinition function, string name)
        {
            for (var index = 0; index < function.Parameters.Count; index++)
            {
                if (string.Equals(function.Parameters[index].Name, name, StringComparison.Ordinal))
                {
                    return index;
                }
            }

            throw new AdgTypeException(
                DiagnosticCode.UndefinedFunctionParameter,
                $"Function '{function.Name}' references undefined parameter '{name}'.");
        }

        private static string LlvmType(AdgParamType type) => type == AdgParamType.Number ? "i32" : "ptr";
    }
}

