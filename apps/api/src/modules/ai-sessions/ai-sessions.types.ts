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

export type AiMessageMetadata = Record<string, unknown> & {
  formBlock?: unknown;
  modelRun?: {
    runKind: "attachment_summary" | "attachment_qa" | "knowledge_fallback";
    auditMode: "lightweight";
    createsHarnessRun: false;
    provider: string;
    model: string;
    contextRefs: string[];
    latencyMs: number;
    rawContentLength: number;
    attempts?: number;
    finishReason?: string;
  };
  knowledgeTool?: {
    toolId: "knowledge_base.query_product_knowledge";
    available: boolean;
    retrievalTriggered: boolean;
    confidence: "high" | "low";
    fallbackReason?: "missing_config" | "retrieval_empty" | "retrieval_failed" | "answer_failed" | "empty_answer";
    query: string;
    answer: string;
    model: string;
    knowledgeId: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    latencyMs: number;
    contextRef: string;
    chunksCount: number;
    topScore: number;
  };
};

export type AiMessage = {
  messageId: string;
  role: AiMessageRole;
  content: string;
  createdAt: string;
  attachmentIds?: string[];
  artifactIds?: string[];
  metadata?: AiMessageMetadata;
};

export type AiAttachment = {
  attachmentId: string;
  name: string;
  size?: number;
  type?: string;
  parsedSummary?: string;
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
