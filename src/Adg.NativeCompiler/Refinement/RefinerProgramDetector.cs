namespace Adg.NativeCompiler;

internal static class RefinerProgramDetector
{
    public static bool IsRefinerProgram(string path)
    {
        if (!Path.GetExtension(path).Equals(".adg", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return ContainsRefinerStatement(File.ReadAllLines(path));
    }

    public static bool ContainsRefinerStatement(IReadOnlyList<string> lines)
    {
        foreach (var rawLine in lines)
        {
            var line = StripComment(rawLine).Trim();
            if (line.Length == 0)
            {
                continue;
            }

            var firstToken = ReadFirstToken(line);
            var normalized = ArabicText.StripTashkeel(firstToken);

            if (string.Equals(normalized, ArabicText.StripTashkeel(RefinerSyntax.RefinerKeyword), StringComparison.Ordinal)
                || string.Equals(normalized, ArabicText.StripTashkeel(RefinerSyntax.RunKeyword), StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }

    private static string ReadFirstToken(string line)
    {
        var end = 0;
        while (end < line.Length && !char.IsWhiteSpace(line[end]) && line[end] != '"')
        {
            end++;
        }

        return line[..end];
    }

    private static string StripComment(string line)
    {
        var index = line.IndexOf('#', StringComparison.Ordinal);
        return index < 0 ? line : line[..index];
    }
}
