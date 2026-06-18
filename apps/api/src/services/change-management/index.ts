// ============================================================
// Change Management Services — barrel export (backward compat)
// ============================================================
// Re-exports from modules/change-management — prefer importing from
// ../modules/change-management/change-management.module directly.

export {
  submitChange,
  findChangeSubmissionById,
  listChangeSubmissionsByParent,
  listChangeSubmissionsBySubmitter,
  mergeToVersion,
  reject,
  computeDiff,
} from "../../modules/change-management/change-management.module";

export type {
  SubmitChangeInput,
  DiffResult,
  DiffItemAdded,
  DiffItemRemoved,
  DiffItemModified,
  RejectInput,
} from "../../modules/change-management/change-management.module";

// Legacy singleton — retained for any code that still imports it.
// New code should use the module functions directly.
import { ChangeSubmissionService } from "./change-submission";
export { ChangeSubmissionService };
export const changeSubmissionService = new ChangeSubmissionService();
