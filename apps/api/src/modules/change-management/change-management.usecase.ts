import type { ChangeSubmissionRow } from "../../db/schema";
import { defaultProviderRegistry } from "../../ai/provider";
import {
  fetchParentSnapshot,
  createChangeSubmission,
  findChangeSubmissionById,
  listChangeSubmissionsByParent,
  listChangeSubmissionsBySubmitter,
  markChangeSubmissionMerged,
  markChangeSubmissionRejected,
  findAssessmentVersionPayload,
  appendChangeToVersionPayload,
  type SubmitChangeInput,
  type DiffResult,
  type DiffItemAdded,
  type DiffItemRemoved,
  type DiffItemModified,
  type RejectInput,
} from "./change-management.repository";

export type { SubmitChangeInput, DiffResult, DiffItemAdded, DiffItemRemoved, DiffItemModified, RejectInput };

// ------------------------------------------------------------------
// AI diff parsing helpers
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

function buildDiffUserPrompt(snapshot: Record<string, unknown>, changeDescription: string): string {
  return `【当前实体快照】\n${JSON.stringify(snapshot, null, 2)}\n\n【变更描述】\n${changeDescription}\n\n请输出 JSON。`;
}

function parseJsonFromModelText(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try { return JSON.parse(trimmed) as Record<string, unknown>; } catch { /* ignore */ }
  }
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock?.[1]) {
    try { return JSON.parse(codeBlock[1].trim()) as Record<string, unknown>; } catch { /* ignore */ }
  }
  return null;
}

async function tryParseChangeWithAi(
  snapshot: Record<string, unknown>,
  changeDescription: string,
): Promise<{ diffResult?: DiffResult; newEstimate?: Record<string, unknown> } | null> {
  const provider = defaultProviderRegistry.get("kimi");
  if (!provider || !provider.isAvailable()) return null;

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

    const newEstimate = parsed.newEstimate && typeof parsed.newEstimate === "object"
      ? (parsed.newEstimate as Record<string, unknown>)
      : undefined;

    return { diffResult, newEstimate };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------
// computeDiff (pure function — no DB)
// ------------------------------------------------------------------

export function computeDiff(before: Record<string, unknown>, after: Record<string, unknown>): DiffResult {
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
// Submit change
// ------------------------------------------------------------------

export async function submitChange(input: SubmitChangeInput): Promise<ChangeSubmissionRow> {
  const snapshot = await fetchParentSnapshot(input.parentEntityType, input.parentEntityId);

  let diffResult: DiffResult | undefined;
  let newEstimate: Record<string, unknown> | undefined;

  if (snapshot) {
    const parsed = await tryParseChangeWithAi(snapshot, input.changeDescription);
    if (parsed) {
      diffResult = parsed.diffResult;
      newEstimate = parsed.newEstimate;
    }
  }

  return createChangeSubmission({
    parentEntityType: input.parentEntityType,
    parentEntityId: input.parentEntityId,
    changeDescription: input.changeDescription,
    diffResult,
    newEstimate,
    submittedByUserId: input.submittedByUserId,
  });
}

// ------------------------------------------------------------------
// CRUD passthrough
// ------------------------------------------------------------------

export { findChangeSubmissionById, listChangeSubmissionsByParent, listChangeSubmissionsBySubmitter };

// ------------------------------------------------------------------
// Merge to version
// ------------------------------------------------------------------

export async function mergeToVersion(
  changeSubmissionId: string,
  targetVersionId: string,
  mergedByUserId?: string,
): Promise<ChangeSubmissionRow | null> {
  const submission = await findChangeSubmissionById(changeSubmissionId);
  if (!submission) return null;

  const updated = await markChangeSubmissionMerged(changeSubmissionId, targetVersionId, mergedByUserId);

  const existingPayload = await findAssessmentVersionPayload(targetVersionId);

  await appendChangeToVersionPayload(targetVersionId, existingPayload, {
    changeSubmissionId: submission.changeSubmissionId,
    changeDescription: submission.changeDescription,
    diffResult: submission.diffResult,
    newEstimate: submission.newEstimate,
    mergedAt: new Date().toISOString(),
    mergedByUserId,
  });

  return updated;
}

// ------------------------------------------------------------------
// Reject
// ------------------------------------------------------------------

export async function reject(
  changeSubmissionId: string,
  input: RejectInput = {},
): Promise<ChangeSubmissionRow | null> {
  const existing = await findChangeSubmissionById(changeSubmissionId);
  if (!existing) return null;

  return markChangeSubmissionRejected(changeSubmissionId, input.reviewedByUserId);
}
