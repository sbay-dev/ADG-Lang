using System.Reflection;

namespace Adg.QuranicCorpus;

public static class QacAttribution
{
    public const string SourceName = "Quranic Arabic Corpus";

    public const string SourceUrl = "https://corpus.quran.com";

    public const string Version = "0.4";

    private const string ResourceName = "Adg.QuranicCorpus.Licenses.QacV04.txt";

    public static string ReadRequiredNotice()
    {
        using var stream = Assembly
            .GetExecutingAssembly()
            .GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException(
                $"Embedded attribution resource '{ResourceName}' was not found.");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}
