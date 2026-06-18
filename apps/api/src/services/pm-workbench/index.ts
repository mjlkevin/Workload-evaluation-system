// ============================================================
// PM Workbench Services — barrel export (backward compat)
// ============================================================
// Re-exports from modules/pm-workbench — prefer importing from
// ../modules/pm-workbench/pm-workbench.module directly.

export {
  seal,
  findSealedBaselineById,
  findSealedBaselineByVersionId,
  listSealedBaselinesByStatus,
  supersedeSealedBaseline,
  deleteSealedBaseline,
  generateAllDeliverables,
  findDeliverableById,
  listDeliverablesByVersion,
  findDeliverableByVersionAndType,
  updateDeliverableStatus,
  deleteDeliverable,
  createQualityGateReview,
  autoReview,
  findQualityGateReviewById,
  findQualityGateReviewByVersionId,
  updateQualityGateReview,
  deleteQualityGateReview,
  createAssessmentNarrative,
  generateNarrativeDraft,
  findAssessmentNarrativeById,
  findAssessmentNarrativeByVersionId,
  updateAssessmentNarrative,
  deleteAssessmentNarrative,
  createAssessmentHandoff,
  findAssessmentHandoffById,
  listAssessmentHandoffsByVersion,
  listAssessmentHandoffsByToRole,
  updateAssessmentHandoff,
  deleteAssessmentHandoff,
} from "../../modules/pm-workbench/pm-workbench.module";

export type {
  SealInput,
  GenerateDeliverablesInput,
  DeliverableType,
  CreateReviewInput,
  UpdateReviewInput,
  CreateNarrativeInput,
  UpdateNarrativeInput,
  CreateHandoffInput,
  UpdateHandoffInput,
  V2Role,
} from "../../modules/pm-workbench/pm-workbench.module";

// Legacy singletons — retained for backward compat.
import { SealedBaselineService } from "./sealed-baseline";
import { DeliverableService } from "./deliverable";
import { QualityGateReviewService } from "./quality-gate-review";
import { AssessmentNarrativeService } from "./assessment-narrative";
import { AssessmentHandoffService } from "./assessment-handoff";

export { SealedBaselineService, DeliverableService, QualityGateReviewService, AssessmentNarrativeService, AssessmentHandoffService };
export const sealedBaselineService = new SealedBaselineService();
export const deliverableService = new DeliverableService();
export const qualityGateReviewService = new QualityGateReviewService();
export const assessmentNarrativeService = new AssessmentNarrativeService();
export const assessmentHandoffService = new AssessmentHandoffService();
