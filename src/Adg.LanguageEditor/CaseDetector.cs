namespace Adg.LanguageEditor;

internal static class CaseDetector
{
    private static readonly char[] CaseMarks = ['َ', 'ُ', 'ِ', 'ً', 'ٌ', 'ٍ'];

    public static GrammarCase Detect(string surface)
    {
        foreach (var ch in surface.Reverse())
        {
            if (ch is 'ُ' or 'ٌ')
            {
                return GrammarCase.Raf;
            }

            if (ch is 'َ' or 'ً')
            {
                return GrammarCase.Nasb;
            }

            if (ch is 'ِ' or 'ٍ')
            {
                return GrammarCase.Jarr;
            }

            continue;
        }

        return GrammarCase.None;
    }

    public static bool HasAnyCaseMark(string text) => text.Any(ch => CaseMarks.Contains(ch));

    public static string SetCase(string surface, GrammarCase grammarCase)
    {
        var punctuation = "";
        while (surface.Length > 0 && "،.؛؟".Contains(surface[^1], StringComparison.Ordinal))
        {
            punctuation = surface[^1] + punctuation;
            surface = surface[..^1];
        }

        while (surface.Length > 0 && CaseMarks.Contains(surface[^1]))
        {
            surface = surface[..^1];
        }

        var mark = grammarCase switch
        {
            GrammarCase.Raf => "ُ",
            GrammarCase.Nasb => "َ",
            GrammarCase.Jarr => "ِ",
            _ => ""
        };

        return surface + mark + punctuation;
    }

    public static string NormalizeSurface(string surface)
    {
        var clean = surface.Trim('،', '.', '؛', '؟');
        foreach (var mark in CaseMarks)
        {
            clean = clean.Replace(mark.ToString(), "", StringComparison.Ordinal);
        }

        return clean;
    }
}
