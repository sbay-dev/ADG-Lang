using System.ComponentModel;
using System.Diagnostics;

namespace Adg.NativeCompiler;

internal static class LlvmNativeCompiler
{
    public static void Compile(string llvmPath, string nativePath, string? clangPath) =>
        Compile(llvmPath, nativePath, clangPath, null);

    public static void Compile(string llvmPath, string nativePath, string? clangPath, IReadOnlyList<string>? extraSources)
    {
        var info = CreateClangProcess(clangPath);
        AddInputs(info, llvmPath, extraSources);

        info.ArgumentList.Add("-O2");
        info.ArgumentList.Add("-o");
        info.ArgumentList.Add(nativePath);

        RunClang(info);
    }

    public static void CompileWasi(
        string llvmPath,
        string wasmPath,
        string? clangPath,
        string? wasiSysrootPath,
        IReadOnlyList<string>? extraSources)
    {
        var wasiLlvmPath = PrepareWasiLlvmModule(llvmPath);
        var info = CreateClangProcess(clangPath);
        info.ArgumentList.Add("--target=wasm32-wasi");
        if (!string.IsNullOrWhiteSpace(wasiSysrootPath))
        {
            if (!Directory.Exists(wasiSysrootPath))
            {
                throw new CliException($"Provided WASI sysroot path does not exist: {wasiSysrootPath}");
            }

            info.ArgumentList.Add($"--sysroot={wasiSysrootPath}");
        }

        try
        {
            AddInputs(info, wasiLlvmPath, extraSources);
            info.ArgumentList.Add("-O2");
            info.ArgumentList.Add("-o");
            info.ArgumentList.Add(wasmPath);

            RunClang(info);
        }
        finally
        {
            if (!string.Equals(wasiLlvmPath, llvmPath, StringComparison.Ordinal))
            {
                File.Delete(wasiLlvmPath);
            }
        }
    }

    /*
     * Cross-compiles the emitted LLVM IR to a linked executable for an arbitrary
     * target triple (e.g. x86_64-w64-windows-gnu, x86_64-linux-gnu). clang carries
     * the code generator for every target it was built with; linking a runnable
     * binary still needs that target's runtime/sysroot, so callers surface an
     * actionable message when the toolchain is absent instead of a broken file.
     */
    public static void CompileTarget(
        string llvmPath,
        string outputPath,
        string targetTriple,
        string? clangPath,
        string? sysrootPath,
        bool useLld,
        IReadOnlyList<string>? extraSources)
    {
        var info = CreateClangProcess(clangPath);
        info.ArgumentList.Add($"--target={targetTriple}");
        if (useLld)
        {
            info.ArgumentList.Add("-fuse-ld=lld");
        }

        if (!string.IsNullOrWhiteSpace(sysrootPath))
        {
            if (!Directory.Exists(sysrootPath))
            {
                throw new CliException($"Provided sysroot path does not exist: {sysrootPath}");
            }

            info.ArgumentList.Add($"--sysroot={sysrootPath}");
        }

        AddInputs(info, llvmPath, extraSources);
        info.ArgumentList.Add("-O2");
        info.ArgumentList.Add("-o");
        info.ArgumentList.Add(outputPath);

        RunClang(info);
    }

    private static ProcessStartInfo CreateClangProcess(string? clangPath)
    {
        var clang = ResolveClang(clangPath);

        return new ProcessStartInfo(clang)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false
        };
    }

    private static void AddInputs(ProcessStartInfo info, string llvmPath, IReadOnlyList<string>? extraSources)
    {
        info.ArgumentList.Add(llvmPath);
        if (extraSources is not null)
        {
            foreach (var source in extraSources)
            {
                info.ArgumentList.Add(source);
            }
        }
    }

    private static void RunClang(ProcessStartInfo info)
    {
        using var process = Process.Start(info) ?? throw new CliException("Failed to start clang.");
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        process.WaitForExit();

        var combinedOutput = string.Concat(stdout.GetAwaiter().GetResult(), stderr.GetAwaiter().GetResult());
        if (process.ExitCode != 0)
        {
            throw new CliException($"clang failed with exit code {process.ExitCode}:{Environment.NewLine}{combinedOutput}");
        }
    }

    private static string PrepareWasiLlvmModule(string llvmPath)
    {
        var module = File.ReadAllText(llvmPath);
        var builder = new System.Text.StringBuilder();

        if (!module.Contains("target triple", StringComparison.Ordinal))
        {
            builder.AppendLine("target datalayout = \"e-m:e-p:32:32-p10:8:8-p20:8:8-i64:64-n32:64-S128-ni:1:10:20\"");
            builder.AppendLine("target triple = \"wasm32-unknown-wasi\"");
            builder.AppendLine();
        }

        if (module.Contains("define i32 @main(i32 %argc, ptr %argv)", StringComparison.Ordinal)
            && !module.Contains("@__main_argc_argv", StringComparison.Ordinal))
        {
            builder.AppendLine("@__main_argc_argv = hidden alias i32 (i32, ptr), ptr @main");
            builder.AppendLine();
        }
        else if (module.Contains("define i32 @main()", StringComparison.Ordinal)
            && !module.Contains("@__main_void", StringComparison.Ordinal))
        {
            builder.AppendLine("@__main_void = hidden alias i32 (), ptr @main");
            builder.AppendLine();
        }

        if (builder.Length == 0)
        {
            return llvmPath;
        }

        var injection = builder.ToString();
        var sourceIndex = module.IndexOf("source_filename =", StringComparison.Ordinal);
        if (sourceIndex >= 0)
        {
            var lineEnd = module.IndexOf('\n', sourceIndex);
            var insertAt = lineEnd >= 0 ? lineEnd + 1 : module.Length;
            module = module.Insert(insertAt, injection);
        }
        else
        {
            module = injection + module;
        }

        var wasiLlvmPath = Path.Combine(
            Path.GetDirectoryName(llvmPath) ?? ".",
            $"{Path.GetFileNameWithoutExtension(llvmPath)}.wasi{Path.GetExtension(llvmPath)}");
        File.WriteAllText(wasiLlvmPath, module);
        return wasiLlvmPath;
    }

    private static string ResolveClang(string? explicitPath)
    {
        if (!string.IsNullOrWhiteSpace(explicitPath))
        {
            if (!Path.IsPathFullyQualified(explicitPath)
                && explicitPath.IndexOfAny([Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar]) < 0)
            {
                return explicitPath;
            }

            if (!File.Exists(explicitPath))
            {
                throw new CliException($"Provided clang path does not exist: {explicitPath}");
            }

            return explicitPath;
        }

        foreach (var directory in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            var candidate = Path.Combine(directory, OperatingSystem.IsWindows() ? "clang.exe" : "clang");
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        var commonCandidates = new[]
        {
            @"C:\Program Files\LLVM\bin\clang.exe",
            @"C:\Program Files (x86)\LLVM\bin\clang.exe",
            @"C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\Llvm\x64\bin\clang.exe",
            @"C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Tools\Llvm\x64\bin\clang.exe",
            @"C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Tools\Llvm\x64\bin\clang.exe"
        };

        foreach (var candidate in commonCandidates)
        {
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        throw new CliException("LLVM clang was not found. Install LLVM, add clang to PATH, or pass --clang <path-to-clang>.");
    }
}
