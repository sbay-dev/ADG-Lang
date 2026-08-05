using System.Globalization;
using System.Text;

namespace Adg.QuranicCore;

public static class QuranicTextNormalizer
{
    public static string NormalizeForAnalysis(string value)
    {
        var builder = new StringBuilder(value.Length);

        foreach (var rune in value.EnumerateRunes())
        {
            if (rune.Value == '\u0640' || IsArabicMark(rune))
            {
                continue;
            }

            builder.Append(rune.Value switch
            {
                0x0671 => 'ا',
                0x0622 => 'ا',
                0x0623 => 'ا',
                0x0625 => 'ا',
                0x0649 => 'ي',
                _ => rune.ToString()
            });
        }

        return builder.ToString().Normalize(NormalizationForm.FormC);
    }

    public static bool IsArabicRune(Rune rune) =>
        rune.Value is >= 0x0600 and <= 0x06FF
            or >= 0x0750 and <= 0x077F
            or >= 0x08A0 and <= 0x08FF
            or >= 0xFB50 and <= 0xFDFF
            or >= 0xFE70 and <= 0xFEFF;

    public static bool IsArabicMark(Rune rune)
    {
        var category = Rune.GetUnicodeCategory(rune);
        return category is UnicodeCategory.NonSpacingMark
            or UnicodeCategory.SpacingCombiningMark
            or UnicodeCategory.EnclosingMark
            || rune.Value is >= 0x06D6 and <= 0x06ED;
    }
}
