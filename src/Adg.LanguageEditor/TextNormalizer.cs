namespace Adg.LanguageEditor;

internal sealed class TextNormalizer
{
    public string Normalize(string text)
    {
        var normalized = text
            .Replace("ـ", "", StringComparison.Ordinal)
            .Replace(" ,", "،", StringComparison.Ordinal)
            .Replace(",", "،", StringComparison.Ordinal)
            .Replace("،", "، ", StringComparison.Ordinal);

        while (normalized.Contains("  ", StringComparison.Ordinal))
        {
            normalized = normalized.Replace("  ", " ", StringComparison.Ordinal);
        }

        return normalized.Trim();
    }
}
