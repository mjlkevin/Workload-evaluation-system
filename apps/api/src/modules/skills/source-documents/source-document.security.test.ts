import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { parseSourceDocument, validatedSourceResult } from './source-document';

async function maliciousComments(): Promise<Buffer> {
  const book = XLSX.utils.book_new(), sheet = XLSX.utils.aoa_to_sheet([['original cell']]);
  sheet.A1.c = [{ a: 'fixture', t: 'pollution fixture' }];
  XLSX.utils.book_append_sheet(book, sheet, 'Source');
  const zip = await JSZip.loadAsync(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
  const path = Object.keys(zip.files).find(name => /^xl\/comments\d+\.xml$/.test(name))!;
  assert.ok(path);
  zip.file(path, (await zip.file(path)!.async('string')).replace('ref="A1"', 'ref="__proto__"'));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

test('actual malicious XLSX comments cannot pollute the API parent realm', async () => {
  const bytes = await maliciousComments();
  // Run the vulnerable entry in a disposable process even during RED, protecting the test runner.
  const script = `(async () => {
    const { parseSourceDocument } = require(${JSON.stringify(require.resolve('./source-document'))});
    try { await parseSourceDocument({ bytes: Buffer.from(${JSON.stringify(bytes.toString('base64'))}, 'base64'), name: 'attack.xlsx', mime: '' }); } catch {}
    process.stdout.write(JSON.stringify({ polluted: Object.prototype.hasOwnProperty.call(Object.prototype, 'c') }));
  })().catch(() => process.exit(2));`;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '-e', script], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { polluted: false });
  assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'c'), false);
});

test('parser deadline kills expensive work outside the event loop', async () => {
  const zip = new JSZip();
  // Each XML declaration prefix makes the legacy encoding scan backtrack over the remaining entry.
  zip.file('[Content_Types].xml', ('<?xml' + 'x'.repeat(64)).repeat(25000));
  zip.file('xl/workbook.xml', '<workbook/>');
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  let eventLoopTick = false;
  const tick = setTimeout(() => { eventLoopTick = true; }, 20);
  const started = Date.now();
  await assert.rejects(parseSourceDocument({ bytes, name: 'deadline.xlsx', mime: '' }, 400),
    (error: any) => error.code === 'SOURCE_DOCUMENT_TOO_LARGE');
  clearTimeout(tick);
  assert.equal(eventLoopTick, true);
  assert.ok(Date.now() - started < 3000);
});

test('untrusted parser replies cannot inject fields, fake coordinates, duplicates or mismatched canonical text', () => {
  const file = { bytes: Buffer.from('fixture'), name: 'source.xlsx', mime: '' };
  const valid = { canonicalText: '[Source!A1] original', cells: [{ sheet: 'Source', cell: 'A1', text: 'original' }] };
  assert.equal(validatedSourceResult(valid, file).canonicalText, valid.canonicalText);
  for (const cells of [
    [{ ...valid.cells[0], extra: 'untrusted' }], [{ ...valid.cells[0], cell: '__proto__' }],
    [{ ...valid.cells[0], cell: 'XFE1' }], [{ ...valid.cells[0], cell: 'A1048577' }],
    [{ ...valid.cells[0], text: {} }], [...valid.cells, ...valid.cells],
  ]) assert.throws(() => validatedSourceResult({ ...valid, cells }, file));
  assert.throws(() => validatedSourceResult({ ...valid, canonicalText: 'forged' }, file));
});
