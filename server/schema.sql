-- BPMS V1.0 数据库结构（SQLite，可平滑迁移到 MySQL / PostgreSQL）
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS unit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS material_category (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS product_category (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS color (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS material (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES material_category(id),
  specification TEXT,
  color TEXT,
  unit_id INTEGER NOT NULL REFERENCES unit(id),
  width_cm REAL,
  usable_width_cm REAL,
  edge_margin_cm REAL NOT NULL DEFAULT 0,
  default_gap_cm REAL NOT NULL DEFAULT 1,
  weight_gsm REAL,
  roll_length_cm REAL,
  unit_price REAL,
  price_unit TEXT,
  roll_price REAL,
  price_updated_at TEXT,
  supplier TEXT,
  image_url TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS material_price (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL REFERENCES material(id) ON DELETE CASCADE,
  supplier TEXT,
  price REAL NOT NULL CHECK(price >= 0),
  price_unit TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product (
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

CREATE TABLE IF NOT EXISTS product_color (
  product_id INTEGER NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  color_id INTEGER NOT NULL REFERENCES color(id),
  PRIMARY KEY(product_id, color_id)
);

CREATE TABLE IF NOT EXISTS product_accessory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  material_id INTEGER REFERENCES material(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  material TEXT,
  specification TEXT,
  quantity REAL,
  unit TEXT,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS product_image (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('正面','背面','细节','包装','工艺','裁片')),
  url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mold (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  product_id INTEGER REFERENCES product(id) ON DELETE SET NULL,
  image_url TEXT,
  cad_file_url TEXT,
  pdf_file_url TEXT,
  storage_location TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cutting_part (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  product_id INTEGER NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  material_id INTEGER REFERENCES material(id) ON DELETE SET NULL,
  mold_id INTEGER REFERENCES mold(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  max_length_cm REAL NOT NULL,
  max_width_cm REAL NOT NULL,
  quantity_per_product INTEGER NOT NULL DEFAULT 1,
  rotation_mode TEXT NOT NULL DEFAULT 'free' CHECK(rotation_mode IN ('free','fixed','same_direction')),
  gap_cm REAL,
  type TEXT,
  image_url TEXT,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bom_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES material(id),
  mold_id INTEGER REFERENCES mold(id) ON DELETE SET NULL,
  unit_id INTEGER NOT NULL REFERENCES unit(id),
  usage_per_product REAL NOT NULL,
  waste_rate REAL NOT NULL DEFAULT 0,
  calculation_method TEXT NOT NULL DEFAULT '数量' CHECK(calculation_method IN ('数量','长度','幅宽排料')),
  strip_width_cm REAL,
  part_length_cm REAL,
  notes TEXT,
  UNIQUE(product_id, material_id)
);

CREATE TABLE IF NOT EXISTS cutting_plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  delivery_rule_id INTEGER REFERENCES delivery_rule(id) ON DELETE SET NULL,
  material_id INTEGER NOT NULL REFERENCES material(id),
  mold_id INTEGER REFERENCES mold(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  image_url TEXT,
  pieces_per_lay REAL NOT NULL,
  cutting_length_cm REAL NOT NULL,
  cutting_mode TEXT NOT NULL DEFAULT '待确认' CHECK(cutting_mode IN ('刀模裁剪','手工裁剪','待确认')),
  cutting_method TEXT,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cutting_plan_mold (
  cutting_plan_id INTEGER NOT NULL REFERENCES cutting_plan(id) ON DELETE CASCADE,
  mold_id INTEGER NOT NULL REFERENCES mold(id) ON DELETE CASCADE,
  PRIMARY KEY (cutting_plan_id, mold_id)
);

CREATE TABLE IF NOT EXISTS delivery_rule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES material(id),
  category TEXT NOT NULL CHECK(category IN ('面料','里布','配件')),
  color TEXT,
  color_strategy TEXT,
  source_type TEXT NOT NULL DEFAULT 'manual',
  is_auto_generated INTEGER NOT NULL DEFAULT 0,
  product_accessory_id INTEGER REFERENCES product_accessory(id) ON DELETE CASCADE,
  description TEXT,
  quantity_per_product REAL,
  cutting_length_cm REAL,
  unit TEXT,
  calculation_method TEXT NOT NULL CHECK(calculation_method IN ('裁剪拉布','配件数量')),
  cutting_mode TEXT NOT NULL DEFAULT '待确认' CHECK(cutting_mode IN ('刀模裁剪','手工裁剪','待确认')),
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(product_id, material_id, color, description, calculation_method)
);

CREATE TABLE IF NOT EXISTS delivery_rule_cutting_part (
  delivery_rule_id INTEGER NOT NULL REFERENCES delivery_rule(id) ON DELETE CASCADE,
  cutting_part_id INTEGER NOT NULL REFERENCES cutting_part(id) ON DELETE CASCADE,
  PRIMARY KEY(delivery_rule_id, cutting_part_id)
);

CREATE TABLE IF NOT EXISTS delivery_rule_color_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_rule_id INTEGER NOT NULL REFERENCES delivery_rule(id) ON DELETE CASCADE,
  product_color TEXT NOT NULL,
  material_color TEXT NOT NULL,
  UNIQUE(delivery_rule_id, product_color)
);

CREATE TABLE IF NOT EXISTS purchase_order (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  product_id INTEGER NOT NULL REFERENCES product(id),
  production_quantity INTEGER NOT NULL CHECK(production_quantity > 0),
  status TEXT NOT NULL DEFAULT '草稿' CHECK(status IN ('草稿','已确认','已完成')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_order_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_order_id INTEGER NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES material(id),
  required_quantity REAL NOT NULL,
  unit_id INTEGER NOT NULL REFERENCES unit(id),
  calculation_detail TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_process (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT '车缝',
  default_duration_minutes REAL NOT NULL DEFAULT 0 CHECK(default_duration_minutes >= 0),
  default_unit_price REAL NOT NULL DEFAULT 0 CHECK(default_unit_price >= 0),
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_process (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  work_process_id INTEGER NOT NULL REFERENCES work_process(id),
  operation_part TEXT,
  quantity_per_product REAL NOT NULL DEFAULT 1 CHECK(quantity_per_product > 0),
  duration_minutes REAL NOT NULL DEFAULT 0 CHECK(duration_minutes >= 0),
  unit_price REAL NOT NULL DEFAULT 0 CHECK(unit_price >= 0),
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  version_no INTEGER NOT NULL DEFAULT 1,
  effective_date TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_product_process_product ON product_process(product_id,sort_order,id);
CREATE INDEX IF NOT EXISTS idx_product_process_master ON product_process(work_process_id);

CREATE TABLE IF NOT EXISTS customer (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  contact_name TEXT,
  phone TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS delivery_order (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  product_id INTEGER NOT NULL REFERENCES product(id),
  product_code TEXT,
  product_sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  production_quantity INTEGER NOT NULL CHECK(production_quantity > 0),
  status TEXT NOT NULL DEFAULT '草稿' CHECK(status IN ('草稿','已确认','已领料','已完成','已作废')),
  selected_fabric_rule_ids TEXT,
  warnings_json TEXT,
  notes TEXT,
  material_cost REAL NOT NULL DEFAULT 0,
  loss_rate REAL NOT NULL DEFAULT 0,
  loss_cost REAL NOT NULL DEFAULT 0,
  labor_unit_cost REAL,
  labor_cost REAL NOT NULL DEFAULT 0,
  labor_source TEXT NOT NULL DEFAULT 'manual',
  labor_process_snapshot_json TEXT,
  packaging_unit_cost REAL,
  packaging_cost REAL NOT NULL DEFAULT 0,
  cutting_cost REAL NOT NULL DEFAULT 0,
  delivery_cost REAL NOT NULL DEFAULT 0,
  other_cost REAL NOT NULL DEFAULT 0,
  total_cost REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS delivery_order_color (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_order_id INTEGER NOT NULL REFERENCES delivery_order(id) ON DELETE CASCADE,
  product_color TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0)
);

CREATE TABLE IF NOT EXISTS delivery_order_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_order_id INTEGER NOT NULL REFERENCES delivery_order(id) ON DELETE CASCADE,
  delivery_rule_id INTEGER,
  material_id INTEGER REFERENCES material(id) ON DELETE SET NULL,
  library_type TEXT NOT NULL,
  material_code TEXT,
  material_name TEXT NOT NULL,
  material_category TEXT,
  material_specification TEXT,
  material_image_url TEXT,
  material_color TEXT,
  source_plan_colors TEXT,
  unit TEXT,
  required_quantity REAL NOT NULL,
  total_pieces REAL,
  total_length_m REAL,
  roll_count INTEGER,
  unit_price REAL,
  price_unit TEXT,
  material_cost REAL,
  calculation_detail TEXT,
  cutting_mode TEXT,
  cutting_plans_json TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS packing_plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_no TEXT NOT NULL UNIQUE,
  product_id INTEGER NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  production_quantity INTEGER NOT NULL CHECK(production_quantity > 0),
  gap_cm REAL NOT NULL DEFAULT 1,
  algorithm TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '草稿',
  accessory_cost REAL NOT NULL DEFAULT 0,
  material_cost REAL NOT NULL DEFAULT 0,
  total_cost REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS packing_plan_material (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  packing_plan_id INTEGER NOT NULL REFERENCES packing_plan(id) ON DELETE CASCADE,
  material_id INTEGER REFERENCES material(id) ON DELETE SET NULL,
  material_name TEXT NOT NULL,
  material_color TEXT,
  fabric_width_cm REAL NOT NULL,
  usable_width_cm REAL NOT NULL,
  used_length_cm REAL NOT NULL,
  utilization_rate REAL NOT NULL,
  unit_price REAL,
  material_cost REAL,
  layout_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_product_sku ON product(sku);
CREATE INDEX IF NOT EXISTS idx_material_name ON material(name);
CREATE INDEX IF NOT EXISTS idx_material_price_material ON material_price(material_id,effective_date);
CREATE INDEX IF NOT EXISTS idx_bom_product ON bom_item(product_id);
CREATE INDEX IF NOT EXISTS idx_delivery_rule_product ON delivery_rule(product_id);
CREATE INDEX IF NOT EXISTS idx_cutting_plan_product ON cutting_plan(product_id);
CREATE INDEX IF NOT EXISTS idx_delivery_rule_color_map_rule ON delivery_rule_color_map(delivery_rule_id);
CREATE INDEX IF NOT EXISTS idx_delivery_rule_part_rule ON delivery_rule_cutting_part(delivery_rule_id);
CREATE INDEX IF NOT EXISTS idx_delivery_rule_part_part ON delivery_rule_cutting_part(cutting_part_id);
CREATE INDEX IF NOT EXISTS idx_product_color_product ON product_color(product_id);
CREATE INDEX IF NOT EXISTS idx_product_accessory_product ON product_accessory(product_id);
CREATE INDEX IF NOT EXISTS idx_delivery_order_product ON delivery_order(product_id,created_at);
CREATE INDEX IF NOT EXISTS idx_delivery_order_item_order ON delivery_order_item(delivery_order_id,sort_order);
CREATE INDEX IF NOT EXISTS idx_packing_plan_product ON packing_plan(product_id,created_at);
CREATE INDEX IF NOT EXISTS idx_packing_plan_material_plan ON packing_plan_material(packing_plan_id);

CREATE TABLE IF NOT EXISTS system_setting (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sample_quote (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sample_no TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  customer_sku TEXT,
  category TEXT,
  status TEXT NOT NULL DEFAULT '资料收集中' CHECK(status IN ('资料收集中','待确认','可以核价','已核价','已转正式产品')),
  quantity INTEGER NOT NULL DEFAULT 10,
  gap_cm REAL NOT NULL DEFAULT 1,
  loss_rate REAL NOT NULL DEFAULT 1,
  draft_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT,
  total_cost REAL,
  unit_cost REAL,
  formal_product_id INTEGER REFERENCES product(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sample_quote_message (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sample_quote_id INTEGER NOT NULL REFERENCES sample_quote(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sample_quote_image (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sample_quote_id INTEGER NOT NULL REFERENCES sample_quote(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sample_quote_attachment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sample_quote_id INTEGER NOT NULL REFERENCES sample_quote(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  url TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sample_quote_status ON sample_quote(status,updated_at);
CREATE INDEX IF NOT EXISTS idx_sample_quote_message_quote ON sample_quote_message(sample_quote_id,id);
CREATE INDEX IF NOT EXISTS idx_sample_quote_attachment_quote ON sample_quote_attachment(sample_quote_id,id);

CREATE TABLE IF NOT EXISTS quotation (
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
CREATE INDEX IF NOT EXISTS idx_quotation_sample ON quotation(sample_quote_id,created_at);

CREATE TABLE IF NOT EXISTS quotation_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quotation_id INTEGER NOT NULL REFERENCES quotation(id) ON DELETE CASCADE,
  sample_quote_id INTEGER REFERENCES sample_quote(id) ON DELETE SET NULL,
  sample_no TEXT, customer_sku TEXT, product_name TEXT NOT NULL, product_name_foreign TEXT,
  image_url TEXT, show_image INTEGER NOT NULL DEFAULT 1, color TEXT, dimensions TEXT,
  special_process TEXT, quantity REAL NOT NULL DEFAULT 1, unit TEXT NOT NULL DEFAULT '个',
  unit_price REAL NOT NULL DEFAULT 0, discount_rate REAL NOT NULL DEFAULT 0,
  delivery_days INTEGER, packaging TEXT, notes TEXT, notes_foreign TEXT, cost_snapshot_json TEXT NOT NULL DEFAULT '{}',
  price_tiers_json TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS quotation_fee (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quotation_id INTEGER NOT NULL REFERENCES quotation(id) ON DELETE CASCADE,
  name TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS quotation_term (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quotation_id INTEGER NOT NULL REFERENCES quotation(id) ON DELETE CASCADE,
  label TEXT NOT NULL, content TEXT, content_foreign TEXT, enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_quotation_item_quote ON quotation_item(quotation_id,sort_order);

CREATE TABLE IF NOT EXISTS agent_api_token (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT,
  revoked_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_session (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'web',
  client_name TEXT,
  title TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_message (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES agent_session(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','tool')),
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_change_draft (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES agent_session(id) ON DELETE SET NULL,
  change_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  preview_json TEXT NOT NULL,
  base_versions_json TEXT NOT NULL DEFAULT '{}',
  preview_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','committed','expired','cancelled')),
  expires_at TEXT NOT NULL,
  confirmation_text TEXT,
  committed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_tool_call (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  token_id INTEGER REFERENCES agent_api_token(id) ON DELETE SET NULL,
  session_id TEXT REFERENCES agent_session(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  arguments_summary TEXT,
  result_status TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_token_user ON agent_api_token(user_id,revoked_at);
CREATE INDEX IF NOT EXISTS idx_agent_session_user ON agent_session(user_id,updated_at);
CREATE INDEX IF NOT EXISTS idx_agent_message_session ON agent_message(session_id,id);
CREATE INDEX IF NOT EXISTS idx_agent_draft_user ON agent_change_draft(user_id,status,expires_at);
CREATE INDEX IF NOT EXISTS idx_agent_tool_call_user ON agent_tool_call(user_id,id);
