import type { VersionRecord } from "../../types";
import { asString } from "../../utils";
import { getVersionsRepository } from "../versions/versions.repository";
import type { ProjectEvaluationPlan, ProjectEvaluationStatus } from "./project-evaluations.types";

const VALID_PROJECT_STATUSES: ProjectEvaluationStatus[] = ["draft", "active", "reviewing", "published", "archived"];
export const PROJECT_EVALUATION_RECORD_KIND = "project_evaluation";

function normalizeProjectStatus(value: unknown): ProjectEvaluationStatus {
  const status = asString(value) as ProjectEvaluationStatus;
  return VALID_PROJECT_STATUSES.includes(status) ? status : "draft";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(asString).filter(Boolean) : [];
}

export function mapGlobalVersionToProject(record: VersionRecord): ProjectEvaluationPlan {
  const payload = record.payload || {};
  const aiDraftReview = payload.aiDraftReview && typeof payload.aiDraftReview === "object" && !Array.isArray(payload.aiDraftReview)
    ? payload.aiDraftReview as Record<string, unknown>
    : {};
  return {
    projectId: record.id,
    projectName: asString(payload.projectName) || record.versionCode,
    customerName: asString(payload.customerName),
    industry: asString(payload.industry),
    currentStage: asString(payload.currentStage) || "project_discovery",
    status: normalizeProjectStatus(payload.projectStatus),
    ownerUserId: record.ownerUserId,
    ownerUsername: record.createdByUsername,
    versionCode: record.versionCode,
    participantUserIds: asStringArray(payload.participantUserIds),
    currentRequirementVersionId: asString(payload.currentRequirementVersionId) || undefined,
    currentAssessmentVersionId: asString(payload.currentAssessmentVersionId) || undefined,
    currentDevAssessmentId: asString(payload.currentDevAssessmentId) || undefined,
    currentResourceCostId: asString(payload.currentResourceCostId) || undefined,
    currentWbsId: asString(payload.currentWbsId) || undefined,
    defaultStandardVersionId: asString(payload.defaultStandardVersionId) || undefined,
    createdFromSessionId: asString(payload.createdFromSessionId) || undefined,
    sourceGlobalVersionRecordId: record.id,
    createdFromHarnessRunId: asString(payload.createdFromHarnessRunId) || undefined,
    createdFromHarnessActionId: asString(payload.createdFromHarnessActionId) || undefined,
    assessmentVersionCode: asString(payload.assessmentVersionCode) || undefined,
    aiDraftReviewStatus: asString(aiDraftReview.status) === "confirmed" ? "confirmed" : (payload.createdFromHarnessRunId ? "pending" : undefined),
    aiDraftConfirmedAt: asString(aiDraftReview.confirmedAt) || undefined,
    aiDraftConfirmedByUsername: asString(aiDraftReview.confirmedByUsername) || undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** 阶段 2 批 6：versions 行级仓储（项目评估记录必为 global 类型）。 */
export async function listProjectRecords(ownerUserId: string): Promise<VersionRecord[]> {
  const records = await getVersionsRepository().listRecords({ ownerUserId, type: "global" });
  return records.filter(isProjectEvaluationRecord);
}

/** 阶段 2 批 6：行级查询重写（先定位项目记录，再按 id 查评估草稿并校验归属）。 */
export async function findHarnessDraftRecords(ownerUserId: string, harnessRunId: string, actionId: string): Promise<{
  projectRecord: VersionRecord;
  assessmentRecord: VersionRecord;
} | null> {
  const repo = getVersionsRepository();
  const globals = await repo.listRecords({ ownerUserId, type: "global" });
  const projectRecord = globals.find((record) =>
    isProjectEvaluationRecord(record)
    && asString(record.payload?.createdFromHarnessRunId) === harnessRunId
    && asString(record.payload?.createdFromHarnessActionId) === actionId);
  if (!projectRecord) return null;

  const assessmentId = asString(projectRecord.payload?.currentAssessmentVersionId);
  const candidate = assessmentId ? await repo.findRecordById(assessmentId) : null;
  const assessmentRecord = candidate
    && candidate.type === "assessment"
    && candidate.ownerUserId === ownerUserId
    && asString(candidate.payload?.draftSource) === "harness"
    && asString(candidate.payload?.harnessRunId) === harnessRunId
    && asString(candidate.payload?.harnessActionId) === actionId
    ? candidate
    : null;

  if (!assessmentRecord) throw new Error("harness_draft_link_incomplete");
  return { projectRecord, assessmentRecord };
}

/** 阶段 2 批 6：行级查询重写（同 findHarnessDraftRecords 口径）。 */
export async function findProjectRecordByAssessmentDraft(ownerUserId: string, assessmentRecordId: string): Promise<{
  projectRecord: VersionRecord;
  assessmentRecord: VersionRecord;
} | null> {
  const repo = getVersionsRepository();
  const globals = await repo.listRecords({ ownerUserId, type: "global" });
  const projectRecord = globals.find((record) =>
    isProjectEvaluationRecord(record)
    && asString(record.payload?.currentAssessmentVersionId) === assessmentRecordId);
  if (!projectRecord) return null;

  const candidate = await repo.findRecordById(assessmentRecordId);
  const assessmentRecord = candidate
    && candidate.type === "assessment"
    && candidate.ownerUserId === ownerUserId
    ? candidate
    : null;
  if (!assessmentRecord) throw new Error("harness_draft_link_incomplete");
  return { projectRecord, assessmentRecord };
}

export function isProjectEvaluationRecord(record: VersionRecord): boolean {
  return record.type === "global"
    && (
      asString(record.payload?.recordKind) === PROJECT_EVALUATION_RECORD_KIND
      || record.templateId === "project-evaluation"
    );
}

/** 阶段 2 批 6：写入改行级 upsert（存在则整行覆写，不存在则插入；幂等重放结果不变）。 */
export async function saveProjectRecord(record: VersionRecord): Promise<void> {
  await getVersionsRepository().upsertVersionRecord(record);
}

/** 阶段 2 批 6：批量一次原子提交（JSON 单次整存落盘 / PG 单事务），保留原「多记录一次提交」契约。 */
export async function saveProjectRecords(records: VersionRecord[]): Promise<void> {
  await getVersionsRepository().upsertVersionRecords(records);
}
