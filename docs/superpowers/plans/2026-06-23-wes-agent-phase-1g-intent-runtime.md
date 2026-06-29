# WES Agent Phase 1G Intent Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the WES AI Workbench from a fixed Harness report pipeline into an intent-routed task runtime where files provide context and user intent decides whether to answer, query WES data, generate reports, or request confirmation.

**Architecture:** Keep existing Harness report and draft flows intact, but add a small intent runtime in the AI workbench path. Backend classifies the user turn, builds scoped context, and returns answer/suggestedActions/trace. Frontend stops auto-generating v2 from every post-v1 text message and only enters Harness report generation from explicit report intent or structured-card submission.

**Tech Stack:** Express + TypeScript modules/services, existing AI facade in `apps/api/src/modules/ai`, Kimi-compatible provider, JSON-backed traditional WES records, PostgreSQL-backed Harness, Vite + React 18, Vitest, Node `tsx --test`.

---

## Scope

### Included

- Intent taxonomy for `capability_discovery`, `domain_qa`, `attachment_summary`, `attachment_qa`, `harness_report_generation`, `harness_answer_submission`, `wes_data_query`, `write_action_request`, and `unsupported_or_out_of_scope`.
- Backend intent router with rule-first classification and model-ready extension point.
- Context builder that safely exposes current user, role/capabilities, latest file context, latest Harness artifacts, and owner-scoped project summaries.
- Dispatcher response shape with `intent`, `answer`, `suggestedActions`, and `trace`.
- Frontend send-path change: normal text after v1 calls chat/dispatch, not `submitHarnessAnswers + generateHarnessReportV2`.
- Frontend explicit report trigger: selected file + explicit “生成报告/需求解析/评估输入” continues to existing Harness v1 path.
- Structured card submission remains the only default v2 trigger.
- Tests and docs for the new behavior.

### Excluded

- Low-code workflow designer. Keep it as Phase 1H.
- Vector DB, Prompt Profile CRUD, standard governance Harness-ization.
- Desktop connectors, local directory access, shell execution.
- Automatic creation of formal requirements, formal assessments, or formal project records.
- Rewriting Harness schemas or migrating traditional WES records to PostgreSQL.

## File Structure

### Backend

- Create `apps/api/src/services/ai/workbench-intent.service.ts`
  - Pure intent classification and typed response helpers.
- Create `apps/api/src/services/ai/workbench-context.service.ts`
  - Build user/session/Harness/WES data context without direct frontend-state dependency.
- Create `apps/api/src/services/ai/workbench-dispatch.service.ts`
  - Execute intent by calling existing model chat, attachment answer helpers, WES query helpers, or Harness recommendations.
- Modify `apps/api/src/services/ai/chat.service.ts`
  - Route `homeWorkbenchChat` through the dispatcher while preserving existing response envelope.
- Modify `apps/api/src/modules/ai/ai.controller.ts`, `ai.usecase.ts`, `ai.module.ts`
  - Export dispatcher if a new endpoint is chosen; otherwise keep `homeWorkbenchChat` as the public route.
- Optional modify `apps/api/src/routes/ai.routes.ts`
  - Add `POST /ai/home-workbench/dispatch` only if implementation chooses an explicit endpoint.
- Modify `apps/api/package.json`
  - Include new backend intent tests in `test:modules` or `test:ai`.

### Frontend

- Modify `ui/V2_PROTOTYPE/src/api/ai.js`
  - Add `sendHomeWorkbenchMessage(payload)` or `dispatchHomeWorkbench(payload)`.
- Modify `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx`
  - Split selected-file handling into explicit report generation vs attachment Q&A.
  - Remove the implicit `harnessV1Context` text-to-v2 branch.
  - Keep `handleStructuredSupplement` as v2 path.
  - Render suggested actions from dispatcher.
- Modify `ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx`
  - Replace old “v1 follow-up generates v2” expectation with “v1 follow-up answers normally”.
  - Add upload + business question test.
  - Add capability discovery test.
- Modify `ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js`
  - Add/adjust AI workbench chat mock response with `intent` and `suggestedActions`.

### Docs

- Modify `docs/openapi.yaml` if adding a new dispatch endpoint or response fields.
- Modify `03_技术设计/系统演进/实现与文档对齐说明.md` after implementation.
- Modify dashboard files under `03_技术设计/系统架构/WES-Agent-升级总看板/` after implementation status changes.

## API Response Contract

Use the existing `{ code, message, data }` envelope. The `data` shape should be compatible with current `homeWorkbenchChat` and extend it:

```ts
export type WorkbenchIntent =
  | "capability_discovery"
  | "domain_qa"
  | "attachment_summary"
  | "attachment_qa"
  | "harness_report_generation"
  | "harness_answer_submission"
  | "wes_data_query"
  | "write_action_request"
  | "unsupported_or_out_of_scope";

export type WorkbenchSuggestedAction = {
  id: string;
  label: string;
  actionType:
    | "send_message"
    | "generate_requirement_report"
    | "submit_structured_answers"
    | "open_project_list"
    | "confirm_write_action";
  requiresConfirm: boolean;
  disabled?: boolean;
  payload?: Record<string, unknown>;
};

export type WorkbenchDispatchData = {
  intent: WorkbenchIntent;
  answer: string;
  businessRole: string;
  roleLabel: string;
  model?: string;
  rawContent?: string;
  session?: unknown;
  suggestedActions: WorkbenchSuggestedAction[];
  trace: {
    intentConfidence: number;
    routingRule: string;
    contextRefs: string[];
  };
};
```

## Task 1: Backend Intent Router

**Files:**
- Create: `apps/api/src/services/ai/workbench-intent.service.ts`
- Test: `apps/api/src/services/ai/workbench-intent.service.test.ts`
- Modify: `apps/api/package.json`

- [ ] **Step 1: Write the failing tests**

Add tests like:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { routeWorkbenchIntent } from "./workbench-intent.service";

test("routes capability discovery", () => {
  const result = routeWorkbenchIntent({ message: "你能做什么？", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "capability_discovery");
  assert.equal(result.routingRule, "capability_keywords");
});

test("does not route post-v1 ordinary question to v2", () => {
  const result = routeWorkbenchIntent({ message: "这个风险是什么意思？", hasAttachment: false, hasLatestV1Artifact: true });
  assert.equal(result.intent, "domain_qa");
});

test("routes explicit v2 generation only when requested", () => {
  const result = routeWorkbenchIntent({ message: "请基于我补充的信息生成 v2 报告", hasAttachment: false, hasLatestV1Artifact: true });
  assert.equal(result.intent, "harness_answer_submission");
});

test("routes attachment business question to attachment qa", () => {
  const result = routeWorkbenchIntent({ message: "多组织业务往来一般包含哪些模块？", hasAttachment: true, hasLatestV1Artifact: false });
  assert.equal(result.intent, "attachment_qa");
});

test("routes WES data query", () => {
  const result = routeWorkbenchIntent({ message: "我之前创建过哪些项目？", hasAttachment: false, hasLatestV1Artifact: false });
  assert.equal(result.intent, "wes_data_query");
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
npm run test:modules -w apps/api
```

Expected: fails because `workbench-intent.service.ts` does not exist or is not included.

- [ ] **Step 3: Implement the pure router**

Create a small rule-first router:

```ts
export type WorkbenchIntent = "capability_discovery" | "domain_qa" | "attachment_summary" | "attachment_qa" | "harness_report_generation" | "harness_answer_submission" | "wes_data_query" | "write_action_request" | "unsupported_or_out_of_scope";

export type WorkbenchIntentInput = {
  message: string;
  hasAttachment: boolean;
  hasLatestV1Artifact: boolean;
  clientAction?: string;
};

export type WorkbenchIntentResult = {
  intent: WorkbenchIntent;
  confidence: number;
  routingRule: string;
};

export function routeWorkbenchIntent(input: WorkbenchIntentInput): WorkbenchIntentResult {
  const text = input.message.trim().toLowerCase();
  if (input.clientAction === "submit_structured_answers") return { intent: "harness_answer_submission", confidence: 1, routingRule: "client_action" };
  if (/你能做什么|能做什么|你可以做什么|帮助/.test(text)) return { intent: "capability_discovery", confidence: 0.95, routingRule: "capability_keywords" };
  if (/我之前.*项目|创建过哪些项目|历史项目|我的项目/.test(text)) return { intent: "wes_data_query", confidence: 0.9, routingRule: "wes_data_keywords" };
  if (/创建|生成|进入|发布/.test(text) && /草稿|正式|评估记录|需求记录/.test(text)) return { intent: "write_action_request", confidence: 0.85, routingRule: "write_action_keywords" };
  if (/生成|输出|创建/.test(text) && /需求解析报告|需求包|评估输入|v1|报告/.test(text)) return { intent: input.hasLatestV1Artifact ? "harness_answer_submission" : "harness_report_generation", confidence: 0.9, routingRule: "report_generation_keywords" };
  if (input.hasAttachment) return { intent: text ? "attachment_qa" : "attachment_summary", confidence: 0.8, routingRule: "attachment_context" };
  return { intent: "domain_qa", confidence: 0.65, routingRule: "default_domain_qa" };
}
```

- [ ] **Step 4: Include test file in script**

Add `src/services/ai/workbench-intent.service.test.ts` to `apps/api/package.json` under an appropriate script. Prefer `test:modules` if this is part of workbench routing regression.

- [ ] **Step 5: Verify**

Run:

```bash
npm run test:modules -w apps/api
npm run build -w apps/api
```

Expected: pass.

## Task 2: Backend Context Builder And WES Data Query

**Files:**
- Create: `apps/api/src/services/ai/workbench-context.service.ts`
- Test: `apps/api/src/services/ai/workbench-context.service.test.ts`
- Use: `apps/api/src/modules/project-evaluations/project-evaluations.usecase.ts`

- [ ] **Step 1: Write tests for owner-scoped project summaries**

Use seeded in-memory JSON store helpers already used by module tests where possible. Assert that user A sees only user A project summaries and user B does not.

```ts
test("buildWorkbenchContext returns owner-scoped project summaries", () => {
  const context = buildWorkbenchContext({
    user: { id: "user-a", username: "elly", role: "user", capabilities: ["estimates:read"] } as any,
    message: "我之前创建过哪些项目？",
    latestHarnessArtifact: null,
    attachment: null,
  });
  assert.ok(context.user.id === "user-a");
  assert.ok(Array.isArray(context.visibleProjects));
});
```

- [ ] **Step 2: Implement context builder**

Keep it small and pure where possible:

```ts
import type { AuthUser } from "../../types";
import { listProjectEvaluationsForUser } from "../../modules/project-evaluations/project-evaluations.usecase";

export type WorkbenchContext = {
  user: { id: string; username: string; role: string; capabilities: string[] };
  attachment?: { name: string; parsedSummary?: unknown };
  latestHarnessArtifact?: { harnessRunId?: string; artifactType?: string; content?: unknown };
  visibleProjects: Array<{ projectId: string; projectName: string; customerName: string; status: string; updatedAt: string }>;
  contextRefs: string[];
};

export function buildWorkbenchContext(input: {
  user: AuthUser;
  attachment?: { name: string; parsedSummary?: unknown } | null;
  latestHarnessArtifact?: { harnessRunId?: string; artifactType?: string; content?: unknown } | null;
}): WorkbenchContext {
  const visibleProjects = listProjectEvaluationsForUser(input.user).slice(0, 8).map((project) => ({
    projectId: project.projectId,
    projectName: project.projectName,
    customerName: project.customerName,
    status: project.status,
    updatedAt: project.updatedAt,
  }));
  return {
    user: { id: input.user.id, username: input.user.username, role: input.user.role, capabilities: input.user.capabilities ?? [] },
    attachment: input.attachment ?? undefined,
    latestHarnessArtifact: input.latestHarnessArtifact ?? undefined,
    visibleProjects,
    contextRefs: [
      input.attachment?.name ? `attachment:${input.attachment.name}` : "",
      input.latestHarnessArtifact?.harnessRunId ? `harness:${input.latestHarnessArtifact.harnessRunId}` : "",
    ].filter(Boolean),
  };
}
```

- [ ] **Step 3: Verify**

Run:

```bash
npm run test:modules -w apps/api
npm run build -w apps/api
```

Expected: pass.

## Task 3: Backend Dispatcher

**Files:**
- Create: `apps/api/src/services/ai/workbench-dispatch.service.ts`
- Modify: `apps/api/src/services/ai/chat.service.ts`
- Test: backend tests for dispatcher behavior.

- [ ] **Step 1: Write dispatcher tests**

Test these minimum cases:

- `capability_discovery` returns capability list and no write action.
- `wes_data_query` returns owner-scoped project list text.
- `attachment_qa` returns an answer and suggested action `generate_requirement_report`.
- `harness_answer_submission` is not performed automatically by ordinary chat.

- [ ] **Step 2: Implement dispatcher result shape**

```ts
export async function dispatchHomeWorkbenchTurn(input: {
  user: AuthUser;
  workflowKey: string;
  messages: HomeWorkbenchMessage[];
  latestAttachment?: { name: string; parsedSummary?: unknown } | null;
  latestHarnessArtifact?: { harnessRunId?: string; artifactType?: string; content?: unknown } | null;
  clientAction?: string;
}) {
  const latest = latestUserMessage(input.messages);
  const intent = routeWorkbenchIntent({
    message: latest?.content ?? "",
    hasAttachment: Boolean(input.latestAttachment),
    hasLatestV1Artifact: Boolean(input.latestHarnessArtifact?.artifactType === "requirement_report_v1"),
    clientAction: input.clientAction,
  });
  const context = buildWorkbenchContext({ user: input.user, attachment: input.latestAttachment, latestHarnessArtifact: input.latestHarnessArtifact });
  if (intent.intent === "capability_discovery") return buildCapabilityResponse(intent, context);
  if (intent.intent === "wes_data_query") return buildProjectListResponse(intent, context);
  if (intent.intent === "harness_report_generation" || intent.intent === "harness_answer_submission" || intent.intent === "write_action_request") return buildSuggestedActionResponse(intent, context);
  return answerWithModelAndContext(input, intent, context);
}
```

- [ ] **Step 3: Wire `homeWorkbenchChat`**

In `chat.service.ts`, replace the current unconditional parsed-attachment report generation path with dispatcher logic. Preserve:

- `ensureHomeAiSession`
- `appendAiSessionEvent`
- `{ code, message, data }` response envelope
- `businessRole`, `roleLabel`, `model`, `session`

Do not remove existing Harness report APIs.

- [ ] **Step 4: Verify**

Run:

```bash
npm run test:modules -w apps/api
npm run build -w apps/api
```

Expected: pass.

## Task 4: Frontend API And Send Path

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/api/ai.js`
- Modify: `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx`
- Test: `ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx`

- [ ] **Step 1: Add API helper**

```js
export async function sendHomeWorkbenchMessage(payload) {
  return unwrap(await apiClient.post('/ai/home-workbench/chat', payload, { suppressUnauthorizedRedirect: true }))
}
```

- [ ] **Step 2: Add explicit report intent helper**

In `AiHomeWorkbench.jsx`, add a local helper near other pure helpers:

```js
function isExplicitReportRequest(text) {
  return /生成|输出|创建|启动/.test(text || '') && /需求解析报告|需求包|评估输入|评估草稿|报告/.test(text || '')
}
```

- [ ] **Step 3: Split selected-file behavior**

Change `sendMessage()` so selected file does this:

- Parse file as today to get `parsed`.
- Always show local attachment summary.
- If `isExplicitReportRequest(text || '')` is true, run existing Harness v1 path.
- Otherwise call `/ai/home-workbench/chat` with parsed attachment context and render model answer + suggested actions.

- [ ] **Step 4: Remove implicit post-v1 v2 branch**

Delete or bypass this current branch:

```js
const harnessV1Context = !selectedFile && text ? findLatestHarnessV1Artifact(messages) : null;
if (harnessV1Context) {
  await submitHarnessAnswers(...);
  await generateHarnessReportV2(...);
}
```

Replace it with normal chat context. Keep `handleStructuredSupplement()` unchanged as the default v2 trigger.

- [ ] **Step 5: Render suggested actions**

For `generate_requirement_report`, render a button that asks user to trigger the existing Harness v1 path or pre-fills composer with “请基于当前附件生成需求解析报告”. Do not auto-run write actions.

## Task 5: Frontend Tests

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx`
- Modify: `ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js` if centralized mocks are used.

- [ ] **Step 1: Update the old v1 follow-up test**

Rename the existing test from “follows up a v1 Harness report with user answers to generate v2” to “answers ordinary follow-up after v1 without generating v2”.

Expected assertions:

```js
expect(answersCalled).toBe(false)
expect(reportV2Called).toBe(false)
expect(screen.getByText(/这个风险/)).toBeInTheDocument()
```

- [ ] **Step 2: Add upload + business question test**

User uploads file and types:

```text
客户提到多组织业务往来的问题，一般需要包含哪几个功能模块？
```

Assert:

- `/ai/parse-basic-info` called.
- `/ai/home-workbench/chat` called.
- `/harness/runs` or `/harness/runs/:id/report-v1` not called.
- Answer is displayed.
- Suggested action “生成需求解析报告” is displayed but not auto-executed.

- [ ] **Step 3: Keep structured card v2 test**

The existing “提交补充并生成 v2” test must continue to assert:

```js
expect(reportV2Called).toBe(true)
expect(answersBody.answers).toEqual(expect.arrayContaining([
  expect.objectContaining({ source: 'structured_card_inline' }),
]))
```

- [ ] **Step 4: Verify**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE
npm run build --prefix ui/V2_PROTOTYPE
```

Expected: all pass.

## Task 6: Contracts, Dashboard, And Manual Tests

**Files:**
- Modify: `docs/openapi.yaml` only if a new endpoint or public response schema is added.
- Modify: `03_技术设计/系统演进/实现与文档对齐说明.md`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/testing.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/monitoring.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/changes.html`

- [ ] **Step 1: Add manual tests MT-1G-001 to MT-1G-008**

Minimum manual tests:

1. Upload file + ask multi-organization module question: answer, no v1 auto-report.
2. Upload file + explicit “生成需求解析报告”: Harness v1 generated.
3. v1 report + “这个风险是什么意思”: explanation, no v2.
4. v1 card structured submit: v2 generated.
5. “你能做什么？”: capability answer.
6. “我之前创建过哪些项目？”: owner-scoped project list.
7. Write action request: returns confirmation action, no write before confirm.
8. Non-owner data query: no cross-user data.

- [ ] **Step 2: Update monitoring metrics**

Add:

- Intent hit rate
- Wrong-route count
- Post-v1 accidental-v2 count
- Attachment-QA to report-generation conversion
- WES data-query authorization failure count

- [ ] **Step 3: Verify docs**

Run:

```bash
python3 -m html.parser 03_技术设计/系统架构/WES-Agent-升级总看板/index.html
python3 -m html.parser 03_技术设计/系统架构/WES-Agent-升级总看板/plan.html
python3 -m html.parser 03_技术设计/系统架构/WES-Agent-升级总看板/testing.html
python3 -m html.parser 03_技术设计/系统架构/WES-Agent-升级总看板/monitoring.html
```

Expected: no parser output.

## Final Verification

Run the full Phase 1G gate:

```bash
npm run test:modules -w apps/api
npm run test:harness -w apps/api
npm run build -w apps/api
npm run test --prefix ui/V2_PROTOTYPE
npm run build --prefix ui/V2_PROTOTYPE
```

If AI service files are added to `test:ai`, also run:

```bash
npm run test:ai -w apps/api
```

## Commit Guidance

Commit in small slices only after tests pass:

```bash
git add apps/api/src/services/ai/workbench-intent.service.ts apps/api/src/services/ai/workbench-intent.service.test.ts apps/api/package.json
git commit -m "feat(ai-workbench): 增加 1G 意图路由"

git add apps/api/src/services/ai/workbench-context.service.ts apps/api/src/services/ai/workbench-dispatch.service.ts apps/api/src/services/ai/chat.service.ts
git commit -m "feat(ai-workbench): 接入任务运行时分发"

git add ui/V2_PROTOTYPE/src/api/ai.js ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx
git commit -m "feat(ai-workbench): 区分附件问答与报告生成"

git add docs/openapi.yaml 03_技术设计/系统演进/实现与文档对齐说明.md 03_技术设计/系统架构/WES-Agent-升级总看板
git commit -m "docs(phase-1g): 更新意图运行时验收与看板"
```

Do not stage unrelated dirty files such as local data snapshots, model outputs, or previous user edits.

