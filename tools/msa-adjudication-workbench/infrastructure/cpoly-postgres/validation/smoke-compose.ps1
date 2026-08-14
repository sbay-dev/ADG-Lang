$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$composeFile = Join-Path $root "standard\docker-compose.yml"
$work = Join-Path $root ".validation-smoke"
$secretDir = Join-Path $work "secrets"
$migrationDir = Join-Path $work "migrations"
$volume = "cpoly-adg-postgres-validation"
$project = "cpoly-adg-postgres"

$existing = docker ps -a --filter "label=com.docker.compose.project=$project" --format "{{.ID}}"
if ($LASTEXITCODE -ne 0) {
    throw "Unable to inspect Docker containers."
}
if ($existing) {
    throw "Compose smoke test refuses to collide with an existing $project project."
}
docker volume inspect $volume 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
    throw "Compose smoke test volume already exists: $volume"
}

New-Item -ItemType Directory -Force $secretDir, $migrationDir | Out-Null

function Write-ValidationFile {
    param([string]$Name, [string]$Value)
    [IO.File]::WriteAllText(
        (Join-Path $secretDir $Name),
        $Value,
        [Text.UTF8Encoding]::new($false)
    )
}

Write-ValidationFile "postgres-superuser-password" "ValidationSuperuserPassword-Only-01!"
Write-ValidationFile "adg-migrator-password" "ValidationMigratorPassword-Only-02!"
Write-ValidationFile "adg-runtime-password" "ValidationRuntimePassword-Only-03!"
Write-ValidationFile "adg-backup-password" "ValidationBackupPassword-Only-04!"
Write-ValidationFile "backup-aws-access-key-id" "validation-access-key-only"
Write-ValidationFile "backup-aws-secret-access-key" "validation-secret-key-only"
Write-ValidationFile "backup-libsodium-key" "dmFsaWRhdGlvbi1vbmx5LWxpYnNvZGl1bS1rZXktMzI="

$openssl = (Get-Command openssl -ErrorAction Stop).Source
& $openssl req -x509 -newkey rsa:2048 -nodes -days 1 `
    -subj "/CN=CPOLY Validation CA" `
    -keyout (Join-Path $work "ca.key") `
    -out (Join-Path $secretDir "postgres-ca.crt") 2>$null
if ($LASTEXITCODE -ne 0) { throw "Validation CA generation failed." }

& $openssl req -newkey rsa:2048 -nodes -subj "/CN=postgres" `
    -keyout (Join-Path $secretDir "postgres-server.key") `
    -out (Join-Path $work "server.csr") 2>$null
if ($LASTEXITCODE -ne 0) { throw "Validation server CSR generation failed." }

[IO.File]::WriteAllText(
    (Join-Path $work "san.ext"),
    "subjectAltName=DNS:postgres,DNS:localhost,IP:127.0.0.1`n",
    [Text.UTF8Encoding]::new($false)
)
& $openssl x509 -req -days 1 `
    -in (Join-Path $work "server.csr") `
    -CA (Join-Path $secretDir "postgres-ca.crt") `
    -CAkey (Join-Path $work "ca.key") `
    -CAcreateserial `
    -extfile (Join-Path $work "san.ext") `
    -out (Join-Path $secretDir "postgres-server.crt") 2>$null
if ($LASTEXITCODE -ne 0) { throw "Validation server certificate signing failed." }

[IO.File]::WriteAllText(
    (Join-Path $migrationDir "0001_validation_probe.sql"),
    "CREATE TABLE IF NOT EXISTS adjudication.validation_probe (id integer PRIMARY KEY);`n",
    [Text.UTF8Encoding]::new($false)
)

$env:CPOLY_SECRET_DIR = $secretDir
$env:ADG_POSTGRES_MIGRATIONS_DIR = $migrationDir
$env:CPOLY_POSTGRES_DATA_VOLUME = $volume
$env:CPOLY_POSTGRES_PORT = "55432"
$env:CPOLY_POSTGRES_BIND_ADDRESS = "127.0.0.1"
$env:WALG_S3_PREFIX = "s3://validation-only/adg-postgres"
$env:AWS_ENDPOINT = "https://validation.invalid"

try {
    docker compose -f $composeFile up -d postgres
    if ($LASTEXITCODE -ne 0) { throw "Compose PostgreSQL startup failed." }

    $healthy = $false
    $status = "unknown"
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        $status = docker inspect --format "{{.State.Health.Status}}" `
            cpoly-adg-postgres-postgres-1 2>$null
        if ($status -eq "healthy") {
            $healthy = $true
            break
        }
        if ($status -eq "unhealthy") { break }
        Start-Sleep -Seconds 2
    }
    if (-not $healthy) {
        docker compose -f $composeFile logs --no-color postgres
        throw "PostgreSQL health check failed: $status"
    }

    docker compose -f $composeFile --profile operations run --rm migrate
    if ($LASTEXITCODE -ne 0) { throw "Migration smoke test failed." }
    docker compose -f $composeFile --profile operations run --rm migrate
    if ($LASTEXITCODE -ne 0) { throw "Idempotent migration rerun failed." }

    docker compose -f $composeFile exec -T --user postgres postgres `
        psql --set=ON_ERROR_STOP=1 -U postgres -d adg_adjudication `
        -c "SELECT to_regclass('adjudication.validation_probe') IS NOT NULL AS migration_present;"
    if ($LASTEXITCODE -ne 0) { throw "Bootstrap database query failed." }

    docker compose -f $composeFile exec -T postgres /bin/sh -c `
        'export PGPASSWORD="$(cat /run/secrets/roles/adg-runtime-password)"; psql "host=postgres port=5432 dbname=adg_adjudication user=adg_runtime sslmode=verify-full sslrootcert=/run/secrets/tls/postgres-ca.crt" -v ON_ERROR_STOP=1 -c "SELECT current_user, current_schema();"'
    if ($LASTEXITCODE -ne 0) { throw "Runtime TLS/SCRAM query failed." }

    docker compose -f $composeFile exec -T postgres /bin/sh -c `
        'export PGPASSWORD="$(cat /run/secrets/roles/adg-runtime-password)"; psql "host=postgres port=5432 dbname=adg_adjudication user=adg_runtime sslmode=verify-full sslrootcert=/run/secrets/tls/postgres-ca.crt" -v ON_ERROR_STOP=1 -c "SELECT * FROM adjudication.schema_migrations;" >/dev/null 2>&1'
    if ($LASTEXITCODE -eq 0) { throw "Runtime role can read protected migration metadata." }

    docker compose -f $composeFile exec -T postgres /bin/sh -c `
        'export PGPASSWORD="$(cat /run/secrets/roles/adg-runtime-password)"; psql "host=postgres port=5432 dbname=adg_adjudication user=adg_runtime sslmode=disable" -c "SELECT 1;" >/dev/null 2>&1'
    if ($LASTEXITCODE -eq 0) { throw "Plaintext PostgreSQL connection was not rejected." }

    Write-Host "PASS Compose bootstrap, idempotent migration, TLS-only HBA, SCRAM, and least-privilege runtime smoke"
}
finally {
    docker compose -f $composeFile down --remove-orphans 2>$null | Out-Null
    docker volume rm $volume 2>$null | Out-Null
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
    @(
        "CPOLY_SECRET_DIR",
        "ADG_POSTGRES_MIGRATIONS_DIR",
        "CPOLY_POSTGRES_DATA_VOLUME",
        "CPOLY_POSTGRES_PORT",
        "CPOLY_POSTGRES_BIND_ADDRESS",
        "WALG_S3_PREFIX",
        "AWS_ENDPOINT"
    ) | ForEach-Object {
        Remove-Item "Env:$_" -ErrorAction SilentlyContinue
    }
}
