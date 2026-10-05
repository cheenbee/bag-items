import path from 'node:path';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

const compact = value => String(value || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 60000);

async function extractPdf(buffer) {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try { return compact((await parser.getText()).text); }
  finally { await parser.destroy(); }
}

function extractSpreadsheet(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  return compact(workbook.SheetNames.map(name => `【工作表：${name}】\n${XLSX.utils.sheet_to_csv(workbook.Sheets[name], { blankrows: false })}`).join('\n\n'));
}

export async function extractAttachmentText({ buffer, mimeType, name }) {
  const extension = path.extname(String(name || '')).toLowerCase();
  let text = '';
  if (mimeType === 'application/pdf' || extension === '.pdf') text = await extractPdf(buffer);
  else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || extension === '.docx') text = compact((await mammoth.extractRawText({ buffer })).value);
  else if (['.xlsx', '.xls', '.csv'].includes(extension) || /spreadsheet|excel|csv/.test(mimeType)) text = extractSpreadsheet(buffer);
  else if (mimeType.startsWith('text/') || ['.txt', '.csv'].includes(extension)) text = compact(buffer.toString('utf8'));
  return { text, status: text ? 'recognized' : 'no_text', summary: text ? `已识别 ${text.length} 个字符` : '未识别到可用于核价的文字' };
}
