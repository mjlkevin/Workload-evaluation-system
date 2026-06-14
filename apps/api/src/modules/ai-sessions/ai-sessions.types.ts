export type AiSessionDomain = "business_evaluation" | "standard_governance";
export type AiSessionStatus =
  | "temporary_chat"
  | "rough_estimate"
  | "project_discovery"
  | "requirement_drafting"
  | "assessment_drafting"
  | "standard_review"
  | "standard_drafting"
  | "linked_record"
  | "archived";

export type AiMessageRole = "user" | "assistant" | "system" | "tool";
export type AiArtifactStatus = "generated" | "accepted" | "linked" | "superseded" | "discarded";
export type AiPendingActionStatus = "pending" | "confirmed" | "cancelled" | "executed" | "failed";
export type AiRiskLevel = "low" | "high";

export type AiMessage = {
  messageId: string;
  role: AiMessageRole;
  content: string;
  createdAt: string;
  attachmentIds?: string[];
  artifactIds?: string[];
};

export type AiAttachment = {
  attachmentId: string;
  name: string;
  size?: number;
  type?: string;
  createdAt: string;
};

export type AiArtifact = {
  artifactId: string;
  type: string;
  title: string;
  content: unknown;
  status: AiArtifactStatus;
  createdAt: string;
  sourceMessageId?: string;
};

export type AiPendingAction = {
  actionId: string;
  actionType: string;
  title: string;
  riskLevel: AiRiskLevel;
  status: AiPendingActionStatus;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  createdAt: string;
  resolvedAt?: string;
};

export type AiSessionLinks = {
  projectId?: string;
  requirementVersionId?: string;
  assessmentVersionId?: string;
  devAssessmentId?: string;
  resourceCostId?: string;
  wbsId?: string;
  reviewId?: string;
  standardVersionId?: string;
  templateVersionId?: string;
  ruleSetVersionId?: string;
};

export type AiSessionRecord = {
  sessionId: string;
  ownerUserId: string;
  ownerUsername: string;
  title: string;
  domain: AiSessionDomain;
  workflowKey: string;
  businessRole: string;
  status: AiSessionStatus;
  summary: string;
  messages: AiMessage[];
  attachments: AiAttachment[];
  artifacts: AiArtifact[];
  pendingActions: AiPendingAction[];
  linkedRecords: AiSessionLinks;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
};

export type AiSessionsStore = {
  sessions: AiSessionRecord[];
};
