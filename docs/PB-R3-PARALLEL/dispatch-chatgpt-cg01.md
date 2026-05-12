# CG-01 · B1 首批 Adapter：UserManagement + HistoryList/Detail

派发对象：ChatGPT
任务类型：JS adapter 编写（API 调用 + 字段映射），无 UI 改动
前置依赖：API Client 基座已完成（`src/api/client.js`）
预估产出：~250 lines JS（3 个 adapter 文件）
截止：完成即回传

---

## 背景

WES Phase B 正在把 `ui/V2_PROTOTYPE` 从静态 mock 切到真实后端。API Client 基座已由 Claude 完成：

| 模块 | 路径 | 能力 |
|---|---|---|
| client | `src/api/client.js` | `apiClient.get(path, params)` / `.post(path, body)` / `.patch(path, body)` / `.delete(path)` — BASE=`/api/v1`，自动注入 Bearer token，401→跳转 login，非 2xx→throw ApiError |
| errors | `src/api/errors.js` | `ApiError(status, code, message, details)` + `NetworkError(message, cause)` |
| auth | `src/api/auth.js` | `getToken()` / `setToken(t)` / `clearToken()` / `isAuthenticated()` |

Mock Fallback 机制（已完成 by KIMI CODE）：
- `src/hooks/useMock.js` — `useMock()` 返回 `{ isMock, setMock, toggleMock }`，含 `withMock(apiCall, mockData, opts)` 条件执行 + `isMockMode()` 非 React 辅助

ViewModel 类型（已完成 by KIMI CODE）：
- `src/viewModels/types.js` — JSDoc typedef（UserVM, HistoryProjectVM 等 8 个类型）

---

## 任务：编写 3 个只读 adapter

### 文件 1：`src/adapters/useUsers.js`

**数据来源**：`GET /api/v1/auth/users` → `PublicUser[]`

**后端字段**（来自 `apps/api/src/types/index.ts` PublicUser = AuthUser - passwordHash）：
```ts
AuthUser {
  id: string
  username: string
  role: "admin" | "sub_admin" | "user"
  status: "active" | "disabled"
  createdAt: string
  lastLoginAt: string
}
```

**前端 mock 字段**（来自 `mock/listData.js` 的 `users`，查看 UserManagement.jsx 使用方式）：
```js
{ id, username, role, status, lastLoginAt, locked }
```

**adapter 需做**：
1. `fetchUsers()` — 调 `apiClient.get('/auth/users')` 拿到 `PublicUser[]`
2. 映射 `PublicUser[] → UserVM[]`
   - `id` → 直接
   - `username` → 直接
   - `role` → 直接（admin/sub_admin/user）
   - `status` → 直接（active/disabled）
   - `lastLoginAt` → 直接
   - `locked` → **前端策略**：当 `role === 'admin'` 时为 `true`（admin 不可被降权/删除的 UI 保护）
3. 若 `useMock() === true` 返回 mock 数据（从 `mock/listData.js` import）；否则返回 API 数据
4. 导出 hook：`useUsers()` → `{ users, loading, error, refetch }`

**重要**：UserManagement.jsx 当前可能使用 `UserManagement.INITIAL_USERS`。请在 adapter 中做 import fallback，确保不改动页面 JSX 的前提下 adapt 数据源。

### 文件 2：`src/adapters/useHistoryProjects.js`

**数据来源**：
- 列表：`GET /api/v1/history/projects`（query: `industry/scale/limit/offset`）→ `HistoryProjectRow[]`
- 相似项目：`GET /api/v1/history/similar`（query: `industry/scale/modules`）

**后端字段**（需查看 `apps/api/src/types/index.ts` 或 route 文件确认 HistoryProjectRow shape）：
推测字段（基于审计文档 §3）：
```ts
HistoryProjectRow {
  industry, scale, modules,
  estimatedDays, actualDays,
  estimatedCost, actualCost,
  projectName, customerName,
  versionCode, closedYear, status
}
SimilarProjectResult { similarityScore, ... }
```

**前端 mock 字段**（来自 `mock/listData.js` 的 `historyItems`）：
```js
{ id, projectName, customer, industry, scale, version, similarity, totalDays, totalAmount, year, status, updatedAt }
```

**adapter 需做**：
1. `fetchHistoryProjects(params)` — 调 `apiClient.get('/history/projects', params)`
2. 映射：
   - `projectName` → 直接
   - `customer` ← `customerName`
   - `totalDays` ← `actualDays ?? estimatedDays`
   - `totalAmount` ← `actualCost ?? estimatedCost`（后端可能是分为单位，需 `/10000` 转万元）
   - `similarity` ← 需聚合 `/history/similar` 结果（若缺则默认 0）
   - `version` ← `versionCode`
   - `year` ← `closedYear`（取年份部分）
3. 导出 `useHistoryProjects(filters)` → `{ projects, loading, error, refetch }`

### 文件 3：`src/adapters/useHistoryDetail.js`

**数据来源**：`GET /api/v1/history/projects/:id` → 单条 `HistoryProjectRow`

**adapter 需做**：
1. 导出 `useHistoryDetail(id)` → `{ project, loading, error }`
2. 字段映射同 `useHistoryProjects`，单条详情

---

## 编码规范

1. 所有 adapter 采用 async/await，不引入第三方 HTTP 库（用 `apiClient`）
2. try/catch 包裹 API 调用，catch 到 `ApiError` 时将 error 放到 hook 返回的 `error` 字段（不 console.error 轰炸）
3. 保持与现有 mock 字段名一致（这样页面 JSX 中解构字段名不用改）
4. 每个 hook 导出 `loading` 和 `error` 状态，页面可选使用
5. 使用 `useMock()` 做双轨切换

**模板**：
```js
import { useState, useEffect, useCallback } from 'react'
import { apiClient } from '@/api/client'
import { useMock } from '@/hooks/useMock'
import { users as mockUsers } from '@/mock/listData'

export function useUsers() {
  const mock = useMock()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetch = useCallback(async () => {
    if (mock) { setUsers(mockUsers); setLoading(false); return }
    try {
      setLoading(true)
      setError(null)
      const data = await apiClient.get('/auth/users')
      setUsers(data.map(u => ({
        id: u.id,
        username: u.username,
        role: u.role,
        status: u.status,
        lastLoginAt: u.lastLoginAt,
        locked: u.role === 'admin',
      })))
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [mock])

  useEffect(() => { fetch() }, [fetch])

  return { users, loading, error, refetch: fetch }
}
```

---

## 上下文文件速查

| 文件 | 说明 |
|---|---|
| `ui/V2_PROTOTYPE/src/api/client.js` | apiClient（已就绪） |
| `ui/V2_PROTOTYPE/src/api/errors.js` | ApiError / NetworkError |
| `ui/V2_PROTOTYPE/src/mock/listData.js` L38-47 | historyItems mock |
| `ui/V2_PROTOTYPE/src/pages/HistoryList.jsx` | 目标页面，查看数据使用方式 |
| `ui/V2_PROTOTYPE/src/pages/HistoryDetail.jsx` | 目标页面 |
| `ui/V2_PROTOTYPE/src/pages/UserManagement.jsx` | 目标页面 |
| `apps/api/src/types/index.ts` L190-201 | PublicUser / AuthUser |
| `apps/api/src/routes/history.routes.ts` | History 后端 route（7 个 endpoint） |
| `apps/api/src/routes/auth.routes.ts` | Auth 后端 route（9 个 endpoint） |
| `docs/PB-R3-PARALLEL/backend-cutover-plan.md` §2 | ViewModel 映射表 |

---

## 交付物

1. `ui/V2_PROTOTYPE/src/adapters/useUsers.js`
2. `ui/V2_PROTOTYPE/src/adapters/useHistoryProjects.js`
3. `ui/V2_PROTOTYPE/src/adapters/useHistoryDetail.js`

完成后请回复：每个文件的摘要 + 行数 + 是否满足验收标准。

---

## 特别注意

1. **先读目标页面**，确认 mock 数据是怎么被使用的（import 方式、字段解构），保持 adapter 返回的字段名与 mock 一致
2. HistoryProjectRow 的具体字段名如果在 types/index.ts 中找不到，请读 `apps/api/src/routes/history.routes.ts` 和对应的 service/controller 确认
3. `totalAmount` 单位转换需要确认后端存的是「分」「元」还是「万元」。若不确定，adapter 中保留 `totalAmount` 不做转换，标注 `// TODO: verify unit`
