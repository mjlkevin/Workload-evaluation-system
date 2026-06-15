import { randomUUID } from "node:crypto";

import type { AuthUser } from "../../types";
import { resolveBusinessRole } from "../../middleware/auth";
import { asString } from "../../utils";
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

export function createAiSession(user: AuthUser, input: { title?: unknown; domain?: unknown; workflowKey?: unknown; status?: unknown }): AiSessionRecord {
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
  const store = loadAiSessionsStore();
  store.sessions.unshift(session);
  saveAiSessionsStore(store);
  return session;
}

export function listAiSessions(user: AuthUser, filters: { domain?: unknown; status?: unknown } = {}): AiSessionRecord[] {
  const domain = asString(filters.domain);
  const status = asString(filters.status);
  return loadAiSessionsStore().sessions
    .filter((session) => session.ownerUserId === user.id)
    .filter((session) => !domain || session.domain === domain)
    .filter((session) => !status || session.status === status)
    .sort((a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt)));
}

export function getAiSession(user: AuthUser, sessionId: string): AiSessionRecord | null {
  return loadAiSessionsStore().sessions.find((session) => session.ownerUserId === user.id && session.sessionId === sessionId) || null;
}

export function appendAiSessionEvent(
  user: AuthUser,
  sessionId: string,
  input: { message?: Partial<AiMessage>; attachments?: Array<Partial<AiAttachment>>; artifact?: Partial<AiArtifact>; pendingAction?: Partial<AiPendingAction> }
): AiSessionRecord | null {
  const store = loadAiSessionsStore();
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
        session.attachments.push({
          attachmentId,
          name,
          size: typeof attachmentInput.size === "number" ? attachmentInput.size : undefined,
          type: asString(attachmentInput.type) || undefined,
          createdAt: asString(attachmentInput.createdAt) || nowIso,
        });
        return attachmentId;
      })
      .filter(Boolean)
    : [];
  if (attachmentIds.length > 0) changed = true;
  const messageContent = asString(messageInput?.content);
  if (messageContent) {
    session.messages.push({
      messageId: messageInput?.messageId || randomUUID(),
      role: normalizeMessageRole(messageInput?.role),
      content: messageContent,
      createdAt: messageInput?.createdAt || nowIso,
      attachmentIds: [...normalizeStringArray(messageInput?.attachmentIds), ...attachmentIds],
      artifactIds: normalizeStringArray(messageInput?.artifactIds),
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
  saveAiSessionsStore(store);
  return session;
}
