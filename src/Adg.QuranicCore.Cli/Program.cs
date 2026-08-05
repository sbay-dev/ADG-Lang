using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Unicode;
using Adg.QuranicCore;

var jsonOptions = new JsonSerializerOptions
{
    Encoder = JavaScriptEncoder.Create(UnicodeRanges.All),
    WriteIndented = true,
    PropertyNameCaseInsensitive = true
};
jsonOptions.Converters.Add(new JsonStringEnumConverter());

if (args.Length == 0 || args[0] is "-h" or "--help")
{
    Console.WriteLine("""
    ADG-Lang Quranic Core v1

    Usage:
      dotnet run --project src\Adg.QuranicCore.Cli -- analyze-text "<Arabic text>"
      dotnet run --project src\Adg.QuranicCore.Cli -- analyze <input.txt>
      dotnet run --project src\Adg.QuranicCore.Cli -- verify-corpus <corpus.json> [--report <report.json>]
    """);
    return 0;
}

try
{
    var analyzer = new QuranicCausalityAnalyzer();
    switch (args[0])
    {
        case "analyze-text":
            if (args.Length < 2)
            {
                throw new ArgumentException("analyze-text requires Arabic text.");
            }

            var textAnalysis = analyzer.Analyze(
                string.Join(" ", args.Skip(1)));
            WriteJson(textAnalysis, jsonOptions);
            return textAnalysis.Diagnostics.Count == 0 ? 0 : 1;

        case "analyze":
            if (args.Length != 2)
            {
                throw new ArgumentException("analyze requires exactly one input file.");
            }

            var fileAnalysis = analyzer.Analyze(
                File.ReadAllText(Path.GetFullPath(args[1])));
            WriteJson(fileAnalysis, jsonOptions);
            return fileAnalysis.Diagnostics.Count == 0 ? 0 : 1;

        case "verify-corpus":
            if (args.Length is < 2 or > 4)
            {
                throw new ArgumentException(
                    "verify-corpus requires a corpus file and optional --report path.");
            }

            var reportPath = ParseReportPath(args.Skip(2).ToArray());
            var report = QuranicCorpusVerifier.Verify(
                Path.GetFullPath(args[1]),
                analyzer,
                jsonOptions);
            if (reportPath is not null)
            {
                var fullReportPath = Path.GetFullPath(reportPath);
                Directory.CreateDirectory(
                    Path.GetDirectoryName(fullReportPath)
                    ?? throw new InvalidOperationException("Report path has no directory."));
                File.WriteAllText(
                    fullReportPath,
                    JsonSerializer.Serialize(report, jsonOptions) + Environment.NewLine);
            }

            WriteJson(report, jsonOptions);
            return report.Passed ? 0 : 1;

        default:
            throw new ArgumentException(
                $"Unknown command '{args[0]}'. Use --help for usage.");
    }
}
catch (Exception ex) when (
    ex is ArgumentException
        or IOException
        or JsonException
        or UnauthorizedAccessException)
{
    Console.Error.WriteLine($"quranic-core-error: {ex.Message}");
    return 1;
}

static string? ParseReportPath(string[] args)
{
    if (args.Length == 0)
    {
        return null;
    }

    if (args.Length == 2 && args[0] == "--report")
    {
        return args[1];
    }

    throw new ArgumentException("Optional report syntax is '--report <report.json>'.");
}

static void WriteJson(object value, JsonSerializerOptions options) =>
    Console.WriteLine(JsonSerializer.Serialize(value, options));
