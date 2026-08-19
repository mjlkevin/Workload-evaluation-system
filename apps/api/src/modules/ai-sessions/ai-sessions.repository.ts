// ============================================================
// AI Sessions 域仓储（阶段 2 批 3 · 第 1–3 步）
// ============================================================
// 批 2 试点结论复用：整存 load→改→save 无法表达幂等插入（范式 #2）与
// 条件 UPDATE CAS / 原子追加（范式 #3），接口收敛为行级操作。JSON 实现
// 为既有 loadAiSessionsStore/saveAiSessionsStore 的行级封装（遗留语义原样
// 保留，包括整存 RMW 的丢失更新窗口——切换观察期结束、第 4 步删除 JSON
// 路径后消解）。
//
// 缓存策略（与 users 域不同，架构侧 2026-08-19 指令「不照搬全表填充」）：
// 本域 PG 实现不加缓存层，读路径直查（owner_idx / owner_updated_idx 索引
// 支撑）。理由：①会话数据宽（messages jsonb 随对话增长）且变更频繁，
// 缓存写穿复杂、过期面大；②读入口仅 AI 工作台会话列表/详情与管理员审计，
// 不是 requireAuth 式全 API 热路径，无「每请求必查」压力；③聊天内容是
// 用户直接可见数据，陈旧 = 可见缺陷（users 缓存陈旧只是认证元数据滞后）；
// ④全表填充会把全体用户的会话消息载入进程内存并放大多副本分歧面。

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { aiSessionsStorePath } from "../../utils";
import type { AiAttachment, AiArtifact, AiMessage, AiPendingAction, AiSessionRecord, AiSessionsStore } from "./ai-sessions.types";
import { createAiSessionsPgRepository } from "./ai-sessions-pg.repository";

function emptyStore(): AiSessionsStore {
  return { sessions: [] };
}

// ============================================================
// JSON accessor（第 1–3 步保留；第 4 步删除）
// ============================================================

/** 阶段 1 批 8：签名改 async，实现 不动（仍为 readFileSync），阶段 2 替换实现。 */
export async function loadAiSessionsStore(filePath: string = aiSessionsStorePath()): Promise<AiSessionsStore> {
  if (!existsSync(filePath)) {
    return emptyStore();
  }
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as Partial<AiSessionsStore>;
  return { sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [] };
}

/** 阶段 1 批 8：签名改 async，实现 不动（仍为 writeFileSync/renameSync），阶段 2 替换实现。 */
export async function saveAiSessionsStore(store: AiSessionsStore, filePath: string = aiSessionsStorePath()): Promise<void> {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, JSON.stringify(store, null, 2), "utf8");
  renameSync(tempPath, filePath);
}

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
  /** 按来源键幂等追加投影消息（RP-047 Batch B 语义，跨后端一致） */
  appendMessageIdempotent(input: AppendAiSessionMessageIdempotentInput): Promise<AppendAiSessionMessageIdempotentResult>;
}

// ============================================================
// JSON 实现（遗留语义原样：整存 RMW；§5.1 遗留模式，勿复制）
// ============================================================

export function createAiSessionsJsonRepository(): AiSessionsStoreRepository {
  return {
    async createSession(input) {
      const store = await loadAiSessionsStore();
      const existing = store.sessions.find((item) => item.sessionId === input.session.sessionId);
      if (existing) return { created: false, session: existing };
      store.sessions.unshift(input.session);
      await saveAiSessionsStore(store);
      return { created: true, session: input.session };
    },

    async listSessionsByOwner(ownerUserId) {
      return (await loadAiSessionsStore()).sessions.filter((session) => session.ownerUserId === ownerUserId);
    },

    async listAllSessions() {
      return (await loadAiSessionsStore()).sessions;
    },

    async findSession(input) {
      return (
        (await loadAiSessionsStore()).sessions.find(
          (session) => session.ownerUserId === input.ownerUserId && session.sessionId === input.sessionId,
        ) ?? null
      );
    },

    async renameSession(input) {
      return mutateSession(input.ownerUserId, input.sessionId, (session) => {
        session.title = input.title;
      });
    },

    async deleteSession(input) {
      const store = await loadAiSessionsStore();
      const beforeCount = store.sessions.length;
      store.sessions = store.sessions.filter(
        (session) => !(session.ownerUserId === input.ownerUserId && session.sessionId === input.sessionId),
      );
      if (store.sessions.length === beforeCount) return false;
      await saveAiSessionsStore(store);
      return true;
    },

    async appendSessionEvent(input) {
      const store = await loadAiSessionsStore();
      const session = store.sessions.find(
        (item) => item.ownerUserId === input.ownerUserId && item.sessionId === input.sessionId,
      );
      if (!session) return null;
      const nowIso = new Date().toISOString();
      let changed = false;
      for (const attachment of input.attachments ?? []) {
        session.attachments.push(attachment);
        changed = true;
      }
      for (const message of input.messages ?? []) {
        session.messages.push(message);
        changed = true;
      }
      for (const artifact of input.artifacts ?? []) {
        session.artifacts.push(artifact);
        changed = true;
      }
      for (const pendingAction of input.pendingActions ?? []) {
        session.pendingActions.push(pendingAction);
        changed = true;
      }
      if (!changed) return session;
      session.updatedAt = nowIso;
      await saveAiSessionsStore(store);
      return session;
    },

    async appendMessageIdempotent(input) {
      return appendAiSessionMessageIdempotentJson(input);
    },
  };

  async function mutateSession(
    ownerUserId: string,
    sessionId: string,
    mutate: (session: AiSessionRecord) => void,
  ): Promise<AiSessionRecord | null> {
    const store = await loadAiSessionsStore();
    const session = store.sessions.find((item) => item.ownerUserId === ownerUserId && item.sessionId === sessionId);
    if (!session) return null;
    mutate(session);
    session.updatedAt = new Date().toISOString();
    await saveAiSessionsStore(store);
    return session;
  }
}

/** 阶段 1 批 8：签名改 async（内部 await 已异步化的 accessor），实现 不动，阶段 2 随 accessor 替换。 */
async function appendAiSessionMessageIdempotentJson(
  input: AppendAiSessionMessageIdempotentInput,
): Promise<AppendAiSessionMessageIdempotentResult> {
  const store = await loadAiSessionsStore(input.storePath);
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
  await saveAiSessionsStore(store, input.storePath);
  return { found: true, created: true, message: stored };
}

// ============================================================
// 选择器（第 3 步开关：缺省 JSON，严格 === "true" 切 PG）
// ============================================================

let defaultRepo: AiSessionsStoreRepository | null = null;

/** 进程内默认 repository 单例（生产路由使用）；开关只读一次，翻开关需重启 */
export function getAiSessionsRepository(): AiSessionsStoreRepository {
  if (!defaultRepo) {
    defaultRepo =
      process.env.WES_STORE_AI_SESSIONS_PG === "true"
        ? createAiSessionsPgRepository()
        : createAiSessionsJsonRepository();
  }
  return defaultRepo;
}

/** 测试专用：重置单例 */
export function _resetAiSessionsRepositoryForTest(): void {
  defaultRepo = null;
}

/**
 * 公开幂等追加入口（harness sink / projector 使用）。
 * storePath 为 JSON 文件路径的测试注入钩子：给定即强制 JSON 文件路径
 * （与开关状态无关，既有测试契约保留）；未给定经选择器分流。
 */
export async function appendAiSessionMessageIdempotent(
  input: AppendAiSessionMessageIdempotentInput,
): Promise<AppendAiSessionMessageIdempotentResult> {
  if (input.storePath) {
    return appendAiSessionMessageIdempotentJson(input);
  }
  return getAiSessionsRepository().appendMessageIdempotent(input);
}
