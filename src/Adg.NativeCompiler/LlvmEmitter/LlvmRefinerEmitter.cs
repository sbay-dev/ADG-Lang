using System.Globalization;
using System.Text;

namespace Adg.NativeCompiler;

/// <summary>
/// Emits real LLVM IR for an ADG text-refiner program. The module carries the
/// program's identity: the lexicon (skeleton keys + voweled values as data
/// tables), the enabled normalization flags, and a <c>main</c> that hands the
/// process arguments to the fixed ADG Refine Runtime entry point <c>adg_run</c>.
/// </summary>
internal static class LlvmRefinerEmitter
{
    public static string Emit(AdgRefinerProgram program, string sourceName)
    {
        var refiner = program.FindRefiner(program.RunTarget)
            ?? throw new AdgTypeException(
                DiagnosticCode.UndefinedRefinerApplication,
                $"'{RefinerSyntax.RunKeyword}' references undefined refiner '{program.RunTarget}'.");

        var module = new StringBuilder();
        module.AppendLine($"; ADG-Lang native text-refiner module generated from {sourceName}");
        module.AppendLine($"; مُنقِّح: {refiner.Name}");
        module.AppendLine($"source_filename = \"{LlvmText.EscapePlain(sourceName)}\"");
        module.AppendLine();

        var keyRefs = new List<string>();
        var valRefs = new List<string>();
        for (var index = 0; index < refiner.Lexicon.Count; index++)
        {
            var entry = refiner.Lexicon[index];
            module.AppendLine(EmitConstant($"@.adg.rk{index}", entry.BareSkeleton));
            module.AppendLine(EmitConstant($"@.adg.rv{index}", entry.Voweled));
            keyRefs.Add($"ptr @.adg.rk{index}");
            valRefs.Add($"ptr @.adg.rv{index}");
        }

        module.AppendLine();
        var count = refiner.Lexicon.Count;
        module.AppendLine(EmitPointerTable("adg_lex_keys", count, keyRefs));
        module.AppendLine(EmitPointerTable("adg_lex_vals", count, valRefs));
        module.AppendLine($"@adg_lex_count = constant i32 {count.ToString(CultureInfo.InvariantCulture)}");
        module.AppendLine($"@adg_flag_collapse_spaces = constant i32 {Flag(refiner, NormalizationFlag.CollapseSpaces)}");
        module.AppendLine($"@adg_flag_remove_tatweel = constant i32 {Flag(refiner, NormalizationFlag.RemoveTatweel)}");
        module.AppendLine($"@adg_flag_strip_tashkeel = constant i32 {Flag(refiner, NormalizationFlag.StripTashkeel)}");
        module.AppendLine();
        module.AppendLine("declare i32 @adg_run(i32, ptr)");
        module.AppendLine();
        module.AppendLine("define i32 @main(i32 %argc, ptr %argv) {");
        module.AppendLine("entry:");
        module.AppendLine("  %r = call i32 @adg_run(i32 %argc, ptr %argv)");
        module.AppendLine("  ret i32 %r");
        module.AppendLine("}");
        return module.ToString();
    }

    private static string Flag(RefinerDefinition refiner, NormalizationFlag flag) =>
        refiner.Flags.Contains(flag) ? "1" : "0";

    private static string EmitPointerTable(string symbol, int count, IReadOnlyList<string> references)
    {
        if (count == 0)
        {
            return $"@{symbol} = constant [0 x ptr] zeroinitializer";
        }

        return $"@{symbol} = constant [{count.ToString(CultureInfo.InvariantCulture)} x ptr] [{string.Join(", ", references)}]";
    }

    private static string EmitConstant(string symbol, string content)
    {
        var bytes = Encoding.UTF8.GetBytes(content);
        var length = bytes.Length + 1;
        return $"{symbol} = private unnamed_addr constant [{length} x i8] c\"{LlvmText.EscapeCString(bytes)}\\00\", align 1";
    }
}
