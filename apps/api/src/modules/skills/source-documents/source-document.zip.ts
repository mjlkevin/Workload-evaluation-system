import { inflateRawSync } from 'node:zlib';
import { SkillError } from '../skills.types';

const ENTRY_LIMIT = 2 * 1024 * 1024, TOTAL_LIMIT = 8 * 1024 * 1024;
export function sourceInvalid(large = false): never {
  throw new SkillError(large ? 'SOURCE_DOCUMENT_TOO_LARGE' : 'SOURCE_DOCUMENT_INVALID',
    large ? '材料超过处理上限，请拆分后上传' : '材料格式无效或包含不支持的内容', large ? 413 : 400);
}
export function sourceUtf8(bytes: Buffer): string {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (text.includes('\0')) sourceInvalid();
    return text;
  } catch { return sourceInvalid(); }
}
const crcTable = Array.from({ length: 256 }, (_, initial) => {
  let value = initial;
  for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 255];
  return (value ^ 0xffffffff) >>> 0;
}
function decodedEntities(text: string): string {
  return text.replace(/&#(?:x([0-9a-f]+)|([0-9]+));/gi, (_match, hex, decimal) => {
    const point = parseInt(hex ?? decimal, hex ? 16 : 10);
    if (point > 0x10ffff || point === 0) sourceInvalid();
    return String.fromCodePoint(point);
  }).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
/** ZIP headers are untrusted. Verify actual bounded inflation and CRC before SheetJS sees the archive. */
export function validateSourceZip(bytes: Buffer): void {
  try {
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
    }
    if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) sourceInvalid();
    const count = bytes.readUInt16LE(end + 10), centralSize = bytes.readUInt32LE(end + 12), central = bytes.readUInt32LE(end + 16);
    if (!count || count === 65535 || centralSize === 0xffffffff || central === 0xffffffff
      || count !== bytes.readUInt16LE(end + 8) || central + centralSize !== end) sourceInvalid();
    if (count > 256) sourceInvalid(true);
    let cursor = central, total = 0, cells = 0;
    const names = new Set<string>(), ranges: Array<[number, number]> = [];
    for (let i = 0; i < count; i++) {
      if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) sourceInvalid();
      const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10), checksum = bytes.readUInt32LE(cursor + 16);
      const compressed = bytes.readUInt32LE(cursor + 20), size = bytes.readUInt32LE(cursor + 24);
      const nameLength = bytes.readUInt16LE(cursor + 28), extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32);
      const local = bytes.readUInt32LE(cursor + 42), next = cursor + 46 + nameLength + extraLength + commentLength;
      if (next > end || !nameLength || flags & ~0x0806 || ![0, 8].includes(method) || bytes.readUInt16LE(cursor + 34)
        || compressed === 0xffffffff || size === 0xffffffff || local === 0xffffffff) sourceInvalid();
      if (size > ENTRY_LIMIT || total + size > TOTAL_LIMIT) sourceInvalid(true);
      const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength), name = sourceUtf8(nameBytes), lower = name.toLowerCase();
      if (!/^[A-Za-z0-9_.\[\]/-]+$/.test(name) || name.startsWith('/') || name.split('/').some(part => part === '.' || part === '..')
        || name.includes('//') || names.has(lower)) sourceInvalid();
      names.add(lower);
      if (/vba|macro|activex|externallinks|embeddings|connections|querytables|ctrlprops|\.bin$/i.test(name)) sourceInvalid();
      // Extra fields can carry ZIP64 sizes even when ordinary size fields appear small.
      for (let field = cursor + 46 + nameLength; field < cursor + 46 + nameLength + extraLength;) {
        if (field + 4 > cursor + 46 + nameLength + extraLength || bytes.readUInt16LE(field) === 1) sourceInvalid();
        field += 4 + bytes.readUInt16LE(field + 2);
        if (field > cursor + 46 + nameLength + extraLength) sourceInvalid();
      }
      if (local + 30 > central || bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 6) !== flags
        || bytes.readUInt16LE(local + 8) !== method || bytes.readUInt32LE(local + 14) !== checksum
        || bytes.readUInt32LE(local + 18) !== compressed || bytes.readUInt32LE(local + 22) !== size
        || bytes.readUInt16LE(local + 26) !== nameLength) sourceInvalid();
      const localExtra = bytes.readUInt16LE(local + 28), start = local + 30 + nameLength + localExtra, finish = start + compressed;
      if (finish > central || !bytes.subarray(local + 30, local + 30 + nameLength).equals(nameBytes)) sourceInvalid();
      for (let field = local + 30 + nameLength; field < start;) {
        if (field + 4 > start || bytes.readUInt16LE(field) === 1) sourceInvalid();
        field += 4 + bytes.readUInt16LE(field + 2); if (field > start) sourceInvalid();
      }
      ranges.push([local, finish]);
      const packed = bytes.subarray(start, finish);
      const content = method === 0 ? packed : inflateRawSync(packed, { maxOutputLength: ENTRY_LIMIT });
      if (content.length !== size || crc32(content) !== checksum) sourceInvalid();
      total += content.length;
      if (/\.(?:xml|rels)$/i.test(name)) {
        const xml = sourceUtf8(content), encoding = /<\?xml[^>]*encoding\s*=\s*['"]([^'"]+)['"]/i.exec(xml)?.[1];
        if (encoding && !/^utf-?8$/i.test(encoding)) sourceInvalid();
        if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) sourceInvalid();
        const decoded = decodedEntities(xml);
        // SheetJS writes unused macro-enabled Default MIME declarations in ordinary XLSX files.
        // Actual binary parts are rejected above; active Override/relationship declarations also reject.
        if (/TargetMode\s*=\s*['"]\s*External\s*['"]/i.test(decoded)
          || (lower === '[content_types].xml' ? /<Override\b[^>]*(?:macroEnabled|vbaProject|macrosheet)/i : /vbaProject|macrosheet/i).test(decoded)) sourceInvalid();
        if (/^xl\/worksheets\/[^/]+\.xml$/i.test(name)) {
          cells += (xml.match(/<(?:\w+:)?c(?:\s|>)/g) ?? []).length;
          if (cells > 50000) sourceInvalid(true);
        }
      }
      cursor = next;
    }
    ranges.sort((a, b) => a[0] - b[0]);
    if (cursor !== end || ranges[0][0] !== 0 || ranges[ranges.length - 1][1] !== central
      || ranges.some((range, i) => i > 0 && ranges[i - 1][1] !== range[0])
      || !names.has('[content_types].xml') || !names.has('xl/workbook.xml')) sourceInvalid();
  } catch (error) {
    if (error instanceof SkillError) throw error;
    return sourceInvalid();
  }
}
