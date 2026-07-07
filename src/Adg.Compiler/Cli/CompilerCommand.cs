using System.Text;
using System.Text.Json;

namespace Adg.Compiler;

internal static class CompilerCommand
{
    private static readonly Encoding Utf8NoBom = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);

    public static int Compile(CompileOptions options)
    {
        var inputPath = Path.GetFullPath(options.InputPath);

        if (FunctionProgramDetector.IsFunctionProgram(inputPath))
        {
            return CompileFunctionProgram(options, inputPath);
        }

        var verifiedProgram = LoadVerifiedProgram(inputPath);
        var renderedText = verifiedProgram.RenderText();

        if (options.PrintRendered)
        {
            Console.WriteLine(renderedText);
        }

        var llvmPath = Path.GetFullPath(options.LlvmOutputPath
            ?? Path.Combine("build", $"{Path.GetFileNameWithoutExtension(inputPath)}.ll"));
        Directory.CreateDirectory(Path.GetDirectoryName(llvmPath) ?? ".");
        File.WriteAllText(llvmPath, LlvmModuleEmitter.Emit(verifiedProgram, Path.GetFileName(inputPath)), Utf8NoBom);
        Console.WriteLine($"LLVM IR: {llvmPath}");

        if (options.NativeOutputPath is not null)
        {
            var nativePath = Path.GetFullPath(options.NativeOutputPath);
            Directory.CreateDirectory(Path.GetDirectoryName(nativePath) ?? ".");
            LlvmNativeCompiler.Compile(llvmPath, nativePath, options.ClangPath);
            Console.WriteLine($"Native executable: {nativePath}");
        }

        return 0;
    }

    private static int CompileFunctionProgram(CompileOptions options, string inputPath)
    {
        var program = AdgFunctionParser.ParseFile(inputPath);
        FunctionTypeChecker.Check(program);

        if (options.PrintRendered)
        {
            PrintFunctionSummary(program);
        }

        var llvmPath = Path.GetFullPath(options.LlvmOutputPath
            ?? Path.Combine("build", $"{Path.GetFileNameWithoutExtension(inputPath)}.ll"));
        Directory.CreateDirectory(Path.GetDirectoryName(llvmPath) ?? ".");
        File.WriteAllText(llvmPath, LlvmFunctionEmitter.Emit(program, Path.GetFileName(inputPath)), Utf8NoBom);
        Console.WriteLine($"LLVM IR: {llvmPath}");

        if (options.NativeOutputPath is not null)
        {
            var nativePath = Path.GetFullPath(options.NativeOutputPath);
            Directory.CreateDirectory(Path.GetDirectoryName(nativePath) ?? ".");
            LlvmNativeCompiler.Compile(llvmPath, nativePath, options.ClangPath);
            Console.WriteLine($"Native executable: {nativePath}");
        }

        return 0;
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
        using var json = JsonDocument.Parse(File.ReadAllText(inputPath, Utf8NoBom), new JsonDocumentOptions
        {
            AllowTrailingCommas = true,
            CommentHandling = JsonCommentHandling.Skip
        });

        return AdgJsonParser.Parse(json.RootElement);
    }
}
