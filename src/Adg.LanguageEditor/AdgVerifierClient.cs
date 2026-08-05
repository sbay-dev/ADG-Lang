using System.Diagnostics;

namespace Adg.LanguageEditor;

internal sealed class AdgVerifierClient(string compilerProject)
{
    public static AdgVerifierClient Discover()
    {
        var current = Directory.GetCurrentDirectory();
        while (!string.IsNullOrWhiteSpace(current))
        {
            var candidate = Path.Combine(current, "src", "Adg.NativeCompiler", "Adg.NativeCompiler.csproj");
            if (File.Exists(candidate))
            {
                return new AdgVerifierClient(candidate);
            }

            current = Directory.GetParent(current)?.FullName;
        }

        throw new InvalidOperationException("Could not locate src\\Adg.NativeCompiler.");
    }

    public bool VerifySurface(string adgText)
    {
        var path = Path.Combine(Path.GetTempPath(), $"adg-candidate-{Guid.NewGuid():N}.adg");
        File.WriteAllText(path, adgText);
        return VerifyFile(path);
    }

    public bool VerifyJson(string jsonText)
    {
        var path = Path.Combine(Path.GetTempPath(), $"adg-candidate-{Guid.NewGuid():N}.adg.json");
        File.WriteAllText(path, jsonText);
        return VerifyFile(path);
    }

    private bool VerifyFile(string path)
    {
        try
        {
            var startInfo = new ProcessStartInfo("dotnet")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false
            };
            startInfo.ArgumentList.Add("run");
            startInfo.ArgumentList.Add("--project");
            startInfo.ArgumentList.Add(compilerProject);
            startInfo.ArgumentList.Add("--");
            startInfo.ArgumentList.Add("verify");
            startInfo.ArgumentList.Add(path);

            using var process = Process.Start(startInfo) ?? throw new InvalidOperationException("Failed to start ADG verifier.");
            process.WaitForExit();
            return process.ExitCode == 0;
        }
        finally
        {
            File.Delete(path);
        }
    }
}
