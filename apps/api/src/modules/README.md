# Modules Refactor Guide

## A批时点记录：skills（2026-11-02；当前以B批说明为准）

独立 controller/usecase/repository 与 PostgreSQL 三表（定义、版本、修订审计），由 `/api/v1/skills` 管理端接入。所有读写均 JWT 且仅 admin；不复用 assessment VersionType。仓储保护检出所有者、revision 并发及发布/审计历史；Schema 和原生工具参数映射静态校验，生产 publish 恒返回 409。后续流程/工作台执行不在本批范围。

该目录用于承载"领域模块化重构"后的实现，目标是在**不改变外部接口契约**的前提下提升可维护性。

## 新增业务领域（2026-11-02，B批候选）

原21个领域迁移统计保持历史范围；新增独立 `skills` 与 `workflows`，不混入assessment版本记录。Skill包含定义、版本、隔离模型试运行和服务端发布证明；Workflow包含固定已发布Skill版本依赖、静态配置校验与不可变发布。B批未接通Harness工作台执行，静态校验不代表业务运行。PG迁移0024–0029、JWT管理员管理边界及精确接口以OpenAPI/对齐说明为准。

测试：`test:modules` 包含Skill和Workflow静态/路由测试；`test:workflows` 为独立PG测试，使用显式 `workload_eval_test` 与模块测试串行。严禁指向预览或开发主库。B后端与管理界面本地已验证；模块685、流程PG17、AI286、Agent242、规则8、集成1通过，Web755及双构建通过。Kimi K3固定采样兼容修正4f19ea2后真实试运行通过；预览中真实复核发布、升版回滚及固定依赖流程发布已验证；JWT与发布定向11/11，真实PG只读目录角色过滤通过。B用户最终验收待完成。

## 迁移原则

- 路由路径、请求参数、响应结构、错误码保持兼容。
- 先迁移高变更域（auth / versions / ai），再迁移核心评估域。
- 每个域迁移后必须通过契约回归。

## 当前进度 — 全部 21 个领域已完成迁移

- [x] `auth` 已迁移到 `modules/auth`（阶段3：controller/usecase/repository 已拆分）。
- [x] `versions` 已迁移到 `modules/versions`（阶段3：controller/usecase/repository 已拆分）。
- [x] `ai` 已迁移到 `modules/ai`（阶段3：controller/usecase 已拆分）。
- [x] `templates` 已迁移到 `modules/templates`（阶段3：controller/usecase/repository 已拆分）。
- [x] `rule-sets` 已迁移到 `modules/rules`（阶段3：controller/usecase/repository 已拆分）。
- [x] `estimates` 已迁移到 `modules/estimates`（阶段3：controller/usecase/repository 已拆分）。
- [x] `exports` 已迁移到 `modules/exports`（阶段3：controller/usecase 已拆分）。
- [x] `sessions` 已迁移到 `modules/sessions`（阶段3：controller/usecase/repository 已拆分）。
- [x] `system` 已迁移到 `modules/system`（阶段3：controller/usecase/repository 已拆分）。
- [x] `team` 已迁移到 `modules/team`（阶段3：controller/usecase/repository 已拆分）。
- [x] `history` 已迁移到 `modules/history`（阶段3：controller/usecase/repository 已拆分）。
- [x] `sales-briefing` 已迁移到 `modules/sales-briefing`（阶段3：controller/usecase/repository 已拆分）。
- [x] `collab` 已迁移到 `modules/collab`（阶段3：controller/usecase/repository 已拆分）。
- [x] `dev-assessment` 已迁移到 `modules/dev-assessment`（阶段3：controller/usecase/repository 已拆分）。
- [x] `change-management` 已迁移到 `modules/change-management`（阶段3：controller/usecase/repository 已拆分）。
- [x] `pm-workbench` 已迁移到 `modules/pm-workbench`（阶段3：controller/usecase/repository 已拆分）。
- [x] `presales` 已迁移到 `modules/presales`（阶段3：controller/usecase/repository 已拆分）。
- [x] `harness` 已新增到 `modules/harness`（WES Harness Phase 1A；controller/usecase/repository 已拆分，PostgreSQL-backed 新业务域）。
- [x] `ai-sessions` 已迁移到 `modules/ai-sessions`（AI 会话域：controller/usecase/repository 已拆分）。
- [x] `project-evaluations` 已迁移到 `modules/project-evaluations`（项目评估域：controller/usecase/repository 已拆分）。
- [x] `trace` 已迁移到 `modules/trace`（Trace 观测域：controller/usecase/repository 已拆分）。

全部 21/21 领域已完成迁移（100%）。

## 后续建议结构

```text
modules/
  auth/
    auth.controller.ts
    auth.usecase.ts
    auth.repository.ts
```

## 测试进度

- [x] `modules.unit.test.ts`：repository 基础行为（estimates/sessions/versions）
- [x] `modules.usecase.test.ts`：核心 usecase 行为（estimates/sessions/exports）
- [x] `modules.handlers.test.ts`：鉴权与参数分支+状态流转（auth/rules/templates/versions）
- [x] `npm run test:modules` / `npm run test:rules` / `npm run test:integration` 全部通过

## 阶段验收结论

- [x] 领域拆分进度：21/21 领域已迁移至 `modules/*`（100%）。
- [x] 兼容性保持：路由路径、请求参数、响应结构、错误码保持兼容。
- [x] 回归通过：模块测试、规则引擎测试、集成测试均通过。
- [x] 遗留 services/ 单例通过 barrel re-export 保持向后兼容。
