const baseUrl = process.env.BPMS_API_URL || 'http://127.0.0.1:3001/api';
const created = { materials: [], rules: [], parts: [], accessories: [], molds: [], plans: [], orders: [], product: null };
const checks = [];

async function request(path, method = 'GET', body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${data?.message || text}`);
  return data;
}

function check(name, condition) {
  if (!condition) throw new Error(`检查失败：${name}`);
  checks.push(name);
}

async function cleanup() {
  for (const id of created.orders.reverse()) await request(`/delivery-orders/${id}`, 'DELETE').catch(() => {});
  const routes = [
    ['plans', '/cutting-plans/'],
    ['rules', '/delivery-rules/'],
    ['parts', '/cutting-parts/'],
    ['accessories', '/product-accessories/'],
    ['molds', '/molds/'],
  ];
  for (const [key, route] of routes) {
    for (const id of created[key].reverse()) await request(`${route}${id}`, 'DELETE').catch(() => {});
  }
  if (created.product) await request(`/products/${created.product}`, 'DELETE').catch(() => {});
  for (const id of created.materials.reverse()) await request(`/materials/${id}`, 'DELETE').catch(() => {});
}

try {
  const stamp = Date.now();
  const fabric = await request('/materials', 'POST', { name: `QA_FABRIC_${stamp}`, category_id: 28, specification: '150cm', unit_id: 1, width_cm: 145, unit_price: 8.5, supplier: 'QA' });
  const length = await request('/materials', 'POST', { name: `QA_LENGTH_${stamp}`, category_id: 10, specification: '38mm', unit_id: 4, roll_length_cm: 5000, unit_price: 1.2, supplier: 'QA' });
  const hardware = await request('/materials', 'POST', { name: `QA_HARDWARE_${stamp}`, category_id: 11, specification: '20mm', unit_id: 3, weight_gsm: 12, unit_price: 0.8, supplier: 'QA' });
  created.materials.push(fabric.id, length.id, hardware.id);
  check('三类材料新增', created.materials.every(Boolean));

  const editedMaterial = await request(`/materials/${fabric.id}`, 'PUT', { name: `QA_FABRIC_EDIT_${stamp}`, category_id: 28, specification: '152cm', unit_id: 1, width_cm: 147, unit_price: 9, supplier: 'QA2' });
  check('材料编辑', editedMaterial.name.includes('EDIT') && editedMaterial.width_cm === 147);
  const confirmedPrices = await request(`/materials/${fabric.id}/prices/confirm`, 'POST');
  check('材料价格历史与人工确认', confirmedPrices[0]?.notes === '人工确认价格' && confirmedPrices[0]?.price === 9);

  const product = await request('/products', 'POST', { sku: `QA${String(stamp).slice(-7)}`, name: 'QA Product', category: 'QA Category', colors: ['Black', 'Olive'], brand: 'QA', status: '销售中' });
  created.product = product.id;
  check('产品新增', product.id);
  const searchResult = await request(`/products?keyword=${encodeURIComponent(product.sku)}`);
  check('产品搜索', searchResult.some((item) => item.id === product.id));
  const editedProduct = await request(`/products/${product.id}`, 'PUT', { sku: product.sku, name: 'QA Product Edited', category: 'QA Category', colors: ['Coffee'], brand: 'QA2', status: '销售中', warehouse_location: 'A1', strap_info: 'strap', process_notes: 'process', notes: 'notes' });
  check('产品编辑', editedProduct.name === 'QA Product Edited');

  const part = await request(`/products/${product.id}/parts`, 'POST', { material_id: fabric.id, name: 'Front', max_length_cm: 30, max_width_cm: 20, quantity_per_product: 2, type: 'main' });
  created.parts.push(part.id);
  const rulesAfterPart = await request(`/products/${product.id}/delivery-rules`);
  check('裁片不生成布料配货档案', !rulesAfterPart.some((item) => item.library_type === '布料库'));
  const mold = await request('/molds', 'POST', { product_id: product.id, cutting_part_id: part.id, storage_location: 'QA' });
  created.molds.push(mold.id);
  check('刀模自动编号名称', mold.code === `DM-${part.code}` && mold.name === `${product.sku} Front` && mold.cutting_part_id === part.id);
  const editedMold = await request(`/molds/${mold.id}`, 'PUT', { product_id: product.id, cutting_part_id: part.id, storage_location: 'QB' });
  check('刀模编辑', editedMold.storage_location === 'QB' && editedMold.cutting_part_id === part.id);

  const editedPart = await request(`/cutting-parts/${part.id}`, 'PUT', { material_id: fabric.id, mold_id: mold.id, name: 'Front Edited', max_length_cm: 31, max_width_cm: 21, quantity_per_product: 3, type: 'main' });
  check('裁片编辑', editedPart.name.includes('Edited') && editedPart.quantity_per_product === 3);
  const linkedPart = (await request(`/products/${product.id}/parts`)).find((item) => item.id === part.id);
  check('裁片自动关联刀模', linkedPart.mold_id === mold.id && linkedPart.mold_code === mold.code);

  const accessory = await request(`/products/${product.id}/accessories`, 'POST', { material_id: hardware.id, color: 'Bronze', quantity: 2 });
  created.accessories.push(accessory.id);
  const editedAccessory = await request(`/product-accessories/${accessory.id}`, 'PUT', { material_id: hardware.id, color: 'Silver', quantity: 3 });
  check('配件编辑', editedAccessory.color === 'Silver' && editedAccessory.quantity === 3);
  const autoAccessoryRule = (await request(`/products/${product.id}/delivery-rules`)).find((item) => item.product_accessory_id === accessory.id);
  check('配件自动同步配货档案', autoAccessoryRule?.source_type === 'product_accessory' && autoAccessoryRule.quantity_per_product === 3 && autoAccessoryRule.color === 'Silver');

  const ruleBodies = [
    { material_id: fabric.id, category: '面料', quantity_per_product: 10, cutting_length_cm: 200, cutting_mode: '待确认' },
    { material_id: fabric.id, category: '里布', color: 'White', quantity_per_product: 12, cutting_length_cm: 180, cutting_mode: '刀模裁剪' },
    { material_id: length.id, category: '配件', color_strategy: 'mapped', color_mappings: [{ product_color: 'Coffee', material_color: 'White' }], quantity_per_product: 2, cutting_length_cm: 80, unit: '条' },
    { material_id: hardware.id, category: '配件', color: 'Gold', quantity_per_product: 4, unit: '个' },
  ];
  for (const body of ruleBodies) {
    const rule = await request(`/products/${product.id}/delivery-rules`, 'POST', body);
    created.rules.push(rule.id);
  }
  const mappedRule = (await request(`/products/${product.id}/delivery-rules`)).find((item) => item.id === created.rules[2]);
  check('配货规则特殊颜色对应', mappedRule.color_strategy === 'mapped' && mappedRule.color_mappings.some((item) => item.product_color === 'Coffee' && item.material_color === 'White'));
  const editedRule = await request(`/delivery-rules/${created.rules[0]}`, 'PUT', { material_id: fabric.id, category: '面料', quantity_per_product: 11, cutting_length_cm: 210, cutting_mode: '手工裁剪' });
  check('配货规则裁剪方式编辑', editedRule.cutting_mode === '手工裁剪' && editedRule.category === '面料');

  const plan = await request('/cutting-plans', 'POST', { product_id: product.id, delivery_rule_id: created.rules[0], cutting_mode: '刀模裁剪', mold_ids: [mold.id], name: 'QA Plan' });
  created.plans.push(plan.id);
  check('下料关联布料规则', plan.delivery_rule_id === created.rules[0] && plan.pieces_per_lay === 11 && plan.cutting_length_cm === 210 && plan.cutting_mode === '刀模裁剪' && plan.mold_ids.includes(mold.id));
  const editedPlan = await request(`/cutting-plans/${plan.id}`, 'PUT', { product_id: product.id, delivery_rule_id: created.rules[0], cutting_mode: '其他裁剪', mold_ids: [mold.id], name: 'QA Plan Edited' });
  check('下料方案编辑', editedPlan.name.includes('Edited') && editedPlan.cutting_mode === '其他裁剪' && editedPlan.mold_ids.length === 0);
  const partSummaries = await request(`/products/maintenance-summary?mode=parts&keyword=${encodeURIComponent(product.sku)}`);
  const accessorySummaries = await request(`/products/maintenance-summary?mode=accessories&keyword=${encodeURIComponent(product.sku)}`);
  const ruleSummaries = await request(`/products/maintenance-summary?mode=rules&keyword=${encodeURIComponent(product.sku)}`);
  check('裁片档案首页摘要', partSummaries[0]?.part_count === 1 && partSummaries[0]?.part_mold_count === 1);
  check('配件档案首页摘要', accessorySummaries[0]?.accessory_count === 1 && accessorySummaries[0]?.accessory_linked_count === 1);
  check('配货档案首页摘要', ruleSummaries[0]?.rule_count >= 4 && ruleSummaries[0]?.cutting_plan_count === 1);

  const smartBom = await request('/bom/smart-delivery', 'POST', { productId: product.id, colorPlans: [{ color: 'Coffee', quantity: 100 }], selectedFabricRuleIds: created.rules.slice(0, 2) });
  check('BOM智能配货', Array.isArray(smartBom.groups) && smartBom.groups.length === 3);
  check('BOM应用特殊颜色对应', smartBom.groups.flatMap((group) => group.items).some((item) => item.id === created.rules[2] && item.materialColor === 'White'));
  const fabricWithPlan = smartBom.groups.flatMap((group) => group.items).find((item) => item.cuttingPlans?.some((itemPlan) => itemPlan.id === plan.id));
  const deliveryOrder = await request('/delivery-orders', 'POST', { productId: product.id, colorPlans: [{ color: 'Coffee', quantity: 100 }], selectedFabricRuleIds: created.rules.slice(0, 2), selectedCuttingPlanIds: fabricWithPlan ? { [fabricWithPlan.groupKey]: plan.id } : {} });
  created.orders.push(deliveryOrder.id);
  check('配货清单历史保存', deliveryOrder.order_no.startsWith('PH-') && deliveryOrder.items.length > 0);
  check('配货清单保存选定下料方案', deliveryOrder.items.some((item) => item.cuttingPlans?.length === 1 && item.cuttingPlans[0].id === plan.id && item.cuttingPlans[0].selected));
  const miniProgramOrder = await request(`/miniprogram/delivery-orders/${deliveryOrder.id}`);
  check('小程序读取新配货清单', miniProgramOrder.id === deliveryOrder.id && miniProgramOrder.items.length === deliveryOrder.items.length);
  const costResult = await request(`/delivery-orders/${deliveryOrder.id}/cost`, 'PUT', { useCurrentPrices: true, lossRate: 3, laborUnitCost: 5, packagingUnitCost: 0.5, cuttingCost: 30, deliveryCost: 10, otherCost: 5, items: [] });
  check('配货成本核算', costResult.material_cost > 0 && costResult.labor_cost === 500 && costResult.packaging_cost === 50 && costResult.cutting_cost === 30 && costResult.delivery_cost === 10 && costResult.total_cost > costResult.material_cost);
  const historyRows = await request(`/delivery-orders?keyword=${encodeURIComponent(deliveryOrder.order_no)}`);
  check('配货历史搜索', historyRows.some((item) => item.id === deliveryOrder.id));
  await request(`/delivery-orders/${created.orders.pop()}`, 'DELETE');
  check('配货清单删除', true);

  const deleteRoutes = [['plans', '/cutting-plans/'], ['rules', '/delivery-rules/'], ['parts', '/cutting-parts/'], ['accessories', '/product-accessories/'], ['molds', '/molds/']];
  for (const [key, route] of deleteRoutes) {
    await request(`${route}${created[key].pop()}`, 'DELETE');
    check(`${key}删除`, true);
  }
  await request(`/products/${created.product}`, 'DELETE');
  const deletedProductId = created.product;
  created.product = null;
  const afterProductDelete = await request(`/products?keyword=${encodeURIComponent(product.sku)}`);
  check('产品删除', !afterProductDelete.some((item) => item.id === deletedProductId));
  for (const id of created.materials) await request(`/materials/${id}`, 'DELETE');
  const activeMaterials = await request('/materials');
  check('材料删除', created.materials.every((id) => !activeMaterials.some((item) => item.id === id)));
  created.materials = [];
  console.log(JSON.stringify({ success: true, checks }, null, 2));
} finally {
  await cleanup();
}
