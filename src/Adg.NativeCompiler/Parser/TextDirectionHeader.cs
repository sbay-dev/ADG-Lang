namespace Adg.NativeCompiler;

internal static class TextDirectionHeader
{
    public const string Canonical = "اتجاهُ النصِّ: RTL";

    private static readonly string CanonicalLabel = NormalizeLabel("اتجاهُ النصِّ");

    public static bool IsHeaderLine(string line) => TryParseDirection(line, out _);

    public static void Validate(string firstNonEmptyLine)
    {
        if (!TryParseDirection(firstNonEmptyLine, out var direction))
        {
            throw new AdgParseException(
                DiagnosticCode.MissingTextDirectionHeader,
                $"Missing mandatory text direction header. First non-empty line must be '{Canonical}'.");
        }

        if (!string.Equals(direction, "RTL", StringComparison.OrdinalIgnoreCase))
        {
            throw new AdgParseException(
                DiagnosticCode.NonRtlTextDirection,
                $"ADG source text direction must be RTL. Use '{Canonical}'.");
        }
    }

    private static bool TryParseDirection(string line, out string direction)
    {
        direction = string.Empty;

        var colon = line.IndexOf(':', StringComparison.Ordinal);
        if (colon < 0)
        {
            return false;
        }

        if (!string.Equals(NormalizeLabel(line[..colon]), CanonicalLabel, StringComparison.Ordinal))
        {
            return false;
        }

        var value = line[(colon + 1)..].Trim();
        if (!string.Equals(value, "RTL", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(value, "LTR", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        direction = value;
        return true;
    }

    private static string NormalizeLabel(string value)
    {
        var stripped = FunctionSyntax.StripTashkeel(value);
        var parts = stripped.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return string.Join(' ', parts);
    }
}
