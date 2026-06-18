// ============================================================
// Sales Briefing Services — barrel export (backward compat)
// ============================================================
// Re-exports from modules/sales-briefing — prefer importing from
// ../modules/sales-briefing/sales-briefing.module directly.

export {
  createBrief,
  findBriefById,
  listBriefsByOwner,
  updateBrief,
  deleteBrief,
  generateQuote,
  recalculate,
} from "../../modules/sales-briefing/sales-briefing.module";

export type {
  CreateBriefInput,
  UpdateBriefInput,
  PriceRange,
  PhaseItem,
  GenerateQuoteInput,
  RecalculateInput,
} from "../../modules/sales-briefing/sales-briefing.module";

// Legacy singleton — retained for any code that still imports it.
// New code should use the module functions directly.
import { OpportunityBriefService } from "./opportunity-brief";
export { OpportunityBriefService };
export const opportunityBriefService = new OpportunityBriefService();
