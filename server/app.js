import cors from "cors";
import cookieParser from "cookie-parser";
import "./config.js";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { z } from "zod";
import {
  backfillAccessoryMaterialLinks,
  backfillDeliveryRuleColorStrategies,
  backfillDeliveryRuleLibraries,
  backfillDeliveryRuleSources,
  backfillDeliveryRuleUnits,
  backfillImportedAccessories,
  backfillImportedAccessoryMaterials,
  db,
  ensureReferenceData,
  migrateLegacyProductColors,
  removeImportSourceNotes,
  seedDatabase,
  separateMaterialColors,
} from "./database.js";
import {
  calculateBomRequirements,
  calculateSmartDelivery,
} from "./bom-service.js";
import { calculateDraftPacking, calculatePacking } from "./packing-service.js";
import {
  chatAboutQuoteWithDeepSeek,
  classifyQuoteMessageWithDeepSeek,
  extractQuoteWithDeepSeek,
  normalizeQuoteDraft,
} from "./ai-quote-service.js";
import {
  auditMutation,
  authenticate,
  bindWechatUser,
  changeOwnPassword,
  clearRefreshCookie,
  createUser,
  deleteUser,
  ensureSecuritySchema,
  listUsers,
  loginWithPassword,
  loginWithWechatOpenId,
  refreshAccessToken,
  refreshCookieName,
  requireAdmin,
  revokeRefreshToken,
  setRefreshCookie,
  updateUser,
} from "./auth-service.js";
import { storeImage } from "./storage-service.js";
import {
  agentMessages,
  authenticateAgentRequest,
  createAgentToken,
  ensureAgentSession,
  executeAgentTool,
  handleMcpRpc,
  listAgentSessions,
  listAgentTokens,
  parseAgentWorkbook,
  revokeAgentToken,
  runAgentChat,
} from "./agent-service.js";
import { extractAttachmentText } from "./attachment-extraction-service.js";

seedDatabase();
ensureReferenceData();
migrateLegacyProductColors();
removeImportSourceNotes();
backfillImportedAccessoryMaterials();
backfillImportedAccessories();
separateMaterialColors();
backfillDeliveryRuleUnits();
backfillDeliveryRuleLibraries();
backfillDeliveryRuleColorStrategies();
backfillAccessoryMaterialLinks();
backfillDeliveryRuleSources();
const app = express();
const port = process.env.PORT || 3001;
const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
ensureSecuritySchema();
const uploadDirectory = path.resolve(
  process.env.UPLOAD_DIRECTORY || path.join(serverDirectory, "uploads"),
);
fs.mkdirSync(uploadDirectory, { recursive: true });
const allowedOrigins = String(
  process.env.CORS_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173",
)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy:
      process.env.NODE_ENV === "production" ? undefined : false,
  }),
);
app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) callback(null, true);
      else callback(new Error("当前来源不允许访问系统"));
    },
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "45mb" }));
app.use("/uploads", express.static(uploadDirectory));
const now = () => new Date().toISOString();
const list = (sql, ...args) => db.prepare(sql).all(...args);
const one = (sql, ...args) => db.prepare(sql).get(...args);
function reorderProductRows(table, productId, ids) {
  const provided = Array.isArray(ids)
    ? ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
    : [];
  const unique = [...new Set(provided)];
  if (!unique.length || unique.length !== provided.length)
    throw new Error("排序数据无效");
  const current = list(
    `SELECT id FROM ${table} WHERE product_id=? ORDER BY sort_order,id`,
    productId,
  ).map((item) => Number(item.id));
  if (
    unique.length !== current.length ||
    current.some((id) => !unique.includes(id))
  )
    throw new Error("排序数据与当前列表不一致，请刷新后重试");
  db.exec("BEGIN IMMEDIATE");
  try {
    const update = db.prepare(`UPDATE ${table} SET sort_order=? WHERE id=?`);
    unique.forEach((id, index) => update.run(index, id));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
db.prepare(
  "INSERT OR IGNORE INTO system_setting(setting_key,setting_value) VALUES('quote_defaults',?)",
).run(JSON.stringify({ quantity: 10, gapCm: 1, lossRate: 1 }));
const required = (value, field) => {
  if (value === undefined || value === null || value === "")
    throw new Error(`${field} 为必填项`);
};
const safe = (handler) => (req, res) => {
  try {
    handler(req, res);
  } catch (error) {
    res.status(400).json({ message: error.message || "请求处理失败" });
  }
};
const asyncSafe = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    res
      .status(error.status || 400)
      .json({ message: error.message || "请求处理失败" });
  }
};
const normalizeText = (value) => String(value || "").trim();
const fabricMaterialCategories = new Set([
  "面布",
  "里布",
  "夹层",
  "支撑板",
  "复合布",
  "其它",
  "布料",
]);
const lengthMaterialCategories = new Set(["长度材料", "织带", "绳子", "拉链"]);

const loginSchema = z.object({
  username: z.string().min(3).max(32),
  password: z.string().min(8).max(128),
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "登录尝试过多，请 15 分钟后重试" },
});
app.get("/api/health", (_, res) =>
  res.json({
    service: "BPMS API",
    status: "ok",
    time: new Date().toISOString(),
    database: process.env.DATABASE_URL ? "postgres-migration-ready" : "sqlite",
  }),
);
app.post("/api/v1/auth/login", loginLimiter, (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ message: "请输入正确的用户名和密码" });
  const result = loginWithPassword(
    parsed.data.username,
    parsed.data.password,
    req,
  );
  if (!result) return res.status(401).json({ message: "用户名或密码错误" });
  setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
  res.json({
    accessToken: result.accessToken,
    expiresIn: result.expiresIn,
    user: result.user,
  });
});
app.post("/api/v1/auth/refresh", (req, res) => {
  const result = refreshAccessToken(req.cookies?.[refreshCookieName]);
  if (!result) return res.status(401).json({ message: "登录状态已失效" });
  res.json(result);
});
app.post("/api/v1/auth/logout", (req, res) => {
  revokeRefreshToken(req.cookies?.[refreshCookieName]);
  clearRefreshCookie(res);
  res.status(204).end();
});
app.post(
  "/api/v1/auth/wechat",
  loginLimiter,
  asyncSafe(async (req, res) => {
    const code = normalizeText(req.body.code);
    if (!code) return res.status(400).json({ message: "缺少微信登录 code" });
    if (!process.env.WECHAT_APP_ID || !process.env.WECHAT_APP_SECRET)
      return res.status(503).json({ message: "微信小程序登录尚未配置" });
    const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
    url.searchParams.set("appid", process.env.WECHAT_APP_ID);
    url.searchParams.set("secret", process.env.WECHAT_APP_SECRET);
    url.searchParams.set("js_code", code);
    url.searchParams.set("grant_type", "authorization_code");
    const response = await fetch(url);
    const session = await response.json();
    if (!response.ok || session.errcode || !session.openid)
      throw new Error(session.errmsg || "微信登录失败");
    const result = loginWithWechatOpenId(session.openid, req);
    if (!result)
      return res
        .status(403)
        .json({ message: "该微信账号尚未绑定系统用户，请联系管理员" });
    res.json(result);
  }),
);

const mcpSseSessions = new Map();
const rpcResponse = (rpc, result, error = null) => ({
  jsonrpc: "2.0",
  id: rpc.id ?? null,
  ...(error ? { error } : { result }),
});
const processMcpRpc = async (context, rpc) => {
  try {
    return rpcResponse(rpc, await handleMcpRpc(context, rpc));
  } catch (error) {
    return rpcResponse(rpc, null, {
      code: error.code || -32000,
      message: error.message || "MCP请求失败",
    });
  }
};
app.post(
  "/mcp",
  authenticateAgentRequest,
  asyncSafe(async (req, res) => {
    const requests = Array.isArray(req.body) ? req.body : [req.body];
    const responses = (
      await Promise.all(
        requests.map((rpc) => processMcpRpc(req.agentContext, rpc)),
      )
    ).filter((item) => item.id !== null);
    if (!responses.length) return res.status(202).end();
    res.json(Array.isArray(req.body) ? responses : responses[0]);
  }),
);
app.get("/mcp/sse", authenticateAgentRequest, (req, res) => {
  const sessionId = randomUUID();
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  mcpSseSessions.set(sessionId, {
    res,
    context: { ...req.agentContext, sessionId },
  });
  res.write(
    `event: endpoint\ndata: /mcp/sse/messages?sessionId=${sessionId}\n\n`,
  );
  const keepAlive = setInterval(() => res.write(": keepalive\n\n"), 15000);
  req.on("close", () => {
    clearInterval(keepAlive);
    mcpSseSessions.delete(sessionId);
  });
});
app.post(
  "/mcp/sse/messages",
  asyncSafe(async (req, res) => {
    const session = mcpSseSessions.get(normalizeText(req.query.sessionId));
    if (!session)
      return res.status(404).json({ message: "MCP SSE会话不存在或已结束" });
    const response = await processMcpRpc(session.context, req.body);
    if (response.id !== null)
      session.res.write(
        `event: message\ndata: ${JSON.stringify(response)}\n\n`,
      );
    res.status(202).end();
  }),
);
app.use("/api", authenticate);
app.use("/api", auditMutation);
app.get("/api/v1/auth/me", (req, res) => res.json({ user: req.user }));
const defaultSystemSettings = {
  companyName: "",
  companyShortName: "知源",
  phone: "",
  email: "",
  address: "",
  description: "",
  logoUrl: "",
  logoThumbnailUrl: "",
  afterSalesName: "",
  afterSalesTitle: "",
  afterSalesPhone: "",
  afterSalesWechat: "",
  afterSalesEmail: "",
  serviceHours: "",
  afterSalesNotes: "",
  afterSalesQrUrl: "",
  showAfterSalesInMiniProgram: true,
  showAfterSalesInDocuments: true,
  systemName: "知源 BPMS",
  documentHeader: "",
  showLogoInDocuments: true,
};
const readSystemSettings = () => {
  const row = one("SELECT setting_value,updated_at FROM system_setting WHERE setting_key='company_profile'");
  if (!row) return { ...defaultSystemSettings, updatedAt: null };
  try { return { ...defaultSystemSettings, ...JSON.parse(row.setting_value), updatedAt: row.updated_at }; }
  catch { return { ...defaultSystemSettings, updatedAt: row.updated_at }; }
};
app.get("/api/v1/system-settings", (req, res) => res.json({ settings: readSystemSettings(), editable: req.user.role === "admin" }));
app.put("/api/v1/system-settings", requireAdmin, safe((req, res) => {
  const current = readSystemSettings();
  const allowedKeys = Object.keys(defaultSystemSettings);
  const next = { ...current };
  allowedKeys.forEach((key) => {
    if (typeof defaultSystemSettings[key] === "boolean") next[key] = req.body[key] !== false;
    else next[key] = normalizeText(req.body[key]);
  });
  if (!next.companyShortName) next.companyShortName = "知源";
  if (!next.systemName) next.systemName = "知源 BPMS";
  db.prepare("INSERT INTO system_setting(setting_key,setting_value,updated_at) VALUES('company_profile',?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=excluded.updated_at")
    .run(JSON.stringify(next), now());
  res.json({ settings: readSystemSettings(), editable: true });
}));
app.put("/api/v1/auth/password", safe((req, res) => {
  const result = changeOwnPassword(req.user.id, req.body.currentPassword, req.body.newPassword);
  clearRefreshCookie(res);
  res.json(result);
}));
app.get("/api/v1/users", requireAdmin, (_, res) => res.json(listUsers()));
app.post(
  "/api/v1/users",
  requireAdmin,
  safe((req, res) => res.status(201).json(createUser(req.body))),
);
app.put(
  "/api/v1/users/:id",
  requireAdmin,
  safe((req, res) =>
    res.json(updateUser(req.params.id, req.body, req.user.id)),
  ),
);
app.delete(
  "/api/v1/users/:id",
  requireAdmin,
  safe((req, res) => res.json(deleteUser(req.params.id, req.user.id))),
);
app.post(
  "/api/v1/users/:id/wechat-binding",
  requireAdmin,
  safe((req, res) =>
    res.json(
      bindWechatUser(
        req.params.id,
        normalizeText(req.body.openid),
        normalizeText(req.body.unionid),
      ),
    ),
  ),
);
app.get("/api/v1/audit-logs", requireAdmin, (req, res) =>
  res.json(
    list(
      `SELECT id,username,method,path,status_code,summary,ip_address,created_at FROM audit_log ORDER BY id DESC LIMIT ?`,
      Math.min(500, Math.max(1, Number(req.query.limit) || 100)),
    ),
  ),
);
const webAgentContext = (req) => ({
  user: req.user,
  scopes: [
    "archive:read",
    "archive:write",
    "materials:read",
    "materials:write",
    "quote:execute",
    "history:read",
    "cost:read",
  ],
  clientName: "BPMS Web",
});
app.get("/api/v1/agent/tokens", (req, res) =>
  res.json(listAgentTokens(req.user.id)),
);
app.post(
  "/api/v1/agent/tokens",
  safe((req, res) =>
    res.status(201).json(createAgentToken(req.user.id, req.body)),
  ),
);
app.post(
  "/api/v1/agent/tokens/:id/revoke",
  safe((req, res) => res.json(revokeAgentToken(req.user.id, req.params.id))),
);
app.get("/api/v1/agent/sessions", (req, res) =>
  res.json(listAgentSessions(req.user.id)),
);
app.get(
  "/api/v1/agent/sessions/:id/messages",
  safe((req, res) => res.json(agentMessages(req.user.id, req.params.id))),
);
app.post(
  "/api/v1/agent/chat",
  asyncSafe(async (req, res) =>
    res.json(await runAgentChat(webAgentContext(req), req.body)),
  ),
);
app.post(
  "/api/v1/agent/tools/:name",
  safe((req, res) => {
    const context = {
      ...webAgentContext(req),
      sessionId: req.body.sessionId
        ? ensureAgentSession(webAgentContext(req), req.body.sessionId, "web")
        : null,
    };
    res.json(
      executeAgentTool(
        context,
        req.params.name,
        req.body.arguments || req.body,
      ),
    );
  }),
);
app.post(
  "/api/v1/agent/files/parse",
  asyncSafe(async (req, res) => res.json(await parseAgentWorkbook(req.body))),
);
app.use("/api", (req, res, next) =>
  req.method === "DELETE" ? requireAdmin(req, res, next) : next(),
);

function deliveryRuleDefaults(material, body = {}) {
  const libraryType = fabricMaterialCategories.has(material.category_name)
    ? "布料库"
    : lengthMaterialCategories.has(material.category_name)
      ? "长度材料库"
      : "五金配件库";
  const category =
    libraryType === "布料库"
      ? normalizeText(body.category) === "里布"
        ? "里布"
        : "面料"
      : "配件";
  const calculationMethod = libraryType === "布料库" ? "裁剪拉布" : "配件数量";
  const unit =
    libraryType === "布料库"
      ? "m"
      : normalizeText(body.unit) ||
        material.unit ||
        (libraryType === "长度材料库" ? "根" : "个");
  return { libraryType, category, calculationMethod, unit };
}

function deliveryRuleColorConfiguration(
  productId,
  defaults,
  body,
  current = null,
) {
  const requestedStrategy = normalizeText(
    body.color_strategy || current?.color_strategy,
  );
  const mappings = (
    Array.isArray(body.color_mappings) ? body.color_mappings : []
  )
    .map((item) => ({
      product_color: normalizeText(item.product_color),
      material_color: normalizeText(item.material_color),
    }))
    .filter((item) => item.product_color && item.material_color);
  const inferredStrategy = mappings.length
    ? "mapped"
    : normalizeText(body.color || current?.color)
      ? "fixed"
      : defaults.category === "里布"
        ? "fixed"
        : "follow";
  const strategy = ["follow", "fixed", "mapped"].includes(requestedStrategy)
    ? requestedStrategy
    : inferredStrategy;
  const productColors = new Set(
    list(
      "SELECT c.name FROM product_color pc JOIN color c ON c.id=pc.color_id WHERE pc.product_id=?",
      productId,
    ).map((item) => item.name),
  );
  for (const mapping of mappings) {
    if (!productColors.has(mapping.product_color))
      throw new Error(`产品档案中不存在颜色“${mapping.product_color}”`);
    ensureColor(mapping.material_color);
  }
  const color =
    strategy === "fixed" ? normalizeText(body.color || current?.color) : "";
  if (strategy === "fixed" && !color)
    throw new Error("固定颜色策略必须选择材料颜色");
  if (strategy === "mapped" && !mappings.length)
    throw new Error("特殊颜色对应至少需要设置一条对应关系");
  if (color) ensureColor(color);
  return { strategy, color, mappings: strategy === "mapped" ? mappings : [] };
}

function syncDeliveryRuleColorMappings(ruleId, mappings) {
  db.prepare(
    "DELETE FROM delivery_rule_color_map WHERE delivery_rule_id=?",
  ).run(ruleId);
  const add = db.prepare(
    "INSERT INTO delivery_rule_color_map(delivery_rule_id,product_color,material_color) VALUES(?,?,?)",
  );
  const unique = new Map(
    mappings.map((item) => [item.product_color, item.material_color]),
  );
  unique.forEach((materialColor, productColor) =>
    add.run(ruleId, productColor, materialColor),
  );
}

function getUnitId(value) {
  if (Number.isInteger(Number(value))) return Number(value);
  return (
    one(
      "SELECT id FROM unit WHERE id = ? OR symbol = ? OR name = ? LIMIT 1",
      value,
      value,
      value,
    )?.id || one("SELECT id FROM unit WHERE symbol = ?", "m").id
  );
}
function defaultPriceUnit(categoryName, unit = "") {
  if (
    fabricMaterialCategories.has(categoryName) ||
    lengthMaterialCategories.has(categoryName)
  )
    return "元/米";
  return `元/${unit || "个"}`;
}
function syncMaterialPrice(materialId) {
  const material = one(
    `SELECT m.*,c.name category_name,u.symbol unit FROM material m
    LEFT JOIN material_category c ON c.id=m.category_id JOIN unit u ON u.id=m.unit_id WHERE m.id=?`,
    materialId,
  );
  if (!material || !(Number(material.unit_price) > 0)) return;
  const priceUnit =
    normalizeText(material.price_unit) ||
    defaultPriceUnit(material.category_name, material.unit);
  const latest = one(
    "SELECT * FROM material_price WHERE material_id=? ORDER BY effective_date DESC,id DESC LIMIT 1",
    materialId,
  );
  if (
    latest &&
    Number(latest.price) === Number(material.unit_price) &&
    normalizeText(latest.supplier) === normalizeText(material.supplier) &&
    latest.price_unit === priceUnit
  )
    return;
  db.prepare(
    "INSERT INTO material_price(material_id,supplier,price,price_unit,effective_date,notes) VALUES(?,?,?,?,?,?)",
  ).run(
    materialId,
    normalizeText(material.supplier),
    Number(material.unit_price),
    priceUnit,
    now().slice(0, 10),
    "原料库价格更新",
  );
}
function parseJson(value, fallback = []) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}
function generateDeliveryOrderNo() {
  const date = now().slice(0, 10).replaceAll("-", "");
  const sequence =
    one(
      "SELECT COALESCE(MAX(CAST(SUBSTR(order_no,13) AS INTEGER)),0) total FROM delivery_order WHERE order_no LIKE ?",
      `PH-${date}-%`,
    ).total + 1;
  return `PH-${date}-${String(sequence).padStart(4, "0")}`;
}
function ensureProductCategory(name) {
  const cleanName = normalizeText(name) || "其他";
  db.prepare(
    "INSERT OR IGNORE INTO product_category(name, sort_order) VALUES (?, ?)",
  ).run(cleanName, 999);
  return cleanName;
}
function ensureColor(name) {
  const cleanName = normalizeText(name);
  if (!cleanName) return null;
  db.prepare("INSERT OR IGNORE INTO color(name) VALUES (?)").run(cleanName);
  return one("SELECT id FROM color WHERE name = ?", cleanName).id;
}
function syncColors(productId, colors) {
  const normalized = [
    ...new Set(
      (Array.isArray(colors)
        ? colors
        : String(colors || "").split(/[、,，\s]+/)
      )
        .map(normalizeText)
        .filter(Boolean),
    ),
  ];
  db.prepare("DELETE FROM product_color WHERE product_id = ?").run(productId);
  const add = db.prepare(
    "INSERT INTO product_color(product_id, color_id) VALUES (?, ?)",
  );
  normalized.forEach((name) => add.run(productId, ensureColor(name)));
  return normalized;
}
function syncAccessories(productId, accessories) {
  db.prepare("DELETE FROM product_accessory WHERE product_id = ?").run(
    productId,
  );
  const add = db.prepare(
    "INSERT INTO product_accessory(product_id,material_id,name,material,specification,color,quantity,unit,notes,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?)",
  );
  (Array.isArray(accessories) ? accessories : []).forEach((item, index) => {
    const material = one(
      "SELECT m.*,c.name category_name,u.symbol unit FROM material m LEFT JOIN material_category c ON c.id=m.category_id JOIN unit u ON u.id=m.unit_id WHERE m.id=?",
      Number(item.material_id),
    );
    if (!material) return;
    add.run(
      productId,
      material.id,
      material.name,
      material.category_name || "",
      material.specification || "",
      normalizeText(item.color),
      item.quantity === "" || item.quantity == null
        ? null
        : Number(item.quantity),
      material.unit || "",
      normalizeText(item.notes),
      index,
    );
  });
}
function syncParts(productId, parts) {
  db.prepare("DELETE FROM cutting_part WHERE product_id=?").run(productId);
  const add = db.prepare(
    "INSERT INTO cutting_part(code,product_id,material_id,mold_id,name,color,max_length_cm,max_width_cm,quantity_per_product,rotation_mode,gap_cm,type,image_url,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  (Array.isArray(parts) ? parts : []).forEach((item, index) => {
    const material = one(
      "SELECT id,name FROM material WHERE id=?",
      Number(item.material_id),
    );
    if (!material) return;
    add.run(
      `PART-${productId}-${String(index + 1).padStart(2, "0")}`,
      productId,
      material.id,
      Number(item.mold_id) || null,
      normalizeText(item.name) || material.name,
      normalizeText(item.color),
      Number(item.max_length_cm) || 0,
      Number(item.max_width_cm) || 0,
      Number(item.quantity_per_product) || 1,
      normalizeText(item.rotation_mode) || "free",
      item.gap_cm === "" || item.gap_cm == null ? null : Number(item.gap_cm),
      normalizeText(item.type),
      normalizeText(item.image_url),
      normalizeText(item.notes),
    );
  });
}
function generateProductCode() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const sequence =
    one(
      "SELECT COALESCE(MAX(CAST(SUBSTR(code,14) AS INTEGER)),0) total FROM product WHERE code LIKE ?",
      `PRD-${date}-%`,
    ).total + 1;
  return `PRD-${date}-${String(sequence).padStart(3, "0")}`;
}
function quoteDefaults() {
  return {
    productionQuantity: 10,
    layoutQuantity: 10,
    gapCm: 1,
    lossRate: 1,
    ...parseJson(
      one(
        "SELECT setting_value FROM system_setting WHERE setting_key='quote_defaults'",
      )?.setting_value,
      {},
    ),
  };
}
function generateSampleNo() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const prefix = `YP-${date}-`;
  const last = one(
    "SELECT sample_no FROM sample_quote WHERE sample_no LIKE ? ORDER BY sample_no DESC LIMIT 1",
    `${prefix}%`,
  );
  return `${prefix}${String((Number(last?.sample_no?.slice(-3)) || 0) + 1).padStart(3, "0")}`;
}
function sampleDetail(id) {
  const sample = one("SELECT * FROM sample_quote WHERE id=?", id);
  if (!sample) return null;
  return {
    ...sample,
    draft: normalizeQuoteDraft(parseJson(sample.draft_json, {})),
    result: parseJson(sample.result_json, null),
    messages: list(
      "SELECT id,role,content,created_at FROM sample_quote_message WHERE sample_quote_id=? ORDER BY id",
      id,
    ),
    images: list(
      "SELECT * FROM sample_quote_image WHERE sample_quote_id=? ORDER BY id DESC",
      id,
    ),
    attachments: list(
      "SELECT * FROM sample_quote_attachment WHERE sample_quote_id=? ORDER BY id",
      id,
    ),
  };
}
function buildQuoteReply(sampleNo, result) {
  const count = Math.max(1, Number(result.productionQuantity));
  const unitMaterials = result.materials
    .map(
      (item) =>
        `- ${item.materialName}：单套用料 ${item.unitUsedLengthM.toFixed(3)}m，成本 ¥${item.unitMaterialCost.toFixed(2)}`,
    )
    .join("\n");
  const unitAccessories = result.accessories.length
    ? result.accessories
        .map(
          (item) =>
            `- ${item.name}：${Number(item.quantityPerSet).toFixed(3).replace(/\.0+$/, "")} ${item.unit || "个"}/套，成本 ¥${(item.cost / count).toFixed(2)}`,
        )
        .join("\n")
    : "- 暂无配件成本";
  const batchMaterials = result.materials
    .map(
      (item) =>
        `- ${item.materialName}：用料 ${item.usedLengthM}m，成本 ¥${item.materialCost.toFixed(2)}，利用率 ${item.utilizationRate}%`,
    )
    .join("\n");
  const batchAccessories = result.accessories.length
    ? result.accessories
        .map(
          (item) =>
            `- ${item.name}：共 ${item.quantity} ${item.unit || "个"}，成本 ¥${item.cost.toFixed(2)}`,
        )
        .join("\n")
    : "- 暂无配件成本";
  const materialShare =
    result.totalCost > 0
      ? ((result.fabricCost / result.totalCost) * 100).toFixed(1)
      : "0.0";
  const accessoryShare =
    result.totalCost > 0
      ? ((result.accessoryCost / result.totalCost) * 100).toFixed(1)
      : "0.0";
  return `样品 ${sampleNo} 已完成核价。排版基准为 ${result.layoutQuantity} 套，单套用料由该排版结果平均计算。\n\n【单套成本与报价】\n布料：\n${unitMaterials}\n配件：\n${unitAccessories}\n- 材料损耗：¥${(result.lossCost / count).toFixed(2)}\n- 工序工价：¥${Number(result.processingUnit).toFixed(2)}\n- 包装费：¥${Number(result.packagingUnit).toFixed(2)}\n- 物流费：¥${Number(result.logisticsUnit).toFixed(2)}\n- 裁剪费：¥${Number(result.cuttingUnit).toFixed(2)}\n单套成本：¥${result.unitCost.toFixed(2)}\n单套利润：¥${Number(result.profitUnit).toFixed(2)}\n单套做货价格：¥${result.unitQuote.toFixed(2)}\n\n【做货 ${count} 套合计】\n布料：\n${batchMaterials}\n配件：\n${batchAccessories}\n做货总成本：¥${result.totalCost.toFixed(2)}\n做货总价：¥${result.totalQuote.toFixed(2)}\n\n【成本分析】\n布料约占总成本 ${materialShare}%，配件约占 ${accessoryShare}%。所有做货用量和价格均由 ${result.layoutQuantity} 套排版的单套结果放大计算。`;
}

function buildDraftSyncReply(sampleNo, draft) {
  const materialNames =
    draft.materials.map((item) => item.name).join("、") || "暂无";
  const pieceCount = draft.materials.reduce(
    (total, item) => total + item.pieces.length,
    0,
  );
  const lines = [
    `已同步到右侧样品档案 ${sampleNo}。`,
    `- 做货数量：${draft.productionQuantity} 个`,
    `- 排版基准：${draft.layoutQuantity} 套`,
    `- 布料：${draft.materials.length} 种（${materialNames}）`,
    `- 裁片：${pieceCount} 组`,
    `- 配件：${draft.accessories.length} 项`,
  ];
  if (draft.missingFields.length)
    lines.push(`还需要确认：${draft.missingFields.slice(0, 3).join("；")}`);
  else lines.push("必要资料已经完整，系统将继续进行排料和成本计算。");
  return lines.join("\n");
}
function productPayload(body) {
  required(body.sku, "货号");
  required(body.name, "产品名称");
  const colors = (body.colors || body.color || []).map
    ? body.colors || body.color
    : String(body.colors || body.color || "").split(/[、,，\s]+/);
  return {
    sku: normalizeText(body.sku),
    name: normalizeText(body.name),
    category: ensureProductCategory(body.category),
    colors,
    brand: normalizeText(body.brand),
    developmentDate: normalizeText(body.development_date),
    status:
      normalizeText(body.status) === "开发中"
        ? "销售中"
        : normalizeText(body.status) || "销售中",
    warehouseLocation: normalizeText(body.warehouse_location),
    strapInfo: normalizeText(body.strap_info),
    processNotes: normalizeText(body.process_notes),
    notes: normalizeText(body.notes),
    accessories: body.accessories || [],
    parts: body.parts || [],
  };
}
function productListQuery(keyword = "") {
  const like = `%${keyword}%`;
  return list(
    `SELECT p.*, COALESCE((SELECT GROUP_CONCAT(c.name, '、') FROM product_color pc JOIN color c ON c.id=pc.color_id WHERE pc.product_id=p.id), p.color, '') AS colors_text,
      (SELECT url FROM product_image WHERE product_id=p.id ORDER BY sort_order LIMIT 1) image_url
    FROM product p WHERE p.code LIKE ? OR p.sku LIKE ? OR p.name LIKE ? OR p.category LIKE ? OR EXISTS (SELECT 1 FROM product_color pc JOIN color c ON c.id=pc.color_id WHERE pc.product_id=p.id AND c.name LIKE ?)
    ORDER BY p.updated_at DESC`,
    like,
    like,
    like,
    like,
    like,
  );
}

function maintenanceSummaryQuery(mode = "parts", keyword = "") {
  const normalizedMode = [
    "parts",
    "accessories",
    "rules",
    "processes",
  ].includes(mode)
    ? mode
    : "parts";
  const like = `%${keyword}%`;
  const moduleSearch =
    normalizedMode === "parts"
      ? `EXISTS (SELECT 1 FROM cutting_part cp LEFT JOIN material m ON m.id=cp.material_id WHERE cp.product_id=p.id AND (cp.name LIKE ? OR m.name LIKE ?))`
      : normalizedMode === "accessories"
        ? `EXISTS (SELECT 1 FROM product_accessory pa LEFT JOIN material m ON m.id=pa.material_id WHERE pa.product_id=p.id AND (pa.name LIKE ? OR m.name LIKE ?))`
        : normalizedMode === "processes"
          ? `EXISTS (SELECT 1 FROM product_process pp JOIN work_process wp ON wp.id=pp.work_process_id WHERE pp.product_id=p.id AND (wp.name LIKE ? OR COALESCE(pp.operation_part,'') LIKE ?))`
          : `EXISTS (SELECT 1 FROM delivery_rule dr JOIN material m ON m.id=dr.material_id WHERE dr.product_id=p.id AND (m.name LIKE ? OR COALESCE(dr.description,'') LIKE ?))`;
  return list(
    `SELECT p.*,
      COALESCE((SELECT GROUP_CONCAT(c.name, '、') FROM product_color pc JOIN color c ON c.id=pc.color_id WHERE pc.product_id=p.id), p.color, '') AS colors_text,
      (SELECT url FROM product_image WHERE product_id=p.id ORDER BY sort_order LIMIT 1) image_url,
      (SELECT COUNT(*) FROM cutting_part cp WHERE cp.product_id=p.id) part_count,
      (SELECT COUNT(DISTINCT cp.material_id) FROM cutting_part cp WHERE cp.product_id=p.id AND cp.material_id IS NOT NULL) part_material_count,
      (SELECT COUNT(*) FROM cutting_part cp WHERE cp.product_id=p.id AND cp.mold_id IS NOT NULL) part_mold_count,
      (SELECT COUNT(*) FROM cutting_part cp WHERE cp.product_id=p.id AND cp.mold_id IS NULL) part_hand_count,
      (SELECT COUNT(*) FROM cutting_part cp WHERE cp.product_id=p.id AND (cp.material_id IS NULL OR cp.max_length_cm<=0 OR cp.max_width_cm<=0 OR cp.quantity_per_product<=0)) part_incomplete_count,
      (SELECT COUNT(*) FROM product_accessory pa WHERE pa.product_id=p.id) accessory_count,
      (SELECT COUNT(*) FROM product_accessory pa JOIN material m ON m.id=pa.material_id LEFT JOIN material_category mc ON mc.id=m.category_id WHERE pa.product_id=p.id AND mc.name IN ('长度材料','织带','绳子','拉链')) accessory_length_count,
      (SELECT COUNT(*) FROM product_accessory pa JOIN material m ON m.id=pa.material_id LEFT JOIN material_category mc ON mc.id=m.category_id WHERE pa.product_id=p.id AND mc.name IN ('五金配件','标牌配件','五金')) accessory_hardware_count,
      (SELECT COUNT(*) FROM product_accessory pa WHERE pa.product_id=p.id AND pa.material_id IS NOT NULL) accessory_linked_count,
      (SELECT COUNT(*) FROM product_accessory pa WHERE pa.product_id=p.id AND (pa.material_id IS NULL OR pa.quantity IS NULL OR pa.quantity<=0)) accessory_incomplete_count,
      (SELECT COUNT(*) FROM delivery_rule dr WHERE dr.product_id=p.id) rule_count,
      (SELECT COUNT(*) FROM delivery_rule dr WHERE dr.product_id=p.id AND dr.library_type='布料库') rule_fabric_count,
      (SELECT COUNT(*) FROM delivery_rule dr WHERE dr.product_id=p.id AND dr.library_type='长度材料库') rule_length_count,
      (SELECT COUNT(*) FROM delivery_rule dr WHERE dr.product_id=p.id AND dr.library_type='五金配件库') rule_hardware_count,
      (SELECT COUNT(*) FROM delivery_rule dr WHERE dr.product_id=p.id AND (dr.color_strategy='mapped' OR EXISTS(SELECT 1 FROM delivery_rule_color_map cm WHERE cm.delivery_rule_id=dr.id))) rule_mapped_color_count,
      (SELECT COUNT(*) FROM cutting_plan cp WHERE cp.product_id=p.id) cutting_plan_count,
      (SELECT COUNT(*) FROM cutting_plan cp WHERE cp.product_id=p.id AND cp.pieces_per_lay=10) default_cutting_plan_count,
      (SELECT COUNT(*) FROM delivery_order d WHERE d.product_id=p.id) delivery_order_count,
      (SELECT COUNT(*) FROM delivery_rule dr WHERE dr.product_id=p.id AND (dr.quantity_per_product IS NULL OR dr.quantity_per_product<=0 OR (dr.library_type<>'五金配件库' AND (dr.cutting_length_cm IS NULL OR dr.cutting_length_cm<=0)) OR (dr.library_type='布料库' AND dr.cutting_mode='待确认'))) rule_incomplete_count,
      (SELECT COUNT(*) FROM product_process pp WHERE pp.product_id=p.id) process_count,
      COALESCE((SELECT ROUND(SUM(pp.duration_minutes*pp.quantity_per_product),2) FROM product_process pp WHERE pp.product_id=p.id),0) process_total_minutes,
      COALESCE((SELECT ROUND(SUM(pp.unit_price*pp.quantity_per_product),2) FROM product_process pp WHERE pp.product_id=p.id),0) process_total_wage,
      (SELECT COUNT(*) FROM product_process pp WHERE pp.product_id=p.id AND (pp.duration_minutes<=0 OR pp.unit_price<=0 OR pp.quantity_per_product<=0)) process_incomplete_count
    FROM product p
    WHERE p.code LIKE ? OR p.sku LIKE ? OR p.name LIKE ? OR p.category LIKE ? OR ${moduleSearch}
    ORDER BY CAST(p.sku AS INTEGER),p.sku`,
    like,
    like,
    like,
    like,
    like,
    like,
  );
}

function generateWorkProcessCode() {
  const sequence =
    Number(
      one(
        "SELECT COALESCE(MAX(CAST(SUBSTR(code,4) AS INTEGER)),0) total FROM work_process WHERE code LIKE 'GX-%'",
      ).total,
    ) + 1;
  return `GX-${String(sequence).padStart(4, "0")}`;
}

function productProcessRows(productId) {
  return list(
    `SELECT pp.*,wp.code process_code,wp.name process_name,wp.category process_category,
      ROUND(pp.duration_minutes*pp.quantity_per_product,2) total_minutes,
      ROUND(pp.unit_price*pp.quantity_per_product,2) wage_subtotal
    FROM product_process pp JOIN work_process wp ON wp.id=pp.work_process_id
    WHERE pp.product_id=? ORDER BY pp.sort_order,pp.id`,
    productId,
  );
}

function productProcessLabor(productId) {
  const items = productProcessRows(productId);
  return {
    items,
    processCount: items.length,
    totalMinutes: Number(
      items
        .reduce((sum, item) => sum + Number(item.total_minutes || 0), 0)
        .toFixed(2),
    ),
    unitCost: Number(
      items
        .reduce((sum, item) => sum + Number(item.wage_subtotal || 0), 0)
        .toFixed(2),
    ),
  };
}

app.post(
  "/api/uploads/images",
  asyncSafe(async (req, res) => {
    const match =
      /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(
        req.body.dataUrl || "",
      );
    if (!match) throw new Error("仅支持 JPG、PNG 或 WebP 图片");
    const imageBuffer = Buffer.from(match[2], "base64");
    if (imageBuffer.length > 30 * 1024 * 1024)
      throw new Error("图片不能超过 30MB");
    res.status(201).json(
      await storeImage({
        buffer: imageBuffer,
        mimeType: match[1],
        prefix: "materials",
        uploadDirectory,
      }),
    );
  }),
);
app.get("/api/dashboard", (_, res) => {
  const products = Number(one("SELECT COUNT(*) total FROM product").total);
  const materials = Number(
    one("SELECT COUNT(*) total FROM material WHERE COALESCE(is_active,1)=1")
      .total,
  );
  const incompleteProducts = Number(
    one(`SELECT COUNT(*) total FROM product p
    WHERE TRIM(COALESCE(p.name,''))='' OR TRIM(COALESCE(p.category,''))='' OR TRIM(COALESCE(p.process_notes,''))=''
      OR NOT EXISTS(SELECT 1 FROM product_color pc WHERE pc.product_id=p.id)
      OR NOT EXISTS(SELECT 1 FROM product_image i WHERE i.product_id=p.id)`)
      .total,
  );
  const incompleteParts = Number(
    one(
      "SELECT COUNT(*) total FROM product p WHERE NOT EXISTS(SELECT 1 FROM cutting_part cp WHERE cp.product_id=p.id)",
    ).total,
  );
  const incompleteAccessories = Number(
    one(
      "SELECT COUNT(*) total FROM product p WHERE NOT EXISTS(SELECT 1 FROM product_accessory pa WHERE pa.product_id=p.id)",
    ).total,
  );
  const incompleteRules = Number(
    one(
      "SELECT COUNT(*) total FROM product p WHERE NOT EXISTS(SELECT 1 FROM delivery_rule dr WHERE dr.product_id=p.id)",
    ).total,
  );
  const missingPrice = Number(
    one(`SELECT COUNT(*) total FROM material m WHERE COALESCE(m.is_active,1)=1
    AND COALESCE((SELECT mp.price FROM material_price mp WHERE mp.material_id=m.id ORDER BY mp.effective_date DESC,mp.id DESC LIMIT 1),m.unit_price,0)<=0`)
      .total,
  );
  const missingImage = Number(
    one(
      "SELECT COUNT(*) total FROM material WHERE COALESCE(is_active,1)=1 AND TRIM(COALESCE(image_url,''))=''",
    ).total,
  );
  const missingSupplier = Number(
    one(
      "SELECT COUNT(*) total FROM material WHERE COALESCE(is_active,1)=1 AND TRIM(COALESCE(supplier,''))=''",
    ).total,
  );
  const unusedMaterials = Number(
    one(`SELECT COUNT(*) total FROM material m WHERE COALESCE(m.is_active,1)=1
    AND NOT EXISTS(SELECT 1 FROM delivery_rule dr WHERE dr.material_id=m.id)
    AND NOT EXISTS(SELECT 1 FROM cutting_part cp WHERE cp.material_id=m.id)
    AND NOT EXISTS(SELECT 1 FROM product_accessory pa WHERE pa.material_id=m.id)`)
      .total,
  );
  const todoProducts = list(`SELECT p.id,p.sku,p.name,p.updated_at,
      CASE WHEN TRIM(COALESCE(p.name,''))='' OR TRIM(COALESCE(p.category,''))='' OR TRIM(COALESCE(p.process_notes,''))='' OR NOT EXISTS(SELECT 1 FROM product_color pc WHERE pc.product_id=p.id) OR NOT EXISTS(SELECT 1 FROM product_image i WHERE i.product_id=p.id) THEN 1 ELSE 0 END product_missing,
      CASE WHEN NOT EXISTS(SELECT 1 FROM cutting_part cp WHERE cp.product_id=p.id) THEN 1 ELSE 0 END part_missing,
      CASE WHEN NOT EXISTS(SELECT 1 FROM product_accessory pa WHERE pa.product_id=p.id) THEN 1 ELSE 0 END accessory_missing,
      CASE WHEN NOT EXISTS(SELECT 1 FROM delivery_rule dr WHERE dr.product_id=p.id) THEN 1 ELSE 0 END rule_missing
    FROM product p
    WHERE TRIM(COALESCE(p.name,''))='' OR TRIM(COALESCE(p.category,''))='' OR TRIM(COALESCE(p.process_notes,''))=''
      OR NOT EXISTS(SELECT 1 FROM product_color pc WHERE pc.product_id=p.id)
      OR NOT EXISTS(SELECT 1 FROM product_image i WHERE i.product_id=p.id)
      OR NOT EXISTS(SELECT 1 FROM cutting_part cp WHERE cp.product_id=p.id)
      OR NOT EXISTS(SELECT 1 FROM product_accessory pa WHERE pa.product_id=p.id)
      OR NOT EXISTS(SELECT 1 FROM delivery_rule dr WHERE dr.product_id=p.id)
    ORDER BY p.updated_at DESC,p.id DESC LIMIT 6`).map((product) => {
    const missing = [];
    if (product.product_missing) missing.push("产品资料");
    if (product.part_missing) missing.push("裁片");
    if (product.accessory_missing) missing.push("配件");
    if (product.rule_missing) missing.push("配货规则");
    return { ...product, missing };
  });
  const recentOrders =
    list(`SELECT id,order_no,product_sku,product_name,production_quantity,status,total_cost,created_at
    FROM delivery_order ORDER BY created_at DESC,id DESC LIMIT 5`);
  res.json({
    counts: {
      products,
      materials,
      deliveryOrders: Number(
        one("SELECT COUNT(*) total FROM delivery_order").total,
      ),
      pendingCosts: Number(
        one(
          "SELECT COUNT(*) total FROM delivery_order WHERE COALESCE(total_cost,0)<=0",
        ).total,
      ),
      incompleteProducts,
      missingPrice,
    },
    archiveHealth: [
      {
        key: "products",
        label: "产品档案",
        page: "products",
        total: products,
        pending: incompleteProducts,
      },
      {
        key: "parts",
        label: "裁片档案",
        page: "parts",
        total: products,
        pending: incompleteParts,
      },
      {
        key: "accessories",
        label: "配件档案",
        page: "accessories",
        total: products,
        pending: incompleteAccessories,
      },
      {
        key: "rules",
        label: "配货档案",
        page: "deliveryRules",
        total: products,
        pending: incompleteRules,
      },
    ].map((item) => ({
      ...item,
      complete: Math.max(0, item.total - item.pending),
    })),
    materialAlerts: {
      missingPrice,
      missingImage,
      missingSupplier,
      unusedMaterials,
    },
    todoProducts,
    recentOrders,
  });
});
app.get("/api/products", (req, res) =>
  res.json(productListQuery(req.query.keyword || "")),
);
app.get("/api/products/maintenance-summary", (req, res) =>
  res.json(maintenanceSummaryQuery(req.query.mode, req.query.keyword || "")),
);
app.get("/api/products/next-code", (_, res) =>
  res.json({ code: generateProductCode() }),
);
app.get("/api/work-processes", (req, res) => {
  const like = `%${normalizeText(req.query.keyword)}%`;
  res.json(
    list(
      `SELECT * FROM work_process WHERE COALESCE(is_active,1)=1 AND (code LIKE ? OR name LIKE ? OR category LIKE ? OR COALESCE(notes,'') LIKE ?) ORDER BY category,name`,
      like,
      like,
      like,
      like,
    ),
  );
});
app.post(
  "/api/work-processes",
  safe((req, res) => {
    required(req.body.name, "工序名称");
    const result = db
      .prepare(
        `INSERT INTO work_process(code,name,category,default_duration_minutes,default_unit_price,notes,updated_at) VALUES(?,?,?,?,?,?,?)`,
      )
      .run(
        generateWorkProcessCode(),
        normalizeText(req.body.name),
        normalizeText(req.body.category) || "车缝",
        Math.max(0, Number(req.body.default_duration_minutes) || 0),
        Math.max(0, Number(req.body.default_unit_price) || 0),
        normalizeText(req.body.notes),
        now(),
      );
    res
      .status(201)
      .json(
        one("SELECT * FROM work_process WHERE id=?", result.lastInsertRowid),
      );
  }),
);
app.get(
  "/api/customers",
  safe((req, res) => {
    const keyword = `%${normalizeText(req.query.keyword)}%`;
    const active = String(req.query.active || "1");
    res.json(
      list(
        `SELECT * FROM customer WHERE (?='all' OR COALESCE(is_active,1)=?) AND (name LIKE ? OR COALESCE(code,'') LIKE ? OR COALESCE(contact_name,'') LIKE ? OR COALESCE(phone,'') LIKE ?) ORDER BY is_active DESC,name`,
        active,
        active === "all" ? 1 : Number(active),
        keyword,
        keyword,
        keyword,
        keyword,
      ),
    );
  }),
);
app.post(
  "/api/customers",
  safe((req, res) => {
    required(req.body.name, "公司企业");
    const name = normalizeText(req.body.name);
    const code =
      normalizeText(req.body.code) ||
      `KH-${String(Number(one("SELECT COALESCE(MAX(id),0)+1 next FROM customer").next)).padStart(4, "0")}`;
    const result = db
      .prepare(
        `INSERT INTO customer(code,name,contact_name,phone,email,address,currency,delivery_requirements,notes,is_active,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        code,
        name,
        normalizeText(req.body.contactName),
        normalizeText(req.body.phone),
        normalizeText(req.body.email),
        normalizeText(req.body.address),
        normalizeText(req.body.currency) || "CNY",
        normalizeText(req.body.deliveryRequirements),
        normalizeText(req.body.notes),
        req.body.isActive === false ? 0 : 1,
        now(),
      );
    res
      .status(201)
      .json(one("SELECT * FROM customer WHERE id=?", result.lastInsertRowid));
  }),
);
app.put(
  "/api/customers/:id",
  safe((req, res) => {
    const current = one("SELECT * FROM customer WHERE id=?", req.params.id);
    if (!current) throw new Error("客户档案不存在");
    required(req.body.name, "公司企业");
    const name = normalizeText(req.body.name);
    db.prepare(
      `UPDATE customer SET code=?,name=?,contact_name=?,phone=?,email=?,address=?,currency=?,delivery_requirements=?,notes=?,is_active=?,short_name='',payment_terms='',default_profit_unit=0,default_logistics_unit=0,quote_preferences='',updated_at=? WHERE id=?`,
    ).run(
      normalizeText(req.body.code) || current.code,
      name,
      normalizeText(req.body.contactName),
      normalizeText(req.body.phone),
      normalizeText(req.body.email),
      normalizeText(req.body.address),
      normalizeText(req.body.currency) || "CNY",
      normalizeText(req.body.deliveryRequirements),
      normalizeText(req.body.notes),
      req.body.isActive === false ? 0 : 1,
      now(),
      current.id,
    );
    res.json(one("SELECT * FROM customer WHERE id=?", current.id));
  }),
);
app.patch(
  "/api/customers/:id/status",
  safe((req, res) => {
    const current = one("SELECT * FROM customer WHERE id=?", req.params.id);
    if (!current) throw new Error("客户档案不存在");
    db.prepare("UPDATE customer SET is_active=?,updated_at=? WHERE id=?").run(
      req.body.isActive ? 1 : 0,
      now(),
      current.id,
    );
    res.json(one("SELECT * FROM customer WHERE id=?", current.id));
  }),
);
app.put(
  "/api/work-processes/:id",
  safe((req, res) => {
    required(req.body.name, "工序名称");
    db.prepare(
      `UPDATE work_process SET name=?,category=?,default_duration_minutes=?,default_unit_price=?,notes=?,updated_at=? WHERE id=?`,
    ).run(
      normalizeText(req.body.name),
      normalizeText(req.body.category) || "车缝",
      Math.max(0, Number(req.body.default_duration_minutes) || 0),
      Math.max(0, Number(req.body.default_unit_price) || 0),
      normalizeText(req.body.notes),
      now(),
      req.params.id,
    );
    res.json(one("SELECT * FROM work_process WHERE id=?", req.params.id));
  }),
);
app.get(
  "/api/products/:id/processes",
  safe((req, res) => res.json(productProcessRows(Number(req.params.id)))),
);
app.post(
  "/api/products/:id/processes/copy",
  safe((req, res) => {
    const productId = Number(req.params.id);
    const sourceProductId = Number(req.body.source_product_id);
    if (
      !one("SELECT id FROM product WHERE id=?", productId) ||
      !one("SELECT id FROM product WHERE id=?", sourceProductId)
    )
      throw new Error("产品不存在");
    if (productId === sourceProductId) throw new Error("不能从当前产品复制");
    const sourceRows = list(
      "SELECT * FROM product_process WHERE product_id=? ORDER BY sort_order,id",
      sourceProductId,
    );
    if (!sourceRows.length) throw new Error("来源产品尚未建立工序");
    db.exec("BEGIN IMMEDIATE");
    try {
      if (req.body.replace_existing)
        db.prepare("DELETE FROM product_process WHERE product_id=?").run(
          productId,
        );
      const offset = Number(
        one(
          "SELECT COALESCE(MAX(sort_order),-1)+1 next_order FROM product_process WHERE product_id=?",
          productId,
        ).next_order,
      );
      const insert = db.prepare(
        `INSERT INTO product_process(product_id,work_process_id,operation_part,quantity_per_product,duration_minutes,unit_price,notes,sort_order,version_no,effective_date,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      );
      sourceRows.forEach((item, index) =>
        insert.run(
          productId,
          item.work_process_id,
          item.operation_part,
          item.quantity_per_product,
          item.duration_minutes,
          item.unit_price,
          item.notes,
          offset + index,
          1,
          now().slice(0, 10),
          now(),
        ),
      );
      db.exec("COMMIT");
      res.status(201).json({
        copied: sourceRows.length,
        items: productProcessRows(productId),
      });
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }),
);
app.post(
  "/api/products/:id/processes",
  safe((req, res) => {
    const productId = Number(req.params.id);
    const processId = Number(req.body.work_process_id);
    if (!one("SELECT id FROM product WHERE id=?", productId))
      throw new Error("产品不存在");
    const process = one(
      "SELECT * FROM work_process WHERE id=? AND COALESCE(is_active,1)=1",
      processId,
    );
    if (!process) throw new Error("请选择标准工序");
    const quantity = Math.max(0, Number(req.body.quantity_per_product) || 0);
    if (!quantity) throw new Error("单包次数必须大于 0");
    const sortOrder = Number.isFinite(Number(req.body.sort_order))
      ? Number(req.body.sort_order)
      : Number(
          one(
            "SELECT COUNT(*) total FROM product_process WHERE product_id=?",
            productId,
          ).total,
        );
    const result = db
      .prepare(
        `INSERT INTO product_process(product_id,work_process_id,operation_part,quantity_per_product,duration_minutes,unit_price,notes,sort_order,effective_date,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        productId,
        processId,
        normalizeText(req.body.operation_part),
        quantity,
        Math.max(0, Number(req.body.duration_minutes) || 0),
        Math.max(0, Number(req.body.unit_price) || 0),
        normalizeText(req.body.notes),
        sortOrder,
        normalizeText(req.body.effective_date) || now().slice(0, 10),
        now(),
      );
    res
      .status(201)
      .json(
        one("SELECT * FROM product_process WHERE id=?", result.lastInsertRowid),
      );
  }),
);
app.put(
  "/api/product-processes/:id",
  safe((req, res) => {
    const current = one(
      "SELECT * FROM product_process WHERE id=?",
      req.params.id,
    );
    if (!current) throw new Error("产品工序不存在");
    const processId = Number(req.body.work_process_id);
    if (
      !one(
        "SELECT id FROM work_process WHERE id=? AND COALESCE(is_active,1)=1",
        processId,
      )
    )
      throw new Error("请选择标准工序");
    const quantity = Math.max(0, Number(req.body.quantity_per_product) || 0);
    if (!quantity) throw new Error("单包次数必须大于 0");
    db.prepare(
      `UPDATE product_process SET work_process_id=?,operation_part=?,quantity_per_product=?,duration_minutes=?,unit_price=?,notes=?,sort_order=?,effective_date=?,version_no=version_no+1,updated_at=? WHERE id=?`,
    ).run(
      processId,
      normalizeText(req.body.operation_part),
      quantity,
      Math.max(0, Number(req.body.duration_minutes) || 0),
      Math.max(0, Number(req.body.unit_price) || 0),
      normalizeText(req.body.notes),
      Number(req.body.sort_order) || 0,
      normalizeText(req.body.effective_date) ||
        current.effective_date ||
        now().slice(0, 10),
      now(),
      current.id,
    );
    res.json(one("SELECT * FROM product_process WHERE id=?", current.id));
  }),
);
app.delete(
  "/api/product-processes/:id",
  safe((req, res) => {
    db.prepare("DELETE FROM product_process WHERE id=?").run(req.params.id);
    res.status(204).end();
  }),
);

app.post(
  "/api/products",
  safe((req, res) => {
    const payload = productPayload(req.body);
    const code = generateProductCode();
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = db
        .prepare(
          `INSERT INTO product(code,sku,name,category,color,brand,development_date,status,warehouse_location,strap_info,process_notes,notes,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          code,
          payload.sku,
          payload.name,
          payload.category,
          "",
          payload.brand,
          payload.developmentDate,
          payload.status,
          payload.warehouseLocation,
          payload.strapInfo,
          payload.processNotes,
          payload.notes,
          now(),
        );
      const id = Number(result.lastInsertRowid);
      const colors = syncColors(id, payload.colors);
      syncAccessories(id, payload.accessories);
      syncParts(id, payload.parts);
      db.prepare("UPDATE product SET color=? WHERE id=?").run(
        colors.join("、"),
        id,
      );
      db.exec("COMMIT");
      res.status(201).json(one("SELECT * FROM product WHERE id=?", id));
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }),
);
app.put(
  "/api/products/:id",
  safe((req, res) => {
    const id = Number(req.params.id);
    const current = one("SELECT * FROM product WHERE id=?", id);
    if (!current) throw new Error("产品不存在");
    const payload = productPayload(req.body);
    db.exec("BEGIN IMMEDIATE");
    try {
      const colors = syncColors(id, payload.colors);
      db.prepare(
        `UPDATE product SET sku=?,name=?,category=?,color=?,brand=?,development_date=?,status=?,warehouse_location=?,strap_info=?,process_notes=?,notes=?,updated_at=? WHERE id=?`,
      ).run(
        payload.sku,
        payload.name,
        payload.category,
        colors.join("、"),
        payload.brand,
        payload.developmentDate,
        payload.status,
        payload.warehouseLocation,
        payload.strapInfo,
        payload.processNotes,
        payload.notes,
        now(),
        id,
      );
      db.exec("COMMIT");
      res.json(one("SELECT * FROM product WHERE id=?", id));
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }),
);
app.delete(
  "/api/products/:id",
  safe((req, res) => {
    const product = one(
      "SELECT id,sku,name,status FROM product WHERE id=?",
      req.params.id,
    );
    if (!product)
      return res.status(404).json({ message: "未找到需要删除的产品档案" });
    const deliveryOrders = Number(
      one(
        "SELECT COUNT(*) total FROM delivery_order WHERE product_id=?",
        product.id,
      ).total,
    );
    const purchaseOrders = Number(
      one(
        "SELECT COUNT(*) total FROM purchase_order WHERE product_id=?",
        product.id,
      ).total,
    );
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM delivery_order WHERE product_id=?").run(
        product.id,
      );
      db.prepare("DELETE FROM purchase_order WHERE product_id=?").run(
        product.id,
      );
      db.prepare("DELETE FROM product WHERE id=?").run(product.id);
      db.exec("COMMIT");
      res.json({ deleted: true, product, deliveryOrders, purchaseOrders });
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }),
);
app.get(
  "/api/products/:id/detail",
  safe((req, res) => {
    const product = one(
      `SELECT p.*, COALESCE((SELECT GROUP_CONCAT(c.name, '、') FROM product_color pc JOIN color c ON c.id=pc.color_id WHERE pc.product_id=p.id), p.color, '') AS colors_text FROM product p WHERE p.id=?`,
      req.params.id,
    );
    if (!product) throw new Error("产品不存在");
    res.json({
      product,
      colors: list(
        "SELECT c.* FROM product_color pc JOIN color c ON c.id=pc.color_id WHERE pc.product_id=? ORDER BY c.name",
        product.id,
      ),
      images: list(
        "SELECT * FROM product_image WHERE product_id=? ORDER BY sort_order",
        product.id,
      ),
      accessories: list(
        "SELECT * FROM product_accessory WHERE product_id=? ORDER BY sort_order,id",
        product.id,
      ),
      parts: list(
        "SELECT cp.*,m.name material_name,mo.code mold_code,mo.image_url mold_image_url FROM cutting_part cp LEFT JOIN material m ON m.id=cp.material_id LEFT JOIN mold mo ON mo.id=cp.mold_id WHERE cp.product_id=? ORDER BY cp.sort_order,cp.id",
        product.id,
      ),
      molds: list("SELECT * FROM mold WHERE product_id=?", product.id),
      bom: list(
        "SELECT b.*,m.name material_name,m.code material_code,u.symbol unit FROM bom_item b JOIN material m ON m.id=b.material_id JOIN unit u ON u.id=b.unit_id WHERE b.product_id=?",
        product.id,
      ),
    });
  }),
);
app.post(
  "/api/products/:id/images",
  asyncSafe(async (req, res) => {
    const product = one("SELECT id FROM product WHERE id=?", req.params.id);
    if (!product) throw new Error("产品不存在");
    const { dataUrl, type = "正面" } = req.body;
    const match =
      /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(
        dataUrl || "",
      );
    if (!match) throw new Error("仅支持 JPG、PNG 或 WebP 图片");
    const imageBuffer = Buffer.from(match[2], "base64");
    if (imageBuffer.length > 20 * 1024 * 1024)
      throw new Error("图片不能超过 20MB");
    const stored = await storeImage({
      buffer: imageBuffer,
      mimeType: match[1],
      prefix: `products/${product.id}`,
      uploadDirectory,
    });
    const result = db
      .prepare(
        "INSERT INTO product_image(product_id,type,url,thumbnail_url,mime_type,file_size,uploaded_by,sort_order) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        product.id,
        type,
        stored.url,
        stored.thumbnailUrl,
        match[1],
        stored.size,
        req.user.id,
        one(
          "SELECT COUNT(*) total FROM product_image WHERE product_id=?",
          product.id,
        ).total,
      );
    res.status(201).json({
      ...one("SELECT * FROM product_image WHERE id=?", result.lastInsertRowid),
      thumbnail_url: stored.thumbnailUrl,
    });
  }),
);
app.delete(
  "/api/products/:productId/images/:imageId",
  safe((req, res) => {
    const image = one(
      "SELECT * FROM product_image WHERE id=? AND product_id=?",
      req.params.imageId,
      req.params.productId,
    );
    if (!image) throw new Error("图片不存在");
    db.prepare("DELETE FROM product_image WHERE id=?").run(image.id);
    res.status(204).end();
    if (image.url.startsWith("/uploads/"))
      fs.rm(
        path.join(uploadDirectory, path.basename(image.url)),
        { force: true },
        () => {},
      );
  }),
);
app.post(
  "/api/products/:id/images/reorder",
  safe((req, res) => {
    reorderProductRows("product_image", Number(req.params.id), req.body.ids);
    res.json({ ok: true });
  }),
);
app.get(
  "/api/products/:id/parts",
  safe((req, res) =>
    res.json(
      list(
        "SELECT cp.*,m.name material_name,mo.code mold_code,mo.name mold_name,mo.image_url mold_image_url FROM cutting_part cp LEFT JOIN material m ON m.id=cp.material_id LEFT JOIN mold mo ON mo.id=cp.mold_id WHERE cp.product_id=? ORDER BY cp.sort_order,cp.id",
        req.params.id,
      ),
    ),
  ),
);
app.post(
  "/api/products/:id/parts/reorder",
  safe((req, res) => {
    reorderProductRows("cutting_part", Number(req.params.id), req.body.ids);
    res.json({ ok: true });
  }),
);
function validatePartMold(productId, moldId, currentPartId = null) {
  if (!moldId) return;
  const mold = one("SELECT * FROM mold WHERE id=?", moldId);
  if (!mold) throw new Error("所选刀模不存在");
  if (mold.product_id && Number(mold.product_id) !== Number(productId))
    throw new Error("所选刀模不属于当前产品");
  const linked = one(
    "SELECT id FROM cutting_part WHERE mold_id=? AND id<>?",
    moldId,
    Number(currentPartId) || 0,
  );
  if (linked) throw new Error("该刀模已经关联其它裁片");
}
function syncMoldFromPart(partId) {
  const part = one(
    "SELECT cp.*,p.sku product_sku FROM cutting_part cp JOIN product p ON p.id=cp.product_id WHERE cp.id=?",
    partId,
  );
  if (!part?.mold_id) return;
  db.prepare("UPDATE mold SET product_id=?,code=?,name=? WHERE id=?").run(
    part.product_id,
    `DM-${part.code}`,
    `${part.product_sku} ${part.name}`,
    part.mold_id,
  );
}
const ruleMaterial = (materialId) =>
  one(
    "SELECT m.*,c.name category_name,u.symbol unit FROM material m LEFT JOIN material_category c ON c.id=m.category_id JOIN unit u ON u.id=m.unit_id WHERE m.id=?",
    materialId,
  );
function syncAccessoryDeliverySource(accessoryId) {
  const accessory = one(
    "SELECT * FROM product_accessory WHERE id=?",
    accessoryId,
  );
  if (!accessory) return;
  const material = ruleMaterial(accessory.material_id);
  if (!material || fabricMaterialCategories.has(material.category_name))
    throw new Error("配件必须调用线材库或配件库材料");
  const defaults = deliveryRuleDefaults(material, {
    category: "配件",
    unit: accessory.unit,
  });
  let rule = one(
    "SELECT * FROM delivery_rule WHERE product_accessory_id=? LIMIT 1",
    accessory.id,
  );
  if (!rule)
    rule = one(
      "SELECT * FROM delivery_rule WHERE product_id=? AND material_id=? AND library_type<>'布料库' AND product_accessory_id IS NULL ORDER BY id LIMIT 1",
      accessory.product_id,
      accessory.material_id,
    );
  if (!rule) {
    const result = db
      .prepare(
        `INSERT INTO delivery_rule(product_id,material_id,category,library_type,color,color_strategy,source_type,is_auto_generated,product_accessory_id,description,quantity_per_product,cutting_length_cm,unit,calculation_method,cutting_mode,notes,sort_order)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        accessory.product_id,
        accessory.material_id,
        "配件",
        defaults.libraryType,
        accessory.color || "",
        accessory.color ? "fixed" : "follow",
        "product_accessory",
        1,
        accessory.id,
        "",
        accessory.quantity,
        null,
        accessory.unit || defaults.unit,
        "配件数量",
        "待确认",
        "",
        one(
          "SELECT COUNT(*) total FROM delivery_rule WHERE product_id=?",
          accessory.product_id,
        ).total,
      );
    rule = one(
      "SELECT * FROM delivery_rule WHERE id=?",
      result.lastInsertRowid,
    );
  }
  const strategy =
    rule.color_strategy === "mapped"
      ? "mapped"
      : accessory.color
        ? "fixed"
        : "follow";
  const color = strategy === "mapped" ? rule.color : accessory.color || "";
  db.prepare(
    `UPDATE delivery_rule SET material_id=?,category='配件',library_type=?,color=?,color_strategy=?,source_type='product_accessory',product_accessory_id=?,quantity_per_product=?,unit=?,cutting_length_cm=CASE WHEN ?='五金配件库' THEN NULL ELSE cutting_length_cm END WHERE id=?`,
  ).run(
    accessory.material_id,
    defaults.libraryType,
    color,
    strategy,
    accessory.id,
    accessory.quantity,
    accessory.unit || defaults.unit,
    defaults.libraryType,
    rule.id,
  );
}
app.post(
  "/api/products/:id/parts",
  safe((req, res) => {
    const body = req.body;
    required(body.material_id, "布料材料");
    required(body.name, "裁片名称");
    const productId = Number(req.params.id);
    const moldId = Number(body.mold_id) || null;
    validatePartMold(productId, moldId);
    const result = db
      .prepare(
        "INSERT INTO cutting_part(code,product_id,material_id,mold_id,name,color,max_length_cm,max_width_cm,quantity_per_product,rotation_mode,gap_cm,type,image_url,notes,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        `PART-${productId}-${Date.now()}`,
        productId,
        Number(body.material_id),
        moldId,
        normalizeText(body.name),
        "",
        Number(body.max_length_cm) || 0,
        Number(body.max_width_cm) || 0,
        Number(body.quantity_per_product) || 1,
        normalizeText(body.rotation_mode) || "free",
        body.gap_cm === "" || body.gap_cm == null ? null : Number(body.gap_cm),
        normalizeText(body.type),
        normalizeText(body.image_url),
        normalizeText(body.notes),
        one(
          "SELECT COUNT(*) total FROM cutting_part WHERE product_id=?",
          productId,
        ).total,
      );
    syncMoldFromPart(result.lastInsertRowid);
    res
      .status(201)
      .json(
        one("SELECT * FROM cutting_part WHERE id=?", result.lastInsertRowid),
      );
  }),
);
app.put(
  "/api/cutting-parts/:id",
  safe((req, res) => {
    const body = req.body;
    required(body.material_id, "布料材料");
    required(body.name, "裁片名称");
    const current = one("SELECT * FROM cutting_part WHERE id=?", req.params.id);
    if (!current) throw new Error("裁片不存在");
    const moldId = Number(body.mold_id) || null;
    validatePartMold(current.product_id, moldId, current.id);
    db.prepare(
      "UPDATE cutting_part SET material_id=?,mold_id=?,name=?,color=?,max_length_cm=?,max_width_cm=?,quantity_per_product=?,rotation_mode=?,gap_cm=?,type=?,image_url=?,notes=? WHERE id=?",
    ).run(
      Number(body.material_id),
      moldId,
      normalizeText(body.name),
      "",
      Number(body.max_length_cm) || 0,
      Number(body.max_width_cm) || 0,
      Number(body.quantity_per_product) || 1,
      normalizeText(body.rotation_mode) || "free",
      body.gap_cm === "" || body.gap_cm == null ? null : Number(body.gap_cm),
      normalizeText(body.type),
      normalizeText(body.image_url),
      normalizeText(body.notes),
      current.id,
    );
    syncMoldFromPart(current.id);
    res.json(one("SELECT * FROM cutting_part WHERE id=?", current.id));
  }),
);
app.delete(
  "/api/cutting-parts/:id",
  safe((req, res) => {
    db.prepare("DELETE FROM cutting_part WHERE id=?").run(req.params.id);
    res.status(204).end();
  }),
);
app.get(
  "/api/products/:id/accessories",
  safe((req, res) =>
    res.json(
      list(
        "SELECT pa.* FROM product_accessory pa WHERE pa.product_id=? ORDER BY pa.sort_order,pa.id",
        req.params.id,
      ),
    ),
  ),
);
app.post(
  "/api/products/:id/accessories/reorder",
  safe((req, res) => {
    reorderProductRows(
      "product_accessory",
      Number(req.params.id),
      req.body.ids,
    );
    res.json({ ok: true });
  }),
);
app.post(
  "/api/products/:id/accessories",
  safe((req, res) => {
    const material = ruleMaterial(Number(req.body.material_id));
    if (!material) throw new Error("请选择库内配件");
    const color = normalizeText(req.body.color);
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = db
        .prepare(
          "INSERT INTO product_accessory(product_id,material_id,name,material,specification,color,quantity,unit,notes,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          Number(req.params.id),
          material.id,
          material.name,
          material.category_name,
          material.specification || "",
          color,
          Number(req.body.quantity) || null,
          material.unit,
          normalizeText(req.body.notes),
          one(
            "SELECT COUNT(*) total FROM product_accessory WHERE product_id=?",
            req.params.id,
          ).total,
        );
      if (color) ensureColor(color);
      syncAccessoryDeliverySource(result.lastInsertRowid);
      db.exec("COMMIT");
      res
        .status(201)
        .json(
          one(
            "SELECT * FROM product_accessory WHERE id=?",
            result.lastInsertRowid,
          ),
        );
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }),
);
app.put(
  "/api/product-accessories/:id",
  safe((req, res) => {
    const current = one(
      "SELECT * FROM product_accessory WHERE id=?",
      req.params.id,
    );
    if (!current) throw new Error("配件不存在");
    const material = ruleMaterial(
      Number(req.body.material_id) || current.material_id,
    );
    if (!material) throw new Error("请选择库内配件");
    const color = normalizeText(req.body.color);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "UPDATE product_accessory SET material_id=?,name=?,material=?,specification=?,color=?,quantity=?,unit=?,notes=? WHERE id=?",
      ).run(
        material.id,
        material.name,
        material.category_name,
        material.specification || "",
        color,
        Number(req.body.quantity) || null,
        material.unit,
        normalizeText(req.body.notes),
        current.id,
      );
      if (color) ensureColor(color);
      syncAccessoryDeliverySource(current.id);
      db.exec("COMMIT");
      res.json(one("SELECT * FROM product_accessory WHERE id=?", current.id));
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }),
);
app.delete(
  "/api/product-accessories/:id",
  safe((req, res) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM delivery_rule WHERE product_accessory_id=?").run(
        req.params.id,
      );
      db.prepare("DELETE FROM product_accessory WHERE id=?").run(req.params.id);
      db.exec("COMMIT");
      res.status(204).end();
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }),
);

app.get("/api/meta/product-categories", (_, res) =>
  res.json(list("SELECT * FROM product_category ORDER BY sort_order,name")),
);
app.post(
  "/api/meta/product-categories",
  safe((req, res) => {
    required(req.body.name, "分类名称");
    const name = ensureProductCategory(req.body.name);
    res
      .status(201)
      .json(one("SELECT * FROM product_category WHERE name=?", name));
  }),
);
app.get("/api/meta/colors", (_, res) =>
  res.json(list("SELECT * FROM color ORDER BY name")),
);
app.post(
  "/api/meta/colors",
  safe((req, res) => {
    required(req.body.name, "颜色名称");
    const id = ensureColor(req.body.name);
    res.status(201).json(one("SELECT * FROM color WHERE id=?", id));
  }),
);

app.get("/api/materials", (_, res) =>
  res.json(
    list(`SELECT m.*,c.name category_name,u.symbol unit,
  (SELECT mp.notes FROM material_price mp WHERE mp.material_id=m.id ORDER BY mp.effective_date DESC,mp.id DESC LIMIT 1) latest_price_notes,
  (SELECT mp.effective_date FROM material_price mp WHERE mp.material_id=m.id ORDER BY mp.effective_date DESC,mp.id DESC LIMIT 1) latest_price_date
  FROM material m LEFT JOIN material_category c ON c.id=m.category_id JOIN unit u ON u.id=m.unit_id
  WHERE COALESCE(m.is_active,1)=1 ORDER BY m.updated_at DESC,m.name`),
  ),
);
app.post(
  "/api/materials",
  safe((req, res) => {
    const body = req.body;
    required(body.name, "材料名称");
    const categoryId =
      Number(body.category_id) ||
      one(
        "SELECT id FROM material_category WHERE name=?",
        body.category_name || "布料",
      )?.id ||
      1;
    const result = db
      .prepare(
        "INSERT INTO material(code,name,category_id,specification,color,unit_id,width_cm,usable_width_cm,edge_margin_cm,default_gap_cm,weight_gsm,roll_length_cm,unit_price,price_unit,roll_price,price_updated_at,supplier,image_url,image_thumbnail_url,image_mime_type,image_file_size,notes,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        `MAT-${Date.now()}`,
        normalizeText(body.name),
        categoryId,
        normalizeText(body.specification),
        "",
        getUnitId(body.unit_id || body.unit),
        Number(body.width_cm) || null,
        Number(body.usable_width_cm) || null,
        Number(body.edge_margin_cm) || 0,
        Number(body.default_gap_cm) || 1,
        Number(body.weight_gsm) || null,
        Number(body.roll_length_cm) || null,
        Number(body.unit_price) || null,
        normalizeText(body.price_unit),
        Number(body.roll_price) || null,
        Number(body.unit_price) ? now() : null,
        normalizeText(body.supplier),
        normalizeText(body.image_url),
        normalizeText(body.image_thumbnail_url),
        normalizeText(body.image_mime_type),
        Number(body.image_file_size) || null,
        normalizeText(body.notes),
        now(),
      );
    syncMaterialPrice(Number(result.lastInsertRowid));
    res
      .status(201)
      .json(one("SELECT * FROM material WHERE id=?", result.lastInsertRowid));
  }),
);
app.put(
  "/api/materials/:id",
  safe((req, res) => {
    const body = req.body;
    required(body.name, "材料名称");
    const categoryId =
      Number(body.category_id) ||
      one(
        "SELECT id FROM material_category WHERE name=?",
        body.category_name || "布料",
      )?.id ||
      1;
    db.prepare(
      "UPDATE material SET name=?,category_id=?,specification=?,color=?,unit_id=?,width_cm=?,usable_width_cm=?,edge_margin_cm=?,default_gap_cm=?,weight_gsm=?,roll_length_cm=?,unit_price=?,price_unit=?,roll_price=?,price_updated_at=?,supplier=?,image_url=?,image_thumbnail_url=?,image_mime_type=?,image_file_size=?,notes=?,updated_at=? WHERE id=?",
    ).run(
      normalizeText(body.name),
      categoryId,
      normalizeText(body.specification),
      "",
      getUnitId(body.unit_id || body.unit),
      Number(body.width_cm) || null,
      Number(body.usable_width_cm) || null,
      Number(body.edge_margin_cm) || 0,
      Number(body.default_gap_cm) || 1,
      Number(body.weight_gsm) || null,
      Number(body.roll_length_cm) || null,
      Number(body.unit_price) || null,
      normalizeText(body.price_unit),
      Number(body.roll_price) || null,
      Number(body.unit_price) ? now() : null,
      normalizeText(body.supplier),
      normalizeText(body.image_url),
      normalizeText(body.image_thumbnail_url),
      normalizeText(body.image_mime_type),
      Number(body.image_file_size) || null,
      normalizeText(body.notes),
      now(),
      req.params.id,
    );
    syncMaterialPrice(Number(req.params.id));
    res.json(one("SELECT * FROM material WHERE id=?", req.params.id));
  }),
);
app.get(
  "/api/materials/:id/prices",
  safe((req, res) =>
    res.json(
      list(
        "SELECT * FROM material_price WHERE material_id=? ORDER BY effective_date DESC,id DESC",
        req.params.id,
      ),
    ),
  ),
);
app.post(
  "/api/materials/:id/prices/confirm",
  safe((req, res) => {
    const material = one(
      `SELECT m.*,c.name category_name,u.symbol unit FROM material m LEFT JOIN material_category c ON c.id=m.category_id JOIN unit u ON u.id=m.unit_id WHERE m.id=? AND COALESCE(m.is_active,1)=1`,
      req.params.id,
    );
    if (!material) throw new Error("材料不存在");
    if (!(Number(material.unit_price) > 0)) throw new Error("请先填写有效单价");
    const priceUnit =
      normalizeText(material.price_unit) ||
      defaultPriceUnit(material.category_name, material.unit);
    db.prepare(
      "INSERT INTO material_price(material_id,supplier,price,price_unit,effective_date,notes) VALUES(?,?,?,?,?,?)",
    ).run(
      material.id,
      normalizeText(material.supplier),
      Number(material.unit_price),
      priceUnit,
      now().slice(0, 10),
      "人工确认价格",
    );
    db.prepare(
      "UPDATE material SET price_updated_at=?,updated_at=? WHERE id=?",
    ).run(now(), now(), material.id);
    res
      .status(201)
      .json(
        list(
          "SELECT * FROM material_price WHERE material_id=? ORDER BY effective_date DESC,id DESC",
          material.id,
        ),
      );
  }),
);
app.delete(
  "/api/materials/:id",
  safe((req, res) => {
    db.prepare("UPDATE material SET is_active=0,updated_at=? WHERE id=?").run(
      now(),
      req.params.id,
    );
    res.status(204).end();
  }),
);
app.get("/api/material-categories", (_, res) =>
  res.json(list("SELECT * FROM material_category ORDER BY sort_order")),
);
app.post(
  "/api/material-categories",
  safe((req, res) => {
    required(req.body.name, "材料分类名称");
    const result = db
      .prepare("INSERT INTO material_category(name,sort_order) VALUES(?,?)")
      .run(
        normalizeText(req.body.name),
        Number(req.body.sort_order) ||
          one("SELECT COUNT(*) total FROM material_category").total,
      );
    res
      .status(201)
      .json(
        one(
          "SELECT * FROM material_category WHERE id=?",
          result.lastInsertRowid,
        ),
      );
  }),
);
app.delete(
  "/api/material-categories/:id",
  safe((req, res) => {
    if (
      one(
        "SELECT COUNT(*) total FROM material WHERE category_id=?",
        req.params.id,
      ).total
    )
      throw new Error("该分类仍有关联材料，不能删除");
    db.prepare("DELETE FROM material_category WHERE id=?").run(req.params.id);
    res.status(204).end();
  }),
);
app.get("/api/units", (_, res) =>
  res.json(list("SELECT * FROM unit ORDER BY id")),
);
const moldSelect = `SELECT mo.*,p.sku product_sku,cp.id cutting_part_id,cp.code cutting_part_code,cp.name cutting_part_name,cp.material_id cutting_part_material_id
  FROM mold mo LEFT JOIN product p ON p.id=mo.product_id LEFT JOIN cutting_part cp ON cp.mold_id=mo.id`;
function moldContext(body, currentMoldId = null) {
  const productId = Number(body.product_id);
  const cuttingPartId = Number(body.cutting_part_id);
  required(productId, "关联产品");
  required(cuttingPartId, "关联裁片");
  const part = one(
    "SELECT cp.*,p.sku product_sku FROM cutting_part cp JOIN product p ON p.id=cp.product_id WHERE cp.id=? AND cp.product_id=?",
    cuttingPartId,
    productId,
  );
  if (!part) throw new Error("所选裁片不属于当前产品");
  if (part.mold_id && Number(part.mold_id) !== Number(currentMoldId))
    throw new Error("该裁片已经关联刀模，请直接编辑原刀模");
  return {
    productId,
    cuttingPartId,
    part,
    code: `DM-${part.code}`,
    name: `${part.product_sku} ${part.name}`,
  };
}
app.get("/api/molds", (_, res) =>
  res.json(list(`${moldSelect} ORDER BY mo.code`)),
);
app.post(
  "/api/molds",
  safe((req, res) => {
    const body = req.body;
    const context = moldContext(body);
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = db
        .prepare(
          "INSERT INTO mold(code,name,product_id,image_url,image_thumbnail_url,image_mime_type,image_file_size,cad_file_url,pdf_file_url,storage_location,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          context.code,
          context.name,
          context.productId,
          normalizeText(body.image_url),
          normalizeText(body.image_thumbnail_url),
          normalizeText(body.image_mime_type),
          Number(body.image_file_size) || null,
          normalizeText(body.cad_file_url),
          normalizeText(body.pdf_file_url),
          normalizeText(body.storage_location),
          normalizeText(body.notes),
        );
      db.prepare("UPDATE cutting_part SET mold_id=? WHERE id=?").run(
        result.lastInsertRowid,
        context.cuttingPartId,
      );
      db.exec("COMMIT");
      res
        .status(201)
        .json(one(`${moldSelect} WHERE mo.id=?`, result.lastInsertRowid));
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }),
);
app.put(
  "/api/molds/:id",
  safe((req, res) => {
    const body = req.body;
    const current = one("SELECT * FROM mold WHERE id=?", req.params.id);
    if (!current) throw new Error("刀模不存在");
    const context = moldContext(body, current.id);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE cutting_part SET mold_id=NULL WHERE mold_id=?").run(
        current.id,
      );
      db.prepare(
        "UPDATE mold SET code=?,name=?,product_id=?,image_url=?,image_thumbnail_url=?,image_mime_type=?,image_file_size=?,cad_file_url=?,pdf_file_url=?,storage_location=?,notes=? WHERE id=?",
      ).run(
        context.code,
        context.name,
        context.productId,
        normalizeText(body.image_url),
        normalizeText(body.image_thumbnail_url),
        normalizeText(body.image_mime_type),
        Number(body.image_file_size) || null,
        normalizeText(body.cad_file_url),
        normalizeText(body.pdf_file_url),
        normalizeText(body.storage_location),
        normalizeText(body.notes),
        current.id,
      );
      db.prepare("UPDATE cutting_part SET mold_id=? WHERE id=?").run(
        current.id,
        context.cuttingPartId,
      );
      db.exec("COMMIT");
      res.json(one(`${moldSelect} WHERE mo.id=?`, current.id));
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }),
);
app.delete(
  "/api/molds/:id",
  safe((req, res) => {
    db.prepare("DELETE FROM mold WHERE id=?").run(req.params.id);
    res.status(204).end();
  }),
);
const cuttingPlanSelect = `SELECT cp.*,p.sku product_sku,r.material_id rule_material_id,r.quantity_per_product rule_pieces_per_lay,
  r.cutting_length_cm rule_cutting_length_cm,r.cutting_mode rule_cutting_mode,m.name material_name,m.specification material_specification
  FROM cutting_plan cp JOIN product p ON p.id=cp.product_id
  LEFT JOIN delivery_rule r ON r.id=cp.delivery_rule_id JOIN material m ON m.id=cp.material_id`;
function hydrateCuttingPlan(plan) {
  if (!plan) return null;
  const cuttingMode =
    normalizeText(plan.cutting_method) ||
    (plan.cutting_mode === "刀模裁剪" ? "刀模裁剪" : "手工裁剪");
  const molds =
    cuttingMode === "刀模裁剪"
      ? list(
          `SELECT mo.id,mo.code,mo.name,mo.image_url,part.name cutting_part_name
    FROM cutting_plan_mold link JOIN mold mo ON mo.id=link.mold_id
    LEFT JOIN cutting_part part ON part.mold_id=mo.id WHERE link.cutting_plan_id=? ORDER BY mo.code`,
          plan.id,
        )
      : [];
  return {
    ...plan,
    cutting_mode: cuttingMode,
    color: "",
    mold_ids: molds.map((item) => item.id),
    molds,
  };
}
function cuttingPlanContext(body, current = null) {
  const productId = Number(body.product_id || current?.product_id);
  const deliveryRuleId = Number(body.delivery_rule_id);
  required(productId, "关联产品");
  required(deliveryRuleId, "布料配货规则");
  const rule = one(
    `${deliveryRuleSelect} WHERE r.id=? AND r.product_id=?`,
    deliveryRuleId,
    productId,
  );
  if (!rule || rule.library_type !== "布料库")
    throw new Error("请选择当前产品的布料库配货规则");
  const cuttingMode =
    normalizeText(
      body.cutting_mode || current?.cutting_method || current?.cutting_mode,
    ) || "手工裁剪";
  if (!["手工裁剪", "刀模裁剪", "其他裁剪"].includes(cuttingMode))
    throw new Error("请选择有效的裁剪方式");
  let moldIds;
  if (Array.isArray(body.mold_ids))
    moldIds = [...new Set(body.mold_ids.map(Number).filter(Boolean))];
  else if (current)
    moldIds = list(
      "SELECT mold_id id FROM cutting_plan_mold WHERE cutting_plan_id=?",
      current.id,
    ).map((item) => item.id);
  else
    moldIds = list(
      `SELECT DISTINCT mo.id FROM mold mo JOIN cutting_part part ON part.mold_id=mo.id
    WHERE mo.product_id=? AND part.material_id=? ORDER BY mo.code`,
      productId,
      rule.material_id,
    ).map((item) => item.id);
  if (cuttingMode !== "刀模裁剪") moldIds = [];
  if (moldIds.length) {
    const validCount = one(
      `SELECT COUNT(*) total FROM mold WHERE product_id=? AND id IN (${moldIds.map(() => "?").join(",")})`,
      productId,
      ...moldIds,
    ).total;
    if (validCount !== moldIds.length)
      throw new Error("关联刀模必须属于当前产品");
  }
  return { productId, deliveryRuleId, rule, moldIds, cuttingMode };
}
function syncCuttingPlanMolds(planId, moldIds) {
  db.prepare("DELETE FROM cutting_plan_mold WHERE cutting_plan_id=?").run(
    planId,
  );
  const add = db.prepare(
    "INSERT INTO cutting_plan_mold(cutting_plan_id,mold_id) VALUES(?,?)",
  );
  moldIds.forEach((moldId) => add.run(planId, moldId));
}
app.get("/api/cutting-plans", (req, res) => {
  const productId = Number(req.query.product_id);
  const where =
    Number.isInteger(productId) && productId > 0
      ? " WHERE cp.product_id=?"
      : "";
  res.json(
    list(
      `${cuttingPlanSelect}${where} ORDER BY p.sku,cp.sort_order,cp.id`,
      ...(where ? [productId] : []),
    ).map(hydrateCuttingPlan),
  );
});
app.post(
  "/api/cutting-plans",
  safe((req, res) => {
    const body = req.body;
    const context = cuttingPlanContext(body);
    const name =
      normalizeText(body.name) || `${context.rule.material_name} 下料参考`;
    const legacyMode =
      context.cuttingMode === "刀模裁剪" ? "刀模裁剪" : "手工裁剪";
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = db
        .prepare(
          "INSERT INTO cutting_plan(product_id,delivery_rule_id,material_id,mold_id,name,color,image_url,image_thumbnail_url,image_mime_type,image_file_size,pieces_per_lay,cutting_length_cm,cutting_mode,cutting_method,notes,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          context.productId,
          context.deliveryRuleId,
          context.rule.material_id,
          context.moldIds[0] || null,
          name,
          "",
          normalizeText(body.image_url),
          normalizeText(body.image_thumbnail_url),
          normalizeText(body.image_mime_type),
          Number(body.image_file_size) || null,
          Number(context.rule.quantity_per_product),
          Number(context.rule.cutting_length_cm),
          legacyMode,
          context.cuttingMode,
          normalizeText(body.notes),
          one(
            "SELECT COUNT(*) total FROM cutting_plan WHERE product_id=?",
            context.productId,
          ).total,
        );
      syncCuttingPlanMolds(result.lastInsertRowid, context.moldIds);
      db.exec("COMMIT");
      res
        .status(201)
        .json(
          hydrateCuttingPlan(
            one(`${cuttingPlanSelect} WHERE cp.id=?`, result.lastInsertRowid),
          ),
        );
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }),
);
app.put(
  "/api/cutting-plans/:id",
  safe((req, res) => {
    const body = req.body;
    const current = one("SELECT * FROM cutting_plan WHERE id=?", req.params.id);
    if (!current) throw new Error("下料方案不存在");
    const context = cuttingPlanContext(body, current);
    const name =
      normalizeText(body.name) || `${context.rule.material_name} 下料参考`;
    const legacyMode =
      context.cuttingMode === "刀模裁剪" ? "刀模裁剪" : "手工裁剪";
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "UPDATE cutting_plan SET product_id=?,delivery_rule_id=?,material_id=?,mold_id=?,name=?,color=?,image_url=?,image_thumbnail_url=?,image_mime_type=?,image_file_size=?,pieces_per_lay=?,cutting_length_cm=?,cutting_mode=?,cutting_method=?,notes=? WHERE id=?",
      ).run(
        context.productId,
        context.deliveryRuleId,
        context.rule.material_id,
        context.moldIds[0] || null,
        name,
        "",
        normalizeText(body.image_url),
        normalizeText(body.image_thumbnail_url),
        normalizeText(body.image_mime_type),
        Number(body.image_file_size) || null,
        Number(context.rule.quantity_per_product),
        Number(context.rule.cutting_length_cm),
        legacyMode,
        context.cuttingMode,
        normalizeText(body.notes),
        current.id,
      );
      syncCuttingPlanMolds(current.id, context.moldIds);
      db.exec("COMMIT");
      res.json(
        hydrateCuttingPlan(
          one(`${cuttingPlanSelect} WHERE cp.id=?`, current.id),
        ),
      );
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }),
);
app.delete(
  "/api/cutting-plans/:id",
  safe((req, res) => {
    db.prepare("DELETE FROM cutting_plan WHERE id=?").run(req.params.id);
    res.status(204).end();
  }),
);

app.post(
  "/api/bom/calculate",
  safe((req, res) => {
    const productId = Number(req.body.productId);
    const quantity = Number(req.body.productionQuantity);
    if (
      !Number.isInteger(productId) ||
      !Number.isInteger(quantity) ||
      quantity < 1
    )
      throw new Error("产品与生产数量必须有效");
    const product = one("SELECT * FROM product WHERE id=?", productId);
    if (!product) throw new Error("产品不存在");
    res.json({
      product,
      productionQuantity: quantity,
      items: calculateBomRequirements(db, productId, quantity),
    });
  }),
);
const deliveryRuleSelect = `SELECT r.*,m.name material_name,m.code material_code,m.color material_color,m.image_url material_image_url,
  m.specification material_specification,m.roll_length_cm,c.name material_category,u.symbol material_unit
  FROM delivery_rule r JOIN material m ON m.id=r.material_id
  LEFT JOIN material_category c ON c.id=m.category_id JOIN unit u ON u.id=m.unit_id`;
function hydrateDeliveryRule(rule) {
  if (!rule) return null;
  const cuttingPlans =
    rule.library_type === "布料库"
      ? list(
          `${cuttingPlanSelect} WHERE cp.delivery_rule_id=? ORDER BY cp.sort_order,cp.id`,
          rule.id,
        ).map(hydrateCuttingPlan)
      : [];
  const colorMappings = list(
    "SELECT product_color,material_color FROM delivery_rule_color_map WHERE delivery_rule_id=? ORDER BY product_color",
    rule.id,
  );
  const linkedParts = list(
    `SELECT cp.id,cp.code,cp.name,cp.quantity_per_product,cp.max_length_cm,cp.max_width_cm,cp.mold_id,mo.code mold_code
    FROM delivery_rule_cutting_part link JOIN cutting_part cp ON cp.id=link.cutting_part_id
    LEFT JOIN mold mo ON mo.id=cp.mold_id WHERE link.delivery_rule_id=? ORDER BY cp.code`,
    rule.id,
  );
  const sourceAccessory = rule.product_accessory_id
    ? one(
        "SELECT id,name,material,specification,color,quantity,unit,notes FROM product_accessory WHERE id=?",
        rule.product_accessory_id,
      )
    : null;
  return {
    ...rule,
    color_strategy: rule.color_strategy || (rule.color ? "fixed" : "follow"),
    color_mappings: colorMappings,
    cutting_plans: cuttingPlans,
    linked_parts: linkedParts,
    source_accessory: sourceAccessory,
  };
}
function deliveryRulesForProduct(productId) {
  return list(
    `${deliveryRuleSelect} WHERE r.product_id=? ORDER BY r.sort_order,r.id`,
    productId,
  ).map(hydrateDeliveryRule);
}
app.get(
  "/api/products/:id/delivery-rules",
  safe((req, res) => res.json(deliveryRulesForProduct(req.params.id))),
);
app.post(
  "/api/products/:id/delivery-rules/reorder",
  safe((req, res) => {
    reorderProductRows("delivery_rule", Number(req.params.id), req.body.ids);
    res.json({ ok: true });
  }),
);
app.post(
  "/api/products/:id/delivery-rules",
  safe((req, res) => {
    const body = req.body;
    const productId = Number(req.params.id);
    const material = one(
      "SELECT m.*,c.name category_name,u.symbol unit FROM material m LEFT JOIN material_category c ON c.id=m.category_id JOIN unit u ON u.id=m.unit_id WHERE m.id=?",
      Number(body.material_id),
    );
    if (!one("SELECT id FROM product WHERE id=?", productId))
      throw new Error("产品不存在");
    if (!material) throw new Error("材料不存在");
    const defaults = deliveryRuleDefaults(material, body);
    if (
      defaults.libraryType === "布料库" &&
      (!Number(body.quantity_per_product) || !Number(body.cutting_length_cm))
    )
      throw new Error("布料规则必须填写单张包数和拉布长度");
    if (
      defaults.libraryType === "长度材料库" &&
      (!Number(body.quantity_per_product) || !Number(body.cutting_length_cm))
    )
      throw new Error("长度材料规则必须填写单包数量和单包长度");
    if (
      defaults.libraryType === "五金配件库" &&
      !Number(body.quantity_per_product)
    )
      throw new Error("五金配件规则必须填写单包数量");
    const colorConfiguration = deliveryRuleColorConfiguration(
      productId,
      defaults,
      body,
    );
    const result = db
      .prepare(
        "INSERT INTO delivery_rule(product_id,material_id,mold_id,category,library_type,color,color_strategy,source_type,is_auto_generated,description,quantity_per_product,cutting_length_cm,unit,calculation_method,cutting_mode,notes,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        productId,
        material.id,
        Number(body.mold_id) || null,
        defaults.category,
        defaults.libraryType,
        colorConfiguration.color,
        colorConfiguration.strategy,
        "manual",
        0,
        normalizeText(body.description),
        Number(body.quantity_per_product),
        Number(body.cutting_length_cm) || null,
        defaults.unit,
        defaults.calculationMethod,
        normalizeText(body.cutting_mode) || "待确认",
        normalizeText(body.notes),
        one(
          "SELECT COUNT(*) total FROM delivery_rule WHERE product_id=?",
          productId,
        ).total,
      );
    const ruleId = Number(result.lastInsertRowid);
    syncDeliveryRuleColorMappings(ruleId, colorConfiguration.mappings);
    res
      .status(201)
      .json(
        hydrateDeliveryRule(one(`${deliveryRuleSelect} WHERE r.id=?`, ruleId)),
      );
  }),
);
app.put(
  "/api/delivery-rules/:id",
  safe((req, res) => {
    const body = req.body;
    const rule = one("SELECT * FROM delivery_rule WHERE id=?", req.params.id);
    if (!rule) throw new Error("配货规则不存在");
    const sourceAccessory = rule.product_accessory_id
      ? one(
          "SELECT * FROM product_accessory WHERE id=?",
          rule.product_accessory_id,
        )
      : null;
    const materialId =
      sourceAccessory?.material_id ||
      Number(body.material_id) ||
      rule.material_id;
    const effectiveBody = sourceAccessory
      ? {
          ...body,
          material_id: materialId,
          quantity_per_product: sourceAccessory.quantity,
          unit: sourceAccessory.unit,
        }
      : { ...body, material_id: materialId };
    const material = ruleMaterial(materialId);
    if (!material) throw new Error("材料不存在");
    const defaults = deliveryRuleDefaults(material, effectiveBody);
    if (!Number(effectiveBody.quantity_per_product))
      throw new Error(
        defaults.libraryType === "布料库"
          ? "请填写单张包数"
          : "请先在配件档案填写单包数量",
      );
    if (
      defaults.libraryType !== "五金配件库" &&
      !Number(effectiveBody.cutting_length_cm)
    )
      throw new Error(
        defaults.libraryType === "布料库" ? "请填写拉布长度" : "请填写单包长度",
      );
    const colorConfiguration = deliveryRuleColorConfiguration(
      rule.product_id,
      defaults,
      effectiveBody,
      rule,
    );
    db.prepare(
      "UPDATE delivery_rule SET material_id=?,mold_id=?,category=?,library_type=?,color=?,color_strategy=?,description=?,quantity_per_product=?,cutting_length_cm=?,unit=?,calculation_method=?,cutting_mode=?,notes=? WHERE id=?",
    ).run(
      material.id,
      Number(effectiveBody.mold_id) || null,
      defaults.category,
      defaults.libraryType,
      colorConfiguration.color,
      colorConfiguration.strategy,
      normalizeText(effectiveBody.description),
      Number(effectiveBody.quantity_per_product),
      Number(effectiveBody.cutting_length_cm) || null,
      defaults.unit,
      defaults.calculationMethod,
      normalizeText(effectiveBody.cutting_mode) || "待确认",
      normalizeText(effectiveBody.notes),
      rule.id,
    );
    syncDeliveryRuleColorMappings(rule.id, colorConfiguration.mappings);
    db.prepare(
      `UPDATE cutting_plan SET material_id=?,pieces_per_lay=?,cutting_length_cm=?,color=''
    WHERE delivery_rule_id=?`,
    ).run(
      material.id,
      Number(effectiveBody.quantity_per_product),
      Number(effectiveBody.cutting_length_cm) || 0,
      rule.id,
    );
    res.json(
      hydrateDeliveryRule(one(`${deliveryRuleSelect} WHERE r.id=?`, rule.id)),
    );
  }),
);
app.delete(
  "/api/delivery-rules/:id",
  safe((req, res) => {
    const rule = one("SELECT * FROM delivery_rule WHERE id=?", req.params.id);
    if (!rule) throw new Error("配货规则不存在");
    if (rule.source_type && rule.source_type !== "manual")
      throw new Error("该资料由裁片档案或配件档案自动维护，请在来源档案中删除");
    if (
      one(
        "SELECT COUNT(*) total FROM cutting_plan WHERE delivery_rule_id=?",
        req.params.id,
      ).total
    )
      throw new Error("该布料规则已关联下料方案，请先修改或删除下料方案");
    db.prepare("DELETE FROM delivery_rule WHERE id=?").run(req.params.id);
    res.status(204).end();
  }),
);
app.post(
  "/api/bom/smart-delivery",
  safe((req, res) => {
    const productId = Number(req.body.productId);
    const product = one("SELECT * FROM product WHERE id=?", productId);
    if (!product) throw new Error("产品不存在");
    res.json({
      product,
      ...calculateSmartDelivery(
        db,
        productId,
        req.body.colorPlans,
        req.body.selectedFabricRuleIds,
      ),
    });
  }),
);

app.post(
  "/api/packing/calculate",
  safe((req, res) => {
    res.json(
      calculatePacking(
        db,
        Number(req.body.productId),
        req.body.productionQuantity,
        req.body.gapCm,
      ),
    );
  }),
);
app.get("/api/sample-quotes/settings", (_, res) => res.json(quoteDefaults()));
app.put(
  "/api/sample-quotes/settings",
  safe((req, res) => {
    const settings = {
      quantity: Math.max(1, Math.floor(Number(req.body.quantity) || 10)),
      gapCm: Math.max(0, Number(req.body.gapCm) || 0),
      lossRate: Math.max(0, Number(req.body.lossRate) || 0),
    };
    db.prepare(
      "INSERT INTO system_setting(setting_key,setting_value,updated_at) VALUES('quote_defaults',?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=excluded.updated_at",
    ).run(JSON.stringify(settings), now());
    res.json(settings);
  }),
);
app.get(
  "/api/sample-quotes",
  safe((req, res) =>
    res.json(
      list(
        `SELECT id,sample_no,name,customer_sku,status,quantity,total_cost,unit_cost,formal_product_id,updated_at FROM sample_quote ORDER BY updated_at DESC,id DESC LIMIT 100`,
      ),
    ),
  ),
);
app.post(
  "/api/sample-quotes",
  safe((req, res) => {
    const defaults = quoteDefaults();
    const sampleNo = generateSampleNo();
    const draft = normalizeQuoteDraft({
      quoteCode: sampleNo,
      productName: sampleNo,
      productionQuantity:
        req.body.productionQuantity ?? defaults.productionQuantity,
      layoutQuantity: req.body.layoutQuantity ?? defaults.layoutQuantity ?? 10,
      gapCm: req.body.gapCm ?? defaults.gapCm,
      lossRate: req.body.lossRate ?? defaults.lossRate,
      materials: [],
      accessories: [],
      processes: [],
    });
    const result = db
      .prepare(
        `INSERT INTO sample_quote(sample_no,name,customer_sku,category,status,quantity,gap_cm,loss_rate,draft_json,notes,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        sampleNo,
        sampleNo,
        normalizeText(req.body.specialProcess),
        normalizeText(req.body.customerName),
        "资料收集中",
        draft.productionQuantity,
        draft.gapCm,
        draft.lossRate,
        JSON.stringify(draft),
        normalizeText(req.body.notes),
        now(),
      );
    db.prepare(
      "INSERT INTO sample_quote_message(sample_quote_id,role,content) VALUES(?,?,?)",
    ).run(
      result.lastInsertRowid,
      "assistant",
      `已创建样品档案 ${sampleNo}。默认按 ${draft.layoutQuantity} 套排版计算单套用料，再按实际做货数量放大；裁片间隙 ${draft.gapCm}cm、材料损耗 ${draft.lossRate}%。请告诉我客户资料、布料、裁片、配件和工序工价。`,
    );
    res.status(201).json(sampleDetail(result.lastInsertRowid));
  }),
);
app.get(
  "/api/sample-quotes/:id",
  safe((req, res) => {
    const sample = sampleDetail(req.params.id);
    if (!sample) throw new Error("样品档案不存在");
    res.json(sample);
  }),
);
app.put(
  "/api/sample-quotes/:id",
  safe((req, res) => {
    const current = sampleDetail(req.params.id);
    if (!current) throw new Error("样品档案不存在");
    if (current.status === "已转正式产品")
      throw new Error("已转正式产品的样品不能再修改");
    const draft = normalizeQuoteDraft({
      ...(req.body.draft || current.draft),
      quoteCode: current.sample_no,
    });
    const status = draft.readyForPacking
      ? current.result
        ? "已核价"
        : "可以核价"
      : "资料收集中";
    db.prepare(
      `UPDATE sample_quote SET name=?,customer_sku=?,category=?,status=?,quantity=?,gap_cm=?,loss_rate=?,draft_json=?,notes=?,updated_at=? WHERE id=?`,
    ).run(
      current.sample_no,
      normalizeText(
        req.body.specialProcess ?? req.body.customerSku ?? current.customer_sku,
      ),
      normalizeText(
        req.body.customerName ?? req.body.category ?? current.category,
      ),
      status,
      draft.productionQuantity,
      draft.gapCm,
      draft.lossRate,
      JSON.stringify(draft),
      normalizeText(req.body.notes ?? current.notes),
      now(),
      current.id,
    );
    res.json(sampleDetail(current.id));
  }),
);
app.delete(
  "/api/sample-quotes/:id",
  safe((req, res) => {
    const current = sampleDetail(req.params.id);
    if (!current) throw new Error("样品档案不存在");
    if (current.formal_product_id)
      throw new Error("已转正式产品的样品不能删除");
    db.prepare("DELETE FROM sample_quote WHERE id=?").run(current.id);
    res.status(204).end();
  }),
);
app.post(
  "/api/sample-quotes/:id/messages",
  asyncSafe(async (req, res) => {
    const current = sampleDetail(req.params.id);
    if (!current) throw new Error("样品档案不存在");
    if (current.status === "已转正式产品")
      throw new Error("该样品已经转为正式产品");
    const message = normalizeText(req.body.message);
    if (!message)
      return res.status(400).json({ message: "请输入需要核对的资料" });
    db.prepare(
      "INSERT INTO sample_quote_message(sample_quote_id,role,content) VALUES(?,?,?)",
    ).run(current.id, "user", message);
    const customerNotes = [current.notes, `【客户补充 ${now()}】\n${message}`]
      .filter(Boolean)
      .join("\n\n");
    db.prepare("UPDATE sample_quote SET notes=?,updated_at=? WHERE id=?").run(
      customerNotes,
      now(),
      current.id,
    );
    // 先由模型理解用户意图，再决定聊天、查询、整理档案或计算，不再依赖关键词正则。
    const history = list(
      "SELECT role,content FROM sample_quote_message WHERE sample_quote_id=? ORDER BY id DESC LIMIT 20",
      current.id,
    ).reverse();
    const decision = await classifyQuoteMessageWithDeepSeek(
      message,
      current.draft,
      history,
      Boolean(current.result),
    );
    if (decision.intent === "chat" || decision.intent === "archive_question") {
      const reply = await chatAboutQuoteWithDeepSeek(
        message,
        {
          sampleNo: current.sample_no,
          status: current.status,
          draft: current.draft,
          result: current.result,
        },
        history,
      );
      db.prepare(
        "INSERT INTO sample_quote_message(sample_quote_id,role,content) VALUES(?,?,?)",
      ).run(current.id, "assistant", reply);
      return res.json(sampleDetail(current.id));
    }
    const extracted = await extractQuoteWithDeepSeek(
      message,
      current.draft,
      history,
    );
    let result = null;
    let reply = buildDraftSyncReply(current.sample_no, extracted.draft);
    let status = "资料收集中";
    if (extracted.draft.readyForPacking) {
      result = calculateDraftPacking(extracted.draft);
      status = "已核价";
      reply = buildQuoteReply(current.sample_no, result);
    }
    db.prepare(
      `UPDATE sample_quote SET status=?,quantity=?,gap_cm=?,loss_rate=?,draft_json=?,result_json=?,total_cost=?,unit_cost=?,updated_at=? WHERE id=?`,
    ).run(
      status,
      extracted.draft.productionQuantity,
      extracted.draft.gapCm,
      extracted.draft.lossRate,
      JSON.stringify(extracted.draft),
      result ? JSON.stringify(result) : current.result_json,
      result?.totalCost ?? current.total_cost,
      result?.unitCost ?? current.unit_cost,
      now(),
      current.id,
    );
    db.prepare(
      "INSERT INTO sample_quote_message(sample_quote_id,role,content) VALUES(?,?,?)",
    ).run(current.id, "assistant", reply);
    res.json(sampleDetail(current.id));
  }),
);
app.post(
  "/api/sample-quotes/:id/calculate",
  safe((req, res) => {
    const current = sampleDetail(req.params.id);
    if (!current) throw new Error("样品档案不存在");
    const draft = normalizeQuoteDraft(req.body.draft || current.draft);
    if (!draft.readyForPacking)
      throw new Error(
        `资料不完整：${draft.missingFields.slice(0, 3).join("；")}`,
      );
    const result = calculateDraftPacking(draft);
    db.prepare(
      `UPDATE sample_quote SET status='已核价',quantity=?,gap_cm=?,loss_rate=?,draft_json=?,result_json=?,total_cost=?,unit_cost=?,updated_at=? WHERE id=?`,
    ).run(
      draft.productionQuantity,
      draft.gapCm,
      draft.lossRate,
      JSON.stringify(draft),
      JSON.stringify(result),
      result.totalCost,
      result.unitCost,
      now(),
      current.id,
    );
    db.prepare(
      "INSERT INTO sample_quote_message(sample_quote_id,role,content) VALUES(?,?,?)",
    ).run(current.id, "assistant", buildQuoteReply(current.sample_no, result));
    res.json(sampleDetail(current.id));
  }),
);
app.post(
  "/api/sample-quotes/:id/images",
  safe((req, res) => {
    const current = sampleDetail(req.params.id);
    if (!current) throw new Error("样品档案不存在");
    const match =
      /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(
        req.body.dataUrl || "",
      );
    if (!match) throw new Error("仅支持 JPG、PNG 或 WebP 图片");
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length > 20 * 1024 * 1024) throw new Error("图片不能超过20MB");
    const extension =
      match[1] === "image/png"
        ? "png"
        : match[1] === "image/webp"
          ? "webp"
          : "jpg";
    const filename = `sample-${current.id}-${Date.now()}.${extension}`;
    fs.writeFileSync(path.join(uploadDirectory, filename), buffer);
    const result = db
      .prepare(
        "INSERT INTO sample_quote_image(sample_quote_id,url,notes) VALUES(?,?,?)",
      )
      .run(current.id, `/uploads/${filename}`, normalizeText(req.body.notes));
    res
      .status(201)
      .json(
        one(
          "SELECT * FROM sample_quote_image WHERE id=?",
          result.lastInsertRowid,
        ),
      );
  }),
);
app.delete(
  "/api/sample-quotes/:sampleId/images/:imageId",
  safe((req, res) => {
    const image = one(
      "SELECT * FROM sample_quote_image WHERE id=? AND sample_quote_id=?",
      req.params.imageId,
      req.params.sampleId,
    );
    if (!image) throw new Error("样品图片不存在");
    db.prepare("DELETE FROM sample_quote_image WHERE id=?").run(image.id);
    const filename = path.basename(image.url || "");
    if (filename) {
      const target = path.join(uploadDirectory, filename);
      if (fs.existsSync(target)) fs.unlinkSync(target);
    }
    res.json({ success: true });
  }),
);
app.post(
  "/api/sample-quotes/:id/attachments",
  asyncSafe(async (req, res) => {
    const current = sampleDetail(req.params.id);
    if (!current) throw new Error("样品档案不存在");
    const allowed = new Map([
      ["image/jpeg", "jpg"],
      ["image/png", "png"],
      ["image/webp", "webp"],
      ["application/pdf", "pdf"],
      ["text/plain", "txt"],
      ["text/csv", "csv"],
      [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xlsx",
      ],
      ["application/vnd.ms-excel", "xls"],
      [
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "docx",
      ],
    ]);
    const match = /^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/.exec(
      req.body.dataUrl || "",
    );
    const extension = allowed.get(match?.[1]);
    if (!extension) throw new Error("支持图片、PDF、TXT、CSV、Excel和Word资料");
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length > 30 * 1024 * 1024) throw new Error("附件不能超过30MB");
    const originalName = normalizeText(req.body.name) || `资料.${extension}`;
    const filename = `sample-file-${current.id}-${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`;
    fs.writeFileSync(path.join(uploadDirectory, filename), buffer);
    const inserted = db
      .prepare(
        `INSERT INTO sample_quote_attachment(sample_quote_id,name,mime_type,url,size_bytes,recognition_status) VALUES(?,?,?,?,?,'processing')`,
      )
      .run(
        current.id,
        originalName,
        match[1],
        `/uploads/${filename}`,
        buffer.length,
      );
    try {
      const isImage = match[1].startsWith("image/");
      const recognition = isImage
        ? {
            text: "图片已直接交给多模态模型理解",
            status: "recognized",
            summary: "AI已完成图片理解",
          }
        : await extractAttachmentText({
            buffer,
            mimeType: match[1],
            name: originalName,
          });
      db.prepare(
        "UPDATE sample_quote_attachment SET recognition_status=?,extracted_text=?,recognition_summary=? WHERE id=?",
      ).run(
        recognition.status,
        recognition.text,
        recognition.summary,
        inserted.lastInsertRowid,
      );
      if (!recognition.text) {
        const userContent = `我上传了核价资料《${originalName}》，请识别并整理到样品档案。`;
        const reply = match[1].startsWith("image/")
          ? "图片中没有识别到清晰的尺寸或文字。请补充更清晰的尺寸表，或直接告诉我布料、裁片尺寸、单套片数、配件用量和单价；我不会只凭外观照片猜测核价数据。"
          : "资料中没有提取到可用于核价的文字，请换一份可复制文字的文件或在对话中补充关键数据。";
        db.prepare(
          "INSERT INTO sample_quote_message(sample_quote_id,role,content) VALUES(?,?,?)",
        ).run(current.id, "user", userContent);
        db.prepare(
          "INSERT INTO sample_quote_message(sample_quote_id,role,content) VALUES(?,?,?)",
        ).run(current.id, "assistant", reply);
        return res.status(201).json(sampleDetail(current.id));
      }
      const userContent = isImage
        ? `我上传了核价图片《${originalName}》。请直接理解图片中的文字、表格、尺寸标注和部位关系，提取能够确认的布料、裁片、尺寸、数量、配件和费用，明确模糊或缺少的数据并填入右侧样品档案。`
        : `我上传了核价资料《${originalName}》。以下是系统从文档提取出的原始内容，请分析并提取布料、幅宽、单价、裁片名称与尺寸、单套片数、旋转限制、配件规格与单套用量、加工包装费用；明确缺少的数据并填入右侧样品档案。\n\n【附件内容】\n${recognition.text}`;
      db.prepare(
        "INSERT INTO sample_quote_message(sample_quote_id,role,content) VALUES(?,?,?)",
      ).run(current.id, "user", userContent);
      db.prepare("UPDATE sample_quote SET notes=?,updated_at=? WHERE id=?").run(
        [
          current.notes,
          `【客户附件 ${now()}】\n${originalName}\n${isImage ? "图片内容由AI直接识别" : recognition.text}`,
        ]
          .filter(Boolean)
          .join("\n\n")
          .slice(0, 100000),
        now(),
        current.id,
      );
      const history = list(
        "SELECT role,content FROM sample_quote_message WHERE sample_quote_id=? ORDER BY id DESC LIMIT 20",
        current.id,
      ).reverse();
      const extracted = await extractQuoteWithDeepSeek(
        userContent,
        current.draft,
        history,
        isImage ? [{ dataUrl: req.body.dataUrl, name: originalName }] : [],
      );
      let result = null;
      let status = "资料收集中";
      let reply = `已读取《${originalName}》并整理到右侧样品档案。${extracted.draft.missingFields.length ? `还需要确认：${extracted.draft.missingFields.slice(0, 5).join("；")}` : "资料已完整，正在计算排料与成本。"}`;
      if (extracted.draft.readyForPacking) {
        result = calculateDraftPacking(extracted.draft);
        status = "已核价";
        reply = buildQuoteReply(current.sample_no, result);
      }
      db.prepare(
        `UPDATE sample_quote SET status=?,quantity=?,gap_cm=?,loss_rate=?,draft_json=?,result_json=?,total_cost=?,unit_cost=?,updated_at=? WHERE id=?`,
      ).run(
        status,
        extracted.draft.productionQuantity,
        extracted.draft.gapCm,
        extracted.draft.lossRate,
        JSON.stringify(extracted.draft),
        result ? JSON.stringify(result) : current.result_json,
        result?.totalCost ?? current.total_cost,
        result?.unitCost ?? current.unit_cost,
        now(),
        current.id,
      );
      db.prepare(
        "INSERT INTO sample_quote_message(sample_quote_id,role,content) VALUES(?,?,?)",
      ).run(current.id, "assistant", reply);
      res.status(201).json(sampleDetail(current.id));
    } catch (error) {
      db.prepare(
        "UPDATE sample_quote_attachment SET recognition_status='failed',recognition_summary=? WHERE id=?",
      ).run(
        String(error.message || "识别失败").slice(0, 500),
        inserted.lastInsertRowid,
      );
      throw error;
    }
  }),
);
app.post(
  "/api/sample-quotes/:id/convert",
  safe((req, res) => {
    const sample = sampleDetail(req.params.id);
    if (!sample) throw new Error("样品档案不存在");
    if (sample.formal_product_id)
      return res.json({
        productId: sample.formal_product_id,
        alreadyConverted: true,
      });
    if (!sample.result) throw new Error("样品完成核价后才能转为正式产品");
    const materialMap = new Map();
    const missing = [];
    sample.draft.materials.forEach((item) => {
      const material = one(
        "SELECT id,name FROM material WHERE name=? ORDER BY id LIMIT 1",
        item.name,
      );
      if (material) materialMap.set(item.id, material);
      else missing.push(item.name);
    });
    sample.draft.accessories.forEach((item) => {
      const material = one(
        "SELECT id,name FROM material WHERE name=? ORDER BY id LIMIT 1",
        item.name,
      );
      if (material) materialMap.set(item.id, material);
      else missing.push(item.name);
    });
    if (missing.length)
      throw new Error(
        `以下临时材料尚未匹配材料库：${[...new Set(missing)].join("、")}`,
      );
    const sku = normalizeText(req.body.sku) || sample.sample_no;
    const name = normalizeText(req.body.name) || sample.sample_no;
    if (one("SELECT id FROM product WHERE sku=?", sku))
      throw new Error("正式产品货号已存在，请填写新的货号");
    const code = generateProductCode();
    db.exec("BEGIN IMMEDIATE");
    try {
      const created = db
        .prepare(
          `INSERT INTO product(code,sku,name,category,color,brand,development_date,status,warehouse_location,strap_info,process_notes,notes,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          code,
          sku,
          name,
          ensureProductCategory(req.body.category || "其它"),
          "",
          "",
          "",
          "打样中",
          "",
          sample.customer_sku || "",
          normalizeText(req.body.processNotes),
          sample.notes || `由样品 ${sample.sample_no} 转入`,
          now(),
        );
      const productId = Number(created.lastInsertRowid);
      syncParts(
        productId,
        sample.draft.materials.flatMap((material) =>
          material.pieces.map((piece) => ({
            material_id: materialMap.get(material.id).id,
            name: piece.name,
            max_length_cm: piece.lengthCm,
            max_width_cm: piece.widthCm,
            quantity_per_product: piece.quantityPerSet,
            rotation_mode: piece.rotatable === false ? "fixed" : "free",
            gap_cm: sample.draft.gapCm,
          })),
        ),
      );
      syncAccessories(
        productId,
        sample.draft.accessories.map((item) => ({
          material_id: materialMap.get(item.id).id,
          quantity: item.quantityPerSet,
          notes: item.specification,
        })),
      );
      const addProcess = db.prepare(
        `INSERT INTO product_process(product_id,work_process_id,operation_part,quantity_per_product,duration_minutes,unit_price,notes,sort_order,effective_date,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      );
      sample.draft.processes.forEach((item, index) => {
        let processId = Number(item.workProcessId) || 0;
        if (!one("SELECT id FROM work_process WHERE id=?", processId)) {
          const existing = one(
            "SELECT id FROM work_process WHERE name=?",
            item.name,
          );
          processId =
            existing?.id ||
            Number(
              db
                .prepare(
                  `INSERT INTO work_process(code,name,category,default_unit_price,updated_at) VALUES(?,?,?,?,?)`,
                )
                .run(
                  generateWorkProcessCode(),
                  item.name,
                  "样品自定义",
                  Number(item.unitPrice) || 0,
                  now(),
                ).lastInsertRowid,
            );
        }
        addProcess.run(
          productId,
          processId,
          item.operationPart || "",
          Number(item.quantityPerSet) || 1,
          0,
          Number(item.unitPrice) || 0,
          item.notes || "",
          index,
          now().slice(0, 10),
          now(),
        );
      });
      db.prepare(
        "UPDATE sample_quote SET status='已转正式产品',formal_product_id=?,updated_at=? WHERE id=?",
      ).run(productId, now(), sample.id);
      db.exec("COMMIT");
      res.status(201).json({ productId, code, sku, name });
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }),
);
app.post(
  "/api/sample-quotes/:id/quotation",
  safe((req, res) => {
    const sample = sampleDetail(req.params.id);
    if (!sample) throw new Error("样品档案不存在");
    if (!sample.result) throw new Error("样品完成核价后才能转为报价单");
    const prefix = `BJ-${now().slice(0, 10).replaceAll("-", "")}`;
    const sequence =
      Number(
        one(
          "SELECT COUNT(*) total FROM quotation WHERE quote_no LIKE ?",
          `${prefix}%`,
        ).total,
      ) + 1;
    const quoteNo = `${prefix}-${String(sequence).padStart(3, "0")}`;
    const customer = one(
      "SELECT * FROM customer WHERE name=? ORDER BY id LIMIT 1",
      sample.category || "",
    );
    const quoteDate = now().slice(0, 10);
    const validUntil = new Date(Date.now() + 15 * 86400000)
      .toISOString()
      .slice(0, 10);
    const result = db
      .prepare(
        `INSERT INTO quotation(quote_no,sample_quote_id,customer_name,quantity,unit_price,total_price,snapshot_json,status,quote_date,valid_until,contact_name,phone,email,address,currency,updated_at) VALUES(?,?,?,?,?,?,?,'草稿',?,?,?,?,?,?,?,?)`,
      )
      .run(
        quoteNo,
        sample.id,
        sample.category || "",
        Number(sample.result.productionQuantity) || 1,
        Number(sample.result.unitQuote) || 0,
        Number(sample.result.totalQuote) || 0,
        JSON.stringify({
          sampleNo: sample.sample_no,
          draft: sample.draft,
          result: sample.result,
        }),
        quoteDate,
        validUntil,
        customer?.contact_name || "",
        customer?.phone || "",
        customer?.email || "",
        customer?.address || "",
        customer?.currency || "CNY",
        now(),
      );
    const quoteId = Number(result.lastInsertRowid);
    db.prepare(
      `INSERT INTO quotation_item(quotation_id,sample_quote_id,sample_no,customer_sku,product_name,image_url,color,special_process,quantity,unit,unit_price,cost_snapshot_json,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0)`,
    ).run(
      quoteId,
      sample.id,
      sample.sample_no,
      sample.customer_sku || "",
      sample.name || sample.sample_no,
      sample.images?.[0]?.url || "",
      sample.draft.color || "",
      sample.customer_sku || "",
      Number(sample.result.productionQuantity) || 1,
      "个",
      Number(sample.result.unitQuote) || 0,
      JSON.stringify({ draft: sample.draft, result: sample.result }),
    );
    defaultQuotationTerms.forEach((term, index) =>
      db
        .prepare(
          "INSERT INTO quotation_term(quotation_id,label,content,sort_order) VALUES(?,?,?,?)",
        )
        .run(quoteId, term[0], term[1], index),
    );
    res.status(201).json({ id: quoteId, quote_no: quoteNo });
  }),
);

const parseSnapshot = (value) => parseJson(value, {});
const defaultQuotationTerms = [
  [
    "付款方式 / Payment",
    "如有尾款未付清，发货前需付清尾款后才能发货。",
  ],
  [
    "生产 Production",
    "生产以最终确认的样品为准；工期从资料和定金确认后计算。",
  ],
  [
    "样品费 Sample",
    "¥200/每款，下大货订单后可退样品费。",
  ],
  [
    "物流与交付 / Shipping & Delivery",
    "生产工期不含运输与清关时间；发货前确认数量、包装、运输方式及收货信息。",
  ],
];
function quotationDetail(id) {
  const quote = one("SELECT * FROM quotation WHERE id=?", id);
  if (!quote) return null;
  return {
    ...quote,
    snapshot: parseSnapshot(quote.snapshot_json),
    items: list(
      "SELECT * FROM quotation_item WHERE quotation_id=? ORDER BY sort_order,id",
      id,
    ).map((item) => ({
      ...item,
      costSnapshot: parseSnapshot(item.cost_snapshot_json),
      priceTiers: parseSnapshot(item.price_tiers_json),
    })),
    fees: list(
      "SELECT * FROM quotation_fee WHERE quotation_id=? ORDER BY sort_order,id",
      id,
    ),
    terms: list(
      "SELECT * FROM quotation_term WHERE quotation_id=? AND label NOT LIKE '%报价有效期%' AND label NOT LIKE '%Quotation Validity%' ORDER BY sort_order,id",
      id,
    ),
  };
}
function quoteTotals(items, fees, quote) {
  const merchandise = items.reduce(
    (sum, item) =>
      sum +
      Math.max(0, Number(item.quantity) || 0) *
        Math.max(0, Number(item.unitPrice ?? item.unit_price) || 0) *
        (1 -
          Math.min(
            100,
            Math.max(0, Number(item.discountRate ?? item.discount_rate) || 0),
          ) /
            100),
    0,
  );
  const extras = fees
    .filter((item) => item.enabled !== false && Number(item.enabled) !== 0)
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const subtotal =
    Math.max(0, merchandise - Math.max(0, Number(quote.orderDiscount) || 0)) +
    Math.max(0, Number(quote.shippingFee) || 0) +
    extras;
  const total = subtotal * (1 + Math.max(0, Number(quote.taxRate) || 0) / 100);
  return {
    merchandise: Number(merchandise.toFixed(2)),
    total: Number(total.toFixed(2)),
  };
}
app.get(
  "/api/quotations",
  safe((req, res) => {
    const keyword = `%${normalizeText(req.query.keyword)}%`;
    const status = normalizeText(req.query.status) || "all";
    res.json(
      list(
        `SELECT q.*,COUNT(qi.id) item_count FROM quotation q LEFT JOIN quotation_item qi ON qi.quotation_id=q.id WHERE (?='all' OR q.status=?) AND (q.quote_no LIKE ? OR COALESCE(q.customer_name,'') LIKE ? OR EXISTS(SELECT 1 FROM quotation_item x WHERE x.quotation_id=q.id AND x.product_name LIKE ?)) GROUP BY q.id ORDER BY q.updated_at DESC,q.id DESC LIMIT 10`,
        status,
        status,
        keyword,
        keyword,
        keyword,
      ),
    );
  }),
);
app.get(
  "/api/quotations/:id",
  safe((req, res) => {
    const quote = quotationDetail(req.params.id);
    if (!quote) throw new Error("报价单不存在");
    res.json(quote);
  }),
);
app.post(
  "/api/quotations",
  safe((req, res) => {
    const prefix = `BJ-${now().slice(0, 10).replaceAll("-", "")}`;
    const sequence =
      Number(
        one(
          "SELECT COUNT(*) total FROM quotation WHERE quote_no LIKE ?",
          `${prefix}%`,
        ).total,
      ) + 1;
    const quoteNo = `${prefix}-${String(sequence).padStart(3, "0")}`;
    const result = db
      .prepare(
        `INSERT INTO quotation(quote_no,sample_quote_id,customer_name,quantity,unit_price,total_price,snapshot_json,status,quote_date,valid_until,currency,updated_at) VALUES(?,NULL,'',0,0,0,'{}','草稿',?,?,?,?)`,
      )
      .run(
        quoteNo,
        now().slice(0, 10),
        new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
        "CNY",
        now(),
      );
    const quoteId = Number(result.lastInsertRowid);
    defaultQuotationTerms.forEach((term, index) =>
      db
        .prepare(
          "INSERT INTO quotation_term(quotation_id,label,content,sort_order) VALUES(?,?,?,?)",
        )
        .run(quoteId, term[0], term[1], index),
    );
    db.prepare("UPDATE quotation SET deposit_rate=100 WHERE id=?").run(quoteId);
    res.status(201).json(quotationDetail(quoteId));
  }),
);
app.put(
  "/api/quotations/:id",
  safe((req, res) => {
    const current = quotationDetail(req.params.id);
    if (!current) throw new Error("报价单不存在");
    const body = req.body;
    const items = Array.isArray(body.items) ? body.items : [];
    const fees = Array.isArray(body.fees) ? body.fees : [];
    const terms = (Array.isArray(body.terms) ? body.terms : [])
      .filter((item) => !/报价有效期|Quotation Validity/i.test(normalizeText(item.label)));
    const totals = quoteTotals(items, fees, body);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        `UPDATE quotation SET customer_name=?,quote_date=?,valid_until=?,contact_name=?,phone=?,email=?,address=?,salesperson=?,currency=?,exchange_rate=?,template_key=?,language_key=?,order_discount=?,shipping_fee=?,tax_rate=?,deposit_rate=?,payment_terms=?,trade_term=?,delivery_term=?,packaging_term=?,shipping_term=?,quality_term=?,customer_notes=?,internal_notes=?,shipping_origin=?,complaint_contact=?,complaint_phone=?,complaint_email=?,complaint_wechat=?,status=?,quantity=?,unit_price=?,total_price=?,updated_at=? WHERE id=?`,
      ).run(
        normalizeText(body.customerName),
        normalizeText(body.quoteDate),
        normalizeText(body.validUntil),
        normalizeText(body.contactName),
        normalizeText(body.phone),
        normalizeText(body.email),
        normalizeText(body.address),
        normalizeText(body.salesperson),
        normalizeText(body.currency) || "CNY",
        Math.max(0, Number(body.exchangeRate) || 1),
        normalizeText(body.templateKey) || "classic",
        normalizeText(body.languageKey) || "zh",
        Math.max(0, Number(body.orderDiscount) || 0),
        Math.max(0, Number(body.shippingFee) || 0),
        Math.max(0, Number(body.taxRate) || 0),
        Math.max(0, Number(body.depositRate) || 0),
        normalizeText(body.paymentTerms),
        normalizeText(body.tradeTerm),
        normalizeText(body.deliveryTerm),
        normalizeText(body.packagingTerm),
        normalizeText(body.shippingTerm),
        normalizeText(body.qualityTerm),
        normalizeText(body.customerNotes),
        normalizeText(body.internalNotes),
        normalizeText(body.shippingOrigin),
        normalizeText(body.complaintContact),
        normalizeText(body.complaintPhone),
        normalizeText(body.complaintEmail),
        normalizeText(body.complaintWechat),
        normalizeText(body.status) || "草稿",
        items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
        items[0]?.unitPrice || 0,
        totals.total,
        now(),
        current.id,
      );
      db.prepare("DELETE FROM quotation_item WHERE quotation_id=?").run(
        current.id,
      );
      db.prepare("DELETE FROM quotation_fee WHERE quotation_id=?").run(
        current.id,
      );
      db.prepare("DELETE FROM quotation_term WHERE quotation_id=?").run(
        current.id,
      );
      const addItem = db.prepare(
        `INSERT INTO quotation_item(quotation_id,sample_quote_id,sample_no,customer_sku,product_name,product_name_foreign,image_url,show_image,color,dimensions,special_process,quantity,unit,unit_price,discount_rate,delivery_days,packaging,notes,notes_foreign,cost_snapshot_json,price_tiers_json,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      );
      items.forEach((item, index) =>
        addItem.run(
          current.id,
          Number(item.sampleQuoteId) || null,
          normalizeText(item.sampleNo),
          normalizeText(item.customerSku),
          normalizeText(item.productName) || `产品${index + 1}`,
          normalizeText(item.productNameForeign),
          normalizeText(item.imageUrl),
          item.showImage === false ? 0 : 1,
          normalizeText(item.color),
          normalizeText(item.dimensions),
          normalizeText(item.specialProcess),
          Math.max(0, Number(item.quantity) || 0),
          normalizeText(item.unit) || "个",
          Math.max(0, Number(item.unitPrice) || 0),
          Math.min(100, Math.max(0, Number(item.discountRate) || 0)),
          Math.max(0, Number(item.deliveryDays) || 0) || null,
          normalizeText(item.packaging),
          normalizeText(item.notes),
          normalizeText(item.notesForeign),
          JSON.stringify(item.costSnapshot || {}),
          JSON.stringify(Array.isArray(item.priceTiers) ? item.priceTiers : []),
          index,
        ),
      );
      fees.forEach((item, index) =>
        db
          .prepare(
            "INSERT INTO quotation_fee(quotation_id,name,amount,enabled,sort_order) VALUES(?,?,?,?,?)",
          )
          .run(
            current.id,
            normalizeText(item.name) || `附加费用${index + 1}`,
            Number(item.amount) || 0,
            item.enabled === false ? 0 : 1,
            index,
          ),
      );
      terms.forEach((item, index) =>
        db
          .prepare(
            "INSERT INTO quotation_term(quotation_id,label,content,content_foreign,enabled,sort_order) VALUES(?,?,?,?,?,?)",
          )
          .run(
            current.id,
            normalizeText(item.label) || `条款${index + 1}`,
            normalizeText(item.content),
            normalizeText(item.contentForeign),
            item.enabled === false ? 0 : 1,
            index,
          ),
      );
      db.exec("COMMIT");
      res.json(quotationDetail(current.id));
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }),
);
app.delete(
  "/api/quotations/:id",
  safe((req, res) => {
    const quote = one("SELECT * FROM quotation WHERE id=?", req.params.id);
    if (!quote) throw new Error("报价单不存在");
    db.prepare("DELETE FROM quotation WHERE id=?").run(quote.id);
    res.status(204).end();
  }),
);
app.post(
  "/api/quotations/:id/items/from-sample/:sampleId",
  safe((req, res) => {
    const quote = quotationDetail(req.params.id);
    const sample = sampleDetail(req.params.sampleId);
    if (!quote || !sample?.result) throw new Error("报价单或核价样品不存在");
    const order = one(
      "SELECT COUNT(*) total FROM quotation_item WHERE quotation_id=?",
      quote.id,
    ).total;
    db.prepare(
      `INSERT INTO quotation_item(quotation_id,sample_quote_id,sample_no,customer_sku,product_name,image_url,color,special_process,quantity,unit,unit_price,packaging,cost_snapshot_json,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      quote.id,
      sample.id,
      sample.sample_no,
      sample.customer_sku || "",
      sample.name || sample.sample_no,
      sample.images?.[0]?.url || "",
      sample.draft.color || "",
      sample.customer_sku || "",
      sample.result.productionQuantity || 1,
      "个",
      sample.result.unitQuote || 0,
      sample.draft.packagingUnit || sample.draft.packaging || "",
      JSON.stringify({ draft: sample.draft, result: sample.result }),
      order,
    );
    const customer = one(
      "SELECT * FROM customer WHERE name=? ORDER BY id LIMIT 1",
      sample.category || "",
    );
    db.prepare(
      `UPDATE quotation SET customer_name=CASE WHEN TRIM(COALESCE(customer_name,''))='' THEN ? ELSE customer_name END,contact_name=CASE WHEN TRIM(COALESCE(contact_name,''))='' THEN ? ELSE contact_name END,phone=CASE WHEN TRIM(COALESCE(phone,''))='' THEN ? ELSE phone END,email=CASE WHEN TRIM(COALESCE(email,''))='' THEN ? ELSE email END,address=CASE WHEN TRIM(COALESCE(address,''))='' THEN ? ELSE address END,currency=CASE WHEN TRIM(COALESCE(customer_name,''))='' THEN ? ELSE currency END,updated_at=? WHERE id=?`,
    ).run(
      sample.category || "",
      customer?.contact_name || "",
      customer?.phone || "",
      customer?.email || "",
      customer?.address || "",
      customer?.currency || "CNY",
      now(),
      quote.id,
    );
    res.status(201).json(quotationDetail(quote.id));
  }),
);
app.get("/api/ai-quotes/config", (_, res) =>
  res.json({
    configured: Boolean(process.env.SILICONFLOW_API_KEY),
    provider: "硅基流动",
    model: process.env.SILICONFLOW_MODEL || "Qwen/Qwen3.5-397B-A17B",
    imageRecognition: true,
    recognitionPipeline: "Qwen multimodal",
  }),
);
app.post(
  "/api/ai-quotes/extract",
  asyncSafe(async (req, res) => {
    const message = normalizeText(req.body.message);
    if (!message)
      return res.status(400).json({ message: "请先输入产品、裁片或配件信息" });
    const extracted = await extractQuoteWithDeepSeek(message, req.body.draft);
    if (!extracted.draft.readyForPacking) return res.json(extracted);
    const result = calculateDraftPacking(extracted.draft);
    const finalMessage = buildQuoteReply(extracted.draft.quoteCode, result);
    res.json({
      ...extracted,
      assistantMessage: finalMessage,
      result,
      completed: true,
    });
  }),
);
app.post(
  "/api/ai-quotes/validate",
  safe((req, res) => res.json(normalizeQuoteDraft(req.body.draft || req.body))),
);
app.post(
  "/api/ai-quotes/calculate",
  safe((req, res) => {
    const draft = normalizeQuoteDraft(req.body.draft || req.body);
    if (!draft.readyForPacking)
      throw new Error(
        `报价资料还不完整：${draft.missingFields.slice(0, 3).join("；")}`,
      );
    res.json(calculateDraftPacking(draft));
  }),
);
app.get(
  "/api/packing/plans",
  safe((req, res) => {
    const productId = Number(req.query.product_id) || 0;
    res.json(
      list(
        `SELECT pp.*,p.sku,p.name product_name,(SELECT COUNT(*) FROM packing_plan_material ppm WHERE ppm.packing_plan_id=pp.id) material_count
    FROM packing_plan pp JOIN product p ON p.id=pp.product_id WHERE (?=0 OR pp.product_id=?) ORDER BY pp.created_at DESC,pp.id DESC`,
        productId,
        productId,
      ),
    );
  }),
);
app.post(
  "/api/packing/plans",
  safe((req, res) => {
    const calculation = calculatePacking(
      db,
      Number(req.body.productId),
      req.body.productionQuantity,
      req.body.gapCm,
    );
    const planNo = `PK-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${String(Date.now()).slice(-5)}`;
    db.exec("BEGIN IMMEDIATE");
    try {
      const algorithm = [
        ...new Set(calculation.materials.map((item) => item.algorithm)),
      ].join(",");
      const result = db
        .prepare(
          `INSERT INTO packing_plan(plan_no,product_id,production_quantity,gap_cm,algorithm,accessory_cost,material_cost,total_cost)
      VALUES(?,?,?,?,?,?,?,?)`,
        )
        .run(
          planNo,
          calculation.product.id,
          calculation.productionQuantity,
          calculation.gapCm,
          algorithm,
          calculation.accessoryCost,
          calculation.fabricCost,
          calculation.totalMaterialCost,
        );
      const add =
        db.prepare(`INSERT INTO packing_plan_material(packing_plan_id,material_id,material_name,material_color,fabric_width_cm,usable_width_cm,used_length_cm,utilization_rate,unit_price,material_cost,layout_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
      calculation.materials.forEach((item) =>
        add.run(
          result.lastInsertRowid,
          item.materialId,
          item.materialName,
          item.materialColor,
          item.fabricWidthCm,
          item.usableWidthCm,
          item.usedLengthCm,
          item.utilizationRate,
          item.unitPrice,
          item.materialCost,
          JSON.stringify(item.pieces),
        ),
      );
      db.exec("COMMIT");
      res
        .status(201)
        .json({ id: Number(result.lastInsertRowid), planNo, ...calculation });
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }),
);

function deliveryOrderDetail(id) {
  const order = one("SELECT * FROM delivery_order WHERE id=?", id);
  if (!order) return null;
  const currentProcessLabor = productProcessLabor(order.product_id);
  return {
    ...order,
    warnings: parseJson(order.warnings_json),
    selectedFabricRuleIds: parseJson(order.selected_fabric_rule_ids),
    colors: list(
      "SELECT * FROM delivery_order_color WHERE delivery_order_id=? ORDER BY id",
      id,
    ),
    items: list(
      "SELECT * FROM delivery_order_item WHERE delivery_order_id=? ORDER BY sort_order,id",
      id,
    ).map((item) => ({
      ...item,
      cuttingPlans: parseJson(item.cutting_plans_json),
    })),
    laborProcessSnapshot: parseJson(order.labor_process_snapshot_json) || [],
    suggestedLaborUnitCost: currentProcessLabor.unitCost,
    suggestedProcessCount: currentProcessLabor.processCount,
    suggestedProcessMinutes: currentProcessLabor.totalMinutes,
  };
}
app.get(
  "/api/delivery-orders",
  safe((req, res) => {
    const keyword = `%${normalizeText(req.query.keyword)}%`;
    const status = normalizeText(req.query.status);
    const productId = Number(req.query.product_id);
    const hasProduct = Number.isInteger(productId) && productId > 0;
    const requestedLimit = Number(req.query.limit);
    const limit =
      Number.isInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 100)
        : null;
    res.json(
      list(
        `SELECT d.*,COUNT(i.id) item_count FROM delivery_order d
    LEFT JOIN delivery_order_item i ON i.delivery_order_id=d.id
    WHERE (d.order_no LIKE ? OR d.product_sku LIKE ? OR d.product_name LIKE ?)
      AND (?='' OR d.status=?) AND (?=0 OR d.product_id=?)
    GROUP BY d.id ORDER BY d.created_at DESC,d.id DESC${limit ? ` LIMIT ${limit}` : ""}`,
        keyword,
        keyword,
        keyword,
        status,
        status,
        hasProduct ? productId : 0,
        hasProduct ? productId : 0,
      ),
    );
  }),
);
app.get(
  "/api/delivery-orders/:id",
  safe((req, res) => {
    const detail = deliveryOrderDetail(req.params.id);
    if (!detail) throw new Error("配货清单不存在");
    res.json(detail);
  }),
);
app.post(
  "/api/delivery-orders",
  safe((req, res) => {
    const productId = Number(req.body.productId);
    const product = one("SELECT * FROM product WHERE id=?", productId);
    if (!product) throw new Error("产品不存在");
    const calculation = calculateSmartDelivery(
      db,
      productId,
      req.body.colorPlans,
      req.body.selectedFabricRuleIds,
    );
    const selectedItems = calculation.groups
      .flatMap((group) => group.items)
      .filter((item) => item.library_type !== "布料库" || item.isSelected);
    const selectedCuttingPlanIds =
      req.body.selectedCuttingPlanIds &&
      typeof req.body.selectedCuttingPlanIds === "object"
        ? req.body.selectedCuttingPlanIds
        : {};
    if (!selectedItems.length) throw new Error("配货结果为空，无法保存");
    const orderNo = generateDeliveryOrderNo();
    db.exec("BEGIN IMMEDIATE");
    try {
      const orderResult = db
        .prepare(
          `INSERT INTO delivery_order(order_no,product_id,product_code,product_sku,product_name,production_quantity,status,selected_fabric_rule_ids,warnings_json,notes,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          orderNo,
          productId,
          product.code,
          product.sku,
          product.name,
          calculation.productionQuantity,
          "草稿",
          JSON.stringify(req.body.selectedFabricRuleIds || []),
          JSON.stringify(calculation.warnings || []),
          normalizeText(req.body.notes),
          now(),
        );
      const orderId = Number(orderResult.lastInsertRowid);
      const addColor = db.prepare(
        "INSERT INTO delivery_order_color(delivery_order_id,product_color,quantity) VALUES(?,?,?)",
      );
      calculation.colorPlans.forEach((plan) =>
        addColor.run(orderId, plan.color, plan.quantity),
      );
      const addItem =
        db.prepare(`INSERT INTO delivery_order_item(delivery_order_id,delivery_rule_id,material_id,library_type,material_code,material_name,material_category,material_specification,material_image_url,material_color,source_plan_colors,unit,required_quantity,total_pieces,total_length_m,roll_count,unit_price,price_unit,material_cost,calculation_detail,cutting_mode,cutting_plans_json,sort_order)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      selectedItems.forEach((item, index) => {
        const requestedPlanId = Number(selectedCuttingPlanIds[item.groupKey]);
        const selectedPlan =
          (item.cuttingPlans || []).find(
            (plan) => Number(plan.id) === requestedPlanId,
          ) ||
          item.cuttingPlans?.[0] ||
          null;
        const cuttingPlanSnapshot = selectedPlan
          ? [{ ...selectedPlan, selected: true }]
          : [];
        addItem.run(
          orderId,
          item.id,
          item.material_id,
          item.library_type,
          item.material_code,
          item.material_name,
          item.material_category,
          item.material_specification,
          item.material_image_url,
          item.materialColor,
          (item.sourcePlanColors || [item.planColor]).join("、"),
          item.unit,
          item.requiredQuantity,
          item.totalPieces,
          item.totalLengthM,
          item.rollCount,
          item.effectiveUnitPrice ?? item.unit_price ?? null,
          item.priceUnit || item.price_unit || "",
          item.estimatedCost,
          item.detail,
          selectedPlan?.cutting_mode || item.cutting_mode,
          JSON.stringify(cuttingPlanSnapshot),
          index,
        );
      });
      const materialCost = Number(
        selectedItems
          .reduce((sum, item) => sum + Number(item.estimatedCost || 0), 0)
          .toFixed(2),
      );
      const processLabor = productProcessLabor(productId);
      const laborCost = Number(
        (processLabor.unitCost * calculation.productionQuantity).toFixed(2),
      );
      const totalCost = Number((materialCost + laborCost).toFixed(2));
      db.prepare(
        `UPDATE delivery_order SET material_cost=?,labor_unit_cost=?,labor_cost=?,labor_source=?,labor_process_snapshot_json=?,total_cost=? WHERE id=?`,
      ).run(
        materialCost,
        processLabor.unitCost,
        laborCost,
        processLabor.processCount ? "process_archive" : "manual",
        JSON.stringify(processLabor.items),
        totalCost,
        orderId,
      );
      db.exec("COMMIT");
      res.status(201).json(deliveryOrderDetail(orderId));
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }),
);
app.put(
  "/api/delivery-orders/:id/status",
  safe((req, res) => {
    const status = normalizeText(req.body.status);
    if (!["草稿", "已确认", "已领料", "已完成", "已作废"].includes(status))
      throw new Error("清单状态无效");
    db.prepare(
      "UPDATE delivery_order SET status=?,updated_at=? WHERE id=?",
    ).run(status, now(), req.params.id);
    res.json(deliveryOrderDetail(req.params.id));
  }),
);
app.delete(
  "/api/delivery-orders/:id",
  safe((req, res) => {
    const order = one("SELECT * FROM delivery_order WHERE id=?", req.params.id);
    if (!order) throw new Error("配货清单不存在");
    if (!["草稿", "已作废"].includes(order.status))
      throw new Error("只有草稿或已作废清单可以删除");
    db.prepare("DELETE FROM delivery_order WHERE id=?").run(order.id);
    res.status(204).end();
  }),
);
app.put(
  "/api/delivery-orders/:id/cost",
  safe((req, res) => {
    const order = one("SELECT * FROM delivery_order WHERE id=?", req.params.id);
    if (!order) throw new Error("配货清单不存在");
    const priceMap = new Map(
      (Array.isArray(req.body.items) ? req.body.items : []).map((item) => [
        Number(item.id),
        Number(item.unitPrice),
      ]),
    );
    const items = list(
      "SELECT * FROM delivery_order_item WHERE delivery_order_id=? ORDER BY id",
      order.id,
    );
    db.exec("BEGIN IMMEDIATE");
    try {
      let materialCost = 0;
      const updateItem = db.prepare(
        "UPDATE delivery_order_item SET unit_price=?,price_unit=?,material_cost=? WHERE id=?",
      );
      items.forEach((item) => {
        const currentMaterial = item.material_id
          ? one(
              `SELECT m.*,c.name category_name,u.symbol unit FROM material m LEFT JOIN material_category c ON c.id=m.category_id JOIN unit u ON u.id=m.unit_id WHERE m.id=?`,
              item.material_id,
            )
          : null;
        let unitPrice = priceMap.has(item.id)
          ? priceMap.get(item.id)
          : Number(item.unit_price);
        if (req.body.useCurrentPrices && currentMaterial) {
          unitPrice =
            Number(currentMaterial.unit_price) ||
            (Number(currentMaterial.roll_price) > 0 &&
            Number(currentMaterial.roll_length_cm) > 0
              ? Number(currentMaterial.roll_price) /
                (Number(currentMaterial.roll_length_cm) / 100)
              : 0);
        }
        const priceUnit =
          normalizeText(currentMaterial?.price_unit) ||
          item.price_unit ||
          defaultPriceUnit(currentMaterial?.category_name, item.unit);
        const itemCost = Number(
          (Number(item.required_quantity) * Number(unitPrice || 0)).toFixed(2),
        );
        materialCost += itemCost;
        updateItem.run(
          unitPrice || null,
          priceUnit,
          unitPrice > 0 ? itemCost : null,
          item.id,
        );
      });
      materialCost = Number(materialCost.toFixed(2));
      const lossRate = Math.max(0, Number(req.body.lossRate) || 0);
      const lossCost = Number(((materialCost * lossRate) / 100).toFixed(2));
      const processLabor = productProcessLabor(order.product_id);
      const useProcessLaborCost = Boolean(req.body.useProcessLaborCost);
      const laborUnitCost = useProcessLaborCost
        ? processLabor.unitCost
        : Math.max(0, Number(req.body.laborUnitCost) || 0);
      const packagingUnitCost = Math.max(
        0,
        Number(req.body.packagingUnitCost) || 0,
      );
      const laborCost = Number(
        (laborUnitCost * Number(order.production_quantity)).toFixed(2),
      );
      const packagingCost = Number(
        (packagingUnitCost * Number(order.production_quantity)).toFixed(2),
      );
      const cuttingCost = Math.max(0, Number(req.body.cuttingCost) || 0);
      const deliveryCost = Math.max(0, Number(req.body.deliveryCost) || 0);
      const otherCost = Math.max(0, Number(req.body.otherCost) || 0);
      const totalCost = Number(
        (
          materialCost +
          lossCost +
          laborCost +
          packagingCost +
          cuttingCost +
          deliveryCost +
          otherCost
        ).toFixed(2),
      );
      db.prepare(
        `UPDATE delivery_order SET material_cost=?,loss_rate=?,loss_cost=?,labor_unit_cost=?,labor_cost=?,labor_source=?,labor_process_snapshot_json=?,packaging_unit_cost=?,packaging_cost=?,cutting_cost=?,delivery_cost=?,other_cost=?,total_cost=?,updated_at=? WHERE id=?`,
      ).run(
        materialCost,
        lossRate,
        lossCost,
        laborUnitCost,
        laborCost,
        useProcessLaborCost ? "process_archive" : "manual",
        useProcessLaborCost
          ? JSON.stringify(processLabor.items)
          : order.labor_process_snapshot_json,
        packagingUnitCost,
        packagingCost,
        cuttingCost,
        deliveryCost,
        otherCost,
        totalCost,
        now(),
        order.id,
      );
      db.exec("COMMIT");
      res.json(deliveryOrderDetail(order.id));
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }),
);
app.post(
  "/api/purchase-orders",
  safe((req, res) => {
    const productId = Number(req.body.productId);
    const quantity = Number(req.body.productionQuantity);
    const items = calculateBomRequirements(db, productId, quantity);
    const orderNo = `PO-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${String(Date.now()).slice(-5)}`;
    db.exec("BEGIN IMMEDIATE");
    try {
      const order = db
        .prepare(
          "INSERT INTO purchase_order(order_no,product_id,production_quantity) VALUES(?,?,?)",
        )
        .run(orderNo, productId, quantity);
      const addItem = db.prepare(
        "INSERT INTO purchase_order_item(purchase_order_id,material_id,required_quantity,unit_id,calculation_detail) VALUES(?,?,?,?,?)",
      );
      items.forEach((item) =>
        addItem.run(
          order.lastInsertRowid,
          item.materialId,
          item.requiredQuantity,
          getUnitId(item.unit),
          item.detail,
        ),
      );
      db.exec("COMMIT");
      res.status(201).json({ id: order.lastInsertRowid, orderNo, items });
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }),
);

function mobileProductDetail(id) {
  const product = one(
    `SELECT id,public_code,code,sku,name,category,status,brand,warehouse_location FROM product WHERE id=?`,
    id,
  );
  if (!product) return null;
  return {
    ...product,
    colors: list(
      "SELECT c.name FROM product_color pc JOIN color c ON c.id=pc.color_id WHERE pc.product_id=? ORDER BY c.name",
      id,
    ).map((item) => item.name),
    images: list(
      "SELECT type,url,COALESCE(thumbnail_url,url) thumbnail_url FROM product_image WHERE product_id=? ORDER BY sort_order,id",
      id,
    ),
    parts: list(
      `SELECT cp.code,cp.name,cp.image_url,cp.max_length_cm,cp.max_width_cm,cp.quantity_per_product,m.name material_name,mo.public_code mold_public_code,mo.code mold_code,COALESCE(mo.image_url,'') mold_image_url
      FROM cutting_part cp LEFT JOIN material m ON m.id=cp.material_id LEFT JOIN mold mo ON mo.id=cp.mold_id WHERE cp.product_id=? ORDER BY cp.sort_order,cp.id`,
      id,
    ),
    accessories: list(
      "SELECT name,material,specification,color,quantity,unit FROM product_accessory WHERE product_id=? ORDER BY sort_order,id",
      id,
    ),
    cuttingPlans: list(
      `SELECT cp.public_code,cp.name,cp.image_url,cp.pieces_per_lay,cp.cutting_length_cm,COALESCE(cp.cutting_method,cp.cutting_mode) cutting_mode,m.name material_name
      FROM cutting_plan cp LEFT JOIN material m ON m.id=cp.material_id WHERE cp.product_id=? ORDER BY cp.sort_order,cp.id`,
      id,
    ),
  };
}

function mobileDeliveryOrder(id) {
  const order = one(
    "SELECT id,public_code,order_no,product_id,product_sku,product_name,production_quantity,status,created_at FROM delivery_order WHERE id=?",
    id,
  );
  if (!order) return null;
  return {
    ...order,
    colors: list(
      "SELECT product_color,quantity FROM delivery_order_color WHERE delivery_order_id=? ORDER BY id",
      id,
    ),
    items: list(
      `SELECT library_type,material_code,material_name,material_category,material_specification,material_image_url,material_color,unit,required_quantity,total_pieces,total_length_m,roll_count,cutting_mode
      FROM delivery_order_item WHERE delivery_order_id=? ORDER BY sort_order,id`,
      id,
    ),
  };
}

app.get(
  "/api/v1/mobile/search",
  safe((req, res) => {
    const keyword = `%${normalizeText(req.query.q || req.query.keyword)}%`;
    const items = [
      ...list(
        `SELECT id,public_code,sku code,name,'product' type,(SELECT COALESCE(thumbnail_url,url) FROM product_image WHERE product_id=product.id ORDER BY sort_order,id LIMIT 1) thumbnail FROM product WHERE sku LIKE ? OR code LIKE ? OR name LIKE ? LIMIT 20`,
        keyword,
        keyword,
        keyword,
      ),
      ...list(
        `SELECT id,public_code,code,name,'material' type,COALESCE(image_thumbnail_url,image_url) thumbnail FROM material WHERE COALESCE(is_active,1)=1 AND (code LIKE ? OR name LIKE ? OR specification LIKE ?) LIMIT 20`,
        keyword,
        keyword,
        keyword,
      ),
      ...list(
        `SELECT id,public_code,code,name,'mold' type,image_url thumbnail FROM mold WHERE code LIKE ? OR name LIKE ? LIMIT 20`,
        keyword,
        keyword,
      ),
      ...list(
        `SELECT id,public_code,CAST(id AS TEXT) code,name,'cutting-plan' type,image_url thumbnail FROM cutting_plan WHERE name LIKE ? LIMIT 20`,
        keyword,
      ),
      ...list(
        `SELECT id,public_code,order_no code,product_name name,'delivery-order' type,NULL thumbnail FROM delivery_order WHERE order_no LIKE ? OR product_sku LIKE ? OR product_name LIKE ? LIMIT 20`,
        keyword,
        keyword,
        keyword,
      ),
    ];
    res.json(items.slice(0, 50));
  }),
);
app.get(
  "/api/v1/mobile/products/:id",
  safe((req, res) => {
    const detail = mobileProductDetail(req.params.id);
    if (!detail) return res.status(404).json({ message: "未找到产品" });
    res.json(detail);
  }),
);
app.get(
  "/api/v1/mobile/delivery-orders/:id",
  safe((req, res) => {
    const detail = mobileDeliveryOrder(req.params.id);
    if (!detail) return res.status(404).json({ message: "未找到配货清单" });
    res.json(detail);
  }),
);
app.get(
  "/api/v1/mobile/lookup/:code",
  safe((req, res) => {
    const code = decodeURIComponent(req.params.code);
    const prefix = code.slice(0, 2);
    if (prefix === "P:") {
      const row = one("SELECT id FROM product WHERE public_code=?", code);
      if (row)
        return res.json({
          type: "product",
          detail: mobileProductDetail(row.id),
        });
    }
    if (prefix === "M:") {
      const row = one(
        `SELECT m.id,m.public_code,m.code,m.name,m.specification,m.width_cm,m.usable_width_cm,m.supplier,m.image_url,m.image_thumbnail_url,c.name category,u.symbol unit FROM material m LEFT JOIN material_category c ON c.id=m.category_id LEFT JOIN unit u ON u.id=m.unit_id WHERE m.public_code=?`,
        code,
      );
      if (row) return res.json({ type: "material", detail: row });
    }
    if (prefix === "D:") {
      const row = one(
        "SELECT id,public_code,code,name,image_url,storage_location FROM mold WHERE public_code=?",
        code,
      );
      if (row) return res.json({ type: "mold", detail: row });
    }
    if (prefix === "C:") {
      const row = one(
        `SELECT cp.id,cp.public_code,cp.name,cp.image_url,cp.pieces_per_lay,cp.cutting_length_cm,COALESCE(cp.cutting_method,cp.cutting_mode) cutting_mode,p.sku product_sku,m.name material_name FROM cutting_plan cp JOIN product p ON p.id=cp.product_id LEFT JOIN material m ON m.id=cp.material_id WHERE cp.public_code=?`,
        code,
      );
      if (row) return res.json({ type: "cutting-plan", detail: row });
    }
    if (prefix === "O:") {
      const row = one(
        "SELECT id FROM delivery_order WHERE public_code=?",
        code,
      );
      if (row)
        return res.json({
          type: "delivery-order",
          detail: mobileDeliveryOrder(row.id),
        });
    }
    res.status(404).json({ message: "二维码无效或资料不存在" });
  }),
);
app.get(
  "/api/v1/mobile/qrcode/:code",
  asyncSafe(async (req, res) => {
    const code = decodeURIComponent(req.params.code);
    const exists = [
      "product",
      "material",
      "mold",
      "cutting_plan",
      "delivery_order",
    ].some((table) =>
      one(`SELECT 1 value FROM ${table} WHERE public_code=?`, code),
    );
    if (!exists) return res.status(404).json({ message: "资料二维码不存在" });
    const value = `${process.env.MINIPROGRAM_QR_PREFIX || "bpms://lookup/"}${encodeURIComponent(code)}`;
    res.json({
      code,
      value,
      dataUrl: await QRCode.toDataURL(value, {
        width: 480,
        margin: 2,
        errorCorrectionLevel: "M",
      }),
    });
  }),
);

app.get("/api/miniprogram/products", (req, res) =>
  res.json(
    productListQuery(req.query.keyword || "").map(
      ({ id, code, sku, name, category, colors_text, status }) => ({
        id,
        code,
        sku,
        name,
        category,
        colors: colors_text,
        status,
      }),
    ),
  ),
);
app.get(
  "/api/miniprogram/products/:id",
  safe((req, res) => {
    const product = one("SELECT * FROM product WHERE id=?", req.params.id);
    if (!product) throw new Error("未找到产品");
    res.json({
      product,
      colors: list(
        "SELECT c.name FROM product_color pc JOIN color c ON c.id=pc.color_id WHERE pc.product_id=?",
        product.id,
      ),
      images: list(
        "SELECT type,url FROM product_image WHERE product_id=? ORDER BY sort_order",
        product.id,
      ),
      accessories: list(
        "SELECT name,material,specification,color,quantity,unit,notes FROM product_accessory WHERE product_id=? ORDER BY sort_order",
        product.id,
      ),
      cuttingParts: list(
        "SELECT code,name,color,image_url,max_length_cm,max_width_cm,quantity_per_product,type,notes FROM cutting_part WHERE product_id=? ORDER BY sort_order,id",
        product.id,
      ),
      molds: list(
        "SELECT code,name,image_url,cad_file_url,pdf_file_url,storage_location FROM mold WHERE product_id=?",
        product.id,
      ),
    });
  }),
);
app.get(
  "/api/miniprogram/delivery-orders",
  safe((req, res) => {
    const keyword = `%${normalizeText(req.query.keyword)}%`;
    res.json(
      list(
        `SELECT id,order_no,product_sku,product_name,production_quantity,status,total_cost,created_at
    FROM delivery_order WHERE order_no LIKE ? OR product_sku LIKE ? OR product_name LIKE ? ORDER BY created_at DESC,id DESC`,
        keyword,
        keyword,
        keyword,
      ),
    );
  }),
);
app.get(
  "/api/miniprogram/delivery-orders/:id",
  safe((req, res) => {
    const detail = deliveryOrderDetail(req.params.id);
    if (!detail) throw new Error("未找到配货清单");
    res.json(detail);
  }),
);
app.get(
  "/api/miniprogram/purchase-orders/:id",
  safe((req, res) => {
    const order = one(
      "SELECT po.*,p.sku,p.name product_name FROM purchase_order po JOIN product p ON p.id=po.product_id WHERE po.id=?",
      req.params.id,
    );
    if (!order) throw new Error("未找到配货单");
    res.json({
      order,
      items: list(
        "SELECT poi.required_quantity,u.symbol unit,m.code,m.name FROM purchase_order_item poi JOIN material m ON m.id=poi.material_id JOIN unit u ON u.id=poi.unit_id WHERE poi.purchase_order_id=?",
        order.id,
      ),
    });
  }),
);

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const message =
    error?.type === "entity.too.large"
      ? "图片文件过大，请选择不超过 30MB 的图片"
      : error?.message || "操作失败";
  res.status(error?.status || 500).json({ message });
});

app.listen(port, () =>
  console.log(`BPMS API 已启动：http://localhost:${port}`),
);
