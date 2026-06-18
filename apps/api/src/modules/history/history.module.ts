// ============================================================
// History Module Export
// ============================================================

export {
  postProject,
  listProjectsHandler,
  getProjectHandler,
  patchProject,
  deleteProject,
  closeFromBaseline,
  findSimilarHandler,
} from "./history.controller";

export {
  closeProject,
  getProject,
  updateProject,
  removeProject,
  listProjects,
  findSimilarProjects,
} from "./history.usecase";

export type { SimilarProjectResult } from "./history.usecase";
