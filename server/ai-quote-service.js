const createQuoteCode = () => `XK-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${Math.floor(100 + Math.random() * 900)}`;
const providerName = '硅基流动';
const apiKey = () => process.env.SILICONFLOW_API_KEY;
const apiBaseUrl = () => String(process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1').replace(/\/$/, '');
const modelName = () => process.env.SILICONFLOW_MODEL || 'Qwen/Qwen3.5-397B-A17B';

async function siliconFlowChat(body, timeout = 60000) {
  if (!apiKey()) { const error = new Error('硅基流动尚未配置，请在 .env 中设置 SILICONFLOW_API_KEY'); error.status = 503; throw error; }
  const response = await fetch(`${apiBaseUrl()}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify({ model: modelName(), ...body }), signal: AbortSignal.timeout(timeout),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(payload?.error?.message || `${providerName}请求失败（${response.status}）`); error.status = 502; throw error; }
  return payload;
}

const defaultDraft = () => ({
  quoteCode: createQuoteCode(), productName: '', productionQuantity: 10, layoutQuantity: 10, gapCm: 1, lossRate: 1,
  processingUnit: 0, packagingUnit: 0, logisticsUnit: 0, cuttingUnit: 0, profitUnit: 0, otherCost: 0,
  processes: [], materials: [], accessories: [], missingFields: [], conflicts: [], readyForPacking: false,
});

const systemPrompt = `你是箱包工厂的新产品核价资料员。用户描述的是全新产品，不要求匹配现有产品。
你的任务只做资料提取、单位标准化和缺项检查，严禁自行估计尺寸、幅宽、单价或数量。
每种布料必须独立，裁片放入所属布料的 pieces。尺寸统一为厘米，布料价格统一为元/米。
配件 quantityPerSet 表示单套用量，unitPrice 表示对应单位的单价。
rotatable 未说明时为 true；明确顺纹、顺毛、图案方向或不可旋转时为 false。
只有每种布料都有 widthCm、unitPrice 和至少一个完整裁片，且所有裁片都有 lengthCm、widthCm、quantityPerSet，才可 readyForPacking=true。
missingFields 使用给用户看的简短中文问题，最多优先列出 5 条。conflicts 记录矛盾数据。
必须优先读取“用户的新信息”并写入 draft，不能因为当前草稿为空就返回空数组。
只返回一个 JSON 对象，不要 Markdown，不要解释。结构必须是：
{"assistantMessage":"给用户的简短回复","draft":{"productName":"","productionQuantity":10,"layoutQuantity":10,"gapCm":1,"lossRate":1,"packagingUnit":0,"logisticsUnit":0,"cuttingUnit":0,"profitUnit":0,"otherCost":0,"processes":[{"id":"sp1","workProcessId":null,"name":"车缝","operationPart":"","quantityPerSet":1,"unitPrice":0}],"materials":[{"id":"m1","name":"","widthCm":null,"usableWidthCm":null,"unitPrice":null,"priceUnit":"元/米","pieces":[{"id":"p1","name":"","lengthCm":null,"widthCm":null,"quantityPerSet":1,"rotatable":true}]}],"accessories":[{"id":"a1","name":"","specification":"","quantityPerSet":null,"unit":"个","unitPrice":null}],"missingFields":[],"conflicts":[],"readyForPacking":false}}`;

const parseModelJson = content => {
  const text = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(text || '{}');
};

export async function classifyQuoteMessageWithDeepSeek(message, currentDraft = {}, history = [], hasResult = false) {
  const recentHistory = history.slice(-16).map(item => ({ role: item.role, content: String(item.content || '').slice(0, 2500) }));
  const payload = await siliconFlowChat({ temperature: 0, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: `你是箱包工厂核价流程的意图判断器。只返回JSON：{"intent":"chat|archive_question|archive_update|calculate","reason":"简短原因"}。
判断规则：
1. 用户提供或修改数量、布料、幅宽、裁片、尺寸、配件、单价、加工费等资料，属于 archive_update。
2. 用户要求“填入、保存、同步、更新右侧样品档案”，即使本句没有数字，也属于 archive_update，资料要从当前样品的用户历史中整理。
3. 用户明确要求核价、排料、计算、重新计算结果，属于 calculate。
4. 用户只是询问当前档案、已有成本或缺少什么，属于 archive_question，不修改档案。
5. 问候或与当前核价资料无关的普通交流属于 chat。
不要使用关键词机械判断，要理解口语、省略和上下文。` },
        { role: 'user', content: `当前消息：${String(message || '').slice(0, 8000)}\n已有计算结果：${hasResult ? '是' : '否'}\n当前草稿摘要：${JSON.stringify(currentDraft).slice(0, 10000)}\n最近对话：${JSON.stringify(recentHistory).slice(0, 18000)}` }] });
  let parsed;
  try { parsed = parseModelJson(payload?.choices?.[0]?.message?.content); } catch { throw new Error('AI无法判断当前消息意图，请重新描述'); }
  const allowed = new Set(['chat', 'archive_question', 'archive_update', 'calculate']);
  return { intent: allowed.has(parsed.intent) ? parsed.intent : 'archive_update', reason: String(parsed.reason || '') };
}

function cleanNumber(value, fallback = null) {
  if (value === '' || value == null) return fallback;
  const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function mergeExplicitFacts(message, currentDraft, aiDraft) {
  const text = String(message || '').replace(/厘米/g, 'cm').replace(/[×xX*]/g, '乘');
  const merged = { ...aiDraft }; const quantity = text.match(/(?:做货|生产|订做|做)?\s*(\d+)\s*(?:套|个包|只包|件)/); if (quantity) merged.productionQuantity = Number(quantity[1]);
  const layoutQuantity = text.match(/(?:排版|排料)(?:数量|套数)?[^\d]{0,5}(\d+)\s*套?/); if (layoutQuantity) merged.layoutQuantity = Number(layoutQuantity[1]);
  const sharedWidth = text.match(/(?:所有|全部)布料(?:的)?(?:幅宽|门幅)\s*(\d+(?:\.\d+)?)\s*(?:cm)?/);
  const processing = text.match(/(?:加工费|加工价)[^\d]{0,8}(?:每套)?\s*(\d+(?:\.\d+)?)/); if (processing) merged.processingUnit = Number(processing[1]);
  const packaging = text.match(/(?:包装费|包装价)[^\d]{0,8}(?:每套)?\s*(\d+(?:\.\d+)?)/); if (packaging) merged.packagingUnit = Number(packaging[1]);
  const logistics = text.match(/(?:物流费|运输费)[^\d]{0,8}(?:每套|单个)?\s*(\d+(?:\.\d+)?)/); if (logistics) merged.logisticsUnit = Number(logistics[1]);
  const cutting = text.match(/(?:裁剪费|裁床费)[^\d]{0,8}(?:每套|单个)?\s*(\d+(?:\.\d+)?)/); if (cutting) merged.cuttingUnit = Number(cutting[1]);
  const profit = text.match(/(?:利润)[^\d]{0,8}(?:每套|单个)?\s*(\d+(?:\.\d+)?)/); if (profit) merged.profitUnit = Number(profit[1]);
  const gap = text.match(/(?:间隙|排料间隙)[^\d]{0,5}(\d+(?:\.\d+)?)\s*(?:cm)?/); if (gap) merged.gapCm = Number(gap[1]);
  const loss = text.match(/(?:损耗率|损耗)[^\d]{0,5}(\d+(?:\.\d+)?)\s*%/); if (loss) merged.lossRate = Number(loss[1]);
  const materials = []; const accessories = []; let activeMaterial = null;
  for (const raw of text.split(/[。；;\n]+/).map((item) => item.trim()).filter(Boolean)) {
    if (/(?:所有|全部)布料(?:的)?(?:幅宽|门幅)/.test(raw)) continue;
    const materialMatch = raw.match(/^(.{1,30}?)(?:幅宽|门幅)\s*(\d+(?:\.\d+)?)\s*(?:cm)?(?:[^\d]{0,20}(?:每米|元\s*\/\s*米|单价)\s*(\d+(?:\.\d+)?))?/);
    if (materialMatch) {
      const name = materialMatch[1].replace(/^(?:做|共|需要)\s*\d+\s*套[，,]*/, '').trim() || `布料${materials.length + 1}`;
      activeMaterial = { id: `m-${Date.now()}-${materials.length}`, name, widthCm: Number(materialMatch[2]), unitPrice: materialMatch[3] == null ? null : Number(materialMatch[3]), priceUnit: '元/米', pieces: [] };
      materials.push(activeMaterial); continue;
    }
    if (/^(?:配件|五金)/.test(raw)) {
      const accessoryMatch = raw.match(/^(?:配件|五金)\s*(.{1,30}?)(?:每套)?\s*(\d+(?:\.\d+)?)\s*(个|只|条|米|对|套|件|根)[^\d]{0,15}(?:每(?:个|只|条|米|对|套|件|根)|单价)\s*(\d+(?:\.\d+)?)\s*元?/);
      if (accessoryMatch) accessories.push({ id: `a-${Date.now()}-${accessories.length}`, name: accessoryMatch[1].trim(), specification: '', quantityPerSet: Number(accessoryMatch[2]), unit: accessoryMatch[3], unitPrice: Number(accessoryMatch[4]) });
      continue;
    }
    const pieceMatch = raw.match(/^(.{1,30}?)\s*(\d+(?:\.\d+)?)\s*(?:cm)?\s*乘\s*(\d+(?:\.\d+)?)\s*(?:cm)?[^\d]{0,20}(?:每套)?\s*(\d+)\s*片/);
    if (pieceMatch && activeMaterial) activeMaterial.pieces.push({ id: `p-${Date.now()}-${activeMaterial.pieces.length}`, name: pieceMatch[1].trim(), lengthCm: Number(pieceMatch[2]), widthCm: Number(pieceMatch[3]), quantityPerSet: Number(pieceMatch[4]), rotatable: !/(?:不能|不可|禁止)旋转|顺纹|顺毛/.test(raw) });
  }
  if (materials.length && (!Array.isArray(merged.materials) || !merged.materials.length)) merged.materials = materials;
  else if (!Array.isArray(merged.materials) || !merged.materials.length) merged.materials = currentDraft?.materials || [];
  if (sharedWidth && Array.isArray(merged.materials)) merged.materials = merged.materials.map(material => ({ ...material, widthCm: Number(sharedWidth[1]) }));
  if (accessories.length) merged.accessories = accessories;
  else if (!Array.isArray(merged.accessories)) merged.accessories = currentDraft?.accessories || [];
  return merged;
}

export function normalizeQuoteDraft(input = {}) {
  const base = defaultDraft();
  const draft = { ...base, ...input };
  draft.quoteCode = String(draft.quoteCode || base.quoteCode).replace(/[^A-Za-z0-9-]/g, '').slice(0, 40) || base.quoteCode;
  draft.productName = draft.quoteCode;
  draft.productionQuantity = Math.max(1, Math.floor(cleanNumber(input.productionQuantity ?? input.quantity, 10)));
  draft.layoutQuantity = Math.max(1, Math.floor(cleanNumber(input.layoutQuantity, 10)));
  draft.gapCm = cleanNumber(draft.gapCm, 1); draft.lossRate = cleanNumber(draft.lossRate, 1);
  draft.packagingUnit = cleanNumber(draft.packagingUnit, 0); draft.logisticsUnit = cleanNumber(draft.logisticsUnit, 0); draft.cuttingUnit = cleanNumber(draft.cuttingUnit, 0); draft.profitUnit = cleanNumber(draft.profitUnit, 0); draft.otherCost = cleanNumber(draft.otherCost, 0);
  draft.processes = (Array.isArray(input.processes) ? input.processes : []).slice(0,100).map((item,index)=>({id:String(item.id||`sp${index+1}`),workProcessId:cleanNumber(item.workProcessId),name:String(item.name??'').slice(0,100),operationPart:String(item.operationPart||'').slice(0,100),quantityPerSet:cleanNumber(item.quantityPerSet,1),unitPrice:cleanNumber(item.unitPrice,0),notes:String(item.notes||'').slice(0,200)}));
  draft.processingUnit = draft.processes.length ? Number(draft.processes.reduce((sum,item)=>sum+item.quantityPerSet*item.unitPrice,0).toFixed(2)) : Math.max(0,cleanNumber(input.processingUnit,0));
  draft.materials = (Array.isArray(input.materials) ? input.materials : []).slice(0, 30).map((material, index) => ({
    id: String(material.id || `m${index + 1}`), name: String(material.name || `布料${index + 1}`).slice(0, 100),
    widthCm: cleanNumber(material.widthCm, 148), usableWidthCm: cleanNumber(material.usableWidthCm), color: String(material.color || '').slice(0, 50), unitPrice: cleanNumber(material.unitPrice), priceUnit: '元/米',
    pieces: (Array.isArray(material.pieces) ? material.pieces : []).slice(0, 200).map((piece, partIndex) => ({ id: String(piece.id || `m${index + 1}p${partIndex + 1}`),
      name: String(piece.name || `裁片${partIndex + 1}`).slice(0, 100), lengthCm: cleanNumber(piece.lengthCm), widthCm: cleanNumber(piece.widthCm),
      quantityPerSet: Math.max(1, Math.floor(cleanNumber(piece.quantityPerSet, 1))), rotatable: piece.rotatable !== false })),
  }));
  draft.accessories = (Array.isArray(input.accessories) ? input.accessories : []).slice(0, 100).map((item, index) => ({ id: String(item.id || `a${index + 1}`),
    name: String(item.name || `配件${index + 1}`).slice(0, 100), specification: String(item.specification || '').slice(0, 200),
    quantityPerSet: cleanNumber(item.quantityPerSet), unit: String(item.unit || '个').slice(0, 20), unitPrice: cleanNumber(item.unitPrice) }));
  draft.conflicts = (Array.isArray(input.conflicts) ? input.conflicts : []).map(String).slice(0, 20);
  return validateQuoteDraft(draft);
}

export function validateQuoteDraft(input) {
  const draft = { ...input }; const missing = [];
  if (!draft.materials.length) missing.push('请提供至少一种布料及其裁片');
  draft.materials.forEach((material) => {
    if (!(Number(material.widthCm || material.usableWidthCm) > 0)) missing.push(`请提供“${material.name}”的幅宽`);
    if (!(Number(material.unitPrice) >= 0) || material.unitPrice == null) missing.push(`请提供“${material.name}”的每米单价`);
    if (!material.pieces.length) missing.push(`请提供“${material.name}”对应的裁片尺寸`);
    material.pieces.forEach((piece) => { if (!(piece.lengthCm > 0) || !(piece.widthCm > 0)) missing.push(`请确认“${piece.name}”的长和宽`); if (!(piece.quantityPerSet > 0)) missing.push(`请确认“${piece.name}”每套片数`); });
  });
  draft.accessories.forEach((item) => { if (!(item.quantityPerSet > 0)) missing.push(`请确认配件“${item.name}”的单套用量`); if (!(item.unitPrice >= 0) || item.unitPrice == null) missing.push(`请提供配件“${item.name}”的单价`); });
  draft.missingFields = [...new Set(missing)].slice(0, 20);
  draft.readyForPacking = draft.missingFields.length === 0 && !(draft.conflicts || []).length;
  return draft;
}

export async function extractQuoteWithDeepSeek(message, currentDraft, history = [], images = []) {
  const userHistory = history
    .filter(item => item?.role === 'user' && item.content)
    .slice(-20)
    .map(item => String(item.content).slice(0, 5000))
    .join('\n\n--- 用户补充 ---\n');
  const instruction = `当前样品的用户历史资料：\n${userHistory.slice(0, 30000)}\n\n用户最新要求：${String(message || '').slice(0, 12000)}\n\n当前报价草稿：${JSON.stringify(currentDraft || {})}\n\n请理解随消息提供的图片及历史资料，重新整理并合并 draft。图片上明确标注的文字、尺寸、表格可提取；模糊数字必须列入 conflicts 或 missingFields；普通包袋外观照片不能推测裁片尺寸、幅宽、数量或单价。若当前草稿与用户明确资料冲突，以用户资料为准。禁止估算或猜测生产数据。`;
  const userContent = images.length ? [{ type: 'text', text: instruction }, ...images.slice(0, 8).map(image => ({ type: 'image_url', image_url: { url: image.dataUrl, detail: 'high' } }))] : instruction;
  const payload = await siliconFlowChat({ temperature: 0.1, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }] }, 120000);
  let parsed;
  try { parsed = parseModelJson(payload?.choices?.[0]?.message?.content); } catch { throw new Error('AI返回的数据无法解析，请重试'); }
  const current = normalizeQuoteDraft(currentDraft || {});
  const grounded = mergeExplicitFacts(`${userHistory}\n${message}`, currentDraft, parsed.draft || parsed);
  const draft = normalizeQuoteDraft({ ...grounded, quoteCode: current.quoteCode });
  return { assistantMessage: String(parsed.assistantMessage || (draft.readyForPacking ? '资料已完整，可以开始排料核价。' : `我还需要确认：${draft.missingFields.slice(0, 3).join('；')}`)), draft,
    model: payload.model || modelName() };
}

export async function chatAboutQuoteWithDeepSeek(message, context = {}, history = []) {
  const recentMessages = history
    .filter(item => item && (item.role === 'user' || item.role === 'assistant') && item.content)
    .slice(-20)
    .map(item => ({ role: item.role, content: String(item.content).slice(0, 4000) }));
  const messages = [
    { role: 'system', content: `你是箱包工厂的AI核价助手，也能正常回答用户的普通问题。你能看到当前样品最近的聊天记录，不要声称看不到已经提供的历史消息。请结合聊天记录直接回答当前问题，不要重复输出整份报价，除非用户明确要求查看报价、成本或重新核价。回答简洁自然。当前样品背景仅供参考：${JSON.stringify(context).slice(0, 8000)}` },
    ...(recentMessages.length ? recentMessages : [{ role: 'user', content: String(message || '').slice(0, 12000) }]),
  ];
  const payload = await siliconFlowChat({ temperature: 0.3, messages });
  return String(payload?.choices?.[0]?.message?.content || '').trim() || '我在，请继续告诉我需要处理的内容。';
}
