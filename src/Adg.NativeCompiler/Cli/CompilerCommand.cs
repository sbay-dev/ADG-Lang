using System.Text;
using System.Text.Json;

namespace Adg.NativeCompiler;

internal static class CompilerCommand
{
    private static readonly Encoding Utf8NoBom = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);

    public static int Compile(CompileOptions options)
    {
        var inputPath = Path.GetFullPath(options.InputPath);
        var llvmPath = Path.GetFullPath(options.LlvmOutputPath
            ?? Path.Combine("build", $"{Path.GetFileNameWithoutExtension(inputPath)}.ll"));

        var emission = EmitLlvmIr(inputPath, llvmPath, options.PrintRendered);

        IReadOnlyList<string>? extraSources = null;
        if (emission.IsRefiner && (options.NativeOutputPath is not null || options.WasiOutputPath is not null))
        {
            extraSources = [RefineRuntime.WriteTo(Path.GetDirectoryName(llvmPath) ?? ".")];
        }

        CompileRequestedOutputs(options, llvmPath, extraSources);

        return 0;
    }

    /*
     * Detects the program kind (refiner -> function -> grammatical), verifies it,
     * and writes its LLVM IR to llvmPath. Shared by the `compile` and `build`
     * commands so every native target flows through one verified emission step.
     * Returns whether the program is a refiner, because refiner binaries must be
     * linked against the fixed adg_refine_runtime.c source.
     */
    public static LlvmEmission EmitLlvmIr(string inputPath, string llvmPath, bool print)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(llvmPath) ?? ".");

        if (RefinerProgramDetector.IsRefinerProgram(inputPath))
        {
            var program = AdgRefinerParser.ParseFile(inputPath);
            RefinerTypeChecker.Check(program);

            if (print)
            {
                PrintRefinerSummary(program);
            }

            File.WriteAllText(llvmPath, LlvmRefinerEmitter.Emit(program, Path.GetFileName(inputPath)), Utf8NoBom);
            Console.WriteLine($"LLVM IR: {llvmPath}");
            return new LlvmEmission(llvmPath, IsRefiner: true);
        }

        if (FunctionProgramDetector.IsFunctionProgram(inputPath))
        {
            var program = AdgFunctionParser.ParseFile(inputPath);
            FunctionTypeChecker.Check(program);

            if (print)
            {
                PrintFunctionSummary(program);
            }

            File.WriteAllText(llvmPath, LlvmFunctionEmitter.Emit(program, Path.GetFileName(inputPath)), Utf8NoBom);
            Console.WriteLine($"LLVM IR: {llvmPath}");
            return new LlvmEmission(llvmPath, IsRefiner: false);
        }

        var verifiedProgram = LoadVerifiedProgram(inputPath);

        if (print)
        {
            Console.WriteLine(verifiedProgram.RenderText());
        }

        File.WriteAllText(llvmPath, LlvmModuleEmitter.Emit(verifiedProgram, Path.GetFileName(inputPath)), Utf8NoBom);
        Console.WriteLine($"LLVM IR: {llvmPath}");
        return new LlvmEmission(llvmPath, IsRefiner: false);
    }

    public readonly record struct LlvmEmission(string LlvmPath, bool IsRefiner);

    private static void CompileRequestedOutputs(CompileOptions options, string llvmPath, IReadOnlyList<string>? extraSources = null)
    {
        if (options.NativeOutputPath is not null)
        {
            var nativePath = Path.GetFullPath(options.NativeOutputPath);
            Directory.CreateDirectory(Path.GetDirectoryName(nativePath) ?? ".");
            LlvmNativeCompiler.Compile(llvmPath, nativePath, options.ClangPath, extraSources);
            Console.WriteLine($"Native executable: {nativePath}");
        }

        if (options.WasiOutputPath is not null)
        {
            var wasiPath = Path.GetFullPath(options.WasiOutputPath);
            Directory.CreateDirectory(Path.GetDirectoryName(wasiPath) ?? ".");
            LlvmNativeCompiler.CompileWasi(llvmPath, wasiPath, options.ClangPath, options.WasiSysrootPath, extraSources);
            Console.WriteLine($"WASI module: {wasiPath}");
        }
    }

    private static void PrintRefinerSummary(AdgRefinerProgram program)
    {
        foreach (var refiner in program.Refiners)
        {
            var gate = refiner.ConservationGate ? "نعم" : "لا";
            Console.WriteLine(
                $"{RefinerSyntax.RefinerKeyword} {refiner.Name}: معجمٌ={refiner.Lexicon.Count}، تطبيعٌ={refiner.Flags.Count}، ضمانٌ تشكيليٌّ={gate}");
        }

        Console.WriteLine($"{RefinerSyntax.RunKeyword} {program.RunTarget}");
    }

    private static void PrintFunctionSummary(AdgFunctionProgram program)
    {
        foreach (var function in program.Functions)
        {
            var parameters = string.Join("، ", function.Parameters.Select(parameter =>
                $"{parameter.Name}:{(parameter.Type == AdgParamType.Number ? FunctionSyntax.NumberTypeKeyword : FunctionSyntax.TextTypeKeyword)}"));
            Console.WriteLine($"{FunctionSyntax.DefinitionKeyword} {function.Name}({parameters})");
        }

        foreach (var call in program.Calls)
        {
            Console.WriteLine($"{FunctionSyntax.CallKeyword} {call.FunctionName} ({call.Arguments.Count})");
        }
    }

    public static VerifiedAdgProgram LoadVerifiedProgram(string inputPath)
    {
        return AdgVerifier.Verify(new AdgProgram(LoadRoot(inputPath)));
    }

    public static IAdgNode LoadRoot(string inputPath)
    {
        if (Path.GetExtension(inputPath).Equals(".adg", StringComparison.OrdinalIgnoreCase))
        {
            return AdgSurfaceParser.ParseFile(inputPath);
        }

        using var json = JsonDocument.Parse(File.ReadAllText(inputPath, Utf8NoBom), new JsonDocumentOptions
        {
            AllowTrailingCommas = true,
            CommentHandling = JsonCommentHandling.Skip
        });

        return AdgJsonParser.Parse(json.RootElement);
    }
}
