import type { VersionRecord } from "../../types";
import { asString } from "../../utils";
import { loadVersionsStore, saveVersionsStore } from "../versions/versions.repository";
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

export function listProjectRecords(ownerUserId: string): VersionRecord[] {
  return loadVersionsStore().records.filter((record) => isProjectEvaluationRecord(record) && record.ownerUserId === ownerUserId);
}

export function findHarnessDraftRecords(ownerUserId: string, harnessRunId: string, actionId: string): {
  projectRecord: VersionRecord;
  assessmentRecord: VersionRecord;
} | null {
  const records = loadVersionsStore().records;
  const projectRecord = records.find((record) =>
    isProjectEvaluationRecord(record)
    && record.ownerUserId === ownerUserId
    && asString(record.payload?.createdFromHarnessRunId) === harnessRunId
    && asString(record.payload?.createdFromHarnessActionId) === actionId);
  if (!projectRecord) return null;

  const assessmentId = asString(projectRecord.payload?.currentAssessmentVersionId);
  const assessmentRecord = records.find((record) =>
    record.id === assessmentId
    && record.type === "assessment"
    && record.ownerUserId === ownerUserId
    && asString(record.payload?.draftSource) === "harness"
    && asString(record.payload?.harnessRunId) === harnessRunId
    && asString(record.payload?.harnessActionId) === actionId);

  if (!assessmentRecord) throw new Error("harness_draft_link_incomplete");
  return { projectRecord, assessmentRecord };
}

export function findProjectRecordByAssessmentDraft(ownerUserId: string, assessmentRecordId: string): {
  projectRecord: VersionRecord;
  assessmentRecord: VersionRecord;
} | null {
  const records = loadVersionsStore().records;
  const projectRecord = records.find((record) =>
    isProjectEvaluationRecord(record)
    && record.ownerUserId === ownerUserId
    && asString(record.payload?.currentAssessmentVersionId) === assessmentRecordId);
  if (!projectRecord) return null;

  const assessmentRecord = records.find((record) =>
    record.id === assessmentRecordId
    && record.type === "assessment"
    && record.ownerUserId === ownerUserId);
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

export function saveProjectRecord(record: VersionRecord): void {
  const store = loadVersionsStore();
  const index = store.records.findIndex((item) => item.id === record.id);
  if (index >= 0) store.records[index] = record;
  else store.records.push(record);
  saveVersionsStore(store);
}

export function saveProjectRecords(records: VersionRecord[]): void {
  const store = loadVersionsStore();
  for (const record of records) {
    const index = store.records.findIndex((item) => item.id === record.id);
    if (index >= 0) store.records[index] = record;
    else store.records.push(record);
  }
  saveVersionsStore(store);
}
