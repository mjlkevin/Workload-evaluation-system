import { randomUUID } from "node:crypto";

import type { AuthUser, VersionRecord } from "../../types";
import { asString } from "../../utils";
import type { HarnessRequirementReportV2Content } from "../harness/harness.types";
import { PROJECT_EVALUATION_RECORD_KIND, findHarnessDraftRecords, listProjectRecords, mapGlobalVersionToProject, saveProjectRecord, saveProjectRecords } from "./project-evaluations.repository";
import type { ProjectEvaluationDraftBundle, ProjectEvaluationPlan } from "./project-evaluations.types";

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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => asString(item).trim()).filter(Boolean) : [];
}

function buildAiDraftVersionCode(prefix: string, id: string): string {
  return `${prefix}-AI-DRAFT-${id.slice(0, 8).toUpperCase()}`;
}

export function createProjectAndAssessmentDraftsFromHarness(
  user: AuthUser,
  input: {
    harnessRunId: string;
    actionId: string;
    aiSessionId?: string | null;
    report: HarnessRequirementReportV2Content;
  },
): ProjectEvaluationDraftBundle {
  const existingDraft = findHarnessDraftRecords(user.id, input.harnessRunId, input.actionId);
  if (existingDraft) {
    return {
      project: mapGlobalVersionToProject(existingDraft.projectRecord),
      assessmentDraft: {
        recordId: existingDraft.assessmentRecord.id,
        versionCode: existingDraft.assessmentRecord.versionCode,
        status: "draft_from_ai",
      },
    };
  }

  const nowIso = new Date().toISOString();
  const report = input.report;
  const project = asRecord(report.project);
  const requirementFindings = Array.isArray(report.requirementFindings) ? report.requirementFindings : [];
  const risks = Array.isArray(report.risks) ? report.risks : [];
  const answeredQuestions = Array.isArray(report.answeredQuestions) ? report.answeredQuestions : [];
  const missingFields = Array.isArray(report.missingFields) ? report.missingFields : [];
  const sourceSheets = asStringArray(report.sourceSheets);
  const projectName = asString(project.projectName) || "AI 生成项目评估草稿";
  const customerName = asString(project.customerName);
  const industry = asString(project.industry);

  const assessmentRecordId = randomUUID();
  const assessmentVersionCode = buildAiDraftVersionCode("IA", assessmentRecordId);
  const assessmentPayload: Record<string, unknown> = {
    draftStatus: "draft_from_ai",
    draftSource: "harness",
    harnessRunId: input.harnessRunId,
    harnessActionId: input.actionId,
    projectName,
    customerName,
    industry,
    sourceFile: asString(report.sourceFile),
    sourceSheets,
    basicInfo: {
      projectName,
      customerName,
      customerIndustry: industry,
      productLines: Array.from(new Set(requirementFindings.map((item) => asString(asRecord(item).moduleHint)).filter(Boolean))),
    },
    requirementSnapshot: {
      basicInfo: {
        projectName,
        customerName,
        customerIndustry: industry,
        productLines: Array.from(new Set(requirementFindings.map((item) => asString(asRecord(item).moduleHint)).filter(Boolean))),
      },
      businessNeedRows: requirementFindings.map((item) => {
        const row = asRecord(item);
        return {
          businessDomain: asString(row.domain),
          category: asString(row.moduleHint),
          businessNeed: asString(row.scenario),
          title: asString(row.scenario) || asString(row.domain),
          solutionSuggestion: asStringArray(row.evidenceRefs).join(" / "),
          requiresCustomDev: "待确认",
        };
      }),
      productModuleRows: requirementFindings.map((item) => {
        const row = asRecord(item);
        return {
          productDomain: asString(row.domain),
          moduleName: asString(row.moduleHint),
          subModule: asString(row.scenario),
          userCount: "",
          implementationOrgCount: "",
          pilotOrgCount: "",
          partyBLead: "",
          partyALead: "",
        };
      }),
      implementationScopeRows: [],
      devOverviewRows: [],
      keyPointRows: risks.map((item) => {
        const row = asRecord(item);
        return {
          analysisCategory: "AI 风险提示",
          subItem: asString(row.title),
          detail: [asString(row.assumption), asString(row.impact)].filter(Boolean).join("；"),
          note: "来自 Harness requirement_report_v2",
        };
      }),
      meetingNotes: [
        asString(report.clarificationSummary),
        answeredQuestions.map((item) => {
          const row = asRecord(item);
          return `${asString(row.question)}：${asString(row.answer)}`;
        }).filter(Boolean).join("\n"),
      ].filter(Boolean).join("\n\n"),
    },
    aiReview: {
      missingFields,
      risks,
      answeredQuestions,
      requirementFindings,
    },
  };
  const assessmentRecord: VersionRecord = {
    id: assessmentRecordId,
    type: "assessment",
    versionCode: assessmentVersionCode,
    templateId: "default",
    ownerUserId: user.id,
    status: "draft",
    payload: assessmentPayload,
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
    baseCode: assessmentVersionCode,
    isHistoricalArchive: false,
    lastCheckinPayload: {},
  };

  const projectRecordId = randomUUID();
  const projectVersionCode = `PROJECT-${projectRecordId}`;
  const projectRecord: VersionRecord = {
    id: projectRecordId,
    type: "global",
    versionCode: projectVersionCode,
    templateId: "project-evaluation",
    ownerUserId: user.id,
    status: "draft",
    payload: {
      recordKind: PROJECT_EVALUATION_RECORD_KIND,
      projectName,
      customerName,
      industry,
      currentStage: "assessment_draft",
      projectStatus: "draft",
      createdFromSessionId: input.aiSessionId || "",
      createdFromHarnessRunId: input.harnessRunId,
      createdFromHarnessActionId: input.actionId,
      currentAssessmentVersionId: assessmentRecordId,
      assessmentVersionCode,
      totalDays: 0,
    },
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
    baseCode: projectVersionCode,
    isHistoricalArchive: false,
    lastCheckinPayload: {},
  };

  saveProjectRecords([assessmentRecord, projectRecord]);

  return {
    project: mapGlobalVersionToProject(projectRecord),
    assessmentDraft: {
      recordId: assessmentRecord.id,
      versionCode: assessmentRecord.versionCode,
      status: "draft_from_ai",
    },
  };
}
