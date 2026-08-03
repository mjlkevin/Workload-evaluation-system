# UI-07 Review List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. If the platform cannot register that Skill, read the plan manually and preserve every Work Order gate.

**Goal:** 修复 `/reviews` 列表的失败态可信度、幽灵评审和隐式操作入口，让用户能看懂系统状态，并通过鼠标或键盘完成真实可用的动作。

**Architecture:** 状态归属保持在既有三层：`useReviewList` 负责 API 生命周期与结构化结果，`ReviewList` 负责业务动作和导航，`ListPage` 只提供向后兼容的通用状态/可访问性能力。不得修改 API、详情页、全局 Shell 或其他列表消费者的默认业务行为。

**Tech Stack:** React 18、Vite 5、react-router-dom 6、Vitest、React Testing Library、MSW/`apiClient` spy、现有 WES CSS token。

**Execution Contract:** 以 `docs/agent-loop/work-orders/2026-07-31-qoder-QODER-UI-007-IMPL.md` 为最高任务边界；base 为 `910269a`，worktree 为 `.claude/worktrees/ui-007-reviews-list`，分支为 `qoder/ui-007-reviews-list`。先 ACK，得到确认后再编辑。最终只允许一个聚焦提交并停在“已回填 / 待 Codex 复核”。

---

## Task 1: 建立 ReviewList 聚焦测试骨架

**Files:**

- Create: `ui/V2_PROTOTYPE/src/__tests__/ReviewList.test.jsx`
- Reference: `ui/V2_PROTOTYPE/src/__tests__/AssessmentList.test.jsx`
- Reference: `ui/V2_PROTOTYPE/src/__tests__/ShellUserMenu.test.jsx`
- Reference: `ui/V2_PROTOTYPE/src/__tests__/SystemManagementKnowledgeBase.test.jsx`

### Step 1: 建立可观察路由与 API mock

测试必须让 `useReviewList` 走鉴权 API 路径，并能观察当前 pathname。采用项目现有模式：

```jsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { apiClient } from '../api/client.js'
import ReviewList from '../pages/ReviewList.jsx'

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="current-route">{location.pathname}</output>
}

function renderReviews() {
  return render(
    <MemoryRouter initialEntries={['/reviews']}>
      <Routes>
        <Route path="/reviews" element={<><ReviewList /><LocationProbe /></>} />
        <Route path="/reviews/:id" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.setItem('wes_token', 'mock-token')
  vi.restoreAllMocks()
})
```

不要 mock `useReviewList`；测试要覆盖 hook、页面和路由之间的真实 owner 链路。

### Step 2: 添加 P1 失败与重试测试

先写两个行为测试：

```jsx
test('shows a retryable alert instead of an empty state when loading fails', async () => {
  vi.spyOn(apiClient, 'get').mockRejectedValueOnce(new Error('service unavailable'))
  renderReviews()

  expect(await screen.findByRole('alert')).toHaveTextContent('加载评审列表失败')
  expect(screen.getByRole('button', { name: '重试' })).toBeEnabled()
  expect(screen.queryByText('暂无数据')).not.toBeInTheDocument()
})

test('recovers real rows after retry succeeds', async () => {
  vi.spyOn(apiClient, 'get')
    .mockRejectedValueOnce(new Error('service unavailable'))
    .mockResolvedValueOnce({ data: [{ id: 'REV-SERVER-001', status: 'pending' }] })
  renderReviews()

  fireEvent.click(await screen.findByRole('button', { name: '重试' }))
  expect(await screen.findByText('REV-SERVER-001')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
```

如果 API list envelope 与示例不同，只调整 mock envelope，不降低行为断言。

### Step 3: 添加 P2 创建成功与失败测试

失败测试要先加载一条真实行，再拒绝 POST，以证明既有列表未被清空：

```jsx
test('keeps the list and route when create fails without a local ghost record', async () => {
  vi.spyOn(apiClient, 'get').mockResolvedValue({ data: [{ id: 'REV-EXISTING', status: 'pending' }] })
  vi.spyOn(apiClient, 'post').mockRejectedValueOnce(new Error('create failed'))
  renderReviews()

  await screen.findByText('REV-EXISTING')
  fireEvent.click(screen.getByRole('button', { name: '+ 新建' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('创建评审失败')
  expect(screen.getByTestId('current-route')).toHaveTextContent('/reviews')
  expect(screen.getByText('REV-EXISTING')).toBeInTheDocument()
  expect(screen.queryByText(/REV-LOCAL-/)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '+ 新建' })).toBeEnabled()
})

test('navigates only to the server id after create succeeds', async () => {
  vi.spyOn(apiClient, 'get').mockResolvedValue({ data: [] })
  vi.spyOn(apiClient, 'post').mockResolvedValueOnce({ data: { id: 'REV-SERVER-NEW' } })
  renderReviews()

  fireEvent.click(await screen.findByRole('button', { name: '+ 新建' }))
  await waitFor(() => {
    expect(screen.getByTestId('current-route')).toHaveTextContent('/reviews/REV-SERVER-NEW')
  })
})
```

### Step 4: 运行 RED

```bash
npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/ReviewList.test.jsx
```

Expected: 新测试因缺少 load alert/retry、创建失败仍返回本地 ID、仍导航而失败；不得因 import、router 或 mock 配置失败。

---

## Task 2: 修复 P1/P2 的状态与导航 owner

**Files:**

- Modify: `ui/V2_PROTOTYPE/src/hooks/useReviewList.js`
- Modify: `ui/V2_PROTOTYPE/src/pages/ReviewList.jsx`
- Modify: `ui/V2_PROTOTYPE/src/components/ListPage.jsx`
- Test: `ui/V2_PROTOTYPE/src/__tests__/ReviewList.test.jsx`

### Step 1: 在 hook 中分开 load error 与 create error

不要继续复用单一 `error`。建议返回稳定的结构化 contract：

```js
const [loadError, setLoadError] = useState(null)
const [createError, setCreateError] = useState(null)

// fetch start
setLoading(true)
setLoadError(null)

// fetch catch
setLoadError(err)

// create start
setCreating(true)
setCreateError(null)
```

鉴权创建路径不得预插入 `REV-LOCAL-*`。成功时必须验证服务端 ID；失败返回失败结果：

```js
try {
  const payload = await apiClient.post('/pm/reviews', requestBody)
  const record = payload?.data || payload
  if (!record?.id) throw new Error('创建评审成功但服务端未返回 ID')
  refetch()
  return { ok: true, id: record.id }
} catch (err) {
  setCreateError(err)
  return { ok: false, id: null, error: err }
} finally {
  setCreating(false)
}
```

`enabled === false` 的纯演示路径可继续生成本地行，但必须放在 API 路径之外，并返回同样的 `{ ok, id }` 形状。

### Step 2: 让 ListPage 显示互斥的 loading/error/empty

给 `ListPage` 增加默认值安全的可选 props，例如：

```jsx
loading = false,
error = null,
onRetry,
feedback = null,
```

列表 owner 附近按优先级渲染：

1. `loading`：`role="status"` + `aria-live="polite"`；
2. `error`：`role="alert"` + “重试”按钮；
3. 请求完成且无错误、`filtered.length === 0`：现有空状态；
4. 有数据：现有表格。

错误和 loading 文案由 `ReviewList` 传入，`ListPage` 不解析 Error，也不硬编码评审业务。

### Step 3: 页面仅在创建成功时导航

`ReviewList` 获取并传递 `loading`、`loadError`、`createError`。新建 handler 采用：

```jsx
const handleCreate = async () => {
  const result = await create()
  if (result.ok && result.id) navigate(`/reviews/${encodeURIComponent(result.id)}`)
}
```

创建错误显示在 PageShell 的 action/list owner 内，使用 `role="alert"`，但不替换或隐藏已有行。不要使用 native `alert()`。

### Step 4: 运行 GREEN

```bash
npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/ReviewList.test.jsx
```

Expected: Task 1 的四个测试通过。

---

## Task 3: 用失败测试锁定 P3 的显式与键盘操作

**Files:**

- Create: `ui/V2_PROTOTYPE/src/__tests__/ListPage.test.jsx`
- Modify: `ui/V2_PROTOTYPE/src/__tests__/ReviewList.test.jsx`

### Step 1: 添加 ListPage 可访问性测试

用两条固定数据渲染最小 `ListPage`，断言：

```jsx
expect(screen.getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true')
expect(screen.getByRole('button', { name: '待评审' })).toHaveAttribute('aria-pressed', 'false')
expect(screen.getByRole('checkbox', { name: '选择当前结果' })).toBeInTheDocument()
expect(screen.getByRole('checkbox', { name: '选择 REV-001' })).toBeInTheDocument()
```

点击“待评审”后断言两个筛选按钮的 `aria-pressed` 交换；点击/组合选择仍应更新“已选”计数。不要删除现有 Cmd/Ctrl 与 Shift 选择逻辑。

### Step 2: 添加 ReviewList 动作测试

补充：

- 每个服务端行都有名为“查看详情”的 button/link；
- 单击即可导航，无需双击；
- 选择一行后只出现/启用一个“查看详情”和一个“历史”；
- 页面没有“修改”和“删除”批量动作；
- 点击“历史”不会调用 `window.alert`，而会出现 `role="status"` 的诚实提示。

历史断言示例：

```jsx
const nativeAlert = vi.spyOn(window, 'alert').mockImplementation(() => {})
fireEvent.click(screen.getByRole('button', { name: '历史' }))
expect(nativeAlert).not.toHaveBeenCalled()
expect(screen.getByRole('status')).toHaveTextContent('暂无可展示的评审历史')
```

### Step 3: 运行 RED

```bash
npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/ReviewList.test.jsx src/__tests__/ListPage.test.jsx
```

Expected: 因缺少 row action、`aria-pressed`、checkbox name 和内联历史反馈而失败。

---

## Task 4: 实现 P3 并保护 ListPage 其他消费者

**Files:**

- Modify: `ui/V2_PROTOTYPE/src/components/ListPage.jsx`
- Modify: `ui/V2_PROTOTYPE/src/pages/ReviewList.jsx`
- Test: `ui/V2_PROTOTYPE/src/__tests__/ReviewList.test.jsx`
- Test: `ui/V2_PROTOTYPE/src/__tests__/ListPage.test.jsx`

### Step 1: 增补通用语义，不改变默认交互

在现有筛选按钮上添加：

```jsx
aria-pressed={activeFilter === tag.key}
```

表头 checkbox 添加 `aria-label="选择当前结果"`；行 checkbox 使用稳定 row key：

```jsx
aria-label={`选择 ${row[rowKey]}`}
```

不要将 clickable `span` 扩大成另一个无标签控制；本任务只修已确认语义。

### Step 2: ReviewList 收敛动作

显式传入本页面专属批量动作，避免使用 `ListPage` 默认动作：

```jsx
bulkActions={[
  { key: 'open', label: '查看详情', mode: 'single' },
  { key: 'history', label: '历史', mode: 'single' },
]}
```

给 columns 增加“操作”列，render 原生 button/link；点击时 `stopPropagation()` 并导航到编码后的真实 ID。保留双击仅作辅助。

### Step 3: 历史反馈改为页面状态

`ReviewList` 持有轻量 feedback state；选择“历史”时显示类似：

```text
REV-001 暂无可展示的评审历史；当前仅支持打开详情查看最新状态。
```

使用 `role="status"`、`aria-live="polite"`。不得伪造历史条目，不得新增后端接口。

### Step 4: 运行聚焦 GREEN 与共享组件回归

```bash
npm run test --prefix ui/V2_PROTOTYPE -- src/__tests__/ReviewList.test.jsx src/__tests__/ListPage.test.jsx src/__tests__/AssessmentList.test.jsx
```

Expected: 新测试全部通过；既有 AssessmentList 消费者不回归。

---

## Task 5: 完整验证、浏览器验收与单提交回填

**Files:**

- Verify only: 所有 allowed paths
- Do not modify: 总看板 HTML、API、详情页、Shell、`index.css`

### Step 1: 执行静态与全量验证

```bash
git diff --check 910269a..HEAD
npm run test:web
npm run build:web
node skills/improving-wes-ui/scripts/check-ui-scope.mjs --base 910269a -- \
  ui/V2_PROTOTYPE/src/hooks/useReviewList.js \
  ui/V2_PROTOTYPE/src/pages/ReviewList.jsx \
  ui/V2_PROTOTYPE/src/components/ListPage.jsx \
  ui/V2_PROTOTYPE/src/__tests__/ReviewList.test.jsx \
  ui/V2_PROTOTYPE/src/__tests__/ListPage.test.jsx
```

全量失败时先判断是否基线既有；不能隔离则停止，不得顺手修 allowed paths 外问题。

### Step 2: 当前浏览器验收

按 Work Order 逐项收集 1440px、760px、GET 503、POST 500、POST 200 和键盘证据。760px 要测 `scrollWidth <= clientWidth`；表格自身局部滚动可以存在，页面级水平溢出不可以。

### Step 3: 复核变更边界

```bash
git status --short --branch
git diff --name-only 910269a..HEAD
```

输出只能包含 Work Order allowed paths。任何 `node_modules` 链接、截图、临时 API、凭据或主线文件都不得进入提交。

### Step 4: 创建一个聚焦提交

```bash
git add ui/V2_PROTOTYPE/src/hooks/useReviewList.js \
  ui/V2_PROTOTYPE/src/pages/ReviewList.jsx \
  ui/V2_PROTOTYPE/src/components/ListPage.jsx \
  ui/V2_PROTOTYPE/src/__tests__/ReviewList.test.jsx \
  ui/V2_PROTOTYPE/src/__tests__/ListPage.test.jsx
git commit -m "feat(WES UI): UI-07 · 评审列表可信反馈与显式操作入口"
```

若某个允许文件没有变更，不要为了命令模板制造空改动；从 `git add` 中移除即可。

### Step 5: 结构化 handoff 后停止

按 Work Order 回填 base/head、文件、RED/GREEN、全量测试、build、scope checker、1440/760/keyboard、风险和 clean status。明确写：

```text
status: 已回填 / 待 Codex 复核
allowNextTask: false
integrationAuthorized: false
next: 等待 Codex 复核
```

不得 cherry-pick、merge、push、删除 worktree、更新最终交付状态或领取下一项。
