namespace Adg.NativeCompiler;

internal static class VerifyCommand
{
    public static int Verify(string[] args)
    {
        if (args.Length != 1)
        {
            throw new CliException("verify requires exactly one ADG input file (.adg or .adg.json).");
        }

        try
        {
            var inputPath = Path.GetFullPath(args[0]);

            if (RefinerProgramDetector.IsRefinerProgram(inputPath))
            {
                var refinerProgram = AdgRefinerParser.ParseFile(inputPath);
                RefinerTypeChecker.Check(refinerProgram);
                var lexiconEntries = refinerProgram.Refiners.Sum(refiner => refiner.Lexicon.Count);
                Console.WriteLine($"PASSED {Path.GetFileName(inputPath)}");
                Console.WriteLine($"Refiners={refinerProgram.Refiners.Count}; LexiconEntries={lexiconEntries}; Run={refinerProgram.RunTarget}");
                return 0;
            }

            if (FunctionProgramDetector.IsFunctionProgram(inputPath))
            {
                var program = AdgFunctionParser.ParseFile(inputPath);
                FunctionTypeChecker.Check(program);
                Console.WriteLine($"PASSED {Path.GetFileName(inputPath)}");
                Console.WriteLine($"Functions={program.Functions.Count}; Calls={program.Calls.Count}");
                return 0;
            }

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
