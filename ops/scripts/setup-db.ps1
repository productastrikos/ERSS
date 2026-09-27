<#
  ERSS Dubai - one-time database setup.

  Creates the `erss` role and `erss_db` database, enables PostGIS and pgcrypto, and
  writes the generated password into server/.env.

  PREREQUISITE: PostGIS must be installed. It is NOT bundled with PostgreSQL.
    Start menu -> "Application Stack Builder" -> PostgreSQL -> Spatial Extensions ->
    PostGIS -> install.

  NOTE: this file is deliberately pure ASCII. Windows PowerShell 5.1 reads .ps1 files
  as ANSI unless they carry a UTF-8 BOM, so a stray em-dash or box-drawing character
  in a comment will corrupt the parse of the whole script.

  Usage (from the repo root):
    .\ops\scripts\setup-db.ps1
    .\ops\scripts\setup-db.ps1 -SuperUser postgres -PgBin "C:\Program Files\PostgreSQL\18\bin"
#>

param(
  [string]$SuperUser = 'postgres',
  [string]$PgBin     = 'C:\Program Files\PostgreSQL\18\bin',
  [string]$DbName    = 'erss_db',
  [string]$DbUser    = 'erss',
  [string]$DbPassword
)

$ErrorActionPreference = 'Stop'
$psql = Join-Path $PgBin 'psql.exe'

if (-not (Test-Path $psql)) {
  Write-Host "psql not found at $psql" -ForegroundColor Red
  Write-Host "Pass the correct path with -PgBin" -ForegroundColor Yellow
  exit 1
}

# PostGIS presence check, before anything is created.
$extDir = Join-Path (Split-Path $PgBin -Parent) 'share\extension'
if (-not (Test-Path (Join-Path $extDir 'postgis.control'))) {
  Write-Host ""
  Write-Host "  PostGIS is not installed." -ForegroundColor Red
  Write-Host ""
  Write-Host "  It does not ship with PostgreSQL. Install it first:" -ForegroundColor Yellow
  Write-Host "    1. Start menu -> 'Application Stack Builder'"
  Write-Host "    2. Choose the PostgreSQL server"
  Write-Host "    3. Categories -> Spatial Extensions -> PostGIS"
  Write-Host "    4. Install, then re-run this script"
  Write-Host ""
  Write-Host "  Direct download: https://postgis.net/windows_downloads/"
  Write-Host ""
  exit 1
}
Write-Host "PostGIS extension files found." -ForegroundColor Green

# Password for the application role.
if (-not $DbPassword) {
  $bytes = New-Object byte[] 24
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $DbPassword = ([Convert]::ToBase64String($bytes) -replace '[^A-Za-z0-9]', '') + 'x7'
  Write-Host "Generated a password for the '$DbUser' role."
}

Write-Host ""
Write-Host "You will be prompted for the '$SuperUser' password (set when PostgreSQL was installed)."
Write-Host ""

# Role. Single-quoted here-string so PowerShell does not touch the dollar-quoting.
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

$roleSql | & $psql -U $SuperUser -d postgres -v ON_ERROR_STOP=1 -f -
if ($LASTEXITCODE -ne 0) {
  Write-Host "Failed creating the role." -ForegroundColor Red
  exit 1
}

# CREATE DATABASE cannot run inside a transaction block, so it goes on its own.
$exists = & $psql -U $SuperUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DbName'"
if ($exists -ne '1') {
  & $psql -U $SuperUser -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DbName OWNER $DbUser"
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed creating the database." -ForegroundColor Red
    exit 1
  }
  Write-Host "Database '$DbName' created." -ForegroundColor Green
} else {
  Write-Host "Database '$DbName' already exists - leaving it alone." -ForegroundColor Yellow
}

# Extensions must be created by a superuser.
$extSql = "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pgcrypto; GRANT ALL ON SCHEMA public TO $DbUser;"
& $psql -U $SuperUser -d $DbName -v ON_ERROR_STOP=1 -c $extSql
if ($LASTEXITCODE -ne 0) {
  Write-Host "Failed enabling extensions." -ForegroundColor Red
  exit 1
}

$ver = & $psql -U $SuperUser -d $DbName -tAc "SELECT postgis_version()"
Write-Host "PostGIS enabled: $ver" -ForegroundColor Green

# Write the credentials into server/.env
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$envPath  = Join-Path $repoRoot 'server\.env'

if (-not (Test-Path $envPath)) {
  Copy-Item (Join-Path $repoRoot 'server\.env.example') $envPath
  Write-Host "Created server/.env from the example."
}

$envText = Get-Content $envPath -Raw
$envText = $envText -replace '(?m)^DB_PASSWORD=.*$', "DB_PASSWORD=$DbPassword"
$envText = $envText -replace '(?m)^DB_NAME=.*$',     "DB_NAME=$DbName"
$envText = $envText -replace '(?m)^DB_USER=.*$',     "DB_USER=$DbUser"
Set-Content -Path $envPath -Value $envText -Encoding utf8

Write-Host ""
Write-Host "server/.env updated with the database credentials." -ForegroundColor Green
Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  npm run db:schema     # create the tables"
Write-Host "  npm run db:views      # create the analytical views"
Write-Host "  npm run seed          # build 24 months of calibrated history"
Write-Host "  npm run dev           # console :3327  ,  api :4327"
Write-Host ""
