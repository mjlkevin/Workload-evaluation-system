# CG-02 · B2 AssessmentList + RequirementList Adapter

派发对象：ChatGPT
任务类型：JS adapter 编写（API 调用 + VersionRecord → ViewModel 映射）
前置依赖：API Client ✅ | useMock ✅ | B1 adapter 模式 ✅（`src/hooks/useUsers.js` / `useHistoryProjects.js`）
预估产出：~350 lines JS（3 个文件：2 个 adapter hook + 1 个共享 status mapper）
截止：完成即回传

---

## 背景

B1 已完成（`useUsers` / `useHistoryProjects` / `useHistoryDetail`），三页均采用 `enabled = isAuthenticated()` 守卫 + `fallbackData` 降级模式。B2 继续切入两个最核心的列表页：AssessmentList 和 RequirementList。

**关键差异**：这两页的 mock 数据目前是扁平结构（`listData.js` 的 `assessments` / `requirements`），但后端数据源是 `VersionRecord` — 一个版本管理领域对象，很多业务字段藏在 `payload` JSON 里，CS 状态需要从 `checkoutStatus` + `versionDocStatus` 组合推导。

---

## 任务

### 文件 1：`src/hooks/useAssessmentList.js`

**API**：`GET /api/v1/versions?type=assessment` → `VersionRecord[]`

**后端字段**（从 `apps/api/src/types/index.ts` L237-277）：
```ts
VersionRecord {
  id: string
  type: "assessment" | "resource" | "requirementImport" | "dev" | "global"
  versionCode: string          // e.g. "IA-04003"
  baseCode: string             // e.g. "GL-04001"
  status: "draft" | "reviewed" | "published" | "archived"
  checkoutStatus: "checked_in" | "checked_out"
  versionDocStatus: "drafting" | "reviewed"
  checkedOutByUserId?: string
  checkedOutByUsername?: string
  updatedByUserId?: string
  updatedByUsername?: string
  ownerUserId: string
  createdAt: string
  updatedAt: string
  payload: Record<string, unknown>  // 业务数据全在这里
  ...
}
```

**payload 预期 shape**（来自 mock 推断 + 审计文档）：
```json
{
  "projectName": "利民集团数字化二期",
  "productLine": "金蝶AI星空",
  "quoteMode": "标准实施",
  "totalDays": 232.8,
  "orgCount": 3,
  "difficultyFactor": 1.1
}
```

**前端 mock 字段**（`listData.js` assessments）：
```js
{ id, projectName, productLine, globalVersion, assessmentVersion, quoteMode, totalDays, orgCount, difficultyFactor, status, owner, updatedAt }
```

**映射表**：

| ViewModel | 后端来源 | 转换 |
|---|---|---|
| `id` | `VersionRecord.id` | 直接（注意后端是 string，前端 mock 是 number，用 `Number(id)` 或保留 string 兼容） |
| `projectName` | `payload.projectName` | 直接，fallback `''` |
| `productLine` | `payload.productLine` | 直接，fallback `'未标注'` |
| `globalVersion` | `baseCode` | 直接，fallback `versionCode` |
| `assessmentVersion` | `versionCode` | 直接 |
| `quoteMode` | `payload.quoteMode` | 直接，fallback `'标准实施'` |
| `totalDays` | `payload.totalDays` | `Number(...)` |
| `orgCount` | `payload.orgCount` | `Number(...)`，fallback `1` |
| `difficultyFactor` | `payload.difficultyFactor` | `Number(...)`，fallback `1.0` |
| `status` | 见下方 status 映射 | 组合字段 |
| `owner` | `checkedOutByUsername \|\| updatedByUsername \|\| '—'` | 优先检出人 |
| `updatedAt` | `updatedAt` | `.slice(0,10)` |

**status 映射**（VCS 状态机）：

| 后端组合 | 前端 status |
|---|---|
| `checkoutStatus==='checked_out'` | `'已检出'` |
| `checkoutStatus==='checked_in' && versionDocStatus==='reviewed'` | `'已检入'` |
| `checkoutStatus==='checked_in' && versionDocStatus==='drafting' && status==='draft'` | `'进行中'` |
| `status==='reviewed' && checkoutStatus==='checked_in'` | `'待评审'` |
| `status==='archived'` | `'已归档'` |
| `status==='published'` | `'已发布'` |
| 其他 | `'进行中'` |

### 文件 2：`src/hooks/useRequirementList.js`

**API**：`GET /api/v1/versions?type=requirementImport` → `VersionRecord[]`

**payload 预期 shape**（包含 `RequirementImportData` 的子集）：
```json
{
  "projectName": "巨三集团星空套件",
  "customerName": "巨三集团",
  "productLines": ["金蝶AI星空"],
  "basicProjectInfo": { "customerName": "巨三集团", "projectName": "..." }
}
```

**前端 mock 字段**（`listData.js` requirements）：
```js
{ id, globalVersion, versionCode, projectName, productLine, customer, status, creator, updater, updatedAt }
```

**映射表**：

| ViewModel | 后端来源 | 转换 |
|---|---|---|
| `id` | `VersionRecord.id` | 直接 |
| `globalVersion` | `baseCode` | 直接 |
| `versionCode` | `versionCode` | 直接 |
| `projectName` | `payload.projectName` | 直接 |
| `productLine` | `payload.productLines[0] \|\| payload.productLine` | 取第一条 |
| `customer` | `payload.customerName \|\| payload.basicProjectInfo?.customerName` | 多层 fallback |
| `status` | `VersionRecord.status` | `draft→'进行中'`, `reviewed→'评审中'`, `published→'已发布'`, `archived→'已归档'` |
| `creator` | `createdByUsername` | 直接 |
| `updater` | `updatedByUsername` | 直接 |
| `updatedAt` | `updatedAt` | `.slice(0,10)` |

### 文件 3（可选）：`src/hooks/mapVersionStatus.js`

如果两个 adapter 共用的 status 映射逻辑超过 10 行，提取到一个共享 helper。不做强制要求。

---

## 编码规范（继承 B1 模式）

1. **守卫模式**：`enabled = isAuthenticated()` — 无 token 不调 API
2. **fallback 降级**：API 失败或未认证时返回 mock 数据，页面不白屏
3. **cancel race**：`useEffect` cleanup 设置 `cancelled = true`
4. **unwrap 兼容**：支持后端返回 `{data:[...]}` `[...]` `{items:[...]}` 三种 shape
5. **导入路径**：
   ```js
   import { apiClient } from '../api/client.js'
   import { isAuthenticated } from '../api/auth.js'
   ```

**模板**（参照 `useUsers.js`）：
```js
import { useEffect, useMemo, useState } from 'react'
import { apiClient } from '../api/client.js'
import { isAuthenticated } from '../api/auth.js'

function mapRecordToVM(record) { /* 映射逻辑 */ }

export default function useAssessmentList({
  enabled = isAuthenticated(),
  fallbackData = [],
} = {}) {
  const fallback = useMemo(() => fallbackData, [fallbackData])
  const [rows, setRows] = useState(fallback)
  const [loading, setLoading] = useState(Boolean(enabled))
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!enabled) { setRows(fallback); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    apiClient.get('/versions', { type: 'assessment' })
      .then(payload => {
        if (cancelled) return
        const list = /* unwrap */; const mapped = list.map(mapRecordToVM)
        setRows(mapped.length ? mapped : fallback)
      })
      .catch(err => { if (!cancelled) { setError(err); setRows(fallback) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [enabled, fallback])

  return { rows, loading, error }
}
```

### 页面接入

不改页面 JSX 结构，只改 import 源：

```diff
-import { assessments } from '../mock/listData.js'
+import useAssessmentList from '../hooks/useAssessmentList.js'
+import { assessments as mockAssessments } from '../mock/listData.js'

 // 在组件内：
-<ListPage data={assessments} ... />
+const { rows } = useAssessmentList({ fallbackData: mockAssessments })
+<ListPage data={rows} ... />
```

---

## 验收标准

1. `npm run build` 通过，无 warning
2. 两个 hook 可在浏览器 console import 并调用（无 token 时返回 fallback 数据）
3. mock 模式下页面视觉无变化（`assessments` 6 条 / `requirements` 3 条 完全一致）
4. status 映射覆盖：已检出 / 已检入 / 进行中 / 待评审 / 已归档 / 已发布 / 评审中
5. 带 token 时调 `/versions?type=assessment` 和 `/versions?type=requirementImport`，返回字段与 ViewModel 对齐

---

## 上下文文件速查

| 文件 | 说明 |
|---|---|
| `src/api/client.js` | apiClient（已就绪） |
| `src/api/auth.js` | `isAuthenticated()` |
| `src/hooks/useUsers.js` | B1 参考实现（守卫/cancel/unwrap 模式） |
| `src/hooks/useHistoryProjects.js` | B1 参考实现（多 API 聚合模式） |
| `src/hooks/useMock.js` | Mock 开关（`useMock()`, `isMockMode()`） |
| `src/mock/listData.js` L1-8, L10-14 | assessments + requirements mock 数据 |
| `src/pages/AssessmentList.jsx` | 目标页面 |
| `src/pages/RequirementList.jsx` | 目标页面 |
| `apps/api/src/types/index.ts` L228-277 | VersionRecord 类型定义 |
| `apps/api/src/routes/versions.routes.ts` | `/versions` route（10 个 endpoint） |
| `docs/PB-R3-PARALLEL/backend-cutover-plan.md` §2.2-2.3 | AssessmentListVM / RequirementVM 映射表 |

---

## 交付物

1. `ui/V2_PROTOTYPE/src/hooks/useAssessmentList.js`
2. `ui/V2_PROTOTYPE/src/hooks/useRequirementList.js`
3. 更新 `ui/V2_PROTOTYPE/src/pages/AssessmentList.jsx`（接入 hook）
4. 更新 `ui/V2_PROTOTYPE/src/pages/RequirementList.jsx`（接入 hook）
5. （可选）`ui/V2_PROTOTYPE/src/hooks/mapVersionStatus.js`

完成后请回复：每个文件的摘要 + 行数 + 自查是否满足验收标准。
