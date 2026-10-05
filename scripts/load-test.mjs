import { performance } from 'node:perf_hooks';

const baseUrl = process.env.BPMS_API_URL || 'http://127.0.0.1:3001/api';
const concurrency = Number(process.env.CONCURRENCY || 100);
const username = process.env.ADMIN_USERNAME || 'admin';
const password = process.env.ADMIN_PASSWORD || 'Admin@123456';
const login = await fetch(`${baseUrl}/v1/auth/login`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({username,password}) });
if (!login.ok) throw new Error(`登录失败：${await login.text()}`);
const { accessToken } = await login.json();
const started = performance.now();
const results = await Promise.all(Array.from({ length:concurrency }, async (_, index) => {
  const response = await fetch(`${baseUrl}${index % 2 ? '/dashboard' : '/products'}`, { headers:{authorization:`Bearer ${accessToken}`} });
  return response.status;
}));
const duration = performance.now() - started;
const failures = results.filter((status) => status < 200 || status >= 300).length;
console.log(JSON.stringify({ concurrency, durationMs:Number(duration.toFixed(1)), requestsPerSecond:Number((concurrency/(duration/1000)).toFixed(1)), failures }, null, 2));
if (failures / concurrency >= 0.01) process.exitCode = 1;
