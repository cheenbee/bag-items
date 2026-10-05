param(
  [string]$BackupDirectory = ".\backups\objects\$(Get-Date -Format 'yyyyMMdd-HHmmss')"
)

$ErrorActionPreference = 'Stop'
$resolved = [System.IO.Path]::GetFullPath($BackupDirectory)
New-Item -ItemType Directory -Force -Path $resolved | Out-Null

docker compose run --rm --entrypoint /bin/sh -v "${resolved}:/backup" minio-init -c 'mc alias set source http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" && mc mirror --overwrite "source/$S3_BUCKET" /backup'
if ($LASTEXITCODE -ne 0) { throw '对象存储备份失败' }
Write-Host "对象存储备份完成：$resolved"

