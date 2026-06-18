// ============================================================
// Change Management Module Export
// ============================================================

export {
  postChangeSubmission,
  getChangeSubmissionHandler,
  listChangeSubmissionsHandler,
  mergeChangeHandler,
  rejectChangeHandler,
} from "./change-management.controller";

export {
  submitChange,
  findChangeSubmissionById,
  listChangeSubmissionsByParent,
  listChangeSubmissionsBySubmitter,
  mergeToVersion,
  reject,
  computeDiff,
} from "./change-management.usecase";

export type {
  SubmitChangeInput,
  DiffResult,
  DiffItemAdded,
  DiffItemRemoved,
  DiffItemModified,
  RejectInput,
} from "./change-management.usecase";
