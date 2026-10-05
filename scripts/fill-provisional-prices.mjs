import { DatabaseSync } from 'node:sqlite';

const database = new DatabaseSync('server/bpms.db');
database.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;');

const fabricCategories = new Set(['面布', '里布', '夹层', '支撑板', '复合布', '其它', '布料']);
const lengthCategories = new Set(['长度材料', '织带', '绳子', '拉链']);

/** 根据名称和类别生成临时参考价，后续可在原料库逐项修改。 */
function provisionalPrice(material) {
  const name = String(material.name || '').toLowerCase();
  if (fabricCategories.has(material.category_name)) {
    if (name.includes('废布')) return 2;
    if (name.includes('提花') || name.includes('灯芯绒') || name.includes('桃皮绒')) return 19.8;
    if (name.includes('棉麻')) return 16.8;
    if (name.includes('16安') && (name.includes('纯棉') || name.includes('帆布') || name.includes('胚布'))) return 18.8;
    if (name.includes('16安')) return 13.8;
    if (name.includes('12安') && (name.includes('纯棉') || name.includes('帆布') || name.includes('胚布'))) return 15.8;
    if (name.includes('12安')) return 11.8;
    if (name.includes('8安')) return 9.8;
    if (name.includes('6安')) return 8.8;
    if (name.includes('5安')) return 7.8;
    if (name.includes('牛津') || name.includes('420d')) return 8.8;
    if (name.includes('eva')) return 9.8;
    if (name.includes('绗棉')) return 12.8;
    return 12.8;
  }
  if (lengthCategories.has(material.category_name)) {
    if (name.includes('银齿') || name.includes('金属拉链')) return 4.8;
    if (name.includes('ykk') && name.includes('拉链')) return 2.8;
    if (name.includes('拉链')) return 1.2;
    if (name.includes('皮绳')) return 1.8;
    if (name.includes('绳') || name.includes('抽绳')) return 0.9;
    if (name.includes('加厚') || name.includes('厚织带') || name.includes('厚编织带')) return 2.2;
    if (name.includes('薄织带')) return 1.2;
    if (name.includes('织带')) return 1.6;
    if (name.includes('包边条')) return 1.3;
    return 1.2;
  }
  if (name.includes('ykk') && name.includes('拉头')) return 0.9;
  if (name.includes('拉头')) return 0.45;
  if (name.includes('钩扣')) return 2.5;
  if (name.includes('磁扣') || name.includes('暗扣')) return 0.9;
  if (name.includes('四合扣') || name.includes('纽扣')) return 0.35;
  if (name.includes('日字') || name.includes('口字') || name.includes('d环')) return name.includes('金属') ? 1.8 : 1.2;
  if (name.includes('标')) return 0.5;
  if (name.includes('夹子')) return 0.8;
  return 1;
}

try {
  const materials = database.prepare(`SELECT m.*,c.name category_name,u.symbol unit
    FROM material m LEFT JOIN material_category c ON c.id=m.category_id
    JOIN unit u ON u.id=m.unit_id
    WHERE COALESCE(m.is_active,1)=1 ORDER BY m.id`).all();
  const update = database.prepare(`UPDATE material SET unit_price=?,price_unit=?,roll_price=?,price_updated_at=?,updated_at=? WHERE id=?`);
  const addHistory = database.prepare(`INSERT INTO material_price(material_id,supplier,price,price_unit,effective_date,notes) VALUES(?,?,?,?,?,?)`);
  const timestamp = new Date().toISOString();
  let updated = 0;
  for (const material of materials) {
    if (Number(material.unit_price) > 0) continue;
    const price = provisionalPrice(material);
    const priceUnit = fabricCategories.has(material.category_name) || lengthCategories.has(material.category_name)
      ? '元/米'
      : `元/${material.unit === '套' ? '套' : material.unit === '对' ? '对' : '个'}`;
    const rollPrice = lengthCategories.has(material.category_name) && Number(material.roll_length_cm) > 0
      ? Number((price * Number(material.roll_length_cm) / 100).toFixed(2))
      : null;
    update.run(price, priceUnit, rollPrice, timestamp, timestamp, material.id);
    addHistory.run(material.id, material.supplier || '', price, priceUnit, timestamp.slice(0, 10), '系统临时参考价，待人工确认');
    updated += 1;
  }
  database.exec('COMMIT;');
  console.log(JSON.stringify({ total: materials.length, updated, preserved: materials.length - updated }, null, 2));
} catch (error) {
  database.exec('ROLLBACK;');
  throw error;
}
