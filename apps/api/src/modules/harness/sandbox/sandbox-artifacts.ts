import { constants } from 'node:fs';
import { mkdir, lstat, open, realpath, rename, unlink, chmod } from 'node:fs/promises';
import { join, resolve, posix } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { assertSandboxRelativePath, SANDBOX_MAX_FILE_BYTES, SANDBOX_UUID } from '../../../services/sandbox/sandbox-provider';

export const SANDBOX_HTML_CSP = "default-src 'none'; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'self'; style-src 'unsafe-inline'; img-src data:; sandbox";
const MAX_INFLATED = 50 * 1024 * 1024;
const fail = (): never => { throw new Error('SANDBOX_ARTIFACT_INVALID'); };
const utf8 = (bytes: Buffer) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const MIMES = { html: 'text/html; charset=utf-8', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

// Inspect central-directory bounds BEFORE decompression. Inflate itself is also
// bounded: a forged uncompressed-size field cannot bypass the memory ceiling.
function unzip(bytes: Buffer): Map<string, Buffer> {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) fail();
  const count = bytes.readUInt16LE(end + 10), centralSize = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  if (!count || count > 512 || count !== bytes.readUInt16LE(end + 8) || start + centralSize !== end) fail();
  const entries: Array<{ name: string; offset: number; packed: number; size: number; crc: number; method: number; flags: number }> = [];
  const names = new Set<string>(); let cursor = start; let total = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) fail();
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), packed = bytes.readUInt32LE(cursor + 20), size = bytes.readUInt32LE(cursor + 24), nameLen = bytes.readUInt16LE(cursor + 28), extraLen = bytes.readUInt16LE(cursor + 30), commentLen = bytes.readUInt16LE(cursor + 32);
    const mode = bytes.readUInt32LE(cursor + 38) >>> 16;
    if (cursor + 46 + nameLen + extraLen + commentLen > end || flags & 1 || ![0, 8].includes(method) || (mode & 0o170000) === 0o120000 || bytes.readUInt16LE(cursor + 34)) fail();
    const name = utf8(bytes.subarray(cursor + 46, cursor + 46 + nameLen));
    if (name.includes('\\') || name.startsWith('/') || name.split('/').some(p => p === '..' || p === '.') || /[\x00-\x1f:]/.test(name) || names.has(name.toLowerCase()) || !name) fail();
    names.add(name.toLowerCase()); total += size;
    if (total > MAX_INFLATED || size > MAX_INFLATED || size > Math.max(1, packed) * 200 || [packed, size].includes(0xffffffff)) fail();
    entries.push({ name, packed, size, offset: bytes.readUInt32LE(cursor + 42), method, flags, crc: bytes.readUInt32LE(cursor + 16) });
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  if (cursor !== end) fail();
  const files = new Map<string, Buffer>();
  for (const entry of entries) {
    const p = entry.offset;
    if (p + 30 > start || bytes.readUInt32LE(p) !== 0x04034b50 || bytes.readUInt16LE(p + 8) !== entry.method || bytes.readUInt16LE(p + 6) !== entry.flags) fail();
    const nameLen = bytes.readUInt16LE(p + 26), extraLen = bytes.readUInt16LE(p + 28), begin = p + 30 + nameLen + extraLen;
    if (begin + entry.packed > start || utf8(bytes.subarray(p + 30, p + 30 + nameLen)) !== entry.name) fail();
    const compressed = bytes.subarray(begin, begin + entry.packed);
    const content = entry.method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.size) });
    if (content.length !== entry.size || crc32(content) !== entry.crc) fail();
    if (!entry.name.endsWith('/')) files.set(entry.name, content);
  }
  return files;
}
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}

interface XmlTag { name: string; attrs: Record<string, string> }
function xmlEntities(value: string): string {
  return value.replace(/&([^;]*);/g, (_, entity: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (named[entity] !== undefined) return named[entity];
    if (!/^#(?:[0-9]+|x[0-9a-f]+)$/i.test(entity)) return fail();
    const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (!Number.isInteger(n) || n < 32 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return fail();
    return String.fromCodePoint(n);
  });
}
function parseXml(bytes: Buffer): XmlTag[] {
  const text = utf8(bytes).replace(/^\uFEFF/, '').replace(/^\s*<\?xml\s[^?]*\?>/, '');
  if (/<!|<\?/.test(text) || /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-f]+;)/i.test(text)) fail();
  const stack: string[] = [], tags: XmlTag[] = []; let previous = 0; let roots = 0;
  const token = /<([^<>]+)>/g; let match: RegExpExecArray | null;
  while ((match = token.exec(text))) {
    const between = text.slice(previous, match.index); if (between.includes('<') || (!stack.length && between.trim())) fail();
    const body = match[1]; previous = token.lastIndex;
    if (body.startsWith('/')) { if (!/^\/[A-Za-z_][\w:.-]*\s*$/.test(body) || stack.pop() !== body.slice(1).trim()) fail(); continue; }
    const start = /^([A-Za-z_][\w:.-]*)([\s\S]*?)\/?$/.exec(body); if (!start) fail();
    const attrs: Record<string, string> = {}; let remainder = start![2];
    while (remainder.trim()) {
      const attr = /^\s+([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/.exec(remainder);
      if (!attr || Object.prototype.hasOwnProperty.call(attrs, attr[1])) fail();
      attrs[attr![1]] = xmlEntities(attr![2] ?? attr![3]); remainder = remainder.slice(attr![0].length);
    }
    if (!stack.length && ++roots > 1) fail();
    tags.push({ name: start![1].split(':').pop()!, attrs });
    if (!body.endsWith('/')) stack.push(start![1]);
  }
  if (stack.length || roots !== 1 || text.slice(previous).trim()) fail();
  return tags;
}

function validateOffice(format: 'docx' | 'xlsx', bytes: Buffer): void {
  const files = unzip(bytes), main = format === 'docx' ? 'word/document.xml' : 'xl/workbook.xml';
  for (const name of ['[Content_Types].xml', '_rels/.rels', main]) if (!files.has(name)) fail();
  const xml = new Map<string, XmlTag[]>();
  for (const [path, content] of files) {
    if (/vba|macro|activex|embeddings|externalLinks|connections|queryTables|customUI/i.test(path) || /\.(?:bin|exe|js|vbs|html?|mhtml|svg)$/i.test(path)) fail();
    if (path.endsWith('.xml') || path.endsWith('.rels')) {
      const tags = parseXml(content); xml.set(path, tags);
      if (tags.some(tag => /^(?:object|oleObject|altChunk|externalLink|externalData|connection|queryTable|ddeLink|webQuery|control|attachedTemplate|f|instrText|fldSimple|definedName|hyperlink)$/i.test(tag.name))) fail();
    } else if (!/\.(?:png|jpe?g|gif)$/i.test(path)) fail();
  }
  const types = xml.get('[Content_Types].xml')!;
  const expectedType = `application/vnd.openxmlformats-officedocument.${format === 'docx' ? 'wordprocessingml.document' : 'spreadsheetml.sheet'}.main+xml`;
  if (types[0]?.name !== 'Types' || types[0].attrs.xmlns !== 'http://schemas.openxmlformats.org/package/2006/content-types' || !types.some(tag => tag.name === 'Override' && tag.attrs.PartName === `/${main}` && tag.attrs.ContentType === expectedType) || types.some(tag => /macro|vba|oleobject|activex|external|html/i.test(tag.attrs.ContentType ?? ''))) fail();
  let mainRelated = false;
  for (const [path, tags] of xml) if (path.endsWith('.rels')) {
    if (tags[0]?.name !== 'Relationships' || tags[0].attrs.xmlns !== 'http://schemas.openxmlformats.org/package/2006/relationships') fail();
    const base = path === '_rels/.rels' ? '' : posix.dirname(posix.dirname(path));
    const ids = new Set<string>();
    for (const tag of tags.slice(1)) {
      const { Id, Target, Type, TargetMode } = tag.attrs;
      if (tag.name !== 'Relationship' || !Id || ids.has(Id) || !Target || !Type || (TargetMode && TargetMode !== 'Internal') || /[\\:%?#\x00-\x20]|^\//.test(Target) || /external|attachedTemplate|oleObject|aFChunk|control|vba|hyperlink/i.test(Type)) fail();
      ids.add(Id);
      const target = posix.normalize(posix.join(base, Target));
      if (target.startsWith('../') || !files.has(target)) fail();
      if (path === '_rels/.rels' && Type === 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument' && target === main) mainRelated = true;
    }
  }
  if (!mainRelated || xml.get(main)?.[0]?.name !== (format === 'docx' ? 'document' : 'workbook')) fail();
  const namespace = format === 'docx' ? 'http://schemas.openxmlformats.org/wordprocessingml/2006/main' : 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  if (!Object.values(xml.get(main)![0].attrs).includes(namespace) || (format === 'docx' && !xml.get(main)!.some(tag => tag.name === 'body'))) fail();
  if (format === 'xlsx') {
    const rels = xml.get('xl/_rels/workbook.xml.rels');
    const sheets = xml.get(main)!.filter(tag => tag.name === 'sheet');
    if (!rels || !sheets.length || sheets.some(sheet => !rels.some(rel => rel.attrs.Id === sheet.attrs['r:id'] && /\/worksheet$/.test(rel.attrs.Type ?? '') && xml.get(posix.normalize(posix.join('xl', rel.attrs.Target)))?.[0]?.name === 'worksheet'))) fail();
  }
}

export async function validateSandboxArtifact(path: string, format: 'html' | 'docx' | 'xlsx', bytes: Buffer): Promise<{ mimeType: string; sha256: string; size: number }> {
  try {
    assertSandboxRelativePath(path);
    if (!Object.prototype.hasOwnProperty.call(MIMES, format) || !path.endsWith(`.${format}`) || !bytes.length || bytes.length > SANDBOX_MAX_FILE_BYTES) fail();
    if (format === 'html') {
      const html = utf8(bytes);
      if (html.includes('\0') || !/^\s*(?:<!doctype\s+html\s*>\s*)?<html(?:\s[^>]*)?>\s*<head(?:\s[^>]*)?>[\s\S]*?<\/head>\s*<body(?:\s[^>]*)?>[\s\S]*?<\/body>\s*<\/html>\s*$/i.test(html)) fail();
    } else validateOffice(format, bytes);
    return { mimeType: MIMES[format], sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
  } catch { return fail(); }
}

/** Bytes only. Authorization, ownership and expiry live in Harness metadata. */
export class LocalSandboxArtifactStore {
  private readonly root: string;
  constructor(rootDir: string) { this.root = resolve(rootDir); }
  private async path(id: string): Promise<string> {
    if (!SANDBOX_UUID.test(id)) throw new Error('SANDBOX_ARTIFACT_ID_INVALID');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const info = await lstat(this.root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('SANDBOX_ARTIFACT_STORE_INVALID');
    await chmod(this.root, 0o700);
    return join(await realpath(this.root), id);
  }
  async write(id: string, bytes: Buffer): Promise<void> {
    if (bytes.length > SANDBOX_MAX_FILE_BYTES) throw new Error('SANDBOX_FILE_TOO_LARGE');
    const path = await this.path(id), temp = `${path}.${randomUUID()}.tmp`;
    const file = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(bytes); await file.sync(); await file.close(); await rename(temp, path); }
    finally { await file.close().catch(() => undefined); await unlink(temp).catch(() => undefined); }
  }
  async read(id: string): Promise<Buffer> {
    const file = await open(await this.path(id), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.nlink !== 1 || info.size > SANDBOX_MAX_FILE_BYTES) throw new Error('SANDBOX_ARTIFACT_INVALID');
      const bytes = Buffer.alloc(info.size + 1); let offset = 0;
      while (offset < bytes.length) { const result = await file.read(bytes, offset, bytes.length - offset, null); if (!result.bytesRead) break; offset += result.bytesRead; }
      if (offset !== info.size) throw new Error('SANDBOX_ARTIFACT_INVALID');
      return bytes.subarray(0, offset);
    } finally { await file.close(); }
  }
  async remove(id: string): Promise<void> {
    try { await unlink(await this.path(id)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
