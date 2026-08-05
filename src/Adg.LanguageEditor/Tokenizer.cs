namespace Adg.LanguageEditor;

internal sealed class Tokenizer
{
    public IEnumerable<TokenInfo> Tokenize(string text)
    {
        var rawTokens = text
            .Replace("،", " ، ", StringComparison.Ordinal)
            .Replace(".", " . ", StringComparison.Ordinal)
            .Split(' ', StringSplitOptions.RemoveEmptyEntries);

        for (var index = 0; index < rawTokens.Length; index++)
        {
            var surface = rawTokens[index];
            yield return new TokenInfo(
                surface,
                CaseDetector.NormalizeSurface(surface),
                index,
                CaseDetector.Detect(surface),
                LooksLikeVerb(surface, index));
        }
    }

    private static bool LooksLikeVerb(string surface, int index) =>
        index == 0 || surface.EndsWith('َ') || surface.EndsWith("تُ", StringComparison.Ordinal);
}
