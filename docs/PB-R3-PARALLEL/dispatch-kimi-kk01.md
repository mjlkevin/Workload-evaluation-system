# KK-01 · A2 Mock Fallback + A3 ViewModel 类型定义

派发对象：KIMI CODE
任务类型：静态 JS 模块编写，无 UI 依赖
预估产出：~250 lines JS（2 个文件）
截止：完成即回传

---

## 背景

WES Phase B 正在把 `ui/V2_PROTOTYPE` 从静态 mock 数据切到真实后端。当前所有 18 个页面直接 `import { assessments } from '../../mock/listData'`。切换需要两样基础设施：

1. **Mock Fallback 开关** — 让每个页面可以双轨运行（mock / 真实 API），便于分批复核
2. **ViewModel 类型定义** — 统一前端 ViewModel 的 JSDoc 类型，让 adapter 有统一的 shape 可以对照

API Client 基座已由 Claude 完成，位于：
- `src/api/client.js` — `apiClient.get/post/patch/delete`，BASE=`/api/v1`，含 auth token 注入 + 401 跳登录 + error 包装
- `src/api/auth.js` — `getToken() / setToken() / clearToken() / isAuthenticated()`
- `src/api/errors.js` — `ApiError`（含 status/code/message/details）、`NetworkError`

---

## 任务 A2：Mock Fallback 机制

### 产出文件：`src/adapters/useMock.js`

### 需求

```js
// 全局 mock 开关
// 优先级：localStorage.USE_MOCK > env.VITE_USE_MOCK > 默认 true（开发期）
export function useMock() {
  // 读取 localStorage key 'USE_MOCK'（'true'/'false'）
  // 若未设置，回退 import.meta.env.VITE_USE_MOCK
  // 若仍未设置，默认返回 true
  // 同时暴露 setter：window.__setUseMock(true|false) 方便 DevTools 切换
}
```

### 行为规格

1. `useMock()` 是一个无参函数，返回 `boolean`
2. 首次调用时从 localStorage 读 `USE_MOCK`，若不存在读 `import.meta.env.VITE_USE_MOCK`，若仍不存在→`true`
3. 同时在 `window.__setUseMock = (v) => { localStorage.setItem('USE_MOCK', String(v)); }` 挂一个全局 setter
4. 同时在 `window.__getUseMock = () => useMock()` 挂一个 getter
5. 页面用法：
   ```js
   import { useMock } from '@/adapters/useMock'
   import { assessments as mockData } from '@/mock/listData'
   
   const data = useMock() ? mockData : await fetchRealData()
   ```

### 验收

- DevTools console 执行 `__setUseMock(false)` → `useMock()` 返回 `false`
- DevTools console 执行 `__setUseMock(true)` → `useMock()` 返回 `true`
- 刷新页面后 `useMock()` 保持上次设置（localStorage 持久化）

---

## 任务 A3：ViewModel 类型定义

### 产出文件：`src/viewModels/types.js`

### 需求

用 JSDoc `@typedef` 定义 8 个 ViewModel 类型。**不需要导出任何值，只需要类型注释**。这些类型供后续 adapter 文件和 IDE 智能提示使用。

```js
/**
 * @typedef {Object} PlanVM
 * @property {string}  id
 * @property {string}  projectName
 * @property {string}  globalVersion     // ← VersionRecord.baseCode
 * @property {string}  status            // '已检出'|'已检入'|'已归档'
 * @property {boolean} checkedOut
 * @property {number}  mandays           // ← payload.totalDays
 * @property {string}  owner
 * @property {string}  updatedAt         // YYYY-MM-DD
 */

/**
 * @typedef {Object} AssessmentListVM
 * @property {number}  id
 * @property {string}  projectName
 * @property {string}  productLine
 * @property {string}  globalVersion
 * @property {string}  assessmentVersion // ← versionCode
 * @property {string}  quoteMode
 * @property {number}  totalDays
 * @property {number}  orgCount
 * @property {number}  difficultyFactor
 * @property {string}  status            // 已检出|已检入|进行中|待评审|已归档
 * @property {string}  owner
 * @property {string}  updatedAt
 */

/**
 * @typedef {Object} RequirementListVM
 * @property {string}  id
 * @property {string}  globalVersion
 * @property {string}  versionCode
 * @property {string}  projectName
 * @property {string}  productLine
 * @property {string}  customer          // ← payload.customerName / BasicProjectInfo.customerName
 * @property {string}  status            // 草稿|已审核|已发布
 * @property {string}  creator
 * @property {string}  updater
 * @property {string}  updatedAt
 */

/**
 * @typedef {Object} DevAssessmentListVM
 * @property {number}  id
 * @property {string}  projectName
 * @property {string}  globalVersion
 * @property {string}  devVersion        // ← versionCode
 * @property {string}  assessor
 * @property {number}  totalDays
 * @property {string}  status
 * @property {string}  owner
 * @property {string}  updatedAt
 */

/**
 * @typedef {Object} ResourceCostListVM
 * @property {number}  id
 * @property {string}  projectName
 * @property {string}  globalVersion
 * @property {string}  resourceVersion   // ← versionCode
 * @property {string}  quoteMode
 * @property {number}  totalDays
 * @property {number}  orgCount
 * @property {string}  status
 * @property {string}  owner
 * @property {string}  updatedAt
 */

/**
 * @typedef {Object} HistoryProjectVM
 * @property {number}  id
 * @property {string}  projectName       // ← HistoryProjectRow.projectName
 * @property {string}  customer          // ← customerName
 * @property {string}  industry
 * @property {string}  scale
 * @property {string}  version
 * @property {number}  similarity        // ← similarityScore（来自 /history/similar）
 * @property {number}  totalDays         // ← actualDays ?? estimatedDays
 * @property {number}  totalAmount       // ← actualCost ?? estimatedCost（单位：万元）
 * @property {number}  year
 * @property {string}  status
 * @property {string}  updatedAt
 */

/**
 * @typedef {Object} ReviewListVM
 * @property {string}  id
 * @property {string}  projectName
 * @property {string}  version
 * @property {string}  reviewers          // 逗号分隔的人名字符串
 * @property {string}  deadline           // YYYY-MM-DD
 * @property {string}  status             // 待评审|已通过|驳回
 * @property {string}  updatedAt
 */

/**
 * @typedef {Object} UserVM
 * @property {string}  id
 * @property {string}  username
 * @property {string}  role               // admin|sub_admin|user
 * @property {string}  status             // active|disabled
 * @property {string}  lastLoginAt
 * @property {boolean} locked             // 前端策略：admin 不可被降权/删除
 */
```

### 字段映射关键规则

这些规则来自 `api-alignment-audit.md` §3：

| ViewModel 字段 | 后端来源 | 转换 |
|---|---|---|
| `globalVersion` | `VersionRecord.baseCode` | 直接 |
| `status` (列表页) | `VersionRecord.checkoutStatus` + `versionDocStatus` | `checked_out + drafting → 已检出`; `checked_in + reviewed → 已检入`; `checked_in + drafting → 进行中` |
| `owner` | `checkedOutByUsername \|\| updatedByUsername` | 优先检出人 |
| `totalDays` | `VersionRecord.payload.totalDays` | JSON payload |
| `updatedAt` | `VersionRecord.updatedAt` | `slice(0,10)` |

### 验收

- 文件语法正确（IDE 无红色波浪线）
- 8 个 typedef 全部定义，每个至少 6 个字段
- 对照 `ui/V2_PROTOTYPE/src/mock/listData.js` 的 8 个数据集，确保每个 ViewModel 的字段名与 mock 数据字段名一致（这样后续 adapter 改造成本最低）

---

## 上下文文件速查

| 文件 | 说明 |
|---|---|
| `ui/V2_PROTOTYPE/src/api/client.js` | 已完成的 API Client |
| `ui/V2_PROTOTYPE/src/api/errors.js` | ApiError / NetworkError |
| `ui/V2_PROTOTYPE/src/api/auth.js` | Token 管理 |
| `ui/V2_PROTOTYPE/src/mock/listData.js` | 当前 8 个 mock 数据集，ViewModel 字段应与这些一致 |
| `apps/api/src/types/index.ts` | 后端 type 定义（VersionRecord L237-277, PublicUser L201, HistoryProjectRow 等） |
| `docs/PB-R3-PARALLEL/api-alignment-audit.md` §3 | 实体维度对照分析 |
| `docs/PB-R3-PARALLEL/backend-cutover-plan.md` §2 | ViewModel 映射表 |

---

## 交付物

1. `ui/V2_PROTOTYPE/src/adapters/useMock.js`
2. `ui/V2_PROTOTYPE/src/viewModels/types.js`

完成后请回复：每个文件的摘要 + 行数 + 自查是否满足验收标准。
