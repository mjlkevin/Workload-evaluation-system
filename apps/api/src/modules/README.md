# Modules Refactor Guide

该目录用于承载“领域模块化重构”后的实现，目标是在**不改变外部接口契约**的前提下提升可维护性。

## 迁移原则

- 路由路径、请求参数、响应结构、错误码保持兼容。
- 先迁移高变更域（auth / versions / ai），再迁移核心评估域。
- 每个域迁移后必须通过契约回归。

## 当前进度

- [x] `auth` 已迁移到 `modules/auth`（阶段3：controller/usecase/repository 已拆分）。
- [x] `versions` 已迁移到 `modules/versions`（阶段3：controller/usecase/repository 已拆分）。
- [x] `ai` 已迁移到 `modules/ai`（阶段3：controller/usecase 已拆分，repository 待按需扩展）。
- [x] `templates` 已迁移到 `modules/templates`（阶段3：controller/usecase/repository 已拆分）。
- [x] `rule-sets` 已迁移到 `modules/rules`（阶段3：controller/usecase/repository 已拆分）。
- [x] `estimates` 已迁移到 `modules/estimates`（阶段3：controller/usecase/repository 已拆分）。
- [x] `exports` 已迁移到 `modules/exports`（阶段3：controller/usecase 已拆分）。
- [x] `sessions` 已迁移到 `modules/sessions`（阶段3：controller/usecase/repository 已拆分）。
- [x] `system` 已迁移到 `modules/system`（阶段3：controller/usecase/repository 已拆分）。
- [x] `team` 已迁移到 `modules/team`（阶段3：controller/usecase/repository 已拆分）。

## 仍未迁移的领域（遗留 `services/` 单例模式）

以下 7 个领域仍使用旧的 service 层模式（路由直接 import 单例），尚未迁移到 `modules/` 目录：

| 领域 | 当前路径 |
|------|----------|
| presales | `services/presales/` |
| pm-workbench | `services/pm-workbench/` |
| collab | `services/collab/` |
| dev-assessment | `services/dev-assessment/` |
| change-management | `services/change-management/` |
| history | `services/history/` |
| sales-briefing | `services/sales-briefing/` |

## 后续建议结构

```text
modules/
  auth/
    auth.controller.ts
    auth.usecase.ts
    auth.repository.ts
```

当前已完成 10 个领域”第三阶段（controller/usecase/repository 细分）”，占比 ~59%（10/17）。

## 测试进度

- [x] `modules.unit.test.ts`：repository 基础行为（estimates/sessions/versions）
- [x] `modules.usecase.test.ts`：核心 usecase 行为（estimates/sessions/exports）
- [x] `modules.handlers.test.ts`：鉴权与参数分支+状态流转（auth/rules/templates/versions）
- [x] `npm run test:modules` / `npm run test:rules` / `npm run test:integration` 全部通过

## 阶段验收结论

- [x] 领域拆分进度：10/17 核心域已迁移至 `modules/*`，7 个仍遗留于 `services/`（见上表）。
- [x] 兼容性保持：路由路径、请求参数、响应结构、错误码保持兼容。
- [x] 回归通过：模块测试、规则引擎测试、集成测试均通过。
