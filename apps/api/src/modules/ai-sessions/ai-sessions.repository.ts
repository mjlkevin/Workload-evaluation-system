import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { aiSessionsStorePath } from "../../utils";
import type { AiAttachment, AiMessage, AiSessionsStore } from "./ai-sessions.types";

function emptyStore(): AiSessionsStore {
  return { sessions: [] };
}

export function loadAiSessionsStore(filePath: string = aiSessionsStorePath()): AiSessionsStore {
  if (!existsSync(filePath)) {
    return emptyStore();
  }
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as Partial<AiSessionsStore>;
  return { sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [] };
}

export function saveAiSessionsStore(store: AiSessionsStore, filePath: string = aiSessionsStorePath()): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, JSON.stringify(store, null, 2), "utf8");
  renameSync(tempPath, filePath);
}

// ============================================================
// RP-047 Batch B：Harness Session Projector 幂等追加
// ============================================================
// 恰好一次投影的最后一道防线：消息 metadata.projectionSource
// 携带 outbox 来源键（deduplicationKey），重放时按键查重，
// 已存在的消息获胜，不重复追加。AiMessageMetadata 是开放
// Record，本扩展不改动 ai-sessions.types.ts（扩展项 E3 未启用）。

export type AiSessionProjectionSource = {
  deduplicationKey: string;
  runId: string;
  eventType: string;
};

export type AppendAiSessionMessageIdempotentInput = {
  sessionId: string;
  message: AiMessage;
  attachments?: AiAttachment[];
  source: AiSessionProjectionSource;
  storePath?: string;
};

export type AppendAiSessionMessageIdempotentResult = {
  found: boolean;
  created: boolean;
  message: AiMessage;
};

export function appendAiSessionMessageIdempotent(
  input: AppendAiSessionMessageIdempotentInput,
): AppendAiSessionMessageIdempotentResult {
  const store = loadAiSessionsStore(input.storePath);
  const session = store.sessions.find((item) => item.sessionId === input.sessionId);
  if (!session) {
    return { found: false, created: false, message: input.message };
  }
  const existing = session.messages.find(
    (item) =>
      (item.metadata as { projectionSource?: { deduplicationKey?: string } } | undefined)?.projectionSource
        ?.deduplicationKey === input.source.deduplicationKey,
  );
  if (existing) {
    return { found: true, created: false, message: existing };
  }
  const stored: AiMessage = {
    ...input.message,
    metadata: { ...(input.message.metadata ?? {}), projectionSource: input.source },
  };
  const sessionAttachments = Array.isArray(session.attachments)
    ? session.attachments
    : (session.attachments = []);
  for (const attachment of input.attachments ?? []) {
    if (!sessionAttachments.some((item) => item.attachmentId === attachment.attachmentId)) {
      sessionAttachments.push(attachment);
    }
  }
  session.messages.push(stored);
  session.updatedAt = new Date().toISOString();
  saveAiSessionsStore(store, input.storePath);
  return { found: true, created: true, message: stored };
}
