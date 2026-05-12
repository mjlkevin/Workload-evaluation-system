# Phase B · Backend Cutover 工作计划

> 目标：把 `ui/V2_PROTOTYPE` 18 个页面从静态 mock 数据切到 `apps/api` 真实后端（`/api/v1/*`，142+ endpoints）
> 前置审计：`api-alignment-audit.md`（已完成，实体对照 + 缺口清单）
> 工作量预估：2.5–3 周（含 adapter 层建设 + 18 页切 + 回归验收）
> 日期：2026-05-10

---

## 0. 核心原则

**Rule 0 — Adapter First**：页面永远不直接 `fetch()` 后端 route response。所有数据走 `apiClient → adapter → ViewModel` 三跳。原因是后端字段命名 (`snake_case`/domain model) 与前端 UI ViewModel 语义差异大，不加适配层会导致页面逻辑被接口 shape 绑架。

**Rule 1 — 只读优先**：先切 GET/list 页，verify 数据还原度 100% 后再切 mutation（检出/检入/升版/保存）。

**Rule 2 — Mock Fallback 双轨**：切后端期间保留 mock 数据，通过 `USE_MOCK` 开关 (env/localStorage) 随时可回退。每切完一批在 DevServer 上同时验证开关开/关两个路径。

**Rule 3 — 批次原子性**：每批 2-3 页（或一个功能域），切完一批验收一批，不跨批积压。

---

## 1. 三层架构设计

```
Page (JSX)
  ↓  import { useViewModel } from '../adapters/useAssessmentDetail'
ViewModel Hook (adapter/use*.js)
  ↓  调用 apiClient + 转换 domain → ViewModel
API Client (api/client.js)
  ↓  fetch(/api/v1/...) + auth header + error wrap
Backend Express Routes
```

### 1.1 API Client 基座（`api/client.js`）

```js
// 最少接口
const apiClient = {
  get(path, params)    → fetch(`${BASE}${path}?${new URLSearchParams(params)}`)
  post(path, body)     → fetch with JSON body
  patch(path, body)    → fetch with JSON body
  delete(path)         → fetch
  // 统一行为
  // - BASE = '/api/v1'（devServer proxy 到 localhost:3000）
  // - headers: Authorization: Bearer <token>
  // - 非 2xx → throw ApiError{status, code, message}
  // - 401 → redirect /login
  // - 网络错误 → throw NetworkError
}
```

**文件清单**：
| 文件 | 作用 |
|---|---|
| `src/api/client.js` | fetch wrapper + error handling |
| `src/api/auth.js` | login/logout/token 管理 |
| `src/api/errors.js` | ApiError / NetworkError 类 |

### 1.2 ViewModel 类型体系

当前 mock 字段 → 后端字段映射表（见 §2），每个 ViewModel 一个 adapter 文件。

---

## 2. ViewModel 映射表（按实体）

### 2.1 PlanVM（方案列表 / HomePage / 各 list 页共用）

| ViewModel 字段 | 后端来源 | 转换逻辑 |
|---|---|---|
| `id` | `VersionRecord.id` | 直接 |
| `projectName` | `VersionRecord.payload.projectName` | 从 JSON payload 取 |
| `globalVersion` | `VersionRecord.baseCode` | 直接 |
| `status` | `VersionRecord.checkoutStatus` | `checked_out→已检出`, `checked_in→已检入` |
| `checkedOut` | `VersionRecord.checkoutStatus` | `=== 'checked_out'` |
| `mandays` | `VersionRecord.payload.totalDays` | 直接 |
| `owner` | `VersionRecord.checkedOutByUsername \|\| VersionRecord.updatedByUsername` | 优先检出人 |
| `updatedAt` | `VersionRecord.updatedAt` | `slice(0,10)` |

**数据来源**：`GET /api/v1/versions?type=assessment` + `GET /api/v1/versions?type=global` 合并。

### 2.2 AssessmentListVM

| ViewModel 字段 | 后端来源 | 转换逻辑 |
|---|---|---|
| `id` | `VersionRecord.id` | 直接 |
| `projectName` | `payload.projectName` | JSON payload |
| `productLine` | `payload.productLine` | 从 payload |
| `globalVersion` | `baseCode` | 直接 |
| `assessmentVersion` | `versionCode` | 直接 |
| `quoteMode` | `payload.quoteMode` | 直接 |
| `totalDays` | `payload.totalDays` | `EstimatedResult.totalDays` |
| `orgCount` | `payload.orgCount` | 计算参数 |
| `difficultyFactor` | `payload.difficultyFactor` | 计算参数 |
| `status` | `checkoutStatus + versionDocStatus` | 状态机映射 |
| `owner` | `checkedOutByUsername` | 直接 |
| `updatedAt` | `updatedAt` | `slice(0,10)` |

**数据来源**：`GET /api/v1/versions?type=assessment`。若 payload 未展平 → 需要后端 BFF `/api/v1/assessments`。

### 2.3 RequirementVM

| ViewModel 字段 | 后端来源 | 转换逻辑 |
|---|---|---|
| `id` | `VersionRecord.id` | 直接 |
| `globalVersion` | `VersionRecord.baseCode` | 直接 |
| `versionCode` | `VersionRecord.versionCode` | 直接 |
| `projectName` | `payload.projectName` | JSON payload |
| `productLine` | `payload.productLines[0]` | 取第一条产品线 |
| `customer` | `payload.customerName` | RequirementImportData.basicProjectInfo |
| `status` | `VersionRecord.status` | `draft→草稿`, `reviewed→已审核`, `published→已发布` |
| `creator` | `createdByUsername` | 直接 |
| `updater` | `updatedByUsername` | 直接 |
| `updatedAt` | `updatedAt` | `slice(0,10)` |

**数据来源**：`GET /api/v1/versions?type=requirementImport`。

### 2.4 RequirementDetailVM

Codex 已定义好页面展示结构（6+1 区），adapter 需将 `RequirementImportData` 映射进去：

| 页面区域 | 数据来源 | API |
|---|---|---|
| `BASIC_FIELDS` | `BasicProjectInfo` (10 字段) | `GET /api/v1/presales/requirement-packs/:id` → `RequirementPack.importData.basicProjectInfo` |
| `VALUE_ITEMS` | `RequirementValuePropositionRow[]` (3 行) | 同上 |
| `SCOPE_ROWS` | `RequirementBusinessNeedRow[]` + DSL 校验注入 | 同上 + `GET /api/v1/presales/requirement-packs/:id/review` |
| `EXTRA_CARDS` | 组合 importData + review | 同上 |
| `VERSION_TIMELINE` | VersionRecord 升版历史 | `GET /api/v1/versions?baseCode=xxx` |
| `completionStats` | 前端计算 | stats = f(scope rows completed/total) |

### 2.5 DevAssessmentVM

| ViewModel | 后端 |
|---|---|
| `id` → `DevAssessment.id` | `GET /api/v1/dev-assessments` |
| `devVersion` → `versionCode` | 直接 |
| `assessor` → `assessorUserId/Username` | 查关联 |
| `totalDays` → `payload.totalDays` | 直接 |
| `status` → `status` | 直接 |

### 2.6 HistoryProjectVM

| ViewModel | 后端 `HistoryProjectRow` |
|---|---|
| `projectName` → `projectName` | 直接 |
| `customer` → `customerName` | 映射 |
| `industry` → `industry` | 直接 |
| `totalDays` → `actualDays \|\| estimatedDays` | 优先实际 |
| `totalAmount` → `actualCost \|\| estimatedCost` | 优先实际 |
| `similarity` → `similarityScore` | 来自 `/history/similar` |
| `version` → `versionCode` | 直接 |
| `year` → `closedYear` | 取年份 |

### 2.7 ResourceCostVM

当前无直接对应后端 Route（审计缺口 #2-3）。两种策略：
- A) 短路径：从 `GET /api/v1/versions?type=resource` 的 `payload` 中序列化 resource cost JSON
- B) 长路径：补 BFF `GET /api/v1/resource-costs` + `GET /api/v1/resource-costs/:id/view`

建议先用 A 路径（payload 承载），若 payload 结构不足再补 B。

### 2.8 ReviewVM / WbsVM / UserVM / ApiKeyVM

| ViewModel | 后端来源 | 备注 |
|---|---|---|
| ReviewVM | `GET /api/v1/pm/reviews` + `GET /api/v1/teams/:teamId/reviews` | 需聚合 PM + Team review |
| WbsVM | `GET /api/v1/wbs` 或 `GET /api/v1/pm/deliverables(type=wbs)` | 待确认后端 WBS shape |
| UserVM | `GET /api/v1/auth/users` → `PublicUser[]` | 字段对齐度高 |
| ApiKeyVM | **后端缺口**，暂无 `/api/v1/api-keys` CRUD | blocked 或保留 mock |

---

## 3. 阶段拆分（4 阶段 × 10 批次）

### 阶段 A：基础设施（1 天） — 所有后续工作的前提

| 批次 | 内容 | 产出物 | 验收标准 |
|---|---|---|---|
| A1 | API Client 基座 | `src/api/client.js`, `src/api/auth.js`, `src/api/errors.js` | 浏览器 console 可调用 `apiClient.get('/versions')` 返回数据 |
| A2 | Mock Fallback 机制 | `src/api/useMock.js`，全局开关 `USE_MOCK`（env + localStorage fallback） | `USE_MOCK=true` → 走 mock 数据；`false` → 走真实 API |
| A3 | ViewModel 类型定义 | `src/viewModels/types.js`（PlanVM, AssessmentVM, RequirementVM, DevAssessmentVM, HistoryProjectVM, ResourceCostVM, ReviewVM, UserVM） | Type 导入无报错，字段覆盖率对照审计文档 100% |

**阶段 A 可并行任务**：
- KIMI CODE：A2 + A3（Mock fallback + 8 个 ViewModel type 定义，纯 JS 无 UI 依赖）
- ChatGPT：A1（API client base，fetch wrapper + error handling + auth token 注入）
- Kevin 本人：A1 review + 登录态对接（`/auth/me` token 持久化策略）

**阶段 A 完成标志**：`apiClient.get('/health')` 返回 `{status:'ok'}`，DevServer port 3003 可代理到 port 3000。

---

### 阶段 B：只读列表页（6 天） — 核心页面切

| 批次 | 内容 | 页面 | 产出物 | 验收标准 |
|---|---|---|---|---|
| B1 | 用户管理 + 历史项目 | `UserManagement.jsx`, `HistoryList.jsx`, `HistoryDetail.jsx` | `adapters/useUsers.js`, `adapters/useHistoryProjects.js`, `adapters/useHistoryDetail.js` | 3 页列表数据来自 `/auth/users` + `/history/projects`，渲染结果与 mock 视觉一致 |
| B2 | 评估列表 + 需求列表 | `AssessmentList.jsx`, `RequirementList.jsx` | `adapters/useAssessmentList.js`, `adapters/useRequirementList.js` | 6 + 3 条数据来自 `/versions?type=assessment` + `/versions?type=requirementImport` |
| B3 | 开发评估列表 + 资源成本列表 + WBS | `DevAssessmentList.jsx`, `ResourceCostList.jsx`, `WbsList.jsx` | `adapters/useDevAssessmentList.js`, `adapters/useResourceCostList.js`, `adapters/useWbsList.js` | 3 页数据来自对应 API |
| B4 | 评审列表 + 首页 | `ReviewList.jsx`, `HomePage.jsx` | `adapters/useReviews.js`, `adapters/useHomeDashboard.js` | ReviewList 来自 PM review + team review 聚合；HomePage 4 KPI + 方案列表来自 `/versions` |

**阶段 B 可并行任务**（4 批之间依赖弱，可拆分到 3 个 agent 并行）：
- KIMI CODE：B1（UserManagement + History 2 页，字段对齐度高，风险低）
- ChatGPT：B2（AssessmentList + RequirementList，核心列表，字段映射中等复杂度）
- Kevin：B3 + B4（Dev/Resource/WBS/Review/HomePage，需要更多架构决策）

**阶段 B 完成标志**：8/18 列表页切后端完成，USE_MOCK=false 时每页至少渲染 2 条真实数据。

---

### 阶段 C：详情页（7 天） — 最复杂的聚合适配

| 批次 | 内容 | 页面 | 产出物 | 验收标准 |
|---|---|---|---|---|
| C1 | AssessmentDetail | `AssessmentDetail.jsx` + 12 组件 | `adapters/useAssessmentDetail.js`（聚合 `/versions/:id` + `/templates` + `/rule-sets` + `/estimates/calculate`） | KPI 数字、SKU 表格、DSL 校验、VCS 状态、路径面包屑 5 个区域数据来自后端 |
| C2 | RequirementDetail | `RequirementDetail.jsx` | `adapters/useRequirementDetail.js`（映射 6+1 区：BASIC_FIELDS/VALUE_ITEMS/SCOPE_ROWS/EXTRA_CARDS/VERSION_TIMELINE/completionStats） | 6 个区域数据完整，SCOPE_ROWS 含 group/error/total 行 + DSL violation 注入 |
| C3 | DevAssessmentDetail + ResourceCostDetail | `DevAssessmentDetail.jsx`, `ResourceCostDetail.jsx` | `adapters/useDevAssessmentDetail.js`, `adapters/useResourceCostDetail.js` | 详情表格数据来源切换，factor/diff 字段为前端计算保留 |
| C4 | ReviewDetail | `ReviewDetail.jsx` | `adapters/useReviewDetail.js`（聚合 `/pm/reviews` + `/pm/deliverables` + `/pm/seal` + `/pm/handoffs`） | 印章、交付件、checklist、comment 四区域数据就绪 |

**阶段 C 可并行任务**：
- KIMI CODE：C3（DevAssessmentDetail + ResourceCostDetail，结构相对简单）
- ChatGPT：C4（ReviewDetail，PM 接口聚合）
- Kevin：C1 + C2（最复杂的两个详情页，C2 需要 Codex 的 RequirementDetail 新 ViewModel 结构适配）

**阶段 C 完成标志**：5/5 详情页切后端完成，每个详情页至少展示 3 个数据区域。

---

### 阶段 D：写操作 + 系统管理 + 全量验收（5 天）

| 批次 | 内容 | 产出物 | 验收标准 |
|---|---|---|---|
| D1 | VCS 写操作 | `adapters/useVcs.js`（checkout/checkin/undo/promote/force-unlock → `/versions/:id/*`） | 检出/检入按钮触发真实 API，刷新后数据一致 |
| D2 | 系统管理 + API Keys | `adapters/useSystemConfig.js`（规则/模板/DSL 配置切 `/system/*` + `/templates`）；ApiKeys 若后端未补 CRUD 则保留 mock | 系统管理 4 区域数据来源切换；ApiKeys 标注 blocked 状态 |
| D3 | 全量验收 | 18 route smoke checklist（复用 PB-R3 smoke checklist），console 0 error/warning | 18/18 页通过验收，USE_MOCK=false |

**阶段 D 可并行任务**：
- KIMI CODE：D2（SystemManagement + ApiKeys，纯配置页）
- ChatGPT：D1（VCS 写操作，涉及 6 个 mutation）
- Kevin：D3（全量验收 + edge case 修复）

**阶段 D 完成标志**：全栈验收通过，18 页 USE_MOCK=false 运行时无 mock 依赖。

---

## 4. 并行任务分发设计

### 4.1 KIMI CODE 任务包（6 个独立任务）

| ID | 任务 | 阶段 | 产出行数(估) | 前置依赖 |
|---|---|---|---|---|
| KK-01 | Mock fallback 机制 + ViewModel types | A2+A3 | ~200 lines JS | 无 |
| KK-02 | UserManagement + HistoryList/Detail adapter | B1 | ~250 lines JS | A1 |
| KK-03 | DevAssessmentDetail + ResourceCostDetail adapter | C3 | ~300 lines JS | B3 |
| KK-04 | SystemManagement adapter | D2 | ~200 lines JS | B4 |

KIMI CODE 特点：适合静态结构定义、类型转换函数、纯逻辑无 UI。每批交付 adapter 文件 + 单元断言。

### 4.2 ChatGPT 任务包（6 个独立任务）

| ID | 任务 | 阶段 | 产出行数(估) | 前置依赖 |
|---|---|---|---|---|
| CG-01 | API Client 基座 | A1 | ~150 lines JS | 无 |
| CG-02 | AssessmentList + RequirementList adapter | B2 | ~300 lines JS | A1 |
| CG-03 | ReviewDetail adapter（PM 多接口聚合） | C4 | ~350 lines JS | B4 |
| CG-04 | VCS 写操作 adapter | D1 | ~250 lines JS | C1 |

ChatGPT 特点：适合多接口聚合逻辑、状态机映射、error handling。每批交付 adapter + mock diff 对照表。

### 4.3 Kevin 核心任务（5 个）

| ID | 任务 | 阶段 | 说明 |
|---|---|---|---|
| KV-01 | API Client review + 登录态对接 | A1 | `auth/me` → token store，Vite proxy 配置 |
| KV-02 | Dev/Resource/WBS/Review List + HomePage adapter | B3+B4 | 架构决策密集型 |
| KV-03 | AssessmentDetail adapter | C1 | 组合 versions + templates + rules + estimates |
| KV-04 | RequirementDetail adapter（Codex 新 ViewModel） | C2 | 6+1 区映射 + DSL violation 注入逻辑 |
| KV-05 | 全量验收 | D3 | smoke checklist + edge case fix + final review |

---

## 5. 文件产出清单（预估）

```
ui/V2_PROTOTYPE/src/
├── api/
│   ├── client.js           # fetch wrapper (CG-01)
│   ├── auth.js             # token store + login/logout
│   └── errors.js           # ApiError / NetworkError
├── adapters/
│   ├── useMock.js          # mock fallback 开关 (KK-01)
│   ├── useUsers.js         # → UserManagement (KK-02)
│   ├── useHistoryProjects.js  # → HistoryList (KK-02)
│   ├── useHistoryDetail.js    # → HistoryDetail (KK-02)
│   ├── useAssessmentList.js   # → AssessmentList (CG-02)
│   ├── useRequirementList.js  # → RequirementList (CG-02)
│   ├── useDevAssessmentList.js  # → DevAssessmentList (KV-02)
│   ├── useResourceCostList.js   # → ResourceCostList (KV-02)
│   ├── useWbsList.js            # → WbsList (KV-02)
│   ├── useReviews.js            # → ReviewList (KV-02)
│   ├── useHomeDashboard.js      # → HomePage (KV-02)
│   ├── useAssessmentDetail.js   # → AssessmentDetail (KV-03)
│   ├── useRequirementDetail.js  # → RequirementDetail (KV-04)
│   ├── useDevAssessmentDetail.js  # → DevAssessmentDetail (KK-03)
│   ├── useResourceCostDetail.js   # → ResourceCostDetail (KK-03)
│   ├── useReviewDetail.js         # → ReviewDetail (CG-03)
│   ├── useVcs.js                  # → VCS mutations (CG-04)
│   └── useSystemConfig.js         # → SystemManagement (KK-04)
├── viewModels/
│   └── types.js             # PlanVM, AssessmentVM, RequirementVM, ... (KK-01)
```

总计：~17 adapter 文件 + 3 api 文件 + 1 types 文件 = ~21 个新文件，~3500 行代码。

---

## 6. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|
| `VersionRecord.payload` 结构不统一，不同 type 的 payload shape 差异大 | 高 | adapter 复杂度翻倍 | B1 前先写 `payload` structure doc，对每种 type 抽样读 2 条 |
| AssessmentDetail 需 4 个 API 聚合，网络瀑布慢 | 中 | 首屏延迟 >2s | 阶段 C1 预留 BFF fallback 方案（`/assessments/:id/view` 一次返回） |
| 后端 `/wbs` 返回 shape 与 mock 差异大 | 中 | WbsList adapter 重写 | B3 前先调 `/wbs` 看返回结构，若 shape 不足直接补后端 |
| ApiKeys CRUD 后端未实现 | 高 | 页面 blocked | D2 保留 mock；后端补 CRUD 放到下一次迭代 |
| ResourceCost 无直接 endpoint | 中 | 两次方案选一 | 先用 VersionRecord.payload；不足则补 BFF |

---

## 7. 时间线

```
Week 1 (5/12–5/16)
  Mon-Tue: 阶段 A — API Client 基座 + Mock Fallback + Types
  Wed-Fri: 阶段 B — B1 + B2（5 个列表页）

Week 2 (5/19–5/23)
  Mon-Wed: 阶段 B — B3 + B4（5 个列表页 + HomePage）
  Thu-Fri: 阶段 C — C1 起手（AssessmentDetail，最复杂）

Week 3 (5/26–5/30) — 预留 + buffer
  Mon-Wed: 阶段 C — C2 + C3 + C4（4 个详情页）
  Thu: 阶段 D — D1 + D2（写操作 + 系统管理）
  Fri: 阶段 D — D3 全量验收 + bug fix

若压缩到 2.5 周：Week 2 后半段并行 C1+C2，Week 3 压缩 D1+D2→1 天+D3→1 天。
```

---

## 8. 下步行动

1. **立即启动**：Kevin 确认计划后，我（Claude）写 A1 API Client 基座代码（~150 lines）。
2. **派发**：同步生成 KIMI CODE 的 KK-01 prompt（Mock fallback + ViewModel types）+ ChatGPT 的 CG-01 prompt（API Client）。
3. **第一道闸门**：A1+A2+A3 完成 → Kevin review → 进入阶段 B。

---

*计划版本：v1.0 · 2026-05-10 · Claude (Claude Code)*
