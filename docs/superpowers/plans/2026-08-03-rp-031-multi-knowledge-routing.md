# RP-031 Multi-Knowledge Routing Implementation Plan

> **For Codex:** Execute this plan inline with TDD because the user explicitly authorized design and implementation in the current task.

**Goal:** Extend WES from one active Zhipu knowledge base to multiple same-account knowledge bases with deterministic/AI routing, role filtering, one bounded empty-result fallback, explainable trace, and an admin management UI.

**Architecture:** Keep the existing JSON-backed system repository and draft/active activation gate. Add a backward-compatible `KnowledgeBaseProfile` collection and per-profile probes, introduce a pure router service, then integrate it into the existing workbench knowledge path. The existing React/Phase B UI remains the only frontend stack.

**Tech Stack:** TypeScript, Express, Node test runner/tsx, React 18, Vitest, existing Phase B CSS/components.

---

### Task 1: Migrate the knowledge-base configuration contract

**Files:**
- Modify: `apps/api/src/types/index.ts`
- Modify: `apps/api/src/modules/system/system.repository.ts`
- Test: `apps/api/src/modules/system/system.repository.test.ts`

1. Add failing tests for legacy single-ID migration, profile normalization, duplicate/default validation inputs, and per-profile configuration hashes.
2. Run the repository tests and confirm RED.
3. Add `KnowledgeBaseProfile`, `knowledgeBases`, per-profile probe records, normalizers, legacy migration, and active catalog resolution.
4. Preserve environment fallback as a synthetic default profile and preserve API-key masking behavior.
5. Run repository tests and confirm GREEN.

### Task 2: Add per-profile test and activation gates

**Files:**
- Modify: `apps/api/src/modules/system/system.usecase.ts`
- Modify: `apps/api/src/modules/system/knowledge-base-access-probe.ts`
- Test: `apps/api/src/modules/system/system.kb-config.test.ts`

1. Add failing tests for testing a selected profile, all-enabled-profile activation, stale/mismatched profile probes, and invalid profile collections.
2. Run focused tests and confirm RED.
3. Extend GET/PATCH/test/activate handlers without adding new routes.
4. Return field-specific validation and probe failures; never expose stored API keys.
5. Run focused tests and confirm GREEN.

### Task 3: Implement the deterministic and AI router

**Files:**
- Create: `apps/api/src/services/ai/knowledge-base-router.service.ts`
- Create: `apps/api/src/services/ai/knowledge-base-router.service.test.ts`

1. Write failing tests for role filtering, explicit selection, strong keyword selection, ambiguous model selection, invalid/low-confidence model output, default fallback, and no-access resolution.
2. Run the new test and confirm RED.
3. Implement a pure router that only exposes role-authorized candidates to the injected model selector.
4. Generate one optional bounded fallback candidate and never return disabled/unauthorized profiles.
5. Run the router tests and confirm GREEN.

### Task 4: Integrate routing and bounded retrieval fallback

**Files:**
- Modify: `apps/api/src/services/ai/workbench-dispatch.service.ts`
- Modify: `apps/api/src/services/ai/knowledge-tool.service.ts`
- Modify: `apps/api/src/services/ai/chat.service.ts`
- Modify: `apps/api/src/modules/trace/trace.usecase.ts`
- Test: `apps/api/src/services/ai/workbench-dispatch.service.test.ts`
- Test: `apps/api/src/modules/trace/trace.test.ts`

1. Add failing dispatch tests proving strong rules skip the route model, ambiguous questions use it, role ACL is enforced, empty retrieval performs exactly one fallback, and non-empty/non-retrieval failures do not fan out.
2. Add a failing trace test for route metadata and attempts.
3. Run both focused test files and confirm RED.
4. Resolve the active catalog, invoke the router, call the primary profile, and retry once only for `retrieval_empty`.
5. Attach selected profile, route mode/reason/confidence, and attempt summaries to the existing knowledge tool trace and persisted span.
6. Run focused tests and confirm GREEN.

### Task 5: Build the multi-knowledge admin UI

**Files:**
- Create: `ui/V2_PROTOTYPE/src/components/system/KnowledgeBaseProfilesPanel.jsx`
- Modify: `ui/V2_PROTOTYPE/src/hooks/useSystemManagement.js`
- Modify: `ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx`
- Modify: `ui/V2_PROTOTYPE/src/index.css`
- Test: `ui/V2_PROTOTYPE/src/__tests__/SystemManagementKnowledgeBase.test.jsx`

1. Add failing UI tests for rendering multiple profiles, add/edit Dialog, role/keyword payloads, per-profile test action, default uniqueness feedback, and compact viewport semantics.
2. Run the focused Vitest file and confirm RED.
3. Extend the hook state and payload to carry `knowledgeBases` and `probes`.
4. Add a Phase B list/card panel with Dialog editing and per-profile test status; keep shared credentials and retrieval parameters in the existing section.
5. Add only scoped responsive CSS needed for 1440px and 760px.
6. Run focused UI tests and confirm GREEN.

### Task 6: Documentation, board, verification, and commit

**Files:**
- Modify as mapped by `skills/maintain-wes-command-board`: requirements, plan, testing/monitoring, risks, and changes pages for RP-031.
- Modify: `03_技术设计/系统演进/实现与文档对齐说明.md`
- Modify: `docs/openapi.yaml`

1. Update public API schema and implementation alignment notes.
2. Record implementation facts, tests, risks, and branch state in the WES command board without duplicating RP-031.
3. Run focused tests, `npm run test:modules`, `npm run test:ai`, `npm run test:web`, `npm run build:api`, `npm run build:web`, `npm run test:security`, board tests, and UI scope checker against base `83468bf`.
4. Start the app and verify `/system/knowledge-base` at 1440px and 760px, including keyboard/Dialog behavior and inline status/alert feedback.
5. Run `git diff --check`, secret scan, and `git status --short`.
6. Commit logical, verified changes using `feat(RP-031): 多知识库意图路由与受控回退` (or split into contract/runtime/UI commits if reviewability requires it).
