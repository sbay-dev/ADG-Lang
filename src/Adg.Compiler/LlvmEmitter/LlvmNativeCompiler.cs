using System.ComponentModel;
using System.Diagnostics;

namespace Adg.Compiler;

internal static class LlvmNativeCompiler
{
    public static void Compile(string llvmPath, string nativePath, string? clangPath)
    {
        var clang = ResolveClang(clangPath);
        var info = new ProcessStartInfo(clang)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false
        };

        info.ArgumentList.Add(llvmPath);
        info.ArgumentList.Add("-O2");
        info.ArgumentList.Add("-o");
        info.ArgumentList.Add(nativePath);

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

    private static string ResolveClang(string? explicitPath)
    {
        if (!string.IsNullOrWhiteSpace(explicitPath))
        {
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

        throw new CliException("LLVM clang was not found. Install LLVM, add clang to PATH, or pass --clang <path-to-clang.exe>.");
    }
}

