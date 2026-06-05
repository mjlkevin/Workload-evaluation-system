import type { DevAssessmentRow } from "../../db/schema";
import { generateDevAssessmentDraft } from "../../services/dev-assessment/dev-assessment-ai";
import type { GenerateDevAssessmentDraftResult } from "../../services/dev-assessment/dev-assessment-ai";
import {
  createDevAssessment,
  findDevAssessmentById,
  listDevAssessmentsByVersionId,
  listDevAssessmentsByUser,
  updateDevAssessment,
  deleteDevAssessment,
  markDevAssessmentMerged,
  findAssessmentVersionPayload,
  updateAssessmentVersionPayload,
  type CreateDevAssessmentInput,
  type UpdateDevAssessmentInput,
  type MergeToVersionInput,
} from "./dev-assessment.repository";

export type { CreateDevAssessmentInput, UpdateDevAssessmentInput, MergeToVersionInput, DevAssessmentItemInput } from "./dev-assessment.repository";

// ------------------------------------------------------------------
// CRUD passthrough
// ------------------------------------------------------------------

export { createDevAssessment, findDevAssessmentById, listDevAssessmentsByVersionId, deleteDevAssessment };

export function listByAssessedBy(userId: string, status?: string) {
  return listDevAssessmentsByUser(userId, status, "assessedByUserId");
}

export function listByAssignedBy(userId: string, status?: string) {
  return listDevAssessmentsByUser(userId, status, "assignedByUserId");
}

export { updateDevAssessment };

// ------------------------------------------------------------------
// AI 生成开发评估草稿
// ------------------------------------------------------------------

export async function generateDraft(
  id: string,
): Promise<{ devAssessment: DevAssessmentRow; aiResult: GenerateDevAssessmentDraftResult } | null> {
  const existing = await findDevAssessmentById(id);
  if (!existing) return null;

  const currentItems = (existing.items as unknown as any[]) ?? [];
  const aiResult = await generateDevAssessmentDraft({
    items: currentItems,
    contextSnapshot: existing.contextSnapshot as Record<string, unknown> | undefined,
  });

  const updated = await updateDevAssessment(id, {
    items: aiResult.items,
    status: "in_progress",
  });

  return { devAssessment: updated!, aiResult };
}

// ------------------------------------------------------------------
// 合并到总评估
// ------------------------------------------------------------------

export async function mergeToVersion(
  id: string,
  input: MergeToVersionInput,
): Promise<{ devAssessment: DevAssessmentRow; mergedPayload: Record<string, unknown> } | null> {
  const devAssessment = await findDevAssessmentById(id);
  if (!devAssessment) return null;
  if (!devAssessment.assessmentVersionId) {
    throw new Error("dev_assessment_not_linked_to_version");
  }

  await markDevAssessmentMerged(id);

  const existingPayload = await findAssessmentVersionPayload(devAssessment.assessmentVersionId);

  const mergedPayload: Record<string, unknown> = {
    ...existingPayload,
    devAssessment: {
      devAssessmentId: devAssessment.devAssessmentId,
      contractMode: devAssessment.contractMode,
      items: devAssessment.items,
      deployOpsItems: devAssessment.deployOpsItems,
      totalDays: devAssessment.totalDays,
      assessedByUserId: devAssessment.assessedByUserId,
      mergedAt: new Date().toISOString(),
      mergedByUserId: input.mergedByUserId,
    },
  };

  await updateAssessmentVersionPayload(devAssessment.assessmentVersionId, mergedPayload);

  const updated = await findDevAssessmentById(id);
  return { devAssessment: updated!, mergedPayload };
}
