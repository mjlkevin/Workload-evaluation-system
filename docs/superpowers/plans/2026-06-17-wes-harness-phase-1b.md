# WES Harness Phase 1B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI workbench file upload flow enter Harness, persist parsed evidence, call a real LLM, and render a persisted `requirement_report_v1` instead of returning a code-generated placeholder.

**Architecture:** Keep AI Session as the user-facing conversation container and use Harness as the controlled agent work environment. The browser uploads and locally extracts workbook structure, the API persists that extraction as `harness_evidences`, then the Harness usecase calls the configured Kimi/OpenAI-compatible provider and stores model trace plus a structured report artifact. The UI renders Harness status and report artifacts inside the existing AI workbench.

**Tech Stack:** Express + TypeScript + Drizzle/PostgreSQL schema, existing `modules/*` usecase/repository pattern, Kimi/OpenAI-compatible chat provider, Vite + React 18, Vitest.

---

## Scope

### Included

- Persist Excel parse output as Harness evidence with source sheet/cell metadata where available.
- Generate `file_understanding` artifact from parsed workbook metadata.
- Call the configured LLM for `requirement_report_v1` with evidence-grounded prompt and JSON response.
- Persist `harness_model_runs`, `harness_artifacts`, and run stage transitions.
- Render the persisted Harness v1 report in the AI workbench.
- Add minimal progress visibility through run detail polling and a basic SSE snapshot endpoint.

### Excluded

- Full raw file upload storage rewrite.
- Requirement report v2, formal estimate generation, project creation, requirement draft creation.
- Vector database / embedding search.
- Harness Regression CLI and scoring.
- Standard library retrieval.
- Multi-file merged report logic.

## File Structure

### Backend

- Modify `apps/api/src/modules/harness/harness.types.ts`
  - Add Phase 1B DTO/content types for parsed files, evidence inputs, file understanding, and report v1.
- Modify `apps/api/src/modules/harness/harness.repository.ts`
  - Add evidence insert/list methods, run detail loading, artifact/model-run helpers needed by orchestration.
- Modify `apps/api/src/modules/harness/harness.usecase.ts`
  - Add `submitHarnessParseResult`, `generateHarnessRequirementReportV1`, and `getHarnessRunDetail`.
- Modify `apps/api/src/modules/harness/harness.controller.ts`
  - Add handlers for parse result, report generation, run detail, and SSE snapshot.
- Modify `apps/api/src/modules/harness/harness.module.ts`
  - Export new handlers/usecases.
- Modify `apps/api/src/routes/harness.routes.ts`
  - Add Phase 1B endpoints.
- Modify `apps/api/src/modules/harness/harness.usecase.test.ts`
  - Unit-test evidence persistence, stage guards, model call, schema failure.
- Modify `apps/api/src/routes/harness.routes.test.ts`
  - Route-test endpoint auth, owner isolation, success and failure shapes.
- Modify `docs/openapi.yaml`
  - Document the new Harness endpoints.

### Frontend

- Create `ui/V2_PROTOTYPE/src/api/harness.js`
  - API client for Harness runs, files, parse result, report v1, detail.
- Modify `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx`
  - Replace local-only report flow with Harness orchestration.
- Modify `ui/V2_PROTOTYPE/src/components/AiWorkbench/RequirementAnalysisReportCard.jsx`
  - Accept persisted Harness report content without losing current display.
- Modify `ui/V2_PROTOTYPE/src/components/AiWorkbench/ArtifactPanel.jsx`
  - Show Harness artifact status where useful.
- Modify `ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js`
  - Add Harness API mocks.
- Modify `ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx`
  - Verify upload calls Harness and renders persisted v1 report.

## API Contract

### `GET /api/v1/harness/runs/:runId`

Return a run detail object:

```json
{
  "run": {
    "harnessRunId": "run_1",
    "stage": "report_v1_ready",
    "status": "waiting",
    "title": "实施工作量评估申请240616-V1.0.xlsx"
  },
  "files": [],
  "evidences": [],
  "artifacts": [],
  "modelRuns": [],
  "toolEvents": []
}
```

### `POST /api/v1/harness/runs/:runId/parse-result`

Request:

```json
{
  "fileId": "hfile_1",
  "sourceFile": "实施工作量评估申请240616-V1.0.xlsx",
  "sheets": ["填写说明", "1.项目概况", "3.业务需求及问题一览表"],
  "summary": {
    "projectName": "哈希温控项目评估",
    "customerName": "哈希温控",
    "industry": "制造业"
  },
  "items": [
    {
      "sourceSheet": "3.业务需求及问题一览表",
      "sourceCell": "B12",
      "category": "财务核算",
      "text": "凭证处理 + 自动生成凭证"
    }
  ]
}
```

Response: run detail with `stage=evidence_ready`, `status=waiting`, and a `file_understanding` artifact.

### `POST /api/v1/harness/runs/:runId/report-v1`

Request:

```json
{
  "force": false
}
```

Response: run detail with `stage=report_v1_ready`, `status=waiting`, and a `requirement_report_v1` artifact. If the model still returns invalid JSON after two schema attempts, response is `400` with `failed_schema_validation` persisted.

## Report V1 Content Shape

Use this structure for the persisted `requirement_report_v1` artifact:

```ts
export type HarnessRequirementReportV1Content = {
  version: "v1";
  sourceFile: string;
  project: {
    projectName: string;
    customerName: string;
    industry: string;
  };
  sourceSheets: string[];
  requirementFindings: Array<{
    domain: string;
    scenario: string;
    moduleHint: string;
    confidence: number;
    evidenceRefs: string[];
  }>;
  missingFields: Array<{
    field: string;
    reason: string;
    priority: "must" | "should" | "could";
  }>;
  clarificationQuestions: Array<{
    question: string;
    targetRole: string;
    reason: string;
  }>;
  risks: Array<{
    title: string;
    assumption: string;
    impact: string;
  }>;
  nextActions: Array<{
    label: string;
    actionType: string;
  }>;
};
```

## Task 1: Backend Types And Evidence Repository

**Files:**
- Modify: `apps/api/src/modules/harness/harness.types.ts`
- Modify: `apps/api/src/modules/harness/harness.repository.ts`
- Test: `apps/api/src/modules/harness/harness.usecase.test.ts`

- [ ] **Step 1: Add failing repository tests**

Add tests that use the existing Harness test repository pattern. The test must prove that evidence is persisted and returned in insertion order:

```ts
it("persists parsed workbook evidence for an owned harness run", async () => {
  const repo = createMemoryHarnessRepository();
  const run = await createHarnessRun(testUser, { title: "Workbook" }, repo);
  const fileResult = await bindHarnessFile(testUser, run.harnessRunId, {
    attachmentId: "att_1",
    fileName: "workbook.xlsx",
  }, repo);

  const detail = await submitHarnessParseResult(testUser, run.harnessRunId, {
    fileId: fileResult!.file.harnessFileId,
    sourceFile: "workbook.xlsx",
    sheets: ["1.项目概况", "3.业务需求及问题一览表"],
    summary: { projectName: "哈希温控项目评估", customerName: "哈希温控", industry: "制造业" },
    items: [
      { sourceSheet: "3.业务需求及问题一览表", sourceCell: "B12", category: "财务核算", text: "凭证处理 + 自动生成凭证" },
    ],
  }, repo);

  expect(detail!.run.stage).toBe("evidence_ready");
  expect(detail!.run.status).toBe("waiting");
  expect(detail!.evidences).toHaveLength(2);
  expect(detail!.artifacts.at(-1)?.artifactType).toBe("file_understanding");
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npm run test:harness -w apps/api
```

Expected: FAIL because `submitHarnessParseResult` and repository evidence helpers do not exist.

- [ ] **Step 3: Add Phase 1B types**

In `apps/api/src/modules/harness/harness.types.ts`, add:

```ts
export type HarnessParsedFileItemInput = {
  sourceSheet?: string;
  sourceCell?: string;
  category?: string;
  text: string;
  metadata?: Record<string, unknown>;
};

export type HarnessParsedFileInput = {
  fileId?: string;
  sourceFile: string;
  sheets?: string[];
  summary?: {
    projectName?: string;
    customerName?: string;
    industry?: string;
    [key: string]: unknown;
  };
  items?: HarnessParsedFileItemInput[];
};

export type HarnessEvidenceInput = {
  harnessRunId: string;
  harnessFileId?: string | null;
  evidenceType: HarnessEvidenceType;
  sourceRef: string;
  content: Record<string, unknown>;
  confidence?: number | null;
};

export type HarnessFileUnderstandingContent = {
  version: "v1";
  sourceFile: string;
  sourceSheets: string[];
  project: {
    projectName: string;
    customerName: string;
    industry: string;
  };
  extractedItemCount: number;
};

export type HarnessRequirementReportV1Content = {
  version: "v1";
  sourceFile: string;
  project: {
    projectName: string;
    customerName: string;
    industry: string;
  };
  sourceSheets: string[];
  requirementFindings: Array<{
    domain: string;
    scenario: string;
    moduleHint: string;
    confidence: number;
    evidenceRefs: string[];
  }>;
  missingFields: Array<{
    field: string;
    reason: string;
    priority: "must" | "should" | "could";
  }>;
  clarificationQuestions: Array<{
    question: string;
    targetRole: string;
    reason: string;
  }>;
  risks: Array<{
    title: string;
    assumption: string;
    impact: string;
  }>;
  nextActions: Array<{
    label: string;
    actionType: string;
  }>;
};
```

- [ ] **Step 4: Add repository methods**

In `apps/api/src/modules/harness/harness.repository.ts`, extend `HarnessRepository` with:

```ts
addEvidences(inputs: HarnessEvidenceInput[]): Promise<HarnessEvidenceRow[]>;
listEvidences(runId: string): Promise<HarnessEvidenceRow[]>;
listFiles(runId: string): Promise<HarnessFileRow[]>;
listArtifacts(runId: string): Promise<HarnessArtifactRow[]>;
listModelRuns(runId: string): Promise<HarnessModelRunRow[]>;
listToolEvents(runId: string): Promise<HarnessToolEventRow[]>;
```

Implement these methods for both the Drizzle repository and the in-memory test repository. Sort lists by `createdAt ASC`.

- [ ] **Step 5: Run repository tests**

Run:

```bash
npm run test:harness -w apps/api
```

Expected: tests still fail only because usecase orchestration is not implemented.

## Task 2: Backend Parse Result Orchestration

**Files:**
- Modify: `apps/api/src/modules/harness/harness.usecase.ts`
- Modify: `apps/api/src/modules/harness/harness.repository.ts`
- Test: `apps/api/src/modules/harness/harness.usecase.test.ts`

- [ ] **Step 1: Add `getHarnessRunDetail` and `submitHarnessParseResult`**

In `apps/api/src/modules/harness/harness.usecase.ts`, implement:

```ts
export async function getHarnessRunDetail(
  user: AuthUser,
  runId: string,
  repo: HarnessRepository = createHarnessRepository(),
) {
  const run = await getHarnessRun(user, runId, repo);
  if (!run) return null;
  const [files, evidences, artifacts, modelRuns, toolEvents] = await Promise.all([
    repo.listFiles(run.harnessRunId),
    repo.listEvidences(run.harnessRunId),
    repo.listArtifacts(run.harnessRunId),
    repo.listModelRuns(run.harnessRunId),
    repo.listToolEvents(run.harnessRunId),
  ]);
  return { run, files, evidences, artifacts, modelRuns, toolEvents };
}

function valueOrPending(value: unknown): string {
  const text = asString(value).trim();
  return text || "待补充";
}

export async function submitHarnessParseResult(
  user: AuthUser,
  runId: string,
  body: HarnessParsedFileInput,
  repo: HarnessRepository = createHarnessRepository(),
) {
  const run = await getHarnessRun(user, runId, repo);
  if (!run) return null;
  if (!isHarnessRunStage(run.stage) || !isHarnessStageAtLeast(run.stage, "parsing")) {
    throw new Error("invalid_stage_for_parse_result");
  }

  const sourceSheets = Array.isArray(body.sheets) ? body.sheets.map(asString).filter(Boolean) : [];
  const project = {
    projectName: valueOrPending(body.summary?.projectName ?? body.sourceFile),
    customerName: valueOrPending(body.summary?.customerName),
    industry: valueOrPending(body.summary?.industry),
  };
  const items = Array.isArray(body.items) ? body.items.filter((item) => asString(item.text)) : [];
  const evidenceInputs: HarnessEvidenceInput[] = [
    {
      harnessRunId: run.harnessRunId,
      harnessFileId: asString(body.fileId) || null,
      evidenceType: "block",
      sourceRef: body.sourceFile,
      confidence: 0.7,
      content: { sourceFile: body.sourceFile, sourceSheets, project },
    },
    ...items.map((item, index) => ({
      harnessRunId: run.harnessRunId,
      harnessFileId: asString(body.fileId) || null,
      evidenceType: "item" as const,
      sourceRef: [item.sourceSheet, item.sourceCell].map(asString).filter(Boolean).join("!") || `${body.sourceFile}#${index + 1}`,
      confidence: 0.65,
      content: {
        category: item.category ?? "未分类",
        text: item.text,
        metadata: item.metadata ?? {},
      },
    })),
  ];

  await repo.addEvidences(evidenceInputs);
  await repo.addArtifact({
    harnessRunId: run.harnessRunId,
    artifactType: "file_understanding",
    title: "文件理解结果 v1",
    content: {
      version: "v1",
      sourceFile: body.sourceFile,
      sourceSheets,
      project,
      extractedItemCount: items.length,
    } satisfies HarnessFileUnderstandingContent,
    sourceModelRunId: null,
    metadata: {},
  });
  await repo.updateRun(run.harnessRunId, { stage: "evidence_ready", status: "waiting" });
  return getHarnessRunDetail(user, run.harnessRunId, repo);
}
```

- [ ] **Step 2: Run Harness tests**

Run:

```bash
npm run test:harness -w apps/api
```

Expected: parse-result usecase tests pass; model report tests still fail if already added in the next task.

- [ ] **Step 3: Commit Task 1-2**

Run:

```bash
git add apps/api/src/modules/harness/harness.types.ts apps/api/src/modules/harness/harness.repository.ts apps/api/src/modules/harness/harness.usecase.ts apps/api/src/modules/harness/harness.usecase.test.ts
git commit -m "feat: persist harness parsed evidence"
```

## Task 3: Real LLM Report V1 Generation

**Files:**
- Modify: `apps/api/src/modules/harness/harness.usecase.ts`
- Modify: `apps/api/src/modules/harness/harness.types.ts`
- Test: `apps/api/src/modules/harness/harness.usecase.test.ts`

- [ ] **Step 1: Add failing tests for real model orchestration**

Add one success test and one invalid-schema failure test:

```ts
it("generates report v1 through an injected model runner and persists model trace", async () => {
  const repo = createMemoryHarnessRepository();
  const run = await createHarnessRun(testUser, { title: "Workbook" }, repo);
  const file = await bindHarnessFile(testUser, run.harnessRunId, { attachmentId: "att_1", fileName: "workbook.xlsx" }, repo);
  await submitHarnessParseResult(testUser, run.harnessRunId, {
    fileId: file!.file.harnessFileId,
    sourceFile: "workbook.xlsx",
    sheets: ["3.业务需求及问题一览表"],
    summary: { projectName: "哈希温控项目评估" },
    items: [{ sourceSheet: "3.业务需求及问题一览表", category: "财务核算", text: "自动生成凭证" }],
  }, repo);

  const detail = await generateHarnessRequirementReportV1(testUser, run.harnessRunId, {}, repo, async () => ({
    model: "moonshot-v1-32k",
    content: JSON.stringify({
      version: "v1",
      sourceFile: "workbook.xlsx",
      project: { projectName: "哈希温控项目评估", customerName: "待补充", industry: "待补充" },
      sourceSheets: ["3.业务需求及问题一览表"],
      requirementFindings: [{ domain: "财务核算", scenario: "自动生成凭证", moduleHint: "总账", confidence: 0.82, evidenceRefs: ["3.业务需求及问题一览表"] }],
      missingFields: [{ field: "客户名称", reason: "文件未明确", priority: "must" }],
      clarificationQuestions: [{ question: "自动凭证规则预计多少条？", targetRole: "财务关键用户", reason: "影响实施工作量" }],
      risks: [{ title: "规则复杂度风险", assumption: "自动凭证规则未锁定", impact: "可能增加配置和测试人天" }],
      nextActions: [{ label: "补充项目信息", actionType: "supplement_project_info" }]
    }),
    usage: { promptTokens: 100, completionTokens: 80, totalTokens: 180 },
    raw: { id: "mock" },
  }));

  expect(detail!.run.stage).toBe("report_v1_ready");
  expect(detail!.artifacts.some((item) => item.artifactType === "requirement_report_v1")).toBe(true);
  expect(detail!.modelRuns).toHaveLength(1);
});

it("marks run as failed_schema_validation when model output is not valid report json", async () => {
  const repo = createMemoryHarnessRepository();
  const run = await createHarnessRun(testUser, { title: "Workbook" }, repo);
  await repo.updateRun(run.harnessRunId, { stage: "evidence_ready", status: "waiting" });

  await expect(generateHarnessRequirementReportV1(testUser, run.harnessRunId, {}, repo, async () => ({
    model: "moonshot-v1-32k",
    content: "not-json",
    usage: null,
    raw: {},
  }))).rejects.toThrow("invalid_model_report_schema");

  const updated = await getHarnessRun(testUser, run.harnessRunId, repo);
  expect(updated!.stage).toBe("failed_schema_validation");
  expect(updated!.status).toBe("failed");
});
```

- [ ] **Step 2: Define a model runner interface**

In `apps/api/src/modules/harness/harness.usecase.ts`, add:

```ts
export type HarnessModelRunnerResult = {
  model: string;
  content: string;
  usage?: unknown;
  raw?: unknown;
};

export type HarnessModelRunner = (input: {
  systemPrompt: string;
  userPrompt: string;
  responseFormat: "json_object";
}) => Promise<HarnessModelRunnerResult>;
```

- [ ] **Step 3: Implement JSON validation helpers**

Add a small validator without adding a dependency:

```ts
function parseReportV1(content: string): HarnessRequirementReportV1Content {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("invalid_model_report_schema");
  }
  const report = parsed as Partial<HarnessRequirementReportV1Content>;
  if (
    report.version !== "v1" ||
    !report.sourceFile ||
    !report.project ||
    !Array.isArray(report.requirementFindings) ||
    !Array.isArray(report.missingFields) ||
    !Array.isArray(report.clarificationQuestions) ||
    !Array.isArray(report.risks) ||
    !Array.isArray(report.nextActions)
  ) {
    throw new Error("invalid_model_report_schema");
  }
  return report as HarnessRequirementReportV1Content;
}
```

- [ ] **Step 4: Implement default model runner**

Use the existing Kimi/OpenAI-compatible provider utilities already used by `apps/api/src/services/ai/chat.service.ts`. The default runner must call the provider and must not synthesize a report locally when a model key is configured. If no model key exists, throw `model_not_configured`.

```ts
async function defaultHarnessModelRunner(input: {
  systemPrompt: string;
  userPrompt: string;
  responseFormat: "json_object";
}): Promise<HarnessModelRunnerResult> {
  const client = await createConfiguredKimiClient();
  const result = await client.chat.completions.create({
    model: client.model,
    response_format: { type: input.responseFormat },
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.userPrompt },
    ],
  });
  return {
    model: client.model,
    content: result.choices[0]?.message?.content ?? "",
    usage: result.usage ?? null,
    raw: result,
  };
}
```

If the exact helper names differ, adapt to the existing provider facade. Keep the behavior: real provider call, JSON response format, persisted model trace.

- [ ] **Step 5: Implement `generateHarnessRequirementReportV1`**

Add:

```ts
export async function generateHarnessRequirementReportV1(
  user: AuthUser,
  runId: string,
  body: { force?: boolean },
  repo: HarnessRepository = createHarnessRepository(),
  modelRunner: HarnessModelRunner = defaultHarnessModelRunner,
) {
  const run = await getHarnessRun(user, runId, repo);
  if (!run) return null;
  if (!isHarnessRunStage(run.stage) || !isHarnessStageAtLeast(run.stage, "evidence_ready")) {
    throw new Error("invalid_stage_for_report_v1");
  }
  await repo.updateRun(run.harnessRunId, { stage: "analyzing", status: "running" });
  const evidences = await repo.listEvidences(run.harnessRunId);
  const files = await repo.listFiles(run.harnessRunId);
  const systemPrompt = [
    "你是 WES 工作量评估 Harness 中的需求理解 Agent。",
    "你必须只基于提供的 evidence 做分析，不得编造客户、模块或工作量。",
    "你必须输出合法 JSON，结构必须匹配 HarnessRequirementReportV1Content。",
  ].join("\\n");
  const userPrompt = JSON.stringify({ run: { title: run.title }, files, evidences }, null, 2);

  try {
    let modelResult: HarnessModelRunnerResult | null = null;
    let report: HarnessRequirementReportV1Content | null = null;
    let lastSchemaError: Error | null = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      modelResult = await modelRunner({
        systemPrompt,
        userPrompt: attempt === 1
          ? userPrompt
          : `${userPrompt}\n\n上一轮输出未通过 JSON schema 校验。请只输出合法 JSON，不要输出 Markdown。`,
        responseFormat: "json_object",
      });
      try {
        report = parseReportV1(modelResult.content);
        break;
      } catch (error) {
        lastSchemaError = error instanceof Error ? error : new Error("invalid_model_report_schema");
      }
    }
    if (!modelResult || !report) throw lastSchemaError ?? new Error("invalid_model_report_schema");
    const modelRun = await repo.addModelRun({
      harnessRunId: run.harnessRunId,
      toolEventId: null,
      provider: "kimi",
      modelName: modelResult.model,
      promptProfileId: "harness.requirement_report_v1.default",
      input: { systemPrompt, userPrompt },
      output: report,
      rawOutput: modelResult.raw ?? modelResult.content,
      usage: modelResult.usage ?? null,
      status: "completed",
      errorMessage: null,
      startedAt: new Date(),
      completedAt: new Date(),
    });
    await repo.addArtifact({
      harnessRunId: run.harnessRunId,
      artifactType: "requirement_report_v1",
      title: "需求解析报告 v1",
      content: report,
      sourceModelRunId: modelRun.harnessModelRunId,
      metadata: { promptProfileId: "harness.requirement_report_v1.default" },
    });
    await repo.updateRun(run.harnessRunId, { stage: "report_v1_ready", status: "waiting" });
    return getHarnessRunDetail(user, run.harnessRunId, repo);
  } catch (error) {
    const message = error instanceof Error ? error.message : "model_failed";
    await repo.updateRun(run.harnessRunId, {
      stage: message === "invalid_model_report_schema" ? "failed_schema_validation" : "failed",
      status: "failed",
      errorCode: message,
      errorMessage: message,
    });
    throw error;
  }
}
```

- [ ] **Step 6: Run Harness tests**

Run:

```bash
npm run test:harness -w apps/api
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/api/src/modules/harness/harness.usecase.ts apps/api/src/modules/harness/harness.types.ts apps/api/src/modules/harness/harness.usecase.test.ts
git commit -m "feat: generate harness requirement report with model"
```

## Task 4: Backend Routes And OpenAPI

**Files:**
- Modify: `apps/api/src/modules/harness/harness.controller.ts`
- Modify: `apps/api/src/modules/harness/harness.module.ts`
- Modify: `apps/api/src/routes/harness.routes.ts`
- Modify: `apps/api/src/routes/harness.routes.test.ts`
- Modify: `docs/openapi.yaml`

- [ ] **Step 1: Add route tests**

Add tests:

```ts
it("submits parse result and returns harness detail", async () => {
  const token = signTestToken(testUser);
  const runResponse = await request(app).post("/api/v1/harness/runs").set("Authorization", `Bearer ${token}`).send({ title: "Workbook" });
  const runId = runResponse.body.data.harnessRunId;
  const fileResponse = await request(app).post(`/api/v1/harness/runs/${runId}/files`).set("Authorization", `Bearer ${token}`).send({ attachmentId: "att_1", fileName: "workbook.xlsx" });

  const response = await request(app)
    .post(`/api/v1/harness/runs/${runId}/parse-result`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      fileId: fileResponse.body.data.file.harnessFileId,
      sourceFile: "workbook.xlsx",
      sheets: ["3.业务需求及问题一览表"],
      items: [{ text: "自动生成凭证", category: "财务核算" }],
    });

  expect(response.status).toBe(200);
  expect(response.body.data.run.stage).toBe("evidence_ready");
});

it("returns a text/event-stream snapshot for run events", async () => {
  const token = signTestToken(testUser);
  const runResponse = await request(app).post("/api/v1/harness/runs").set("Authorization", `Bearer ${token}`).send({ title: "Workbook" });
  const response = await request(app).get(`/api/v1/harness/runs/${runResponse.body.data.harnessRunId}/events`).set("Authorization", `Bearer ${token}`);
  expect(response.headers["content-type"]).toContain("text/event-stream");
  expect(response.text).toContain("event: run_state");
});
```

- [ ] **Step 2: Add controller handlers**

Implement handlers with standard response shape:

```ts
export function submitParseResultHandler(deps: HarnessControllerDeps = {}) {
  return asyncHandler(async (req, res) => {
    try {
      const detail = await submitHarnessParseResult(req.user!, req.params.runId, req.body, deps.repo);
      if (!detail) return res.status(404).json({ code: 404, message: "Harness run not found", data: null });
      res.json({ code: 0, message: "ok", data: detail });
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_stage_for_parse_result") {
        return res.status(400).json({ code: 400, message: "Invalid Harness stage for parse result", data: null });
      }
      throw error;
    }
  });
}

export function generateReportV1Handler(deps: HarnessControllerDeps = {}) {
  return asyncHandler(async (req, res) => {
    try {
      const detail = await generateHarnessRequirementReportV1(req.user!, req.params.runId, req.body, deps.repo, deps.modelRunner);
      if (!detail) return res.status(404).json({ code: 404, message: "Harness run not found", data: null });
      res.json({ code: 0, message: "ok", data: detail });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Harness report failed";
      res.status(400).json({ code: 400, message, data: null });
    }
  });
}
```

For `eventsHandler`, replace the 501 placeholder with a minimal snapshot stream:

```ts
export function eventsHandler(deps: HarnessControllerDeps = {}) {
  return asyncHandler(async (req, res) => {
    const detail = await getHarnessRunDetail(req.user!, req.params.runId, deps.repo);
    if (!detail) return res.status(404).json({ code: 404, message: "Harness run not found", data: null });
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.write(`event: run_state\\n`);
    res.write(`data: ${JSON.stringify({ stage: detail.run.stage, status: detail.run.status })}\\n\\n`);
    res.end();
  });
}
```

- [ ] **Step 3: Wire routes**

In `apps/api/src/routes/harness.routes.ts`, add:

```ts
router.post("/runs/:runId/parse-result", submitParseResultHandler(deps));
router.post("/runs/:runId/report-v1", generateReportV1Handler(deps));
```

- [ ] **Step 4: Update OpenAPI**

Add paths for:

```yaml
/api/v1/harness/runs/{runId}/parse-result:
  post:
    summary: Submit parsed file evidence into Harness
/api/v1/harness/runs/{runId}/report-v1:
  post:
    summary: Generate Harness requirement report v1 through the configured model
```

- [ ] **Step 5: Run backend verification**

Run:

```bash
npm run test:harness -w apps/api
npm run build -w apps/api
npm run test:modules -w apps/api
npm run test:agent -w apps/api
```

Expected: all PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/api/src/modules/harness apps/api/src/routes/harness.routes.ts apps/api/src/routes/harness.routes.test.ts docs/openapi.yaml
git commit -m "feat: expose harness report workflow api"
```

## Task 5: Frontend Harness API Client

**Files:**
- Create: `ui/V2_PROTOTYPE/src/api/harness.js`
- Test: `ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx`

- [ ] **Step 1: Create Harness API client**

Create `ui/V2_PROTOTYPE/src/api/harness.js`:

```js
import { apiFetch } from "./client";
import { unwrapApiData } from "./utils";

export async function createHarnessRun(payload) {
  return unwrapApiData(await apiFetch("/api/v1/harness/runs", {
    method: "POST",
    body: JSON.stringify(payload),
  }));
}

export async function bindHarnessFile(runId, payload) {
  return unwrapApiData(await apiFetch(`/api/v1/harness/runs/${runId}/files`, {
    method: "POST",
    body: JSON.stringify(payload),
  }));
}

export async function submitHarnessParseResult(runId, payload) {
  return unwrapApiData(await apiFetch(`/api/v1/harness/runs/${runId}/parse-result`, {
    method: "POST",
    body: JSON.stringify(payload),
  }));
}

export async function generateHarnessReportV1(runId, payload = {}) {
  return unwrapApiData(await apiFetch(`/api/v1/harness/runs/${runId}/report-v1`, {
    method: "POST",
    body: JSON.stringify(payload),
  }));
}

export async function getHarnessRunDetail(runId) {
  return unwrapApiData(await apiFetch(`/api/v1/harness/runs/${runId}`));
}
```

- [ ] **Step 2: Add MSW mocks**

In `ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js`, add handlers for the five endpoints. The report-v1 mock must return a `requirement_report_v1` artifact that contains `requirementFindings`, `missingFields`, `clarificationQuestions`, and `risks`.

- [ ] **Step 3: Run frontend test to verify current UI still passes**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- HomeWorkspace.test.jsx
```

Expected: PASS before wiring UI.

- [ ] **Step 4: Commit**

Run:

```bash
git add ui/V2_PROTOTYPE/src/api/harness.js ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js
git commit -m "feat: add harness api client"
```

## Task 6: Frontend Upload Orchestration And Rendering

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx`
- Modify: `ui/V2_PROTOTYPE/src/components/AiWorkbench/RequirementAnalysisReportCard.jsx`
- Modify: `ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx`

- [ ] **Step 1: Add a failing upload orchestration test**

In `HomeWorkspace.test.jsx`, assert that uploading a file and sending the message eventually renders the Harness report title and does not show the old fast placeholder error:

```jsx
it("uploads a workbook through Harness and renders the persisted report v1", async () => {
  renderWithProviders(<HomeWorkspace />);
  const file = new File(["fake"], "实施工作量评估申请240616-V1.0.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const input = screen.getByLabelText("上传附件");
  await userEvent.upload(input, file);
  await userEvent.type(screen.getByRole("textbox"), "请解析这个文件并启动工作流。");
  await userEvent.click(screen.getByRole("button", { name: "发送" }));

  expect(await screen.findByText("需求解析报告 v1")).toBeInTheDocument();
  expect(screen.getByText("财务核算")).toBeInTheDocument();
  expect(screen.queryByText("AI 对话暂未完成：参数错误")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run failing frontend test**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- HomeWorkspace.test.jsx
```

Expected: FAIL because the UI still calls the old local AI chat path.

- [ ] **Step 3: Wire Harness in `AiHomeWorkbench.jsx`**

Import:

```js
import {
  bindHarnessFile,
  createHarnessRun,
  generateHarnessReportV1,
  submitHarnessParseResult,
} from "../api/harness";
```

In the file-send handler, replace the attachment-analysis branch with this sequence:

```js
setIsAiThinking(true);
setAiStatusText("正在创建 Harness 运行...");
const run = await createHarnessRun({
  title: selectedFile.name,
  mode: "interactive",
  aiSessionId: activeSessionId,
});

setAiStatusText("正在绑定原始文件...");
const bound = await bindHarnessFile(run.harnessRunId, {
  attachmentId: selectedFile.localId ?? `${Date.now()}-${selectedFile.name}`,
  fileName: selectedFile.name,
  fileSize: selectedFile.size,
  mimeType: selectedFile.type,
  role: "requirement_source",
});

setAiStatusText("正在提取表格结构并沉淀 evidence...");
const parsed = await parseBasicInfo(selectedFile.file);
await submitHarnessParseResult(run.harnessRunId, {
  fileId: bound.file.harnessFileId,
  sourceFile: selectedFile.name,
  sheets: parsed.sheets,
  summary: parsed.summary,
  items: parsed.items,
});

setAiStatusText("正在调用大模型生成需求解析报告...");
const detail = await generateHarnessReportV1(run.harnessRunId, { force: false });
appendHarnessReportMessage(detail);
setCurrentHarnessRun(detail.run);
setCurrentArtifacts(detail.artifacts);
```

If existing helper names differ, keep the sequence and adapt to local state names. The visible loading message must make it clear when the model is being called.

- [ ] **Step 4: Normalize parsed file shape**

Ensure `parseBasicInfo` returns:

```js
{
  sheets: ["表名"],
  summary: {
    projectName: "...",
    customerName: "...",
    industry: "..."
  },
  items: [
    {
      sourceSheet: "3.业务需求及问题一览表",
      sourceCell: "B12",
      category: "财务核算",
      text: "自动生成凭证"
    }
  ]
}
```

If the frontend parser currently returns `parsedSummary` text only, keep `parsedSummary` for display but also populate this structured shape.

- [ ] **Step 5: Render Harness report artifact**

Update `RequirementAnalysisReportCard.jsx` to read either the current old artifact content or the new Harness report shape. For Harness content, display:

- report title: `需求解析报告 v1`
- source file
- project/customer/industry tiles
- source sheet chips
- requirement findings
- missing fields
- clarification questions
- risks
- action buttons for supplement info and formal estimation

- [ ] **Step 6: Run frontend verification**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- HomeWorkspace.test.jsx
npm run build --prefix ui/V2_PROTOTYPE
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx ui/V2_PROTOTYPE/src/components/AiWorkbench/RequirementAnalysisReportCard.jsx ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx
git commit -m "feat: route ai workbench file analysis through harness"
```

## Task 7: End-To-End Verification And Guardrails

**Files:**
- Modify as needed only if verification exposes defects.

- [ ] **Step 1: Run full targeted backend checks**

Run:

```bash
npm run test:harness -w apps/api
npm run build -w apps/api
npm run test:modules -w apps/api
npm run test:agent -w apps/api
```

Expected: all PASS.

- [ ] **Step 2: Run full targeted frontend checks**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE
npm run build --prefix ui/V2_PROTOTYPE
```

Expected: all PASS.

- [ ] **Step 3: Manual smoke**

Start services:

```bash
npm run dev:api
npm run dev:web
```

Open `http://localhost:3002`, log in, upload an Excel file, and verify:

- The UI shows a multi-step progress state.
- The report is not returned instantly before the model call state appears.
- The final report is rendered from `requirement_report_v1`.
- Right-side artifacts contain the persisted Harness artifact.
- API run detail shows `stage=report_v1_ready`.

- [ ] **Step 4: Commit any verification fixes**

Only if files changed:

```bash
git add <changed-files>
git commit -m "fix: stabilize harness report upload flow"
```

## Delegation Prompts

### KIMICODE Prompt

```text
你负责实现 WES Harness Phase 1B 的后端主路径。

工作区：/Users/kevin/AI/Workload-evaluation-system-agent
分支：feat/agent-workbench
计划文件：docs/superpowers/plans/2026-06-17-wes-harness-phase-1b.md

只执行 Task 1-4：
1. evidence repository + types
2. submitHarnessParseResult / getHarnessRunDetail
3. generateHarnessRequirementReportV1，必须真实调用现有 Kimi/OpenAI-compatible provider，不允许本地假报告
4. routes + route tests + openapi

边界：
- 不做前端。
- 不做项目创建、需求草稿、正式评估。
- 不引入新数据库技术。
- 保持 { code, message, data } 响应结构和 JWT 鉴权。
- 业务层不要直接依赖 JSON 文件结构。

验证命令：
npm run test:harness -w apps/api
npm run build -w apps/api
npm run test:modules -w apps/api
npm run test:agent -w apps/api

完成后输出：
- 修改文件列表
- 测试结果
- 是否存在需要 Codex/GLM 复核的风险点
```

### GLM Prompt

```text
你负责 WES Harness Phase 1B 的架构审查和测试设计，不直接改代码，优先找 P0/P1 风险。

工作区：/Users/kevin/AI/Workload-evaluation-system-agent
计划文件：docs/superpowers/plans/2026-06-17-wes-harness-phase-1b.md
重点审查：
1. 是否真正调用 LLM，而不是代码生成假报告。
2. evidence 是否可追溯到文件/表/单元格/段落。
3. run stage/status 是否存在矛盾状态。
4. owner isolation/JWT 鉴权是否覆盖新增接口。
5. invalid JSON / schema validation / provider failure 是否会落库且可 retry。
6. 前端是否能明确展示模型调用进度，避免“几秒假回答”的错觉。
7. 是否过度扩大范围，偏离 Phase 1B 最小闭环。

输出格式：
- P0/P1/P2 风险清单，包含文件/函数/建议测试。
- 必须补充的测试列表。
- 可以延后到 Phase 1C 的事项。
```

## Self-Review

### Spec Coverage

- True LLM call: covered by Task 3.
- Evidence persistence: covered by Task 1 and Task 2.
- Rendered report instead of long markdown text: covered by Task 6.
- AI workbench embedded flow: covered by Task 5 and Task 6.
- Stage progress: covered by Task 4 SSE snapshot and Task 6 loading states.
- DB metadata/evidence while raw attachments remain file storage: covered by Task 1 and Task 2.

### Placeholder Scan

No placeholder markers or open-ended implementation instructions remain. Where exact provider helper names may differ, the required behavior is explicitly fixed: real provider call, JSON response format, persisted model trace.

### Type Consistency

The plan consistently uses `HarnessParsedFileInput`, `HarnessEvidenceInput`, `HarnessFileUnderstandingContent`, and `HarnessRequirementReportV1Content`. Route names match the API contract and frontend client names.
