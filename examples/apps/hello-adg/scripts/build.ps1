param(
    [string]$CompilerProject,
    [switch]$SkipNative
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")

if (-not $CompilerProject) {
    $CompilerProject = Join-Path $RepoRoot "src\Adg.Compiler"
}

$Entry = Join-Path $ProjectRoot "src\main.adg.json"
$Artifacts = Join-Path $ProjectRoot "artifacts"
$Llvm = Join-Path $Artifacts "hello-adg.ll"
$Exe = Join-Path $Artifacts "hello-adg.exe"

if (-not (Test-Path $Artifacts)) {
    New-Item -ItemType Directory -Path $Artifacts | Out-Null
}

if ($SkipNative) {
    dotnet run --project $CompilerProject -- compile $Entry --emit-llvm $Llvm --print
} else {
    dotnet run --project $CompilerProject -- compile $Entry --emit-llvm $Llvm --native $Exe --print
}
