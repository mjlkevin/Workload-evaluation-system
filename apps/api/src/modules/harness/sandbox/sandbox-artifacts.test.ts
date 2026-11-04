import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import JSZip from 'jszip';
import { LocalSandboxArtifactStore, validateSandboxArtifact, SANDBOX_HTML_CSP } from './sandbox-artifacts';

async function office(format: 'docx' | 'xlsx', extra: Record<string, string> = {}) {
  const zip = new JSZip(); const main = format === 'docx' ? 'word/document.xml' : 'xl/workbook.xml';
  const type = format === 'docx' ? 'wordprocessingml.document' : 'spreadsheetml.sheet';
  zip.file('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/${main}" ContentType="application/vnd.openxmlformats-officedocument.${type}.main+xml"/>${format === 'xlsx' ? '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' : ''}</Types>`);
  zip.file('_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${main}"/></Relationships>`);
  zip.file(main, format === 'docx' ? '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>' : '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>');
  if (format === 'xlsx') { zip.file('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'); zip.file('xl/worksheets/sheet1.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>'); }
  for (const [name, value] of Object.entries(extra)) zip.file(name, value);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
test('valid HTML and genuine Office packages return actual byte hashes and MIME', async () => {
  for (const format of ['html', 'docx', 'xlsx'] as const) {
    const bytes = format === 'html' ? Buffer.from('<!doctype html><html><head><title>报告</title></head><body>正文</body></html>') : await office(format);
    const result = await validateSandboxArtifact(`report.${format}`, format, bytes);
    assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex')); assert.equal(result.size, bytes.length); assert.ok(result.mimeType.includes(format === 'html' ? 'text/html' : 'officedocument'));
  }
  for (const policy of ["default-src 'none'", "script-src 'none'", "form-action 'none'", "connect-src 'none'", "base-uri 'none'", 'sandbox']) assert.ok(SANDBOX_HTML_CSP.includes(policy));
});
test('artifact path, extension, empty document and file bound checks fail closed', async () => {
  for (const [path, bytes] of [['../report.html', Buffer.from('<html></html>')], ['report.docx', Buffer.from('x')], ['report.html', Buffer.from('fragment')], ['report.html', Buffer.alloc(20 * 1024 * 1024 + 1)]] as const) await assert.rejects(validateSandboxArtifact(path, 'html', bytes));
});
test('Office rejects missing structure, external relationships, macros, embeddings and formulas', async () => {
  const bad: Array<Record<string, string>> = [ { 'word/vbaProject.bin': 'payload' }, { 'word/embeddings/object.bin': 'payload' }, { 'word/_rels/document.xml.rels': '<Relationships><Relationship TargetMode="External" Target="https://bad.example"/></Relationships>' }, { 'word/document.xml': '<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><w:document>&x;</w:document>' }, { '_rels/.rels': '<Relationships/>' }, { 'word/document.xml': '<w:document><w:altChunk/></w:document>' } ];
  for (const extra of bad) await assert.rejects(validateSandboxArtifact('x.docx', 'docx', await office('docx', extra)));
  await assert.rejects(validateSandboxArtifact('x.xlsx', 'xlsx', await office('xlsx', { 'xl/worksheets/sheet1.xml': '<worksheet><sheetData><c><f>WEBSERVICE("https://bad")</f></c></sheetData></worksheet>' })));
  const zip = new JSZip(); zip.file('fake.txt', 'not office'); await assert.rejects(validateSandboxArtifact('x.docx', 'docx', await zip.generateAsync({ type: 'nodebuffer' })));
});
test('ZIP bombs and archive path escapes are rejected before inflating', async () => {
  await assert.rejects(validateSandboxArtifact('x.docx', 'docx', await office('docx', { 'word/bomb.xml': 'a'.repeat(51 * 1024 * 1024) })));
  await assert.rejects(validateSandboxArtifact('x.docx', 'docx', await office('docx', { '../escape.xml': '<x/>' })));
});
test('OOXML rejects false namespaces, missing document body and hidden workbook formulas', async () => {
  for (const document of ['<w:document xmlns:w="urn:fake"><w:body/></w:document>', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>']) await assert.rejects(validateSandboxArtifact('x.docx', 'docx', await office('docx', { 'word/document.xml': document })));
  await assert.rejects(validateSandboxArtifact('x.xlsx', 'xlsx', await office('xlsx', { 'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><definedNames><definedName name="danger">WEBSERVICE("https://bad")</definedName></definedNames><sheets><sheet name="s" sheetId="1" r:id="rId1"/></sheets></workbook>' })));
});
test('unused genuine namespace declarations cannot disguise fake document or body bindings', async () => {
  const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  for (const document of [
    `<w:document xmlns:w="urn:fake" xmlns:unused="${word}"><w:body/></w:document>`,
    `<w:document xmlns:w="${word}"><w:body xmlns:w="urn:fake"/></w:document>`,
    `<document xmlns="urn:fake" xmlns:unused="${word}"><body/></document>`,
    `<document xmlns="${word}"><body xmlns="urn:fake"/></document>`,
  ]) await assert.rejects(validateSandboxArtifact('x.docx', 'docx', await office('docx', { 'word/document.xml': document })));
  const valid = `<doc:document xmlns:doc="${word}"><doc:body/></doc:document>`;
  assert.ok(await validateSandboxArtifact('x.docx', 'docx', await office('docx', { 'word/document.xml': valid })));
});
test('every OOXML part requires its declared package content type', async () => {
  for (const missing of ['worksheet', 'relationships']) {
    const zip = await JSZip.loadAsync(await office('xlsx'));
    const types = await zip.file('[Content_Types].xml')!.async('string');
    zip.file('[Content_Types].xml', missing === 'worksheet' ? types.replace(/<Override PartName="\/xl\/worksheets\/sheet1.xml"[^>]*\/>/, '') : types.replace(/<Default Extension="rels"[^>]*\/>/, ''));
    await assert.rejects(validateSandboxArtifact('x.xlsx', 'xlsx', await zip.generateAsync({ type: 'nodebuffer' })));
  }
});
test('HTML acceptance follows raw-text elements and requires actual closed head and body', async () => {
  for (const html of ['<html><head><title>broken</head><body>report</body></html>', '<html><head><style>broken</head><body>report</body></html>', '<html><head></head><body><div>unclosed</body></html>']) await assert.rejects(validateSandboxArtifact('x.html', 'html', Buffer.from(html)));
  assert.ok(await validateSandboxArtifact('x.html', 'html', Buffer.from('<!doctype html><html><head><meta charset="utf-8"><style>p::before{content:"<body>"}</style><title>Report</title></head><body><p>正文<br>第二行</p></body></html>')));
});
test('private store roundtrip is atomic, UUID-only, bounded and refuses symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wes-artifacts-')); const store = new LocalSandboxArtifactStore(root); const id = randomUUID();
  try {
    await store.write(id, Buffer.from('first')); assert.equal((await store.read(id)).toString(), 'first');
    assert.equal((await stat(join(root, id))).mode & 0o777, 0o600);
    await store.write(id, Buffer.from('second')); assert.equal((await store.read(id)).toString(), 'second');
    await assert.rejects(store.write('../escape', Buffer.from('x'))); await assert.rejects(store.read('../escape')); await assert.rejects(store.remove('../escape'));
    await assert.rejects(store.write(randomUUID(), Buffer.alloc(20 * 1024 * 1024 + 1)));
    const other = randomUUID(); await writeFile(join(root, 'outside'), 'secret'); await symlink(join(root, 'outside'), join(root, other)); await assert.rejects(store.read(other));
    await store.remove(id); await assert.rejects(store.read(id));
  } finally { await rm(root, { recursive: true, force: true }); }
});
