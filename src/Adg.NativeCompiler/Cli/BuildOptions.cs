namespace Adg.NativeCompiler;

internal enum BuildTarget
{
    Llvm,
    Wasm,
    WindowsMingw,
    LinuxGcc,
    Host
}

internal sealed record BuildOptions(
    string InputPath,
    BuildTarget Target,
    string? OutputPath,
    string? LlvmOutputPath,
    string? SysrootPath,
    string? ClangPath,
    bool PrintRendered)
{
    public const string ValidTargets = "windows-mingw|linux-gcc|wasm|llvm|host";

    public static BuildOptions Parse(string[] args)
    {
        if (args.Length == 0)
        {
            throw new CliException("build requires an ADG source file (.adg or .adg.json).");
        }

        var input = args[0];
        BuildTarget? target = null;
        string? output = null;
        string? llvm = null;
        string? sysroot = null;
        string? clang = null;
        var print = false;

        for (var i = 1; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--target":
                    target = ParseTarget(RequireValue(args, ref i, "--target"));
                    break;
                case "--out":
                case "-o":
                    output = RequireValue(args, ref i, "--out");
                    break;
                case "--emit-llvm":
                    llvm = RequireValue(args, ref i, "--emit-llvm");
                    break;
                case "--sysroot":
                    sysroot = RequireValue(args, ref i, "--sysroot");
                    break;
                case "--clang":
                    clang = RequireValue(args, ref i, "--clang");
                    break;
                case "--print":
                    print = true;
                    break;
                default:
                    throw new CliException($"Unknown build option '{args[i]}'.");
            }
        }

        if (target is null)
        {
            throw new CliException($"build requires --target <{ValidTargets}>.");
        }

        return new BuildOptions(input, target.Value, output, llvm, sysroot, clang, print);
    }

    public static BuildTarget ParseTarget(string value) => value switch
    {
        "llvm" => BuildTarget.Llvm,
        "wasm" or "wasi" => BuildTarget.Wasm,
        "windows-mingw" => BuildTarget.WindowsMingw,
        "linux-gcc" => BuildTarget.LinuxGcc,
        "host" or "native" => BuildTarget.Host,
        _ => throw new CliException($"Unknown build target '{value}'. Valid targets: {ValidTargets}.")
    };

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
