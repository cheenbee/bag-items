const baseUrl = process.env.BPMS_API_URL || 'http://127.0.0.1:3001/api';
const adminUsername = process.env.ADMIN_USERNAME || 'admin';
const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123456';
const unique = Date.now();

async function request(path, { token, ...options } = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { 'content-type':'application/json', ...(token ? { authorization:`Bearer ${token}` } : {}), ...(options.headers || {}) } });
  const body = response.status === 204 ? null : await response.json().catch(() => ({}));
  return { response, body };
}

const adminLogin = await request('/v1/auth/login', { method:'POST', body:JSON.stringify({ username:adminUsername, password:adminPassword }) });
if (!adminLogin.response.ok) throw new Error(`管理员登录失败：${adminLogin.body.message}`);
const adminToken = adminLogin.body.accessToken;
const refreshCookie = (adminLogin.response.headers.getSetCookie?.()[0] || adminLogin.response.headers.get('set-cookie') || '').split(';')[0];
const refreshed = await request('/v1/auth/refresh', { method:'POST', headers:{ cookie:refreshCookie } });
if (!refreshed.response.ok) throw new Error(`刷新登录失败：${refreshed.body.message}`);
const refreshedMe = await request('/v1/auth/me', { token:refreshed.body.accessToken });
if (!refreshedMe.response.ok || refreshedMe.body.user.id !== adminLogin.body.user.id) throw new Error('刷新令牌返回了错误的用户身份');

const username = `member_${unique}`;
const password = `Member@${unique}`;
const createdUser = await request('/v1/users', { token:adminToken, method:'POST', body:JSON.stringify({ username, displayName:'安全测试用户', password, role:'member' }) });
if (!createdUser.response.ok) throw new Error(`创建普通用户失败：${createdUser.body.message}`);

const memberLogin = await request('/v1/auth/login', { method:'POST', body:JSON.stringify({ username, password }) });
if (!memberLogin.response.ok) throw new Error(`普通用户登录失败：${memberLogin.body.message}`);
const memberToken = memberLogin.body.accessToken;
const sku = `SEC-${unique}`;
const product = await request('/products', { token:memberToken, method:'POST', body:JSON.stringify({ sku, name:'权限验证临时产品', category:'其他', status:'打样中', colors:['黑色'] }) });
if (!product.response.ok) throw new Error(`普通用户新增失败：${product.body.message}`);

const forbiddenDelete = await request(`/products/${product.body.id}`, { token:memberToken, method:'DELETE' });
if (forbiddenDelete.response.status !== 403) throw new Error(`普通用户删除应返回 403，实际为 ${forbiddenDelete.response.status}`);
const adminDelete = await request(`/products/${product.body.id}`, { token:adminToken, method:'DELETE' });
if (!adminDelete.response.ok) throw new Error(`管理员删除失败：${adminDelete.body.message}`);
const cleanupUser = await request(`/v1/users/${createdUser.body.id}`, { token:adminToken, method:'DELETE' });
if (!cleanupUser.response.ok) throw new Error(`清理测试用户失败：${cleanupUser.body.message}`);

console.log(JSON.stringify({ login:true, refreshIdentity:true, memberCreate:true, memberDeleteBlocked:true, adminDelete:true, cleanup:true }, null, 2));
