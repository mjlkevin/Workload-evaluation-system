import type { AiAttachment } from '../../ai-sessions/ai-sessions.types';
import type { FrozenSourceMaterial } from '../mvp/execution-assets';
import { skillDefinitionHash as hash } from '../skills.hash';
import type { SourceDocument } from './source-document';

export function storedSourceDocument(attachment: Record<string, unknown>): SourceDocument | undefined {
  const document = attachment.sourceDocument as SourceDocument | undefined;
  if (!document || document.schemaVersion !== 1 || typeof document.canonicalText !== 'string' || !document.canonicalText.trim()
    || document.canonicalText.length > 200000 || !/^[a-f0-9]{64}$/.test(document.byteDigest)
    || document.name !== attachment.name || typeof document.name !== 'string' || /[\x00-\x1f/\\:]/.test(document.name)
    || typeof document.mime !== 'string' || !Number.isInteger(document.size) || document.size <= 0 || document.size > 2 * 1024 * 1024) return undefined;
  return document;
}
/** Every HTTP/session read uses a fixed whitelist; server canonical text never enters the public record. */
export function publicSourceAttachment(attachment: Record<string, unknown>): AiAttachment {
  const result: Record<string, unknown> = {};
  for (const key of ['attachmentId', 'name', 'size', 'type', 'parsedSummary', 'createdAt'])
    if (attachment[key] !== undefined) result[key] = attachment[key];
  const document = storedSourceDocument(attachment);
  if (document) Object.assign(result, { sourceAvailable: true, sourceDigest: document.byteDigest, sourceCharCount: document.canonicalText.length });
  return result as AiAttachment;
}
export function frozenFileMaterial(attachment: Record<string, unknown>): FrozenSourceMaterial | undefined {
  const document = storedSourceDocument(attachment);
  if (!document || typeof attachment.attachmentId !== 'string') return undefined;
  const body = { id: attachment.attachmentId, kind: 'file' as const, text: document.canonicalText, location: document.name };
  return { ...body, digest: hash(body) };
}
