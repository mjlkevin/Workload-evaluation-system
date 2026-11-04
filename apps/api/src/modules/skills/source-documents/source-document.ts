import { createHash } from 'node:crypto';
import { fork } from 'node:child_process';
import { join } from 'node:path';
import { sourceInvalid } from './source-document.zip';

export type SourceFile = { bytes: Buffer; name: string; mime: string };
export type SourceCell = { sheet: string; cell: string; text: string };
export type SourceDocument = {
  schemaVersion: 1;
  byteDigest: string;
  canonicalText: string;
  name: string;
  mime: string;
  size: number;
  cells?: SourceCell[];
};

const MAX_PARSE_MS = 5000;
let activeParsers = 0;
/** Treat the parser process output as untrusted; reconstruct only bounded scalar cells. */
export function validatedSourceResult(value: unknown, file: SourceFile): SourceDocument {
  const result = value as SourceDocument;
  if (!result || typeof result !== 'object' || typeof result.canonicalText !== 'string'
    || !result.canonicalText.trim() || result.canonicalText.length > 200000) sourceInvalid();
  const excel = /\.xlsx$/i.test(file.name);
  let cells: SourceCell[] | undefined;
  if (excel) {
    if (!Array.isArray(result.cells) || !result.cells.length || result.cells.length > 50000) sourceInvalid();
    const seen = new Set<string>(); let length = 0;
    cells = result.cells.map(value => {
      if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'cell,sheet,text'
        || typeof value.sheet !== 'string' || !value.sheet.length || value.sheet.length > 31
        || /[\x00-\x1f\[\]:*?/\\]/.test(value.sheet) || typeof value.cell !== 'string'
        || !/^[A-Z]{1,3}[1-9][0-9]{0,6}$/.test(value.cell) || typeof value.text !== 'string'
        || value.text.length > 200000) sourceInvalid();
      const column = value.cell.match(/^[A-Z]+/)![0];
      if ([...column].reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0) > 16384
        || Number(value.cell.slice(column.length)) > 1048576) sourceInvalid();
      const key = JSON.stringify([value.sheet, value.cell]);
      if (seen.has(key)) sourceInvalid();
      seen.add(key);
      length += value.sheet.length + value.cell.length + value.text.length + 4 + (seen.size > 1 ? 1 : 0);
      if (length > 200000) sourceInvalid(true);
      return { sheet: value.sheet, cell: value.cell, text: value.text };
    });
    if (cells.map(cell => `[${cell.sheet}!${cell.cell}] ${cell.text}`).join('\n') !== result.canonicalText) sourceInvalid();
  } else if (result.cells !== undefined) sourceInvalid();
  return { schemaVersion: 1, byteDigest: createHash('sha256').update(file.bytes).digest('hex'),
    canonicalText: result.canonicalText, name: file.name, size: file.bytes.length,
    mime: excel ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : /\.md$/i.test(file.name) ? 'text/markdown' : 'text/plain', ...(cells ? { cells } : {}) };
}

/** No archive/XML/SheetJS work runs in the API realm. Timeout also covers ZIP scanning/ReDoS. */
export async function parseSourceDocument(file: SourceFile, budgetMs = MAX_PARSE_MS): Promise<SourceDocument> {
  if (!Buffer.isBuffer(file.bytes) || !file.bytes.length || typeof file.name !== 'string'
    || file.name.length > 255 || /[\x00-\x1f/\\:]/.test(file.name) || !/\.(xlsx|txt|md)$/i.test(file.name)) sourceInvalid();
  if (file.bytes.length > 2 * 1024 * 1024 || activeParsers >= 2) sourceInvalid(true);
  if (!Number.isFinite(budgetMs) || budgetMs < 1 || budgetMs > MAX_PARSE_MS) sourceInvalid();
  // Snapshot bytes before yielding so digest and parsed content cannot diverge through caller mutation.
  file = { bytes: Buffer.from(file.bytes), name: file.name, mime: '' };
  activeParsers++;
  try {
    return await new Promise<SourceDocument>((resolve, reject) => {
      const ts = __filename.endsWith('.ts');
      const child = fork(join(__dirname, `source-document.worker.${ts ? 'ts' : 'js'}`), [], {
        execArgv: [...(ts ? ['--import', 'tsx'] : []), '--max-old-space-size=96', '--max-semi-space-size=4'],
        // Do not pass application credentials, Node preload hooks or environment files into the parser.
        env: {}, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'json',
      });
      let settled = false;
      const finish = (error?: unknown, value?: unknown) => {
        if (settled) return;
        settled = true; clearTimeout(timer); child.kill('SIGKILL');
        try {
          if (error) reject(error);
          else resolve(validatedSourceResult(value, file));
        } catch (error) { reject(error); }
      };
      const invalid = (large = false) => { try { sourceInvalid(large); } catch (error) { finish(error); } };
      const timer = setTimeout(() => invalid(true), budgetMs);
      child.on('error', () => invalid());
      child.on('exit', () => { if (!settled) invalid(); });
      child.on('message', value => {
        const message = value as { ok?: unknown; large?: unknown; document?: unknown };
        if (!message || typeof message !== 'object' || message.ok !== true) invalid(message?.large === true);
        else finish(undefined, message.document);
      });
      child.send({ bytes: file.bytes.toString('base64'), name: file.name }, error => { if (error) invalid(); });
    });
  } finally { activeParsers--; }
}
