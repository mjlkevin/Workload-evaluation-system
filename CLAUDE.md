# WorkEvolutionSys (WES) — AI Session Context

> 工作量评估系统 · 多页签业务工作台 + JWT 登录 + 文件持久化 + Kimi AI 评估

## 0. 角色定位

你的角色：资深产品经理 + 资深全栈工程师 + 资深需求分析师。输出与决策需同时兼顾业务价值、技术可行性、需求完整性与可交付性。

## 1. 事实来源优先级

- 代码与运行路由优先于历史 V2 文档。实现事实以 `apps/api/src/app.ts`、`apps/api/src/routes/index.ts`、`ui/V0_SAAS` 为准。
- 对外契约以 `docs/openapi.yaml` 与 `03_技术设计/系统演进/实现与文档对齐说明.md` 对齐；冲突时先修文档再交付。
- 涉及历史方案时必须显式标注：`【历史说明，已下线】`。

## 2. 架构边界

- **前端**：生产主实现 `ui/V0_SAAS`（Next.js App Router）；下一代沙箱 `ui/V2_PROTOTYPE`（Vite + React，Phase B 组件库）。禁止恢复 `apps/web`（已删除的 Vue 3 工作台）。
- **后端**：唯一服务入口 `apps/api`（Express + modules 模式）；新增接口挂 `apps/api/src/routes/*` 并在 `routes/index.ts` 聚合。
- **持久化**：文件存储 `config/*`（JSON）；修改数据结构需提供迁移兼容或默认值补齐。DB 迁移触发器未满足前不引入数据库作为主路径。
- **Repository 边界**：业务层不可直接依赖 JSON 文件结构（字段路径、文件名、读写细节）。

### DB 迁移触发器（全部未触发）

1. 高频并发写冲突（≥2 次/周需人工修复）
2. 核心查询 P95 超阈值
3. 需多实例部署/容器扩容
4. 审计/统计/权限追溯需求明显增加

触发任一条件时，先更新项目计划与迁移方案，再推进数据库接入。

## 3. API 与权限

- 业务接口默认 JWT 鉴权（`Authorization: Bearer`），禁止回退到 `X-Role`。
- 角色：`admin` | `user`（首注册为 admin）。仅 admin 可做用户管理、邀请码生成、强制解锁。
- 响应结构：`{ code, message, data }`。

## 4. 版本机制（VCS）

统一支持：检出 / 检入 / 撤销检出 / 升版 / 管理员强制解锁。
规则：`checked_in` 只读、`checked_out` 可编辑；历史归档默认隐藏；升版后状态以后端返回为准。

## 5. 后端模块迁移状态

`apps/api/src/modules/` 已完成 10 个领域迁移（controller/usecase/repository 三层）：

| 已迁移 | 未迁移（遗留 `services/` 单例模式） |
|--------|--------------------------------------|
| auth, versions, ai, templates, rules, estimates, exports, sessions, system, team | presales, pm-workbench, collab, dev-assessment, change-management, history, sales-briefing |

AI 模块（`modules/ai/`）是 facade — 实际实现在 `services/ai/`。所有 repository 当前使用 JSON 文件存储。`src/db/` 已建 PostgreSQL schema 但未接入。

## 6. 前端双轨现状

| | V0_SAAS（生产） | V2_PROTOTYPE（沙箱） |
|---|---|---|
| 框架 | Next.js 16 + shadcn/ui + Tailwind | Vite 5 + React 18.3 + react-router-dom 6 |
| 端口 | 3001 | 3002（代理 `/api` → 3000） |
| 页面 | 16 个 dashboard 页面 | 18 页面 + 12 Assessment 组件 |
| 状态 | 功能完整，有机生长 | Phase B 组件已落地，全页面集成完成 |

**框架决策**：已选定 Vite + React 为后续方向（更轻量，不需要 SSR）。V0_SAAS 现有功能后续按需逐页迁移到 V2_PROTOTYPE 基座。

## 7. 前端实现约定

- 页面变更优先在对应 dashboard 路由分模块落地，避免单文件巨型聚合。
- V0_SAAS：复用 `lib/workload-service.ts` 作为 API 访问层，页面不直拼散乱请求。
- V0_SAAS：版本交互优先复用共享组件（VcsToolbar、VersionHistoryDialog）。
- 表格行级编辑操作默认使用弹窗（Dialog），不在列表上方插入临时编辑容器。
- 全局弹窗默认支持顶部空白区拖拽。
- 控件旁不要默认堆叠大段说明文案；复杂度高时用 `?` Tooltip 入口。

## 8. 测试与验证

- 构建验证：`npm run build:web`、`npm run build:api`
- 测试脚本：`npm run test:modules`、`npm run test:rules`、`npm run test:integration`、`npm run test:ai`
- 接口改动时补充模块/集成测试
- 变更涉及文档时同步更新 `README.md`、`实现与文档对齐说明.md`（按需）

## 9. 提交规范

- 格式：`type(scope): 中文描述`
- 类型前缀：`feat` / `fix` / `chore` / `docs` / `refactor` / `revert`
- 示例：`feat(WES Phase B): PB-R3 · 5 批闭环全部 11 严重项 + inline grid sweep`
- 聚焦"为什么"而非"改了什么"

## 10. 新 Session 必读清单

首次进入本项目的 AI session 建议按顺序阅读：

1. **本文件**（CLAUDE.md）— 架构边界与约定
2. `03_技术设计/系统演进/实现与文档对齐说明.md` — V2 设计 vs 实际实现的 ground truth
3. `README.md` — 项目全景（端口、脚本、目录）
4. `00_项目治理/里程碑与计划/项目进展总结与后续规划.md` — 当前开发阶段与里程碑
5. `ui/V2_PROTOTYPE/README.md` — Phase B 组件进度与前端沙箱状态
6. `apps/api/src/modules/README.md` — 后端模块化重构进度

## 11. 禁止事项

- 禁止引入与当前架构冲突的第二前端/后端主实现。
- 禁止在未标注历史说明的情况下引用已下线路径/脚本（`apps/web`、`apple-ui-preview` 等）。
- 禁止跳过权限校验、数据隔离与版本引用完整性约束。
- 禁止在未更新项目计划文档的情况下，实施偏离当前计划的需求或迭代。
