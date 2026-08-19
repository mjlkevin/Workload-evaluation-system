import { randomUUID } from "node:crypto";

import type { AuthUser } from "../../types";
import { resolveBusinessRole } from "../../middleware/auth";
import { asString } from "../../utils";
import { AiRunsConflictError } from "../harness/harness-runtime.usecase";
import { loadAiSessionsStore, saveAiSessionsStore } from "./ai-sessions.repository";
import type {
  AiArtifact,
  AiArtifactStatus,
  AiAttachment,
  AiMessage,
  AiMessageRole,
  AiPendingAction,
  AiSessionDomain,
  AiSessionRecord,
  AiSessionStatus,
  AiRiskLevel,
} from "./ai-sessions.types";

const VALID_DOMAINS: AiSessionDomain[] = ["business_evaluation", "standard_governance"];
const VALID_STATUSES: AiSessionStatus[] = [
  "temporary_chat",
  "rough_estimate",
  "project_discovery",
  "requirement_drafting",
  "assessment_drafting",
  "standard_review",
  "standard_drafting",
  "linked_record",
  "archived",
];
const VALID_MESSAGE_ROLES: AiMessageRole[] = ["user", "assistant", "system", "tool"];
const VALID_ARTIFACT_STATUSES: AiArtifactStatus[] = ["generated", "accepted", "linked", "superseded", "discarded"];
const VALID_RISK_LEVELS: AiRiskLevel[] = ["low", "high"];
const PARSED_SUMMARY_MAX_LENGTH = 8000;

function normalizeDomain(value: unknown): AiSessionDomain {
  const domain = asString(value) as AiSessionDomain;
  return VALID_DOMAINS.includes(domain) ? domain : "business_evaluation";
}

function normalizeStatus(value: unknown): AiSessionStatus {
  const status = asString(value) as AiSessionStatus;
  return VALID_STATUSES.includes(status) ? status : "temporary_chat";
}

function normalizeMessageRole(value: unknown): AiMessageRole {
  const role = asString(value) as AiMessageRole;
  return VALID_MESSAGE_ROLES.includes(role) ? role : "user";
}

function normalizeArtifactStatus(value: unknown): AiArtifactStatus {
  const status = asString(value) as AiArtifactStatus;
  return VALID_ARTIFACT_STATUSES.includes(status) ? status : "generated";
}

function normalizeRiskLevel(value: unknown): AiRiskLevel {
  const riskLevel = asString(value) as AiRiskLevel;
  return VALID_RISK_LEVELS.includes(riskLevel) ? riskLevel : "high";
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(asString).filter(Boolean) : [];
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** 阶段 1 批 8：签名改 async（内部 await 已异步化的 accessor），实现 不动。 */
export async function createAiSession(user: AuthUser, input: { title?: unknown; domain?: unknown; workflowKey?: unknown; status?: unknown }): Promise<AiSessionRecord> {
  const nowIso = new Date().toISOString();
  const session: AiSessionRecord = {
    sessionId: randomUUID(),
    ownerUserId: user.id,
    ownerUsername: user.username,
    title: asString(input.title) || "新 AI 会话",
    domain: normalizeDomain(input.domain),
    workflowKey: asString(input.workflowKey) || "free_chat",
    businessRole: resolveBusinessRole(user),
    status: normalizeStatus(input.status),
    summary: "",
    messages: [],
    attachments: [],
    artifacts: [],
    pendingActions: [],
    linkedRecords: {},
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const store = await loadAiSessionsStore();
  store.sessions.unshift(session);
  await saveAiSessionsStore(store);
  return session;
}

/** 阶段 1 批 8：签名改 async（内部 await 已异步化的 accessor），实现 不动。 */
export async function listAiSessions(user: AuthUser, filters: { domain?: unknown; status?: unknown } = {}): Promise<AiSessionRecord[]> {
  const domain = asString(filters.domain);
  const status = asString(filters.status);
  return (await loadAiSessionsStore()).sessions
    .filter((session) => session.ownerUserId === user.id)
    .filter((session) => !domain || session.domain === domain)
    .filter((session) => !status || session.status === status)
    .sort((a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt)));
}

export type AdminAiSessionSummary = {
  sessionId: string;
  title: string;
  ownerUserId: string;
  ownerUsername: string;
  businessRole: string;
  domain: AiSessionDomain;
  workflowKey: string;
  status: AiSessionStatus;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  turnCount: number;
  attachmentCount: number;
  artifactCount: number;
  firstUserMessage: string;
  lastAssistantMessage: string;
};

export type AdminAiSessionFilters = {
  q?: unknown;
  status?: unknown;
  domain?: unknown;
  from?: unknown;
  to?: unknown;
  limit?: unknown;
};

const ADMIN_AUDIT_TEXT_MAX = 120;
const ADMIN_AUDIT_DEFAULT_LIMIT = 200;
const ADMIN_AUDIT_MAX_LIMIT = 500;

function truncateAuditText(value: unknown, max = ADMIN_AUDIT_TEXT_MAX): string {
  const text = asString(value).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 解析时间边界；纯日期（YYYY-MM-DD）且为结束边界时补齐到当天 23:59:59 */
function parseAuditTimeBoundary(value: unknown, endOfDay: boolean): number | null {
  const raw = asString(value).trim();
  if (!raw) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) && endOfDay ? `${raw}T23:59:59.999Z` : raw;
  const ts = Date.parse(normalized);
  return Number.isNaN(ts) ? null : ts;
}

/**
 * 管理员审计视图：跨用户聚合全部会话并输出摘要。
 * 摘要不携带 messages 原文数组，仅保留首轮输入/最终输出截断文本。
 */
/** 阶段 1 批 8：签名改 async（内部 await 已异步化的 accessor），实现 不动。 */
export async function listAllAiSessionsForAdmin(filters: AdminAiSessionFilters = {}): Promise<AdminAiSessionSummary[]> {
  const q = asString(filters.q).trim().toLowerCase();
  const status = asString(filters.status);
  const domain = asString(filters.domain);
  const fromTs = parseAuditTimeBoundary(filters.from, false);
  const toTs = parseAuditTimeBoundary(filters.to, true);
  const limitRaw = Number(asString(filters.limit));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(Math.floor(limitRaw), ADMIN_AUDIT_MAX_LIMIT)
    : ADMIN_AUDIT_DEFAULT_LIMIT;

  return (await loadAiSessionsStore()).sessions
    .filter((session) => !status || session.status === status)
    .filter((session) => !domain || session.domain === domain)
    .filter((session) => {
      if (fromTs === null && toTs === null) return true;
      const updatedAt = Number(new Date(session.updatedAt));
      if (fromTs !== null && updatedAt < fromTs) return false;
      if (toTs !== null && updatedAt > toTs) return false;
      return true;
    })
    .filter((session) => {
      if (!q) return true;
      return [session.sessionId, session.title, session.ownerUsername, session.workflowKey]
        .some((value) => asString(value).toLowerCase().includes(q));
    })
    .sort((a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt)))
    .slice(0, limit)
    .map((session): AdminAiSessionSummary => {
      const firstUserMessage = session.messages.find((message) => message.role === "user");
      const lastAssistantMessage = [...session.messages].reverse().find((message) => message.role === "assistant");
      return {
        sessionId: session.sessionId,
        title: session.title,
        ownerUserId: session.ownerUserId,
        ownerUsername: session.ownerUsername,
        businessRole: asString(session.businessRole),
        domain: session.domain,
        workflowKey: session.workflowKey,
        status: session.status,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.messages.length,
        turnCount: session.messages.filter((message) => message.role === "user").length,
        attachmentCount: session.attachments.length,
        artifactCount: session.artifacts.length,
        firstUserMessage: truncateAuditText(firstUserMessage?.content),
        lastAssistantMessage: truncateAuditText(lastAssistantMessage?.content),
      };
    });
}

/** 阶段 1 批 8：签名改 async（内部 await 已异步化的 accessor），实现 不动。 */
export async function getAiSession(user: AuthUser, sessionId: string): Promise<AiSessionRecord | null> {
  return (await loadAiSessionsStore()).sessions.find((session) => session.ownerUserId === user.id && session.sessionId === sessionId) || null;
}

/** 阶段 1 批 8：签名改 async（内部 await 已异步化的 accessor），实现 不动。 */
export async function renameAiSession(user: AuthUser, sessionId: string, newTitle: unknown): Promise<AiSessionRecord | null> {
  const id = asString(sessionId);
  if (!id) return null;
  const rawTitle = asString(newTitle).trim();
  if (!rawTitle) return null;
  // 标题长度限制：1~80 字符，去除首尾空白
  const title = rawTitle.slice(0, 80);
  const store = await loadAiSessionsStore();
  const session = store.sessions.find((item) => item.ownerUserId === user.id && item.sessionId === id);
  if (!session) return null;
  session.title = title;
  session.updatedAt = new Date().toISOString();
  await saveAiSessionsStore(store);
  return session;
}

export type DeleteAiSessionDeps = {
  /** RP-047 Batch C（D5）：可选活跃 Run 检查器；存在活跃 Run 时删除被 409 拦截 */
  activeRunChecker?: (sessionId: string) => Promise<boolean>;
};

/**
 * 删除会话。缺省（无 checker）保持原有布尔语义（await 解包后仍为 boolean）；
 * 注入 activeRunChecker 时返回 Promise，命中活跃 Run 抛
 * AiRunsConflictError(SESSION_HAS_ACTIVE_RUN) 且不删除会话（规格 §11.3）。
 * 阶段 1 批 8：签名 1 由 boolean 改 Promise<boolean>（统一异步契约），实现 不动。
 */
export function deleteAiSession(user: AuthUser, sessionId: string): Promise<boolean>;
export function deleteAiSession(
  user: AuthUser,
  sessionId: string,
  deps: DeleteAiSessionDeps,
): Promise<boolean>;
export function deleteAiSession(
  user: AuthUser,
  sessionId: string,
  deps?: DeleteAiSessionDeps,
): Promise<boolean> {
  const checker = deps?.activeRunChecker;
  if (!checker) return deleteAiSessionSync(user, sessionId);
  return (async () => {
    const id = asString(sessionId);
    if (!id) return false;
    // 先确认归属，保持与同步路径一致的 not-found 语义
    const store = await loadAiSessionsStore();
    const exists = store.sessions.some((session) => session.ownerUserId === user.id && session.sessionId === id);
    if (!exists) return false;
    if (await checker(id)) {
      throw new AiRunsConflictError("SESSION_HAS_ACTIVE_RUN", "会话存在进行中的异步任务，无法删除");
    }
    return deleteAiSessionSync(user, id);
  })();
}

/** 阶段 1 批 8：签名改 async（内部 await 已异步化的 accessor），实现 不动。 */
async function deleteAiSessionSync(user: AuthUser, sessionId: string): Promise<boolean> {
  const id = asString(sessionId);
  if (!id) return false;
  const store = await loadAiSessionsStore();
  const beforeCount = store.sessions.length;
  store.sessions = store.sessions.filter((session) => !(session.ownerUserId === user.id && session.sessionId === id));
  if (store.sessions.length === beforeCount) return false;
  await saveAiSessionsStore(store);
  return true;
}

/** 阶段 1 批 8：签名改 async（内部 await 已异步化的 accessor），实现 不动。 */
export async function appendAiSessionEvent(
  user: AuthUser,
  sessionId: string,
  input: { message?: Partial<AiMessage>; attachments?: Array<Partial<AiAttachment>>; artifact?: Partial<AiArtifact>; pendingAction?: Partial<AiPendingAction> }
): Promise<AiSessionRecord | null> {
  const store = await loadAiSessionsStore();
  const session = store.sessions.find((item) => item.ownerUserId === user.id && item.sessionId === sessionId);
  if (!session) return null;

  const nowIso = new Date().toISOString();
  let changed = false;
  const messageInput = input.message;
  const attachmentIds = Array.isArray(input.attachments)
    ? input.attachments
      .map((attachmentInput) => {
        const name = asString(attachmentInput.name);
        if (!name) return "";
        const attachmentId = asString(attachmentInput.attachmentId) || randomUUID();
        const parsedSummaryRaw = asString(attachmentInput.parsedSummary);
        const parsedSummary = parsedSummaryRaw
          ? parsedSummaryRaw.length > PARSED_SUMMARY_MAX_LENGTH
            ? `${parsedSummaryRaw.slice(0, PARSED_SUMMARY_MAX_LENGTH)}…[truncated]`
            : parsedSummaryRaw
          : undefined;
        session.attachments.push({
          attachmentId,
          name,
          size: typeof attachmentInput.size === "number" ? attachmentInput.size : undefined,
          type: asString(attachmentInput.type) || undefined,
          ...(parsedSummary ? { parsedSummary } : {}),
          createdAt: asString(attachmentInput.createdAt) || nowIso,
        });
        return attachmentId;
      })
      .filter(Boolean)
    : [];
  if (attachmentIds.length > 0) changed = true;
  const messageContent = asString(messageInput?.content);
  if (messageContent) {
    const metadata = normalizeRecord(messageInput?.metadata);
    session.messages.push({
      messageId: messageInput?.messageId || randomUUID(),
      role: normalizeMessageRole(messageInput?.role),
      content: messageContent,
      createdAt: messageInput?.createdAt || nowIso,
      attachmentIds: [...normalizeStringArray(messageInput?.attachmentIds), ...attachmentIds],
      artifactIds: normalizeStringArray(messageInput?.artifactIds),
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    });
    changed = true;
  }
  const artifactInput = input.artifact;
  const artifactTitle = asString(artifactInput?.title);
  if (artifactTitle) {
    session.artifacts.push({
      artifactId: artifactInput?.artifactId || randomUUID(),
      type: asString(artifactInput?.type) || "note",
      title: artifactTitle,
      content: artifactInput?.content ?? "",
      status: normalizeArtifactStatus(artifactInput?.status),
      createdAt: artifactInput?.createdAt || nowIso,
      sourceMessageId: artifactInput?.sourceMessageId,
    });
    changed = true;
  }
  const pendingActionInput = input.pendingAction;
  const pendingActionTitle = asString(pendingActionInput?.title);
  if (pendingActionTitle) {
    session.pendingActions.push({
      actionId: pendingActionInput?.actionId || randomUUID(),
      actionType: asString(pendingActionInput?.actionType) || "unknown",
      title: pendingActionTitle,
      riskLevel: normalizeRiskLevel(pendingActionInput?.riskLevel),
      status: "pending",
      payload: normalizeRecord(pendingActionInput?.payload),
      createdAt: pendingActionInput?.createdAt || nowIso,
    });
    changed = true;
  }
  if (!changed) return session;
  session.updatedAt = nowIso;
  await saveAiSessionsStore(store);
  return session;
}
