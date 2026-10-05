/** BOM 计算服务：所有采购数量均在此处集中计算，便于后续新增算法。 */
const roundedSum = (left, right) => Number((Number(left || 0) + Number(right || 0)).toFixed(3));
const normalizedKey = (value) => String(value || '').trim().toLocaleLowerCase('zh-CN');

/** 同一规则在多个订单颜色下解析为相同材料颜色和参数时，合并为一条配货结果。 */
function mergeSmartDeliveryItems(items) {
  const merged = new Map();
  for (const item of items) {
    const planSignature = item.library_type === '布料库'
      ? (item.cuttingPlans || []).map((plan) => `${plan.id}:${plan.cutting_mode}`).join(',')
      : '';
    const key = [
      item.id,
      item.library_type,
      item.material_id,
      normalizedKey(item.materialColor),
      normalizedKey(item.material_specification),
      normalizedKey(item.unit),
      Number(item.quantity_per_product) || 0,
      Number(item.cutting_length_cm) || 0,
      Number(item.roll_length_cm) || 0,
      item.isSelected ? 1 : 0,
      planSignature,
    ].join('|');
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...item, sourcePlanColors: [item.planColor], groupKey: key });
      continue;
    }
    if (!existing.sourcePlanColors.includes(item.planColor)) existing.sourcePlanColors.push(item.planColor);
    existing.planQuantity = roundedSum(existing.planQuantity, item.planQuantity);
    existing.layCount = item.library_type === '布料库' ? roundedSum(existing.layCount, item.layCount) : null;
    existing.totalPieces = item.library_type === '布料库' ? null : roundedSum(existing.totalPieces, item.totalPieces);
    existing.totalLengthM = item.library_type === '长度材料库' ? roundedSum(existing.totalLengthM, item.totalLengthM) : null;
    existing.requiredQuantity = roundedSum(existing.requiredQuantity, item.requiredQuantity);
    existing.estimatedCost = existing.estimatedCost == null && item.estimatedCost == null ? null : roundedSum(existing.estimatedCost, item.estimatedCost);
  }
  return [...merged.values()].map((item) => ({
    ...item,
    planColor: item.sourcePlanColors.join('、'),
    rollCount: item.library_type === '长度材料库' && Number(item.roll_length_cm) > 0
      ? Math.ceil(Number(item.totalLengthM) * 100 / Number(item.roll_length_cm))
      : item.rollCount,
    detail: item.sourcePlanColors.length > 1 ? `合并订单颜色：${item.sourcePlanColors.join('、')}` : item.detail,
  }));
}

export function calculateBomRequirements(db, productId, productionQuantity) {
  const items = db.prepare(`
    SELECT b.*, m.code AS material_code, m.name AS material_name, m.width_cm,
           u.name AS unit_name, u.symbol AS unit_symbol
    FROM bom_item b
    JOIN material m ON m.id = b.material_id
    JOIN unit u ON u.id = b.unit_id
    WHERE b.product_id = ?
    ORDER BY m.name
  `).all(productId);

  return items.map((item) => {
    let baseQuantity;
    let detail;
    if (item.calculation_method === '幅宽排料') {
      if (!item.width_cm || !item.strip_width_cm || !item.part_length_cm) {
        throw new Error(`${item.material_name} 缺少幅宽排料所需参数`);
      }
      const stripsPerRow = Math.floor(item.width_cm / item.strip_width_cm);
      if (stripsPerRow < 1) throw new Error(`${item.material_name} 的材料幅宽小于切条宽度`);
      const requiredStrips = productionQuantity * item.usage_per_product;
      const rows = Math.ceil(requiredStrips / stripsPerRow);
      baseQuantity = (rows * item.part_length_cm) / 100;
      detail = `幅宽 ${item.width_cm}cm ÷ 切条宽 ${item.strip_width_cm}cm = ${stripsPerRow} 条/排；${requiredStrips} 条 ÷ ${stripsPerRow} = ${rows} 排；${rows} 排 × ${item.part_length_cm}cm`;
    } else {
      baseQuantity = productionQuantity * item.usage_per_product;
      detail = `${productionQuantity} × 单件用量 ${item.usage_per_product}`;
    }
    const requiredQuantity = Number((baseQuantity * (1 + item.waste_rate)).toFixed(3));
    return {
      materialId: item.material_id,
      materialCode: item.material_code,
      materialName: item.material_name,
      unit: item.unit_symbol || item.unit_name,
      calculationMethod: item.calculation_method,
      baseQuantity: Number(baseQuantity.toFixed(3)),
      wasteRate: item.waste_rate,
      requiredQuantity,
      detail: `${detail}；损耗 ${(item.waste_rate * 100).toFixed(1)}%`,
    };
  });
}

/** 智能配货服务：按颜色生产计划汇总裁剪、材料与配件需求。 */
export function calculateSmartDelivery(db, productId, colorPlans, selectedFabricRuleIds = []) {
  const plans = (Array.isArray(colorPlans) ? colorPlans : []).map((plan) => ({
    color: String(plan.color || '').trim(),
    quantity: Number(plan.quantity),
  })).filter((plan) => plan.color && Number.isFinite(plan.quantity) && plan.quantity > 0);
  if (!plans.length) throw new Error('请至少填写一个颜色及其生产数量');
  const productColors = db.prepare('SELECT c.name FROM product_color pc JOIN color c ON c.id=pc.color_id WHERE pc.product_id=? ORDER BY pc.rowid').all(productId).map((item) => item.name);
  if (!productColors.length) throw new Error('产品档案尚未设置可用颜色');
  const invalidPlan = plans.find((plan) => !productColors.includes(plan.color));
  if (invalidPlan) throw new Error(`颜色“${invalidPlan.color}”不在产品档案可选颜色中`);
  const rules = db.prepare(`SELECT r.*,m.code material_code,m.name material_name,m.color default_color,COALESCE(m.image_thumbnail_url,m.image_url) material_image_url,
    m.specification material_specification,m.unit_price,m.price_unit,m.roll_price,m.roll_length_cm,u.symbol material_unit,
    c.name material_category,mo.code mold_code,COALESCE(mo.image_thumbnail_url,mo.image_url) mold_image_url
    FROM delivery_rule r JOIN material m ON m.id=r.material_id
    JOIN unit u ON u.id=m.unit_id LEFT JOIN material_category c ON c.id=m.category_id
    LEFT JOIN mold mo ON mo.id=r.mold_id
    WHERE r.product_id=? ORDER BY CASE r.library_type WHEN '布料库' THEN 1 WHEN '长度材料库' THEN 2 ELSE 3 END,r.sort_order,r.id`).all(productId);
  const planQuery = db.prepare(`SELECT id,name,image_url,COALESCE(image_thumbnail_url,image_url) image_thumbnail_url,pieces_per_lay,cutting_length_cm,
    COALESCE(NULLIF(cutting_method,''),CASE WHEN cutting_mode='刀模裁剪' THEN '刀模裁剪' ELSE '手工裁剪' END) cutting_mode
    FROM cutting_plan WHERE delivery_rule_id=? ORDER BY sort_order,id`);
  const planMoldQuery = db.prepare(`SELECT mo.id,mo.code,mo.name,mo.image_url,COALESCE(mo.image_thumbnail_url,mo.image_url) image_thumbnail_url
    FROM cutting_plan_mold link JOIN mold mo ON mo.id=link.mold_id
    WHERE link.cutting_plan_id=? ORDER BY mo.code`);
  const colorMapQuery = db.prepare('SELECT product_color,material_color FROM delivery_rule_color_map WHERE delivery_rule_id=? ORDER BY product_color');
  rules.forEach((rule) => {
    rule.cuttingPlans = rule.library_type === '布料库'
      ? planQuery.all(rule.id).map((plan) => ({ ...plan, molds: plan.cutting_mode === '刀模裁剪' ? planMoldQuery.all(plan.id) : [] }))
      : [];
    rule.colorMappings = colorMapQuery.all(rule.id);
  });
  if (!rules.length) throw new Error('该产品暂未导入配货规则');
  const result = [];
  const warnings = [];
  const selectedIds = new Set((Array.isArray(selectedFabricRuleIds) ? selectedFabricRuleIds : []).map(Number));
  const resolveColor = (rule, productColor) => {
    const mapped = rule.colorMappings.find((item) => item.product_color === productColor);
    if (mapped) return mapped.material_color;
    if (rule.color_strategy === 'fixed') return rule.color || '未设置固定颜色';
    return productColor;
  };
  const fabricRules = rules.filter((rule) => rule.library_type === '布料库');
  const defaultFabricIds = new Set(fabricRules.filter((rule) => Number(rule.quantity_per_product) === 10).map((rule) => rule.id));
  const activeFabricIds = selectedIds.size ? selectedIds : defaultFabricIds.size ? defaultFabricIds : new Set(fabricRules.slice(0, 1).map((rule) => rule.id));
  for (const plan of plans) {
    const matching = rules;
    if (!matching.length) warnings.push(`${plan.color} 未找到对应颜色规则，未计入需求。`);
    for (const rule of matching) {
      const perProduct = Number(rule.quantity_per_product) || 0;
      const totalPieces = rule.library_type === '布料库' ? null : plan.quantity * perProduct;
      const layCount = rule.library_type === '布料库' ? Math.ceil(plan.quantity / perProduct) : null;
      const totalLengthM = rule.library_type === '长度材料库' ? Number((totalPieces * Number(rule.cutting_length_cm) / 100).toFixed(3)) : null;
      const rollCount = rule.library_type === '长度材料库' && Number(rule.roll_length_cm) > 0 ? Math.ceil(totalLengthM * 100 / Number(rule.roll_length_cm)) : null;
      const requiredQuantity = rule.library_type === '布料库'
        ? Number((layCount * Number(rule.cutting_length_cm) / 100).toFixed(3))
        : rule.library_type === '长度材料库' ? totalLengthM : Number(totalPieces.toFixed(3));
      if (!Number.isFinite(requiredQuantity) || requiredQuantity <= 0) {
        warnings.push(`${plan.color} · ${rule.material_name} 缺少可用的配货参数。`);
        continue;
      }
      const detail = rule.library_type === '布料库'
        ? `${plan.quantity} 件 ÷ 单张 ${perProduct} 件，向上取整 ${layCount} 层 × ${rule.cutting_length_cm}cm`
        : rule.library_type === '长度材料库'
          ? `${plan.quantity} 件 × ${perProduct}${rule.unit || '根'} × ${rule.cutting_length_cm}cm`
          : `${plan.quantity} 件 × 单包 ${perProduct}${rule.unit || rule.material_unit || '个'}`;
      const effectiveUnitPrice = Number(rule.unit_price) || (Number(rule.roll_price) > 0 && Number(rule.roll_length_cm) > 0 ? Number(rule.roll_price) / (Number(rule.roll_length_cm) / 100) : null);
      const priceUnit = rule.price_unit || (rule.library_type === '五金配件库' ? `元/${rule.unit || rule.material_unit || '个'}` : '元/米');
      result.push({ ...rule, isSelected: rule.library_type !== '布料库' || activeFabricIds.has(rule.id), unit: rule.unit || rule.material_unit, planColor: plan.color, materialColor: resolveColor(rule, plan.color), planQuantity: plan.quantity, layCount, totalLengthM, totalPieces, rollCount, requiredQuantity, detail, effectiveUnitPrice, priceUnit, estimatedCost: effectiveUnitPrice ? Number((requiredQuantity * effectiveUnitPrice).toFixed(2)) : null });
    }
  }
  const mergedResult = mergeSmartDeliveryItems(result);
  const byMaterialName = (left, right) => String(left.material_name || '').localeCompare(String(right.material_name || ''), 'zh-CN', { numeric: true })
    || String(left.materialColor || '').localeCompare(String(right.materialColor || ''), 'zh-CN', { numeric: true })
    || String(left.material_specification || '').localeCompare(String(right.material_specification || ''), 'zh-CN', { numeric: true });
  const grouped = ['布料库', '长度材料库', '五金配件库'].map((libraryType) => ({
    category: libraryType,
    libraryType,
    items: mergedResult.filter((item) => item.library_type === libraryType).sort(byMaterialName),
  }));
  return { productionQuantity: plans.reduce((sum, plan) => sum + plan.quantity, 0), colorPlans: plans, fabricOptions: fabricRules.map((rule) => ({ id: rule.id, materialName: rule.material_name, color: rule.color, description: rule.description, quantityPerProduct: rule.quantity_per_product, cuttingLengthCm: rule.cutting_length_cm, cuttingMode: rule.cutting_mode, cuttingPlans: rule.cuttingPlans, selected: activeFabricIds.has(rule.id) })), groups: grouped, warnings };
}
