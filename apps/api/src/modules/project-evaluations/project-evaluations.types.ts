export type ProjectEvaluationStatus = "draft" | "active" | "reviewing" | "published" | "archived";

export type ProjectEvaluationPlan = {
  projectId: string;
  projectName: string;
  customerName: string;
  industry: string;
  currentStage: string;
  status: ProjectEvaluationStatus;
  ownerUserId: string;
  ownerUsername: string;
  participantUserIds: string[];
  currentRequirementVersionId?: string;
  currentAssessmentVersionId?: string;
  currentDevAssessmentId?: string;
  currentResourceCostId?: string;
  currentWbsId?: string;
  defaultStandardVersionId?: string;
  createdFromSessionId?: string;
  sourceGlobalVersionRecordId?: string;
  createdFromHarnessRunId?: string;
  createdFromHarnessActionId?: string;
  assessmentVersionCode?: string;
  aiDraftReviewStatus?: "pending" | "confirmed";
  aiDraftConfirmedAt?: string;
  aiDraftConfirmedByUsername?: string;
  createdAt: string;
  updatedAt: string;
};

export type AiDraftManualConfirmation = {
  status: "confirmed";
  confirmedAt: string;
  confirmedByUserId: string;
  confirmedByUsername: string;
  note?: string;
  harnessToolEventId?: string;
};

export type AiAssessmentDraft = {
  recordId: string;
  versionCode: string;
  status: "draft_from_ai";
  manualConfirmation?: AiDraftManualConfirmation;
};

export type ProjectEvaluationDraftBundle = {
  project: ProjectEvaluationPlan;
  assessmentDraft: AiAssessmentDraft;
};

export type AiAssessmentDraftManualConfirmResult = ProjectEvaluationDraftBundle & {
  harness: {
    runId: string;
    actionId: string;
    toolEventId: string;
    status: "confirmed";
  };
};
