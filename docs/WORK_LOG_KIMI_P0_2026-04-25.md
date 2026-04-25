# Kimi (Kimi Code CLI) · P0 工作日志

> **工作范围**：基于 Claude 已完成的 T1~T4 代码（`.claude/worktrees/hardcore-mcclintock-0481fd/`），继续推进 T5~T8。  
> **目标文档**：`重构执行计划-P0-2026-04-24.md`  
> **基线文档**：`需求深度分析-重构方案-v2-2026-04-22.html`（每个 T 完成后同步更新）

---

## 0. 接手指引（2026-04-25 12:15）

### 0.1 环境确认

| 项 | 状态 | 说明 |
|---|---|---|
| Postgres.app | ✅ | localhost:5432 |
| `workload_eval` 库 | ✅ | dev 数据 |
| `workload_eval_test` 库 | ✅ | 测试数据 |
| `apps/api/.env.local` | ✅ | 含 `DATABASE_URL` |
| worktree 路径 | ✅ | `.claude/worktrees/hardcore-mcclintock-0481fd/` |

### 0.2 初始扫描结果

Claude 已完成 T1 / T2 / DB / T3 / T4，代码全部在 worktree 中。

| 测试 | 初始状态 | 说明 |
|---|---|---|
| `test:ai` | ✅ 11/11 pass | T1~T4 新写测试 |
| `test:rules` | ✅ 8/8 pass | 规则引擎 |
| `test:modules` | ❌ 28/32 pass | 2 个历史问题 |
| `test:integration` | ❌ 0/1 | 需启动服务器（正常） |
| `tsc --noEmit` | ❌ 3 错误 | 历史遗留 |

### 0.3 基线修复（接手后第一步）

**修复 1：worktree 缺失 `src/modules/exports/` 目录**
- 主项目有 `exports.module.ts` + `exports.usecase.ts`
- worktree 中该目录缺失（可能是 worktree 创建时遗漏）
- **操作**：从主项目复制 2 个文件到 worktree
- **结果**：`test:modules` 崩溃修复，`tsc` 3 个历史错误消除

**修复 2：handlers 测试适配 T4 Provider 架构**
- 3 个 `ai.usecase` 测试（`kimiAssessmentPreview`）直接 mock `globalThis.fetch`
- T4 迁移后，需先 `bootstrapAiProviders()` 注册 provider 到 `defaultProviderRegistry`
- **操作**：
  - 导入 `bootstrapAiProviders` + `_resetAiBootstrapForTest`
  - 3 个测试 try 块开头添加 `bootstrapAiProviders()`
  - 3 个测试 finally 块添加 `_resetAiBootstrapForTest()`

**修复 3：timeout 测试断言更新**
- T4 后 `toFriendlyFallbackReason("kimi_request_timeout")` 返回中文 `"等待 Kimi 响应超时，已自动降级为规则回填"`
- 旧测试断言 `/timeout/i` 不匹配
- **操作**：断言改为 `/超时|kimi_request_timeout/i`

### 0.4 修复后基线

| 测试 | 结果 |
|---|---|
| `test:ai` | ✅ 11/11 pass |
| `test:rules` | ✅ 8/8 pass |
| `test:modules` | ✅ **39/39 pass** |
| `test:integration` | 需启动服务器（正常） |
| `tsc --noEmit` | ✅ **0 错误** |

---

## 1. T5 — Evidence / change_log 持久化（✅ 已完成 2026-04-25）

### 交付物

| 文件 | 说明 |
|---|---|
| `src/ai/repository/evidence.repository.ts` | EvidenceRepository（保存 / 查询 / history 追加） |
| `src/ai/repository/index.ts` | barrel export |
| `src/ai/repository/evidence.repository.test.ts` | 7 条集成测试 |
| `drizzle/0001_furry_gambit.sql` | extraction_results + change_logs 建表 migration |
| `drizzle/meta/_journal.json` | migration 日志更新 |

### 关键设计决策

- **Repository 接受可注入 `dbInstance`**：构造函数 `new EvidenceRepository(dbInstance?)`，默认用全局单例；测试时传入测试库 client
- **事务保证一致性**：`saveExtractionResult` 和 `appendEvidenceHistory` 都走 `db.transaction`
- **history + change_logs 双写**：`appendEvidenceHistory` 同时更新 `evidences.history`（jsonb）和写入 `change_logs` 行
- **测试库隔离**：`workload_eval_test`，每测 `TRUNCATE ... RESTART IDENTITY CASCADE`

### 验收结果

| 测试 | 结果 |
|---|---|
| `test:ai`（含 repository） | **18/18 pass** |
| `test:modules` | **39/39 pass** |
| `test:rules` | **8/8 pass** |
| `tsc --noEmit` | **0 错误** |

### DB 迁移执行记录

```bash
npm run db:generate  # 生成 0001_furry_gambit.sql
npm run db:migrate   # 应用到 workload_eval（dev）
DATABASE_URL=... npm run db:migrate  # 应用到 workload_eval_test
```

两张新表已上线：
- `extraction_results`：12 列 + 2 索引
- `change_logs`：12 列 + 3 索引

---

## 2. T6 — DSL 引擎雏形 + sow-completeness-v1（✅ 已完成 2026-04-25）

### 交付物

| 文件 | 说明 |
|---|---|
| `src/dsl/types.ts` | DSL 核心类型（DslRule / RuleContext / RuleViolation / RuleSeverity） |
| `src/dsl/engine.ts` | 规则执行引擎（evaluate / evaluateOne） |
| `src/dsl/rules/sow-completeness-v1.ts` | 第一条规则 |
| `src/dsl/index.ts` | barrel export |
| `src/dsl/engine.test.ts` | 10 条测试 |

### 关键设计决策

- **Rule 接口**：声明式，`id + name + description + check(context)` 函数
- **evaluate 引擎**：顺序执行、异常隔离（单条规则抛错不阻断其他规则）、结果合并
- **sow-completeness-v1**：
  - 检查 4 个核心 fieldPath：`sow.organizationScope` / `sow.moduleScope` / `sow.developmentScope` / `sow.wbs`
  - 支持 fallback 路径兼容旧命名（`requirementImportData.xxx`）
  - 开发范围 `allowEmptyValue=true`（允许"无"），其余三项必须非空
  - severity 分级：组织/模块/WBS = `error`，开发范围 = `info`

### SOW 分析支撑

基于用户提供的 3 份 SOW 文档（简版模板 / 标准版模板 / 利民实例），产出：
- `docs/SOW深度分析总结-2026-04-25.md`
- 确认 4 项检查边界：组织范围、模块范围、开发范围（允许"无"）、WBS

### 验收结果

| 测试 | 结果 |
|---|---|
| `test:ai`（28 条，含 T1-T6） | **28/28 pass** |
| `test:modules` | **39/39 pass** |
| `test:rules` | **8/8 pass** |
| `tsc --noEmit` | **0 错误** |

---

## 3. T7 — 7 角色 RBAC 常量 + 权限矩阵（✅ 已完成 2026-04-25）

### 交付物

| 文件 | 说明 |
|---|---|
| `src/rbac/roles.ts` | 7 角色常量 + 旧角色映射（admin→ADMIN, sub_admin→PM, user→PRE_SALES） |
| `src/rbac/permissions.ts` | 25 个能力位 + 权限矩阵 + 查询 helpers |
| `src/rbac/middleware.ts` | `requireCapability` / `requireAnyCapability` / `requireV2Role` 中间件 |
| `src/rbac/index.ts` | barrel export |
| `src/rbac/roles.test.ts` | 19 条测试 |

### 7 角色能力位速查

| 角色 | 核心能力 |
|---|---|
| SALES | 发起评估、读评估包、发起合同 |
| PRE_SALES | 读评估包、上传物料、触发 Extractor、维护需求包、Evidence 读 |
| IMPL | 创建初评、拉开发顾问、写假设、Evidence 读写 |
| PM | 读评估包、接力初评、调人天/系数、生成交付物、Evidence 读 |
| DEV | 读开发条目、写开发人天 |
| PMO | 审核交付物、驳回交付物、Evidence 读 |
| ADMIN | DSL/模板/RateCard/方法论/规则/用户/系统管理、Evidence 读写 |

### 中间件使用方式

```ts
router.post("/extractor", requireCapability("extractor:trigger"), handler);
router.post("/deliverable", requireAnyCapability("deliverable:review", "deliverable:reject"), handler);
```

### 关键设计

- **旧角色兼容**：P0 不迁 users.json，RBAC 层做映射（admin→ADMIN, sub_admin→PM, user→PRE_SALES）
- **JWT 不变**：复用现有 `role` 字段，服务端映射
- **v2Roles 挂载到 req**：下游 handler 可通过 `req.v2Roles` 获取映射后的角色
- **能力位命名**：`domain:action`（如 `evidence:read`、`extractor:trigger`）

### 验收结果

| 测试 | 结果 |
|---|---|
| `test:ai`（47 条，含 T1-T7） | **47/47 pass** |
| `test:modules` | **39/39 pass** |
| `test:rules` | **8/8 pass** |
| `tsc --noEmit` | **0 错误** |

---

## 4. T8 — IA 初评冒烟测试（✅ 已完成 2026-04-25）

### 交付物

| 文件 | 说明 |
|---|---|
| `src/ai/smoke/ia-initial-smoke.test.ts` | 6 条冒烟测试 |
| `src/test-helpers/db.ts` | 共享测试数据库模块（避免多 Pool 并发死锁） |

### 验收路径验证

| 步骤 | 组件 | 验证 |
|---|---|---|
| 1. 模拟抽取 | RequirementExtractor + Evidence 契约 | 产出含 5 条证据的 ExtractionResult |
| 2. 证据入库 | EvidenceRepository（T5） | `saveExtractionResult` 原子写入头+明细 |
| 3. DB 查询 | EvidenceRepository（T5） | `findByExtractionId` 反向组装完整结果 |
| 4. DSL 校验 | `evaluate([sowCompletenessV1], context)`（T6） | 4 项齐全 → 0 违规 |
| 5. 角色拦截 | `legacyRoleToV2Roles` + `anyRoleHasCapability`（T7） | PRE_SALES 能触发 Extractor，PMO 能审核，ADMIN 能管理 DSL |
| 6. History 追加 | `appendEvidenceHistory`（T5） | 双写 evidences.history + change_logs |

### 额外覆盖

- 缺组织范围 → 1 个 error，角色权限不受影响
- 开发范围为"无" → DSL 通过（info 级允许空）
- 全部缺失 → 4 个违规（3 error + 1 info）

### 技术修复

多测试文件共用 `workload_eval_test` 库时，各自创建独立 Pool 导致并发死锁。修复：
- 创建 `src/test-helpers/db.ts` 共享 Pool + testDb
- `test:ai` 脚本增加 `--test-concurrency=1` 确保串行
- 所有 DB 测试改用共享模块

### 验收结果

| 测试 | 结果 |
|---|---|
| `test:ai`（53 条，含 T1-T8） | **53/53 pass** |
| `test:modules` | **39/39 pass** |
| `test:rules` | **8/8 pass** |
| `tsc --noEmit` | **0 错误** |
| **合计** | **100/100 pass** |

---

## 变更文件清单（实时更新）

### 已修改
- `apps/api/src/modules/modules.handlers.test.ts` — 适配 T4 Provider 架构

### 已新增
- `apps/api/src/modules/exports/exports.module.ts` — 从主项目同步
- `apps/api/src/modules/exports/exports.usecase.ts` — 从主项目同步

### 已新增（T5）
- `apps/api/src/ai/repository/evidence.repository.ts` — EvidenceRepository
- `apps/api/src/ai/repository/index.ts` — barrel
- `apps/api/src/ai/repository/evidence.repository.test.ts` — 7 条集成测试
- `drizzle/0001_furry_gambit.sql` — extraction_results + change_logs 建表

### 已新增（T5-T6）
- `apps/api/src/ai/repository/evidence.repository.ts`
- `apps/api/src/ai/repository/index.ts`
- `apps/api/src/ai/repository/evidence.repository.test.ts`
- `apps/api/src/dsl/types.ts`
- `apps/api/src/dsl/engine.ts`
- `apps/api/src/dsl/rules/sow-completeness-v1.ts`
- `apps/api/src/dsl/index.ts`
- `apps/api/src/dsl/engine.test.ts`
- `drizzle/0001_furry_gambit.sql`

### 已新增（T5-T7）
- `apps/api/src/ai/repository/evidence.repository.ts`
- `apps/api/src/ai/repository/index.ts`
- `apps/api/src/ai/repository/evidence.repository.test.ts`
- `apps/api/src/dsl/types.ts`
- `apps/api/src/dsl/engine.ts`
- `apps/api/src/dsl/rules/sow-completeness-v1.ts`
- `apps/api/src/dsl/index.ts`
- `apps/api/src/dsl/engine.test.ts`
- `apps/api/src/rbac/roles.ts`
- `apps/api/src/rbac/permissions.ts`
- `apps/api/src/rbac/middleware.ts`
- `apps/api/src/rbac/index.ts`
- `apps/api/src/rbac/roles.test.ts`
- `drizzle/0001_furry_gambit.sql`

### 已新增（T5-T8）
- `apps/api/src/ai/repository/evidence.repository.ts`
- `apps/api/src/ai/repository/index.ts`
- `apps/api/src/ai/repository/evidence.repository.test.ts`
- `apps/api/src/dsl/types.ts`
- `apps/api/src/dsl/engine.ts`
- `apps/api/src/dsl/rules/sow-completeness-v1.ts`
- `apps/api/src/dsl/index.ts`
- `apps/api/src/dsl/engine.test.ts`
- `apps/api/src/rbac/roles.ts`
- `apps/api/src/rbac/permissions.ts`
- `apps/api/src/rbac/middleware.ts`
- `apps/api/src/rbac/index.ts`
- `apps/api/src/rbac/roles.test.ts`
- `apps/api/src/ai/smoke/ia-initial-smoke.test.ts`
- `apps/api/src/test-helpers/db.ts`
- `drizzle/0001_furry_gambit.sql`


---

## 5. P0.2 基座巩固（2026-04-25 追加）

> P0.2 目标：将 P0.1 从"任务完成"推进到"能力就绪"，为 P1 三条线提供承重墙。

### 5.1 P0.2-1 RBAC 接入路由 ✅

**问题**：T7 写了 `requireCapability` / `requireV2Role` 中间件，但**0 条路由使用**；所有路由仍用旧 `requireRole`/`requireRoleWithAuth`（仅认 admin/operator）。

**修改**：
- `rbac/middleware.ts` 新增 `requireAuthenticated()`（仅认证、不检查能力位，用于 `/auth/me` / `/auth/logout`）
- 全部 11 个路由文件接入 v2 RBAC：
  - `/auth`：`/me`、`/logout` → `requireAuthenticated()`；用户管理 → `requireCapability("user:manage")`
  - `/versions` → `estimates:read` / `estimates:write` / `system:manage`
  - `/templates` → `template:manage` / `estimates:read`
  - `/rule-sets` → `rule:manage` / `estimates:read`
  - `/estimates` → `estimates:create` / `estimates:read`
  - `/ai` → `extractor:trigger` / `requirement:upload` / `assessment:create` / `system:manage` / `estimates:read`
  - `/sessions` → `estimates:create`
  - `/exports` → `estimates:read`
  - `/teams` → `system:manage` / `estimates:read` / `estimates:write` / `deliverable:review`
  - `/wbs` → `estimates:read`（替换旧 `requireRoleWithAuth`）
  - `/system` → `system:manage` / `requirement:upload` / `rule:manage`

**兼容性**：handler 内部旧 `requireRole` 调用保留不动（宽松兼容，不会 403 合法用户）。

### 5.2 P0.2-2 ai.service.ts 二次拆分 ✅

**问题**：T4 后仍 2408 行，P1 叠加将产生不可逆技术债务。

**修改**：
- 新建 `services/ai-workbook.ts`（~440 行）：`parseRequirementImportFromWorkbook` + `mergeRequirementImportData` + `buildWorkbookPreviewText` + `getSheetRows` + `normalizeProductModuleRows` + `normalizeProductDomainName` + `inferProductLinesFromProductModules` + `requirementProductModuleRowsHaveMeaningfulContent`
- `ai.service.ts`：2408 → **1968 行**（-440 行）
- 更新 `services/index.ts` 导出 `ai-workbook`
- 更新 `services/parse-requirement-workbook.test.ts` 改为从 `ai-workbook` 导入

### 5.3 P0.2-3 首批实体建表 ✅

**交付**：4 张新表（含 P0.2-5 AssessmentVersion）：

| 表 | 列数 | 索引 | 说明 |
|---|---|---|---|
| `requirement_packs` | 11 | 2 | 需求包 v1；status: draft/confirmed/deprecated |
| `sow_documents` | 13 | 3 | SOW 条目；cloudProduct × module × category 粒度 |
| `initial_estimates` | 12 | 2 | 初估交接包；4 维 confidenceScores + phaseProposal |
| `assessment_versions` | 14 | 4 | 评估版本；Correction/Revision + ownerRole + deliveryMode |

**Migration**：`drizzle/0002_shocking_inertia.sql`；已应用到 `workload_eval` + `workload_eval_test`。

### 5.4 P0.2-4 DSL 规则集扩展 ✅

从 1 条 → **5 条**：

| 规则 ID | 检查内容 | 严重级别 | 用户故事 |
|---|---|---|---|
| `sow-completeness-v1` | 4 字段齐全 | error/info | US-5 |
| `industry-mandatory-v1` | 行业必选项（制造业→MES、零售业→POS、建筑工程→项目） | warning | US-6 |
| `module-dependency-v1` | 模块依赖（生产→库存、采购→库存、销售→库存、成本→总账） | error | US-6 |
| `confidence-threshold-v1` | 置信度 <0.5→error, <0.7→warning | error/warning | US-8 |
| `wbs-completeness-v1` | WBS 与模块范围对齐 | warning | US-25 |

测试：`dsl/engine.test.ts` 从 10 条 → **27 条**（含 5 条单规则 + 1 条联合执行）。

### 5.5 P0.2-5 AssessmentVersion Schema 设计 ✅

**状态机（v1 兼容 + v2 扩展）**：
`draft → checked_out → checked_in → promoted → sealed`

**关键字段**：
- `revision_type`: `initial` | `correction` | `revision`（D-12 二元语义）
- `owner_role`: `IMPL` | `PM` | `PMO` | `ADMIN`（接力过程中会变）
- `delivery_mode`: `public_cloud` | `private_cloud` | `hybrid`
- `parent_version_id`: Revision 指向上一版；Correction 指向同一基线版
- `payload`: JSONB（v1 兼容，渐进迁移不迁数据）

### 5.6 验收结果

| 测试 | 结果 |
|---|---|
| `test:ai` | **70/70 pass**（新增 17 条 DSL 测试） |
| `test:modules` | **39/39 pass** |
| `test:rules` | **8/8 pass** |
| `tsc --noEmit` | **0 错误** |
| **合计** | **117/117 pass** |

### 5.7 P0.2 变更文件清单

**新增**
- `apps/api/src/services/ai-workbook.ts` — Workbook 解析独立模块
- `apps/api/src/dsl/rules/industry-mandatory-v1.ts`
- `apps/api/src/dsl/rules/module-dependency-v1.ts`
- `apps/api/src/dsl/rules/confidence-threshold-v1.ts`
- `apps/api/src/dsl/rules/wbs-completeness-v1.ts`
- `apps/api/src/db/schema/requirement_packs.ts`
- `apps/api/src/db/schema/sow_documents.ts`
- `apps/api/src/db/schema/initial_estimates.ts`
- `apps/api/src/db/schema/assessment_versions.ts`
- `drizzle/0002_shocking_inertia.sql`

**修改**
- `apps/api/src/rbac/middleware.ts` — 新增 `requireAuthenticated`
- `apps/api/src/rbac/index.ts` — 导出 `requireAuthenticated`
- `apps/api/src/routes/*.ts`（11 个路由文件）— 接入 `requireCapability` / `requireAnyCapability` / `requireAuthenticated`
- `apps/api/src/services/ai.service.ts` — 瘦身 2408→1968 行，导入 `ai-workbook`
- `apps/api/src/services/index.ts` — 导出 `ai-workbook`
- `apps/api/src/services/parse-requirement-workbook.test.ts` — 改为从 `ai-workbook` 导入
- `apps/api/src/dsl/index.ts` — 导出 5 条规则
- `apps/api/src/dsl/engine.test.ts` — 17 条新测试
- `apps/api/src/db/schema/index.ts` — 导出 4 张新表
