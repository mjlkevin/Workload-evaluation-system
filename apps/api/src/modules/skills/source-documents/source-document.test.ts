import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { parseSourceDocument } from './source-document';

const excelMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
function workbook() {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['  原始需求\n不得用摘要代替  ', '需'.repeat(9001)], [123.456789, false],
  ]), '业务需求');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['第二页原文']]), '方案');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
const parse = (bytes: Buffer, name = 'requirements.xlsx') => parseSourceDocument({ bytes, name, mime: excelMime });
const rejected = (code: string) => (error: any) => error.code === code;

test('actual XLSX cells retain exact complete values, real sheet/cell anchors and original byte digest', async () => {
  const bytes = workbook(); const document = await parse(bytes);
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.byteDigest, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(document.size, bytes.length);
  assert.equal(document.name, 'requirements.xlsx');
  assert.deepEqual(document.cells, [
    { sheet: '业务需求', cell: 'A1', text: '  原始需求\n不得用摘要代替  ' },
    { sheet: '业务需求', cell: 'B1', text: '需'.repeat(9001) },
    { sheet: '业务需求', cell: 'A2', text: '123.456789' },
    { sheet: '业务需求', cell: 'B2', text: 'false' },
    { sheet: '方案', cell: 'A1', text: '第二页原文' },
  ]);
  assert.equal(document.canonicalText, document.cells!.map(c => `[${c.sheet}!${c.cell}] ${c.text}`).join('\n'));
  assert.equal(document.canonicalText.includes('[truncated]'), false);
});

test('UTF8 text and Markdown preserve the complete original text under the same digest contract', async () => {
  for (const name of ['requirement.txt', 'requirement.md']) {
    const text = '  # 真实需求\r\n用户需要保留原文\n  '; const bytes = Buffer.from(text);
    const document = await parseSourceDocument({ bytes, name, mime: 'text/plain' });
    assert.equal(document.canonicalText, text);
    assert.equal(document.byteDigest, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(document.cells, undefined);
  }
});

test('unsupported names, empty/malformed UTF8, byte overflow and text overflow reject without truncation', async () => {
  for (const name of ['fake.xlsm', 'file.pdf', '../file.txt', 'https://host/file.txt', 'C:\\file.txt'])
    await assert.rejects(() => parse(Buffer.from('text'), name), rejected('SOURCE_DOCUMENT_INVALID'));
  for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from(' \n '), Buffer.from('a\0b')])
    await assert.rejects(() => parse(bytes, 'file.txt'), rejected('SOURCE_DOCUMENT_INVALID'));
  await assert.rejects(() => parse(Buffer.alloc(2 * 1024 * 1024 + 1), 'big.txt'), rejected('SOURCE_DOCUMENT_TOO_LARGE'));
  await assert.rejects(() => parse(Buffer.from('a'.repeat(200001)), 'big.md'), rejected('SOURCE_DOCUMENT_TOO_LARGE'));
  await assert.rejects(() => parse(Buffer.from('pretending to be Excel')), rejected('SOURCE_DOCUMENT_INVALID'));
});

test('macro parts, external relationships and XML entity declarations reject before workbook parsing', async () => {
  for (const [path, content] of [
    ['xl/vbaProject.bin', 'macro'],
    ['xl/externalLinks/externalLink1.xml', '<externalLink/>'],
    ['xl/worksheets/_rels/sheet1.xml.rels', '<Relationships><Relationship TargetMode="External" Target="https://host"/></Relationships>'],
    ['xl/worksheets/_rels/sheet1.xml.rels', '<Relationships><Relationship TargetMode="Extern&#97;l" Target="https://host"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', '<!DOCTYPE worksheet [<!ENTITY x "payload">]><worksheet>&x;</worksheet>'],
    ['xl/worksheets/sheet1.xml', '<?xml version="1.0" encoding="UTF-16"?><worksheet/>'],
  ]) {
    const zip = await JSZip.loadAsync(workbook()); zip.file(path, content);
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    await assert.rejects(() => parse(bytes), rejected('SOURCE_DOCUMENT_INVALID'));
  }
});

test('ZIP entry budgets and dishonest compressed entries cannot bypass bounded inflation', async () => {
  const oversized = new JSZip(); oversized.file('xl/worksheets/sheet1.xml', 'a'.repeat(3 * 1024 * 1024));
  const bytes = await oversized.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  await assert.rejects(() => parse(bytes), rejected('SOURCE_DOCUMENT_TOO_LARGE'));
  // A forged small central/local size must still be rejected by the inflater output ceiling.
  const dishonest = Buffer.from(bytes);
  for (let i = 0; i <= dishonest.length - 46; i++) {
    if (dishonest.readUInt32LE(i) === 0x02014b50) dishonest.writeUInt32LE(8, i + 24);
    if (dishonest.readUInt32LE(i) === 0x04034b50) dishonest.writeUInt32LE(8, i + 22);
  }
  await assert.rejects(() => parse(dishonest));
  const tooMany = new JSZip();
  for (let i = 0; i < 257; i++) tooMany.file(`item-${i}.xml`, 'x');
  const manyBytes = await tooMany.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(() => parse(manyBytes), rejected('SOURCE_DOCUMENT_TOO_LARGE'));
});

test('archive corruption, CRC mismatch and UTF16 XML fail closed', async () => {
  const valid = workbook(); await assert.rejects(() => parse(valid.subarray(0, valid.length - 12)), rejected('SOURCE_DOCUMENT_INVALID'));
  const wrongCrc = Buffer.from(valid);
  for (let i = 0; i <= wrongCrc.length - 46; i++) {
    if (wrongCrc.readUInt32LE(i) === 0x02014b50) wrongCrc.writeUInt32LE(0, i + 16);
    if (wrongCrc.readUInt32LE(i) === 0x04034b50) wrongCrc.writeUInt32LE(0, i + 14);
  }
  await assert.rejects(() => parse(wrongCrc), rejected('SOURCE_DOCUMENT_INVALID'));
  const zip = await JSZip.loadAsync(valid);
  zip.file('xl/worksheets/sheet1.xml', Buffer.from('<!DOCTYPE worksheet><worksheet/>', 'utf16le'));
  const encoded = await zip.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(() => parse(encoded), rejected('SOURCE_DOCUMENT_INVALID'));
});
