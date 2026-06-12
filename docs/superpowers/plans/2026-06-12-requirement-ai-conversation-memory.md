# Requirement AI Conversation Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the requirement AI evaluation conversation after browser refresh by storing a thread-style message log in the requirement version draft.

**Architecture:** Keep phase one scoped to the existing version payload. Add a single active conversation thread under `payload.aiEvaluation`, append user/assistant/system messages during analysis and feedback actions, and auto-save the thread back to `/versions/:id/save-draft` after state-changing events. The UI renders the persisted message log instead of reconstructing chat history only from transient state.

**Tech Stack:** React hooks/components in `ui/V2_PROTOTYPE`, existing `apiClient`, existing versions draft API, Vitest + Testing Library + MSW.

---

### Task 1: Persist And Restore Thread Messages

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/hooks/useRequirementAiWorkbench.js`
- Modify: `ui/V2_PROTOTYPE/src/pages/RequirementAiWorkbench.jsx`
- Test: `ui/V2_PROTOTYPE/src/__tests__/RequirementAiWorkbench.test.jsx`

- [x] **Step 1: Write failing tests**

Add tests that load a saved `aiEvaluation.activeThreadId` and `aiEvaluation.threads[0].messages`, then assert the restored user and assistant messages are visible. Add another test that sends a message with a mocked file and asserts `/versions/:id/save-draft` receives `aiEvaluation.threads[0].messages` containing user, parse summary, and assessment preview messages.

- [x] **Step 2: Verify tests fail**

Run: `npm run test --prefix ui/V2_PROTOTYPE -- RequirementAiWorkbench`

Expected: restored messages are not found and save payload has no thread messages.

- [x] **Step 3: Implement minimal thread state**

Add helpers for `createThread`, `createMessage`, `normalizeThreads`, and `buildThreadedEvaluation`. Store `activeThreadId`, `threads`, and `messages` in the hook. Render messages from `messages` in the page, with specialized cards for `parse_summary`, `assessment_preview`, `error`, and plain `text`.

- [x] **Step 4: Verify tests pass**

Run: `npm run test --prefix ui/V2_PROTOTYPE -- RequirementAiWorkbench`

Expected: all Requirement AI workbench tests pass.

### Task 2: Autosave Conversation Events

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/hooks/useRequirementAiWorkbench.js`
- Test: `ui/V2_PROTOTYPE/src/__tests__/RequirementAiWorkbench.test.jsx`

- [x] **Step 1: Write failing tests**

Assert that feedback and accept actions append message records and call save draft without the user pressing “保存草稿”.

- [x] **Step 2: Implement autosave**

Add an internal `persistAiEvaluationDraft(nextState)` helper that checks out when needed and patches `payload.aiEvaluation` while preserving existing payload fields. Call it after successful analysis, error responses, feedback, confirmation, and accept actions.

- [x] **Step 3: Verify tests pass**

Run: `npm run test --prefix ui/V2_PROTOTYPE -- RequirementAiWorkbench`

Expected: all Requirement AI workbench tests pass.

### Task 3: Regression Verification

**Files:**
- Build target: `ui/V2_PROTOTYPE`

- [x] **Step 1: Run focused tests**

Run: `npm run test --prefix ui/V2_PROTOTYPE -- RequirementAiWorkbench HomeWorkspace`

- [x] **Step 2: Run frontend build**

Run: `npm run build --prefix ui/V2_PROTOTYPE`

- [ ] **Step 3: Commit**

Stage only the plan and requirement AI workbench files, then commit with:

```bash
git commit -m "feat: persist requirement ai conversation"
```
