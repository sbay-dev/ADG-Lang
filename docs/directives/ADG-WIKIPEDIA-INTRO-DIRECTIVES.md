# ADG Wikipedia Intro Directives

These directives translate `docs\ADG-Wikipedia-Intro-Function.md` into
implementation requirements.

| Directive | Implementation target | Status |
| --- | --- | --- |
| The Wikipedia-based introduction must be authored as an executable ADG function, not as compiler-internal data | `examples\apps\hello-adg\src\abu-al-aswad-wikipedia-intro.adg` | Active |
| The source must explicitly attribute Arabic Wikipedia, the source URL, CC BY-SA 4.0, and the license URL | ADG comments and first output sentence in `abu-al-aswad-wikipedia-intro.adg` | Active |
| The adapted ADG text must be distributed under CC BY-SA 4.0 | ADG comments, output text, and `docs\ADG-Wikipedia-Intro-Function.md` | Active |
| The output must state that it is a Modern ADG demonstration, not a historical text by Abu al-Aswad | Body text in `abu-al-aswad-wikipedia-intro.adg`; docs boundary section | Active |
| The example must pass the existing function parser/type-checker before LLVM/native output | `AdgFunctionParser`, `FunctionTypeChecker`, `CompilerCommand.CompileFunctionProgram` | Active |
| The example must remain independent of hidden corpora or models | Zero-argument function with fixed authored `متنٌ` | Active |

## Required commands

```powershell
dotnet run --project src\Adg.Compiler -- verify examples\apps\hello-adg\src\abu-al-aswad-wikipedia-intro.adg
dotnet run --project src\Adg.Compiler -- compile examples\apps\hello-adg\src\abu-al-aswad-wikipedia-intro.adg --emit-llvm build\abu-al-aswad-wikipedia-intro.ll --native build\abu-al-aswad-wikipedia-intro.exe
.\build\abu-al-aswad-wikipedia-intro.exe
```
