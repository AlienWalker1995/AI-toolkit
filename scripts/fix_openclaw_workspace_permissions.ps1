# Re-run openclaw-workspace-sync so data/openclaw is owned by uid 1000 (node in openclaw-gateway).
# Use when MEMORY.md, agents/*/models.json, or other paths under data/openclaw return EACCES.
# Requires: Docker, compose file from repo root, BASE_PATH if not cwd.
$ErrorActionPreference = "Stop"
$base = if ($env:BASE_PATH) { $env:BASE_PATH } else { (Get-Location).Path }
Set-Location $base
& (Join-Path $base "openclaw\scripts\upgrade_tools_md_from_example.ps1") -Base $base
Write-Host "Running openclaw-workspace-sync (TOOLS.md stub upgrade, chown 1000:1000 on workspace bind mount)..."
docker compose run --rm openclaw-workspace-sync
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Done. Restart gateway if needed: docker compose up -d openclaw-gateway"
