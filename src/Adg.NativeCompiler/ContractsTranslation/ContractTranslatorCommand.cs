using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Adg.NativeCompiler;

internal static class ContractTranslatorCommand
{
    private static readonly Encoding Utf8NoBom = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);

    public static int Translate(ContractTranslationOptions options)
    {
        var inputPath = Path.GetFullPath(options.InputPath);
        var outputPath = Path.GetFullPath(options.OutputPath);
        var sourceText = File.ReadAllText(inputPath, Utf8NoBom);
        var document = ContractClauseTranslator.TranslateDocument(sourceText);
        var adg = ContractClauseTranslator.ToAdg(document);

        Directory.CreateDirectory(Path.GetDirectoryName(outputPath) ?? ".");
        File.WriteAllText(outputPath, adg, Utf8NoBom);
        Console.WriteLine($"ADG source: {outputPath}");
        Console.WriteLine($"Clauses: {document.Clauses.Count}");

        if (options.Print)
        {
            for (var index = 0; index < document.Clauses.Count; index++)
            {
                var clause = document.Clauses[index];
                Console.WriteLine($"البند {index + 1}: {clause.Kind}");
                Console.WriteLine($"الطرف الأساسي: {clause.PrimaryParty}");
                Console.WriteLine($"المحتوى: {clause.Action}");
                if (clause.SecondaryParty.Length > 0)
                {
                    Console.WriteLine($"الطرف الثانوي: {clause.SecondaryParty}");
                }

                if (clause.DueText.Length > 0)
                {
                    Console.WriteLine($"الاستحقاق: {clause.DueText}");
                }

                Console.WriteLine($"المبلغ: {clause.Amount}");
                Console.WriteLine("الأدلة: " + string.Join(" | ", clause.Evidence));
            }
        }

        if (options.ReportPath is not null)
        {
            var reportPath = Path.GetFullPath(options.ReportPath);
            Directory.CreateDirectory(Path.GetDirectoryName(reportPath) ?? ".");
            var jsonOptions = new JsonSerializerOptions
            {
                WriteIndented = true
            };
            jsonOptions.Converters.Add(new JsonStringEnumConverter());
            File.WriteAllText(reportPath, JsonSerializer.Serialize(document, jsonOptions), Utf8NoBom);
            Console.WriteLine($"Report: {reportPath}");
        }

        if (options.LlvmOutputPath is not null)
        {
            var program = AdgFunctionParser.ParseLines(adg.Split('\n'));
            FunctionTypeChecker.Check(program);
            var llvmPath = Path.GetFullPath(options.LlvmOutputPath);
            Directory.CreateDirectory(Path.GetDirectoryName(llvmPath) ?? ".");
            File.WriteAllText(llvmPath, LlvmFunctionEmitter.Emit(program, Path.GetFileName(outputPath)), Utf8NoBom);
            Console.WriteLine($"LLVM IR: {llvmPath}");
        }

        return 0;
    }
}
