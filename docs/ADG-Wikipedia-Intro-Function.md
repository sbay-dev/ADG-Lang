# ADG Wikipedia Intro Function

## Purpose

This document describes the ADG-Lang executable-function example that publishes
a shaped Arabic introduction about Abu al-Aswad al-Du'ali based on the Arabic
Wikipedia article lead.

The goal is demonstrative and commemorative: to show that ADG-Lang can author a
real function in canonical Arabic-inflected syntax, compile it through the
function pipeline, and emit a shaped Arabic text output.

## Source and license

| Item | Value |
| --- | --- |
| ADG source | `examples\apps\hello-adg\src\abu-al-aswad-wikipedia-intro.adg` |
| External source | Arabic Wikipedia page: `أبو الأسود الدؤلي` |
| URL | `https://ar.wikipedia.org/wiki/أبو_الأسود_الدؤلي` |
| License | Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0) |
| License URL | `https://creativecommons.org/licenses/by-sa/4.0/` |
| Adaptation license | The adapted ADG text in this example is distributed under CC BY-SA 4.0. |
| Attribution statement | The ADG output names Arabic Wikipedia, the source URL, the license, and the license URL in its first sentence. |
| Implementation directives | `docs\directives\ADG-WIKIPEDIA-INTRO-DIRECTIVES.md` |

The ADG text is a shaped, normalized ADG rendition based on the page lead. It is
not a historical text authored by Abu al-Aswad, and it must not be presented as
part of the transmitted early grammar layer. Because it is an adaptation of
Wikipedia content, this adapted text is also distributed under CC BY-SA 4.0.

## ADG function shape

```adg
اتجاهُ النصِّ: RTL
adg 0.1.1
program "مقدمةُ-أبي-الأسودِ-ويكيبيديا"

دالةٌ "مقدمةُ_أبي_الأسودِ_من_ويكيبيديا"
  متنٌ "..."
  مُخرَجٌ نصٌّ

استدعاءٌ "مقدمةُ_أبي_الأسودِ_من_ويكيبيديا"
```

This is the canonical ADG-Lang functional surface: functions are authored directly in
Arabic with correct i'rab as `.adg` source, never as JSON. Each keyword carries its
inflection and is checked at compile time:

- `دالةٌ` (nominative) declares the function.
- `متنٌ` (nominative) holds the fixed body text.
- `مُخرَجٌ نصٌّ` (nominative) declares a text output.
- `استدعاءٌ` (nominative) calls the function.

This example intentionally uses a zero-argument function because the published
text is a fixed attributed demonstration, not a generated biography from hidden
data.

## Compile and run

```powershell
dotnet run --project src\Adg.Compiler -- verify examples\apps\hello-adg\src\abu-al-aswad-wikipedia-intro.adg
dotnet run --project src\Adg.Compiler -- compile examples\apps\hello-adg\src\abu-al-aswad-wikipedia-intro.adg --emit-llvm artifacts\abu-al-aswad-wikipedia-intro.ll --native artifacts\abu-al-aswad-wikipedia-intro.exe
.\artifacts\abu-al-aswad-wikipedia-intro.exe
```

## Verification boundary

This example proves:

1. The `.adg` source uses the mandatory RTL header.
2. Function keywords are written with canonical i'rab.
3. The source passes the executable-function parser/type-checker.
4. The compiler emits LLVM IR and native output.
5. The resulting program prints shaped Arabic text with an explicit source and
   license attribution.

It does not prove that Wikipedia is a primary historical source, and it does not
claim full rhetorical correctness beyond the authored ADG text and the current
compiler checks.
