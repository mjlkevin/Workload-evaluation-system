import { randomUUID } from "node:crypto";
import { eq, and, desc } from "drizzle-orm";
import { db, type Database } from "../../db/client";
import { collabWorkspaces, collabMessages } from "../../db/schema";
import type {
  CollabWorkspaceRow,
  CollabWorkspaceInsert,
  CollabMessageRow,
  CollabMessageInsert,
} from "../../db/schema";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface CreateWorkspaceInput {
  name: string;
  assessmentVersionId?: string;
  requirementPackId?: string;
  createdByUserId?: string;
}

export interface UpdateWorkspaceInput {
  name?: string;
  status?: "active" | "archived";
}

export interface MemberEntry {
  userId: string;
  role: string;
  joinedAt: string;
}

export interface CreateMessageInput {
  workspaceId: string;
  messageType: "question" | "reply" | "decision" | "notice";
  parentMessageId?: string;
  senderUserId?: string;
  senderRole?: string;
  content: string;
  relatedFieldPath?: string;
  decisionPayload?: Record<string, unknown>;
}

export interface UpdateMessageInput {
  content?: string;
  status?: "open" | "resolved" | "closed";
  evidenceId?: string;
  decisionPayload?: Record<string, unknown>;
}

// ------------------------------------------------------------------
// Workspace CRUD
// ------------------------------------------------------------------

export function createWorkspace(
  input: CreateWorkspaceInput,
  dbInstance: Database = db,
): Promise<CollabWorkspaceRow> {
  return dbInstance
    .insert(collabWorkspaces)
    .values({
      workspaceId: randomUUID(),
      name: input.name,
      assessmentVersionId: input.assessmentVersionId,
      requirementPackId: input.requirementPackId,
      members: input.createdByUserId
        ? [{ userId: input.createdByUserId, role: "owner", joinedAt: new Date().toISOString() }]
        : [],
      status: "active",
      createdByUserId: input.createdByUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as CollabWorkspaceInsert)
    .returning()
    .then((rows) => rows[0]);
}

export function findWorkspaceById(
  id: string,
  dbInstance: Database = db,
): Promise<CollabWorkspaceRow | null> {
  return dbInstance
    .select()
    .from(collabWorkspaces)
    .where(eq(collabWorkspaces.workspaceId, id))
    .then((rows) => rows[0] ?? null);
}

export function listWorkspacesByUser(
  userId: string,
  status: string | undefined,
  dbInstance: Database = db,
): Promise<CollabWorkspaceRow[]> {
  return dbInstance
    .select()
    .from(collabWorkspaces)
    .orderBy(desc(collabWorkspaces.updatedAt))
    .then((rows) =>
      rows.filter((r) => {
        const members = (r.members ?? []) as MemberEntry[];
        const belongs = members.some((m) => m.userId === userId);
        if (!belongs) return false;
        if (status && r.status !== status) return false;
        return true;
      }),
    );
}

export function updateWorkspace(
  id: string,
  input: UpdateWorkspaceInput,
  dbInstance: Database = db,
): Promise<CollabWorkspaceRow | null> {
  return findWorkspaceById(id, dbInstance).then((existing) => {
    if (!existing) return null;

    const set: Partial<CollabWorkspaceInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) set.name = input.name;
    if (input.status !== undefined) set.status = input.status;

    return dbInstance
      .update(collabWorkspaces)
      .set(set)
      .where(eq(collabWorkspaces.workspaceId, id))
      .returning()
      .then((rows) => rows[0] ?? null);
  });
}

export function deleteWorkspace(
  id: string,
  dbInstance: Database = db,
): Promise<boolean> {
  return dbInstance
    .delete(collabWorkspaces)
    .where(eq(collabWorkspaces.workspaceId, id))
    .returning()
    .then((rows) => rows.length > 0);
}

export function addWorkspaceMember(
  id: string,
  member: MemberEntry,
  dbInstance: Database = db,
): Promise<CollabWorkspaceRow | null> {
  return findWorkspaceById(id, dbInstance).then((existing) => {
    if (!existing) return null;

    const members = [...((existing.members ?? []) as MemberEntry[])];
    if (!members.some((m) => m.userId === member.userId)) {
      members.push(member);
    }

    return dbInstance
      .update(collabWorkspaces)
      .set({ members: members as any, updatedAt: new Date() })
      .where(eq(collabWorkspaces.workspaceId, id))
      .returning()
      .then((rows) => rows[0] ?? null);
  });
}

export function removeWorkspaceMember(
  id: string,
  userId: string,
  dbInstance: Database = db,
): Promise<CollabWorkspaceRow | null> {
  return findWorkspaceById(id, dbInstance).then((existing) => {
    if (!existing) return null;

    const members = ((existing.members ?? []) as MemberEntry[]).filter(
      (m) => m.userId !== userId,
    );

    return dbInstance
      .update(collabWorkspaces)
      .set({ members: members as any, updatedAt: new Date() })
      .where(eq(collabWorkspaces.workspaceId, id))
      .returning()
      .then((rows) => rows[0] ?? null);
  });
}

// ------------------------------------------------------------------
// Message CRUD
// ------------------------------------------------------------------

export function createMessage(
  input: CreateMessageInput,
  dbInstance: Database = db,
): Promise<CollabMessageRow> {
  return dbInstance
    .insert(collabMessages)
    .values({
      messageId: randomUUID(),
      workspaceId: input.workspaceId,
      messageType: input.messageType,
      parentMessageId: input.parentMessageId,
      senderUserId: input.senderUserId,
      senderRole: input.senderRole,
      content: input.content,
      relatedFieldPath: input.relatedFieldPath,
      decisionPayload: input.decisionPayload,
      status: input.messageType === "question" ? "open" : "resolved",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as CollabMessageInsert)
    .returning()
    .then((rows) => rows[0]);
}

export function findMessageById(
  id: string,
  dbInstance: Database = db,
): Promise<CollabMessageRow | null> {
  return dbInstance
    .select()
    .from(collabMessages)
    .where(eq(collabMessages.messageId, id))
    .then((rows) => rows[0] ?? null);
}

export function listMessagesByWorkspace(
  workspaceId: string,
  options: { messageType?: string; status?: string } = {},
  dbInstance: Database = db,
): Promise<CollabMessageRow[]> {
  const conds = [eq(collabMessages.workspaceId, workspaceId)];
  if (options.messageType) {
    conds.push(eq(collabMessages.messageType, options.messageType as any));
  }
  if (options.status) {
    conds.push(eq(collabMessages.status, options.status as any));
  }
  return dbInstance
    .select()
    .from(collabMessages)
    .where(and(...conds))
    .orderBy(desc(collabMessages.createdAt));
}

export function updateMessage(
  id: string,
  input: UpdateMessageInput,
  dbInstance: Database = db,
): Promise<CollabMessageRow | null> {
  return findMessageById(id, dbInstance).then((existing) => {
    if (!existing) return null;

    const set: Partial<CollabMessageInsert> = { updatedAt: new Date() };
    if (input.content !== undefined) set.content = input.content;
    if (input.status !== undefined) set.status = input.status;
    if (input.evidenceId !== undefined) set.evidenceId = input.evidenceId;
    if (input.decisionPayload !== undefined) set.decisionPayload = input.decisionPayload;

    return dbInstance
      .update(collabMessages)
      .set(set)
      .where(eq(collabMessages.messageId, id))
      .returning()
      .then((rows) => rows[0] ?? null);
  });
}

export function deleteMessage(
  id: string,
  dbInstance: Database = db,
): Promise<boolean> {
  return dbInstance
    .delete(collabMessages)
    .where(eq(collabMessages.messageId, id))
    .returning()
    .then((rows) => rows.length > 0);
}

export function findMessageReplies(
  parentMessageId: string,
  dbInstance: Database = db,
): Promise<CollabMessageRow[]> {
  return dbInstance
    .select()
    .from(collabMessages)
    .where(eq(collabMessages.parentMessageId, parentMessageId))
    .orderBy(desc(collabMessages.createdAt));
}

export function countOpenQuestions(
  workspaceId: string,
  dbInstance: Database = db,
): Promise<number> {
  return dbInstance
    .select()
    .from(collabMessages)
    .where(
      and(
        eq(collabMessages.workspaceId, workspaceId),
        eq(collabMessages.messageType, "question"),
        eq(collabMessages.status, "open"),
      ),
    )
    .then((rows) => rows.length);
}
