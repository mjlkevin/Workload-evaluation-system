// ============================================================
// AI Sessions 域仓储（阶段 2 S2b-2 终态：PG-only）
// ============================================================
// 批 2/批 3 试点结论：整存 load→改→save 无法表达幂等插入（范式 #2）与
// 条件 UPDATE CAS / 原子追加（范式 #3），接口收敛为行级操作。
// S2b-2（2026-08-28）：JSON accessor / JSON 实现 / storePath 测试注入钩子
// 随 JSON 路径一并删除，选择器恒 PG；开关 WES_STORE_AI_SESSIONS_PG 已随
// ci.yml / .env.example / 注释残留一并退役（commit C）。
//
// 缓存策略（与 users 域不同，架构侧 2026-08-19 指令「不照搬全表填充」）：
// 本域 PG 实现不加缓存层，读路径直查（owner_idx / owner_updated_idx 索引
// 支撑）。理由：①会话数据宽（messages jsonb 随对话增长）且变更频繁，
// 缓存写穿复杂、过期面大；②读入口仅 AI 工作台会话列表/详情与管理员审计，
// 不是 requireAuth 式全 API 热路径，无「每请求必查」压力；③聊天内容是
// 用户直接可见数据，陈旧 = 可见缺陷（users 缓存陈旧只是认证元数据滞后）；
// ④全表填充会把全体用户的会话消息载入进程内存并放大多副本分歧面。

import type { AiAttachment, AiArtifact, AiMessage, AiPendingAction, AiSessionRecord } from "./ai-sessions.types";
import { createAiSessionsPgRepository } from "./ai-sessions-pg.repository";

// ============================================================
// 行级仓储接口（批 2 users 同构形态）
// ============================================================

export type CreateAiSessionInput = {
  session: AiSessionRecord;
  /** 仅供测试注入确定性时钟；生产不传（DB 时钟，范式 #4） */
  now?: Date;
};

export type AppendAiSessionEventInput = {
  ownerUserId: string;
  sessionId: string;
  messages?: AiMessage[];
  attachments?: AiAttachment[];
  artifacts?: AiArtifact[];
  pendingActions?: AiPendingAction[];
};

// ============================================================
// RP-047 Batch B：Harness 消息幂等追加
// ============================================================
// 恰好一次直写落库的防线：消息 metadata.projectionSource 携带来源键
// （deduplicationKey），恢复重放时按键查重，已存在的消息获胜，不重复追加。
// AiMessageMetadata 是开放 Record，本扩展不改动 ai-sessions.types.ts
// （扩展项 E3 未启用）。S2b-2 后 outbox/projector 补偿链已删，workflow
// 直写路径以同一来源键幂等落库。

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
};

export type AppendAiSessionMessageIdempotentResult = {
  found: boolean;
  created: boolean;
  message: AiMessage;
};

export interface AiSessionsStoreRepository {
  /** 幂等插入：同 sessionId 冲突重放返回原记录（created=false，范式 #2） */
  createSession(input: CreateAiSessionInput): Promise<{ created: boolean; session: AiSessionRecord }>;
  listSessionsByOwner(ownerUserId: string): Promise<AiSessionRecord[]>;
  /** 管理员审计：跨用户全量（过滤/排序/截断在 usecase 层） */
  listAllSessions(): Promise<AiSessionRecord[]>;
  /** 归属过滤：非 owner 或不存在同为 null */
  findSession(input: { ownerUserId: string; sessionId: string }): Promise<AiSessionRecord | null>;
  /** 行级更新（范式 #3）：会话存在返回更新后记录；不存在或非 owner 返回 null */
  renameSession(input: { ownerUserId: string; sessionId: string; title: string }): Promise<AiSessionRecord | null>;
  /** 行级删除：删除成功 true；不存在或非 owner false */
  deleteSession(input: { ownerUserId: string; sessionId: string }): Promise<boolean>;
  /**
   * 原子追加消息/附件/产物/待办动作任一子集（范式 #3）：
   * 会话存在返回更新后记录；不存在或非 owner 返回 null。
   */
  appendSessionEvent(input: AppendAiSessionEventInput): Promise<AiSessionRecord | null>;
  /** 按来源键幂等追加消息（RP-047 Batch B 语义，跨后端一致） */
  appendMessageIdempotent(input: AppendAiSessionMessageIdempotentInput): Promise<AppendAiSessionMessageIdempotentResult>;
}

// ============================================================
// 选择器（S2b-2：JSON 路径删除，恒 PG）
// ============================================================

let defaultRepo: AiSessionsStoreRepository | null = null;

/** 进程内默认 repository 单例（生产路由使用） */
export function getAiSessionsRepository(): AiSessionsStoreRepository {
  if (!defaultRepo) {
    defaultRepo = createAiSessionsPgRepository();
  }
  return defaultRepo;
}

/** 测试专用：重置单例 */
export function _resetAiSessionsRepositoryForTest(): void {
  defaultRepo = null;
}

/**
 * 公开幂等追加入口（harness 直写路径使用）。S2b-2 后 storePath 测试注入
 * 钩子已随 JSON 路径删除，恒经选择器走 PG。
 */
export async function appendAiSessionMessageIdempotent(
  input: AppendAiSessionMessageIdempotentInput,
): Promise<AppendAiSessionMessageIdempotentResult> {
  return getAiSessionsRepository().appendMessageIdempotent(input);
}
