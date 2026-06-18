// ============================================================
// CollabWorkspace Service — 评估协同工作区业务层
// ============================================================
// P2-1 核心服务：承载"拉群 → 问答 → 决策"的结构化版本。

import { randomUUID } from "node:crypto";
import { eq, and, desc } from "drizzle-orm";
import { db, type Database } from "../../db/client";
import { collabWorkspaces } from "../../db/schema";
import type { CollabWorkspaceRow, CollabWorkspaceInsert } from "../../db/schema";

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

export class CollabWorkspaceService {
  constructor(private dbInstance: Database = db) {}

  async create(input: CreateWorkspaceInput): Promise<CollabWorkspaceRow> {
    const [row] = await this.dbInstance
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
      .returning();
    return row;
  }

  async findById(id: string): Promise<CollabWorkspaceRow | null> {
    const [row] = await this.dbInstance
      .select()
      .from(collabWorkspaces)
      .where(eq(collabWorkspaces.workspaceId, id));
    return row ?? null;
  }

  async listByUser(userId: string, status?: string): Promise<CollabWorkspaceRow[]> {
    // members 是 jsonb，用简单过滤（精确匹配 userId 子串，生产环境建议用 GIN 索引）
    const rows = await this.dbInstance
      .select()
      .from(collabWorkspaces)
      .orderBy(desc(collabWorkspaces.updatedAt));

    return rows.filter((r) => {
      const members = (r.members ?? []) as MemberEntry[];
      const belongs = members.some((m) => m.userId === userId);
      if (!belongs) return false;
      if (status && r.status !== status) return false;
      return true;
    });
  }

  async update(id: string, input: UpdateWorkspaceInput): Promise<CollabWorkspaceRow | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const set: Partial<CollabWorkspaceInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) set.name = input.name;
    if (input.status !== undefined) set.status = input.status;

    const [row] = await this.dbInstance
      .update(collabWorkspaces)
      .set(set)
      .where(eq(collabWorkspaces.workspaceId, id))
      .returning();
    return row;
  }

  async addMember(id: string, member: MemberEntry): Promise<CollabWorkspaceRow | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const members = [...((existing.members ?? []) as MemberEntry[])];
    if (!members.some((m) => m.userId === member.userId)) {
      members.push(member);
    }

    const [row] = await this.dbInstance
      .update(collabWorkspaces)
      .set({ members: members as any, updatedAt: new Date() })
      .where(eq(collabWorkspaces.workspaceId, id))
      .returning();
    return row;
  }

  async removeMember(id: string, userId: string): Promise<CollabWorkspaceRow | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const members = ((existing.members ?? []) as MemberEntry[]).filter((m) => m.userId !== userId);

    const [row] = await this.dbInstance
      .update(collabWorkspaces)
      .set({ members: members as any, updatedAt: new Date() })
      .where(eq(collabWorkspaces.workspaceId, id))
      .returning();
    return row;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.dbInstance
      .delete(collabWorkspaces)
      .where(eq(collabWorkspaces.workspaceId, id))
      .returning();
    return result.length > 0;
  }
}

export const collabWorkspaceService = new CollabWorkspaceService();
