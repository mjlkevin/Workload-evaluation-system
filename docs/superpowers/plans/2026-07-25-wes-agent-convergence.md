# WES Agent Worktree Convergence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the known red test gates in `Workload-evaluation-system-agent`, correct stale workspace governance, preserve unrelated dirty work, and produce a verified, reviewable branch before any integration with the main checkout.

**Architecture:** Treat each failing cluster as an independent correction bounded by its existing tests. Keep product code, process Skill, path governance, and board evidence separate; promote only verified facts to the board. Do not run a live PostgreSQL migration or merge into the other checkout without a suitable environment and a clean integration gate.

**Tech Stack:** Node.js workspaces, TypeScript, Fastify, Ajv/JSON Schema, React, Vitest, Node test runner, Git worktrees, static HTML command board.

---

### Task 1: Confirm isolation and preserve the baseline

**Files:**
- Inspect: `.git`
- Inspect: `package.json`
- Inspect: `apps/api/package.json`
- Inspect: `ui/V2_PROTOTYPE/package.json`

**Step 1: Confirm the current checkout is a linked worktree**

Run:

```bash
git rev-parse --show-toplevel
git rev-parse --git-dir
git rev-parse --git-common-dir
git rev-parse --show-superproject-working-tree
git branch --show-current
```

Expected: top level is `/Users/kevin/AI/Workload-evaluation-system-agent`, Git dir differs from common dir, no superproject is printed, and branch is `codex/wes-dirty-triage-20260629`.

**Step 2: Record recoverability and dirty scope**

Run:

```bash
git status --short --branch
git stash list --format='%gd %H %s' | sed -n '1,5p'
```

Expected: existing mixed WIP is visible and stash commit `89a428f2e19735777b8a95d07c52911651ae4b66` remains available.

### Task 2: Restore structured-output test startup

**Files:**
- Modify: `apps/api/package.json`
- Modify mechanically: `package-lock.json`
- Inspect: `apps/api/src/ai/contracts/structured-output.ts`
- Test: `apps/api/src/ai/contracts/structured-output.test.ts`

**Step 1: Reproduce the dependency failure**

Run:

```bash
npx tsx --test apps/api/src/ai/contracts/structured-output.test.ts
```

Expected: FAIL before test collection with `Cannot find package 'ajv-formats'`.

**Step 2: Confirm the consumer and compatible dependency location**

Run:

```bash
rg -n 'ajv|ajv-formats' package.json apps/api/package.json package-lock.json apps/api/src/ai/contracts
```

Expected: the API workspace imports `ajv-formats`; dependency must be declared in `apps/api/package.json` and represented in the root lock file.

**Step 3: Add the minimal compatible dependency**

Edit `apps/api/package.json` to add `ajv-formats` next to `ajv`, then run:

```bash
npm install --package-lock-only
npm install
```

Expected: `package-lock.json` records the API workspace dependency and module resolution succeeds.

**Step 4: Verify the focused contract**

Run:

```bash
npx tsx --test apps/api/src/ai/contracts/structured-output.test.ts
```

Expected: PASS.

### Task 3: Enforce issue-first intake in the requirement recording Skill

**Files:**
- Modify: `skills/recording-wes-requirements/SKILL.md`
- Test: `scripts/board-work-items.test.js`
- Inspect: `docs/codex-workflows/wes-feedback-intake.md`

**Step 1: Reproduce the governance failure**

Run:

```bash
node --test scripts/board-work-items.test.js
```

Expected: one assertion fails because the Skill still says raw feedback may directly enter the demand pool.

**Step 2: Trace the intended policy**

Run:

```bash
rg -n '问题池|需求池|缺陷池|issue|直接进入|写入需求池' \
  AGENTS.md \
  skills/recording-wes-requirements/SKILL.md \
  docs/codex-workflows/wes-feedback-intake.md \
  scripts/board-work-items.test.js
```

Expected: board governance and test require issue-first intake, with demand/defect records created only after triage.

**Step 3: Make the minimum policy correction**

Update the Skill so all raw feedback first enters the issue pool, then classification and deduplication determine whether to update an existing item or create a requirement/defect. Remove direct-demand-pool wording without changing unrelated workflow rules.

**Step 4: Verify the Skill contract**

Run:

```bash
node --test scripts/board-work-items.test.js
```

Expected: 12 tests pass.

### Task 4: Repair the streaming API export

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/api/ai.js`
- Test: `ui/V2_PROTOTYPE/src/__tests__/aiStreamApi.test.js`
- Inspect: `ui/V2_PROTOTYPE/src/pages/AIHome.jsx`

**Step 1: Reproduce the focused failure**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/aiStreamApi.test.js
```

Expected: four tests fail because `streamHomeWorkbenchChat` is not exported as a function.

**Step 2: Trace the expected SSE contract**

Read the test, API module, caller, and shared client. Confirm request path, headers, abort behavior, event parsing, and error mapping.

**Step 3: Implement the smallest compatible export**

Restore `streamHomeWorkbenchChat` in `ui/V2_PROTOTYPE/src/api/ai.js` using the established client/auth/SSE conventions. Do not introduce a second streaming implementation.

**Step 4: Verify the focused contract**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/aiStreamApi.test.js
```

Expected: four tests pass.

### Task 5: Correct system code-rule action identity

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx`
- Modify if the root cause is in the hook: `ui/V2_PROTOTYPE/src/hooks/useSystemManagement.js`
- Test: `ui/V2_PROTOTYPE/src/__tests__/SystemManagementCodeRules.test.jsx`

**Step 1: Reproduce the focused failure**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/SystemManagementCodeRules.test.jsx
```

Expected: enable and disable assertions receive a display code such as `GL` instead of a record ID such as `rule-global`.

**Step 2: Trace identity from rendered row to mutation**

Inspect the row data, click handler, hook signature, and API request. Determine which field is the persistent identifier.

**Step 3: Pass the persistent ID**

Change only the action argument at the root cause so enable/disable uses `rule.id`; retain `rule.code` for display.

**Step 4: Verify the focused contract**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/SystemManagementCodeRules.test.jsx
```

Expected: all code-rule tests pass.

### Task 6: Make system management routing configuration authoritative

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/App.jsx`
- Modify if required: `ui/V2_PROTOTYPE/src/config/systemManagement.js`
- Modify if required: `ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx`
- Test: `ui/V2_PROTOTYPE/src/__tests__/SystemManagementNavigation.test.jsx`

**Step 1: Reproduce the focused failure**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/SystemManagementNavigation.test.jsx
```

Expected: three route/title assertions fail for `/system` and dedicated submodule paths.

**Step 2: Trace route ownership**

Compare route declarations, system module config, page selection, navigation links, and headings. Confirm whether `/system` redirects or renders a default module and how submodule slugs map to headings.

**Step 3: Align routes and headings with one config**

Use the existing system-management configuration as the source of truth. Ensure `/system` resolves predictably and each configured submodule has a dedicated route and matching heading.

**Step 4: Verify navigation**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/SystemManagementNavigation.test.jsx
```

Expected: all navigation tests pass.

### Task 7: Correct stale workspace paths

**Files:**
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `codex-project-registry.md`

**Step 1: Enumerate stale path references**

Run:

```bash
rg -n '/Users/kevin/AI-Local/Workload-evaluation-system(-agent)?' AGENTS.md CLAUDE.md codex-project-registry.md
```

Expected: current-mainline references still point to the pre-move location.

**Step 2: Patch current workspace facts**

Replace the stale path with `/Users/kevin/AI/Workload-evaluation-system-agent` and the comparison checkout with `/Users/kevin/AI/Workload-evaluation-system`. Preserve the distinction between active agent worktree and integration/history checkout, and document `git worktree repair` as the required operation after a directory move.

**Step 3: Verify no stale active path remains**

Run:

```bash
rg -n '/Users/kevin/AI-Local/Workload-evaluation-system(-agent)?' AGENTS.md CLAUDE.md codex-project-registry.md
rg -n '/Users/kevin/AI/Workload-evaluation-system(-agent)?' AGENTS.md CLAUDE.md codex-project-registry.md
```

Expected: the first command has no matches; the second shows the corrected paths.

### Task 8: Run layered verification

**Files:**
- Test: `apps/api/src/ai/contracts/structured-output.test.ts`
- Test: `apps/api/src/migration/json-to-pg-migration-policy.test.ts`
- Test: `apps/api/src/agent/context/*.test.ts`
- Test: `scripts/board-event.test.js`
- Test: `scripts/board-work-items.test.js`
- Test: `ui/V2_PROTOTYPE/src/__tests__/*.test.*`

**Step 1: Run focused suites**

Run:

```bash
npx tsx --test apps/api/src/ai/contracts/structured-output.test.ts
npx tsx --test apps/api/src/migration/json-to-pg-migration-policy.test.ts
npx tsx --test apps/api/src/agent/context/*.test.ts
node --test scripts/board-event.test.js scripts/board-work-items.test.js
npm run test --prefix ui/V2_PROTOTYPE -- \
  src/__tests__/aiStreamApi.test.js \
  src/__tests__/SystemManagementCodeRules.test.jsx \
  src/__tests__/SystemManagementNavigation.test.jsx
```

Expected: all focused suites pass.

**Step 2: Run full automated gates**

Run:

```bash
npm run test:modules
npm run test:web
npm run test:ai
npm run build:api
npm run build:web
```

Expected: all commands exit 0. If a new failure appears, return to root-cause diagnosis instead of weakening the test.

### Task 9: Synchronize the command board with current evidence

**Files:**
- Modify through event pipeline: `03_技术设计/系统架构/WES-Agent-升级总看板/events/*.json`
- Regenerate/update: `03_技术设计/系统架构/WES-Agent-升级总看板/changes.html`
- Regenerate/update: `03_技术设计/系统架构/WES-Agent-升级总看板/testing.html`
- Regenerate/update: `03_技术设计/系统架构/WES-Agent-升级总看板/monitoring.html`
- Update if status changes: `03_技术设计/系统架构/WES-Agent-升级总看板/plan.html`
- Update if risk changes: `03_技术设计/系统架构/WES-Agent-升级总看板/risks.html`

**Step 1: Inspect event schema and current board claims**

Run:

```bash
sed -n '1,260p' scripts/board-event-apply.js
find '03_技术设计/系统架构/WES-Agent-升级总看板/events' -maxdepth 1 -type f | sort | tail -5
rg -n '已交付|已通过|待执行|待回填|PostgreSQL|结构化输出|issue-first' \
  '03_技术设计/系统架构/WES-Agent-升级总看板'
```

**Step 2: Record only verified facts**

Add one dated convergence event following the existing schema. Record exact commands and outcomes. Keep live PostgreSQL migration and manual acceptance as `待执行` or `待回填` unless actual evidence exists.

**Step 3: Apply and verify the event**

Run the repository’s event check/apply commands discovered from the script help or package scripts, then run:

```bash
node --test scripts/board-event.test.js scripts/board-work-items.test.js
rg -n '2026-07-25|待执行|待回填' \
  '03_技术设计/系统架构/WES-Agent-升级总看板/changes.html' \
  '03_技术设计/系统架构/WES-Agent-升级总看板/testing.html' \
  '03_技术设计/系统架构/WES-Agent-升级总看板/monitoring.html'
```

Expected: the board contains current evidence and does not claim unexecuted manual/PG checks passed.

### Task 10: Prepare thematic commits and integration decision

**Files:**
- Inspect: all files from `git status --short`
- Exclude: `config/auth/users.json`
- Exclude: local databases, logs, exports, caches, secrets, and runtime data

**Step 1: Review the final diff by workstream**

Run:

```bash
git status --short
git diff --stat
git diff --check
```

Expected: no whitespace errors; every changed file maps to a documented workstream or is explicitly left uncommitted.

**Step 2: Stage and commit one workstream at a time**

Use explicit file paths and the repository format `type(scope): 中文描述`. Before each commit, run `git diff --cached --stat` and the focused verification for that workstream.

**Step 3: Re-run the final gate on committed state**

Run:

```bash
git status --short --branch
npm run test:modules
npm run test:web
npm run test:ai
npm run build:api
npm run build:web
node --test scripts/board-event.test.js scripts/board-work-items.test.js
```

Expected: tests/builds pass; only intentionally excluded runtime/local files remain dirty.

**Step 4: Inspect the other checkout before integration**

Run read-only checks in `/Users/kevin/AI/Workload-evaluation-system`:

```bash
git status --short --branch
git branch --show-current
git log --oneline --left-right --cherry-pick HEAD...codex/wes-dirty-triage-20260629
```

Expected: report the other checkout’s local changes and divergence. Do not merge until those changes are protected and the user chooses the final integration method.

### Task 11: Finalize the single-worktree operating model

**Files:**
- Modify: `AGENTS.md`
- Modify: `codex-project-registry.md`
- Inspect: Git worktree registry

- [ ] **Step 1: Verify the post-merge worktree fact**

Run:

```bash
git worktree list --porcelain
test ! -e /Users/kevin/AI/Workload-evaluation-system-agent
```

Expected: only `/Users/kevin/AI/Workload-evaluation-system` is registered and the old Agent path does not exist.

- [ ] **Step 2: Update workspace governance**

Replace the obsolete active-Agent-worktree wording with the single active directory `/Users/kevin/AI/Workload-evaluation-system`. Keep the merged historical branch as Git history, not as a second delivery directory.

- [ ] **Step 3: Verify stale active-path instructions are gone**

Run:

```bash
rg -n '当前活动交付 worktree|WES Agent / WorkEvolutionSys 活动 worktree|WES 集成/对比 checkout' AGENTS.md codex-project-registry.md
```

Expected: no instruction tells a future agent to use the removed directory.

### Task 12: Restore a deterministic unknown-route fallback

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/App.jsx`
- Test: `ui/V2_PROTOTYPE/src/__tests__/AppAuthGuard.test.jsx`

- [ ] **Step 1: Write the failing route test**

Add an authenticated-router test that starts at `/path-that-does-not-exist` and expects the AI 工作台 heading after redirect.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/AppAuthGuard.test.jsx
```

Expected: FAIL because the current route tree has no catch-all child.

- [ ] **Step 3: Add the minimal fallback**

Add `<Route path="*" element={<Navigate to="/" replace />} />` inside the protected route tree.

- [ ] **Step 4: Verify GREEN**

Run the focused test again. Expected: all `AppAuthGuard` tests pass.

### Task 13: Preserve safe username history and restore password focus

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/pages/Login.jsx`
- Test: `ui/V2_PROTOTYPE/src/__tests__/Login.test.jsx`

- [ ] **Step 1: Write failing behavior tests**

Add one successful-login assertion that `wes_username_history` contains only the username and not the submitted password. Add one legacy-record migration test that preserves usernames while deleting `wes_recent_users`, including any old plaintext password. Add one preloaded-history interaction test that focuses the username input, selects a history entry, and expects the password input to have focus.

- [ ] **Step 2: Verify RED**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/Login.test.jsx
```

Expected: the normal safe-storage assertion passes against the resolved implementation; legacy cleanup fails because the old key is still retained, and focus fails because the password input is not inside the username wrapper.

- [ ] **Step 3: Implement direct focus ownership**

Create `passwordInputRef`, attach it to the password input, and call `passwordInputRef.current?.focus()` after selecting a username. Migrate only legacy usernames into `wes_username_history`, remove `wes_recent_users`, and never copy legacy passwords.

- [ ] **Step 4: Verify GREEN**

Run the focused Login suite. Expected: all Login tests pass.

### Task 14: Record issue-first evidence and run the final Web gate

**Files:**
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/issues.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/defects.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/testing.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/monitoring.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/changes.html`

- [ ] **Step 1: Record two deduplicated issues and derived defects**

Record the unknown-route fallback gap and username-history focus gap as separate 2026-07-25 source issues. Link each to its derived defect and preserve the user-approved safe-storage decision.

- [ ] **Step 2: Run current verification**

Run:

```bash
npm run test:web
npm run build:web
node --test scripts/board-event.test.js scripts/board-work-items.test.js
git diff --check
```

Expected: Web tests and build pass, board governance tests pass, and the diff has no whitespace errors. Preserve the existing Vite chunk-size warning as a non-blocking warning.
