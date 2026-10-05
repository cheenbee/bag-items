import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from './database.js';

const accessMinutes = Number(process.env.ACCESS_TOKEN_MINUTES || 15);
const refreshDays = Number(process.env.REFRESH_TOKEN_DAYS || 30);
const jwtSecret = process.env.JWT_SECRET || 'bpms-development-secret-change-before-production';
const refreshCookie = 'bpms_refresh_token';
const authDisabled = process.env.BPMS_AUTH_DISABLED !== 'false';

export function ensureSecuritySchema() {
  db.exec(`CREATE TABLE IF NOT EXISTS app_user (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin','member')),
    is_active INTEGER NOT NULL DEFAULT 1,
    last_login_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS auth_session (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    user_agent TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS wechat_binding (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    openid TEXT NOT NULL UNIQUE,
    unionid TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES app_user(id) ON DELETE SET NULL,
    username TEXT,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status_code INTEGER,
    resource_type TEXT,
    resource_id TEXT,
    summary TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_auth_session_user ON auth_session(user_id);
  CREATE INDEX IF NOT EXISTS idx_auth_session_expiry ON auth_session(expires_at);
  CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);`);

  if (!db.prepare('SELECT id FROM app_user LIMIT 1').get()) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'Admin@123456';
    if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_PASSWORD) throw new Error('生产环境必须设置 ADMIN_PASSWORD');
    db.prepare('INSERT INTO app_user(username,display_name,password_hash,role) VALUES(?,?,?,?)')
      .run(username, '系统管理员', bcrypt.hashSync(password, 12), 'admin');
    console.warn(`BPMS 初始管理员已创建：${username}${process.env.ADMIN_PASSWORD ? '' : '（开发密码 Admin@123456）'}`);
  }
}

const publicUser = (user) => user ? ({ id: user.id, username: user.username, displayName: user.display_name, role: user.role }) : null;
const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

function defaultAuthenticatedUser() {
  const user = db.prepare(`SELECT id,username,display_name,role,is_active FROM app_user
    WHERE is_active=1 ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END,id LIMIT 1`).get();
  return publicUser(user) || { id: 0, username: 'local', displayName: 'No-login user', role: 'admin' };
}

function signAccessToken(user) {
  return jwt.sign({ sub: String(user.id), username: user.username, role: user.role, type: 'access' }, jwtSecret, { expiresIn: `${accessMinutes}m`, issuer: 'bpms' });
}

function createRefreshSession(user, request) {
  const token = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + refreshDays * 86400000).toISOString();
  db.prepare('INSERT INTO auth_session(user_id,token_hash,expires_at,user_agent,ip_address) VALUES(?,?,?,?,?)')
    .run(user.id, tokenHash(token), expiresAt, request.get('user-agent') || '', request.ip || '');
  return { token, expiresAt };
}

export function setRefreshCookie(response, token, expiresAt) {
  response.cookie(refreshCookie, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: new Date(expiresAt),
    path: '/api/v1/auth',
  });
}

export function clearRefreshCookie(response) {
  response.clearCookie(refreshCookie, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/v1/auth' });
}

export function loginWithPassword(username, password, request) {
  const user = db.prepare('SELECT * FROM app_user WHERE username=? AND is_active=1').get(String(username || '').trim());
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) return null;
  db.prepare('UPDATE app_user SET last_login_at=?,updated_at=? WHERE id=?').run(new Date().toISOString(), new Date().toISOString(), user.id);
  const session = createRefreshSession(user, request);
  return { accessToken: signAccessToken(user), expiresIn: accessMinutes * 60, refreshToken: session.token, refreshExpiresAt: session.expiresAt, user: publicUser(user) };
}

export function loginWithWechatOpenId(openid, request) {
  const user = db.prepare(`SELECT u.* FROM wechat_binding w JOIN app_user u ON u.id=w.user_id
    WHERE w.openid=? AND u.is_active=1`).get(openid);
  if (!user) return null;
  const session = createRefreshSession(user, request);
  return { accessToken: signAccessToken(user), refreshToken: session.token, expiresIn: accessMinutes * 60, refreshExpiresIn: refreshDays * 86400, user: publicUser(user) };
}

export function bindWechatUser(userId, openid, unionid = '') {
  if (!openid) throw new Error('微信 OpenID 不能为空');
  db.prepare('INSERT INTO wechat_binding(user_id,openid,unionid) VALUES(?,?,?) ON CONFLICT(openid) DO UPDATE SET user_id=excluded.user_id,unionid=excluded.unionid').run(userId, openid, unionid || null);
  return { userId: Number(userId), openid, unionid: unionid || null };
}

export function refreshAccessToken(token) {
  if (!token) return null;
  const session = db.prepare(`SELECT s.*,u.id authenticated_user_id,u.username,u.display_name,u.role,u.is_active FROM auth_session s
    JOIN app_user u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(tokenHash(token), new Date().toISOString());
  if (!session || !session.is_active) return null;
  const user = { ...session, id: session.authenticated_user_id };
  return { accessToken: signAccessToken(user), expiresIn: accessMinutes * 60, user: publicUser(user) };
}

export function revokeRefreshToken(token) {
  if (token) db.prepare('DELETE FROM auth_session WHERE token_hash=?').run(tokenHash(token));
}

export function authenticate(request, response, next) {
  if (authDisabled) {
    request.user = defaultAuthenticatedUser();
    return next();
  }
  const authorization = request.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return response.status(401).json({ message: '请先登录系统', code: 'AUTH_REQUIRED' });
  try {
    const payload = jwt.verify(token, jwtSecret, { issuer: 'bpms' });
    const user = db.prepare('SELECT id,username,display_name,role,is_active FROM app_user WHERE id=?').get(Number(payload.sub));
    if (!user?.is_active) return response.status(401).json({ message: '账号已停用', code: 'ACCOUNT_DISABLED' });
    request.user = publicUser(user);
    next();
  } catch {
    response.status(401).json({ message: '登录状态已失效', code: 'TOKEN_EXPIRED' });
  }
}

export function requireAdmin(request, response, next) {
  if (request.user?.role !== 'admin') return response.status(403).json({ message: '只有管理员可以执行删除或系统管理操作', code: 'ADMIN_REQUIRED' });
  next();
}

export function auditMutation(request, response, next) {
  if (!['POST','PUT','PATCH','DELETE'].includes(request.method)) return next();
  response.on('finish', () => {
    const sensitive = request.path.includes('/auth/');
    const summary = sensitive ? '认证操作' : JSON.stringify(Object.fromEntries(Object.entries(request.body || {}).filter(([key]) => !['password','dataUrl','token'].includes(key)))).slice(0, 1000);
    try {
      db.prepare('INSERT INTO audit_log(user_id,username,method,path,status_code,resource_type,resource_id,summary,ip_address) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(request.user?.id || null, request.user?.username || null, request.method, request.originalUrl, response.statusCode, request.path.split('/').filter(Boolean)[0] || '', request.params?.id || null, summary, request.ip || '');
    } catch (error) {
      console.error('写入审计日志失败', error.message);
    }
  });
  next();
}

export function listUsers() {
  return db.prepare('SELECT id,username,display_name,role,is_active,last_login_at,created_at FROM app_user ORDER BY id').all().map(publicUserRow => ({ ...publicUser(publicUserRow), isActive: Boolean(publicUserRow.is_active), lastLoginAt: publicUserRow.last_login_at, createdAt: publicUserRow.created_at }));
}

export function createUser(payload) {
  const username = String(payload.username || '').trim();
  const displayName = String(payload.displayName || '').trim();
  const password = String(payload.password || '');
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) throw new Error('用户名需为 3–32 位字母、数字、点、横线或下划线');
  if (!displayName) throw new Error('请输入姓名');
  if (password.length < 10) throw new Error('密码至少 10 位');
  const role = payload.role === 'admin' ? 'admin' : 'member';
  const result = db.prepare('INSERT INTO app_user(username,display_name,password_hash,role) VALUES(?,?,?,?)').run(username, displayName, bcrypt.hashSync(password, 12), role);
  return publicUser(db.prepare('SELECT * FROM app_user WHERE id=?').get(result.lastInsertRowid));
}

export function updateUser(id, payload, actorId) {
  const current = db.prepare('SELECT * FROM app_user WHERE id=?').get(id);
  if (!current) throw new Error('用户不存在');
  const isActive = payload.isActive === false ? 0 : 1;
  if (Number(id) === Number(actorId) && !isActive) throw new Error('不能停用当前登录账号');
  const role = payload.role === 'admin' ? 'admin' : 'member';
  db.prepare('UPDATE app_user SET display_name=?,role=?,is_active=?,updated_at=? WHERE id=?').run(String(payload.displayName || current.display_name).trim(), role, isActive, new Date().toISOString(), id);
  if (payload.password) {
    if (String(payload.password).length < 10) throw new Error('密码至少 10 位');
    db.prepare('UPDATE app_user SET password_hash=?,updated_at=? WHERE id=?').run(bcrypt.hashSync(String(payload.password), 12), new Date().toISOString(), id);
    db.prepare('DELETE FROM auth_session WHERE user_id=?').run(id);
  }
  return publicUser(db.prepare('SELECT * FROM app_user WHERE id=?').get(id));
}

export function changeOwnPassword(userId, currentPassword, newPassword) {
  const user = db.prepare('SELECT * FROM app_user WHERE id=? AND is_active=1').get(userId);
  if (!user || !bcrypt.compareSync(String(currentPassword || ''), user.password_hash)) {
    throw new Error('当前密码不正确');
  }
  const password = String(newPassword || '');
  if (password.length < 10) throw new Error('新密码至少需要 10 位');
  if (password === String(currentPassword || '')) throw new Error('新密码不能与当前密码相同');
  db.prepare('UPDATE app_user SET password_hash=?,updated_at=? WHERE id=?')
    .run(bcrypt.hashSync(password, 12), new Date().toISOString(), userId);
  db.prepare('DELETE FROM auth_session WHERE user_id=?').run(userId);
  return { changed: true };
}

export function deleteUser(id, actorId) {
  if (Number(id) === Number(actorId)) throw new Error('不能删除当前登录账号');
  const user = db.prepare('SELECT id,username FROM app_user WHERE id=?').get(id);
  if (!user) throw new Error('用户不存在');
  db.prepare('DELETE FROM app_user WHERE id=?').run(id);
  return { deleted: true, user };
}

export const refreshCookieName = refreshCookie;
