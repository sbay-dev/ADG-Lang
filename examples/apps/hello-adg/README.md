# hello-adg

`hello-adg` is a minimal ADG-Lang application project.

It demonstrates the canonical ADG-Lang source surface: **Arabic-inflected (i'rab-typed) grammatical source**:

```text
src\main.adg
```

```adg
اتجاهُ النصِّ: RTL
adg 0.1.1
program "hello-adg"

جملةٌ فعليةٌ "كتبَ" فاعلُها "المبرمجُ" مرفوعٌ مفعولُها "التطبيقَ" منصوبٌ
رابطٌ "ثم" ترتيبٌ
جملةٌ فعليةٌ "شغّلَ" فاعلُها "النظامُ" مرفوعٌ مفعولُها "البرنامجَ" منصوبٌ
```

The grammar is enforced at compile time: a `فاعل` (subject) must be `مرفوع` (nominative)
and a `مفعول` (object) must be `منصوب` (accusative). Violations are rejected before any
LLVM IR is emitted.

The same program is also available as the equivalent low-level typed AST in
`src\main.adg.json`. That JSON form is the underlying representation the compiler builds
from the Arabic source; it is not the language you are expected to author by hand.

The app also includes an executable-function demo:

```text
src\abu-al-aswad-wikipedia-intro.adg
```

That function prints a shaped Arabic introduction based on the Arabic Wikipedia lead for Abu al-Aswad al-Du'ali, with explicit CC BY-SA attribution.

## Verify

```powershell
powershell -ExecutionPolicy Bypass -File scripts\verify.ps1
```

## Build LLVM IR

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build.ps1 -SkipNative
```

## Build Native and Run

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build.ps1
powershell -ExecutionPolicy Bypass -File scripts\run.ps1
```

## Verify the Wikipedia Function Demo

```powershell
dotnet run --project ..\..\..\src\Adg.Compiler -- verify src\abu-al-aswad-wikipedia-intro.adg
dotnet run --project ..\..\..\src\Adg.Compiler -- compile src\abu-al-aswad-wikipedia-intro.adg --emit-llvm artifacts\abu-al-aswad-wikipedia-intro.ll --native artifacts\abu-al-aswad-wikipedia-intro.exe
.\artifacts\abu-al-aswad-wikipedia-intro.exe
```
