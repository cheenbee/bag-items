param(
  [Parameter(Mandatory = $true)][string]$BackupDirectory
)

$ErrorActionPreference = 'Stop'
$resolved = (Resolve-Path $BackupDirectory).Path
$confirmation = Read-Host "将把 $resolved 恢复到对象存储，输入 RESTORE 继续"
if ($confirmation -ne 'RESTORE') { throw '已取消恢复' }

docker compose run --rm --entrypoint /bin/sh -v "${resolved}:/backup:ro" minio-init -c 'mc alias set target http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" && mc mirror --overwrite /backup "target/$S3_BUCKET"'
if ($LASTEXITCODE -ne 0) { throw '对象存储恢复失败' }
Write-Host '对象存储恢复完成，请抽查原图和缩略图。'

