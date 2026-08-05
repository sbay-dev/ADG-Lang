using System.Collections.Frozen;
using System.Text;

namespace Adg.QuranicCorpus;

public static class ExtendedBuckwalter
{
    public const string SourceUrl = "https://corpus.quran.com/java/buckwalter.jsp";

    private static readonly FrozenDictionary<char, char> BuckwalterToArabic =
        new Dictionary<char, char>
        {
            ['\''] = '\u0621',
            ['>'] = '\u0623',
            ['&'] = '\u0624',
            ['<'] = '\u0625',
            ['}'] = '\u0626',
            ['A'] = '\u0627',
            ['b'] = '\u0628',
            ['p'] = '\u0629',
            ['t'] = '\u062A',
            ['v'] = '\u062B',
            ['j'] = '\u062C',
            ['H'] = '\u062D',
            ['x'] = '\u062E',
            ['d'] = '\u062F',
            ['*'] = '\u0630',
            ['r'] = '\u0631',
            ['z'] = '\u0632',
            ['s'] = '\u0633',
            ['$'] = '\u0634',
            ['S'] = '\u0635',
            ['D'] = '\u0636',
            ['T'] = '\u0637',
            ['Z'] = '\u0638',
            ['E'] = '\u0639',
            ['g'] = '\u063A',
            ['_'] = '\u0640',
            ['f'] = '\u0641',
            ['q'] = '\u0642',
            ['k'] = '\u0643',
            ['l'] = '\u0644',
            ['m'] = '\u0645',
            ['n'] = '\u0646',
            ['h'] = '\u0647',
            ['w'] = '\u0648',
            ['Y'] = '\u0649',
            ['y'] = '\u064A',
            ['F'] = '\u064B',
            ['N'] = '\u064C',
            ['K'] = '\u064D',
            ['a'] = '\u064E',
            ['u'] = '\u064F',
            ['i'] = '\u0650',
            ['~'] = '\u0651',
            ['o'] = '\u0652',
            ['^'] = '\u0653',
            ['#'] = '\u0654',
            ['`'] = '\u0670',
            ['{'] = '\u0671',
            [':'] = '\u06DC',
            ['@'] = '\u06DF',
            ['"'] = '\u06E0',
            ['['] = '\u06E2',
            [';'] = '\u06E3',
            [','] = '\u06E5',
            ['.'] = '\u06E6',
            ['!'] = '\u06E8',
            ['-'] = '\u06EA',
            ['+'] = '\u06EB',
            ['%'] = '\u06EC',
            [']'] = '\u06ED',
        }.ToFrozenDictionary();

    private static readonly FrozenDictionary<char, char> ArabicToBuckwalter =
        BuckwalterToArabic.ToFrozenDictionary(
            pair => pair.Value,
            pair => pair.Key);

    public static IReadOnlyDictionary<char, char> Mappings => BuckwalterToArabic;

    public static string Decode(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        var builder = new StringBuilder(value.Length);
        foreach (var character in value)
        {
            if (character == ' ')
            {
                builder.Append(character);
                continue;
            }

            if (!BuckwalterToArabic.TryGetValue(character, out var arabic))
            {
                throw new FormatException(
                    $"Unsupported extended Buckwalter character '{character}' (U+{(int)character:X4}).");
            }

            builder.Append(arabic);
        }

        return builder.ToString();
    }

    public static string Encode(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        var builder = new StringBuilder(value.Length);
        foreach (var character in value)
        {
            if (character == ' ')
            {
                builder.Append(character);
                continue;
            }

            if (!ArabicToBuckwalter.TryGetValue(character, out var buckwalter))
            {
                throw new FormatException(
                    $"Unsupported Quranic Arabic character U+{(int)character:X4}.");
            }

            builder.Append(buckwalter);
        }

        return builder.ToString();
    }
}
