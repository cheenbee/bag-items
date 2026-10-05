param([Parameter(Mandatory=$true)][string]$BackupFile)
$ErrorActionPreference = "Stop"
if (-not $env:DATABASE_URL) { throw "请设置 DATABASE_URL" }
if (-not (Test-Path $BackupFile)) { throw "备份文件不存在：$BackupFile" }
pg_restore --clean --if-exists --no-owner --dbname=$env:DATABASE_URL $BackupFile
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL 恢复失败" }
Write-Output "恢复完成：$BackupFile"
