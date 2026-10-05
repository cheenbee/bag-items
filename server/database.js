import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const databasePath = path.resolve(process.env.SQLITE_PATH || path.join(directory, 'bpms.db'));
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new DatabaseSync(databasePath);
db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 10000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
db.exec(fs.readFileSync(path.join(directory, 'schema.sql'), 'utf8'));

function ensureColumn(table, definition) {
  const column = definition.trim().split(/\s+/)[0];
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((item) => item.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

function allowStandaloneQuotations() {
  const sampleColumn = db.prepare('PRAGMA table_info(quotation)').all().find((item) => item.name === 'sample_quote_id');
  if (!sampleColumn?.notnull) return;
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE quotation_migrated (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quote_no TEXT NOT NULL UNIQUE,
        sample_quote_id INTEGER REFERENCES sample_quote(id) ON DELETE SET NULL,
        customer_name TEXT,
        quantity INTEGER NOT NULL,
        unit_price REAL NOT NULL,
        total_price REAL NOT NULL,
        snapshot_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT '草稿',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO quotation_migrated(id,quote_no,sample_quote_id,customer_name,quantity,unit_price,total_price,snapshot_json,status,created_at,updated_at)
        SELECT id,quote_no,sample_quote_id,customer_name,quantity,unit_price,total_price,snapshot_json,status,created_at,updated_at FROM quotation;
      DROP TABLE quotation;
      ALTER TABLE quotation_migrated RENAME TO quotation;
      CREATE INDEX IF NOT EXISTS idx_quotation_sample ON quotation(sample_quote_id,created_at);
      COMMIT;`);
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

allowStandaloneQuotations();

ensureColumn('product', 'strap_info TEXT');
ensureColumn('product', 'process_notes TEXT');
ensureColumn('product_accessory', 'material TEXT');
ensureColumn('product_accessory', 'material_id INTEGER REFERENCES material(id) ON DELETE SET NULL');
ensureColumn('product_accessory', 'color TEXT');
ensureColumn('cutting_part', 'color TEXT');
ensureColumn('cutting_part', "rotation_mode TEXT NOT NULL DEFAULT 'free'");
ensureColumn('cutting_part', 'gap_cm REAL');
ensureColumn('cutting_part', 'sort_order INTEGER NOT NULL DEFAULT 0');
ensureColumn('material', 'usable_width_cm REAL');
ensureColumn('material', 'edge_margin_cm REAL NOT NULL DEFAULT 0');
ensureColumn('material', 'default_gap_cm REAL NOT NULL DEFAULT 1');
ensureColumn('cutting_plan', 'color TEXT');
ensureColumn('cutting_plan', 'delivery_rule_id INTEGER REFERENCES delivery_rule(id) ON DELETE SET NULL');
ensureColumn('cutting_plan', 'cutting_method TEXT');
ensureColumn('sample_quote_attachment', "recognition_status TEXT NOT NULL DEFAULT 'pending'");
ensureColumn('sample_quote_attachment', 'extracted_text TEXT');
ensureColumn('sample_quote_attachment', 'recognition_summary TEXT');
ensureColumn('customer', 'code TEXT');
ensureColumn('customer', 'short_name TEXT');
ensureColumn('customer', 'email TEXT');
ensureColumn('customer', 'address TEXT');
ensureColumn('customer', 'payment_terms TEXT');
ensureColumn('customer', 'currency TEXT NOT NULL DEFAULT \'CNY\'');
ensureColumn('customer', 'default_profit_unit REAL NOT NULL DEFAULT 0');
ensureColumn('customer', 'default_logistics_unit REAL NOT NULL DEFAULT 0');
ensureColumn('customer', 'delivery_requirements TEXT');
ensureColumn('customer', 'quote_preferences TEXT');
ensureColumn('quotation', 'quote_date TEXT');
ensureColumn('quotation', 'valid_until TEXT');
ensureColumn('quotation', 'contact_name TEXT');
ensureColumn('quotation', 'phone TEXT');
ensureColumn('quotation', 'email TEXT');
ensureColumn('quotation', 'address TEXT');
ensureColumn('quotation', 'salesperson TEXT');
ensureColumn('quotation', "currency TEXT NOT NULL DEFAULT 'CNY'");
ensureColumn('quotation', 'exchange_rate REAL NOT NULL DEFAULT 1');
ensureColumn('quotation', "template_key TEXT NOT NULL DEFAULT 'classic'");
ensureColumn('quotation', "language_key TEXT NOT NULL DEFAULT 'zh'");
ensureColumn('quotation', 'order_discount REAL NOT NULL DEFAULT 0');
ensureColumn('quotation', 'shipping_fee REAL NOT NULL DEFAULT 0');
ensureColumn('quotation', 'tax_rate REAL NOT NULL DEFAULT 0');
ensureColumn('quotation', 'deposit_rate REAL NOT NULL DEFAULT 30');
ensureColumn('quotation', 'payment_terms TEXT');
ensureColumn('quotation', 'trade_term TEXT');
ensureColumn('quotation', 'delivery_term TEXT');
ensureColumn('quotation', 'packaging_term TEXT');
ensureColumn('quotation', 'shipping_term TEXT');
ensureColumn('quotation', 'quality_term TEXT');
ensureColumn('quotation', 'customer_notes TEXT');
ensureColumn('quotation', 'internal_notes TEXT');
ensureColumn('quotation', 'shipping_origin TEXT');
ensureColumn('quotation', 'complaint_contact TEXT');
ensureColumn('quotation', 'complaint_phone TEXT');
ensureColumn('quotation', 'complaint_email TEXT');
ensureColumn('quotation', 'complaint_wechat TEXT');
ensureColumn('quotation_item', 'packaging TEXT');
ensureColumn('quotation_item', "price_tiers_json TEXT NOT NULL DEFAULT '[]'");
db.exec(`CREATE TABLE IF NOT EXISTS cutting_plan_mold (
  cutting_plan_id INTEGER NOT NULL REFERENCES cutting_plan(id) ON DELETE CASCADE,
  mold_id INTEGER NOT NULL REFERENCES mold(id) ON DELETE CASCADE,
  PRIMARY KEY (cutting_plan_id, mold_id)
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_cutting_plan_rule ON cutting_plan(delivery_rule_id)');
db.prepare(`INSERT OR IGNORE INTO cutting_plan_mold(cutting_plan_id,mold_id)
  SELECT id,mold_id FROM cutting_plan WHERE mold_id IS NOT NULL`).run();
db.prepare(`UPDATE cutting_plan SET cutting_method=CASE
  WHEN cutting_mode='刀模裁剪' THEN '刀模裁剪'
  WHEN cutting_mode='手工裁剪' THEN '手工裁剪'
  ELSE '手工裁剪' END
  WHERE TRIM(COALESCE(cutting_method,''))=''`).run();

export function backfillAccessoryMaterialLinks() {
  const accessories = db.prepare('SELECT id,name FROM product_accessory WHERE material_id IS NULL').all();
  const findMaterial = db.prepare('SELECT id FROM material WHERE name = ? ORDER BY id LIMIT 1');
  const update = db.prepare('UPDATE product_accessory SET material_id=? WHERE id=?');
  accessories.forEach((item) => { const material = findMaterial.get(item.name); if (material) update.run(material.id, item.id); });
}

/** 颜色从材料主档拆出，并合并仅颜色不同的重复材料记录。 */
export function separateMaterialColors() {
  const materials = db.prepare('SELECT * FROM material ORDER BY id').all();
  const ensureColor = db.prepare('INSERT OR IGNORE INTO color(name) VALUES (?)');
  const canonicalByKey = new Map();
  const rulesByMaterial = db.prepare('SELECT * FROM delivery_rule WHERE material_id=?').all.bind(db.prepare('SELECT * FROM delivery_rule WHERE material_id=?'));
  const colorWords = ['银白金属','金属银白','橄榄绿','咖啡色','浅蓝色','银白色','古铜色','卡其色','黑色','白色','米白','卡其','墨绿','红色','蓝色','姜黄','灰色','本白','纯白','银白','古铜','棕色'];
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const material of materials) {
      const color = String(material.color || '').trim();
      if (color) {
        color.split(/[、,，/]+/).map((item) => item.trim()).filter(Boolean).forEach((name) => ensureColor.run(name));
        db.prepare("UPDATE product_accessory SET color=? WHERE material_id=? AND TRIM(COALESCE(color,''))='' ").run(color, material.id);
        db.prepare("UPDATE cutting_part SET color=? WHERE material_id=? AND TRIM(COALESCE(color,''))='' ").run(color, material.id);
        db.prepare("UPDATE cutting_plan SET color=? WHERE material_id=? AND TRIM(COALESCE(color,''))='' ").run(color, material.id);
        db.prepare("UPDATE delivery_rule SET color=? WHERE material_id=? AND TRIM(COALESCE(color,''))='' ").run(color, material.id);
      }
      const originalName = String(material.name || '').trim();
      const nameColor = colorWords.find((name) => originalName.includes(name));
      let cleanName = colorWords.reduce((name, colorName) => name.replaceAll(colorName, ''), originalName).replace(/[、,，/]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (cleanName.length < 2) cleanName = originalName;
      if (nameColor) {
        ensureColor.run(nameColor);
        db.prepare("UPDATE product_accessory SET color=? WHERE material_id=? AND TRIM(COALESCE(color,''))='' ").run(nameColor, material.id);
        db.prepare("UPDATE cutting_part SET color=? WHERE material_id=? AND TRIM(COALESCE(color,''))='' ").run(nameColor, material.id);
        db.prepare("UPDATE cutting_plan SET color=? WHERE material_id=? AND TRIM(COALESCE(color,''))='' ").run(nameColor, material.id);
        db.prepare("UPDATE delivery_rule SET color=? WHERE material_id=? AND TRIM(COALESCE(color,''))='' ").run(nameColor, material.id);
      }
      if (cleanName !== originalName) db.prepare('UPDATE material SET name=? WHERE id=?').run(cleanName, material.id);
      const key = [cleanName.toLowerCase(),material.category_id || '',String(material.specification || '').trim().toLowerCase(),material.unit_id || '',material.width_cm ?? '',material.weight_gsm ?? '',material.roll_length_cm ?? '',String(material.supplier || '').trim().toLowerCase()].join('|');
      const canonicalId = canonicalByKey.get(key);
      if (!canonicalId) { canonicalByKey.set(key, material.id); continue; }
      db.prepare('UPDATE product_accessory SET material_id=? WHERE material_id=?').run(canonicalId, material.id);
      db.prepare('UPDATE cutting_part SET material_id=? WHERE material_id=?').run(canonicalId, material.id);
      db.prepare('UPDATE cutting_plan SET material_id=? WHERE material_id=?').run(canonicalId, material.id);
      db.prepare('UPDATE purchase_order_item SET material_id=? WHERE material_id=?').run(canonicalId, material.id);
      for (const rule of rulesByMaterial(material.id)) {
        const duplicate = db.prepare("SELECT id FROM delivery_rule WHERE product_id=? AND material_id=? AND COALESCE(color,'')=COALESCE(?,'') AND COALESCE(description,'')=COALESCE(?,'') AND calculation_method=? LIMIT 1").get(rule.product_id, canonicalId, rule.color, rule.description, rule.calculation_method);
        if (duplicate) db.prepare('DELETE FROM delivery_rule WHERE id=?').run(rule.id);
        else db.prepare('UPDATE delivery_rule SET material_id=? WHERE id=?').run(canonicalId, rule.id);
      }
      for (const item of db.prepare('SELECT * FROM bom_item WHERE material_id=?').all(material.id)) {
        const duplicate = db.prepare('SELECT id FROM bom_item WHERE product_id=? AND material_id=?').get(item.product_id, canonicalId);
        if (duplicate) db.prepare('DELETE FROM bom_item WHERE id=?').run(item.id);
        else db.prepare('UPDATE bom_item SET material_id=? WHERE id=?').run(canonicalId, item.id);
      }
      db.prepare('DELETE FROM material WHERE id=?').run(material.id);
    }
    db.prepare("UPDATE material SET color='' WHERE TRIM(COALESCE(color,''))<>''").run();
    db.prepare(`UPDATE product_accessory SET
      name=COALESCE((SELECT name FROM material WHERE id=product_accessory.material_id),name),
      specification=COALESCE((SELECT specification FROM material WHERE id=product_accessory.material_id),specification)
      WHERE material_id IS NOT NULL`).run();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
ensureColumn('material', 'unit_price REAL');
ensureColumn('material', 'roll_length_cm REAL');
ensureColumn('material', 'is_active INTEGER NOT NULL DEFAULT 1');
ensureColumn('delivery_rule', 'unit TEXT');
ensureColumn('delivery_rule', 'mold_id INTEGER REFERENCES mold(id) ON DELETE SET NULL');
ensureColumn('delivery_rule', 'library_type TEXT');
ensureColumn('delivery_rule', 'color_strategy TEXT');
ensureColumn('delivery_rule', "source_type TEXT NOT NULL DEFAULT 'manual'");
ensureColumn('delivery_rule', 'is_auto_generated INTEGER NOT NULL DEFAULT 0');
ensureColumn('delivery_rule', 'product_accessory_id INTEGER REFERENCES product_accessory(id) ON DELETE CASCADE');
db.prepare(`UPDATE cutting_plan SET delivery_rule_id=(
  SELECT MIN(r.id) FROM delivery_rule r
  WHERE r.product_id=cutting_plan.product_id AND r.material_id=cutting_plan.material_id AND r.library_type='布料库'
) WHERE delivery_rule_id IS NULL`).run();
ensureColumn('material', 'price_unit TEXT');
ensureColumn('material', 'roll_price REAL');
ensureColumn('material', 'price_updated_at TEXT');
ensureColumn('delivery_order', 'labor_unit_cost REAL');
ensureColumn('delivery_order', 'packaging_unit_cost REAL');
ensureColumn('delivery_order', "labor_source TEXT NOT NULL DEFAULT 'manual'");
ensureColumn('delivery_order', 'labor_process_snapshot_json TEXT');
ensureColumn('delivery_order', 'cutting_cost REAL NOT NULL DEFAULT 0');
ensureColumn('delivery_order', 'delivery_cost REAL NOT NULL DEFAULT 0');
ensureColumn('product', 'public_code TEXT');
ensureColumn('material', 'public_code TEXT');
ensureColumn('mold', 'public_code TEXT');
ensureColumn('cutting_plan', 'public_code TEXT');
ensureColumn('delivery_order', 'public_code TEXT');
ensureColumn('product_image', 'thumbnail_url TEXT');
ensureColumn('product_image', 'mime_type TEXT');
ensureColumn('product_image', 'file_size INTEGER');
ensureColumn('product_image', 'uploaded_by INTEGER REFERENCES app_user(id) ON DELETE SET NULL');
ensureColumn('material', 'image_thumbnail_url TEXT');
ensureColumn('material', 'image_mime_type TEXT');
ensureColumn('material', 'image_file_size INTEGER');
ensureColumn('mold', 'image_thumbnail_url TEXT');
ensureColumn('mold', 'image_mime_type TEXT');
ensureColumn('mold', 'image_file_size INTEGER');
ensureColumn('cutting_plan', 'image_thumbnail_url TEXT');
ensureColumn('cutting_plan', 'image_mime_type TEXT');
ensureColumn('cutting_plan', 'image_file_size INTEGER');
db.prepare("UPDATE product SET public_code='P:'||code WHERE TRIM(COALESCE(public_code,''))='' ").run();
db.prepare("UPDATE material SET public_code='M:'||code WHERE TRIM(COALESCE(public_code,''))='' ").run();
db.prepare("UPDATE mold SET public_code='D:'||code WHERE TRIM(COALESCE(public_code,''))='' ").run();
db.prepare("UPDATE cutting_plan SET public_code='C:'||id WHERE TRIM(COALESCE(public_code,''))='' ").run();
db.prepare("UPDATE delivery_order SET public_code='O:'||order_no WHERE TRIM(COALESCE(public_code,''))='' ").run();
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_product_public_code ON product(public_code)');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_material_public_code ON material(public_code)');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_mold_public_code ON mold(public_code)');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_cutting_plan_public_code ON cutting_plan(public_code)');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_order_public_code ON delivery_order(public_code)');
db.exec(`CREATE TRIGGER IF NOT EXISTS trg_product_public_code AFTER INSERT ON product WHEN NEW.public_code IS NULL BEGIN UPDATE product SET public_code='P:'||NEW.code WHERE id=NEW.id; END;
CREATE TRIGGER IF NOT EXISTS trg_material_public_code AFTER INSERT ON material WHEN NEW.public_code IS NULL BEGIN UPDATE material SET public_code='M:'||NEW.code WHERE id=NEW.id; END;
CREATE TRIGGER IF NOT EXISTS trg_mold_public_code AFTER INSERT ON mold WHEN NEW.public_code IS NULL BEGIN UPDATE mold SET public_code='D:'||NEW.code WHERE id=NEW.id; END;
CREATE TRIGGER IF NOT EXISTS trg_cutting_plan_public_code AFTER INSERT ON cutting_plan WHEN NEW.public_code IS NULL BEGIN UPDATE cutting_plan SET public_code='C:'||NEW.id WHERE id=NEW.id; END;
CREATE TRIGGER IF NOT EXISTS trg_delivery_order_public_code AFTER INSERT ON delivery_order WHEN NEW.public_code IS NULL BEGIN UPDATE delivery_order SET public_code='O:'||NEW.order_no WHERE id=NEW.id; END;`);
db.prepare(`UPDATE delivery_order SET
  labor_unit_cost=COALESCE(labor_unit_cost,labor_cost,0),
  packaging_unit_cost=COALESCE(packaging_unit_cost,packaging_cost,0)`).run();
db.prepare(`UPDATE delivery_order SET
  labor_cost=ROUND(COALESCE(labor_unit_cost,0)*production_quantity,2),
  packaging_cost=ROUND(COALESCE(packaging_unit_cost,0)*production_quantity,2),
  total_cost=ROUND(COALESCE(material_cost,0)+COALESCE(loss_cost,0)+COALESCE(labor_unit_cost,0)*production_quantity+COALESCE(packaging_unit_cost,0)*production_quantity+COALESCE(cutting_cost,0)+COALESCE(delivery_cost,0)+COALESCE(other_cost,0),2)`).run();
db.prepare(`INSERT INTO material_price(material_id,supplier,price,price_unit,effective_date,notes)
  SELECT m.id,COALESCE(m.supplier,''),m.unit_price,
    COALESCE(NULLIF(m.price_unit,''),CASE WHEN c.name IN ('面布','里布','夹层','支撑板','复合布','其它','布料','长度材料','织带','绳子','拉链') THEN '元/米' ELSE '元/'||u.symbol END),
    SUBSTR(COALESCE(m.price_updated_at,m.updated_at,CURRENT_TIMESTAMP),1,10),'现有原料库价格'
  FROM material m LEFT JOIN material_category c ON c.id=m.category_id JOIN unit u ON u.id=m.unit_id
  WHERE COALESCE(m.is_active,1)=1 AND m.unit_price>0 AND NOT EXISTS(SELECT 1 FROM material_price mp WHERE mp.material_id=m.id)`).run();
db.exec(`CREATE TABLE IF NOT EXISTS delivery_rule_cutting_part (
  delivery_rule_id INTEGER NOT NULL REFERENCES delivery_rule(id) ON DELETE CASCADE,
  cutting_part_id INTEGER NOT NULL REFERENCES cutting_part(id) ON DELETE CASCADE,
  PRIMARY KEY(delivery_rule_id, cutting_part_id)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS delivery_rule_color_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_rule_id INTEGER NOT NULL REFERENCES delivery_rule(id) ON DELETE CASCADE,
  product_color TEXT NOT NULL,
  material_color TEXT NOT NULL,
  UNIQUE(delivery_rule_id, product_color)
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_delivery_rule_color_map_rule ON delivery_rule_color_map(delivery_rule_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_delivery_rule_accessory ON delivery_rule(product_accessory_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_delivery_rule_part_rule ON delivery_rule_cutting_part(delivery_rule_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_delivery_rule_part_part ON delivery_rule_cutting_part(cutting_part_id)');

function ensureSalesStatusSchema() {
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='product'").get()?.sql || '';
  if (schema.includes("'销售中'")) return;
  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN IMMEDIATE;
    CREATE TABLE product_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      sku TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT,
      color TEXT,
      brand TEXT,
      development_date TEXT,
      status TEXT NOT NULL DEFAULT '销售中' CHECK(status IN ('销售中','打样中','生产中','停产')),
      warehouse_location TEXT,
      strap_info TEXT,
      process_notes TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO product_new(id,code,sku,name,category,color,brand,development_date,status,warehouse_location,strap_info,process_notes,notes,created_at,updated_at)
      SELECT id,code,sku,name,category,color,brand,development_date,CASE WHEN status='开发中' THEN '销售中' ELSE status END,warehouse_location,strap_info,process_notes,notes,created_at,updated_at FROM product;
    DROP TABLE product;
    ALTER TABLE product_new RENAME TO product;
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}
ensureSalesStatusSchema();

const insert = (sql, values) => db.prepare(sql).run(...values);
const count = (table) => Number(db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total);

export function ensureReferenceData() {
  const add = (table, name, sortOrder) => db.prepare(`INSERT OR IGNORE INTO ${table}(name, sort_order) VALUES (?, ?)`).run(name, sortOrder);
  ['托特包','手提包','单肩包','斜挎包','双肩包','水桶包','化妆包','收纳包','钱包','旅行包','其他'].forEach((name, index) => add('product_category', name, index));
  ['黑色','白色','米白','卡其','咖啡色','橄榄绿','墨绿','红色','蓝色','姜黄','灰色'].forEach((name) => db.prepare('INSERT OR IGNORE INTO color(name) VALUES (?)').run(name));
  [['面布', 0], ['里布', 1], ['夹层', 2], ['支撑板', 3], ['复合布', 4], ['其它', 5], ['长度材料', 10], ['五金配件', 20]].forEach(([name, sortOrder]) => add('material_category', name, sortOrder));
  db.prepare("UPDATE product SET status='销售中' WHERE status='开发中'").run();
  db.prepare("UPDATE cutting_part SET color='' WHERE TRIM(COALESCE(color,''))<>''").run();
  db.prepare(`UPDATE delivery_rule SET category='里布',color=''
    WHERE library_type='布料库' AND category<>'里布' AND color='白鲸棉麻'
      AND product_id IN (SELECT id FROM product WHERE sku='2057')
      AND material_id IN (SELECT id FROM material WHERE name='白鲸棉麻')`).run();
  const invalidCategories = ['?', '？', '??', '？？', '???', '？？？'];
  const placeholders = invalidCategories.map(() => '?').join(',');
  db.prepare(`UPDATE product SET category='其他' WHERE TRIM(COALESCE(category,'')) IN (${placeholders})`).run(...invalidCategories);
  db.prepare(`DELETE FROM product_category WHERE TRIM(name) IN (${placeholders})`).run(...invalidCategories);
}

export function migrateLegacyProductColors() {
  const products = db.prepare('SELECT id, color FROM product WHERE TRIM(COALESCE(color, \'\')) <> \'\'').all();
  const insertColor = db.prepare('INSERT OR IGNORE INTO color(name) VALUES (?)');
  const findColor = db.prepare('SELECT id FROM color WHERE name = ?');
  const link = db.prepare('INSERT OR IGNORE INTO product_color(product_id, color_id) VALUES (?, ?)');
  for (const product of products) {
    for (const name of product.color.split(/[、,，+\s]+/).map((item) => item.trim()).filter(Boolean)) {
      insertColor.run(name);
      link.run(product.id, findColor.get(name).id);
    }
  }
}

export function removeImportSourceNotes() {
  const sourcePattern = /导入来源：2051-2099产品裁剪档案表修订版\.xlsx(?:（工作表\s*\d+）)?\n?/g;
  const cleanTable = (table) => {
    const rows = db.prepare(`SELECT id, notes FROM ${table} WHERE notes LIKE '%导入来源：2051-2099产品裁剪档案表修订版.xlsx%'`).all();
    const update = db.prepare(`UPDATE ${table} SET notes = ? WHERE id = ?`);
    rows.forEach((row) => update.run(String(row.notes || '').replace(sourcePattern, '').trim(), row.id));
  };
  cleanTable('product');
  cleanTable('cutting_part');
  db.prepare("UPDATE material SET notes = TRIM(REPLACE(COALESCE(notes, ''), '导入来源：2051-2099产品裁剪档案表修订版.xlsx', '')) WHERE notes LIKE '%导入来源：2051-2099产品裁剪档案表修订版.xlsx%'").run();
}

export function backfillImportedAccessoryMaterials() {
  db.prepare(`UPDATE product_accessory
    SET material = CASE name
      WHEN '加厚织带' THEN '棉织带'
      WHEN 'YKK拉链布' THEN '涤纶'
      WHEN 'YKK拉头' THEN '金属'
      WHEN '大磁扣' THEN '金属'
      WHEN 'yoululai黑色正标' THEN '织唛'
      WHEN '小皮绳' THEN '皮绳'
      ELSE material
    END
    WHERE product_id = (SELECT id FROM product WHERE sku = '2073')
      AND TRIM(COALESCE(material, '')) = ''`).run();
}

function accessoryName(source) {
  const rules = [
    ['拉链布', /拉链布/i], ['拉头', /拉头/i], ['磁扣', /磁扣/], ['四合扣', /四合扣/],
    ['日字扣', /日字扣/], ['口字扣', /口字扣/], ['D环', /D环/i], ['钩扣', /钩扣/],
    ['铆钉', /铆钉/], ['圆环', /圆环/], ['包边条', /包边条/], ['烫画片', /烫画/],
    ['布标', /正标|侧标|布标/], ['抽绳', /抽绳/], ['棉绳', /棉绳/], ['皮绳', /皮绳/], ['织带', /织带/],
  ];
  return rules.find(([, pattern]) => pattern.test(source))?.[0] || '待确认配件';
}

function accessoryMaterial(name, source) {
  if (/拉链布/.test(name)) return '涤纶';
  if (/拉头|扣|环|铆钉/.test(name)) return '金属';
  if (/布标/.test(name)) return '织唛';
  if (/皮绳/.test(name)) return '皮革';
  if (/抽绳|棉绳/.test(name)) return '棉绳';
  if (/织带/.test(name)) return '织带';
  if (/包边条/.test(name)) return /涤棉/.test(source) ? '涤棉' : '';
  return '';
}

function parseAccessoryQuantity(source, name) {
  const numeric = source.match(/(?:\*|×)\s*(\d+(?:\.\d+)?)(?:\s*(个|根|对|条|套|片|枚))?|(?<!\d)(\d+(?:\.\d+)?)\s*(个|根|对|条|套|片|枚)/);
  if (numeric) {
    const quantity = Number(numeric[1] || numeric[3]);
    const unit = numeric[2] || numeric[4] || (/拉链布|织带|绳/.test(name) ? '根' : '个');
    return { quantity, unit };
  }
  const chinese = source.match(/([一二两])\s*(个|根|对|条|套|片|枚)/);
  if (!chinese) return { quantity: null, unit: '' };
  return { quantity: chinese[1] === '两' || chinese[1] === '二' ? 2 : 1, unit: chinese[2] };
}

function splitAccessoryText(source) {
  const start = /(?:\d+(?:\.\d+)?cm(?:宽)?(?:金属)?(?:日字扣|口字扣|D环|钩扣)|(?:\d+号)?(?:普通)?(?:黑色)?(?:YKK)?(?:拉链布|拉头|拉链)(?:\d+(?:\.\d+)?cm)?|(?:大)?磁扣|四合扣|(?:[a-z]+|有鹿来|小熊|黑侧标)[^\s]*?(?:正标|侧标|布标|小熊标)|(?:\d+(?:\.\d+)?cm宽)?(?:加厚|厚|薄)?织带(?:\d+(?:\.\d+)?cm)?|(?:细|八股)?(?:棉)?抽绳(?:\d+(?:\.\d+)?cm)?|涤棉包边条|烫画片|圆环|棉绳|小皮绳|钩扣|口字扣|铆钉)/gi;
  return source.replace(/`/g, ' ').split(/\s{2,}|[；;]/).flatMap((chunk) => {
    const text = chunk.trim();
    const matches = [...text.matchAll(start)];
    if (matches.length < 2) return text ? [text] : [];
    return matches.map((match, index) => text.slice(match.index, matches[index + 1]?.index).trim()).filter(Boolean);
  });
}

export function backfillImportedAccessories({ reset = false } = {}) {
  if (reset) db.prepare("DELETE FROM product_accessory WHERE notes LIKE '原始配件说明：%'").run();
  const products = db.prepare(`SELECT id, notes, strap_info FROM product
    WHERE TRIM(COALESCE(notes, '')) LIKE '%其它配件：%'
      AND NOT EXISTS (SELECT 1 FROM product_accessory WHERE product_id = product.id)`).all();
  const add = db.prepare('INSERT INTO product_accessory(product_id,name,material,specification,quantity,unit,notes,sort_order) VALUES(?,?,?,?,?,?,?,?)');
  const updateStrap = db.prepare('UPDATE product SET strap_info=? WHERE id=? AND TRIM(COALESCE(strap_info, \'\')) = \'\'');
  let created = 0;
  for (const product of products) {
    const strap = String(product.notes).match(/包带情况：([^\n]+)/)?.[1]?.trim();
    if (strap) updateStrap.run(strap, product.id);
    const source = String(product.notes).match(/其它配件：([^\n]+)/)?.[1]?.trim();
    if (!source) continue;
    const segments = splitAccessoryText(source);
    const entries = segments.length ? segments : [source];
    entries.forEach((entry, index) => {
      const name = accessoryName(entry);
      const quantity = parseAccessoryQuantity(entry, name);
      add.run(product.id, name, accessoryMaterial(name, entry), entry, quantity.quantity, quantity.unit, `原始配件说明：${entry}`, index);
      created += 1;
    });
  }
  return { products: products.length, accessories: created };
}

export function backfillDeliveryRuleUnits() {
  db.prepare(`UPDATE delivery_rule SET unit = CASE
    WHEN category IN ('面料', '里布') THEN 'm'
    WHEN material_id IN (SELECT id FROM material WHERE name LIKE '%拉链布%' OR name LIKE '%织带%' OR name LIKE '%绳%') THEN '根'
    WHEN material_id IN (SELECT id FROM material WHERE name LIKE '%磁扣%' OR name LIKE '%四合扣%') THEN '对'
    ELSE '个'
  END WHERE TRIM(COALESCE(unit, '')) = ''`).run();
  db.prepare(`UPDATE delivery_rule SET mold_id = (SELECT MIN(m.id) FROM mold m WHERE m.product_id=delivery_rule.product_id)
    WHERE cutting_mode='刀模裁剪' AND mold_id IS NULL
      AND (SELECT COUNT(*) FROM mold m WHERE m.product_id=delivery_rule.product_id) = 1`).run();
}

/** 将旧配货规则按材料所属基础库归类，BOM 与维护页共用这一分类。 */
export function backfillDeliveryRuleLibraries() {
  db.prepare(`UPDATE delivery_rule SET library_type = CASE
    WHEN material_id IN (
      SELECT m.id FROM material m JOIN material_category c ON c.id=m.category_id
      WHERE c.name IN ('面布','里布','夹层','支撑板','复合布','其它','布料')
    ) THEN '布料库'
    WHEN material_id IN (
      SELECT m.id FROM material m JOIN material_category c ON c.id=m.category_id
      WHERE c.name IN ('长度材料','织带','绳子','拉链')
    ) THEN '长度材料库'
    ELSE '五金配件库'
  END WHERE TRIM(COALESCE(library_type, '')) = ''
    OR library_type NOT IN ('布料库','长度材料库','五金配件库')`).run();
  db.prepare("UPDATE delivery_rule SET calculation_method='裁剪拉布',unit='m' WHERE library_type='布料库'").run();
  db.prepare("UPDATE delivery_rule SET calculation_method='配件数量' WHERE library_type IN ('长度材料库','五金配件库')").run();
}

/** 将旧备注中的“产品颜色配材料颜色”迁移为结构化例外对应。 */
export function backfillDeliveryRuleColorStrategies() {
  const rules = db.prepare('SELECT * FROM delivery_rule ORDER BY id').all();
  const updateStrategy = db.prepare('UPDATE delivery_rule SET color_strategy=? WHERE id=?');
  const addMapping = db.prepare('INSERT OR IGNORE INTO delivery_rule_color_map(delivery_rule_id,product_color,material_color) VALUES(?,?,?)');
  const listMappings = db.prepare('SELECT product_color,material_color FROM delivery_rule_color_map WHERE delivery_rule_id=? ORDER BY id');
  const deleteMappings = db.prepare('DELETE FROM delivery_rule_color_map WHERE delivery_rule_id=?');
  const productColorsQuery = db.prepare('SELECT c.name FROM product_color pc JOIN color c ON c.id=pc.color_id WHERE pc.product_id=? ORDER BY pc.rowid');
  const normalizeColorAlias = (value) => String(value || '').trim().replace(/色$/, '');
  const cleanMaterialColor = (value) => String(value || '').trim().replace(/(?:拉链布|包边条|织带|绳子|绳|布料|面料|里布|五金|配件)$/, '').trim();
  for (const rule of rules) {
    const productColors = productColorsQuery.all(rule.product_id).map((item) => item.name);
    const existingMappings = listMappings.all(rule.id);
    if (existingMappings.length) {
      const normalizedMappings = new Map(existingMappings.map((mapping) => {
        const productColor = productColors.find((color) => normalizeColorAlias(color) === normalizeColorAlias(mapping.product_color)) || mapping.product_color;
        return [productColor, cleanMaterialColor(mapping.material_color)];
      }).filter(([, materialColor]) => materialColor));
      deleteMappings.run(rule.id);
      normalizedMappings.forEach((materialColor, productColor) => addMapping.run(rule.id, productColor, materialColor));
    }
    if (['follow','fixed','mapped'].includes(String(rule.color_strategy || '').trim())) continue;
    const mappings = [];
    const expression = /([^配；;。\s]+(?:[、，,][^配；;。\s]+)*)配([^、，,；;。\s]+)/g;
    for (const match of String(rule.description || '').matchAll(expression)) {
      const targetColor = cleanMaterialColor(match[2]);
      match[1].split(/[、，,]/).map((color) => color.trim()).filter(Boolean).forEach((sourceColor) => {
        const productColor = productColors.find((color) => normalizeColorAlias(color) === normalizeColorAlias(sourceColor)) || sourceColor;
        if (targetColor) mappings.push({ productColor, targetColor });
      });
    }
    const strategy = mappings.length ? 'mapped' : String(rule.color || '').trim() ? 'fixed' : 'follow';
    updateStrategy.run(strategy, rule.id);
    mappings.forEach((mapping) => addMapping.run(rule.id, mapping.productColor, mapping.targetColor));
  }
}

/** 配件档案作为配货来源；布料配货规则保持独立填写。 */
export function backfillDeliveryRuleSources() {
  const fabricCategories = new Set(['面布','里布','夹层','支撑板','复合布','其它','布料']);
  const lengthCategories = new Set(['长度材料','织带','绳子','拉链']);
  const materialQuery = db.prepare(`SELECT m.id,c.name category_name,u.symbol unit FROM material m
    LEFT JOIN material_category c ON c.id=m.category_id JOIN unit u ON u.id=m.unit_id WHERE m.id=?`);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`DELETE FROM delivery_rule WHERE library_type='布料库' AND source_type='cutting_parts' AND is_auto_generated=1
      AND (quantity_per_product IS NULL OR cutting_length_cm IS NULL)
      AND NOT EXISTS(SELECT 1 FROM cutting_plan cp WHERE cp.delivery_rule_id=delivery_rule.id)`).run();
    db.prepare("UPDATE delivery_rule SET source_type='manual',is_auto_generated=0 WHERE library_type='布料库' AND source_type='cutting_parts'").run();
    db.prepare('DELETE FROM delivery_rule_cutting_part').run();
    const accessories = db.prepare('SELECT * FROM product_accessory WHERE material_id IS NOT NULL ORDER BY id').all();
    for (const accessory of accessories) {
      const material = materialQuery.get(accessory.material_id);
      if (!material || fabricCategories.has(material.category_name)) continue;
      const libraryType = lengthCategories.has(material.category_name) ? '长度材料库' : '五金配件库';
      let rule = db.prepare('SELECT * FROM delivery_rule WHERE product_accessory_id=? LIMIT 1').get(accessory.id);
      if (!rule) rule = db.prepare(`SELECT * FROM delivery_rule WHERE product_id=? AND material_id=? AND library_type<>'布料库' AND product_accessory_id IS NULL
        ORDER BY CASE WHEN ABS(COALESCE(quantity_per_product,0)-COALESCE(?,0))<0.0001 THEN 0 ELSE 1 END,id LIMIT 1`).get(accessory.product_id, accessory.material_id, accessory.quantity);
      if (rule) {
        const strategy = rule.color_strategy === 'mapped' ? 'mapped' : accessory.color ? 'fixed' : 'follow';
        const color = strategy === 'mapped' ? rule.color : accessory.color || '';
        db.prepare(`UPDATE delivery_rule SET material_id=?,library_type=?,category='配件',color=?,color_strategy=?,source_type='product_accessory',product_accessory_id=?,quantity_per_product=?,unit=?,cutting_length_cm=CASE WHEN ?='五金配件库' THEN NULL ELSE cutting_length_cm END WHERE id=?`)
          .run(accessory.material_id, libraryType, color, strategy, accessory.id, accessory.quantity, accessory.unit || material.unit, libraryType, rule.id);
        continue;
      }
      db.prepare(`INSERT INTO delivery_rule(product_id,material_id,category,color,color_strategy,source_type,is_auto_generated,product_accessory_id,description,quantity_per_product,cutting_length_cm,unit,calculation_method,cutting_mode,notes,sort_order,library_type)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(accessory.product_id, accessory.material_id, '配件', accessory.color || '', accessory.color ? 'fixed' : 'follow', 'product_accessory', 1, accessory.id, null, accessory.quantity, null, accessory.unit || material.unit, '配件数量', '待确认', '', db.prepare('SELECT COUNT(*) total FROM delivery_rule WHERE product_id=?').get(accessory.product_id).total, libraryType);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function seedDatabase() {
  if (count('product') > 0) {
    // 早期演示数据库缺少织带幅宽，补齐后才能进行幅宽排料计算。
    db.prepare('UPDATE material SET width_cm = 148 WHERE code = ? AND width_cm IS NULL').run('MAT-WEBBING-03');
    return;
  }
  [['米','m'],['厘米','cm'],['个','个'],['条','条'],['套','套'],['公斤','kg']].forEach(([name, symbol]) =>
    insert('INSERT INTO unit(name, symbol) VALUES (?, ?)', [name, symbol]));
  ['布料','里布','织带','绳子','拉链','五金','包装材料'].forEach((name, sortOrder) =>
    insert('INSERT INTO material_category(name, sort_order) VALUES (?, ?)', [name, sortOrder]));
  insert('INSERT INTO product(code, sku, name, category, color, brand, development_date, status, warehouse_location, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ['P-2051','2051','经典帆布托特包','手提包','米白','BPMS','2026-08-01','打样中','A-03-12','用于演示完整 BOM 计算流程']);
  insert('INSERT INTO material(code, name, category_id, specification, color, unit_id, width_cm, supplier) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ['MAT-CANVAS-12OZ','12安帆布',1,'12安','米白',1,148,'华南帆布厂']);
  insert('INSERT INTO material(code, name, category_id, specification, color, unit_id, width_cm, supplier) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ['MAT-WEBBING-03','3cm棉织带',3,'3cm','米白',1,148,'华南织带厂']);
  insert('INSERT INTO material(code, name, category_id, specification, color, unit_id, supplier) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['MAT-SNAP-18','18mm磁扣',6,'18mm','古铜色',5,'五金供应商']);
  insert('INSERT INTO mold(code, name, product_id, storage_location) VALUES (?, ?, ?, ?)', ['M-2051-FRONT','2051 前片刀模',1,'模具库 B-07']);
  insert('INSERT INTO cutting_part(code, product_id, material_id, mold_id, name, max_length_cm, max_width_cm, quantity_per_product, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ['CP-2051-FRONT',1,1,1,'前片',42,36,2,'主体']);
  insert('INSERT INTO bom_item(product_id, material_id, unit_id, usage_per_product, waste_rate, calculation_method, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [1,1,1,0.62,0.05,'长度','主体面料']);
  insert('INSERT INTO bom_item(product_id, material_id, unit_id, usage_per_product, waste_rate, calculation_method, strip_width_cm, part_length_cm, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [1,2,1,2,0.05,'幅宽排料',3,60,'手提带，每包两条']);
  insert('INSERT INTO bom_item(product_id, material_id, unit_id, usage_per_product, waste_rate, calculation_method, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [1,3,5,2,0,'数量','每包两套磁扣']);
}

export { db };
