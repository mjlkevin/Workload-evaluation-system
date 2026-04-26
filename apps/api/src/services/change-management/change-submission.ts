// ============================================================
// ChangeSubmission Service — 变更提报业务层（P2-3）
// ============================================================
// D-4 决策：Skill 与 Web UI 不实时同步，每次变更形成独立 ChangeSubmission。
//
// 核心流程：
//   1. 销售提交变更描述（submitChange）
//   2. AI 解析为字段级 diff（KimiProvider）→ 失败则仅保存原文
//   3. PM 审阅 diff，决定合并（mergeToVersion）或驳回（reject）

import { randomUUID } from "node:crypto";
import { eq, and, desc } from "drizzle-orm";
import { db, type Database } from "../../db/client";
import {
  changeSubmissions,
  opportunityBriefs,
  requirementPacks,
  assessmentVersions,
} from "../../db/schema";
import type {
  ChangeSubmissionRow,
  ChangeSubmissionInsert,
} from "../../db/schema";
import { defaultProviderRegistry } from "../../ai/provider";

// ------------------------------------------------------------------
// 类型
// ------------------------------------------------------------------

export interface SubmitChangeInput {
  parentEntityType: "opportunity_brief" | "requirement_pack" | "assessment_version";
  parentEntityId: string;
  changeDescription: string;
  submittedByUserId?: string;
}

export interface DiffItemAdded {
  field: string;
  value: unknown;
}

export interface DiffItemRemoved {
  field: string;
  oldValue: unknown;
}

export interface DiffItemModified {
  field: string;
  before: unknown;
  after: unknown;
}

export interface DiffResult {
  added: DiffItemAdded[];
  removed: DiffItemRemoved[];
  modified: DiffItemModified[];
}

export interface RejectInput {
  reviewedByUserId?: string;
}

// ------------------------------------------------------------------
// Parent 实体快照读取
// ------------------------------------------------------------------

async function fetchParentSnapshot(
  dbInstance: Database,
  type: SubmitChangeInput["parentEntityType"],
  id: string,
): Promise<Record<string, unknown> | null> {
  switch (type) {
    case "opportunity_brief": {
      const [row] = await dbInstance
        .select()
        .from(opportunityBriefs)
        .where(eq(opportunityBriefs.opportunityBriefId, id));
      return row ? (row as unknown as Record<string, unknown>) : null;
    }
    case "requirement_pack": {
      const [row] = await dbInstance
        .select()
        .from(requirementPacks)
        .where(eq(requirementPacks.requirementPackId, id));
      return row ? (row as unknown as Record<string, unknown>) : null;
    }
    case "assessment_version": {
      const [row] = await dbInstance
        .select()
        .from(assessmentVersions)
        .where(eq(assessmentVersions.assessmentVersionId, id));
      return row ? (row as unknown as Record<string, unknown>) : null;
    }
    default:
      return null;
  }
}

// ------------------------------------------------------------------
// AI 解析 helpers
// ------------------------------------------------------------------

function buildDiffSystemPrompt(): string {
  return `你是一名 ERP 项目评估助手，擅长将销售口述的变更描述解析为结构化的字段级 diff。

请根据用户提供的「当前实体快照」和「变更描述」，分析变更会影响哪些字段，并输出 JSON：
{
  "diffResult": {
    "added": [{"field": "字段名", "value": "新增值"}],
    "removed": [{"field": "字段名", "oldValue": "原值"}],
    "modified": [{"field": "字段名", "before": "原值", "after": "新值"}]
  },
  "newEstimate": { "可选": "重新估算后的结构化结果" }
}

注意：
- 如果变更描述不涉及具体字段修改（只是模糊意向），added/removed/modified 可为空数组
- 不要添加 JSON 以外的任何说明文字`;
}

function buildDiffUserPrompt(
  snapshot: Record<string, unknown>,
  changeDescription: string,
): string {
  return `【当前实体快照】\n${JSON.stringify(snapshot, null, 2)}\n\n【变更描述】\n${changeDescription}\n\n请输出 JSON。`;
}

function parseJsonFromModelText(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch { /* ignore */ }
  }
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock?.[1]) {
    try {
      return JSON.parse(codeBlock[1].trim()) as Record<string, unknown>;
    } catch { /* ignore */ }
  }
  return null;
}

async function tryParseChangeWithAi(
  snapshot: Record<string, unknown>,
  changeDescription: string,
): Promise<{ diffResult?: DiffResult; newEstimate?: Record<string, unknown> } | null> {
  const provider = defaultProviderRegistry.get("kimi");
  if (!provider || !provider.isAvailable()) {
    return null;
  }

  try {
    const response = await provider.chatCompletion({
      model: "moonshot-v1-8k",
      messages: [
        { role: "system", content: buildDiffSystemPrompt() },
        { role: "user", content: buildDiffUserPrompt(snapshot, changeDescription) },
      ],
      temperature: 0.2,
      responseFormat: "json_object",
    });

    const parsed = parseJsonFromModelText(response.content ?? "");
    if (!parsed) return null;

    const rawDiff = parsed.diffResult as Record<string, unknown> | undefined;
    const diffResult: DiffResult | undefined = rawDiff
      ? {
          added: Array.isArray(rawDiff.added) ? (rawDiff.added as DiffItemAdded[]) : [],
          removed: Array.isArray(rawDiff.removed) ? (rawDiff.removed as DiffItemRemoved[]) : [],
          modified: Array.isArray(rawDiff.modified) ? (rawDiff.modified as DiffItemModified[]) : [],
        }
      : undefined;

    const newEstimate =
      parsed.newEstimate && typeof parsed.newEstimate === "object"
        ? (parsed.newEstimate as Record<string, unknown>)
        : undefined;

    return { diffResult, newEstimate };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------
// Service
// ------------------------------------------------------------------

export class ChangeSubmissionService {
  constructor(private dbInstance: Database = db) {}

  // ------------------------------------------------------------------
  // 提交变更
  // ------------------------------------------------------------------

  async submitChange(input: SubmitChangeInput): Promise<ChangeSubmissionRow> {
    const snapshot = await fetchParentSnapshot(
      this.dbInstance,
      input.parentEntityType,
      input.parentEntityId,
    );

    let diffResult: DiffResult | undefined;
    let newEstimate: Record<string, unknown> | undefined;

    if (snapshot) {
      const parsed = await tryParseChangeWithAi(snapshot, input.changeDescription);
      if (parsed) {
        diffResult = parsed.diffResult;
        newEstimate = parsed.newEstimate;
      }
    }

    const [row] = await this.dbInstance
      .insert(changeSubmissions)
      .values({
        changeSubmissionId: randomUUID(),
        parentEntityType: input.parentEntityType,
        parentEntityId: input.parentEntityId,
        changeDescription: input.changeDescription,
        diffResult: diffResult as any,
        newEstimate: newEstimate as any,
        submittedByUserId: input.submittedByUserId,
        status: "submitted",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as ChangeSubmissionInsert)
      .returning();

    return row;
  }

  // ------------------------------------------------------------------
  // 字段级 diff 计算
  // ------------------------------------------------------------------

  computeDiff(before: Record<string, unknown>, after: Record<string, unknown>): DiffResult {
    const added: DiffItemAdded[] = [];
    const removed: DiffItemRemoved[] = [];
    const modified: DiffItemModified[] = [];

    const beforeKeys = new Set(Object.keys(before));
    const afterKeys = new Set(Object.keys(after));

    for (const key of afterKeys) {
      if (!beforeKeys.has(key)) {
        added.push({ field: key, value: after[key] });
      } else if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        modified.push({ field: key, before: before[key], after: after[key] });
      }
    }

    for (const key of beforeKeys) {
      if (!afterKeys.has(key)) {
        removed.push({ field: key, oldValue: before[key] });
      }
    }

    return { added, removed, modified };
  }

  // ------------------------------------------------------------------
  // 合并到版本
  // ------------------------------------------------------------------

  async mergeToVersion(
    changeSubmissionId: string,
    targetVersionId: string,
    mergedByUserId?: string,
  ): Promise<ChangeSubmissionRow | null> {
    const submission = await this.findById(changeSubmissionId);
    if (!submission) return null;

    // 更新 change_submissions 状态
    const [updated] = await this.dbInstance
      .update(changeSubmissions)
      .set({
        status: "merged",
        mergedToVersionId: targetVersionId,
        reviewedByUserId: mergedByUserId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(changeSubmissions.changeSubmissionId, changeSubmissionId))
      .returning();

    // 读取目标版本
    const [version] = await this.dbInstance
      .select()
      .from(assessmentVersions)
      .where(eq(assessmentVersions.assessmentVersionId, targetVersionId));

    if (version) {
      const existingPayload = (version.payload as Record<string, unknown> | null) ?? {};
      const changeSubmissionsList = (existingPayload.changeSubmissions ?? []) as Array<Record<string, unknown>>;
      changeSubmissionsList.push({
        changeSubmissionId: submission.changeSubmissionId,
        changeDescription: submission.changeDescription,
        diffResult: submission.diffResult,
        newEstimate: submission.newEstimate,
        mergedAt: new Date().toISOString(),
        mergedByUserId,
      });

      await this.dbInstance
        .update(assessmentVersions)
        .set({
          payload: { ...existingPayload, changeSubmissions: changeSubmissionsList } as any,
          updatedAt: new Date(),
        })
        .where(eq(assessmentVersions.assessmentVersionId, targetVersionId));
    }

    return updated ?? null;
  }

  // ------------------------------------------------------------------
  // 查询
  // ------------------------------------------------------------------

  async findById(id: string): Promise<ChangeSubmissionRow | null> {
    const [row] = await this.dbInstance
      .select()
      .from(changeSubmissions)
      .where(eq(changeSubmissions.changeSubmissionId, id));
    return row ?? null;
  }

  async listByParent(parentEntityType: string, parentEntityId: string): Promise<ChangeSubmissionRow[]> {
    return this.dbInstance
      .select()
      .from(changeSubmissions)
      .where(
        and(
          eq(changeSubmissions.parentEntityType, parentEntityType as any),
          eq(changeSubmissions.parentEntityId, parentEntityId),
        ),
      )
      .orderBy(desc(changeSubmissions.submittedAt));
  }

  async listBySubmitter(submittedByUserId: string): Promise<ChangeSubmissionRow[]> {
    return this.dbInstance
      .select()
      .from(changeSubmissions)
      .where(eq(changeSubmissions.submittedByUserId, submittedByUserId))
      .orderBy(desc(changeSubmissions.submittedAt));
  }

  // ------------------------------------------------------------------
  // 驳回
  // ------------------------------------------------------------------

  async reject(changeSubmissionId: string, input: RejectInput = {}): Promise<ChangeSubmissionRow | null> {
    const existing = await this.findById(changeSubmissionId);
    if (!existing) return null;

    const [row] = await this.dbInstance
      .update(changeSubmissions)
      .set({
        status: "rejected",
        reviewedByUserId: input.reviewedByUserId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(changeSubmissions.changeSubmissionId, changeSubmissionId))
      .returning();
    return row ?? null;
  }
}

export const changeSubmissionService = new ChangeSubmissionService();
