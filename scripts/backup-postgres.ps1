param([string]$OutputDirectory = ".\backups")
$ErrorActionPreference = "Stop"
if (-not $env:DATABASE_URL) { throw "请设置 DATABASE_URL" }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$output = Join-Path $OutputDirectory "bpms-$timestamp.dump"
pg_dump --format=custom --no-owner --dbname=$env:DATABASE_URL --file=$output
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL 备份失败" }
Write-Output $output
