using System.ComponentModel;
using System.Text.Json;

namespace Adg.NativeCompiler;

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
                "build" => BuildCommand.Build(BuildOptions.Parse(args.Skip(1).ToArray())),
                "verify" => VerifyCommand.Verify(args.Skip(1).ToArray()),
                "translate-contract" => ContractTranslatorCommand.Translate(ContractTranslationOptions.Parse(args.Skip(1).ToArray())),
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
          dotnet run --project src\Adg.NativeCompiler -- verify <file.adg.json>
          dotnet run --project src\Adg.NativeCompiler -- compile <file.adg.json> [--emit-llvm <out.ll>] [--native <out.exe>] [--wasi <out.wasm>] [--wasi-sysroot <path>] [--clang <clang>] [--print]
          dotnet run --project src\Adg.NativeCompiler -- build <file.adg> --target <windows-mingw|linux-gcc|wasm|llvm|host> [--out <path>] [--emit-llvm <out.ll>] [--sysroot <path>] [--clang <clang>] [--print]
          dotnet run --project src\Adg.NativeCompiler -- translate-contract <clause.txt> --out <out.adg> [--emit-llvm <out.ll>] [--report <out.json>] [--print]
          dotnet run --project src\Adg.NativeCompiler -- test-matrix
          dotnet run --project src\Adg.NativeCompiler -- --self-test

        The compiler enforces the ADG-Lang contracts extracted from the current Markdown specifications:
          Fa'il requires Ism[Raf]
          Maf'ul requires Ism[Nasb]
          Idafa requires Ism + Ism[Jarr]
          Jarr operators require Jarr operands
          Conditional operators require a consequence clause
          Explanatory connectors require case agreement for object-to-object explanation
          Hidden references must resolve before verification
          Semantic frames require at least one syntactic part

        Native output needs LLVM clang on PATH or passed through --clang.
        WASI output uses clang --target=wasm32-wasi and usually needs a WASI sysroot.

        build wraps the same verified LLVM pipeline behind one target flag:
          --target llvm           writes portable LLVM IR (.ll); needs no external toolchain
          --target host           links a native executable for THIS machine
          --target windows-mingw  cross-compiles a Windows (MinGW-w64) .exe
          --target linux-gcc      cross-compiles a Linux (glibc) ELF
          --target wasm           compiles a WASI module (.wasm)
        Cross targets need their toolchain/sysroot reachable by clang (pass --sysroot);
        when it is missing the build fails closed with guidance instead of a broken file.

        A .adg file that defines functions (دالةٌ ... استدعاءٌ ...) compiles through the
        executable-function pipeline to a native program whose output depends on its
        arguments and conditions. See docs\ADG-Functions-Spec.md.

        translate-contract is a bounded bridge from supported Arabic contract clauses
        into an ADG function program; unsupported free-form clauses fail closed instead
        of producing unverifiable code.

        A .adg file that defines a refiner (مُنقِّحٌ ... تشغيلٌ ...) compiles through the
        text-refinement pipeline to a native program that reads text from stdin (or
        argv), vowelizes declared words from its lexicon and applies safe
        normalizations. See docs\ADG-Refiners-Spec.md.
        """);
    }
}
