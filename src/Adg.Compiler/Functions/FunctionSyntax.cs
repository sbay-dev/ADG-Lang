using System.Text;

namespace Adg.Compiler;

internal readonly record struct FunctionToken(string Text, bool IsQuoted);

internal static class FunctionSyntax
{
    public const string DefinitionKeyword = "دالةٌ";
    public const string ParametersKeyword = "مُعامِلاتُها";
    public const string BodyKeyword = "متنٌ";
    public const string ConditionKeyword = "شرطٌ";
    public const string ConsequenceKeyword = "جزاؤُهُ";
    public const string OutputKeyword = "مُخرَجٌ";
    public const string CallKeyword = "استدعاءٌ";

    public const string TextTypeKeyword = "نصٌّ";
    public const string NumberTypeKeyword = "عددٌ";

    public const string GreaterKeyword = "أكبرُ";
    public const string LessKeyword = "أصغرُ";
    public const string EqualKeyword = "يساوي";

    public const string RafLabel = "مرفوعٌ";
    public const string NasbLabel = "منصوبٌ";
    public const string JarrLabel = "مجرورٌ";

    public static List<FunctionToken> Tokenize(string line)
    {
        var tokens = new List<FunctionToken>();
        var index = 0;

        while (index < line.Length)
        {
            var current = line[index];
            if (char.IsWhiteSpace(current))
            {
                index++;
                continue;
            }

            if (current == '"')
            {
                var start = ++index;
                while (index < line.Length && line[index] != '"')
                {
                    index++;
                }

                if (index >= line.Length)
                {
                    throw new AdgParseException("Unterminated string literal in ADG function statement.");
                }

                tokens.Add(new FunctionToken(line[start..index], true));
                index++;
            }
            else
            {
                var start = index;
                while (index < line.Length && !char.IsWhiteSpace(line[index]) && line[index] != '"')
                {
                    index++;
                }

                tokens.Add(new FunctionToken(line[start..index], false));
            }
        }

        return tokens;
    }

    public static bool IsKeyword(string token, string canonical)
    {
        if (string.Equals(token, canonical, StringComparison.Ordinal))
        {
            return true;
        }

        if (string.Equals(StripTashkeel(token), StripTashkeel(canonical), StringComparison.Ordinal))
        {
            throw new AdgParseException(
                DiagnosticCode.InvalidKeywordIrab,
                $"Arabic keyword '{token}' must be written as '{canonical}'.");
        }

        return false;
    }

    public static bool TryParseInteger(string text, out long value)
    {
        value = 0;
        if (string.IsNullOrEmpty(text))
        {
            return false;
        }

        var builder = new StringBuilder(text.Length);
        var index = 0;
        var negative = false;

        if (text[0] is '-' or '\u2212')
        {
            negative = true;
            index = 1;
        }

        if (index >= text.Length)
        {
            return false;
        }

        for (; index < text.Length; index++)
        {
            var ch = text[index];
            if (ch is >= '0' and <= '9')
            {
                builder.Append(ch);
            }
            else if (ch is >= '\u0660' and <= '\u0669')
            {
                builder.Append((char)('0' + (ch - '\u0660')));
            }
            else if (ch is >= '\u06F0' and <= '\u06F9')
            {
                builder.Append((char)('0' + (ch - '\u06F0')));
            }
            else
            {
                return false;
            }
        }

        if (builder.Length == 0 || !long.TryParse(builder.ToString(), out var parsed))
        {
            return false;
        }

        value = negative ? -parsed : parsed;
        return true;
    }

    public static string StripTashkeel(string value) => ArabicText.StripTashkeel(value);
}

