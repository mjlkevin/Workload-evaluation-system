// ============================================================
// Collab Services — barrel export (backward compat)
// ============================================================
// Re-exports from modules/collab — prefer importing from
// ../modules/collab/collab.module directly.

export {
  createWorkspace,
  findWorkspaceById,
  listWorkspacesByUser,
  updateWorkspace,
  deleteWorkspace,
  addWorkspaceMember,
  removeWorkspaceMember,
  createMessage,
  findMessageById,
  listMessagesByWorkspace,
  updateMessage,
  deleteMessage,
  getMessageThread,
  countOpenQuestions,
} from "../../modules/collab/collab.module";

export type {
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  MemberEntry,
  CreateMessageInput,
  UpdateMessageInput,
} from "../../modules/collab/collab.module";

// Legacy singletons — retained for any code that still imports them.
// New code should use the module functions directly.
import { CollabWorkspaceService } from "./workspace";
import { CollabMessageService } from "./message";
export { CollabWorkspaceService, CollabMessageService };
export const collabWorkspaceService = new CollabWorkspaceService();
export const collabMessageService = new CollabMessageService();
