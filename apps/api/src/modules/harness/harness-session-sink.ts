// ============================================================
// Harness Session Message Sink（RP-047 Batch E · Step 2）
// ============================================================
// 实现 HarnessSessionMessageSink 契约，经 ai-sessions 模块公开 API
// appendAiSessionMessageIdempotent 追加消息；幂等依赖
// projectionSource.deduplicationKey（projector 语义已保证，sink 须透传来源键）。

import { appendAiSessionMessageIdempotent } from "../ai-sessions/ai-sessions.repository";
import type { HarnessSessionMessageSink, HarnessProjectionSource, HarnessSessionProjectionMessage } from "./harness-session-projector";

export function createHarnessSessionSink(): HarnessSessionMessageSink {
  return {
    // 阶段 1 批 8：append 改 async（内部 await 已异步化的幂等 API），实现 不动。
    async append(input: {
      sessionId: string;
      message: HarnessSessionProjectionMessage;
      source: HarnessProjectionSource;
    }): Promise<{ created: boolean; messageId: string }> {
      const result = await appendAiSessionMessageIdempotent({
        sessionId: input.sessionId,
        message: {
          messageId: input.message.messageId ?? "",
          role: input.message.role as "user" | "assistant" | "system" | "tool",
          content: input.message.content,
          createdAt: new Date().toISOString(),
          metadata: input.message.metadata,
        },
        source: {
          deduplicationKey: input.source.deduplicationKey,
          runId: input.source.runId,
          eventType: input.source.eventType,
        },
      });
      return {
        created: result.created,
        messageId: (result.message as any)?.messageId ?? "",
      };
    },
  };
}
