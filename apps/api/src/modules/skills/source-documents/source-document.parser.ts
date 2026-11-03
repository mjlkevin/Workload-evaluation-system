import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import { sourceInvalid, sourceUtf8, validateSourceZip } from './source-document.zip';
import type { SourceFile, SourceCell, SourceDocument } from './source-document';

export function parseSourceInWorker(file: SourceFile): SourceDocument {
  if (!Buffer.isBuffer(file.bytes) || !file.bytes.length || typeof file.name !== 'string'
    || file.name.length > 255 || /[\x00-\x1f/\\:]/.test(file.name) || file.name === '.' || file.name === '..') sourceInvalid();
  if (file.bytes.length > 2 * 1024 * 1024) sourceInvalid(true);
  const extension = /\.(xlsx|txt|md)$/i.exec(file.name)?.[1]?.toLowerCase();
  if (!extension) sourceInvalid();
  let canonicalText: string, cells: SourceCell[] | undefined;
  if (extension !== 'xlsx') canonicalText = sourceUtf8(file.bytes);
  else {
    validateSourceZip(file.bytes);
    let book: XLSX.WorkBook;
    try { book = XLSX.read(file.bytes, { type: 'buffer', cellText: false, cellFormula: true, cellHTML: false, cellNF: false, bookVBA: false }); }
    catch { return sourceInvalid(); }
    cells = []; let length = 0;
    for (const sheetName of book.SheetNames) {
      const sheet = book.Sheets[sheetName];
      const addresses = Object.keys(sheet).filter(key => /^[A-Z]+[1-9][0-9]*$/.test(key))
        .sort((a, b) => { const aa = XLSX.utils.decode_cell(a), bb = XLSX.utils.decode_cell(b); return aa.r - bb.r || aa.c - bb.c; });
      for (const address of addresses) {
        const cell = sheet[address] as XLSX.CellObject;
        if (cell.f && cell.v === undefined) sourceInvalid();
        if (cell.v === undefined || cell.v === null || cell.t === 'z') continue;
        const text = cell.t === 'e' ? (cell.w ?? XLSX.utils.format_cell(cell)) : String(cell.v);
        length += `[${sheetName}!${address}] ${text}`.length + (cells.length ? 1 : 0);
        if (length > 200000 || cells.length >= 50000) sourceInvalid(true);
        cells.push({ sheet: sheetName, cell: address, text });
      }
    }
    canonicalText = cells.map(cell => `[${cell.sheet}!${cell.cell}] ${cell.text}`).join('\n');
  }
  if (!canonicalText.trim()) sourceInvalid();
  if (canonicalText.length > 200000) sourceInvalid(true);
  return { schemaVersion: 1, byteDigest: createHash('sha256').update(file.bytes).digest('hex'), canonicalText,
    name: file.name, mime: extension === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : extension === 'md' ? 'text/markdown' : 'text/plain',
    size: file.bytes.length, ...(cells ? { cells } : {}) };
}
