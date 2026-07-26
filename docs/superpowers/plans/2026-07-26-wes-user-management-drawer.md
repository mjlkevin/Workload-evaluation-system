# WES User Management Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `/users` 重构为“页面动作、筛选、批量操作、单用户侧栏编辑”分层清晰且真实持久化的用户管理工作区。

**Architecture:** 新增无第三方依赖的共享 `Drawer` primitive；把用户 API 收口到 `src/api/users.js`；由 `UserManagement.jsx` 负责列表、筛选、选择、保存编排和共享 Dialog 状态，由 `UserEditorDrawer.jsx` 负责单用户草稿表单。所有写操作使用既有 JWT API，失败后重新读取服务器事实，不把多个 PATCH 伪装成原子事务。

**Tech Stack:** Vite 5、React 18.3、React Testing Library、Vitest、MSW、现有 CSS Token、现有 `apiClient`、共享 `Dialog`。

---

## Scope and workspace guard

设计事实源：

- `docs/superpowers/specs/2026-07-25-wes-user-management-drawer-design.md`
- `skills/improving-wes-ui/SKILL.md`
- `ISS-2026-07-25-003 / RP-043`

执行目录固定为 `/Users/kevin/AI/Workload-evaluation-system`。当前工作树存在大量用户未提交修改，所有提交必须精确列出本任务文件，禁止 `git add .`、清理、还原或格式化无关文件。

执行前运行：

```bash
pwd
git status --short --branch
git worktree list --porcelain
git diff -- ui/V2_PROTOTYPE/src/pages/UserManagement.jsx
```

预期：

- 路径为 `/Users/kevin/AI/Workload-evaluation-system`
- 分支为 `codex/role-driven-ai-home-workbench`
- `UserManagement.jsx` 没有未识别的用户修改；如果有，停止并先解决重叠
- 不创建第二套前端或新 UI 依赖

基线验证：

```bash
npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/UserManagement.test.jsx
npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/Dialog.test.jsx
npm run build:web
```

预期：

- 现有 UserManagement 4 项测试通过
- Dialog 5 项测试通过
- Web 构建通过，只允许既有 chunk-size warning

## File map

**Create**

- `ui/V2_PROTOTYPE/src/components/ui/Drawer.jsx` — 可访问右侧 modal sheet primitive
- `ui/V2_PROTOTYPE/src/components/UserManagement/UserEditorDrawer.jsx` — 单用户草稿表单与安全操作入口
- `ui/V2_PROTOTYPE/src/api/users.js` — 用户列表、角色、业务角色、状态、密码和邀请 API
- `ui/V2_PROTOTYPE/src/__tests__/Drawer.test.jsx` — Drawer 语义、焦点和关闭契约
- `docs/superpowers/evaluations/2026-07-26-user-management-drawer-qa.md` — 浏览器验收记录
- `03_技术设计/系统架构/WES-Agent-升级总看板/events/2026-07-26-user-management-drawer-implementation.json` — 本批结构化过程事件

**Modify**

- `ui/V2_PROTOTYPE/src/pages/UserManagement.jsx` — 页面分层、侧栏编排、真实保存、批量操作、邀请和共享 Dialog
- `ui/V2_PROTOTYPE/src/hooks/useUsers.js` — API 收口并暴露可等待的 `reload()`
- `ui/V2_PROTOTYPE/src/__tests__/UserManagement.test.jsx` — 页面 RED/GREEN 回归
- `ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js` — 用户写接口和邀请默认 handler
- `ui/V2_PROTOTYPE/tokens.css` — 增加语义化 Drawer/Dialog layer tokens
- `ui/V2_PROTOTYPE/components.css` — Drawer 和用户管理共享 class
- `docs/openapi.yaml` — 补齐既有业务角色与管理员重置密码接口
- `docs/superpowers/specs/2026-07-25-wes-user-management-drawer-design.md` — 已完成的 `expiresAt` 事实校正
- 总看板受事件影响页面 — 只通过已校验的 board event 精确应用

### Task 1: Shared accessible Drawer primitive

**Files:**

- Create: `ui/V2_PROTOTYPE/src/components/ui/Drawer.jsx`
- Create: `ui/V2_PROTOTYPE/src/__tests__/Drawer.test.jsx`
- Modify: `ui/V2_PROTOTYPE/tokens.css:1-70`
- Modify: `ui/V2_PROTOTYPE/components.css:69-91`

- [ ] **Step 1: Write the failing Drawer tests**

Create `ui/V2_PROTOTYPE/src/__tests__/Drawer.test.jsx`:

```jsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef, useState } from 'react'
import { describe, expect, test } from 'vitest'
import { Drawer } from '../components/ui/Drawer.jsx'

function DrawerHarness({ closeOnBackdrop = true }) {
  const [open, setOpen] = useState(false)
  const firstFieldRef = useRef(null)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>编辑 arch</button>
      <Drawer
        open={open}
        title="编辑用户"
        description="arch"
        closeOnBackdrop={closeOnBackdrop}
        initialFocusRef={firstFieldRef}
        footer={<button type="button">保存变更</button>}
        onClose={() => setOpen(false)}
      >
        <label>
          系统角色
          <select ref={firstFieldRef} defaultValue="user">
            <option value="user">普通用户</option>
          </select>
        </label>
        <button type="button">重置密码</button>
      </Drawer>
    </>
  )
}

describe('Drawer', () => {
  test('associates title and description and focuses the requested field', async () => {
    render(<DrawerHarness />)
    fireEvent.click(screen.getByRole('button', { name: '编辑 arch' }))
    const drawer = screen.getByRole('dialog', { name: '编辑用户' })
    expect(drawer).toHaveAttribute('aria-modal', 'true')
    expect(document.getElementById(drawer.getAttribute('aria-describedby'))).toHaveTextContent('arch')
    expect(screen.getByRole('button', { name: '关闭编辑用户' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('系统角色')).toHaveFocus())
  })

  test('closes on Escape and restores focus to the opener', async () => {
    render(<DrawerHarness />)
    const opener = screen.getByRole('button', { name: '编辑 arch' })
    fireEvent.click(opener)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })

  test('honors backdrop policy and traps Tab', () => {
    const { rerender } = render(<DrawerHarness closeOnBackdrop={false} />)
    fireEvent.click(screen.getByRole('button', { name: '编辑 arch' }))
    const drawer = screen.getByRole('dialog')
    fireEvent.click(drawer.parentElement)
    expect(drawer).toBeInTheDocument()

    const first = screen.getByRole('button', { name: '关闭编辑用户' })
    const last = screen.getByRole('button', { name: '保存变更' })
    last.focus()
    fireEvent.keyDown(drawer, { key: 'Tab' })
    expect(first).toHaveFocus()
    first.focus()
    fireEvent.keyDown(drawer, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()

    rerender(<DrawerHarness closeOnBackdrop />)
    fireEvent.click(screen.getByRole('dialog').parentElement)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests and observe RED**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/Drawer.test.jsx
```

Expected: FAIL because `../components/ui/Drawer.jsx` does not exist.

- [ ] **Step 3: Implement the minimal Drawer**

Create `ui/V2_PROTOTYPE/src/components/ui/Drawer.jsx` with:

```jsx
import { useEffect, useId, useRef } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function getFocusableElements(container) {
  return [...container.querySelectorAll(FOCUSABLE_SELECTOR)]
    .filter((element) => !element.hasAttribute('hidden'))
}

export function Drawer({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  closeOnBackdrop = true,
  initialFocusRef,
}) {
  const titleId = useId()
  const descriptionId = useId()
  const surfaceRef = useRef(null)
  const openerRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    openerRef.current = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const surface = surfaceRef.current
    const focusTarget = initialFocusRef?.current
      || getFocusableElements(surface)[0]
      || surface
    focusTarget?.focus()

    return () => {
      document.body.style.overflow = previousOverflow
      if (openerRef.current?.isConnected) openerRef.current.focus()
    }
  }, [initialFocusRef, open])

  if (!open) return null

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose?.()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = getFocusableElements(surfaceRef.current)
    if (focusable.length === 0) {
      event.preventDefault()
      surfaceRef.current?.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    } else if (!surfaceRef.current?.contains(document.activeElement)) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className="wes-drawer-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && closeOnBackdrop) onClose?.()
      }}
    >
      <aside
        ref={surfaceRef}
        className="wes-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <header className="wes-drawer__header">
          <div className="wes-drawer__heading">
            <h2 className="wes-drawer__title" id={titleId}>{title}</h2>
            {description ? (
              <p className="wes-drawer__description" id={descriptionId} title={description}>
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="wes-drawer__close"
            aria-label={`关闭${title}`}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="wes-drawer__body">{children}</div>
        {footer ? <footer className="wes-drawer__footer">{footer}</footer> : null}
      </aside>
    </div>
  )
}
```

Add this semantic layer token beside the other layout/control tokens in
`ui/V2_PROTOTYPE/tokens.css`:

```css
--layer-drawer: 50;
--layer-modal: 60;
```

Add `z-index:var(--layer-modal)` to the existing `.wes-dialog-backdrop` rule so
the non-native fallback also stays above the Drawer. Then append these rules
after the existing Dialog rules:

```css
.wes-drawer-backdrop{position:fixed;inset:0;z-index:var(--layer-drawer);display:flex;justify-content:flex-end;background:color-mix(in oklch,var(--ink) 26%,transparent)}
.wes-drawer{width:min(440px,100vw);height:100dvh;display:flex;flex-direction:column;border:0;border-left:1px solid var(--line);background:var(--surface);color:var(--ink);box-shadow:var(--shadow-3)}
.wes-drawer__header{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--space-4);padding:var(--space-5) var(--space-6);border-bottom:1px solid var(--line)}
.wes-drawer__heading{min-width:0}
.wes-drawer__title{margin:0;font-size:18px;line-height:1.35}
.wes-drawer__description{margin:var(--space-2) 0 0;overflow:hidden;color:var(--ink-2);font-size:12px;line-height:1.5;text-overflow:ellipsis;white-space:nowrap}
.wes-drawer__close{display:grid;place-items:center;flex:0 0 auto;width:var(--control-height);height:var(--control-height);margin:calc(var(--space-2) * -1);border:0;border-radius:var(--r-md);background:transparent;color:var(--ink-2);font:inherit;font-size:22px;cursor:pointer}
.wes-drawer__close:hover{background:var(--bg-soft);color:var(--ink)}
.wes-drawer__close:focus-visible{outline:none;box-shadow:var(--shadow-focus)}
.wes-drawer__body{min-height:0;flex:1;padding:var(--space-6);overflow:auto}
.wes-drawer__footer{display:flex;justify-content:flex-end;gap:var(--space-3);padding:var(--space-4) var(--space-6);border-top:1px solid var(--line);background:var(--bg-soft)}
@media (max-width:760px){
  .wes-drawer{width:100vw;border-left:0}
  .wes-drawer__header,.wes-drawer__body{padding:var(--space-5)}
  .wes-drawer__footer{padding:var(--space-4) var(--space-5)}
}
```

- [ ] **Step 4: Run GREEN and the UI scope checker**

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/Drawer.test.jsx
node skills/improving-wes-ui/scripts/check-ui-scope.mjs --base 13eecc2 -- \
  ui/V2_PROTOTYPE/src/components/ui/Drawer.jsx \
  ui/V2_PROTOTYPE/tokens.css \
  ui/V2_PROTOTYPE/components.css
```

Expected: Drawer tests PASS; scope checker reports no new UI dependency, numeric `z-index`, raw color, or duplicate page Dialog primitive.

- [ ] **Step 5: Commit Task 1**

```bash
git add -- \
  ui/V2_PROTOTYPE/src/components/ui/Drawer.jsx \
  ui/V2_PROTOTYPE/src/__tests__/Drawer.test.jsx \
  ui/V2_PROTOTYPE/tokens.css \
  ui/V2_PROTOTYPE/components.css
git commit -m "feat(WES UI): RP-043 · 新增可访问用户侧栏基础组件"
```

### Task 2: Page action hierarchy, real filters, and row edit entry

**Files:**

- Create: `ui/V2_PROTOTYPE/src/components/UserManagement/UserEditorDrawer.jsx`
- Modify: `ui/V2_PROTOTYPE/src/pages/UserManagement.jsx:21-480`
- Modify: `ui/V2_PROTOTYPE/src/__tests__/UserManagement.test.jsx`
- Modify: `ui/V2_PROTOTYPE/components.css`

- [ ] **Step 1: Add failing layout and interaction tests**

Append these tests to `UserManagement.test.jsx`:

```jsx
test('separates page actions, filters, bulk actions, and row editing', async () => {
  render(<MemoryRouter><UserManagement /></MemoryRouter>)
  await screen.findByRole('heading', { name: '用户管理' })

  expect(screen.queryByText(/已选 0/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '编辑 arch' }))
  expect(screen.getByRole('dialog', { name: '编辑用户' })).toHaveTextContent('arch')
  expect(screen.queryByText(/已选 1/)).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: '关闭编辑用户' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 arch' }))
  expect(screen.getByText('已选 1 人')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '清除选择' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '重置密码' })).not.toBeInTheDocument()
})

test('combines role, status, and text filters and clears hidden selections', async () => {
  render(<MemoryRouter><UserManagement /></MemoryRouter>)
  await screen.findByText('arch')

  fireEvent.click(screen.getByRole('checkbox', { name: '选择 arch' }))
  fireEvent.change(screen.getByLabelText('系统角色'), { target: { value: 'sub_admin' } })
  expect(screen.queryByText('arch')).not.toBeInTheDocument()
  expect(screen.getByText('pm')).toBeInTheDocument()
  expect(screen.queryByText(/已选 1/)).not.toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'disabled' } })
  expect(screen.queryByText('pm')).not.toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('系统角色'), { target: { value: 'all' } })
  fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'all' } })
  fireEvent.change(screen.getByPlaceholderText('搜索用户名 / 邮箱'), { target: { value: 'arch@wes.local' } })
  expect(screen.getByText('arch')).toBeInTheDocument()
  expect(screen.queryByText('pm')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run RED**

```bash
npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/UserManagement.test.jsx -t "separates|combines"
```

Expected: FAIL because filters are decorative, bulk actions are always present, and row Edit has no accessible action.

- [ ] **Step 3: Create the presentational editor component**

Create `UserEditorDrawer.jsx` with this public interface:

```jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { Drawer } from '../ui/Drawer.jsx'
import { BUSINESS_ROLES, businessRoleLabel } from '../../hooks/useUsers.js'

const SYSTEM_ROLES = [
  { key: 'admin', label: '超级管理员' },
  { key: 'sub_admin', label: '管理员' },
  { key: 'user', label: '普通用户' },
]

export default function UserEditorDrawer({
  open,
  user,
  saving,
  message,
  onRequestClose,
  onSave,
  onResetPassword,
}) {
  const roleRef = useRef(null)
  const [draft, setDraft] = useState(null)

  useEffect(() => {
    if (!open || !user) return
    setDraft({
      role: user.role,
      businessRole: user.businessRole,
      status: user.status,
    })
  }, [open, user])

  const dirty = useMemo(() => Boolean(user && draft && (
    draft.role !== user.role
    || draft.businessRole !== user.businessRole
    || draft.status !== user.status
  )), [draft, user])

  if (!user || !draft) return null

  return (
    <Drawer
      open={open}
      title="编辑用户"
      description={user.username}
      initialFocusRef={roleRef}
      closeOnBackdrop
      onClose={() => onRequestClose({ dirty })}
      footer={(
        <>
          <button type="button" className="btn btn-out" onClick={() => onRequestClose({ dirty })}>取消</button>
          {onSave ? (
            <button type="button" className="btn btn-pri" disabled={!dirty || saving} onClick={() => onSave({ original: user, draft })}>
              {saving ? '保存中…' : '保存变更'}
            </button>
          ) : null}
        </>
      )}
    >
      <section className="user-editor__summary">
        <strong>账户信息</strong>
        <span>{user.email}</span>
        <span>最后登录：{user.lastLoginAt || '—'}</span>
      </section>
      <div className="user-editor__fields">
        <label>
          系统角色
          <select ref={roleRef} disabled={!onSave} value={draft.role} onChange={(event) => setDraft((value) => ({ ...value, role: event.target.value }))}>
            {SYSTEM_ROLES.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
          </select>
        </label>
        <label>
          业务角色
          <select disabled={!onSave} value={draft.businessRole} onChange={(event) => setDraft((value) => ({ ...value, businessRole: event.target.value }))}>
            {BUSINESS_ROLES.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
          </select>
        </label>
        <label>
          账户状态
          <select disabled={!onSave} value={draft.status} onChange={(event) => setDraft((value) => ({ ...value, status: event.target.value }))}>
            <option value="active">正常</option>
            <option value="disabled">已禁用</option>
          </select>
        </label>
      </div>
      {onResetPassword ? (
        <section className="user-editor__safety">
          <strong>安全操作</strong>
          <button type="button" className="btn btn-out" onClick={() => onResetPassword(user)}>重置密码…</button>
        </section>
      ) : null}
      {message ? <div role="status" className={`user-editor__message ${message.kind}`}>{message.text}</div> : null}
    </Drawer>
  )
}
```

- [ ] **Step 4: Rebuild `UserManagement` information hierarchy**

In `UserManagement.jsx`:

```jsx
const [roleFilter, setRoleFilter] = useState('all')
const [statusFilter, setStatusFilter] = useState('all')
const [editingUserId, setEditingUserId] = useState(null)

const filtered = useMemo(() => {
  const q = search.trim().toLowerCase()
  return users.filter((user) => {
    if (roleFilter !== 'all' && user.role !== roleFilter) return false
    if (statusFilter !== 'all' && user.status !== statusFilter) return false
    return !q
      || user.username.toLowerCase().includes(q)
      || (user.email || '').toLowerCase().includes(q)
  })
}, [roleFilter, search, statusFilter, users])

useEffect(() => {
  const visible = new Set(filtered.map((user) => user.id))
  setSelected((current) => new Set([...current].filter((id) => visible.has(id))))
}, [filtered])

const editingUser = users.find((user) => user.id === editingUserId) || null
```

Keep the page-action slot empty at this checkpoint so Task 2 does not introduce
a silent control. Task 5 adds the invite action together with its real API
behavior:

```jsx
<PageShell
  crumb="工作台 / 用户管理"
  title="用户管理"
  subtitle="用户、角色与状态管理"
  actions={[]}
>
```

Replace decorative filter pills with labeled selects and the existing search:

```jsx
<div className="user-management__filters">
  <label>
    系统角色
    <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
      <option value="all">全部</option>
      <option value="admin">超级管理员</option>
      <option value="sub_admin">管理员</option>
      <option value="user">普通用户</option>
    </select>
  </label>
  <label>
    状态
    <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
      <option value="all">全部</option>
      <option value="active">正常</option>
      <option value="disabled">已禁用</option>
    </select>
  </label>
  <input
    type="search"
    placeholder="搜索用户名 / 邮箱"
    value={search}
    onChange={(event) => setSearch(event.target.value)}
  />
</div>
```

Only render the selection bar when `selCount > 0`, and add accessible row controls:

```jsx
{selCount > 0 ? (
  <div className="user-management__selection" role="region" aria-label="批量操作">
    <strong>已选 {selCount} 人</strong>
    <button type="button" className="btn btn-ghost" onClick={clearSelection}>清除选择</button>
    {/* 批量启用、禁用、系统角色、业务角色 buttons */}
  </div>
) : null}

<input
  type="checkbox"
  aria-label={`选择 ${u.username}`}
  checked={isSel}
  onChange={() => toggleOne(u.id)}
/>

<button
  type="button"
  className="btn btn-ghost"
  aria-label={`编辑 ${u.username}`}
  onClick={(event) => {
    event.stopPropagation()
    setEditingUserId(u.id)
  }}
>
  编辑
</button>
```

Mount `UserEditorDrawer` with `onRequestClose={() => setEditingUserId(null)}` only. Because `onSave` and `onResetPassword` are absent, this Task 2 checkpoint is intentionally read-only; Task 3 adds the real save contract and Task 4 adds password/reset safety paths. Do not pass an empty callback.

- [ ] **Step 5: Add shared classes and run GREEN**

Add `.user-management__filters`, `.user-management__selection`, `.user-editor__summary`, `.user-editor__fields`, `.user-editor__safety`, and `.user-editor__message` to `components.css`, using only existing tokens.

Run:

```bash
npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/UserManagement.test.jsx -t "separates|combines"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add -- \
  ui/V2_PROTOTYPE/src/components/UserManagement/UserEditorDrawer.jsx \
  ui/V2_PROTOTYPE/src/pages/UserManagement.jsx \
  ui/V2_PROTOTYPE/src/__tests__/UserManagement.test.jsx \
  ui/V2_PROTOTYPE/components.css
git commit -m "feat(WES UI): RP-043 · 重排用户管理任务层级与侧栏入口"
```

### Task 3: User API boundary, reload, and persisted single-user save

**Files:**

- Create: `ui/V2_PROTOTYPE/src/api/users.js`
- Modify: `ui/V2_PROTOTYPE/src/hooks/useUsers.js`
- Modify: `ui/V2_PROTOTYPE/src/pages/UserManagement.jsx`
- Modify: `ui/V2_PROTOTYPE/src/__tests__/UserManagement.test.jsx`
- Modify: `ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js`

- [ ] **Step 1: Write failing save-order and failure-reload tests**

Add:

```jsx
test('persists changed user fields in business-role then role order', async () => {
  const calls = []
  server.use(
    http.patch(`${BASE}/auth/users/:userId/business-role`, async ({ request }) => {
      calls.push(['businessRole', await request.json()])
      return HttpResponse.json({ code: 0, message: 'ok', data: { user: { id: 'u3' } } })
    }),
    http.patch(`${BASE}/auth/users/:userId/role`, async ({ request }) => {
      calls.push(['role', await request.json()])
      return HttpResponse.json({ code: 0, message: 'ok', data: { user: { id: 'u3' } } })
    }),
  )
  render(<MemoryRouter><UserManagement /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: '编辑 arch' }))
  fireEvent.change(screen.getByLabelText('系统角色'), { target: { value: 'sub_admin' } })
  fireEvent.change(screen.getByLabelText('业务角色'), { target: { value: 'pm' } })
  fireEvent.click(screen.getByRole('button', { name: '保存变更' }))

  await waitFor(() => expect(calls).toEqual([
    ['businessRole', { businessRole: 'pm' }],
    ['role', { role: 'sub_admin' }],
  ]))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑用户' })).not.toBeInTheDocument())
})

test('stops after a failed patch, reloads users, and keeps the editor open', async () => {
  let listCount = 0
  server.use(
    http.get(`${BASE}/auth/users`, () => {
      listCount += 1
      return HttpResponse.json({ code: 0, message: 'ok', data: { users: [
        { id: 'u3', username: 'arch', email: 'arch@wes.local', role: 'user', businessRole: 'pre_sales', status: 'active' },
      ] } })
    }),
    http.patch(`${BASE}/auth/users/:userId/business-role`, () => HttpResponse.json(
      { code: 50001, message: '保存失败' },
      { status: 500 },
    )),
  )
  render(<MemoryRouter><UserManagement /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: '编辑 arch' }))
  fireEvent.change(screen.getByLabelText('业务角色'), { target: { value: 'pm' } })
  fireEvent.click(screen.getByRole('button', { name: '保存变更' }))

  await screen.findByText(/业务角色保存失败/)
  expect(screen.getByRole('dialog', { name: '编辑用户' })).toBeInTheDocument()
  expect(listCount).toBeGreaterThanOrEqual(2)
})
```

- [ ] **Step 2: Run RED**

```bash
npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/UserManagement.test.jsx -t "persists changed|stops after"
```

Expected: FAIL because the page still mutates local memory and has no reloadable API boundary.

- [ ] **Step 3: Create `src/api/users.js`**

```js
import { apiClient } from './client.js'
import { unwrap, unwrapUsers } from './utils.js'

export async function listUsers() {
  return unwrapUsers(await apiClient.get('/auth/users'))
}

export async function updateUserRole(userId, role) {
  return unwrap(await apiClient.patch(`/auth/users/${userId}/role`, { role }), 'user')
}

export async function updateUserBusinessRole(userId, businessRole) {
  return unwrap(await apiClient.patch(`/auth/users/${userId}/business-role`, { businessRole }), 'user')
}

export async function updateUserStatus(userId, status) {
  return unwrap(await apiClient.patch(`/auth/users/${userId}/status`, { status }), 'user')
}

export async function resetUserPassword(userId, password) {
  return unwrap(await apiClient.patch(`/auth/users/${userId}/password`, { password }), 'user')
}

export async function generateInviteCode() {
  return unwrap(await apiClient.post('/auth/invite-codes/generate'), 'code')
}
```

Add default MSW handlers beside the existing business-role and password
handlers so focused tests do not depend on unhandled network calls:

```js
http.patch(`${BASE}/auth/users/:userId/role`, async ({ params, request }) => {
  const body = await request.json()
  return HttpResponse.json({
    code: 0,
    message: 'ok',
    data: { user: { id: params.userId, role: body.role } },
  })
}),
http.patch(`${BASE}/auth/users/:userId/status`, async ({ params, request }) => {
  const body = await request.json()
  return HttpResponse.json({
    code: 0,
    message: 'ok',
    data: { user: { id: params.userId, status: body.status } },
  })
}),
```

- [ ] **Step 4: Make `useUsers.reload()` awaitable**

Replace direct `apiClient.get` usage with `listUsers()` and return:

```js
const requestIdRef = useRef(0)

const reload = useCallback(async () => {
  if (!enabled) {
    setUsers([])
    setLoading(false)
    return []
  }
  const requestId = ++requestIdRef.current
  setLoading(true)
  setError(null)
  try {
    const rows = await listUsers()
    const mapped = rows.map(mapUserToVM)
    if (requestId === requestIdRef.current) setUsers(mapped)
    return mapped
  } catch (err) {
    if (requestId === requestIdRef.current) {
      setError(err)
      setUsers([])
    }
    throw err
  } finally {
    if (requestId === requestIdRef.current) setLoading(false)
  }
}, [enabled])

useEffect(() => {
  void reload().catch(() => {})
  return () => { requestIdRef.current += 1 }
}, [reload])

return { users, loading, error, reload }
```

Import `useCallback` and `useRef`; remove the page’s direct user API imports.

- [ ] **Step 5: Implement sequential save**

In `UserManagement.jsx`, import only the named user API functions from
`../api/users.js`:

```jsx
import {
  generateInviteCode,
  resetUserPassword,
  updateUserBusinessRole,
  updateUserRole,
  updateUserStatus,
} from '../api/users.js'
```

`generateInviteCode` and `resetUserPassword` are wired in Tasks 4–5. Add the
save state and orchestration:

```jsx
const { users: loadedUsers, reload } = useUsers({ fallbackData: INITIAL_USERS })
const [savingUser, setSavingUser] = useState(false)
const [editorMessage, setEditorMessage] = useState(null)
const [pendingSave, setPendingSave] = useState(null)
const [pageNotice, setPageNotice] = useState(null)

function collectUserChanges(original, draft) {
  return {
    ...(draft.businessRole !== original.businessRole ? { businessRole: draft.businessRole } : {}),
    ...(draft.role !== original.role ? { role: draft.role } : {}),
    ...(draft.status !== original.status ? { status: draft.status } : {}),
  }
}

function needsRiskConfirmation(original, changes) {
  return (
    (original.role === 'admin' && changes.role && changes.role !== 'admin')
    || (original.status === 'active' && changes.status === 'disabled')
  )
}

async function persistUserChanges(userId, changes) {
  const fieldLabels = {
    businessRole: '业务角色',
    role: '系统角色',
    status: '账户状态',
  }
  const steps = [
    ['businessRole', changes.businessRole, () => updateUserBusinessRole(userId, changes.businessRole)],
    ['role', changes.role, () => updateUserRole(userId, changes.role)],
    ['status', changes.status, () => updateUserStatus(userId, changes.status)],
  ].filter(([, value]) => value !== undefined)

  const applied = []
  for (const [field, , run] of steps) {
    try {
      await run()
      applied.push(fieldLabels[field])
    } catch (error) {
      await reload().catch(() => {})
      setEditorMessage({
        kind: 'error',
        text: `${fieldLabels[field]}保存失败${applied.length ? `；已保存：${applied.join('、')}` : ''}。${error.message}`,
      })
      return false
    }
  }
  try {
    await reload()
    return true
  } catch (error) {
    setEditorMessage({
      kind: 'error',
      text: `变更已提交，但重新读取服务器数据失败。${error.message}`,
    })
    return false
  }
}

async function performSave({ original, draft }) {
  const changes = collectUserChanges(original, draft)
  setSavingUser(true)
  setEditorMessage(null)
  try {
    const saved = await persistUserChanges(original.id, changes)
    if (saved) {
      setEditingUserId(null)
      setPendingSave(null)
      setPageNotice({ kind: 'success', text: `已保存 ${original.username}` })
    }
  } finally {
    setSavingUser(false)
  }
}

function requestUserSave(payload) {
  const changes = collectUserChanges(payload.original, payload.draft)
  if (needsRiskConfirmation(payload.original, changes)) {
    setPendingSave(payload)
    setDialog('risk')
    return
  }
  void performSave(payload)
}
```

Pass `saving={savingUser}`, `message={editorMessage}` and
`onSave={requestUserSave}` to `UserEditorDrawer`. Render `pageNotice` in the
page content with `role="status"` so success and failure feedback is visible
without an alert.

- [ ] **Step 6: Run GREEN**

```bash
npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/UserManagement.test.jsx -t "persists changed|stops after"
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add -- \
  ui/V2_PROTOTYPE/src/api/users.js \
  ui/V2_PROTOTYPE/src/hooks/useUsers.js \
  ui/V2_PROTOTYPE/src/pages/UserManagement.jsx \
  ui/V2_PROTOTYPE/src/__tests__/UserManagement.test.jsx \
  ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js
git commit -m "fix(WES Users): RP-043 · 将用户编辑接入真实持久化"
```

### Task 4: Dirty-close guard, risk confirmation, and password Dialog migration

**Files:**

- Modify: `ui/V2_PROTOTYPE/src/components/UserManagement/UserEditorDrawer.jsx`
- Modify: `ui/V2_PROTOTYPE/src/pages/UserManagement.jsx:520-805`
- Modify: `ui/V2_PROTOTYPE/src/__tests__/UserManagement.test.jsx`

- [ ] **Step 1: Write failing safety-path tests**

```jsx
test('protects dirty drawer close and returns focus to the editor button', async () => {
  render(<MemoryRouter><UserManagement /></MemoryRouter>)
  const opener = await screen.findByRole('button', { name: '编辑 arch' })
  fireEvent.click(opener)
  fireEvent.change(screen.getByLabelText('业务角色'), { target: { value: 'pm' } })
  fireEvent.click(screen.getByRole('button', { name: '关闭编辑用户' }))
  expect(screen.getByRole('dialog', { name: '放弃未保存修改' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '继续编辑' }))
  expect(screen.getByRole('dialog', { name: '编辑用户' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '关闭编辑用户' }))
  fireEvent.click(screen.getByRole('button', { name: '放弃修改' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑用户' })).not.toBeInTheDocument())
  expect(opener).toHaveFocus()
})

test('opens password reset from the drawer and preserves the drawer on cancel', async () => {
  render(<MemoryRouter><UserManagement /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: '编辑 arch' }))
  fireEvent.click(screen.getByRole('button', { name: '重置密码…' }))
  expect(screen.getByRole('dialog', { name: '重置登录密码' })).toHaveTextContent('arch')
  fireEvent.click(screen.getByRole('button', { name: '取消重置' }))
  expect(screen.getByRole('dialog', { name: '编辑用户' })).toBeInTheDocument()
})

test('confirms disabling an active account before persisting status', async () => {
  const patches = []
  server.use(http.patch(`${BASE}/auth/users/:userId/status`, async ({ request }) => {
    patches.push(await request.json())
    return HttpResponse.json({ code: 0, message: 'ok', data: { user: { id: 'u3' } } })
  }))
  render(<MemoryRouter><UserManagement /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: '编辑 arch' }))
  fireEvent.change(screen.getByLabelText('账户状态'), { target: { value: 'disabled' } })
  fireEvent.click(screen.getByRole('button', { name: '保存变更' }))
  expect(screen.getByRole('dialog', { name: '确认风险变更' })).toHaveTextContent('正常 → 已禁用')
  fireEvent.click(screen.getByRole('button', { name: '确认风险变更' }))
  await waitFor(() => expect(patches).toEqual([{ status: 'disabled' }]))
})
```

Update the existing password regression to enter through the row editor instead
of selecting a row:

```jsx
fireEvent.click(await screen.findByRole('button', { name: '编辑 arch' }))
fireEvent.click(screen.getByRole('button', { name: '重置密码…' }))
expect(screen.getByRole('dialog', { name: '重置登录密码' })).toHaveTextContent('arch')
```

Keep its existing request-body assertions and change the final close assertion
to `queryByRole('dialog', { name: '重置登录密码' })`; the editor Drawer remains
open after a successful password reset so the administrator retains target
context.

- [ ] **Step 2: Run RED**

```bash
npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/UserManagement.test.jsx -t "protects dirty|opens password|confirms disabling"
```

Expected: FAIL because local Dialog helpers are still in use and dirty-close/risk state does not exist.

- [ ] **Step 3: Replace all local Dialog helpers with shared `Dialog`**

Import:

```jsx
import { Dialog, DialogActions } from '../components/ui/Dialog.jsx'
```

Delete `DialogBackdrop`, `DialogCard`, and the local `DialogActions` definitions at the bottom of `UserManagement.jsx`.

Add the state and derived guard used by the shared Dialogs:

```jsx
const [riskPhrase, setRiskPhrase] = useState('')
const requiresTypedPhrase = Boolean(
  pendingSave?.original.role === 'admin'
  && pendingSave?.draft.role !== 'admin'
)

function cancelPendingSave() {
  setDialog(null)
  setPendingSave(null)
  setRiskPhrase('')
}
```

Use this pattern for discard:

```jsx
<Dialog
  open={dialog === 'discard'}
  title="放弃未保存修改"
  description={editingUser?.username}
  closeOnBackdrop={false}
  onClose={() => setDialog(null)}
>
  <p>关闭后，本次尚未保存的角色和状态修改将丢失。</p>
  <DialogActions>
    <button type="button" className="btn btn-out" onClick={() => setDialog(null)}>继续编辑</button>
    <button type="button" className="btn btn-dan" onClick={closeEditor}>放弃修改</button>
  </DialogActions>
</Dialog>
```

Use this pattern for risk confirmation:

```jsx
<Dialog
  open={dialog === 'risk'}
  title="确认风险变更"
  description={pendingSave?.original.username}
  closeOnBackdrop={false}
  onClose={cancelPendingSave}
>
  <ul className="list-clean">
    {pendingSave?.original.role === 'admin' && pendingSave.draft.role !== 'admin'
      ? <li>系统角色：超级管理员 → {roleLabel(pendingSave.draft.role)}</li>
      : null}
    {pendingSave?.original.status === 'active' && pendingSave.draft.status === 'disabled'
      ? <li>账户状态：正常 → 已禁用</li>
      : null}
  </ul>
  {pendingSave?.original.role === 'admin' && pendingSave.draft.role !== 'admin' ? (
    <label>
      输入“我确定”
      <input value={riskPhrase} onChange={(event) => setRiskPhrase(event.target.value)} />
    </label>
  ) : null}
  <DialogActions>
    <button type="button" className="btn btn-out" onClick={cancelPendingSave}>取消</button>
    <button
      type="button"
      className="btn btn-dan"
      disabled={requiresTypedPhrase && riskPhrase.trim() !== '我确定'}
      onClick={() => {
        const payload = pendingSave
        setDialog(null)
        setRiskPhrase('')
        void performSave(payload)
      }}
    >
      确认风险变更
    </button>
  </DialogActions>
</Dialog>
```

Password Dialog target must come from `editingUser`, not selected rows. Keep minimum length and confirmation checks, replace `alert` with inline `role="status"`, and call `resetUserPassword(editingUser.id, password)`.

When opening it, reset the form and message before `setDialog('password')`;
cancel only the password Dialog, preserving the underlying Drawer. Pass
`onResetPassword` to `UserEditorDrawer` only after this handler exists.

- [ ] **Step 4: Wire dirty close requests**

```jsx
function requestEditorClose({ dirty }) {
  if (dirty) {
    setDialog('discard')
    return
  }
  closeEditor()
}

function closeEditor() {
  setDialog(null)
  setPendingSave(null)
  setRiskPhrase('')
  setEditingUserId(null)
  setEditorMessage(null)
}
```

Pass `requestEditorClose` to `UserEditorDrawer`.

- [ ] **Step 5: Run focused and shared Dialog regressions**

```bash
npm run test --prefix ui/V2_PROTOTYPE -- \
  src/__tests__/UserManagement.test.jsx \
  src/__tests__/Dialog.test.jsx \
  src/__tests__/Drawer.test.jsx
```

Expected: all focused tests PASS and `UserManagement.jsx` no longer defines local Dialog primitives.

- [ ] **Step 6: Commit Task 4**

```bash
git add -- \
  ui/V2_PROTOTYPE/src/components/UserManagement/UserEditorDrawer.jsx \
  ui/V2_PROTOTYPE/src/pages/UserManagement.jsx \
  ui/V2_PROTOTYPE/src/__tests__/UserManagement.test.jsx
git commit -m "feat(WES Users): RP-043 · 补齐侧栏关闭保护与安全确认"
```

### Task 5: Persistent bulk operations and invite recovery

**Files:**

- Modify: `ui/V2_PROTOTYPE/src/pages/UserManagement.jsx`
- Modify: `ui/V2_PROTOTYPE/src/__tests__/UserManagement.test.jsx`
- Modify: `ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js`

- [ ] **Step 1: Write failing bulk and invite tests**

```jsx
test('persists bulk role changes and reports partial failures by username', async () => {
  const patched = []
  server.use(http.patch(`${BASE}/auth/users/:userId/role`, ({ params }) => {
    patched.push(params.userId)
    if (params.userId === 'u3') {
      return HttpResponse.json({ code: 50001, message: '模拟失败' }, { status: 500 })
    }
    return HttpResponse.json({ code: 0, message: 'ok', data: { user: { id: params.userId } } })
  }))
  render(<MemoryRouter><UserManagement /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('checkbox', { name: '选择 pm' }))
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 arch' }))
  fireEvent.click(screen.getByRole('button', { name: '改系统角色' }))
  fireEvent.click(screen.getByRole('radio', { name: '普通用户' }))
  fireEvent.click(screen.getByRole('button', { name: '确认修改' }))
  await screen.findByText(/成功 1 人，失败 1 人：arch/)
  expect(patched).toEqual(['u2', 'u3'])
})

test('generates and displays an invite code with copy feedback', async () => {
  server.use(http.post(`${BASE}/auth/invite-codes/generate`, () => HttpResponse.json({
    code: 0,
    message: 'ok',
    data: { code: { code: 'WES-ABCD', status: 'active', createdAt: '2026-07-26T01:00:00.000Z' } },
  })))
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })

  render(<MemoryRouter><UserManagement /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: '+ 邀请成员' }))
  expect(await screen.findByRole('dialog', { name: '成员邀请码' })).toHaveTextContent('WES-ABCD')
  expect(screen.getByText('当前状态：有效')).toBeInTheDocument()
  expect(screen.getByText(/创建时间/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '复制邀请码' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('WES-ABCD'))
  expect(screen.getByRole('status')).toHaveTextContent('已复制')
})
```

Add `vi` to the Vitest import.

- [ ] **Step 2: Run RED**

```bash
npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/UserManagement.test.jsx -t "persists bulk|generates and displays"
```

Expected: FAIL because bulk role/status still mutate local memory or stop without a result summary, and invite has no behavior.

- [ ] **Step 3: Implement a reusable sequential bulk runner**

```jsx
const [bulkSubmitting, setBulkSubmitting] = useState(false)
const [pendingStatus, setPendingStatus] = useState('')

async function runBulkUpdate({ label, run }) {
  const succeeded = []
  const failed = []
  setBulkSubmitting(true)
  try {
    for (const user of selectedRows) {
      try {
        await run(user)
        succeeded.push(user.username)
      } catch (error) {
        failed.push({ username: user.username, message: error.message })
      }
    }
    await reload().catch(() => {})
    setDialog(null)
    clearSelection()
    setPageNotice({
      kind: failed.length ? 'error' : 'success',
      text: failed.length
        ? `${label}：成功 ${succeeded.length} 人，失败 ${failed.length} 人：${failed.map((item) => item.username).join('、')}`
        : `${label}：已更新 ${succeeded.length} 人`,
    })
  } finally {
    setBulkSubmitting(false)
  }
}
```

Use it for:

```jsx
runBulkUpdate({
  label: '修改系统角色',
  run: (user) => updateUserRole(user.id, pendingRole),
})

runBulkUpdate({
  label: '修改业务角色',
  run: (user) => updateUserBusinessRole(user.id, pendingBusinessRole),
})

runBulkUpdate({
  label: pendingStatus === 'active' ? '批量启用' : '批量禁用',
  run: (user) => updateUserStatus(user.id, pendingStatus),
})
```

Selection-bar status buttons set `pendingStatus` and open the existing shared
confirmation Dialog; role Dialogs call the same runner rather than changing
local rows. Bulk confirmation Dialogs must show `已选 N 人` plus the first
three usernames and `还有 N 人` when applicable. Disable confirmation buttons
while `bulkSubmitting` is true.

- [ ] **Step 4: Restore the existing invite flow**

```jsx
const [inviteRecord, setInviteRecord] = useState(null)
const [inviteSubmitting, setInviteSubmitting] = useState(false)
const [inviteCopyMessage, setInviteCopyMessage] = useState('')

function formatDateTime(value) {
  return value
    ? new Date(value).toLocaleString('zh-CN', { hour12: false })
    : '—'
}

async function handleInviteMember() {
  setInviteSubmitting(true)
  setPageNotice(null)
  setInviteCopyMessage('')
  try {
    const record = await generateInviteCode()
    setInviteRecord(record)
    setDialog('invite')
  } catch (error) {
    setPageNotice({ kind: 'error', text: error.message || '生成邀请码失败' })
  } finally {
    setInviteSubmitting(false)
  }
}

async function copyInviteCode() {
  if (!inviteRecord?.code) return
  try {
    await navigator.clipboard.writeText(inviteRecord.code)
    setInviteCopyMessage('已复制')
  } catch {
    setInviteCopyMessage('复制失败，请手动复制')
  }
}
```

Add a deterministic default invite handler in `mocks/handlers.js`:

```js
http.post(`${BASE}/auth/invite-codes/generate`, () => HttpResponse.json({
  code: 0,
  message: 'ok',
  data: {
    code: {
      code: 'WES-TEST',
      status: 'active',
      createdAt: '2026-07-26T01:00:00.000Z',
    },
  },
})),
```

At the same time, replace Task 2’s empty page-action slot with the now-functional
action:

```jsx
actions={[
  <button
    key="invite"
    type="button"
    className="btn btn-pri"
    disabled={inviteSubmitting}
    onClick={handleInviteMember}
  >
    {inviteSubmitting ? '生成中…' : '+ 邀请成员'}
  </button>,
]}
```

Shared Dialog:

```jsx
<Dialog
  open={dialog === 'invite'}
  title="成员邀请码"
  description="发送给待加入成员，注册后该邀请码会被使用"
  onClose={() => setDialog(null)}
>
  <div className="invite-code">
    <code>{inviteRecord?.code}</code>
    <span>当前状态：{inviteRecord?.status === 'active' ? '有效' : '已使用'}</span>
    <span>创建时间：{formatDateTime(inviteRecord?.createdAt)}</span>
  </div>
  <DialogActions>
    <button type="button" className="btn btn-out" onClick={() => setDialog(null)}>关闭</button>
    <button type="button" className="btn btn-pri" onClick={copyInviteCode}>复制邀请码</button>
  </DialogActions>
  {inviteCopyMessage ? <div role="status">{inviteCopyMessage}</div> : null}
</Dialog>
```

Do not display an expiry date; the backend has no `expiresAt`.

- [ ] **Step 5: Run focused tests**

```bash
npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/UserManagement.test.jsx
```

Expected: all UserManagement tests PASS, including the original role-capability and side-effect tests.

- [ ] **Step 6: Commit Task 5**

```bash
git add -- \
  ui/V2_PROTOTYPE/src/pages/UserManagement.jsx \
  ui/V2_PROTOTYPE/src/__tests__/UserManagement.test.jsx \
  ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js
git commit -m "fix(WES Users): RP-043 · 恢复批量持久化与邀请反馈"
```

### Task 6: OpenAPI alignment and deterministic scope checks

**Files:**

- Modify: `docs/openapi.yaml`
- Modify: `docs/superpowers/plans/2026-07-26-wes-user-management-drawer.md`
- Test: existing API module tests and UI tests

- [ ] **Step 1: Align the existing user-management contracts**

- Add `/api/v1/auth/users/{userId}/business-role` with the exact
  `sales | pre_sales | delivery | pm | pmo | dev | admin` enum.
- Add `/api/v1/auth/users/{userId}/password` with `password.minLength: 8`.
- Keep role, business-role, status, and password responses aligned to the
  handler outcomes: `200 / 400 / 401 / 403 / 404`. Because the route-level
  `user:manage` middleware currently admits only `admin`, describe `403` as
  `缺少 user:manage 能力`; do not advertise handler branches that cannot be
  reached through the HTTP route.
- Reuse one `UserResponse` for `/auth/me` and the four user mutations. These
  handlers all call `ok(..., randomUUID())`, so `requestId` is required:

  ```yaml
  UserResponse:
    type: object
    properties:
      code:
        type: integer
        const: 0
      message:
        type: string
        const: ok
      requestId:
        type: string
      data:
        type: object
        properties:
          user:
            $ref: "#/components/schemas/PublicUser"
        required: [user]
    required: [code, message, data, requestId]
  ```

- Keep `PublicUser.businessRole` aligned to the same seven-value enum.
- Keep invite contracts aligned to the persisted record: no `expiresAt`,
  statuses are `active | used`, and the optional consumption fields are
  `usedByUserId`, `usedByUsername`, and `usedAt`.
- The design specification already states that invite records have no
  `expiresAt`; do not create a no-op specification diff.

- [ ] **Step 2: Verify route and document alignment**

Run:

```bash
rg -n 'users/:userId/(role|business-role|password|status)' apps/api/src/routes/auth.routes.ts
rg -n '/api/v1/auth/users/\\{userId\\}/(role|business-role|password|status)' docs/openapi.yaml

ruby <<'RUBY'
require "yaml"

document = YAML.safe_load(File.read("docs/openapi.yaml"), aliases: true)
abort("missing OpenAPI document roots") unless document["openapi"] && document["paths"] && document.dig("components", "schemas")

http_methods = %w[get put post delete options head patch trace]
operation_ids = document.fetch("paths").flat_map do |_path, path_item|
  path_item.map do |method, operation|
    next unless http_methods.include?(method) && operation.is_a?(Hash)
    operation["operationId"]
  end.compact
end
operation_counts = operation_ids.each_with_object(Hash.new(0)) { |operation_id, counts| counts[operation_id] += 1 }
duplicate_operation_ids = operation_counts.select { |_operation_id, count| count > 1 }.keys
abort("duplicate operationId: #{duplicate_operation_ids.join(', ')}") unless duplicate_operation_ids.empty?

local_refs = []
walk = lambda do |value|
  case value
  when Hash
    ref = value["$ref"]
    local_refs << ref if ref.is_a?(String) && ref.start_with?("#/")
    value.each_value { |child| walk.call(child) }
  when Array
    value.each { |child| walk.call(child) }
  end
end
walk.call(document)

unresolved_refs = local_refs.uniq.reject do |ref|
  begin
    ref.delete_prefix("#/").split("/").reduce(document) do |node, token|
      node.fetch(token.gsub("~1", "/").gsub("~0", "~"))
    end
    true
  rescue KeyError, NoMethodError
    false
  end
end
abort("unresolved local refs: #{unresolved_refs.join(', ')}") unless unresolved_refs.empty?

puts "OpenAPI validation passed: #{operation_ids.size} operationIds unique, #{local_refs.uniq.size} local refs resolved"
RUBY

(cd apps/api && npx tsx --test --test-global-setup=./test-setup.mts src/modules/modules.handlers.test.ts)
npm run build:api
```

Expected: all four routes appear in both code and OpenAPI; YAML parsing,
duplicate `operationId`, and local `$ref` checks pass; the focused module suite
and API build pass.

- [ ] **Step 3: Run the WES UI scope checker**

```bash
node skills/improving-wes-ui/scripts/check-ui-scope.mjs --base 13eecc2 -- \
  ui/V2_PROTOTYPE/src/components/ui/Drawer.jsx \
  ui/V2_PROTOTYPE/src/components/ui/Dialog.jsx \
  ui/V2_PROTOTYPE/src/components/UserManagement/UserEditorDrawer.jsx \
  ui/V2_PROTOTYPE/src/pages/UserManagement.jsx \
  ui/V2_PROTOTYPE/tokens.css \
  ui/V2_PROTOTYPE/components.css
```

Expected:

- no new UI dependency
- no page-owned `DialogBackdrop`, `DialogCard`, or `DialogActions`
- no unapproved raw colors or arbitrary modal layers introduced by this batch
- exactly one page family changed

- [ ] **Step 4: Commit Task 6**

```bash
git add -- \
  docs/openapi.yaml \
  docs/superpowers/plans/2026-07-26-wes-user-management-drawer.md
git commit -m "docs(WES Users): RP-043 · 收紧用户管理契约校验"
```

### Task 7: Full verification, browser evidence, and command-board closure

**Files:**

- Create: `docs/superpowers/evaluations/2026-07-26-user-management-drawer-qa.md`
- Create: `03_技术设计/系统架构/WES-Agent-升级总看板/events/2026-07-26-user-management-drawer-implementation.json`
- Modify only event-targeted board pages after event validation

- [ ] **Step 1: Run focused and full automated verification**

```bash
npm run test --prefix ui/V2_PROTOTYPE -- \
  src/__tests__/Drawer.test.jsx \
  src/__tests__/Dialog.test.jsx \
  src/__tests__/UserManagement.test.jsx
npm run test:web
npm run build:web
npm run build:api
```

Expected:

- Drawer, Dialog and UserManagement focused tests all pass
- V2 full test suite passes
- Web and API builds pass
- only the pre-existing web chunk-size warning is tolerated

- [ ] **Step 2: Start or confirm development services**

```bash
curl -fsS http://127.0.0.1:3000/api/v1/health
curl -fsS http://127.0.0.1:3002
```

If either fails:

```bash
npm run dev:api
npm run dev:web
```

Keep the processes alive in separate PTY sessions.

- [ ] **Step 3: Perform browser acceptance with an authenticated admin session**

Record in `docs/superpowers/evaluations/2026-07-26-user-management-drawer-qa.md`:

```markdown
# RP-043 User Management Drawer Browser QA

## Environment
- URL: http://127.0.0.1:3002/users
- Browser: Chrome
- Auth: existing admin session
- Data: reversible test users only

## Desktop
- [ ] page action, filters, selection bar are visually separated
- [ ] Edit opens the correct username without changing selection
- [ ] save success reflects server data after reload
- [ ] dirty close opens discard Dialog
- [ ] password and risk Dialogs show target context
- [ ] invite code appears and copies

## 760px
- [ ] drawer is full width
- [ ] body scrolls independently
- [ ] footer actions remain reachable
- [ ] underlying page does not become the editable surface

## Keyboard
- [ ] initial focus enters system role
- [ ] Tab remains in Drawer/Dialog
- [ ] Escape follows dirty-close policy
- [ ] final close restores focus to Edit

## Console
- [ ] no new warning/error
```

Do not use a real privileged account as the mutation target. Restore any changed test user to its original role, business role and status before ending QA.

- [ ] **Step 4: Write and validate the board event**

Create the event with:

- scope `RP-043 用户管理侧栏编辑与操作分层`
- links to spec, plan, commits, automated commands and browser QA
- explicit dedup to `ISS-2026-07-25-003 / RP-043`
- explicit cross-reference to `DEF-2026-07-04-002` and `RP-041`
- status no higher than the evidence supports

Validate:

```bash
node scripts/board-event-check.js \
  '03_技术设计/系统架构/WES-Agent-升级总看板/events/2026-07-26-user-management-drawer-implementation.json'
```

Apply only after validation:

```bash
node scripts/board-event-apply.js \
  '03_技术设计/系统架构/WES-Agent-升级总看板/events/2026-07-26-user-management-drawer-implementation.json'
node scripts/board-work-items-generate.js
node scripts/board-consistency-check.js
```

If apply would overwrite overlapping user changes in dirty board HTML, do not force it. Keep the validated event, document the blocked page update, and leave the user’s HTML untouched.

- [ ] **Step 5: Final diff and evidence audit**

```bash
git diff --check 13eecc2 -- \
  ui/V2_PROTOTYPE/src/components/ui/Drawer.jsx \
  ui/V2_PROTOTYPE/src/components/UserManagement/UserEditorDrawer.jsx \
  ui/V2_PROTOTYPE/src/api/users.js \
  ui/V2_PROTOTYPE/src/hooks/useUsers.js \
  ui/V2_PROTOTYPE/src/pages/UserManagement.jsx \
  ui/V2_PROTOTYPE/src/__tests__/Drawer.test.jsx \
  ui/V2_PROTOTYPE/src/__tests__/UserManagement.test.jsx \
  ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js \
  ui/V2_PROTOTYPE/tokens.css \
  ui/V2_PROTOTYPE/components.css \
  docs/openapi.yaml \
  docs/superpowers/evaluations/2026-07-26-user-management-drawer-qa.md \
  docs/superpowers/specs/2026-07-25-wes-user-management-drawer-design.md \
  '03_技术设计/系统架构/WES-Agent-升级总看板/events/2026-07-26-user-management-drawer-implementation.json'
git status --short
git diff --stat
git log --oneline -8
```

Confirm:

- no unrelated user files staged
- no secrets or test passwords in docs or events
- no second frontend stack or dependency
- no unresolved placeholder text
- every acceptance claim has an automated or browser evidence reference

- [ ] **Step 6: Commit verification artifacts**

```bash
git add -- \
  docs/superpowers/evaluations/2026-07-26-user-management-drawer-qa.md \
  '03_技术设计/系统架构/WES-Agent-升级总看板/events/2026-07-26-user-management-drawer-implementation.json'
git commit -m "docs(WES Users): RP-043 · 回填侧栏编辑验证证据"
```

If board event application safely changed board HTML, add only the exact generated target pages in a separate commit:

```bash
git add -- \
  '03_技术设计/系统架构/WES-Agent-升级总看板/requirements.html' \
  '03_技术设计/系统架构/WES-Agent-升级总看板/plan.html' \
  '03_技术设计/系统架构/WES-Agent-升级总看板/testing.html' \
  '03_技术设计/系统架构/WES-Agent-升级总看板/monitoring.html' \
  '03_技术设计/系统架构/WES-Agent-升级总看板/risks.html' \
  '03_技术设计/系统架构/WES-Agent-升级总看板/changes.html'
git commit -m "docs(WES Board): RP-043 · 同步用户管理侧栏交付事实"
```

## Completion gate

Do not claim this batch complete unless all are true:

- approved spec and this plan remain aligned
- Drawer and UserManagement focused tests pass
- `npm run test:web`, `npm run build:web`, and `npm run build:api` pass
- no local Dialog primitive remains in `UserManagement.jsx`
- role, business role and status mutations call server APIs
- invite control is no longer silent
- desktop, 760px and keyboard browser evidence is recorded
- test-user mutations are restored
- board event is valid and applied where safe
