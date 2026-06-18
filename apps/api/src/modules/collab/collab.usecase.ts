import type { CollabMessageRow } from "../../db/schema";
import {
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
  findMessageReplies,
  countOpenQuestions,
  type CreateWorkspaceInput,
  type UpdateWorkspaceInput,
  type MemberEntry,
  type CreateMessageInput,
  type UpdateMessageInput,
} from "./collab.repository";

export type { CreateWorkspaceInput, UpdateWorkspaceInput, MemberEntry, CreateMessageInput, UpdateMessageInput };

// ------------------------------------------------------------------
// Workspace passthrough
// ------------------------------------------------------------------

export { createWorkspace, findWorkspaceById, listWorkspacesByUser, updateWorkspace, deleteWorkspace, addWorkspaceMember, removeWorkspaceMember };

// ------------------------------------------------------------------
// Message passthrough + thread
// ------------------------------------------------------------------

export { createMessage, findMessageById, listMessagesByWorkspace, updateMessage, deleteMessage, countOpenQuestions };

export async function getMessageThread(questionId: string): Promise<CollabMessageRow[]> {
  const question = await findMessageById(questionId);
  if (!question) return [];

  const replies = await findMessageReplies(questionId);
  return [question, ...replies];
}
