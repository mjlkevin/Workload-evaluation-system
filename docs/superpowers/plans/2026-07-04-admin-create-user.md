# Admin Create User Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let administrators create users directly from the V2 User Management toolbar without using invite registration.

**Architecture:** Add a protected backend `POST /auth/users` handler that validates role boundaries, hashes the initial password, persists through the existing users store, and returns a public user. Add a V2 toolbar button and modal that posts to the new endpoint and prepends the created user to the current table. Record the user request through WES Issue-first governance and route it to a new RP.

**Tech Stack:** Express + TypeScript auth module, existing PG-backed users store, Vite React UI, Node test runner for API handlers, Vitest/MSW for V2 UI tests.

---

### Task 1: Backend Admin User Creation

**Files:**
- Modify: `apps/api/src/modules/auth/auth.usecase.ts`
- Modify: `apps/api/src/modules/auth/auth.controller.ts`
- Modify: `apps/api/src/modules/auth/auth.module.ts`
- Modify: `apps/api/src/routes/auth.routes.ts`
- Test: `apps/api/src/modules/modules.handlers.test.ts`

- [ ] **Step 1: Write the failing API handler test**

Add a test that calls `createUser` with an admin token and expects a new public user without `passwordHash`.

- [ ] **Step 2: Run the focused module test**

Run: `npm run test:modules -w apps/api -- src/modules/modules.handlers.test.ts -t "createUser lets an admin directly create a user"`

Expected: FAIL because `createUser` is not exported or the route behavior is missing.

- [ ] **Step 3: Implement `createUser`**

Validate `username`, `password`, duplicate username, `role`, `businessRole`, and `status`. Only `admin` may create `admin`; `sub_admin` may create `sub_admin` or `user`.

- [ ] **Step 4: Export and route the handler**

Export from auth controller/module and add `router.post("/users", requireCapability("user:manage"), AuthModule.createUser)`.

- [ ] **Step 5: Run backend tests**

Run focused module test, then `npm run build:api`.

### Task 2: Frontend New User Dialog

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/pages/UserManagement.jsx`
- Test: `ui/V2_PROTOTYPE/src/__tests__/UserManagement.test.jsx`
- Modify: `ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js` only if a default MSW handler is needed.

- [ ] **Step 1: Write the failing UI test**

Add a Vitest case that clicks `+ 新建用户`, fills username/email/password/roles/status, submits, verifies `POST /auth/users`, and sees the new user row.

- [ ] **Step 2: Run the focused UI test**

Run: `npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/UserManagement.test.jsx -t "creates a user directly"`

Expected: FAIL because the button/dialog does not exist.

- [ ] **Step 3: Implement modal state and submit flow**

Add create-user form state, validation messages, and `apiClient.post("/auth/users", payload)`. On success prepend the returned user to `users` and close the dialog.

- [ ] **Step 4: Run frontend tests**

Run focused test, `UserManagement.test.jsx`, V2 full test, and `npm run build:web`.

### Task 3: WES Governance And Final Verification

**Files:**
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/work-items/board-work-items.json`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/issues.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/defects.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/requirements.html`
- Add: `03_技术设计/系统架构/WES-Agent-升级总看板/events/2026-07-04-admin-create-user.json`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/changes.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/testing.html`

- [ ] **Step 1: Add Issue-first registry entry**

Add `ISS-2026-07-04-003` with disposition `requirement` and ref `RP-041`.

- [ ] **Step 2: Add the RP-041 requirement fact**

Patch `requirements.html` narrowly with a focused RP-041 section and status row.

- [ ] **Step 3: Create and apply Board Event**

Run `npm run board:work-items:generate`, `npm run board:event:check`, `npm run board:event:apply`, and `npm run board:check`.

- [ ] **Step 4: Confirm local service readiness**

Check API health and V2 frontend response so the user can refresh `http://localhost:3004/users`.
