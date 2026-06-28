namespace Adg.Compiler;

internal static class VerifyCommand
{
    public static int Verify(string[] args)
    {
        if (args.Length != 1)
        {
            throw new CliException("verify requires exactly one ADG JSON input file.");
        }

        try
        {
            var inputPath = Path.GetFullPath(args[0]);
            var verified = CompilerCommand.LoadVerifiedProgram(inputPath);
            Console.WriteLine($"PASSED {Path.GetFileName(inputPath)}");
            Console.WriteLine($"Relations={verified.Relations.Count}; Operators={verified.Operators.Count}; SemanticFrames={verified.SemanticFrames.Count}");
            return 0;
        }
        catch (AdgDiagnosticException ex)
        {
            Console.Error.WriteLine($"FAILED {ex.Message}");
            return 1;
        }
    }
}

