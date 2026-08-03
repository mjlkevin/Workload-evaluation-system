// ============================================================
// Harness 领域类型
// ============================================================
// WES Harness Phase 1A：定义运行状态、证据、产物、工具事件、模型运行等
// 核心枚举与类型校验函数，供 repository / usecase / controller 共享。

export const HARNESS_RUN_MODES = ["interactive", "replay", "regression"] as const;
export type HarnessRunMode = (typeof HARNESS_RUN_MODES)[number];

export const HARNESS_RUN_STAGES = [
  "uploaded",
  "parsing",
  "evidence_ready",
  "analyzing",
  "report_v1_ready",
  "clarifying",
  "report_v2_ready",
  "ready_for_estimation",
  "project_link_pending",
  "project_linked",
  "requirement_draft_pending",
  "completed",
  "failed",
  "cancelled",
  "needs_user_input",
  "failed_schema_validation",
] as const;
export type HarnessRunStage = (typeof HARNESS_RUN_STAGES)[number];

export const HARNESS_RUN_STATUSES = [
  "queued",
  "running",
  "waiting",
  "recovering",
  "cancelling",
  "completed",
  "failed",
  "cancelled",
] as const;
export type HarnessRunStatus = (typeof HARNESS_RUN_STATUSES)[number];

export const HARNESS_SOURCE_TYPES = ["attachment", "standard_file"] as const;
export type HarnessSourceType = (typeof HARNESS_SOURCE_TYPES)[number];

export const HARNESS_EVIDENCE_TYPES = ["block", "item"] as const;
export type HarnessEvidenceType = (typeof HARNESS_EVIDENCE_TYPES)[number];

export const HARNESS_ARTIFACT_TYPES = [
  "file_understanding",
  "requirement_report_v1",
  "clarification_questions",
  "requirement_report_v2",
  "rough_estimate_assumptions",
  "pending_action_suggestion",
] as const;
export type HarnessArtifactType = (typeof HARNESS_ARTIFACT_TYPES)[number];

export const HARNESS_ACTION_STATUSES = ["pending", "confirmed", "cancelled", "executed", "failed"] as const;
export type HarnessActionStatus = (typeof HARNESS_ACTION_STATUSES)[number];

export const MANUAL_TEST_RESULT_STATUSES = ["passed", "failed", "blocked", "skipped"] as const;
export type ManualTestResultStatus = (typeof MANUAL_TEST_RESULT_STATUSES)[number];

export type CreateManualTestResultInput = {
  harnessRunId?: string;
  harnessToolEventId?: string;
  testCaseKey?: string;
  executorName: string;
  environment: string;
  account?: string;
  screenshotUrl?: string;
  resultStatus: ManualTestResultStatus;
  notes?: string;
  metadata?: Record<string, unknown>;
};

export type UpdateManualTestResultInput = Partial<CreateManualTestResultInput>;

export type HarnessRunLinks = {
  aiSessionId?: string;
  projectEvaluationId?: string;
  requirementVersionId?: string;
};

export type HarnessFileMetadata = {
  attachmentId: string;
  fileName: string;
  fileSize?: number;
  mimeType?: string;
  fileHash?: string;
  storagePath?: string;
  role?: string;
  roleConfidence?: number;
};

export type HarnessAnswerInput = {
  field: string;
  value: unknown;
  source: "user_chat" | "structured_form";
};

export type HarnessParsedFileItemInput = {
  sourceSheet?: string;
  sourceCell?: string;
  category?: string;
  text: string;
  metadata?: Record<string, unknown>;
};

export type HarnessParsedFileInput = {
  fileId?: string;
  sourceFile: string;
  sheets?: string[];
  summary?: {
    projectName?: string;
    customerName?: string;
    industry?: string;
    [key: string]: unknown;
  };
  items?: HarnessParsedFileItemInput[];
};

export type HarnessEvidenceInput = {
  harnessRunId: string;
  harnessFileId?: string | null;
  evidenceType: HarnessEvidenceType;
  sourceRef: string;
  content: Record<string, unknown>;
  confidence?: number | null;
};

export type HarnessFileUnderstandingContent = {
  version: "v1";
  sourceFile: string;
  sourceSheets: string[];
  project: { projectName: string; customerName: string; industry: string };
  extractedItemCount: number;
};

export type HarnessRequirementReportV1Content = {
  version: "v1";
  sourceFile: string;
  project: {
    projectName: string;
    customerName: string;
    industry: string;
  };
  sourceSheets: string[];
  requirementFindings: Array<{
    domain: string;
    scenario: string;
    moduleHint: string;
    confidence: number;
    evidenceRefs: string[];
  }>;
  missingFields: Array<{
    field: string;
    reason: string;
    priority: "must" | "should" | "could";
  }>;
  clarificationQuestions: Array<{
    question: string;
    targetRole: string;
    reason: string;
  }>;
  risks: Array<{
    title: string;
    assumption: string;
    impact: string;
  }>;
  nextActions: Array<{
    label: string;
    actionType: string;
  }>;
};

export type HarnessRequirementReportV2Content = {
  version: "v2";
  sourceFile: string;
  project: {
    projectName: string;
    customerName: string;
    industry: string;
  };
  sourceSheets: string[];
  requirementFindings: Array<{
    domain: string;
    scenario: string;
    moduleHint: string;
    confidence: number;
    evidenceRefs: string[];
  }>;
  missingFields: Array<{
    field: string;
    reason: string;
    priority: "must" | "should" | "could";
  }>;
  clarificationQuestions: Array<{
    question: string;
    targetRole: string;
    reason: string;
  }>;
  answeredQuestions: Array<{
    question: string;
    answer: unknown;
    source?: string;
  }>;
  risks: Array<{
    title: string;
    assumption: string;
    impact: string;
  }>;
  nextActions: Array<{
    label: string;
    actionType: string;
  }>;
  clarificationSummary: string;
};

export type HarnessConfirmableActionType =
  | "create_project_evaluation"
  | "link_project_evaluation"
  | "enter_formal_estimation"
  | "create_requirement_draft"
  | "publish_standard_version"
  | "overwrite_assessment_result"
  | "export_delivery_document";

const HARNESS_STAGE_ORDER: Record<HarnessRunStage, number> = {
  uploaded: 0,
  parsing: 1,
  evidence_ready: 2,
  analyzing: 3,
  report_v1_ready: 4,
  clarifying: 5,
  report_v2_ready: 6,
  ready_for_estimation: 7,
  project_link_pending: 8,
  project_linked: 9,
  requirement_draft_pending: 10,
  completed: 11,
  failed: -1,
  cancelled: -1,
  needs_user_input: -1,
  failed_schema_validation: -1,
};

const STAGE_STATUS: Record<HarnessRunStage, HarnessRunStatus> = {
  uploaded: "waiting",
  parsing: "running",
  evidence_ready: "waiting",
  analyzing: "running",
  report_v1_ready: "waiting",
  clarifying: "waiting",
  report_v2_ready: "waiting",
  ready_for_estimation: "waiting",
  project_link_pending: "waiting",
  project_linked: "waiting",
  requirement_draft_pending: "waiting",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
  needs_user_input: "waiting",
  failed_schema_validation: "failed",
};

export function isHarnessRunStage(value: unknown): value is HarnessRunStage {
  return typeof value === "string" && (HARNESS_RUN_STAGES as readonly string[]).includes(value);
}

export function normalizeHarnessRunMode(value: unknown): HarnessRunMode {
  return typeof value === "string" && (HARNESS_RUN_MODES as readonly string[]).includes(value)
    ? (value as HarnessRunMode)
    : "interactive";
}

export function canRetryHarnessStage(stage: HarnessRunStage): boolean {
  return stage === "failed" || stage === "failed_schema_validation";
}

export function expectedStatusForHarnessStage(stage: HarnessRunStage): HarnessRunStatus {
  return STAGE_STATUS[stage];
}

export function isValidHarnessStageStatus(stage: HarnessRunStage, status: HarnessRunStatus): boolean {
  return expectedStatusForHarnessStage(stage) === status;
}

export function isHarnessStageAtLeast(stage: HarnessRunStage, minimum: HarnessRunStage): boolean {
  return HARNESS_STAGE_ORDER[stage] >= HARNESS_STAGE_ORDER[minimum];
}

export function nextStageForConfirmedAction(actionType: string): HarnessRunStage | null {
  switch (actionType) {
    case "create_project_evaluation":
    case "link_project_evaluation":
      return "project_link_pending";
    case "enter_formal_estimation":
      return "ready_for_estimation";
    case "create_requirement_draft":
      return "requirement_draft_pending";
    case "publish_standard_version":
    case "overwrite_assessment_result":
    case "export_delivery_document":
      return null;
    default:
      return null;
  }
}
