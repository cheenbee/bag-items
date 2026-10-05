import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(directory, '..', 'scripts', 'rectpack_worker.py');

function runPackingGroups(groups) {
  const input = { algorithms: ['maxrects-bssf', 'maxrects-baf', 'skyline'], groups };
  const candidates = process.env.PYTHON
    ? [[process.env.PYTHON, []]]
    : process.platform === 'win32' ? [['py', ['-3.11']], ['python', []]] : [['python3', []], ['python', []]];
  let processResult;
  for (const [command, prefix] of candidates) {
    processResult = spawnSync(command, [...prefix, workerPath], { input: JSON.stringify(input), encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
    if (!processResult.error) break;
  }
  if (!processResult || processResult.error) throw new Error('未找到可用的 Python 3 排料运行环境');
  let output;
  try { output = JSON.parse(processResult.stdout || '{}'); } catch { throw new Error(processResult.stderr || '排料引擎返回了无效结果'); }
  if (processResult.status !== 0 || output.error) throw new Error(output.error || processResult.stderr || '排料计算失败');
  return output.groups;
}

export function calculateDraftPacking(draft) {
  const productionQuantity = Math.max(1, Math.floor(Number(draft.productionQuantity ?? draft.quantity) || 1));
  const layoutQuantity = Math.max(1, Math.floor(Number(draft.layoutQuantity) || 10));
  const gap = Math.max(0, Number(draft.gapCm) || 0);
  const materials = Array.isArray(draft.materials) ? draft.materials : [];
  if (!materials.length) throw new Error('至少需要一种布料');
  const groups = materials.map((material, materialIndex) => {
    const width = Number(material.usableWidthCm || material.widthCm);
    if (!(width > 0)) throw new Error(`${material.name || `布料${materialIndex + 1}`}缺少有效幅宽`);
    const parts = Array.isArray(material.pieces) ? material.pieces : [];
    if (!parts.length) throw new Error(`${material.name || `布料${materialIndex + 1}`}还没有裁片`);
    return {
      materialId: material.id || `draft-${materialIndex + 1}`,
      materialName: String(material.name || `布料${materialIndex + 1}`).trim(),
      materialColor: String(material.color || '').trim(),
      fabricWidthCm: Number(material.widthCm) || width,
      usableWidthCm: width,
      unitPrice: Math.max(0, Number(material.unitPrice) || 0),
      priceUnit: material.priceUnit || '元/米', gapCm: gap,
      pieces: parts.map((piece, partIndex) => {
        const lengthCm = Number(piece.lengthCm); const widthCm = Number(piece.widthCm);
        const perSet = Math.max(1, Math.floor(Number(piece.quantityPerSet) || 1));
        if (!(lengthCm > 0) || !(widthCm > 0)) throw new Error(`裁片“${piece.name || partIndex + 1}”缺少有效长宽`);
        return { id: piece.id || `${materialIndex + 1}-${partIndex + 1}`, name: String(piece.name || `裁片${partIndex + 1}`).trim(), lengthCm, widthCm,
          quantity: perSet * layoutQuantity, rotationMode: piece.rotatable === false || piece.rotationMode === 'fixed' ? 'fixed' : 'free' };
      }),
    };
  });
  const packed = runPackingGroups(groups).map((group) => { const layoutUsedLengthM=Number((group.usedLengthCm/100).toFixed(3));const unitUsedLengthM=Number((layoutUsedLengthM/layoutQuantity).toFixed(4));const productionUsedLengthM=Number((unitUsedLengthM*productionQuantity).toFixed(3));return {...group,layoutUsedLengthM,unitUsedLengthM,productionUsedLengthM,usedLengthM:productionUsedLengthM,layoutMaterialCost:Number((layoutUsedLengthM*group.unitPrice).toFixed(2)),unitMaterialCost:Number((unitUsedLengthM*group.unitPrice).toFixed(2)),materialCost:Number((productionUsedLengthM*group.unitPrice).toFixed(2))}; });
  const accessories = (Array.isArray(draft.accessories) ? draft.accessories : []).map((item, index) => {
    const perSet = Math.max(0, Number(item.quantityPerSet) || 0); const unitPrice = Math.max(0, Number(item.unitPrice) || 0);
    return { id: item.id || `accessory-${index + 1}`, name: String(item.name || `配件${index + 1}`).trim(), specification: String(item.specification || ''),
      unit: item.unit || '个', quantityPerSet: perSet, quantity: Number((perSet * productionQuantity).toFixed(3)), unitPrice, cost: Number((perSet * productionQuantity * unitPrice).toFixed(2)) };
  });
  const fabricCost = Number(packed.reduce((sum, item) => sum + item.materialCost, 0).toFixed(2));
  const accessoryCost = Number(accessories.reduce((sum, item) => sum + item.cost, 0).toFixed(2));
  const lossRate = Math.max(0, Number(draft.lossRate) || 0); const processes=Array.isArray(draft.processes)?draft.processes:[];const processingUnit=processes.length?Number(processes.reduce((sum,item)=>sum+Math.max(0,Number(item.quantityPerSet)||0)*Math.max(0,Number(item.unitPrice)||0),0).toFixed(2)):Math.max(0,Number(draft.processingUnit)||0);
  const packagingUnit = Math.max(0, Number(draft.packagingUnit) || 0); const logisticsUnit=Math.max(0,Number(draft.logisticsUnit)||0);const cuttingUnit=Math.max(0,Number(draft.cuttingUnit)||0);const profitUnit=Math.max(0,Number(draft.profitUnit)||0);const otherCost = Math.max(0, Number(draft.otherCost) || 0);
  const lossCost = Number(((fabricCost + accessoryCost) * lossRate / 100).toFixed(2));
  const totalCost = Number((fabricCost + accessoryCost + lossCost + (processingUnit + packagingUnit + logisticsUnit + cuttingUnit) * productionQuantity + otherCost).toFixed(2));
  const totalQuote=Number((totalCost+profitUnit*productionQuantity).toFixed(2));
  return { product: { quoteCode: draft.quoteCode, name: draft.productName || draft.quoteCode || '未命名新款' }, productionQuantity,layoutQuantity, gapCm: gap, materials: packed, accessories,processes,
    fabricCost, accessoryCost, lossRate, lossCost, processingUnit, packagingUnit,logisticsUnit,cuttingUnit,profitUnit, otherCost, totalMaterialCost: Number((fabricCost + accessoryCost).toFixed(2)), totalCost, unitCost: Number((totalCost / productionQuantity).toFixed(2)),unitQuote:Number((totalQuote/productionQuantity).toFixed(2)),totalQuote };
}

export function calculatePacking(db, productId, productionQuantity, gapCm = 1) {
  const product = db.prepare('SELECT * FROM product WHERE id=?').get(productId);
  if (!product) throw new Error('产品不存在');
  const quantity = Math.max(1, Math.floor(Number(productionQuantity) || 1));
  const gap = Math.max(0, Number(gapCm) || 0);
  const rows = db.prepare(`SELECT cp.*,m.name material_name,m.width_cm,m.usable_width_cm,m.edge_margin_cm,
      m.default_gap_cm,m.unit_price,m.price_unit,m.color material_color,
      COALESCE((SELECT dr.category FROM delivery_rule dr WHERE dr.product_id=cp.product_id AND dr.material_id=cp.material_id AND dr.library_type='布料库' ORDER BY dr.id LIMIT 1),c.name) material_category
    FROM cutting_part cp JOIN material m ON m.id=cp.material_id LEFT JOIN material_category c ON c.id=m.category_id
    WHERE cp.product_id=? ORDER BY m.id,cp.id`).all(productId);
  if (!rows.length) throw new Error('该产品没有可用于排料的裁片档案');
  const grouped = new Map();
  for (const row of rows) {
    const usableWidth = Number(row.usable_width_cm) || (Number(row.width_cm) - Number(row.edge_margin_cm || 0) * 2);
    if (!(usableWidth > 0)) throw new Error(`${row.material_name} 未填写有效幅宽`);
    const key = `${row.material_id}|${row.material_color || ''}`;
    if (!grouped.has(key)) grouped.set(key, { materialId: row.material_id, materialName: row.material_name, materialCategory: row.material_category || '面布',
      materialColor: row.material_color || '', fabricWidthCm: Number(row.width_cm) || usableWidth, usableWidthCm: usableWidth,
      unitPrice: Number(row.unit_price) || 0, priceUnit: row.price_unit || '元/米', gapCm: gap, pieces: [] });
    grouped.get(key).pieces.push({ id: row.id, name: row.name, widthCm: Number(row.max_width_cm),
      lengthCm: Number(row.max_length_cm), quantity: Number(row.quantity_per_product) * quantity,
      rotationMode: row.rotation_mode || 'free' });
  }
  for (const group of grouped.values()) {
    const invalid = group.pieces.find((piece) => !(piece.widthCm > 0) || !(piece.lengthCm > 0));
    if (invalid) throw new Error(`裁片“${invalid.name}”缺少有效长宽`);
  }
  const input = { algorithms: ['maxrects-bssf', 'maxrects-baf', 'skyline'], groups: [...grouped.values()] };
  const candidates = process.env.PYTHON
    ? [[process.env.PYTHON, []]]
    : process.platform === 'win32' ? [['py', ['-3.11']], ['python', []]] : [['python3', []], ['python', []]];
  let processResult;
  for (const [command, prefix] of candidates) {
    processResult = spawnSync(command, [...prefix, workerPath], { input: JSON.stringify(input), encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
    if (!processResult.error) break;
  }
  if (!processResult || processResult.error) throw new Error('未找到可用的 Python 3 排料运行环境');
  const child = processResult;
  let output;
  try { output = JSON.parse(child.stdout || '{}'); } catch { throw new Error(child.stderr || '排料引擎返回了无效结果'); }
  if (child.status !== 0 || output.error) throw new Error(output.error || child.stderr || '排料计算失败');
  const materials = output.groups.map((group) => ({ ...group,
    usedLengthM: Number((group.usedLengthCm / 100).toFixed(3)),
    materialCost: Number((group.usedLengthCm / 100 * group.unitPrice).toFixed(2)) }));
  const accessories = db.prepare(`SELECT pa.*,m.unit_price,m.price_unit,m.name material_name,u.symbol unit
    FROM product_accessory pa LEFT JOIN material m ON m.id=pa.material_id LEFT JOIN unit u ON u.id=m.unit_id
    WHERE pa.product_id=? ORDER BY pa.sort_order,pa.id`).all(productId).map((item) => ({
      id: item.id, name: item.material_name || item.name, specification: item.specification || '', unit: item.unit || item.unit,
      quantity: Number((Number(item.quantity || 0) * quantity).toFixed(3)), unitPrice: Number(item.unit_price) || 0,
      priceUnit: item.price_unit || '', cost: Number((Number(item.quantity || 0) * quantity * Number(item.unit_price || 0)).toFixed(2)) }));
  const fabricCost = Number(materials.reduce((sum, item) => sum + item.materialCost, 0).toFixed(2));
  const accessoryCost = Number(accessories.reduce((sum, item) => sum + item.cost, 0).toFixed(2));
  return { product: { id: product.id, sku: product.sku, name: product.name }, productionQuantity: quantity, gapCm: gap,
    materials, accessories, fabricCost, accessoryCost, totalMaterialCost: Number((fabricCost + accessoryCost).toFixed(2)) };
}
