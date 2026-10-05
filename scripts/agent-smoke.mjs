import '../server/config.js';
import { db } from '../server/database.js';

const apiRoot = process.env.BPMS_API_URL || 'http://127.0.0.1:3001/api';
const mcpRoot = apiRoot.replace(/\/api\/?$/, '/mcp');
const unique = Date.now();
let tokenId;
let materialId;

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { accept: 'application/json', 'content-type': 'application/json', ...(options.headers || {}) } });
  return { response, body: await response.json().catch(() => ({})) };
}
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const rpc = (headers, id, method, params) => request(mcpRoot, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) });

try {
  const login = await request(`${apiRoot}/v1/auth/login`, { method: 'POST', body: JSON.stringify({ username: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_PASSWORD || 'Admin@123456' }) });
  assert(login.response.ok, `管理员登录失败：${login.body.message || login.response.status}`);
  const webHeaders = { authorization: `Bearer ${login.body.accessToken}` };
  const created = await request(`${apiRoot}/v1/agent/tokens`, { method: 'POST', headers: webHeaders, body: JSON.stringify({ name: `Agent测试-${unique}`, expiresInDays: 1, scopes: ['archive:read', 'materials:read', 'materials:write', 'history:read'] }) });
  assert(created.response.status === 201, `创建Agent令牌失败：${created.body.message}`);
  tokenId = created.body.id;
  const mcpHeaders = { authorization: `Bearer ${created.body.token}` };

  const initialize = await rpc(mcpHeaders, 1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'bpms-smoke', version: '1' } });
  assert(initialize.body.result?.serverInfo?.name === 'bpms-agent-gateway', 'MCP initialize失败');
  const tools = await rpc(mcpHeaders, 2, 'tools/list');
  const names = tools.body.result?.tools?.map(item => item.name) || [];
  assert(names.includes('prepare_material') && names.includes('commit_change'), '令牌缺少材料预览/提交工具');
  assert(!names.includes('prepare_product_bundle') && !names.includes('calculate_bom'), '令牌暴露未授权工具');
  await rpc(mcpHeaders, 21, 'tools/call', { name: 'search_products', arguments: { keyword: '2057' } });
  const identityAudit = db.prepare('SELECT user_id FROM agent_tool_call WHERE token_id=? ORDER BY id DESC LIMIT 1').get(tokenId);
  assert(Number(identityAudit?.user_id) === Number(login.body.user.id), 'MCP工具审计未记录真实用户身份');

  const history = await rpc(mcpHeaders, 3, 'tools/call', { name: 'get_history', arguments: { limit: 1 } });
  const historyData = history.body.result?.structuredContent || {};
  assert(!Object.hasOwn(historyData.sampleQuotes?.[0] || {}, 'total_cost'), '无cost:read令牌泄露样品成本');
  assert(!Object.hasOwn(historyData.deliveryOrders?.[0] || {}, 'total_cost'), '无cost:read令牌泄露配货成本');

  const name = `Agent流程测试材料-${unique}`;
  const prepared = await rpc(mcpHeaders, 4, 'tools/call', { name: 'prepare_material', arguments: { mode: 'create', material: { name, categoryName: '布料', specification: '测试规格', unit: 'm', unitPrice: 1.23 } } });
  const draft = prepared.body.result?.structuredContent;
  assert(draft?.requiresConfirmation && draft?.draftId && draft?.previewHash, '未生成待确认预览');
  assert(!db.prepare('SELECT id FROM material WHERE name=?').get(name), '预览阶段提前写入材料');
  const wrong = await rpc(mcpHeaders, 5, 'tools/call', { name: 'commit_change', arguments: { draftId: draft.draftId, previewHash: 'wrong', confirmationText: '确认提交' } });
  assert(wrong.body.error, '错误预览哈希未被拒绝');
  const committed = await rpc(mcpHeaders, 6, 'tools/call', { name: 'commit_change', arguments: { draftId: draft.draftId, previewHash: draft.previewHash, confirmationText: '确认提交测试资料' } });
  materialId = committed.body.result?.structuredContent?.result?.id;
  assert(materialId && db.prepare('SELECT id FROM material WHERE id=?').get(materialId), '确认后材料未写入');
  const repeated = await rpc(mcpHeaders, 7, 'tools/call', { name: 'commit_change', arguments: { draftId: draft.draftId, previewHash: draft.previewHash, confirmationText: '再次确认' } });
  assert(repeated.body.error, '重复提交未被拒绝');

  const csv = Buffer.from('名称,规格\n测试布料,16安').toString('base64');
  const parsed = await request(`${apiRoot}/v1/agent/files/parse`, { method: 'POST', headers: webHeaders, body: JSON.stringify({ name: 'agent-test.csv', dataUrl: `data:text/csv;base64,${csv}` }) });
  assert(parsed.response.ok && parsed.body.untrustedSource && parsed.body.sheets?.[0]?.rows?.length === 2, 'CSV附件解析失败');
  const revoked = await request(`${apiRoot}/v1/agent/tokens/${tokenId}/revoke`, { method: 'POST', headers: webHeaders, body: '{}' });
  assert(revoked.response.ok, '撤销令牌失败');
  const afterRevoke = await rpc(mcpHeaders, 8, 'ping');
  assert(afterRevoke.response.status === 401, '撤销后仍能访问MCP');
  console.log(JSON.stringify({ initialize: true, identityAudit: true, scopeIsolation: true, costHidden: true, previewBeforeCommit: true, hashCheck: true, commit: true, duplicateCommitBlocked: true, workbookParse: true, revoke: true }, null, 2));
} finally {
  if (materialId) db.prepare('DELETE FROM material WHERE id=?').run(materialId);
  if (tokenId) { db.prepare('DELETE FROM agent_tool_call WHERE token_id=?').run(tokenId); db.prepare('DELETE FROM agent_api_token WHERE id=?').run(tokenId); }
  db.prepare("DELETE FROM agent_change_draft WHERE preview_json LIKE '%Agent流程测试材料-%'").run();
}
