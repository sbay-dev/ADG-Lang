namespace Adg.NativeCompiler;

internal sealed record ContractTranslationOptions(
    string InputPath,
    string OutputPath,
    string? LlvmOutputPath,
    string? ReportPath,
    bool Print)
{
    public static ContractTranslationOptions Parse(string[] args)
    {
        if (args.Length == 0)
        {
            throw new CliException("translate-contract requires an input text file.");
        }

        var input = args[0];
        string? output = null;
        string? llvm = null;
        string? report = null;
        var print = false;

        for (var i = 1; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--out":
                    output = RequireValue(args, ref i, "--out");
                    break;
                case "--emit-llvm":
                    llvm = RequireValue(args, ref i, "--emit-llvm");
                    break;
                case "--report":
                    report = RequireValue(args, ref i, "--report");
                    break;
                case "--print":
                    print = true;
                    break;
                default:
                    throw new CliException($"Unknown translate-contract option '{args[i]}'.");
            }
        }

        output ??= Path.ChangeExtension(input, ".contract.adg");
        return new ContractTranslationOptions(input, output, llvm, report, print);
    }

    private static string RequireValue(string[] args, ref int index, string option)
    {
        if (index + 1 >= args.Length)
        {
            throw new CliException($"{option} requires a value.");
        }

        index++;
        return args[index];
    }
}
