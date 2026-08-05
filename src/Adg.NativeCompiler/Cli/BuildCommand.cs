namespace Adg.NativeCompiler;

internal static class BuildCommand
{
    public static int Build(BuildOptions options)
    {
        var inputPath = Path.GetFullPath(options.InputPath);
        var stem = CleanStem(inputPath);

        var llvmPath = Path.GetFullPath(options.LlvmOutputPath
            ?? Path.Combine("build", $"{stem}.ll"));

        var emission = CompilerCommand.EmitLlvmIr(inputPath, llvmPath, options.PrintRendered);

        if (options.Target == BuildTarget.Llvm)
        {
            Console.WriteLine($"Build target: llvm -> {llvmPath}");
            return 0;
        }

        var outputPath = Path.GetFullPath(options.OutputPath ?? DefaultOutput(stem, options.Target));
        Directory.CreateDirectory(Path.GetDirectoryName(outputPath) ?? ".");

        IReadOnlyList<string>? extraSources = emission.IsRefiner
            ? [RefineRuntime.WriteTo(Path.GetDirectoryName(llvmPath) ?? ".")]
            : null;

        try
        {
            switch (options.Target)
            {
                case BuildTarget.Host:
                    LlvmNativeCompiler.Compile(llvmPath, outputPath, options.ClangPath, extraSources);
                    break;
                case BuildTarget.Wasm:
                    var wasmSysroot = options.SysrootPath
                        ?? Environment.GetEnvironmentVariable("WASI_SYSROOT");
                    LlvmNativeCompiler.CompileWasi(llvmPath, outputPath, options.ClangPath, wasmSysroot, extraSources);
                    break;
                case BuildTarget.WindowsMingw:
                    LlvmNativeCompiler.CompileTarget(
                        llvmPath, outputPath, "x86_64-w64-windows-gnu",
                        options.ClangPath, options.SysrootPath, useLld: true, extraSources);
                    break;
                case BuildTarget.LinuxGcc:
                    LlvmNativeCompiler.CompileTarget(
                        llvmPath, outputPath, "x86_64-linux-gnu",
                        options.ClangPath, options.SysrootPath, useLld: true, extraSources);
                    break;
                default:
                    throw new CliException($"Unhandled build target '{options.Target}'.");
            }
        }
        catch (CliException ex)
        {
            throw new CliException(
                $"Build target '{TargetName(options.Target)}' could not produce '{outputPath}'.{Environment.NewLine}" +
                $"{ToolchainHint(options.Target)}{Environment.NewLine}" +
                $"Underlying toolchain error:{Environment.NewLine}{ex.Message}");
        }

        Console.WriteLine($"Build target: {TargetName(options.Target)} -> {outputPath}");
        return 0;
    }

    private static string CleanStem(string inputPath)
    {
        var stem = Path.GetFileNameWithoutExtension(inputPath);
        if (stem.EndsWith(".adg", StringComparison.OrdinalIgnoreCase))
        {
            stem = stem[..^4];
        }

        return stem;
    }

    private static string DefaultOutput(string stem, BuildTarget target) => target switch
    {
        BuildTarget.Wasm => Path.Combine("build", $"{stem}.wasm"),
        BuildTarget.WindowsMingw => Path.Combine("build", $"{stem}.exe"),
        BuildTarget.LinuxGcc => Path.Combine("build", stem),
        BuildTarget.Host => Path.Combine("build", OperatingSystem.IsWindows() ? $"{stem}.exe" : stem),
        _ => Path.Combine("build", stem)
    };

    private static string TargetName(BuildTarget target) => target switch
    {
        BuildTarget.Llvm => "llvm",
        BuildTarget.Wasm => "wasm",
        BuildTarget.WindowsMingw => "windows-mingw",
        BuildTarget.LinuxGcc => "linux-gcc",
        BuildTarget.Host => "host",
        _ => target.ToString().ToLowerInvariant()
    };

    private static string ToolchainHint(BuildTarget target) => target switch
    {
        BuildTarget.WindowsMingw =>
            "This target cross-compiles to a Windows (MinGW-w64) executable. clang needs the MinGW-w64 runtime/headers reachable (pass --sysroot <mingw-root>) plus LLVM lld. On a MinGW-w64 host clang links directly.",
        BuildTarget.LinuxGcc =>
            "This target cross-compiles to a Linux (glibc) ELF. From a non-Linux host it needs a Linux sysroot (glibc + crt objects) via --sysroot and LLVM ld.lld, or build it on a Linux host with gcc/clang.",
        BuildTarget.Wasm =>
            "This target compiles to a WASI module. It needs a WASI sysroot (wasi-libc) via --sysroot (or the WASI_SYSROOT environment variable) and LLVM wasm-ld.",
        BuildTarget.Host =>
            "The host target needs a C toolchain/runtime for this machine reachable by clang (on Windows: MSVC libraries + Windows SDK, or MinGW-w64).",
        _ => string.Empty
    };
}
