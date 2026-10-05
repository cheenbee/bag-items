import '../server/config.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../server/database.js';
import { storeImage } from '../server/storage-service.js';

if (!process.env.S3_ENDPOINT || !process.env.S3_BUCKET) {
  throw new Error('请先设置 S3_ENDPOINT、S3_BUCKET 和对象存储访问密钥');
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uploadDirectory = path.resolve(process.env.UPLOAD_DIRECTORY || path.join(projectRoot, 'server', 'uploads'));
const mimeTypes = new Map([['.png','image/png'],['.webp','image/webp'],['.jpg','image/jpeg'],['.jpeg','image/jpeg']]);
const sources = [
  { table: 'product_image', url: 'url', thumbnail: 'thumbnail_url', mime: 'mime_type', size: 'file_size', prefix: 'products' },
  { table: 'material', url: 'image_url', thumbnail: 'image_thumbnail_url', mime: 'image_mime_type', size: 'image_file_size', prefix: 'materials' },
  { table: 'mold', url: 'image_url', thumbnail: 'image_thumbnail_url', mime: 'image_mime_type', size: 'image_file_size', prefix: 'molds' },
  { table: 'cutting_plan', url: 'image_url', thumbnail: 'image_thumbnail_url', mime: 'image_mime_type', size: 'image_file_size', prefix: 'cutting-plans' },
];

function localPathFor(url) {
  if (!url || /^https?:\/\//i.test(url)) return null;
  if (url.startsWith('/uploads/')) return path.join(uploadDirectory, ...url.slice('/uploads/'.length).split('/'));
  return path.isAbsolute(url) ? url : path.resolve(projectRoot, url.replace(/^\.?[\\/]/, ''));
}

let migrated = 0;
let skipped = 0;
const failures = [];

for (const source of sources) {
  const rows = db.prepare(`SELECT id,${source.url} image_url FROM ${source.table} WHERE TRIM(COALESCE(${source.url},''))<>''`).all();
  for (const row of rows) {
    const localPath = localPathFor(row.image_url);
    if (!localPath) { skipped += 1; continue; }
    try {
      const buffer = await fs.readFile(localPath);
      const mimeType = mimeTypes.get(path.extname(localPath).toLowerCase());
      if (!mimeType) throw new Error('不支持的图片格式');
      const stored = await storeImage({ buffer, mimeType, prefix: source.prefix, uploadDirectory });
      db.prepare(`UPDATE ${source.table} SET ${source.url}=?,${source.thumbnail}=?,${source.mime}=?,${source.size}=? WHERE id=?`)
        .run(stored.url, stored.thumbnailUrl, mimeType, stored.size, row.id);
      migrated += 1;
    } catch (error) {
      failures.push({ table: source.table, id: row.id, url: row.image_url, message: error.message });
    }
  }
}

console.log(JSON.stringify({ migrated, skipped, failures }, null, 2));
if (failures.length) process.exitCode = 1;

