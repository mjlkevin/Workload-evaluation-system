// ============================================================
// SOW Service — 实施工作说明书业务层
// ============================================================
// P1-1 核心服务：从 RequirementPack → SOWDocument 条目，
// 支持范围描述、定制范围、版本管理、变更关联评估版本。

import { randomUUID } from "node:crypto";
import { eq, and, desc } from "drizzle-orm";
import { db, type Database } from "../../db/client";
import { sowDocuments } from "../../db/schema";
import type { RequirementPackRow } from "../../db/schema";

// ------------------------------------------------------------------
// 类型
// ------------------------------------------------------------------

export interface SowLineItem {
  cloudProduct: string;
  module: string;
  category?: string;
  description?: string;
  customizationScope?: string;
}

export interface GenerateSowInput {
  requirementPack: RequirementPackRow;
  cloudProduct?: string; // 默认 "金蝶AI星空"
  ownerUserId?: string;
}

export interface UpdateSowInput {
  cloudProduct?: string;
  module?: string;
  category?: string;
  description?: string;
  customizationScope?: string;
  version?: string;
  status?: "draft" | "confirmed" | "changed";
  linkedAssessmentVersionId?: string;
}

// ------------------------------------------------------------------
// Service
// ------------------------------------------------------------------

export class SowService {
  constructor(private dbInstance: Database = db) {}

  /**
   * 从 RequirementPack 生成 SOW 条目列表。
   * 每个模块生成一条 SOWDocument，category 按是否有定制推断。
   */
  async generateFromPack(input: GenerateSowInput): Promise<typeof sowDocuments.$inferSelect[]> {
    const { requirementPack: pack, cloudProduct = "金蝶AI星空" } = input;

    const modules = (pack.modules ?? []) as Array<{
      moduleName?: string;
      subModules?: string[];
      customization?: boolean;
    }>;

    if (modules.length === 0) {
      // 无模块时生成一条占位 SOW
      const [row] = await this.dbInstance
        .insert(sowDocuments)
        .values({
          sowDocumentId: randomUUID(),
          requirementPackId: pack.requirementPackId,
          cloudProduct,
          module: "待确认模块范围",
          category: "标准功能",
          description: "基于当前需求包，模块范围尚未明确，需售前顾问补充。",
          customizationScope: undefined,
          version: "1.0",
          status: "draft",
          ownerUserId: input.ownerUserId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      return [row];
    }

    const rows: typeof sowDocuments.$inferSelect[] = [];
    for (const mod of modules) {
      const moduleName = mod.moduleName ?? "未命名模块";
      const hasCustomization = mod.customization === true || (mod.subModules ?? []).some((s: string) =>
        s.toLowerCase().includes("定制") || s.toLowerCase().includes("开发")
      );
      const category = hasCustomization ? "定制开发" : "标准功能";
      const description = `模块「${moduleName}」的实施范围包含${(mod.subModules ?? []).length}个子项。`;
      const customizationScope = hasCustomization
        ? `包含定制开发：${(mod.subModules ?? []).filter((s: string) => s.toLowerCase().includes("定制") || s.toLowerCase().includes("开发")).join("、")}`
        : undefined;

      const [row] = await this.dbInstance
        .insert(sowDocuments)
        .values({
          sowDocumentId: randomUUID(),
          requirementPackId: pack.requirementPackId,
          cloudProduct,
          module: moduleName,
          category,
          description,
          customizationScope,
          version: "1.0",
          status: "draft",
          ownerUserId: input.ownerUserId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      rows.push(row);
    }

    return rows;
  }

  /** 按 ID 查询 */
  async findById(id: string): Promise<typeof sowDocuments.$inferSelect | null> {
    const [row] = await this.dbInstance.select().from(sowDocuments).where(eq(sowDocuments.sowDocumentId, id));
    return row ?? null;
  }

  /** 按 requirementPackId 查询 */
  async findByPackId(packId: string): Promise<typeof sowDocuments.$inferSelect[]> {
    return this.dbInstance
      .select()
      .from(sowDocuments)
      .where(eq(sowDocuments.requirementPackId, packId))
      .orderBy(desc(sowDocuments.createdAt));
  }

  /** 按 owner 列表 */
  async listByOwner(ownerUserId: string, status?: string): Promise<typeof sowDocuments.$inferSelect[]> {
    const conds = [eq(sowDocuments.ownerUserId, ownerUserId)];
    if (status) {
      // @ts-expect-error dynamic enum filter
      conds.push(eq(sowDocuments.status, status));
    }
    return this.dbInstance
      .select()
      .from(sowDocuments)
      .where(and(...conds))
      .orderBy(desc(sowDocuments.updatedAt));
  }

  /** 更新 */
  async update(id: string, input: UpdateSowInput): Promise<typeof sowDocuments.$inferSelect | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const set: Partial<typeof sowDocuments.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (input.cloudProduct !== undefined) set.cloudProduct = input.cloudProduct;
    if (input.module !== undefined) set.module = input.module;
    if (input.category !== undefined) set.category = input.category;
    if (input.description !== undefined) set.description = input.description;
    if (input.customizationScope !== undefined) set.customizationScope = input.customizationScope;
    if (input.version !== undefined) set.version = input.version;
    if (input.status !== undefined) set.status = input.status;
    if (input.linkedAssessmentVersionId !== undefined) set.linkedAssessmentVersionId = input.linkedAssessmentVersionId;

    const [row] = await this.dbInstance.update(sowDocuments).set(set).where(eq(sowDocuments.sowDocumentId, id)).returning();
    return row;
  }

  /** 删除 */
  async delete(id: string): Promise<boolean> {
    const result = await this.dbInstance.delete(sowDocuments).where(eq(sowDocuments.sowDocumentId, id)).returning();
    return result.length > 0;
  }

  /** 批量更新版本号（SOW 变更时升版） */
  async bumpVersion(packId: string, newVersion: string): Promise<number> {
    const result = await this.dbInstance
      .update(sowDocuments)
      .set({ version: newVersion, status: "changed", updatedAt: new Date() })
      .where(eq(sowDocuments.requirementPackId, packId))
      .returning();
    return result.length;
  }
}

/** 进程级单例 */
export const sowService = new SowService();
