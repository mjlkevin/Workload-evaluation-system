// ============================================================
// Sales Briefing Module Export
// ============================================================

export {
  postBrief,
  listBriefsHandler,
  getBriefHandler,
  patchBrief,
  deleteBriefHandler,
  generateQuoteHandler,
  recalculateHandler,
} from "./sales-briefing.controller";

export {
  createBrief,
  findBriefById,
  listBriefsByOwner,
  updateBrief,
  deleteBrief,
  generateQuote,
  recalculate,
} from "./sales-briefing.usecase";

export type {
  CreateBriefInput,
  UpdateBriefInput,
  PriceRange,
  PhaseItem,
  GenerateQuoteInput,
  RecalculateInput,
} from "./sales-briefing.usecase";
