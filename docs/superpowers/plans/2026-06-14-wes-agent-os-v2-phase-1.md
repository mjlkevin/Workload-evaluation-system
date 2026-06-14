# WES Agent OS V2 Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working slice of WES Agent OS: persistent AI sessions, project evaluation containers, AI-driven create/link flows, and an admin standard-governance draft flow.

**Architecture:** Keep phase one compatible with the current JSON/version-backed prototype. Add focused API modules for AI sessions and project evaluation plans, then wire the homepage AI workbench to session history, artifacts, pending confirmation actions, and project links. Treat formal WES writes as confirmed actions and keep existing requirement/assessment pages as record-management surfaces.

**Tech Stack:** Express + TypeScript API in `apps/api`, JSON-backed repositories following existing module patterns, React 18 + Vite in `ui/V2_PROTOTYPE`, Vitest + Testing Library + MSW for frontend tests, Node test runner for API module tests.

---

## Source Spec

- Design: `docs/superpowers/specs/2026-06-14-wes-agent-os-v2-design.md`
- Prior homepage design: `docs/superpowers/specs/2026-06-12-role-driven-ai-home-workbench-design.md`

## Scope Boundaries

Phase 1 builds the smallest end-to-end Agent OS loop:

```text
AI session
-> messages and attachments are persisted
-> AI produces artifacts and pending actions
-> user confirms create/link action
-> project evaluation plan is created or linked
-> optional requirement/assessment draft records are created from artifacts
-> admin can upload a standard file and save a standard draft artifact
```

Phase 1 does not replace every WES page, implement autonomous multi-agent orchestration, auto-publish standards, auto-recalculate history, or remove existing demand/assessment modules.

## File Structure

Backend session module:

- Create `apps/api/src/modules/ai-sessions/ai-sessions.types.ts`
  - Owns AI session, message, artifact, pending action, link, and standard draft types.
- Create `apps/api/src/modules/ai-sessions/ai-sessions.repository.ts`
  - JSON-backed persistence for `ai-sessions.json`.
- Create `apps/api/src/modules/ai-sessions/ai-sessions.usecase.ts`
  - Session list/create/get/update, append message, create artifact, create/resolve pending actions.
- Create `apps/api/src/modules/ai-sessions/ai-sessions.controller.ts`
  - Express handlers.
- Create `apps/api/src/modules/ai-sessions/ai-sessions.module.ts`
  - Module exports.
- Create `apps/api/src/routes/ai-sessions.routes.ts`
  - REST routes under `/api/v1/ai-sessions`.
- Modify `apps/api/src/routes/index.ts`
  - Register `router.use("/ai-sessions", aiSessionsRoutes)`.
- Modify `apps/api/src/modules/modules.handlers.test.ts`
  - API coverage for create/list/append/confirm.

Backend project evaluation module:

- Create `apps/api/src/modules/project-evaluations/project-evaluations.types.ts`
  - Owns project evaluation plan types.
- Create `apps/api/src/modules/project-evaluations/project-evaluations.repository.ts`
  - Reads/writes project plans backed by existing `versions` global records.
- Create `apps/api/src/modules/project-evaluations/project-evaluations.usecase.ts`
  - Create/list/get/link-session operations.
- Create `apps/api/src/modules/project-evaluations/project-evaluations.controller.ts`
  - Express handlers.
- Create `apps/api/src/modules/project-evaluations/project-evaluations.module.ts`
  - Module exports.
- Create `apps/api/src/routes/project-evaluations.routes.ts`
  - REST routes under `/api/v1/project-evaluations`.
- Modify `apps/api/src/routes/index.ts`
  - Register `router.use("/project-evaluations", projectEvaluationsRoutes)`.
- Modify `apps/api/src/modules/modules.handlers.test.ts`
  - API coverage for list/create/link session.

Backend AI chat integration:

- Modify `apps/api/src/services/ai/chat.service.ts`
  - Allow `/ai/home-workbench/chat` to accept `sessionId`, persist user/assistant messages, and return updated session state.
- Modify `apps/api/src/routes/ai.routes.ts`
  - Keep route path stable.
- Modify `apps/api/src/modules/modules.handlers.test.ts`
  - Regression coverage that home chat persists messages into a session.

Frontend session data:

- Create `ui/V2_PROTOTYPE/src/hooks/useAiSessions.js`
  - Loads session list, creates session, appends messages through chat, resolves actions.
- Create `ui/V2_PROTOTYPE/src/components/AiWorkbench/SessionRail.jsx`
  - Left rail for new session, recent sessions, filters, archive state.
- Create `ui/V2_PROTOTYPE/src/components/AiWorkbench/ArtifactPanel.jsx`
  - Right panel for artifacts, pending actions, linked records.
- Create `ui/V2_PROTOTYPE/src/components/AiWorkbench/PendingActionCard.jsx`
  - Confirmation card for high-risk actions.
- Modify `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx`
  - Replace local-only `messages` with persisted session-backed state.
- Modify `ui/V2_PROTOTYPE/src/pages/HomeWorkspace.jsx`
  - Keep single AI workbench entry as default.
- Modify `ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx`
  - Session persistence, session switching, pending action confirmation.
- Modify `ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js`
  - Add `ai-sessions` and `project-evaluations` handlers.
- Modify `ui/V2_PROTOTYPE/src/__tests__/mocks/data.js`
  - Add mock sessions, artifacts, actions, project plans.

Frontend project evaluation:

- Modify `ui/V2_PROTOTYPE/src/hooks/useHomeDashboard.js`
  - Read `/project-evaluations` instead of treating `global` versions directly as “方案”.
- Modify `ui/V2_PROTOTYPE/src/pages/TraditionalHomeDashboard.jsx`
  - Rename UI to “项目评估工作台 / 项目评估方案列表”.
- Modify `ui/V2_PROTOTYPE/src/components/Layout/Shell.jsx`
  - Rename or add navigation label “项目评估”.
- Modify `ui/V2_PROTOTYPE/src/components/Layout/PageShell.jsx`
  - Breadcrumb mapping for 项目评估.
- Modify `ui/V2_PROTOTYPE/src/__tests__/useHomeDashboard.test.js`
  - Project-plan mapping coverage.
- Modify `ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx`
  - Confirm AI-created project appears in linked records.

Standard governance slice:

- Add endpoint handlers in `apps/api/src/modules/ai-sessions/ai-sessions.controller.ts`
  - `POST /ai-sessions/:id/standard-drafts` stores an uploaded file summary artifact and pending publish action.
- Modify `ui/V2_PROTOTYPE/src/pages/aiHomePresets.js`
  - Admin preset includes standard governance workflows.
- Modify `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx`
  - Admin workflow can upload a standard file and show standard-draft artifact.
- Modify `ui/V2_PROTOTYPE/src/__tests__/aiHomePresets.test.js`
  - Admin standard governance preset coverage.
- Modify `ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx`
  - Standard file upload creates draft artifact.

Verification:

- Run `npm run test:modules -w apps/api`.
- Run `npm run test --prefix ui/V2_PROTOTYPE`.
- Run `npm run build --prefix ui/V2_PROTOTYPE`.
- Browser-check `http://localhost:3002/` AI workbench, project evaluation page, and admin standard-governance flow.

---

### Task 1: Backend AI Session Store

**Files:**
- Create: `apps/api/src/modules/ai-sessions/ai-sessions.types.ts`
- Create: `apps/api/src/modules/ai-sessions/ai-sessions.repository.ts`
- Create: `apps/api/src/modules/ai-sessions/ai-sessions.usecase.ts`
- Create: `apps/api/src/modules/ai-sessions/ai-sessions.controller.ts`
- Create: `apps/api/src/modules/ai-sessions/ai-sessions.module.ts`
- Create: `apps/api/src/routes/ai-sessions.routes.ts`
- Modify: `apps/api/src/routes/index.ts`
- Modify: `apps/api/src/modules/modules.handlers.test.ts`

- [ ] **Step 1: Write failing API tests**

Add tests to `apps/api/src/modules/modules.handlers.test.ts` near the existing auth/AI route tests:

```ts
test("ai-sessions: creates and lists a persistent session", () => {
  const token = getActiveUserToken();
  const createReq = createMockReq({
    token,
    body: {
      title: "XX制造 WMS 粗评",
      domain: "business_evaluation",
      workflowKey: "rough_estimate",
      status: "rough_estimate",
    },
  });
  const createRes = createMockRes();
  AiSessionsModule.createSession(createReq, createRes as unknown as Response);

  assert.equal(createRes.statusCode, 200);
  const created = createRes.body as { code: number; data: { session: { sessionId: string; title: string; status: string } } };
  assert.equal(created.code, 0);
  assert.equal(created.data.session.title, "XX制造 WMS 粗评");
  assert.equal(created.data.session.status, "rough_estimate");

  const listReq = createMockReq({ token, query: { domain: "business_evaluation" } });
  const listRes = createMockRes();
  AiSessionsModule.listSessions(listReq, listRes as unknown as Response);

  assert.equal(listRes.statusCode, 200);
  const listed = listRes.body as { code: number; data: { items: Array<{ sessionId: string }> } };
  assert.ok(listed.data.items.some((item) => item.sessionId === created.data.session.sessionId));
});

test("ai-sessions: appends messages and creates pending action", () => {
  const token = getActiveUserToken();
  const createReq = createMockReq({
    token,
    body: { title: "创建项目确认", domain: "business_evaluation", workflowKey: "project_discovery" },
  });
  const createRes = createMockRes();
  AiSessionsModule.createSession(createReq, createRes as unknown as Response);
  const sessionId = (createRes.body as { data: { session: { sessionId: string } } }).data.session.sessionId;

  const appendReq = createMockReq({
    token,
    params: { sessionId },
    body: {
      message: { role: "user", content: "请把它转成正式项目评估" },
      artifact: { type: "rough_report", title: "粗评报告", content: "预计 120 人天" },
      pendingAction: {
        actionType: "create_project_evaluation",
        title: "创建项目评估方案",
        riskLevel: "high",
        payload: { projectName: "XX制造 WMS 项目", customerName: "XX制造" },
      },
    },
  });
  const appendRes = createMockRes();
  AiSessionsModule.appendSessionEvent(appendReq, appendRes as unknown as Response);

  assert.equal(appendRes.statusCode, 200);
  const body = appendRes.body as { code: number; data: { session: { messages: unknown[]; artifacts: unknown[]; pendingActions: Array<{ status: string }> } } };
  assert.equal(body.code, 0);
  assert.equal(body.data.session.messages.length, 1);
  assert.equal(body.data.session.artifacts.length, 1);
  assert.equal(body.data.session.pendingActions[0].status, "pending");
});
```

Add this import at the top:

```ts
import * as AiSessionsModule from "./ai-sessions/ai-sessions.module";
```

- [ ] **Step 2: Run backend tests and verify failure**

Run:

```bash
npm run test:modules -w apps/api
```

Expected: FAIL because `./ai-sessions/ai-sessions.module` does not exist.

- [ ] **Step 3: Add session types**

Create `apps/api/src/modules/ai-sessions/ai-sessions.types.ts`:

```ts
export type AiSessionDomain = "business_evaluation" | "standard_governance";
export type AiSessionStatus =
  | "temporary_chat"
  | "rough_estimate"
  | "project_discovery"
  | "requirement_drafting"
  | "assessment_drafting"
  | "standard_review"
  | "standard_drafting"
  | "linked_record"
  | "archived";

export type AiMessageRole = "user" | "assistant" | "system" | "tool";
export type AiArtifactStatus = "generated" | "accepted" | "linked" | "superseded" | "discarded";
export type AiPendingActionStatus = "pending" | "confirmed" | "cancelled" | "executed" | "failed";
export type AiRiskLevel = "low" | "high";

export type AiMessage = {
  messageId: string;
  role: AiMessageRole;
  content: string;
  createdAt: string;
  attachmentIds?: string[];
  artifactIds?: string[];
};

export type AiAttachment = {
  attachmentId: string;
  name: string;
  size?: number;
  type?: string;
  createdAt: string;
};

export type AiArtifact = {
  artifactId: string;
  type: string;
  title: string;
  content: unknown;
  status: AiArtifactStatus;
  createdAt: string;
  sourceMessageId?: string;
};

export type AiPendingAction = {
  actionId: string;
  actionType: string;
  title: string;
  riskLevel: AiRiskLevel;
  status: AiPendingActionStatus;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  createdAt: string;
  resolvedAt?: string;
};

export type AiSessionLinks = {
  projectId?: string;
  requirementVersionId?: string;
  assessmentVersionId?: string;
  devAssessmentId?: string;
  resourceCostId?: string;
  wbsId?: string;
  reviewId?: string;
  standardVersionId?: string;
  templateVersionId?: string;
  ruleSetVersionId?: string;
};

export type AiSessionRecord = {
  sessionId: string;
  ownerUserId: string;
  ownerUsername: string;
  title: string;
  domain: AiSessionDomain;
  workflowKey: string;
  businessRole: string;
  status: AiSessionStatus;
  summary: string;
  messages: AiMessage[];
  attachments: AiAttachment[];
  artifacts: AiArtifact[];
  pendingActions: AiPendingAction[];
  linkedRecords: AiSessionLinks;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
};

export type AiSessionsStore = {
  sessions: AiSessionRecord[];
};
```

- [ ] **Step 4: Add JSON repository**

Create `apps/api/src/modules/ai-sessions/ai-sessions.repository.ts`:

```ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { AiSessionsStore } from "./ai-sessions.types";

const STORE_PATH = resolve(process.cwd(), "data", "ai-sessions.json");

function emptyStore(): AiSessionsStore {
  return { sessions: [] };
}

export function loadAiSessionsStore(): AiSessionsStore {
  try {
    const raw = readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<AiSessionsStore>;
    return { sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [] };
  } catch {
    return emptyStore();
  }
}

export function saveAiSessionsStore(store: AiSessionsStore): void {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}
```

- [ ] **Step 5: Add usecase helpers**

Create `apps/api/src/modules/ai-sessions/ai-sessions.usecase.ts`:

```ts
import { randomUUID } from "node:crypto";

import type { AuthUser } from "../../types";
import { resolveBusinessRole } from "../../middleware/auth";
import { asString } from "../../utils";
import { loadAiSessionsStore, saveAiSessionsStore } from "./ai-sessions.repository";
import type {
  AiArtifact,
  AiMessage,
  AiPendingAction,
  AiSessionDomain,
  AiSessionRecord,
  AiSessionStatus,
} from "./ai-sessions.types";

const VALID_DOMAINS: AiSessionDomain[] = ["business_evaluation", "standard_governance"];
const VALID_STATUSES: AiSessionStatus[] = [
  "temporary_chat",
  "rough_estimate",
  "project_discovery",
  "requirement_drafting",
  "assessment_drafting",
  "standard_review",
  "standard_drafting",
  "linked_record",
  "archived",
];

function normalizeDomain(value: unknown): AiSessionDomain {
  const domain = asString(value) as AiSessionDomain;
  return VALID_DOMAINS.includes(domain) ? domain : "business_evaluation";
}

function normalizeStatus(value: unknown): AiSessionStatus {
  const status = asString(value) as AiSessionStatus;
  return VALID_STATUSES.includes(status) ? status : "temporary_chat";
}

export function createAiSession(user: AuthUser, input: { title?: unknown; domain?: unknown; workflowKey?: unknown; status?: unknown }): AiSessionRecord {
  const nowIso = new Date().toISOString();
  const session: AiSessionRecord = {
    sessionId: randomUUID(),
    ownerUserId: user.id,
    ownerUsername: user.username,
    title: asString(input.title) || "新 AI 会话",
    domain: normalizeDomain(input.domain),
    workflowKey: asString(input.workflowKey) || "free_chat",
    businessRole: resolveBusinessRole(user),
    status: normalizeStatus(input.status),
    summary: "",
    messages: [],
    attachments: [],
    artifacts: [],
    pendingActions: [],
    linkedRecords: {},
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const store = loadAiSessionsStore();
  store.sessions.unshift(session);
  saveAiSessionsStore(store);
  return session;
}

export function listAiSessions(user: AuthUser, filters: { domain?: unknown; status?: unknown } = {}): AiSessionRecord[] {
  const domain = asString(filters.domain);
  const status = asString(filters.status);
  return loadAiSessionsStore().sessions
    .filter((session) => session.ownerUserId === user.id)
    .filter((session) => !domain || session.domain === domain)
    .filter((session) => !status || session.status === status)
    .sort((a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt)));
}

export function getAiSession(user: AuthUser, sessionId: string): AiSessionRecord | null {
  return loadAiSessionsStore().sessions.find((session) => session.ownerUserId === user.id && session.sessionId === sessionId) || null;
}

export function appendAiSessionEvent(
  user: AuthUser,
  sessionId: string,
  input: { message?: Partial<AiMessage>; artifact?: Partial<AiArtifact>; pendingAction?: Partial<AiPendingAction> }
): AiSessionRecord | null {
  const store = loadAiSessionsStore();
  const session = store.sessions.find((item) => item.ownerUserId === user.id && item.sessionId === sessionId);
  if (!session) return null;

  const nowIso = new Date().toISOString();
  if (input.message?.content) {
    session.messages.push({
      messageId: input.message.messageId || randomUUID(),
      role: input.message.role || "user",
      content: asString(input.message.content),
      createdAt: input.message.createdAt || nowIso,
      attachmentIds: input.message.attachmentIds || [],
      artifactIds: input.message.artifactIds || [],
    });
  }
  if (input.artifact?.title) {
    session.artifacts.push({
      artifactId: input.artifact.artifactId || randomUUID(),
      type: asString(input.artifact.type) || "note",
      title: asString(input.artifact.title),
      content: input.artifact.content ?? "",
      status: input.artifact.status || "generated",
      createdAt: input.artifact.createdAt || nowIso,
      sourceMessageId: input.artifact.sourceMessageId,
    });
  }
  if (input.pendingAction?.title) {
    session.pendingActions.push({
      actionId: input.pendingAction.actionId || randomUUID(),
      actionType: asString(input.pendingAction.actionType) || "unknown",
      title: asString(input.pendingAction.title),
      riskLevel: input.pendingAction.riskLevel || "high",
      status: "pending",
      payload: input.pendingAction.payload || {},
      createdAt: input.pendingAction.createdAt || nowIso,
    });
  }
  session.updatedAt = nowIso;
  saveAiSessionsStore(store);
  return session;
}
```

- [ ] **Step 6: Add controllers and routes**

Create `apps/api/src/modules/ai-sessions/ai-sessions.controller.ts`:

```ts
import { Request, Response } from "express";
import { randomUUID } from "node:crypto";

import { requireAuth } from "../../middleware/auth";
import { ok, fail } from "../../utils/response";
import { asString } from "../../utils";
import { appendAiSessionEvent, createAiSession, getAiSession, listAiSessions } from "./ai-sessions.usecase";

export function createSession(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  return res.json(ok({ session: createAiSession(auth.user, req.body || {}) }, randomUUID()));
}

export function listSessions(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  return res.json(ok({ items: listAiSessions(auth.user, req.query || {}) }, randomUUID()));
}

export function getSession(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const session = getAiSession(auth.user, asString(req.params.sessionId));
  if (!session) return fail(res, 40404, "会话不存在", [{ field: "sessionId", reason: "not_found" }]);
  return res.json(ok({ session }, randomUUID()));
}

export function appendSessionEvent(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const session = appendAiSessionEvent(auth.user, asString(req.params.sessionId), req.body || {});
  if (!session) return fail(res, 40404, "会话不存在", [{ field: "sessionId", reason: "not_found" }]);
  return res.json(ok({ session }, randomUUID()));
}
```

Create `apps/api/src/modules/ai-sessions/ai-sessions.module.ts`:

```ts
export { createSession, listSessions, getSession, appendSessionEvent } from "./ai-sessions.controller";
export { createAiSession, listAiSessions, getAiSession, appendAiSessionEvent } from "./ai-sessions.usecase";
```

Create `apps/api/src/routes/ai-sessions.routes.ts`:

```ts
import { Router } from "express";

import * as AiSessionsModule from "../modules/ai-sessions/ai-sessions.module";
import { requireCapability } from "../rbac/middleware";

const router = Router();

router.get("/", requireCapability("estimates:read"), AiSessionsModule.listSessions);
router.post("/", requireCapability("estimates:read"), AiSessionsModule.createSession);
router.get("/:sessionId", requireCapability("estimates:read"), AiSessionsModule.getSession);
router.post("/:sessionId/events", requireCapability("estimates:read"), AiSessionsModule.appendSessionEvent);

export default router;
```

Modify `apps/api/src/routes/index.ts`:

```ts
import aiSessionsRoutes from "./ai-sessions.routes";
```

Register it before the not-found handler:

```ts
router.use("/ai-sessions", aiSessionsRoutes);
```

- [ ] **Step 7: Run backend tests**

Run:

```bash
npm run test:modules -w apps/api
```

Expected: PASS for the new AI session tests and existing module tests.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/ai-sessions apps/api/src/routes/ai-sessions.routes.ts apps/api/src/routes/index.ts apps/api/src/modules/modules.handlers.test.ts
git commit -m "feat: add persistent ai sessions"
```

### Task 2: Backend Project Evaluation Container

**Files:**
- Create: `apps/api/src/modules/project-evaluations/project-evaluations.types.ts`
- Create: `apps/api/src/modules/project-evaluations/project-evaluations.repository.ts`
- Create: `apps/api/src/modules/project-evaluations/project-evaluations.usecase.ts`
- Create: `apps/api/src/modules/project-evaluations/project-evaluations.controller.ts`
- Create: `apps/api/src/modules/project-evaluations/project-evaluations.module.ts`
- Create: `apps/api/src/routes/project-evaluations.routes.ts`
- Modify: `apps/api/src/routes/index.ts`
- Modify: `apps/api/src/modules/modules.handlers.test.ts`

- [ ] **Step 1: Write failing project API tests**

Add import to `apps/api/src/modules/modules.handlers.test.ts`:

```ts
import * as ProjectEvaluationsModule from "./project-evaluations/project-evaluations.module";
```

Add tests:

```ts
test("project-evaluations: creates project plan from ai session", () => {
  const token = getActiveUserToken();
  const req = createMockReq({
    token,
    body: {
      projectName: "XX制造 WMS 项目",
      customerName: "XX制造",
      industry: "制造业",
      createdFromSessionId: "session-001",
    },
  });
  const res = createMockRes();
  ProjectEvaluationsModule.createProjectEvaluation(req, res as unknown as Response);

  assert.equal(res.statusCode, 200);
  const body = res.body as { code: number; data: { project: { projectName: string; customerName: string; createdFromSessionId: string } } };
  assert.equal(body.code, 0);
  assert.equal(body.data.project.projectName, "XX制造 WMS 项目");
  assert.equal(body.data.project.customerName, "XX制造");
  assert.equal(body.data.project.createdFromSessionId, "session-001");
});

test("project-evaluations: lists project plans", () => {
  const token = getActiveUserToken();
  const req = createMockReq({ token, query: { q: "XX制造" } });
  const res = createMockRes();
  ProjectEvaluationsModule.listProjectEvaluations(req, res as unknown as Response);

  assert.equal(res.statusCode, 200);
  const body = res.body as { code: number; data: { items: Array<{ projectName: string }> } };
  assert.equal(body.code, 0);
  assert.ok(Array.isArray(body.data.items));
});
```

- [ ] **Step 2: Run backend tests and verify failure**

Run:

```bash
npm run test:modules -w apps/api
```

Expected: FAIL because `project-evaluations` module does not exist.

- [ ] **Step 3: Add project evaluation types**

Create `apps/api/src/modules/project-evaluations/project-evaluations.types.ts`:

```ts
export type ProjectEvaluationStatus = "draft" | "active" | "reviewing" | "published" | "archived";

export type ProjectEvaluationPlan = {
  projectId: string;
  projectName: string;
  customerName: string;
  industry: string;
  currentStage: string;
  status: ProjectEvaluationStatus;
  ownerUserId: string;
  ownerUsername: string;
  participantUserIds: string[];
  currentRequirementVersionId?: string;
  currentAssessmentVersionId?: string;
  currentDevAssessmentId?: string;
  currentResourceCostId?: string;
  currentWbsId?: string;
  defaultStandardVersionId?: string;
  createdFromSessionId?: string;
  sourceGlobalVersionRecordId?: string;
  createdAt: string;
  updatedAt: string;
};
```

- [ ] **Step 4: Add repository backed by global versions**

Create `apps/api/src/modules/project-evaluations/project-evaluations.repository.ts`:

```ts
import type { VersionRecord } from "../../types";
import { loadVersionsStore, saveVersionsStore } from "../versions/versions.repository";
import type { ProjectEvaluationPlan } from "./project-evaluations.types";

function asPayload(record: VersionRecord): Record<string, unknown> {
  return record.payload && typeof record.payload === "object" ? record.payload : {};
}

export function mapGlobalVersionToProject(record: VersionRecord): ProjectEvaluationPlan {
  const payload = asPayload(record);
  return {
    projectId: record.id,
    projectName: String(payload.projectName || record.baseCode || record.versionCode || "未命名项目评估"),
    customerName: String(payload.customerName || ""),
    industry: String(payload.industry || ""),
    currentStage: String(payload.currentStage || "project_discovery"),
    status: (payload.projectStatus as ProjectEvaluationPlan["status"]) || "draft",
    ownerUserId: record.ownerUserId,
    ownerUsername: record.createdByUsername || "",
    participantUserIds: Array.isArray(payload.participantUserIds) ? payload.participantUserIds.map(String) : [],
    currentRequirementVersionId: String(payload.currentRequirementVersionId || "") || undefined,
    currentAssessmentVersionId: String(payload.currentAssessmentVersionId || "") || undefined,
    currentDevAssessmentId: String(payload.currentDevAssessmentId || "") || undefined,
    currentResourceCostId: String(payload.currentResourceCostId || "") || undefined,
    currentWbsId: String(payload.currentWbsId || "") || undefined,
    defaultStandardVersionId: String(payload.defaultStandardVersionId || "") || undefined,
    createdFromSessionId: String(payload.createdFromSessionId || "") || undefined,
    sourceGlobalVersionRecordId: record.id,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function listProjectRecords(ownerUserId: string): VersionRecord[] {
  return loadVersionsStore().records
    .filter((record) => record.ownerUserId === ownerUserId)
    .filter((record) => record.type === "global");
}

export function saveProjectRecord(record: VersionRecord): void {
  const store = loadVersionsStore();
  const index = store.records.findIndex((item) => item.id === record.id);
  if (index >= 0) store.records[index] = record;
  else store.records.unshift(record);
  saveVersionsStore(store);
}
```

- [ ] **Step 5: Add usecase**

Create `apps/api/src/modules/project-evaluations/project-evaluations.usecase.ts`:

```ts
import { randomUUID } from "node:crypto";

import type { AuthUser, VersionRecord } from "../../types";
import { asString } from "../../utils";
import { listProjectRecords, mapGlobalVersionToProject, saveProjectRecord } from "./project-evaluations.repository";
import type { ProjectEvaluationPlan } from "./project-evaluations.types";

export function listProjectEvaluationsForUser(user: AuthUser, query: { q?: unknown } = {}): ProjectEvaluationPlan[] {
  const q = asString(query.q).toLowerCase();
  return listProjectRecords(user.id)
    .map(mapGlobalVersionToProject)
    .filter((item) => !q || [item.projectName, item.customerName, item.industry].some((value) => value.toLowerCase().includes(q)))
    .sort((a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt)));
}

export function createProjectEvaluationForUser(user: AuthUser, input: Record<string, unknown>): ProjectEvaluationPlan {
  const nowIso = new Date().toISOString();
  const projectName = asString(input.projectName) || "新项目评估方案";
  const versionCode = `GL-${Date.now().toString().slice(-6)}`;
  const record: VersionRecord = {
    id: randomUUID(),
    type: "global",
    versionCode,
    templateId: "default",
    ownerUserId: user.id,
    status: "draft",
    payload: {
      projectName,
      customerName: asString(input.customerName),
      industry: asString(input.industry),
      currentStage: asString(input.currentStage) || "project_discovery",
      projectStatus: "draft",
      createdFromSessionId: asString(input.createdFromSessionId),
      totalDays: Number(input.totalDays || 0),
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
    baseCode: versionCode,
    isHistoricalArchive: false,
    lastCheckinPayload: {},
  };
  saveProjectRecord(record);
  return mapGlobalVersionToProject(record);
}
```

- [ ] **Step 6: Add controller and route**

Create `apps/api/src/modules/project-evaluations/project-evaluations.controller.ts`:

```ts
import { Request, Response } from "express";
import { randomUUID } from "node:crypto";

import { requireAuth } from "../../middleware/auth";
import { ok } from "../../utils/response";
import { createProjectEvaluationForUser, listProjectEvaluationsForUser } from "./project-evaluations.usecase";

export function listProjectEvaluations(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  return res.json(ok({ items: listProjectEvaluationsForUser(auth.user, req.query || {}) }, randomUUID()));
}

export function createProjectEvaluation(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  return res.json(ok({ project: createProjectEvaluationForUser(auth.user, req.body || {}) }, randomUUID()));
}
```

Create `apps/api/src/modules/project-evaluations/project-evaluations.module.ts`:

```ts
export { listProjectEvaluations, createProjectEvaluation } from "./project-evaluations.controller";
export { listProjectEvaluationsForUser, createProjectEvaluationForUser } from "./project-evaluations.usecase";
```

Create `apps/api/src/routes/project-evaluations.routes.ts`:

```ts
import { Router } from "express";

import * as ProjectEvaluationsModule from "../modules/project-evaluations/project-evaluations.module";
import { requireCapability } from "../rbac/middleware";

const router = Router();

router.get("/", requireCapability("estimates:read"), ProjectEvaluationsModule.listProjectEvaluations);
router.post("/", requireCapability("estimates:write"), ProjectEvaluationsModule.createProjectEvaluation);

export default router;
```

Modify `apps/api/src/routes/index.ts`:

```ts
import projectEvaluationsRoutes from "./project-evaluations.routes";
router.use("/project-evaluations", projectEvaluationsRoutes);
```

- [ ] **Step 7: Run backend tests**

Run:

```bash
npm run test:modules -w apps/api
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/project-evaluations apps/api/src/routes/project-evaluations.routes.ts apps/api/src/routes/index.ts apps/api/src/modules/modules.handlers.test.ts
git commit -m "feat: add project evaluation container"
```

### Task 3: Persist Home AI Chat Into Sessions

**Files:**
- Modify: `apps/api/src/services/ai/chat.service.ts`
- Modify: `apps/api/src/modules/modules.handlers.test.ts`
- Modify: `ui/V2_PROTOTYPE/src/hooks/useAiSessions.js`
- Modify: `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx`
- Modify: `ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx`
- Modify: `ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js`
- Modify: `ui/V2_PROTOTYPE/src/__tests__/mocks/data.js`

- [ ] **Step 1: Write failing frontend session persistence test**

Add to `ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx`:

```jsx
test('persists AI home messages in the active session', async () => {
  let savedPayload
  server.use(
    http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({
      success: true,
      data: { items: [] },
    })),
    http.post(`${BASE}/ai-sessions`, async ({ request }) => {
      savedPayload = await request.json()
      return HttpResponse.json({
        success: true,
        data: {
          session: {
            sessionId: 'session-new',
            title: savedPayload.title || '新 AI 会话',
            domain: 'business_evaluation',
            workflowKey: 'free_chat',
            status: 'temporary_chat',
            messages: [],
            artifacts: [],
            pendingActions: [],
            linkedRecords: {},
            updatedAt: '2026-06-14T00:00:00.000Z',
          },
        },
      })
    }),
    http.post(`${BASE}/ai/home-workbench/chat`, async ({ request }) => {
      const body = await request.json()
      return HttpResponse.json({
        success: true,
        data: {
          answer: '模型回复：已保存',
          session: {
            sessionId: body.sessionId,
            title: '请粗评这个项目',
            status: 'rough_estimate',
            messages: [
              { messageId: 'm1', role: 'user', content: '请粗评这个项目', createdAt: '2026-06-14T00:00:00.000Z' },
              { messageId: 'm2', role: 'assistant', content: '模型回复：已保存', createdAt: '2026-06-14T00:00:01.000Z' },
            ],
            artifacts: [],
            pendingActions: [],
            linkedRecords: {},
          },
        },
      })
    })
  )

  render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)

  const input = await screen.findByRole('textbox')
  fireEvent.change(input, { target: { value: '请粗评这个项目' } })
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

  expect(await screen.findByText('模型回复：已保存')).toBeInTheDocument()
  expect(screen.getByText('请粗评这个项目')).toBeInTheDocument()
})
```

- [ ] **Step 2: Add session mock data and handlers**

Add to `ui/V2_PROTOTYPE/src/__tests__/mocks/data.js`:

```js
export const mockAiSessions = [
  {
    sessionId: 'session-rough-1',
    title: 'XX制造 WMS 粗评',
    domain: 'business_evaluation',
    workflowKey: 'rough_estimate',
    status: 'rough_estimate',
    summary: '销售粗评，预计 120 人天',
    messages: [
      { messageId: 'msg-1', role: 'user', content: '帮我粗评 XX制造 WMS 项目', createdAt: '2026-06-14T08:00:00.000Z' },
      { messageId: 'msg-2', role: 'assistant', content: '初步建议按 120 人天估算。', createdAt: '2026-06-14T08:01:00.000Z' },
    ],
    artifacts: [],
    pendingActions: [],
    linkedRecords: {},
    updatedAt: '2026-06-14T08:01:00.000Z',
  },
]
```

Modify `ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js` imports and handlers:

```js
import { mockAiSessions } from './data.js'
```

Add handlers before the AI chat handler:

```js
http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({ success: true, data: { items: mockAiSessions } })),
http.post(`${BASE}/ai-sessions`, async ({ request }) => {
  const body = await request.json()
  return HttpResponse.json({
    success: true,
    data: {
      session: {
        sessionId: 'session-created',
        title: body.title || '新 AI 会话',
        domain: body.domain || 'business_evaluation',
        workflowKey: body.workflowKey || 'free_chat',
        status: body.status || 'temporary_chat',
        messages: [],
        artifacts: [],
        pendingActions: [],
        linkedRecords: {},
        updatedAt: '2026-06-14T08:00:00.000Z',
      },
    },
  })
}),
```

- [ ] **Step 3: Add frontend session hook**

Create `ui/V2_PROTOTYPE/src/hooks/useAiSessions.js`:

```js
import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '../api/client.js'

function unwrapData(payload) {
  return payload?.data || payload || {}
}

export default function useAiSessions() {
  const [sessions, setSessions] = useState([])
  const [activeSession, setActiveSession] = useState(null)
  const [loadingSessions, setLoadingSessions] = useState(false)

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true)
    try {
      const payload = await apiClient.get('/ai-sessions')
      const data = unwrapData(payload)
      const items = Array.isArray(data.items) ? data.items : []
      setSessions(items)
      setActiveSession((prev) => prev || items[0] || null)
      return items
    } finally {
      setLoadingSessions(false)
    }
  }, [])

  const createSession = useCallback(async (input = {}) => {
    const payload = await apiClient.post('/ai-sessions', {
      title: input.title || '新 AI 会话',
      domain: input.domain || 'business_evaluation',
      workflowKey: input.workflowKey || 'free_chat',
      status: input.status || 'temporary_chat',
    })
    const session = unwrapData(payload).session
    if (session) {
      setSessions((prev) => [session, ...prev.filter((item) => item.sessionId !== session.sessionId)])
      setActiveSession(session)
    }
    return session
  }, [])

  const upsertSession = useCallback((session) => {
    if (!session) return
    setActiveSession(session)
    setSessions((prev) => [session, ...prev.filter((item) => item.sessionId !== session.sessionId)])
  }, [])

  useEffect(() => { loadSessions().catch(() => {}) }, [loadSessions])

  return {
    activeSession,
    createSession,
    loadingSessions,
    loadSessions,
    sessions,
    setActiveSession,
    upsertSession,
  }
}
```

- [ ] **Step 4: Wire hook into AiHomeWorkbench**

Modify `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx`:

Add import:

```js
import useAiSessions from '../hooks/useAiSessions.js'
```

Inside component:

```js
const {
  activeSession,
  createSession,
  sessions,
  setActiveSession,
  upsertSession,
} = useAiSessions()
```

Replace local message initialization:

```js
const [messages, setMessages] = useState([])
```

with:

```js
const [messages, setMessages] = useState([])

useEffect(() => {
  if (!activeSession) {
    setMessages([])
    return
  }
  setMessages((activeSession.messages || []).map((message) => ({
    id: message.messageId,
    role: message.role === 'assistant' ? 'assistant' : 'user',
    text: message.content,
  })))
}, [activeSession])
```

In `sendMessage`, before building the API payload:

```js
const session = activeSession || await createSession({
  title: text || fileSnapshot?.name || '新 AI 会话',
  domain: 'business_evaluation',
  workflowKey: activeWorkflowKey || 'free_chat',
  status: activeWorkflowKey ? 'project_discovery' : 'temporary_chat',
})
```

Include `sessionId` in `/ai/home-workbench/chat`:

```js
const payload = await apiClient.post('/ai/home-workbench/chat', {
  sessionId: session?.sessionId,
  workflowKey: activeWorkflowKey,
  messages: outboundMessages,
}, { suppressUnauthorizedRedirect: true })
```

After unwrap:

```js
if (data.session) upsertSession(data.session)
```

- [ ] **Step 5: Update backend home chat to persist messages**

Modify `apps/api/src/services/ai/chat.service.ts`:

Add import:

```ts
import { appendAiSessionEvent, createAiSession, getAiSession } from "../../modules/ai-sessions/ai-sessions.usecase";
```

In `homeWorkbenchChat`, read `sessionId`:

```ts
const body = (req.body || {}) as { messages?: unknown; workflowKey?: unknown; sessionId?: unknown };
let session = asString(body.sessionId) ? getAiSession(user, asString(body.sessionId)) : null;
if (!session) {
  session = createAiSession(user, {
    title: messages[messages.length - 1]?.content?.slice(0, 40) || "新 AI 会话",
    domain: "business_evaluation",
    workflowKey: asString(body.workflowKey) || "free_chat",
    status: "temporary_chat",
  });
}
```

Before returning success, append latest user and assistant messages:

```ts
const latestUser = messages[messages.length - 1];
if (latestUser) {
  appendAiSessionEvent(user, session.sessionId, {
    message: { role: "user", content: latestUser.content },
  });
}
const updatedSession = appendAiSessionEvent(user, session.sessionId, {
  message: { role: "assistant", content: result.answer },
});
```

Return session:

```ts
return res.json(ok({
  answer: result.answer,
  businessRole: result.businessRole,
  roleLabel: result.roleLabel,
  model: normalizeKimiModelName(config.kimi.model),
  session: updatedSession || session,
}, requestId));
```

- [ ] **Step 6: Run focused frontend tests**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- HomeWorkspace
```

Expected: PASS.

- [ ] **Step 7: Run backend module tests**

Run:

```bash
npm run test:modules -w apps/api
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/ai/chat.service.ts ui/V2_PROTOTYPE/src/hooks/useAiSessions.js ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx ui/V2_PROTOTYPE/src/__tests__/mocks/data.js ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js
git commit -m "feat: persist ai home sessions"
```

### Task 4: Project Evaluation UI And Confirmed Create Action

**Files:**
- Create: `ui/V2_PROTOTYPE/src/components/AiWorkbench/SessionRail.jsx`
- Create: `ui/V2_PROTOTYPE/src/components/AiWorkbench/ArtifactPanel.jsx`
- Create: `ui/V2_PROTOTYPE/src/components/AiWorkbench/PendingActionCard.jsx`
- Modify: `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx`
- Modify: `ui/V2_PROTOTYPE/src/hooks/useHomeDashboard.js`
- Modify: `ui/V2_PROTOTYPE/src/pages/TraditionalHomeDashboard.jsx`
- Modify: `ui/V2_PROTOTYPE/src/components/Layout/Shell.jsx`
- Modify: `ui/V2_PROTOTYPE/src/components/Layout/PageShell.jsx`
- Modify: `ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx`
- Modify: `ui/V2_PROTOTYPE/src/__tests__/useHomeDashboard.test.js`
- Modify: `ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js`

- [ ] **Step 1: Write failing UI tests**

Add to `ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx`:

```jsx
test('shows session rail and confirms project creation action', async () => {
  server.use(
    http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({
      success: true,
      data: {
        items: [{
          sessionId: 'session-action',
          title: 'XX制造 WMS 粗评',
          status: 'rough_estimate',
          domain: 'business_evaluation',
          workflowKey: 'rough_estimate',
          messages: [],
          artifacts: [{ artifactId: 'art-1', type: 'rough_report', title: '粗评报告', content: '预计 120 人天', status: 'generated' }],
          pendingActions: [{
            actionId: 'act-1',
            actionType: 'create_project_evaluation',
            title: '创建项目评估方案',
            riskLevel: 'high',
            status: 'pending',
            payload: { projectName: 'XX制造 WMS 项目', customerName: 'XX制造' },
          }],
          linkedRecords: {},
          updatedAt: '2026-06-14T08:00:00.000Z',
        }],
      },
    })),
    http.post(`${BASE}/project-evaluations`, async ({ request }) => {
      const body = await request.json()
      return HttpResponse.json({
        success: true,
        data: {
          project: {
            projectId: 'project-1',
            projectName: body.projectName,
            customerName: body.customerName,
            currentStage: 'project_discovery',
            status: 'draft',
          },
        },
      })
    })
  )

  render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)

  expect(await screen.findByText('XX制造 WMS 粗评')).toBeInTheDocument()
  expect(screen.getByText('粗评报告')).toBeInTheDocument()
  expect(screen.getByText('创建项目评估方案')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '确认执行' }))

  expect(await screen.findByText('XX制造 WMS 项目')).toBeInTheDocument()
})
```

Add to `ui/V2_PROTOTYPE/src/__tests__/useHomeDashboard.test.js`:

```js
test('loads project evaluation plans for traditional dashboard', async () => {
  server.use(http.get(`${BASE}/project-evaluations`, () => HttpResponse.json({
    success: true,
    data: {
      items: [{
        projectId: 'project-1',
        projectName: 'XX制造 WMS 项目',
        customerName: 'XX制造',
        currentStage: 'project_discovery',
        status: 'draft',
        updatedAt: '2026-06-14T08:00:00.000Z',
      }],
    },
  })))

  const { result } = renderHook(() => useHomeDashboard())
  await waitFor(() => expect(result.current.plans[0].projectName).toBe('XX制造 WMS 项目'))
})
```

- [ ] **Step 2: Add AI workbench components**

Create `ui/V2_PROTOTYPE/src/components/AiWorkbench/SessionRail.jsx`:

```jsx
export default function SessionRail({ sessions = [], activeSessionId, onSelect, onNew }) {
  return (
    <aside className="ai-home-rail" style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, minHeight: 0, overflowY: 'auto' }}>
      <button type="button" className="btn btn-pri" onClick={onNew}>新建会话</button>
      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink-2)' }}>最近会话</div>
      {sessions.map((session) => (
        <button
          key={session.sessionId}
          type="button"
          onClick={() => onSelect(session)}
          aria-pressed={activeSessionId === session.sessionId}
          style={{
            textAlign: 'left',
            border: activeSessionId === session.sessionId ? '1px solid var(--accent)' : '1px solid var(--line)',
            background: activeSessionId === session.sessionId ? 'var(--accent-soft)' : '#fff',
            borderRadius: 8,
            padding: '10px 12px',
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          <b style={{ display: 'block', fontSize: 12.5 }}>{session.title || '未命名会话'}</b>
          <span style={{ display: 'block', marginTop: 4, fontSize: 11.5, color: 'var(--ink-3)' }}>{session.status || 'temporary_chat'}</span>
        </button>
      ))}
    </aside>
  )
}
```

Create `ui/V2_PROTOTYPE/src/components/AiWorkbench/PendingActionCard.jsx`:

```jsx
export default function PendingActionCard({ action, onConfirm }) {
  if (!action) return null
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, background: '#fff' }}>
      <div style={{ fontSize: 13, fontWeight: 800 }}>{action.title}</div>
      <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-3)' }}>
        高风险写入动作，需要确认后执行。
      </div>
      <button type="button" className="btn btn-pri" style={{ marginTop: 10, height: 30 }} onClick={() => onConfirm(action)}>
        确认执行
      </button>
    </div>
  )
}
```

Create `ui/V2_PROTOTYPE/src/components/AiWorkbench/ArtifactPanel.jsx`:

```jsx
import PendingActionCard from './PendingActionCard.jsx'

export default function ArtifactPanel({ session, onConfirmAction }) {
  const artifacts = session?.artifacts || []
  const pendingActions = (session?.pendingActions || []).filter((action) => action.status === 'pending')
  const linked = session?.linkedRecords || {}
  return (
    <aside style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <section style={{ border: '1px solid var(--line)', borderRadius: 8, background: '#fff', overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', fontWeight: 800 }}>当前产物</div>
        <div style={{ padding: 12, display: 'grid', gap: 8 }}>
          {artifacts.length ? artifacts.map((artifact) => (
            <div key={artifact.artifactId} style={{ padding: 10, borderRadius: 8, background: 'var(--bg-soft)' }}>
              <b style={{ fontSize: 12 }}>{artifact.title}</b>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>{String(artifact.content || '').slice(0, 80)}</p>
            </div>
          )) : <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>暂无产物</span>}
        </div>
      </section>
      <section style={{ border: '1px solid var(--line)', borderRadius: 8, background: '#fff', overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', fontWeight: 800 }}>待确认动作</div>
        <div style={{ padding: 12, display: 'grid', gap: 8 }}>
          {pendingActions.length ? pendingActions.map((action) => (
            <PendingActionCard key={action.actionId} action={action} onConfirm={onConfirmAction} />
          )) : <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>暂无待确认动作</span>}
        </div>
      </section>
      <section style={{ border: '1px solid var(--line)', borderRadius: 8, background: '#fff', overflow: 'hidden' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', fontWeight: 800 }}>关联记录</div>
        <div style={{ padding: 12, fontSize: 12, color: 'var(--ink-2)' }}>
          项目：{linked.projectName || linked.projectId || '未关联'}
        </div>
      </section>
    </aside>
  )
}
```

- [ ] **Step 3: Wire components and confirm action**

Modify `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx` imports:

```js
import SessionRail from '../components/AiWorkbench/SessionRail.jsx'
import ArtifactPanel from '../components/AiWorkbench/ArtifactPanel.jsx'
```

Add confirm handler:

```js
async function confirmPendingAction(action) {
  if (action.actionType !== 'create_project_evaluation') return
  const payload = await apiClient.post('/project-evaluations', {
    ...(action.payload || {}),
    createdFromSessionId: activeSession?.sessionId,
  })
  const project = unwrap(payload)?.project || unwrap(payload)
  upsertSession({
    ...activeSession,
    linkedRecords: {
      ...(activeSession?.linkedRecords || {}),
      projectId: project.projectId,
      projectName: project.projectName,
    },
    pendingActions: (activeSession?.pendingActions || []).map((item) => (
      item.actionId === action.actionId ? { ...item, status: 'executed', result: project } : item
    )),
  })
}
```

Render `SessionRail` on the left and `ArtifactPanel` on the right:

```jsx
<SessionRail
  sessions={sessions}
  activeSessionId={activeSession?.sessionId}
  onSelect={setActiveSession}
  onNew={() => createSession({ title: '新 AI 会话' })}
/>
```

```jsx
<ArtifactPanel session={activeSession} onConfirmAction={confirmPendingAction} />
```

- [ ] **Step 4: Use project-evaluations in home dashboard**

Modify `ui/V2_PROTOTYPE/src/hooks/useHomeDashboard.js` `load()` to request:

```js
const [projectPayload, assessmentPayload, requirementPayload, usersPayload] = await Promise.all([
  apiClient.get('/project-evaluations').catch(() => ({ data: { items: [] } })),
  apiClient.get('/versions', { type: 'assessment' }).catch(() => ({ data: [] })),
  apiClient.get('/versions', { type: 'requirementImport' }).catch(() => ({ data: [] })),
  apiClient.get('/auth/users').catch(() => ({ data: [] })),
])

const projectRecords = unwrapList(projectPayload)
const plans = [...localPlans, ...projectRecords.map((record) => ({
  id: record.projectId,
  projectName: record.projectName,
  globalVersion: record.projectId,
  customerName: record.customerName,
  status: record.status === 'draft' ? '草稿' : record.status,
  checkedOut: false,
  mandays: Number(record.totalDays || 0),
  updatedAt: sliceDate(record.updatedAt),
  raw: record,
}))]
```

Update KPI first card label from `方案数` to `项目评估`.

- [ ] **Step 5: Rename UI labels**

Modify `ui/V2_PROTOTYPE/src/pages/TraditionalHomeDashboard.jsx`:

```jsx
<span>项目评估方案列表</span>
```

Modify page title/subtitle where rendered:

```jsx
title="项目评估工作台"
subtitle="查看项目评估概览、快速操作和最近动态"
```

Modify `ui/V2_PROTOTYPE/src/components/Layout/Shell.jsx` item:

```js
{ to: '/', label: 'AI 工作台', icon: '●' },
{ to: '/project-evaluations', label: '项目评估', icon: '▣' },
```

If `/project-evaluations` is not implemented yet, keep traditional dashboard reachable through homepage switch and update only visible copy. Do not add a broken nav route.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- HomeWorkspace useHomeDashboard
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add ui/V2_PROTOTYPE/src/components/AiWorkbench ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx ui/V2_PROTOTYPE/src/hooks/useHomeDashboard.js ui/V2_PROTOTYPE/src/pages/TraditionalHomeDashboard.jsx ui/V2_PROTOTYPE/src/components/Layout/Shell.jsx ui/V2_PROTOTYPE/src/components/Layout/PageShell.jsx ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx ui/V2_PROTOTYPE/src/__tests__/useHomeDashboard.test.js ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js
git commit -m "feat: connect ai sessions to project evaluations"
```

### Task 5: Admin Standard Governance Slice

**Files:**
- Modify: `apps/api/src/modules/ai-sessions/ai-sessions.controller.ts`
- Modify: `apps/api/src/routes/ai-sessions.routes.ts`
- Modify: `ui/V2_PROTOTYPE/src/pages/aiHomePresets.js`
- Modify: `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx`
- Modify: `ui/V2_PROTOTYPE/src/__tests__/aiHomePresets.test.js`
- Modify: `ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx`
- Modify: `ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js`

- [ ] **Step 1: Write failing admin preset test**

Add to `ui/V2_PROTOTYPE/src/__tests__/aiHomePresets.test.js`:

```js
test('admin preset includes standard governance workflow', () => {
  const preset = getAiHomePreset('admin')
  expect(preset.workflows.some((workflow) => workflow.key === 'standard_governance')).toBe(true)
  expect(preset.workflows.find((workflow) => workflow.key === 'standard_governance').title).toContain('标准')
})
```

- [ ] **Step 2: Add admin workflow preset**

Modify `ui/V2_PROTOTYPE/src/pages/aiHomePresets.js` admin workflows:

```js
{ key: 'standard_governance', title: '更新评估标准', desc: '上传金蝶官方产品评估文件，生成标准差异和发布草稿' }
```

- [ ] **Step 3: Write failing standard draft upload test**

Add to `ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx`:

```jsx
test('admin standard governance upload creates a standard draft artifact', async () => {
  server.use(
    http.get(`${BASE}/auth/me`, () => HttpResponse.json({
      success: true,
      data: { user: { id: 'admin-1', username: 'admin', role: 'admin', businessRole: 'admin', status: 'active' } },
    })),
    http.post(`${BASE}/ai-sessions/:sessionId/standard-drafts`, async () => HttpResponse.json({
      success: true,
      data: {
        artifact: {
          artifactId: 'std-art-1',
          type: 'standard_draft',
          title: '标准差异草稿',
          content: '识别新增模块 2 个，人天基准变更 3 项',
          status: 'generated',
        },
      },
    }))
  )

  const { container } = render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)

  fireEvent.click(await screen.findByRole('button', { name: /更新评估标准/ }))
  const fileInput = container.querySelector('input[type="file"]')
  const file = new File(['标准'], '金蝶官方评估标准.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  fireEvent.change(fileInput, { target: { files: [file] } })

  expect(await screen.findByText('标准差异草稿')).toBeInTheDocument()
  expect(screen.getByText(/人天基准变更/)).toBeInTheDocument()
})
```

- [ ] **Step 4: Add backend standard draft controller**

Modify `apps/api/src/modules/ai-sessions/ai-sessions.controller.ts`:

```ts
export function createStandardDraft(req: Request, res: Response) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const sessionId = asString(req.params.sessionId);
  const fileName = asString((req.body as { fileName?: unknown })?.fileName) || "金蝶官方评估文件";
  const session = appendAiSessionEvent(auth.user, sessionId, {
    artifact: {
      type: "standard_draft",
      title: "标准差异草稿",
      content: `已接收 ${fileName}，生成标准差异草稿。`,
      status: "generated",
    },
    pendingAction: {
      actionType: "publish_standard_version",
      title: "发布标准版本",
      riskLevel: "high",
      payload: { fileName },
    },
  });
  if (!session) return fail(res, 40404, "会话不存在", [{ field: "sessionId", reason: "not_found" }]);
  return res.json(ok({
    session,
    artifact: session.artifacts[session.artifacts.length - 1],
  }, randomUUID()));
}
```

Modify module export:

```ts
export { createSession, listSessions, getSession, appendSessionEvent, createStandardDraft } from "./ai-sessions.controller";
```

Modify `apps/api/src/routes/ai-sessions.routes.ts`:

```ts
router.post("/:sessionId/standard-drafts", requireCapability("system:manage"), AiSessionsModule.createStandardDraft);
```

- [ ] **Step 5: Wire standard upload in UI**

In `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx`, update file handling:

```js
async function createStandardDraftFromFile(file) {
  const session = activeSession || await createSession({
    title: file.name,
    domain: 'standard_governance',
    workflowKey: 'standard_governance',
    status: 'standard_review',
  })
  const payload = await apiClient.post(`/ai-sessions/${session.sessionId}/standard-drafts`, {
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
  })
  const data = unwrap(payload)
  if (data.session) upsertSession(data.session)
}
```

In `attachFile(file)`:

```js
setSelectedFile(file || null)
if (file && activeWorkflowKey === 'standard_governance') {
  createStandardDraftFromFile(file).catch((err) => {
    setMessages((prev) => [...prev, { role: 'assistant', text: `标准文件解析暂未完成：${err.message || '请求失败'}`, error: true }])
  })
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- aiHomePresets HomeWorkspace
npm run test:modules -w apps/api
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/ai-sessions/ai-sessions.controller.ts apps/api/src/modules/ai-sessions/ai-sessions.module.ts apps/api/src/routes/ai-sessions.routes.ts ui/V2_PROTOTYPE/src/pages/aiHomePresets.js ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx ui/V2_PROTOTYPE/src/__tests__/aiHomePresets.test.js ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js
git commit -m "feat: add standard governance ai workflow"
```

### Task 6: Full Verification And Browser QA

**Files:**
- Verify only.

- [ ] **Step 1: Run API module tests**

Run:

```bash
npm run test:modules -w apps/api
```

Expected: PASS.

- [ ] **Step 2: Run frontend tests**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE
```

Expected: PASS.

- [ ] **Step 3: Run frontend build**

Run:

```bash
npm run build --prefix ui/V2_PROTOTYPE
```

Expected: PASS and Vite build completes.

- [ ] **Step 4: Start dev server**

Run:

```bash
npm run dev --prefix ui/V2_PROTOTYPE
```

Expected: local UI opens on an available localhost port, normally `http://localhost:3002`.

- [ ] **Step 5: Browser QA**

Open the app and verify:

```text
1. AI 工作台 shows session rail, central chat, and artifact panel.
2. Sending a message creates or updates a persistent session.
3. Reloading the page shows the prior session in recent sessions.
4. A pending create-project action requires confirmation.
5. Confirming the action creates/links a project evaluation plan.
6. Traditional dashboard copy reads 项目评估工作台 / 项目评估方案列表.
7. Admin preset shows 更新评估标准.
8. Uploading a standard file in admin workflow creates 标准差异草稿 and a 发布标准版本 pending action.
```

- [ ] **Step 6: Commit verification doc update if needed**

If the implementation uncovered any product constraints, update:

```bash
docs/superpowers/specs/2026-06-14-wes-agent-os-v2-design.md
docs/superpowers/plans/2026-06-14-wes-agent-os-v2-phase-1.md
```

Then commit:

```bash
git add docs/superpowers/specs/2026-06-14-wes-agent-os-v2-design.md docs/superpowers/plans/2026-06-14-wes-agent-os-v2-phase-1.md
git commit -m "docs: refine wes agent os phase 1 plan"
```

## Plan Self-Review

Spec coverage:

- AI session 长期保存：Task 1 and Task 3.
- 首页统一 AI 工作台：Task 3 and Task 4.
- 项目评估方案一等对象：Task 2 and Task 4.
- 多 session 关联同项目：Task 1 `linkedRecords` and Task 2 `createdFromSessionId`; later project detail can display all linked sessions.
- 高风险写入确认：Task 4 `PendingActionCard`.
- 管理员标准治理：Task 5.
- 主默认标准 + 可选特定版本：Task 5 stores standard draft and publish action; full version strategy remains a later standard-library implementation.
- 传统页面保留：Task 4 only renames and reroutes project container; demand/assessment pages remain.

Known phase-1 gaps:

- `ai-sessions.json` is prototype storage, not production DB schema.
- Standard file parsing in Task 5 stores a draft summary; full Excel/Word/PDF extraction and standard-version schema are later tasks.
- Pending action execution is implemented in frontend for project creation first; a server-side action executor should replace it before production hardening.
- Project evaluation plan is backed by existing `global` version records in phase one; a normalized project table can follow after UX validation.
