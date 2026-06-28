Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$Exe = Join-Path $ProjectRoot "artifacts\hello-adg.exe"

if (-not (Test-Path $Exe)) {
    throw "Executable not found. Run scripts\build.ps1 first."
}

& $Exe
