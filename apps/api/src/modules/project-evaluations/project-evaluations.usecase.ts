import { randomUUID } from "node:crypto";

import type { AuthUser, VersionRecord } from "../../types";
import { asString } from "../../utils";
import { PROJECT_EVALUATION_RECORD_KIND, listProjectRecords, mapGlobalVersionToProject, saveProjectRecord } from "./project-evaluations.repository";
import type { ProjectEvaluationPlan } from "./project-evaluations.types";

export function listProjectEvaluationsForUser(user: AuthUser, query: { q?: unknown } = {}): ProjectEvaluationPlan[] {
  const keyword = asString(query.q).toLowerCase();
  return listProjectRecords(user.id)
    .map(mapGlobalVersionToProject)
    .filter((project) => {
      if (!keyword) return true;
      return [project.projectName, project.customerName, project.industry].some((value) => value.toLowerCase().includes(keyword));
    })
    .sort((a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt)));
}

export function createProjectEvaluationForUser(user: AuthUser, input: Record<string, unknown>): ProjectEvaluationPlan {
  const nowIso = new Date().toISOString();
  const projectName = asString(input.projectName) || "新项目评估";
  const customerName = asString(input.customerName);
  const industry = asString(input.industry);
  const currentStage = asString(input.currentStage) || "project_discovery";
  const createdFromSessionId = asString(input.createdFromSessionId);
  const recordId = randomUUID();
  const versionCode = `PROJECT-${recordId}`;
  const payload: Record<string, unknown> = {
    recordKind: PROJECT_EVALUATION_RECORD_KIND,
    projectName,
    customerName,
    industry,
    currentStage,
    projectStatus: "draft",
    createdFromSessionId,
    totalDays: Number(input.totalDays) || 0,
  };
  const record: VersionRecord = {
    id: recordId,
    type: "global",
    versionCode,
    templateId: "project-evaluation",
    ownerUserId: user.id,
    status: "draft",
    payload,
    createdAt: nowIso,
    updatedAt: nowIso,
    createdByUserId: user.id,
    createdByUsername: user.username,
    updatedByUserId: user.id,
    updatedByUsername: user.username,
    checkoutStatus: "checked_in",
    versionDocStatus: "drafting",
    majorLetter: "A",
    minorNumber: 0,
    baseCode: versionCode,
    isHistoricalArchive: false,
    lastCheckinPayload: {},
  };

  saveProjectRecord(record);
  return mapGlobalVersionToProject(record);
}
