// ============================================================
// Dev Assessment Services — barrel export (backward compat)
// ============================================================
// Re-exports from modules/dev-assessment — prefer importing from
// ../modules/dev-assessment/dev-assessment.module directly.

export {
  createDevAssessment,
  findDevAssessmentById,
  listDevAssessmentsByVersionId,
  listByAssessedBy,
  listByAssignedBy,
  updateDevAssessment,
  deleteDevAssessment,
  generateDraft,
  mergeToVersion,
} from "../../modules/dev-assessment/dev-assessment.module";

export type {
  CreateDevAssessmentInput,
  UpdateDevAssessmentInput,
  MergeToVersionInput,
  DevAssessmentItemInput,
} from "../../modules/dev-assessment/dev-assessment.module";

export { generateDevAssessmentDraft } from "./dev-assessment-ai";
export type { GenerateDevAssessmentDraftResult } from "./dev-assessment-ai";

// Legacy singleton — retained for any code that still imports it.
// New code should use the module functions directly.
import { DevAssessmentService } from "./dev-assessment";
export { DevAssessmentService };
export const devAssessmentService = new DevAssessmentService();
