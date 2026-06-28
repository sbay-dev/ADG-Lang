namespace Adg.Compiler;

internal sealed record CompileOptions(
    string InputPath,
    string? LlvmOutputPath,
    string? NativeOutputPath,
    string? ClangPath,
    bool PrintRendered)
{
    public static CompileOptions Parse(string[] args)
    {
        if (args.Length == 0)
        {
            throw new CliException("compile requires an ADG JSON input file.");
        }

        var input = args[0];
        string? llvm = null;
        string? native = null;
        string? clang = null;
        var print = false;

        for (var i = 1; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--emit-llvm":
                    llvm = RequireValue(args, ref i, "--emit-llvm");
                    break;
                case "--native":
                    native = RequireValue(args, ref i, "--native");
                    break;
                case "--clang":
                    clang = RequireValue(args, ref i, "--clang");
                    break;
                case "--print":
                    print = true;
                    break;
                default:
                    throw new CliException($"Unknown compile option '{args[i]}'.");
            }
        }

        return new CompileOptions(input, llvm, native, clang, print);
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

