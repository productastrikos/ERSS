<#
  ERSS Dubai - bootstrap the database when the postgres password is unknown.

  MUST BE RUN AS ADMINISTRATOR (it edits pg_hba.conf under Program Files).

  What it does:
    1. Backs up pg_hba.conf
    2. Switches LOCAL connections only to "trust" so no password is needed
    3. Reloads PostgreSQL
    4. Creates the erss role, erss_db, and enables PostGIS + pgcrypto
    5. Optionally resets the postgres superuser password (-NewSuperuserPassword)
    6. RESTORES pg_hba.conf and reloads again

  Step 6 runs in a finally block, so the original config is put back even if
  something fails in the middle. The trust window is local-only and lasts seconds.

  NOTE: pure ASCII on purpose. Windows PowerShell 5.1 reads .ps1 as ANSI unless the
  file has a UTF-8 BOM, so a stray em-dash in a comment corrupts the whole parse.

  Usage (elevated PowerShell, from the repo root):
    .\ops\scripts\bootstrap-db-trust.ps1
    .\ops\scripts\bootstrap-db-trust.ps1 -NewSuperuserPassword 'SomethingYouChoose'
#>

param(
  [string]$PgRoot  = 'C:\Program Files\PostgreSQL\18',
  [string]$Service = 'postgresql-x64-18',
  [string]$DbName  = 'erss_db',
  [string]$DbUser  = 'erss',
  [string]$DbPassword,
  [string]$NewSuperuserPassword
)

$ErrorActionPreference = 'Stop'

# --- must be elevated ---------------------------------------------------------
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
      [Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host ""
  Write-Host "  This script must be run as Administrator." -ForegroundColor Red
  Write-Host "  Right-click PowerShell -> 'Run as administrator', then:" -ForegroundColor Yellow
  Write-Host "    cd D:\Work\poc\erss"
  Write-Host "    .\ops\scripts\bootstrap-db-trust.ps1"
  Write-Host ""
  exit 1
}

$psql = Join-Path $PgRoot 'bin\psql.exe'
$hba  = Join-Path $PgRoot 'data\pg_hba.conf'

foreach ($p in @($psql, $hba)) {
  if (-not (Test-Path $p)) { Write-Host "Not found: $p" -ForegroundColor Red; exit 1 }
}

if (-not (Test-Path (Join-Path $PgRoot 'share\extension\postgis.control'))) {
  Write-Host "PostGIS is not installed. Install it first." -ForegroundColor Red
  exit 1
}

if (-not $DbPassword) {
  $bytes = New-Object byte[] 24
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $DbPassword = ([Convert]::ToBase64String($bytes) -replace '[^A-Za-z0-9]', '') + 'x7'
}

$backup = "$hba.erss-backup"
$original = Get-Content $hba -Raw

try {
  # --- 1. back up ------------------------------------------------------------
  Copy-Item $hba $backup -Force
  Write-Host "Backed up pg_hba.conf -> $backup" -ForegroundColor Green

  # --- 2. local connections to trust, temporarily ----------------------------
  # Only the loopback and local lines. Nothing is opened to the network.
  $patched = $original `
    -replace '(?m)^(local\s+all\s+all\s+)scram-sha-256\s*$',            '$1trust' `
    -replace '(?m)^(host\s+all\s+all\s+127\.0\.0\.1/32\s+)scram-sha-256\s*$', '$1trust' `
    -replace '(?m)^(host\s+all\s+all\s+::1/128\s+)scram-sha-256\s*$',    '$1trust'

  if ($patched -eq $original) {
    Write-Host "Could not find the expected auth lines - is this a standard install?" -ForegroundColor Yellow
    Write-Host "Inspect $hba manually." -ForegroundColor Yellow
    exit 1
  }

  Set-Content -Path $hba -Value $patched -Encoding ascii
  Write-Host "Set local connections to 'trust' (temporary)." -ForegroundColor Yellow

  # --- 3. reload -------------------------------------------------------------
  & (Join-Path $PgRoot 'bin\pg_ctl.exe') reload -D (Join-Path $PgRoot 'data') 2>&1 | Out-Null
  Start-Sleep -Milliseconds 1200

  # --- 4. create role, database, extensions ----------------------------------
  $env:PGPASSWORD = ''

  $roleSql = @'
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ERSS_USER') THEN
    CREATE ROLE ERSS_USER LOGIN PASSWORD 'ERSS_PASS';
  ELSE
    ALTER ROLE ERSS_USER LOGIN PASSWORD 'ERSS_PASS';
  END IF;
END
$do$;
SELECT 'role ready' AS step;
'@
  $roleSql = $roleSql.Replace('ERSS_USER', $DbUser).Replace('ERSS_PASS', $DbPassword)
  $roleSql | & $psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -
  if ($LASTEXITCODE -ne 0) { throw "failed creating the role" }
  Write-Host "Role '$DbUser' ready." -ForegroundColor Green

  $exists = & $psql -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DbName'"
  if ($exists -ne '1') {
    & $psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DbName OWNER $DbUser"
    if ($LASTEXITCODE -ne 0) { throw "failed creating the database" }
    Write-Host "Database '$DbName' created." -ForegroundColor Green
  } else {
    Write-Host "Database '$DbName' already exists - leaving it alone." -ForegroundColor Yellow
  }

  $extSql = "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pgcrypto; GRANT ALL ON SCHEMA public TO $DbUser;"
  & $psql -U postgres -d $DbName -v ON_ERROR_STOP=1 -c $extSql
  if ($LASTEXITCODE -ne 0) { throw "failed enabling extensions" }

  $ver = & $psql -U postgres -d $DbName -tAc "SELECT postgis_version()"
  Write-Host "PostGIS enabled: $ver" -ForegroundColor Green

  # --- 5. optional: reset the superuser password -----------------------------
  if ($NewSuperuserPassword) {
    & $psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "ALTER USER postgres WITH PASSWORD '$NewSuperuserPassword'"
    if ($LASTEXITCODE -ne 0) { throw "failed resetting the postgres password" }
    Write-Host "postgres superuser password reset." -ForegroundColor Green
  }
}
finally {
  # --- 6. ALWAYS restore -----------------------------------------------------
  if (Test-Path $backup) {
    Set-Content -Path $hba -Value $original -Encoding ascii
    & (Join-Path $PgRoot 'bin\pg_ctl.exe') reload -D (Join-Path $PgRoot 'data') 2>&1 | Out-Null
    Remove-Item $backup -Force -ErrorAction SilentlyContinue
    Write-Host "Restored pg_hba.conf and reloaded. Password auth is back on." -ForegroundColor Green
  }
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

# --- write credentials into server/.env --------------------------------------
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$envPath  = Join-Path $repoRoot 'server\.env'

if (-not (Test-Path $envPath)) {
  Copy-Item (Join-Path $repoRoot 'server\.env.example') $envPath
}

$envText = Get-Content $envPath -Raw
$envText = $envText -replace '(?m)^DB_PASSWORD=.*$', "DB_PASSWORD=$DbPassword"
$envText = $envText -replace '(?m)^DB_NAME=.*$',     "DB_NAME=$DbName"
$envText = $envText -replace '(?m)^DB_USER=.*$',     "DB_USER=$DbUser"
Set-Content -Path $envPath -Value $envText -Encoding utf8

Write-Host ""
Write-Host "server/.env updated." -ForegroundColor Green
Write-Host ""
Write-Host "Verifying the app can connect with its own credentials..." -ForegroundColor Cyan
$env:PGPASSWORD = $DbPassword
$check = & $psql -U $DbUser -d $DbName -h 127.0.0.1 -tAc "SELECT 'connected as ' || current_user"
Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue

if ($LASTEXITCODE -eq 0) {
  Write-Host "  $check" -ForegroundColor Green
  Write-Host ""
  Write-Host "Done. Now run:" -ForegroundColor Cyan
  Write-Host "  npm run db:schema"
  Write-Host "  npm run db:views"
  Write-Host "  npm run seed"
  Write-Host ""
} else {
  Write-Host "  The erss role could not connect - check server/.env" -ForegroundColor Red
}
