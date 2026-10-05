import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const extensionFor = (mimeType) => mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';

export async function storeImage({ buffer, mimeType, prefix, uploadDirectory }) {
  const s3Enabled = Boolean(process.env.S3_BUCKET && process.env.S3_ENDPOINT);
  const s3 = s3Enabled ? new S3Client({
    region: process.env.S3_REGION || 'auto', endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    credentials: process.env.S3_ACCESS_KEY_ID ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY } : undefined,
  }) : null;
  const id = crypto.randomUUID();
  const extension = extensionFor(mimeType);
  const originalKey = `${prefix}/${id}.${extension}`;
  const thumbnailKey = `${prefix}/${id}-thumb.webp`;
  const thumbnail = await sharp(buffer).rotate().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  if (s3Enabled) {
    await Promise.all([
      s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: originalKey, Body: buffer, ContentType: mimeType })),
      s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: thumbnailKey, Body: thumbnail, ContentType: 'image/webp' })),
    ]);
    const publicBase = String(process.env.S3_PUBLIC_BASE_URL || `${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}`).replace(/\/$/, '');
    return { url: `${publicBase}/${originalKey}`, thumbnailUrl: `${publicBase}/${thumbnailKey}`, storage: 's3', size: buffer.length };
  }
  if (process.env.NODE_ENV === 'production') throw new Error('生产环境必须配置 S3_BUCKET 与 S3_ENDPOINT');
  await fs.mkdir(path.join(uploadDirectory, prefix), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(uploadDirectory, originalKey), buffer),
    fs.writeFile(path.join(uploadDirectory, thumbnailKey), thumbnail),
  ]);
  return { url: `/uploads/${originalKey.replaceAll('\\','/')}`, thumbnailUrl: `/uploads/${thumbnailKey.replaceAll('\\','/')}`, storage: 'local', size: buffer.length };
}
