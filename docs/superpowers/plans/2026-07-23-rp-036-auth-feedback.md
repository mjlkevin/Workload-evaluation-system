# RP-036 Authentication And Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent stale or missing authentication from producing false system-configuration success and silent knowledge-base connectivity tests.

**Architecture:** A protected application layout establishes the authenticated user and admin-route authorization before rendering the Shell. Knowledge-base actions return explicit outcomes, and the API client supplies a scoped abort timeout for the connectivity request so the page can always render a terminal result.

**Tech Stack:** React 18, React Router 6, Vitest, Testing Library, MSW, Vite.

---

### Task 1: Establish route authentication and authorization

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/api/auth.js`
- Modify: `ui/V2_PROTOTYPE/src/App.jsx`
- Modify: `ui/V2_PROTOTYPE/src/components/Layout/Shell.jsx`
- Use: `ui/V2_PROTOTYPE/src/utils/adminAccess.js`
- Test: `ui/V2_PROTOTYPE/src/__tests__/AppAuthGuard.test.jsx`
- Test: `ui/V2_PROTOTYPE/src/__tests__/ShellUserMenu.test.jsx`

- [ ] **Step 1: Run the existing guard tests and record the failing assertions**

Run:

```bash
npm test --prefix ui/V2_PROTOTYPE -- --run src/__tests__/AppAuthGuard.test.jsx src/__tests__/ShellUserMenu.test.jsx
```

Expected: failures show protected routes still rendering without valid authentication and admin navigation remaining visible to a business user.

- [ ] **Step 2: Add JWT expiry validation**

Decode the JWT payload only when the token has three segments. If `exp * 1000 <= Date.now()`, clear both token stores and return `false`; retain the existing presence check for opaque compatibility tokens.

- [ ] **Step 3: Add the protected layout**

Use `Navigate`, `useLocation`, `useCurrentUser`, `isAdminOnlyPath`, and `isAdminUser` to produce exactly these outcomes:

```jsx
if (!authenticated) return <Navigate to="/login" replace state={{ from: location }} />
if (loading) return <div role="status">正在验证登录状态...</div>
if (error || !user) return <Navigate to="/login" replace state={{ from: location }} />
if (isAdminOnlyPath(location.pathname) && !isAdminUser(user)) {
  return <Navigate to="/" replace />
}
return <Shell currentUser={user}>{children}</Shell>
```

- [ ] **Step 4: Make Shell authorization-consistent**

Pass the verified user from `App`, hide the entire system navigation group for non-admin users, and implement logout with `clearToken()` plus SPA `navigate('/login', { replace: true })`.

- [ ] **Step 5: Re-run the guard tests**

Run:

```bash
npm test --prefix ui/V2_PROTOTYPE -- --run src/__tests__/AppAuthGuard.test.jsx src/__tests__/ShellUserMenu.test.jsx
```

Expected: both files pass.

### Task 2: Make knowledge-base actions truthful

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/hooks/useSystemManagement.js`
- Test: `ui/V2_PROTOTYPE/src/__tests__/useSystemManagement.test.js`

- [ ] **Step 1: Add failing action tests**

Add tests asserting:

```js
const saveResult = await result.current.actions.saveKbDraft()
expect(saveResult).toEqual({ success: false, error: '登录已过期，请重新登录' })
expect(window.alert).not.toHaveBeenCalled()

const testResult = await result.current.actions.testKbConnectivity()
expect(testResult).toMatchObject({
  ok: false,
  code: 'UNAUTHORIZED',
  error: '登录已过期，请重新登录',
})
```

Also make the PATCH handler return HTTP 500 and assert the success alert is not called.

- [ ] **Step 2: Run the action tests and confirm red**

Run:

```bash
npm test --prefix ui/V2_PROTOTYPE -- --run src/__tests__/useSystemManagement.test.js
```

Expected: the new disabled-state assertions fail because save currently reports success and test currently returns `null`.

- [ ] **Step 3: Implement explicit outcomes**

Return the unauthorized failure from both actions before any request. Keep the save alert after the awaited PATCH only. Preserve the existing `{ ok, error, status, code }` connectivity-result contract.

- [ ] **Step 4: Re-run the hook tests**

Run the command from Step 2.

Expected: all `useSystemManagement` tests pass.

### Task 3: Add a finite connectivity timeout

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/api/client.js`
- Modify: `ui/V2_PROTOTYPE/src/hooks/useSystemManagement.js`
- Test: `ui/V2_PROTOTYPE/src/__tests__/apiClient.test.js`

- [ ] **Step 1: Add a failing API timeout test**

Stub `fetch` with a promise that rejects with an `AbortError` after its signal is aborted, call:

```js
await expect(apiClient.post('/slow', {}, { timeoutMs: 10 }))
  .rejects.toThrow('请求超时，请稍后重试')
```

- [ ] **Step 2: Run the timeout test and confirm red**

Run:

```bash
npm test --prefix ui/V2_PROTOTYPE -- --run src/__tests__/apiClient.test.js
```

Expected: failure because the client does not yet forward an abort signal or create a timeout.

- [ ] **Step 3: Implement optional timeout**

Create an `AbortController` only when `timeoutMs > 0`, pass its signal to fetch, clear the timer in `finally`, and translate `AbortError` to `NetworkError('请求超时，请稍后重试')`.

- [ ] **Step 4: Scope timeout to connectivity testing**

Call:

```js
apiClient.post('/system/knowledge-base-config/test', body, { timeoutMs: 30000 })
```

- [ ] **Step 5: Re-run the timeout and hook tests**

Expected: both test files pass.

### Task 4: Render terminal save and test feedback

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx`
- Test: `ui/V2_PROTOTYPE/src/__tests__/SystemManagementKnowledgeBase.test.jsx`

- [ ] **Step 1: Add failing interaction tests**

Render the knowledge-base section, click save and test, then assert `保存中...` or `测试中...` appears immediately and a successful or failed status card appears after the mocked request settles.

- [ ] **Step 2: Run the page test and confirm red**

Run:

```bash
npm test --prefix ui/V2_PROTOTYPE -- --run src/__tests__/SystemManagementKnowledgeBase.test.jsx
```

Expected: save has no page-level result and a disabled action can finish without a result.

- [ ] **Step 3: Implement page feedback**

Await `saveKbDraft`, store its outcome, label the button `保存中...`, and render a compact result card. Always store the object returned by `testKbConnectivity`; do not condition rendering on a truthy non-null result.

- [ ] **Step 4: Re-run the page test**

Expected: the interaction test passes.

### Task 5: Verify and synchronize governance evidence

**Files:**
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/index.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/requirements.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/plan.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/testing.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/monitoring.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/risks.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/changes.html`

- [ ] **Step 1: Run focused and full frontend verification**

```bash
npm test --prefix ui/V2_PROTOTYPE -- --run src/__tests__/AppAuthGuard.test.jsx src/__tests__/ShellUserMenu.test.jsx src/__tests__/useSystemManagement.test.js src/__tests__/apiClient.test.js src/__tests__/SystemManagementKnowledgeBase.test.jsx
npm test --prefix ui/V2_PROTOTYPE -- --run
npm run build:web
npm run build:api
```

Expected: every command exits 0.

- [ ] **Step 2: Update board state using fresh evidence**

Move RP-036 only as far as the evidence supports. Record automated tests as passed, keep `MT-1H-C-002` awaiting browser retest until the actual login-expiry and real connectivity flow is verified, and remove the active blocker only after that manual evidence exists.

- [ ] **Step 3: Validate board integrity**

Run the board validation command defined by `skills/maintain-wes-command-board/SKILL.md` and confirm all seven core pages are present, HTML tags are balanced, and RP-036 references remain consistent.

