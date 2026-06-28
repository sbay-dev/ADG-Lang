using System.ComponentModel;
using System.Text.Json;

namespace Adg.Compiler;

internal static class Program
{
    public static int Main(string[] args)
    {
        try
        {
            if (args.Length == 0 || args[0] is "-h" or "--help")
            {
                PrintHelp();
                return 0;
            }

            return args[0] switch
            {
                "compile" => CompilerCommand.Compile(CompileOptions.Parse(args.Skip(1).ToArray())),
                "verify" => VerifyCommand.Verify(args.Skip(1).ToArray()),
                "test-matrix" => CompilationMatrix.Run(),
                "--self-test" => SelfTest.Run(),
                _ => throw new CliException($"Unknown command '{args[0]}'. Use --help for usage.")
            };
        }
        catch (CliException ex)
        {
            Console.Error.WriteLine($"error: {ex.Message}");
            return 1;
        }
        catch (AdgDiagnosticException ex)
        {
            Console.Error.WriteLine($"adg-error: {ex.Message}");
            return 1;
        }
        catch (JsonException ex)
        {
            Console.Error.WriteLine($"json-error: {ex.Message}");
            return 1;
        }
        catch (IOException ex)
        {
            Console.Error.WriteLine($"io-error: {ex.Message}");
            return 1;
        }
        catch (UnauthorizedAccessException ex)
        {
            Console.Error.WriteLine($"access-error: {ex.Message}");
            return 1;
        }
        catch (Win32Exception ex)
        {
            Console.Error.WriteLine($"process-error: {ex.Message}");
            return 1;
        }
    }

    private static void PrintHelp()
    {
        Console.WriteLine("""
        ADG Native Compiler

        Usage:
          dotnet run --project src\Adg.Compiler -- verify <file.adg.json>
          dotnet run --project src\Adg.Compiler -- compile <file.adg.json> [--emit-llvm <out.ll>] [--native <out.exe>] [--clang <clang.exe>] [--print]
          dotnet run --project src\Adg.Compiler -- test-matrix
          dotnet run --project src\Adg.Compiler -- --self-test

        The compiler enforces the ADG-Lang contracts extracted from the current Markdown specifications:
          Fa'il requires Ism[Raf]
          Maf'ul requires Ism[Nasb]
          Idafa requires Ism + Ism[Jarr]
          Jarr operators require Jarr operands
          Conditional operators require a consequence clause
          Explanatory connectors require case agreement for object-to-object explanation

        Native output needs LLVM clang on PATH or passed through --clang.
        """);
    }
}
