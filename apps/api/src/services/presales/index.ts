// ============================================================
// Presales Services — barrel export (backward compat)
// ============================================================
// Re-exports from modules/presales — prefer importing from
// ../modules/presales/presales.module directly.

export {
  createFromExtraction,
  findRequirementPackById,
  listRequirementPacksByOwner,
  updateRequirementPack,
  deleteRequirementPack,
  reviewPack,
  getFieldConfidences,
  generateFromPack,
  findInitialEstimateById,
  findInitialEstimateByPackId,
  listInitialEstimatesByOwner,
  updateInitialEstimate,
  deleteInitialEstimate,
  generateSowFromPack,
  findSowDocumentById,
  findSowDocumentsByPackId,
  listSowDocumentsByOwner,
  updateSowDocument,
  deleteSowDocument,
  bumpSowVersion,
} from "../../modules/presales/presales.module";

export type {
  CreateRequirementPackInput,
  UpdateRequirementPackInput,
  EstimateLineItem,
  PhaseProposal,
  UpdateEstimateInput,
  SowLineItem,
  UpdateSowInput,
  FieldConfidence,
  InquiryItem,
  ReviewResult,
} from "../../modules/presales/presales.module";

// Legacy singletons — retained for backward compat.
import { RequirementPackService } from "./requirement-pack";
import { InitialEstimateService } from "./initial-estimate";
import { SowService } from "./sow";

export { RequirementPackService, InitialEstimateService, SowService };
export const requirementPackService = new RequirementPackService();
export const initialEstimateService = new InitialEstimateService();
export const sowService = new SowService();
