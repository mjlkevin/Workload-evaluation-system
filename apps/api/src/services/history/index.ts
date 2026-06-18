// ============================================================
// History Services — barrel export (backward compat)
// ============================================================
// Re-exports from modules/history — prefer importing from
// ../modules/history/history.module directly.

export {
  closeProject,
  getProject,
  updateProject,
  removeProject,
  listProjects,
  findSimilarProjects,
} from "../../modules/history/history.module";

export type {
  SimilarProjectResult,
} from "../../modules/history/history.module";

// Legacy singleton — retained for any code that still imports it.
// New code should use the module functions directly.
import { HistoryProjectService } from "./history-project.service";
export { HistoryProjectService };
export const historyProjectService = new HistoryProjectService();
