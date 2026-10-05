import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(serverDirectory, '..', '.env');

if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envPath);
}

if (process.env.NODE_ENV === 'production') {
  const required = ['ADMIN_PASSWORD','CORS_ORIGINS','S3_ENDPOINT','S3_BUCKET','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY'];
  const missing = required.filter((name) => !String(process.env[name] || '').trim());
  if (missing.length) throw new Error(`生产环境缺少配置：${missing.join('、')}`);
  if (String(process.env.JWT_SECRET || '').length < 48) throw new Error('生产环境 JWT_SECRET 至少需要 48 位');
  if (String(process.env.ADMIN_PASSWORD).length < 12) throw new Error('生产环境管理员密码至少需要 12 位');
}
