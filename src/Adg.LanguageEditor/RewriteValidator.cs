namespace Adg.LanguageEditor;

internal sealed class RewriteValidator(AdgVerifierClient verifierClient)
{
    public bool Verify(string text)
    {
        var tokens = new Tokenizer().Tokenize(text).Where(token => token.Surface != "،" && token.Surface != ".").ToArray();

        if (tokens.Any(token => token.NormalizedSurface == "أي") && TryBuildExplanationJson(tokens, out var explanationJson))
        {
            return verifierClient.VerifyJson(explanationJson);
        }

        if (TryBuildVerbalAdg(tokens, out var adg))
        {
            return verifierClient.VerifySurface(adg);
        }

        return false;
    }

    private static bool TryBuildVerbalAdg(IReadOnlyList<TokenInfo> tokens, out string adg)
    {
        adg = "";
        if (tokens.Count < 3 || !tokens[0].LooksLikeVerb)
        {
            return false;
        }

        var lines = new List<string>
        {
            "اتجاهُ النصِّ: RTL",
            "adg 0.1.1",
            "program \"candidate\"",
            "",
            $"جملةٌ فعليةٌ \"{tokens[0].Surface}\" فاعلُها \"{tokens[1].Surface}\" {ToAdgCase(tokens[1].Case)} مفعولُها \"{tokens[2].Surface}\" {ToAdgCase(tokens[2].Case)}"
        };

        var jarrIndex = Array.FindIndex(tokens.ToArray(), token => token.NormalizedSurface is "في" or "من" or "إلى" or "على" or "عن");
        if (jarrIndex >= 0 && tokens.Count > jarrIndex + 1)
        {
            var mudaf = tokens[jarrIndex + 1];
            var mudafIlayh = tokens.Count > jarrIndex + 2 ? tokens[jarrIndex + 2] : tokens[jarrIndex + 1];
            lines.Add($"جارٌّ ومجرورٌ \"{tokens[jarrIndex].Surface}\" إضافةٌ \"{mudaf.Surface}\" {ToAdgCase(mudaf.Case)} \"{mudafIlayh.Surface}\" {ToAdgCase(mudafIlayh.Case)}");
        }

        adg = string.Join(Environment.NewLine, lines);
        return true;
    }

    private static bool TryBuildExplanationJson(IReadOnlyList<TokenInfo> tokens, out string json)
    {
        json = "";
        var connectorIndex = Array.FindIndex(tokens.ToArray(), token => token.NormalizedSurface == "أي");
        if (connectorIndex <= 0 || connectorIndex >= tokens.Count - 1)
        {
            return false;
        }

        var explained = tokens[connectorIndex - 1];
        var explanation = tokens[connectorIndex + 1];
        json = $$"""
        {
          "kind": "explanation",
          "operator": "أي",
          "explained": { "kind": "ism", "surface": "{{explained.Surface}}", "case": "{{ToAdgCase(explained.Case)}}" },
          "explanation": { "kind": "ism", "surface": "{{explanation.Surface}}", "case": "{{ToAdgCase(explanation.Case)}}" }
        }
        """;
        return true;
    }

    private static string ToAdgCase(GrammarCase grammarCase) => grammarCase switch
    {
        GrammarCase.Raf => "مرفوعٌ",
        GrammarCase.Nasb => "منصوبٌ",
        GrammarCase.Jarr => "مجرورٌ",
        GrammarCase.Jazm => "مجزومٌ",
        _ => "none"
    };
}
