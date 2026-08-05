using System.Text;

namespace Adg.NativeCompiler;

/// <summary>
/// Shared, deterministic Arabic text helpers. The same definitions of
/// "tashkeel" and "tatweel" are mirrored byte-for-byte by the ADG refine
/// runtime (adg_refine_runtime.c) so that compile-time keys and run-time
/// lookups agree exactly.
/// </summary>
internal static class ArabicText
{
    public const char Tatweel = '\u0640';

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

    public static string RemoveTatweel(string value) =>
        value.IndexOf(Tatweel) < 0 ? value : value.Replace("\u0640", string.Empty, StringComparison.Ordinal);

    /// <summary>
    /// The consonantal skeleton: the word with every tashkeel mark and every
    /// tatweel removed. Two words share a skeleton iff they differ only in
    /// vocalization/elongation, which is exactly the Semantic Conservation rule.
    /// </summary>
    public static string Skeletonize(string value) => RemoveTatweel(StripTashkeel(value));
}
