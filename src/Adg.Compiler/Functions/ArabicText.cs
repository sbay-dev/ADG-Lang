using System.Text;

namespace Adg.Compiler;

internal static class ArabicText
{
    public static string StripTashkeel(string value)
    {
        var builder = new StringBuilder(value.Length);

        foreach (var ch in value.Trim())
        {
            if (ch is >= '\u064B' and <= '\u065F' or '\u0670')
            {
                continue;
            }

            builder.Append(ch);
        }

        return builder.ToString();
    }
}
