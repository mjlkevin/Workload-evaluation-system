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
  createdAt: string;
  updatedAt: string;
};
