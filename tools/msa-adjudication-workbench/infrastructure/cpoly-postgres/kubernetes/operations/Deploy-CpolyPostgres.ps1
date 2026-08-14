[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Context,
    [switch]$Apply
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not (Get-Command kubectl -ErrorAction SilentlyContinue)) {
    throw "kubectl is required as the governed external-cluster deployment client."
}
if ($Context -match "(?i)(docker-desktop|minikube|kind|k3d|rancher-desktop)") {
    throw "Local Kubernetes contexts are not eligible for the production CPOLY data plane."
}

$packageRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$server = kubectl --context $Context config view --minify `
    -o "jsonpath={.clusters[0].cluster.server}" 2>$null
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($server)) {
    throw "The requested Kubernetes context is not configured: $Context"
}

$serverUri = [Uri]$server
if ($serverUri.Host -in @(
    "localhost",
    "127.0.0.1",
    "::1",
    "kubernetes.docker.internal",
    "host.docker.internal"
)) {
    throw "The Kubernetes API endpoint is local and cannot be the production CPOLY data plane."
}

$canCreateStatefulSet = kubectl --context $Context auth can-i `
    create statefulsets.apps --namespace adg-data-plane
if ($LASTEXITCODE -ne 0 -or $canCreateStatefulSet.Trim() -ne "yes") {
    throw "The governed deployment identity cannot create StatefulSets in adg-data-plane."
}

kubectl --context $Context get storageclass cpoly-postgres-retain | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Required StorageClass is absent: cpoly-postgres-retain"
}

kubectl --context $Context get namespace adg-data-plane | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Create namespace adg-data-plane and its referenced secrets before deployment."
}

foreach ($secretName in @(
    "adg-postgres-role-secrets",
    "adg-postgres-server-tls",
    "adg-postgres-portal-backup-secrets"
)) {
    kubectl --context $Context --namespace adg-data-plane `
        get secret $secretName | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Required referenced secret is absent: $secretName"
    }
}

$arguments = @(
    "--context", $Context,
    "apply",
    "--server-side",
    "-k", $packageRoot
)
if (-not $Apply) {
    $arguments = @(
        "--context", $Context,
        "apply",
        "--server-side",
        "--dry-run=server",
        "-k", $packageRoot
    )
}

& kubectl @arguments
if ($LASTEXITCODE -ne 0) {
    throw "CPOLY PostgreSQL cluster admission failed."
}

if ($Apply) {
    kubectl --context $Context --namespace adg-data-plane `
        rollout status statefulset/adg-postgres --timeout=10m
    if ($LASTEXITCODE -ne 0) {
        throw "CPOLY PostgreSQL StatefulSet did not become ready."
    }
    Write-Host "DEPLOYED CPOLY PostgreSQL to external context: $Context"
}
else {
    Write-Host "PASS server-side dry run for external CPOLY context: $Context"
}
