namespace Adg.NativeCompiler;

/// <summary>
/// Canonical, i'rab-correct keywords for the ADG text-refiner surface syntax.
/// </summary>
internal static class RefinerSyntax
{
    public const string RefinerKeyword = "مُنقِّحٌ";
    public const string LexiconKeyword = "معجمٌ";
    public const string VowelizationKeyword = "تشكيلُها";
    public const string NormalizationKeyword = "تطبيعٌ";
    public const string GuaranteeKeyword = "ضمانٌ";
    public const string VocalicLabel = "تشكيليٌّ";
    public const string RunKeyword = "تشغيلٌ";

    public const string CollapseSpacesFlag = "ضبطُ_المسافاتِ";
    public const string RemoveTatweelFlag = "إزالةُ_التطويلِ";
    public const string StripTashkeelFlag = "تجريدُ_التشكيلِ";

    public static bool TryParseFlag(string value, out NormalizationFlag flag)
    {
        if (string.Equals(value, CollapseSpacesFlag, StringComparison.Ordinal))
        {
            flag = NormalizationFlag.CollapseSpaces;
            return true;
        }

        if (string.Equals(value, RemoveTatweelFlag, StringComparison.Ordinal))
        {
            flag = NormalizationFlag.RemoveTatweel;
            return true;
        }

        if (string.Equals(value, StripTashkeelFlag, StringComparison.Ordinal))
        {
            flag = NormalizationFlag.StripTashkeel;
            return true;
        }

        flag = default;
        return false;
    }
}
