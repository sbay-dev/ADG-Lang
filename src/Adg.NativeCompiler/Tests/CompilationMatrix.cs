using System.Text;

namespace Adg.NativeCompiler;

internal static class CompilationMatrix
{
    private static readonly Encoding Utf8NoBom = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);

    private static readonly MatrixCase[] Cases =
    [
        new("proof-10-words", @"examples\proof-10-words.adg.json", true, null),
        new("causal-10-words", @"examples\causal-10-words.adg.json", true, null),
        new("invalid-fael-nasb", @"examples\invalid-fael-nasb.adg.json", false, "ADG1001 InvalidFaelCase"),
        new("invalid-maful-raf", @"examples\invalid-maful-raf.adg.json", false, "ADG1002 InvalidMafulCase"),
        new("invalid-jarr-raf", @"examples\invalid-jarr-raf.adg.json", false, "ADG1003 InvalidJarrOperand"),
        new("invalid-condition-missing-answer", @"examples\invalid-condition-missing-answer.adg.json", false, "ADG1004 MissingConditionalConsequence"),
        new("invalid-explanation-case-mismatch", @"examples\invalid-explanation-case-mismatch.adg.json", false, "ADG1005 ExplanationCaseMismatch"),
        new("invalid-question-missing-target", @"examples\invalid-question-missing-target.adg.json", false, "ADG1006 MissingInterrogativeTarget"),
        new("invalid-negation-no-target", @"examples\invalid-negation-no-target.adg.json", false, "ADG1007 MissingNegationTarget"),
        new("invalid-operator-arity", @"examples\invalid-operator-arity.adg.json", false, "ADG1008 InvalidOperatorArity"),
        new("invalid-hidden-reference-unresolved", @"examples\invalid-hidden-reference-unresolved.adg.json", false, "ADG1009 UnresolvedHiddenReference"),
        new("invalid-semantic-frame-empty", @"examples\invalid-semantic-frame-empty.adg.json", false, "ADG1010 InvalidSemanticFrame")
    ];

    public static int Run()
    {
        var root = FindRepositoryRoot();
        var outputDirectory = Path.Combine(root, "build", "matrix");
        Directory.CreateDirectory(outputDirectory);

        foreach (var matrixCase in Cases)
        {
            RunCase(root, outputDirectory, matrixCase);
        }

        Console.WriteLine("ADG compilation matrix passed: valid ASTs emitted LLVM IR, invalid ASTs emitted no LLVM IR.");
        return 0;
    }

    private static void RunCase(string root, string outputDirectory, MatrixCase matrixCase)
    {
        var inputPath = Path.Combine(root, matrixCase.RelativePath);
        var llvmPath = Path.Combine(outputDirectory, $"{matrixCase.Id}.ll");
        if (File.Exists(llvmPath))
        {
            File.Delete(llvmPath);
        }

        try
        {
            var verifiedProgram = CompilerCommand.LoadVerifiedProgram(inputPath);
            File.WriteAllText(llvmPath, LlvmModuleEmitter.Emit(verifiedProgram, Path.GetFileName(inputPath)), Utf8NoBom);

            if (!matrixCase.ShouldCompile)
            {
                throw new AdgTypeException($"{matrixCase.Id}: expected compilation failure, but LLVM IR was emitted.");
            }

            Console.WriteLine($"[PASS] {matrixCase.Id}: LLVM IR emitted.");
        }
        catch (AdgDiagnosticException ex)
        {
            if (matrixCase.ShouldCompile)
            {
                throw new AdgTypeException($"{matrixCase.Id}: expected LLVM IR emission, but compilation failed: {ex.Message}");
            }

            if (File.Exists(llvmPath))
            {
                throw new AdgTypeException($"{matrixCase.Id}: invalid AST produced LLVM IR at {llvmPath}.");
            }

            if (matrixCase.ExpectedErrorSubstring is not null && !ex.Message.Contains(matrixCase.ExpectedErrorSubstring, StringComparison.Ordinal))
            {
                throw new AdgTypeException($"{matrixCase.Id}: expected diagnostic containing '{matrixCase.ExpectedErrorSubstring}', received '{ex.Message}'.");
            }

            Console.WriteLine($"[PASS] {matrixCase.Id}: rejected before LLVM IR.");
        }
    }

    private static string FindRepositoryRoot()
    {
        var directory = Directory.GetCurrentDirectory();

        while (!string.IsNullOrEmpty(directory))
        {
            if (File.Exists(Path.Combine(directory, "ADG-Lang.Native.slnx")) && Directory.Exists(Path.Combine(directory, "examples")))
            {
                return directory;
            }

            directory = Directory.GetParent(directory)?.FullName;
        }

        throw new CliException("Could not locate ADG-Lang repository root.");
    }

    private sealed record MatrixCase(string Id, string RelativePath, bool ShouldCompile, string? ExpectedErrorSubstring);
}
