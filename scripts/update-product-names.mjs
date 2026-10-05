import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const databasePath = path.resolve('server/bpms.db');
const backupDirectory = path.resolve('server/backups');
const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const backupPath = path.join(backupDirectory, `bpms-before-product-names-${timestamp}.db`);

// 名称依据产品图、裁片结构、包带方式及配件综合确定。
const productNames = {
  '1001': '拉链手提托特包',
  '1001PIUS': '加大拉链手提托特包',
  '1017': '拉链纽扣两用托特包',
  '1022': '前袋手提托特包',
  '1026': '撞色手提托特包',
  '1028': '木扣翻盖斜挎包',
  '1034': '拼色斜挎托特包',
  '1041': '迷你纽扣斜挎包',
  '1046': '小号月牙斜挎包',
  '1048': '大号月牙斜挎包',
  '1049': '大容量斜挎旅行包',
  '1082': '小号手提斜挎包',
  '1086': '大容量手提托特包',
  '1089': '拼色手提托特包',
  '1097': '撞色细带斜挎包',
  '2016': '多口袋手提托特包',
  '2020': '宽肩带半月包',
  '2031': '手提斜挎托特包',
  '2033': '迷你翻盖斜挎包',
  '2036': '迷你水桶斜挎包',
  '2037': '手提斜挎方形托特包',
  '2039': '皮提手大容量托特包',
  '2041': '手提拉链托特包',
  '2043': '翻盖方形斜挎包',
  '2044': '圆弧手提饺子包',
  '2046': '皮提手小号托特包',
  '2048': '迷你圆角斜挎包',
  '2050': '大容量斜挎托特包',
};

fs.mkdirSync(backupDirectory, { recursive: true });
fs.copyFileSync(databasePath, backupPath);

const db = new DatabaseSync(databasePath);
const updateProduct = db.prepare(
  "UPDATE product SET name=?,updated_at=CURRENT_TIMESTAMP WHERE sku=? AND name LIKE '待完善产品%'",
);

let updated = 0;
const skipped = [];
db.exec('BEGIN IMMEDIATE;');
try {
  for (const [sku, name] of Object.entries(productNames)) {
    const result = updateProduct.run(name, sku);
    if (Number(result.changes) === 1) updated += 1;
    else skipped.push(sku);
  }
  db.exec('COMMIT;');
} catch (error) {
  db.exec('ROLLBACK;');
  throw error;
} finally {
  db.close();
}

console.log(JSON.stringify({ backupPath, updated, skipped }, null, 2));
