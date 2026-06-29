# WES Agent Phase 1H-A Workbench UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the Phase 1H-A AI Workbench UX closure batch by fixing session continuity, message scrolling, composer height, project creation refresh, and company lookup dialog feedback.

**Architecture:** Keep Phase 1G intent routing and Harness report flows intact. Implement this batch primarily in `ui/V2_PROTOTYPE`, using the existing `useAiSessions` hook, `AiHomeWorkbench.jsx`, `CompanyLookupDialog.jsx`, `ArtifactPanel`, and MSW/Vitest test patterns. Backend changes are avoided unless the current API response is missing data needed to refresh linked records.

**Tech Stack:** Vite 5, React 18.3, react-router-dom 6, Vitest + Testing Library + MSW, existing `apiClient`, existing Express `apps/api` contract.

---

## Scope

### Included Requirements

- `RP-017`: AI 工作台切换后会话丢失。
- `RP-014`: AI 工作台消息发送后自动滚动到底部。
- `RP-015`: AI 工作台消息发送框高度不可调节。
- `RP-016`: AI 工作台创建项目后关联记录与列表未刷新。
- `RP-011`: 检索主体弹窗化改造收尾。

### Excluded Requirements

- `RP-013` 通用化交互渲染。它需要后端 `formBlock` 协议和通用组件体系，排到 Phase 1H-B。
- `RP-001` 低代码 AI 工作流设计器。它是新产品能力，需要独立设计。
- `RP-012` WES Skill 工作流辅助工具。它涉及 Skill registry、审计链和行业数据源边界，需要独立方案。

## File Structure

- Modify `ui/V2_PROTOTYPE/src/hooks/useAiSessions.js`
  - Persist and restore active AI session ID with `localStorage`.
  - Return a visible `sessionsError` state and a `clearSessionsError` helper.
- Modify `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx`
  - Display session load errors.
  - Add message pane ref and bottom scroll effect.
  - Use controlled composer height and stable send/attach button layout.
  - Update linked records after project creation.
  - Wire `CompanyLookupDialog` states into existing company lookup flow.
- Modify `ui/V2_PROTOTYPE/src/components/AiWorkbench/CompanyLookupDialog.jsx`
  - Polish loading, empty, error, keyboard, and selected states without changing API shape.
- Modify `ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx`
  - Add tests for session restore, visible load error, auto-scroll, composer behavior, project refresh, and lookup dialog.
- Modify `ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js`
  - Add or adjust mock data for AI session reload, project creation, and company profile lookup.
- Modify docs only after implementation:
  - `03_技术设计/系统架构/WES-Agent-升级总看板/testing.html`
  - `03_技术设计/系统架构/WES-Agent-升级总看板/changes.html`

## Task 1: Session Continuity And Load Error

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/hooks/useAiSessions.js`
- Modify: `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx`
- Test: `ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx`

- [ ] **Step 1: Write failing tests**

Add two tests near the existing AI session tests:

```jsx
test('restores the last active AI session after the workbench remounts', async () => {
  const sessions = [
    {
      sessionId: 'session-last',
      title: '最近会话',
      domain: 'business_evaluation',
      workflowKey: 'free_chat',
      status: 'temporary_chat',
      messages: [
        { messageId: 'm1', role: 'user', content: '上一轮问题', createdAt: '2026-06-23T00:00:00.000Z' },
        { messageId: 'm2', role: 'assistant', content: '上一轮回答', createdAt: '2026-06-23T00:00:01.000Z' },
      ],
      attachments: [],
      artifacts: [],
      pendingActions: [],
      linkedRecords: {},
      updatedAt: '2026-06-23T00:00:01.000Z',
    },
    {
      sessionId: 'session-other',
      title: '其他会话',
      domain: 'business_evaluation',
      workflowKey: 'free_chat',
      status: 'temporary_chat',
      messages: [],
      attachments: [],
      artifacts: [],
      pendingActions: [],
      linkedRecords: {},
      updatedAt: '2026-06-22T00:00:00.000Z',
    },
  ]
  localStorage.setItem('wes-ai-active-session-id', 'session-last')
  server.use(http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({ success: true, data: { items: sessions } })))

  const { unmount } = render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)
  expect(await screen.findByText('上一轮回答')).toBeInTheDocument()

  unmount()
  render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)
  expect(await screen.findByText('上一轮回答')).toBeInTheDocument()
})

test('shows a visible error when AI sessions fail to load', async () => {
  server.use(http.get(`${BASE}/ai-sessions`, () => HttpResponse.json({ success: false, message: 'sessions failed' }, { status: 500 })))

  render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)

  expect(await screen.findByText(/AI 会话加载失败/)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- HomeWorkspace.test.jsx
```

Expected: first test fails because the hook always chooses `items[0]`; second test fails because `loadSessions().catch(() => {})` suppresses the error.

- [ ] **Step 3: Implement localStorage persistence**

Update `useAiSessions.js` with a stable key:

```js
const ACTIVE_SESSION_STORAGE_KEY = 'wes-ai-active-session-id'

function readStoredActiveSessionId() {
  try {
    return window.localStorage?.getItem(ACTIVE_SESSION_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

function writeStoredActiveSessionId(sessionId) {
  try {
    if (sessionId) window.localStorage?.setItem(ACTIVE_SESSION_STORAGE_KEY, sessionId)
    else window.localStorage?.removeItem(ACTIVE_SESSION_STORAGE_KEY)
  } catch {
    // Local storage is a convenience cache; failure must not block the workbench.
  }
}
```

Use that key in `upsertSession`, `loadSessions`, `deleteSession`, and exported `setActiveSession` wrapper:

```js
const [sessionsError, setSessionsError] = useState('')

const selectActiveSession = useCallback((session) => {
  writeStoredActiveSessionId(session?.sessionId || '')
  setActiveSession(session || null)
}, [])

const upsertSession = useCallback((session) => {
  if (!session?.sessionId) return
  setSessions((prev) => {
    const next = prev.filter((item) => item.sessionId !== session.sessionId)
    return [session, ...next]
  })
  selectActiveSession(session)
}, [selectActiveSession])
```

In `loadSessions`, restore by ID and expose errors:

```js
const loadSessions = useCallback(async (params = {}) => {
  setLoadingSessions(true)
  setSessionsError('')
  try {
    const payload = await apiClient.get('/ai-sessions', {
      domain: 'business_evaluation',
      ...params,
    }, { suppressUnauthorizedRedirect: true })
    const items = normalizeSessions(unwrap(payload))
    setSessions(items)
    setActiveSession((current) => {
      const storedId = readStoredActiveSessionId()
      const restored = items.find((item) => item.sessionId === storedId)
      const next = current && items.some((item) => item.sessionId === current.sessionId)
        ? current
        : (restored || items[0] || null)
      writeStoredActiveSessionId(next?.sessionId || '')
      return next
    })
    return items
  } catch (err) {
    const message = `AI 会话加载失败：${err.message || '请求失败'}`
    setSessionsError(message)
    throw err
  } finally {
    setLoadingSessions(false)
  }
}, [])
```

Return `sessionsError`, `clearSessionsError`, and `setActiveSession: selectActiveSession`.

- [ ] **Step 4: Show the error in AiHomeWorkbench**

Consume the new hook fields:

```js
const {
  sessions,
  activeSession,
  loadingSessions,
  sessionsError,
  clearSessionsError,
  loadSessions,
  createSession,
  deleteSession,
  upsertSession,
  setActiveSession,
} = useAiSessions()
```

Keep the effect catch to prevent an unhandled promise rejection:

```js
useEffect(() => {
  loadSessions().catch(() => {})
}, [loadSessions])
```

The behavioral change is in the hook: `loadSessions()` must set `sessionsError` before throwing. Render `sessionsError` near the header:

```jsx
{sessionsError && (
  <div role="alert" style={{ marginLeft: 'auto', color: 'var(--err)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
    <span>{sessionsError}</span>
    <button type="button" className="btn btn-out" style={{ height: 28 }} onClick={clearSessionsError}>关闭</button>
  </div>
)}
```

- [ ] **Step 5: Verify**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- HomeWorkspace.test.jsx
```

Expected: new tests pass; existing AI session tests still pass.

## Task 2: Message Auto-Scroll And Composer Height

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx`
- Test: `ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx`

- [ ] **Step 1: Write failing tests**

Add a scroll test and a composer sizing assertion:

```jsx
test('scrolls the AI message pane to bottom after sending and receiving messages', async () => {
  const scrollTo = vi.fn()
  Element.prototype.scrollTo = scrollTo
  render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)

  const input = await screen.findByRole('textbox')
  fireEvent.change(input, { target: { value: '请解释这个风险' } })
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }))

  expect(await screen.findByText('模型回复：请解释这个风险')).toBeInTheDocument()
  expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: expect.any(Number), behavior: 'smooth' }))
})

test('keeps composer controls visible for long text input', async () => {
  render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)

  const input = await screen.findByRole('textbox', { name: 'AI 工作台输入' })
  fireEvent.change(input, { target: { value: Array.from({ length: 12 }, (_, index) => `第 ${index + 1} 行需求说明`).join('\n') } })

  expect(input).toHaveStyle({ resize: 'vertical' })
  expect(screen.getByRole('button', { name: '发送消息' })).toBeVisible()
  expect(screen.getByRole('button', { name: /附加文件|替换附件/ })).toBeVisible()
})
```

- [ ] **Step 2: Implement message pane ref**

In `AiHomeWorkbench.jsx`, add:

```js
const messagePaneRef = useRef(null)

useLayoutEffect(() => {
  const pane = messagePaneRef.current
  if (!pane) return
  pane.scrollTo({ top: pane.scrollHeight, behavior: 'smooth' })
}, [messages.length, sending])
```

Attach it:

```jsx
<div
  ref={messagePaneRef}
  data-testid="ai-home-message-pane"
  style={{ flex: 1, minHeight: 0, padding: 18, overflowY: 'auto', background: 'linear-gradient(180deg,#fff,var(--bg-soft))' }}
>
```

- [ ] **Step 3: Stabilize composer dimensions**

Use controlled min/max values and preserve button sizing:

```jsx
<div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, minHeight: 54 }}>
  ...
  <textarea
    rows="3"
    aria-label="AI 工作台输入"
    value={composer}
    onChange={(event) => setComposer(event.target.value)}
    onKeyDown={handleComposerKeyDown}
    placeholder={preset.placeholder}
    style={{
      flex: 1,
      border: 0,
      outline: 'none',
      resize: 'vertical',
      minHeight: 54,
      maxHeight: 180,
      padding: '8px 4px',
      fontFamily: 'inherit',
      fontSize: 13,
      lineHeight: '18px',
      overflowY: 'auto',
    }}
  />
</div>
```

- [ ] **Step 4: Verify**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- HomeWorkspace.test.jsx
npm run build --prefix ui/V2_PROTOTYPE
```

Expected: tests and build pass.

## Task 3: Project Creation Refresh

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx`
- Modify only if needed: `ui/V2_PROTOTYPE/src/api/ai.js`
- Test: `ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx`
- Test data: `ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js`

- [ ] **Step 1: Write failing test**

Extend the existing `shows session rail and confirms project creation action` test:

```jsx
expect(await screen.findByText(/项目：XX制造 WMS 项目/)).toBeInTheDocument()
fireEvent.click(screen.getByRole('button', { name: '传统工作台' }))
expect(await screen.findByText('XX制造 WMS 项目')).toBeInTheDocument()
```

Make the MSW handler mutate the project list:

```js
const projectRecords = [...mockProjectEvaluations]
server.use(
  http.get(`${BASE}/project-evaluations`, () => HttpResponse.json({ success: true, data: { items: projectRecords } })),
  http.post(`${BASE}/project-evaluations`, async ({ request }) => {
    const body = await request.json()
    const project = {
      projectId: 'project-1',
      projectName: body.projectName,
      customerName: body.customerName,
      currentStage: 'project_discovery',
      status: 'draft',
      projectStatus: 'draft',
      ownerUsername: 'arch',
      participantUserIds: ['u3'],
      createdAt: '2026-06-23T00:00:00.000Z',
      updatedAt: '2026-06-23T00:00:00.000Z',
    }
    projectRecords.unshift(project)
    return HttpResponse.json({ success: true, data: { project } })
  })
)
```

- [ ] **Step 2: Update active session and notify same-window consumers**

After project creation succeeds, keep existing `upsertSession` and add a same-window event:

```js
const nextSession = {
  ...activeSession,
  pendingActions: (activeSession.pendingActions || []).map((item) => (
    item.actionId === action.actionId ? { ...item, status: 'executed', result: { projectId: project.projectId } } : item
  )),
  linkedRecords: {
    ...(activeSession.linkedRecords || {}),
    projectId: project.projectId,
    projectName: project.projectName,
  },
  updatedAt: new Date().toISOString(),
}
upsertSession(nextSession)
window.dispatchEvent(new CustomEvent('wes-project-evaluation-created', { detail: { project } }))
```

If the project list does not listen to this event, add the smallest local listener in the project list component that already owns `loadProjectEvaluations`. Do not create a global state library for this batch.

- [ ] **Step 3: Render a visible success message**

Add a confirmation assistant message after `upsertSession`:

```js
setMessages((prev) => [...prev, {
  id: `project-created-${Date.now()}`,
  role: 'assistant',
  text: `项目已创建并关联：${project.projectName || project.projectId}`,
}])
```

- [ ] **Step 4: Verify**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- HomeWorkspace.test.jsx
```

Expected: project creation test passes and existing list tests remain stable.

## Task 4: Company Lookup Dialog Closure

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/components/AiWorkbench/CompanyLookupDialog.jsx`
- Modify: `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx`
- Test: `ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx`
- Test data: `ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js`

- [ ] **Step 1: Write failing tests**

Add a test that triggers company lookup and selects a candidate:

```jsx
test('opens company lookup dialog and writes selected candidate back to the workbench', async () => {
  server.use(http.post(`${BASE}/ai/company-profile-summary`, () => HttpResponse.json({
    success: true,
    data: {
      candidates: [
        { displayName: '蓝海制造有限公司', industry: '制造业', location: '深圳', summary: '离散制造客户' },
      ],
      summary: '蓝海制造有限公司：离散制造客户',
    },
  })))

  render(<MemoryRouter><HomeWorkspace /></MemoryRouter>)

  fireEvent.click(await screen.findByRole('button', { name: /检索客户主体/ }))
  expect(await screen.findByRole('dialog', { name: '检索客户主体' })).toBeInTheDocument()
  expect(screen.getByText('蓝海制造有限公司')).toBeInTheDocument()

  fireEvent.click(screen.getByText('蓝海制造有限公司'))
  expect(await screen.findByText(/已选择客户主体：蓝海制造有限公司/)).toBeInTheDocument()
})
```

- [ ] **Step 2: Keep the dialog accessible and stable**

Update `CompanyLookupDialog.jsx` so it uses text glyphs already used in the app, avoids emoji-only error states, and keeps close behavior predictable:

```jsx
<button
  type="button"
  onClick={onClose}
  disabled={loading}
  aria-label="关闭检索主体弹窗"
  title="关闭"
  ...
>
  ×
</button>
```

For error state:

```jsx
<span style={{ color: 'var(--err)', fontSize: 13, textAlign: 'center' }}>{error}</span>
```

Do not use a blank or invisible icon.

- [ ] **Step 3: Wire selection in AiHomeWorkbench**

When a candidate is selected, close the dialog and append a visible assistant message:

```js
function handleCompanySelect(candidate) {
  const displayName = candidate.displayName || candidate.customerName || candidate.name || candidate.title || '候选主体'
  setCompanyLookupOpen(false)
  setMessages((prev) => [...prev, {
    id: `company-selected-${Date.now()}`,
    role: 'assistant',
    text: `已选择客户主体：${displayName}`,
  }])
}
```

Use the exact state names already present in `AiHomeWorkbench.jsx` if they differ.

- [ ] **Step 4: Verify**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- HomeWorkspace.test.jsx
```

Expected: lookup dialog test passes.

## Task 5: Final Regression And Board Status

**Files:**
- Modify after implementation: `03_技术设计/系统架构/WES-Agent-升级总看板/testing.html`
- Modify after implementation: `03_技术设计/系统架构/WES-Agent-升级总看板/changes.html`
- Modify only if status changes: `03_技术设计/系统架构/WES-Agent-升级总看板/requirements.html`
- Modify only if status changes: `03_技术设计/系统架构/WES-Agent-升级总看板/requirements-editor.html`

- [ ] **Step 1: Run frontend verification**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE
npm run build --prefix ui/V2_PROTOTYPE
```

Expected: all frontend tests pass and Vite build completes. Keep any existing chunk-size warning as warning only.

- [ ] **Step 2: Run backend verification if API contract was touched**

Run this only if `src/api/ai.js` semantics or backend response contract changed:

```bash
npm run test:modules -w apps/api
npm run build -w apps/api
```

Expected: modules tests pass and API build completes.

- [ ] **Step 3: Update board statuses**

If all implementation and verification steps pass, update:

- `requirements.html`: `RP-011`, `RP-014`, `RP-015`, `RP-016`, `RP-017` from `已排期` / `实施中` to implementation-complete status only if code is actually complete.
- `requirements-editor.html`: keep seed aligned with `requirements.html`.
- `testing.html`: keep `MT-1H-A-*` as `待执行` until a human manually tests in browser.
- `changes.html`: add implementation evidence and command results.

- [ ] **Step 4: Commit**

Use focused staging and a Chinese commit message:

```bash
git add ui/V2_PROTOTYPE/src/hooks/useAiSessions.js \
  ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx \
  ui/V2_PROTOTYPE/src/components/AiWorkbench/CompanyLookupDialog.jsx \
  ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx \
  ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js \
  03_技术设计/系统架构/WES-Agent-升级总看板/requirements.html \
  03_技术设计/系统架构/WES-Agent-升级总看板/requirements-editor.html \
  03_技术设计/系统架构/WES-Agent-升级总看板/testing.html \
  03_技术设计/系统架构/WES-Agent-升级总看板/changes.html
git commit -m "fix(WES Phase 1H-A): 闭合 AI 工作台高频体验断点"
```

Expected: commit succeeds after verifying there are no unrelated files staged.

## Self-Review

- Spec coverage: The five included RP items map to Tasks 1-4 and verification maps to Task 5.
- Placeholder scan: No unresolved placeholders or open-ended implementation notes remain; conditional backend verification is explicitly tied to API contract changes.
- Type consistency: The plan uses existing `sessionId`, `messages`, `linkedRecords`, `pendingActions`, `projectId`, and `projectName` fields observed in the current code.
