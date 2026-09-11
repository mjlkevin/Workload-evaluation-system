// ============================================================
// 批次 2b-3 · 对话事实批量读取口（harness 事件流 → 会话历史源）
// ============================================================
// 「取会话历史」在 2b-3 换源后要读的东西住在 harness 域的两张表里：
//   harness_run_events（event_type ∈ {user/message, assistant/message}）
//   × harness_runs（ai_session_id 关联、retry_of_run_id 归并判据、created_at 跨 Run 排序键）
//
// 为什么这个适配器落在 harness 域而不是 ai-sessions 域：harness_* 的表形状归 harness 管，
// 会话侧只声明它要什么（SessionConversationFactSource 那个口，定义在 session-history.ts）。
// 反过来让 ai-sessions 直查 harness 表，等于把两张表的 schema 知识复制到第二个地方。
// 运行时依赖方向是 ai-sessions → 本文件 → db，本文件对 ai-sessions 只有 **type-only**
// import（编译期即擦除），不与 harness→ai-sessions 那条既有方向构成环。
//
// 只读、不写：本批不动写入侧（2b-1 / 2b-2 的写链原样），也不动事件表 schema。

import { and, asc, eq, inArray } from "drizzle-orm";

import { db, type Database } from "../../db/client";
import { harnessRunEvents, harnessRuns } from "../../db/schema";
import type { AiMessage } from "../ai-sessions/ai-sessions.types";
import {
  SESSION_CONVERSATION_FACT_EVENT_TYPES,
  type SessionConversationFactEvent,
  type SessionConversationFactEventType,
  type SessionConversationFactSource,
} from "../ai-sessions/session-history";

type FactRow = {
  aiSessionId: string | null;
  runId: string;
  retryOfRunId: string | null;
  runCreatedAt: Date;
  sequence: number;
  eventType: string;
  payload: unknown;
};

/**
 * 一次查询取回一批会话的对话事实。
 *
 * 批量口径是硬要求（架构侧 2026-09-11）：管理员审计全表逐条 map，逐会话查就是 N+1。
 * 会话数上限不受本函数控制，PG 的 `= ANY(ARRAY[...])` 参数化后不受占位符数量限制
 * （drizzle 的 inArray 会展开成 $n 列表，万级会话时须换 anyOf/临时表——已登记为观察项，
 * 今天 101 条会话远未触及）。
 */
export function createConversationEventHistorySource(dbInstance: Database = db): SessionConversationFactSource {
  return {
    async loadConversationFacts(
      sessionIds: readonly string[],
    ): Promise<ReadonlyMap<string, readonly SessionConversationFactEvent[]>> {
      const ids = [...new Set(sessionIds.filter((id) => typeof id === "string" && id.length > 0))];
      const grouped = new Map<string, SessionConversationFactEvent[]>();
      // 空集合不查库：`= any(array[])` 这种形状让 PG 去赌没意思，也省一次往返
      if (ids.length === 0) return grouped;

      const rows = await dbInstance
        .select({
          aiSessionId: harnessRuns.aiSessionId,
          runId: harnessRuns.harnessRunId,
          retryOfRunId: harnessRuns.retryOfRunId,
          runCreatedAt: harnessRuns.createdAt,
          sequence: harnessRunEvents.sequence,
          eventType: harnessRunEvents.eventType,
          payload: harnessRunEvents.payload,
        })
        .from(harnessRunEvents)
        .innerJoin(harnessRuns, eq(harnessRunEvents.harnessRunId, harnessRuns.harnessRunId))
        .where(
          and(
            inArray(harnessRuns.aiSessionId, ids),
            inArray(harnessRunEvents.eventType, [...SESSION_CONVERSATION_FACT_EVENT_TYPES]),
          ),
        )
        // 排序口径与 resolveSessionHistory 一致（跨 Run 按 Run 创建时刻、Run 内按序号）。
        // 这里排一次是为了让「按到达顺序分组」直接成立；判定侧仍会自己排，两处不冲突。
        .orderBy(asc(harnessRuns.createdAt), asc(harnessRuns.harnessRunId), asc(harnessRunEvents.sequence));

      for (const row of rows as unknown as FactRow[]) {
        const sessionId = row.aiSessionId;
        if (!sessionId) continue; // 无会话归属的 Run（file_analysis 等）本来就没有对话事实
        const list = grouped.get(sessionId) ?? [];
        list.push(toFactEvent(row));
        grouped.set(sessionId, list);
      }
      return grouped;
    },
  };
}

function toFactEvent(row: FactRow): SessionConversationFactEvent {
  return {
    runId: row.runId,
    // 空值一律映射成 null（不留 undefined）：口径①判的是「有没有 retry 来源」，
    // undefined 与 null 混在一起时，`if (retryOfRunId)` 碰巧对、`=== null` 就错了。
    retryOfRunId: row.retryOfRunId ?? null,
    runCreatedAt: row.runCreatedAt.toISOString(),
    sequence: Number(row.sequence),
    eventType: row.eventType as SessionConversationFactEventType,
    // 载荷原样透传：本处一个字段都不组装、不补默认值——整形是消费端的事
    payload: (row.payload ?? {}) as AiMessage,
  };
}
