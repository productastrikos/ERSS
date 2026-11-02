<#
  ERSS Dubai - build a clean upload bundle for a server REDEPLOY.

  Produces ops/release/erss-<stamp>.tar.gz containing the source the server needs and
  nothing else. What it LEAVES OUT is the point of the script:

    node_modules/   reinstalled on the server by `npm ci` (Linux-native binaries;
                    the Windows tree would break rollup/sharp/bcrypt there)
    server/.env     the PRODUCTION secrets live on the server and only there. The
                    local file is the DEVELOPMENT one - shipping it would overwrite
                    SESSION_SECRET / EID_HASH_SALT / DB_PASSWORD and config/env.js
                    would then refuse to boot. This is the single most expensive
                    mistake available during a redeploy, so the file cannot be in
                    the bundle at all.
    web/dist/       rebuilt on the server by `npm run build` (step 3 of REDEPLOY.md)
    _archive/, docs/, *.docx, logs, ops/release/

  web/.env.production IS included - it holds no secret and is what bakes the backend
  subdomain into the bundle at build time.

  NOTE: deliberately pure ASCII. Windows PowerShell 5.1 reads .ps1 as ANSI unless the
  file carries a UTF-8 BOM, so an em-dash in a comment corrupts the whole parse.

  Usage (from the repo root):
    .\ops\scripts\package-release.ps1
    .\ops\scripts\package-release.ps1 -SkipChecks     # bundle without re-running preflight
#>

param(
  [switch]$SkipChecks
)

# 'Continue', not 'Stop': npm/vite/tsc write progress and warnings to stderr, and under
# Windows PowerShell 5.1 each such line becomes a NativeCommandError when the pipeline is
# merged (e.g. this script piped into Select-String). Every native call below is checked
# on $LASTEXITCODE instead, which is the only reliable signal from an exe.
$ErrorActionPreference = 'Continue'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Push-Location $root

try {
  # --- Preflight: the same four gates as REDEPLOY.md section 1 -----------------
  if (-not $SkipChecks) {
    foreach ($gate in @('audit:env', 'typecheck', 'lint')) {
      Write-Host "  npm run $gate" -ForegroundColor Cyan
      & npm run $gate *> $null
      if ($LASTEXITCODE -ne 0) {
        Write-Host "FAIL  npm run $gate did not pass - fix it before packaging" -ForegroundColor Red
        exit 1
      }
    }
    Write-Host "  npm run build (proves the bundle compiles; dist is not shipped)" -ForegroundColor Cyan
    & npm run build *> $null
    if ($LASTEXITCODE -ne 0) {
      Write-Host "FAIL  the production build failed - fix it before packaging" -ForegroundColor Red
      exit 1
    }
    Write-Host "  all four gates pass" -ForegroundColor Green
  }

  # --- Bundle ------------------------------------------------------------------
  $outDir = Join-Path $root 'ops\release'
  if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

  $stamp   = Get-Date -Format 'yyyyMMdd-HHmm'
  $archive = Join-Path $outDir "erss-$stamp.tar.gz"

  # tar.exe ships with Windows 10+ . --exclude patterns match at any depth.
  $excludes = @(
    '--exclude=./node_modules'
    '--exclude=*/node_modules'
    '--exclude=./server/.env'
    '--exclude=./web/dist'
    '--exclude=./ops/release'
    '--exclude=./_archive'
    '--exclude=./docs'
    '--exclude=*.docx'
    '--exclude=*.log'
    '--exclude=.vite'
    '--exclude=.DS_Store'
  )

  Write-Host "  writing $archive" -ForegroundColor Cyan
  & tar.exe -czf $archive @excludes -C $root .
  if ($LASTEXITCODE -ne 0) { Write-Host "FAIL  tar returned $LASTEXITCODE" -ForegroundColor Red; exit 1 }

  # --- Prove the two dangerous paths are absent --------------------------------
  $listing = & tar.exe -tzf $archive
  $leaked = $listing | Where-Object { $_ -match 'node_modules/' -or $_ -match '^\./server/\.env$' -or $_ -match '^\./web/dist/' }
  if ($leaked) {
    Write-Host "FAIL  the bundle contains paths it must not:" -ForegroundColor Red
    $leaked | Select-Object -First 10 | ForEach-Object { Write-Host "        $_" -ForegroundColor Red }
    exit 1
  }

  $sizeMb = [math]::Round((Get-Item $archive).Length / 1MB, 1)
  $sha    = (Get-FileHash $archive -Algorithm SHA256).Hash.Substring(0, 16)

  Write-Host ""
  Write-Host "  PASS  no node_modules, no server/.env, no web/dist" -ForegroundColor Green
  Write-Host "  $($listing.Count) entries, $sizeMb MB, sha256 $sha..." -ForegroundColor Gray
  Write-Host ""
  Write-Host "  Next (REDEPLOY.md section 2):" -ForegroundColor Yellow
  Write-Host "    scp `"$archive`" user@astrikos.xyz:/tmp/"
  Write-Host ""
}
finally {
  Pop-Location
}
