[CmdletBinding()]
param(
    [Uri]$BaseUrl,
    [string]$TokenFile
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($null -eq $BaseUrl) {
    $configuredUrl = [Environment]::GetEnvironmentVariable("CPOLY_WORKBENCH_URL")
    if ([string]::IsNullOrWhiteSpace($configuredUrl)) {
        throw "No remote CPOLY Workbench endpoint is configured. Set CPOLY_WORKBENCH_URL or pass -BaseUrl."
    }
    $BaseUrl = [Uri]$configuredUrl
}
if ([string]::IsNullOrWhiteSpace($TokenFile)) {
    $TokenFile = [Environment]::GetEnvironmentVariable("CPOLY_WORKBENCH_TOKEN_FILE")
}
if ($BaseUrl.Scheme -ne "https") {
    throw "A remote CPOLY Workbench endpoint must use HTTPS."
}
if ([string]::IsNullOrWhiteSpace($TokenFile) -or -not (Test-Path -LiteralPath $TokenFile -PathType Leaf)) {
    throw "Provide the external secret file through -TokenFile or CPOLY_WORKBENCH_TOKEN_FILE."
}

$packageRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$resolvedTokenFile = (Resolve-Path -LiteralPath $TokenFile).Path
if ($resolvedTokenFile.StartsWith($packageRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The Workbench token file must remain outside the package repository."
}

$token = (Get-Content -Raw -LiteralPath $resolvedTokenFile).Trim()
if ([string]::IsNullOrWhiteSpace($token)) {
    throw "The Workbench token file is empty."
}
$headers = @{ Authorization = "Bearer $token" }
$base = $BaseUrl.AbsoluteUri.TrimEnd("/")

$health = Invoke-RestMethod -Method Get -Uri "$base/healthz" -TimeoutSec 30
$status = Invoke-RestMethod -Method Get -Uri "$base/api/cpoly/v1/status" `
    -Headers $headers -TimeoutSec 30

if ($status.ok -ne $true) {
    throw "CPOLY Workbench status did not report ok."
}
if ($status.kubernetesControlMode -eq "disabled") {
    throw "CPOLY Workbench is reachable but Kubernetes control is disabled; it cannot verify a cluster target."
}

function Invoke-CpolyKubectl {
    param([string[]]$Arguments)

    $body = @{ args = $Arguments } | ConvertTo-Json -Compress
    $result = Invoke-RestMethod -Method Post `
        -Uri "$base/api/cpoly/v1/tools/kubectl" `
        -Headers $headers `
        -ContentType "application/json" `
        -Body $body `
        -TimeoutSec 60
    if ($result.ok -ne $true) {
        throw "CPOLY kubectl bridge failed: $($result.error)"
    }
    return $result
}

$version = Invoke-CpolyKubectl -Arguments @("version")
$storage = Invoke-CpolyKubectl -Arguments @("get", "storageclasses")
$statefulSets = Invoke-CpolyKubectl -Arguments @(
    "get", "statefulsets", "--namespace", "adg-data-plane"
)

[PSCustomObject]@{
    WorkbenchReachable = $true
    Product = $status.product
    Edition = $status.edition
    KubernetesControlMode = $status.kubernetesControlMode
    KubernetesNativeNode = $status.kubernetesNativeNode
    ClusterVersionQuerySucceeded = ($version.exitCode -eq 0)
    StorageClassQuerySucceeded = ($storage.exitCode -eq 0)
    AdgStatefulSetQuerySucceeded = ($statefulSets.exitCode -eq 0)
    PackageApplySupportedByWorkbenchApi = $false
}

