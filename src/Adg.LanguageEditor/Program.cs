using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Unicode;

namespace Adg.LanguageEditor;

internal static class Program
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.Create(UnicodeRanges.All)
    };

    public static int Main(string[] args)
    {
        try
        {
            if (args.Length == 0 || args[0] is "-h" or "--help")
            {
                PrintHelp();
                return 0;
            }

            var command = args[0].ToLowerInvariant();
            var text = ReadText(args.Skip(1).ToArray());
            var engine = GrammarRefinementEngine.CreateDefault();

            if (command == "trace")
            {
                var trace = engine.Trace(text);
                Console.WriteLine(JsonSerializer.Serialize(trace, JsonOptions));
                return trace.Result.Valid || trace.Result.VerifiedSuggestion is not null ? 0 : 1;
            }

            var result = command switch
            {
                "analyze" => engine.Analyze(text),
                "correct" => engine.Correct(text),
                "explain" => engine.Explain(text),
                "rewrite" => engine.Rewrite(text),
                _ => throw new InvalidOperationException($"Unknown command '{command}'.")
            };

            Console.WriteLine(JsonSerializer.Serialize(result, JsonOptions));
            return result.Valid || result.VerifiedSuggestion is not null ? 0 : 1;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"error: {ex.Message}");
            return 1;
        }
    }

    private static string ReadText(string[] args)
    {
        for (var i = 0; i < args.Length; i++)
        {
            if (args[i] == "--text" && i + 1 < args.Length)
            {
                return args[i + 1];
            }
        }

        var joined = string.Join(' ', args.Where(arg => arg != "--text"));
        if (!string.IsNullOrWhiteSpace(joined))
        {
            return joined;
        }

        throw new InvalidOperationException("Text is required. Use --text \"...\".");
    }

    private static void PrintHelp()
    {
        Console.WriteLine("""
        ADG Arabic Grammar Refinement Engine

        Usage:
          dotnet run --project src\Adg.LanguageEditor -- analyze --text "كتبَ الطالبَ الدرسُ"
          dotnet run --project src\Adg.LanguageEditor -- correct --text "كتبَ الطالبَ الدرسُ"
          dotnet run --project src\Adg.LanguageEditor -- explain --text "رأيتُ ليثًا أي أسدٌ"
          dotnet run --project src\Adg.LanguageEditor -- rewrite --text "كتب الطالب الدرس قرأ المعلم الكتاب"
          dotnet run --project src\Adg.LanguageEditor -- trace --text "كتبَ الطالبَ الدرسُ"
        """);
    }
}
