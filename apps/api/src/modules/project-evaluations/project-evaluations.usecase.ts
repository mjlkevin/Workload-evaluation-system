import { randomUUID } from "node:crypto";

import type { AuthUser, VersionRecord } from "../../types";
import { asString } from "../../utils";
import { applyVersionCodeFormat, formatHasSequenceToken } from "../../utils/version-code-format";
import { loadVersionCodeRulesStore } from "../system/system.repository";
import { loadVersionsStore } from "../versions/versions.repository";
import type { HarnessRequirementReportV2Content } from "../harness/harness.types";
import { createHarnessRepository, type HarnessRepository } from "../harness/harness.repository";
import { PROJECT_EVALUATION_RECORD_KIND, findHarnessDraftRecords, findProjectRecordByAssessmentDraft, listProjectRecords, mapGlobalVersionToProject, saveProjectRecord, saveProjectRecords } from "./project-evaluations.repository";
import type { AiAssessmentDraftManualConfirmResult, AiDraftManualConfirmation, ProjectEvaluationDraftBundle, ProjectEvaluationPlan } from "./project-evaluations.types";

/**
 * 按「总方案」编码规则生成项目版本号。
 * 若规则不存在或未生效，回退到 PROJECT-{uuid} 保证不阻断创建。
 * 阶段 1 批 4：级联改 async（loadVersionsStore 异步化）；
 * 阶段 1 批 5：loadVersionCodeRulesStore 已异步化，下方调用补 await（跨批依赖点真正生效）。
 */
async function generateProjectVersionCode(ownerUserId: string): Promise<string> {
  const rulesStore = await loadVersionCodeRulesStore();
  const rule = rulesStore.rules.find((r) => r.moduleKey === "global" && r.status === "active");
  if (!rule) return `PROJECT-${randomUUID()}`;

  const format = rule.format || "{PREFIX}-{YYYYMMDD}-{NNN}";
  const hasSeq = formatHasSequenceToken(format);
  const now = new Date();
  const store = await loadVersionsStore();

  for (let seq = 1; seq <= 9999; seq += 1) {
    if (!hasSeq && seq > 1) break;
    const candidate = applyVersionCodeFormat(format, {
      prefix: rule.prefix,
      moduleCode: rule.moduleCode,
      globalCode: "GL000",
      seq,
      now,
    });
    const conflict = store.records.some(
      (r) => r.ownerUserId === ownerUserId && r.type === "global" && r.versionCode === candidate
    );
    if (!conflict) return candidate;
  }
  return `PROJECT-${randomUUID()}`;
}

/** 阶段 1 批 4：级联改 async（project-evaluations repository 异步化），实现不动。 */
export async function listProjectEvaluationsForUser(user: AuthUser, query: { q?: unknown } = {}): Promise<ProjectEvaluationPlan[]> {
  const keyword = asString(query.q).toLowerCase();
  return (await listProjectRecords(user.id))
    .map(mapGlobalVersionToProject)
    .filter((project) => {
      if (!keyword) return true;
      return [project.projectName, project.customerName, project.industry].some((value) => value.toLowerCase().includes(keyword));
    })
    .sort((a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt)));
}

/** 阶段 1 批 4：级联改 async（project-evaluations repository 异步化），实现不动。 */
export async function getProjectEvaluationForUser(user: AuthUser, projectId: string): Promise<ProjectEvaluationPlan | null> {
  const record = (await listProjectRecords(user.id)).find((item) => item.id === projectId);
  if (!record) return null;
  return mapGlobalVersionToProject(record);
}

/** 阶段 1 批 4：级联改 async（generateProjectVersionCode / saveProjectRecord 异步化），实现不动。 */
export async function createProjectEvaluationForUser(user: AuthUser, input: Record<string, unknown>): Promise<ProjectEvaluationPlan> {
  const nowIso = new Date().toISOString();
  const projectName = asString(input.projectName) || "新项目评估";
  const customerName = asString(input.customerName);
  const industry = asString(input.industry);
  const currentStage = asString(input.currentStage) || "project_discovery";
  const createdFromSessionId = asString(input.createdFromSessionId);
  const recordId = randomUUID();
  const versionCode = await generateProjectVersionCode(user.id);
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

  await saveProjectRecord(record);
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

const aiDraftConfirmationLocks = new Map<string, Promise<void>>();

async function withAiDraftConfirmationLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = aiDraftConfirmationLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  aiDraftConfirmationLocks.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (aiDraftConfirmationLocks.get(key) === tail) {
      aiDraftConfirmationLocks.delete(key);
    }
  }
}

function readManualConfirmationPayload(value: unknown): AiDraftManualConfirmation | undefined {
  const review = asRecord(value);
  if (asString(review.status) !== "confirmed") return undefined;
  return {
    status: "confirmed",
    confirmedAt: asString(review.confirmedAt),
    confirmedByUserId: asString(review.confirmedByUserId),
    confirmedByUsername: asString(review.confirmedByUsername),
    note: asString(review.note) || undefined,
    harnessToolEventId: asString(review.harnessToolEventId) || undefined,
  };
}

function readManualConfirmation(record: VersionRecord): AiDraftManualConfirmation | undefined {
  return readManualConfirmationPayload(asRecord(record.payload).aiDraftReview);
}

function readManualConfirmationFromEventOutput(output: unknown): AiDraftManualConfirmation | undefined {
  return readManualConfirmationPayload(asRecord(output).manualConfirmation);
}

function readOutputAssessmentDraftId(output: unknown): string {
  return asString(asRecord(asRecord(output).assessmentDraft).recordId);
}

/** 阶段 1 批 4：级联改 async（findHarnessDraftRecords / generateProjectVersionCode / saveProjectRecords 异步化），实现不动。 */
export async function createProjectAndAssessmentDraftsFromHarness(
  user: AuthUser,
  input: {
    harnessRunId: string;
    actionId: string;
    aiSessionId?: string | null;
    report: HarnessRequirementReportV2Content;
  },
): Promise<ProjectEvaluationDraftBundle> {
  const existingDraft = await findHarnessDraftRecords(user.id, input.harnessRunId, input.actionId);
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

  const projectRecordId = randomUUID();
  const projectVersionCode = await generateProjectVersionCode(user.id);
  const assessmentRecordId = randomUUID();
  const assessmentVersionCode = buildAiDraftVersionCode("IA", assessmentRecordId);
  const assessmentPayload: Record<string, unknown> = {
    draftStatus: "draft_from_ai",
    draftSource: "harness",
    harnessRunId: input.harnessRunId,
    harnessActionId: input.actionId,
    projectEvaluationId: projectRecordId,
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
      aiDraftReviewStatus: "pending",
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

  await saveProjectRecords([assessmentRecord, projectRecord]);

  return {
    project: mapGlobalVersionToProject(projectRecord),
    assessmentDraft: {
      recordId: assessmentRecord.id,
      versionCode: assessmentRecord.versionCode,
      status: "draft_from_ai",
      manualConfirmation: readManualConfirmation(assessmentRecord),
    },
  };
}

export async function confirmAiAssessmentDraftForUser(
  user: AuthUser,
  assessmentRecordId: string,
  input: { note?: unknown } = {},
  repo: HarnessRepository = createHarnessRepository(),
): Promise<AiAssessmentDraftManualConfirmResult | null> {
  const pair = await findProjectRecordByAssessmentDraft(user.id, assessmentRecordId);
  if (!pair) return null;

  const { projectRecord, assessmentRecord } = pair;
  const assessmentPayload = assessmentRecord.payload || {};
  const projectPayload = projectRecord.payload || {};
  const harnessRunId = asString(assessmentPayload.harnessRunId) || asString(projectPayload.createdFromHarnessRunId);
  const harnessActionId = asString(assessmentPayload.harnessActionId) || asString(projectPayload.createdFromHarnessActionId);
  if (
    asString(assessmentPayload.draftStatus) !== "draft_from_ai"
    || asString(assessmentPayload.draftSource) !== "harness"
    || !harnessRunId
    || !harnessActionId
  ) {
    throw new Error("not_ai_harness_draft");
  }

  return withAiDraftConfirmationLock(
    `${harnessRunId}:${harnessActionId}:${assessmentRecord.id}:manual_confirm_ai_draft`,
    () => confirmAiAssessmentDraftForUserCore(user, assessmentRecordId, input, repo),
  );
}

async function confirmAiAssessmentDraftForUserCore(
  user: AuthUser,
  assessmentRecordId: string,
  input: { note?: unknown },
  repo: HarnessRepository,
): Promise<AiAssessmentDraftManualConfirmResult | null> {
  const pair = await findProjectRecordByAssessmentDraft(user.id, assessmentRecordId);
  if (!pair) return null;

  const { projectRecord, assessmentRecord } = pair;
  const assessmentPayload = assessmentRecord.payload || {};
  const projectPayload = projectRecord.payload || {};
  const harnessRunId = asString(assessmentPayload.harnessRunId) || asString(projectPayload.createdFromHarnessRunId);
  const harnessActionId = asString(assessmentPayload.harnessActionId) || asString(projectPayload.createdFromHarnessActionId);
  if (
    asString(assessmentPayload.draftStatus) !== "draft_from_ai"
    || asString(assessmentPayload.draftSource) !== "harness"
    || !harnessRunId
    || !harnessActionId
  ) {
    throw new Error("not_ai_harness_draft");
  }

  const run = await repo.findRunById(harnessRunId);
  if (!run || run.ownerUserId !== user.id) {
    throw new Error("harness_run_not_found");
  }

  const existingEvent = (await repo.listToolEvents(harnessRunId)).find((event) =>
    event.toolName === "manual_confirm_ai_draft"
    && event.eventType === "manual_confirmation"
    && event.actionId === harnessActionId
    && event.status === "confirmed"
    && readOutputAssessmentDraftId(event.output) === assessmentRecord.id);

  const existingManualConfirmation = existingEvent
    ? readManualConfirmationFromEventOutput(existingEvent.output) ?? readManualConfirmation(assessmentRecord)
    : readManualConfirmation(assessmentRecord);
  const confirmedAt = existingManualConfirmation?.confirmedAt || new Date().toISOString();
  const manualConfirmation: AiDraftManualConfirmation = existingManualConfirmation
    ? {
      ...existingManualConfirmation,
      harnessToolEventId: existingEvent?.harnessToolEventId || existingManualConfirmation.harnessToolEventId,
    }
    : {
      status: "confirmed",
      confirmedAt,
      confirmedByUserId: user.id,
      confirmedByUsername: user.username,
      note: asString(input.note) || undefined,
      harnessToolEventId: existingEvent?.harnessToolEventId,
    };
  const output = {
    project: {
      projectId: projectRecord.id,
      projectName: asString(projectPayload.projectName),
      status: "reviewing",
    },
    assessmentDraft: {
      recordId: assessmentRecord.id,
      versionCode: assessmentRecord.versionCode,
      status: "draft_from_ai",
    },
    manualConfirmation,
  };

  const event = existingEvent ?? await repo.addToolEvent({
    harnessRunId,
    actionId: harnessActionId,
    toolName: "manual_confirm_ai_draft",
    eventType: "manual_confirmation",
    status: "confirmed",
    riskLevel: "high",
    input: {
      projectId: projectRecord.id,
      assessmentRecordId: assessmentRecord.id,
      harnessActionId,
      note: manualConfirmation.note,
    },
    output,
    errorMessage: null,
    resolvedAt: new Date(confirmedAt),
  });

  manualConfirmation.harnessToolEventId = event.harnessToolEventId;
  const nextAssessmentRecord: VersionRecord = {
    ...assessmentRecord,
    payload: {
      ...assessmentPayload,
      aiDraftReview: manualConfirmation,
    },
    updatedAt: confirmedAt,
    updatedByUserId: user.id,
    updatedByUsername: user.username,
  };
  const nextProjectRecord: VersionRecord = {
    ...projectRecord,
    payload: {
      ...projectPayload,
      currentStage: "manual_confirmed",
      projectStatus: "reviewing",
      aiDraftReviewStatus: "confirmed",
      aiDraftReview: manualConfirmation,
    },
    updatedAt: confirmedAt,
    updatedByUserId: user.id,
    updatedByUsername: user.username,
  };
  await saveProjectRecords([nextAssessmentRecord, nextProjectRecord]);

  const runMetadata = asRecord(run.metadata);
  const links = asRecord(runMetadata.links);
  await repo.updateRun(harnessRunId, {
    metadata: {
      ...runMetadata,
      links: {
        ...links,
        projectEvaluationId: projectRecord.id,
        assessmentVersionId: assessmentRecord.id,
        assessmentVersionCode: assessmentRecord.versionCode,
      },
      manualConfirmation: {
        ...manualConfirmation,
        projectEvaluationId: projectRecord.id,
        assessmentVersionId: assessmentRecord.id,
        sourceActionId: harnessActionId,
      },
    },
  });

  return {
    project: mapGlobalVersionToProject(nextProjectRecord),
    assessmentDraft: {
      recordId: nextAssessmentRecord.id,
      versionCode: nextAssessmentRecord.versionCode,
      status: "draft_from_ai",
      manualConfirmation,
    },
    harness: {
      runId: harnessRunId,
      actionId: harnessActionId,
      toolEventId: event.harnessToolEventId,
      status: "confirmed",
    },
  };
}
