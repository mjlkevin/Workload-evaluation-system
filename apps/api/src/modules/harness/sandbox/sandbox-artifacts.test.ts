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
test('Office text nodes cannot contain nested elements that readers silently omit', async () => {
  const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const wrap = (text: string) => `<w:document xmlns:w="${word}"><w:body><w:p><w:r>${text}</w:r></w:p></w:body></w:document>`;
  const valid = await office('docx', { 'word/document.xml': wrap('<w:t>角色：仓库管理员</w:t>') });
  assert.ok(await validateSandboxArtifact('report.docx', 'docx', valid));
  for (const text of ['<w:t><w:t>角色：仓库管理员</w:t></w:t>', '<w:t><w:br/></w:t>']) {
    await assert.rejects(validateSandboxArtifact('report.docx', 'docx', await office('docx', { 'word/document.xml': wrap(text) })));
  }
  const sheet = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t><t>正文</t></t></is></c></row></sheetData></worksheet>';
  await assert.rejects(validateSandboxArtifact('report.xlsx', 'xlsx', await office('xlsx', { 'xl/worksheets/sheet1.xml': sheet })));
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
test('XML parser rejects depth, attribute, namespace and aggregate node resource attacks', async () => {
  const root = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>', end = '</w:body></w:document>';
  const bad = [
    root + '<w:p>'.repeat(129) + '</w:p>'.repeat(129) + end,
    root + '<w:p ' + Array.from({ length: 65 }, (_, i) => `a${i}="v"`).join(' ') + '/>' + end,
    root + Array.from({ length: 260 }, (_, i) => `<w:p xmlns:n${i}="urn:${i}"/>`).join('') + end,
  ];
  for (const document of bad) await assert.rejects(validateSandboxArtifact('x.docx', 'docx', await office('docx', { 'word/document.xml': document })));
  const many = (seed: number, count: number) => '<root>' + Array.from({ length: count }, (_, i) => `<p a="${seed + i}"/>`).join('') + '</root>';
  // Neither XML entry alone exhausts the package node budget.
  await assert.rejects(validateSandboxArtifact('x.docx', 'docx', await office('docx', { 'word/part1.xml': many(0, 50000), 'word/part2.xml': many(50000, 50000) })));
});
test('HTML rejects active navigation independently of CSP, preserving fragment references', async () => {
  const wrap = (head: string, body = '') => Buffer.from(`<html><head>${head}</head><body>${body}</body></html>`);
  for (const [head, body] of [
    ['<meta http-equiv="refresh" content="0;url=https://bad.example">', ''],
    ['<META HTTP-EQUIV = ReFrEsH content="0; url=https://bad.example">', ''],
    ['<meta http-equiv="&#114;efresh" content="0;url=https://bad.example">', ''],
    ['<base href="https://bad.example">', ''],
    ['', '<a href="https://bad.example">go</a>'],
    ['', '<a href="&#104;ttps://bad.example">go</a>'],
    ['', '<form action="https://bad.example"><button>send</button></form>'],
    ['', '<svg><a xlink:href="https://bad.example">go</a></svg>'],
    ['', '<svg><style><meta http-equiv="refresh" content="0;url=https://bad.example"></style></svg>'],
  ]) await assert.rejects(validateSandboxArtifact('x.html', 'html', wrap(head, body)));
  assert.ok(await validateSandboxArtifact('x.html', 'html', wrap('<meta charset="utf-8">', '<a href="#section">jump</a><p id="section">正文</p>')));
});
test('HTML rejects abrupt or malformed comments that browsers close before hidden navigation', async () => {
  for (const head of [
    '<!--><meta http-equiv="refresh" content="0;url=https://bad.example"><!-- -->',
    '<!---><meta http-equiv="refresh" content="0;url=https://bad.example"><!-- -->',
    '<!-- safe --!><meta http-equiv="refresh" content="0;url=https://bad.example"><!-- -->',
    '<!-- nested <!--><meta http-equiv="refresh" content="0;url=https://bad.example"><!-- -->',
    '<!-- internal -- comment -->',
  ]) await assert.rejects(validateSandboxArtifact('x.html', 'html', Buffer.from(`<html><head>${head}</head><body>report</body></html>`)));
  assert.ok(await validateSandboxArtifact('x.html', 'html', Buffer.from('<html><head><!-- Report title --><title>Report</title></head><body><!-- 正文 -->report</body></html>')));
});
test('HTML rejects noncanonical raw-text end tags rather than hiding following navigation', async () => {
  for (const name of ['title', 'style', 'script', 'textarea']) for (const ending of [`</${name} ignored>`, `</${name}/>`, `</${name}\tignored>`]) {
    const html = `<html><head><${name}>text${ending}<meta http-equiv="refresh" content="0;url=https://bad.example"></${name}></head><body>report</body></html>`;
    await assert.rejects(validateSandboxArtifact('x.html', 'html', Buffer.from(html)));
  }
});
test('unsupported raw-text contexts cannot disguise navigation through nested styles', async () => {
  for (const name of ['noscript', 'xmp', 'noembed', 'noframes']) {
    const html = `<html><head></head><body><${name}><style></${name}><meta http-equiv="refresh" content="0;url=https://bad.example"></style></${name}></body></html>`;
    await assert.rejects(validateSandboxArtifact('x.html', 'html', Buffer.from(html)));
  }
});
test('Unicode whitespace never changes a non-raw browser tag into a scanner raw-text element', async () => {
  for (const space of ['\u00a0', '\u000b', '\u2003', '\u2028']) {
    const html = `<html><head><style${space}><meta http-equiv="refresh" content="0;url=https://bad.example"></style></head><body>report</body></html>`;
    await assert.rejects(validateSandboxArtifact('x.html', 'html', Buffer.from(html)));
  }
});
test('canonical HTML tree must retain explicit structural sections and forbid active nodes', async () => {
  // HTML ignores the textarea token in a select; the scanner would otherwise
  // mistake the following live refresh element for inert textarea contents.
  const html = '<html><head></head><body><select><style><meta http-equiv="refresh" content="0;url=https://bad.example"></style></select></body></html>';
  await assert.rejects(validateSandboxArtifact('x.html', 'html', Buffer.from(html)));
});
test('HTML parser has pre-parse marker and canonical traversal resource budgets', async () => {
  const html = '<html><head></head><body>' + '<p>x</p>'.repeat(10001) + '</body></html>';
  await assert.rejects(validateSandboxArtifact('x.html', 'html', Buffer.from(html)));
  // Fewer than 20k source markers, but text/comment siblings exceed the DOM
  // node budget after the standard parser constructs the canonical tree.
  const nodes = '<html><head></head><body>' + 'x<!-- note -->'.repeat(10001) + '</body></html>';
  await assert.rejects(validateSandboxArtifact('x.html', 'html', Buffer.from(nodes)));
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
