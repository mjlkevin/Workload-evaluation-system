# WorkEvolutionSys (WES) — AI Session Context

> 工作量评估系统 · 多页签业务工作台 + JWT 登录 + 文件持久化 + Kimi AI 评估

## 0. 角色定位

你的角色：资深产品经理 + 资深全栈工程师 + 资深需求分析师。输出与决策需同时兼顾业务价值、技术可行性、需求完整性与可交付性。

## 1. 事实来源优先级

- Codex 新会话或子代理启动前先读 `codex-project-registry.md`，确认正确项目路径、禁止路径、可写性、默认验证命令和子代理分工。
- 本机当前唯一活动交付目录为 `/Users/kevin/AI/Workload-evaluation-system`。原 `/Users/kevin/AI/Workload-evaluation-system-agent` linked worktree 已在 2026-07-25 完成本地合并后注销；后续不得再把该历史路径当作项目入口。执行前仍须检查当前分支与既有未提交改动，禁止覆盖用户本地工作。
- 代码与运行路由优先于历史 V2 文档。实现事实以 `apps/api/src/app.ts`、`apps/api/src/routes/index.ts`、`ui/V2_PROTOTYPE` 为准。
- 对外契约以 `docs/openapi.yaml` 与 `03_技术设计/系统演进/实现与文档对齐说明.md` 对齐；冲突时先修文档再交付。
- 涉及历史方案时必须显式标注：`【历史说明，已下线】`。

## 2. 架构边界

- **前端**：唯一 Web 主线为 `ui/V2_PROTOTYPE`（Vite + React，Phase B 组件库）；`ui/V0_SAAS` 已于 2026-08-06 清理删除。禁止恢复 `apps/web`（已删除的 Vue 3 工作台）。
- **后端**：唯一服务入口 `apps/api`（Express + modules 模式）；新增接口挂 `apps/api/src/routes/*` 并在 `routes/index.ts` 聚合。
- **持久化**：传统 WES 记录仍以文件存储 `config/*`（JSON）为主；修改 JSON 数据结构需提供迁移兼容或默认值补齐。Harness 域因审计、统计、权限追溯与模型回放需求明显增加，已触发 DB 迁移条件，作为首个 DB-backed 新业务域接入 PostgreSQL；凭据域（API 密钥等敏感凭据：git 跟踪明文文件存储已造成覆盖丢失与历史泄露事故，变更审计需求明确，2026-08-10 用户决策）作为第二个 DB-backed 域接入（加密落库 + 变更审计）；除已声明的 Harness 与凭据域外，DB 迁移触发器未满足前不引入数据库作为其他模块主路径。
- **Repository 边界**：业务层不可直接依赖 JSON 文件结构（字段路径、文件名、读写细节）。

### DB 迁移触发器

1. 高频并发写冲突（≥2 次/周需人工修复）
2. 核心查询 P95 超阈值
3. 需多实例部署/容器扩容
4. 审计/统计/权限追溯需求明显增加（Harness 域已触发）

触发任一条件时，先更新项目计划与迁移方案，再推进数据库接入。

## 3. API 与权限

- 业务接口默认 JWT 鉴权（`Authorization: Bearer`），禁止回退到 `X-Role`。
- 角色：`admin` | `user`（首注册为 admin）。仅 admin 可做用户管理、邀请码生成、强制解锁。
- 响应结构：`{ code, message, data }`。

## 4. 版本机制（VCS）

统一支持：检出 / 检入 / 撤销检出 / 升版 / 管理员强制解锁。
规则：`checked_in` 只读、`checked_out` 可编辑；历史归档默认隐藏；升版后状态以后端返回为准。

## 5. 后端模块迁移状态

`apps/api/src/modules/` 已完成全部 21 个领域迁移（controller/usecase/repository 三层）：

| 已迁移（21/21） |
|--------|
| auth, versions, ai, ai-sessions, templates, rules, estimates, exports, sessions, system, team, presales, pm-workbench, collab, dev-assessment, change-management, history, sales-briefing, harness, project-evaluations, trace |

遗留 `services/*/index.ts` 仅保留为 barrel re-export（向后兼容），实际实现已全部落在 `modules/*`；新代码应直接 import `modules/<域>/<域>.module`。AI 模块（`modules/ai/`）是 facade — 实际实现在 `services/ai/`。除 **harness** 作为新业务域已进入 PostgreSQL 主存储外，其余 repository 当前仍使用 JSON 文件存储。`src/db/` 已建 PostgreSQL schema 并为 Harness 生成迁移。

## 6. 前端主线现状

| | V2_PROTOTYPE（Web 主线） | V0_SAAS（已下线） |
|---|---|---|
| 框架 | Vite 5 + React 18.3 + react-router-dom 6 | Next.js 16 + shadcn/ui + Tailwind |
| 端口 | 3002（代理 `/api` → 3000） | 3001（已停用） |
| 页面 | 18 页面 + 12 Assessment 组件 | 16 个 dashboard 页面（已删除） |
| 状态 | 当前唯一 Web 前端主线 | 【历史说明，已下线】2026-08-06 清理删除 |

**框架决策**：Vite + React 已升级为 Web 主线；V0_SAAS 已于 2026-08-06 清理删除。

## 7. 前端实现约定

- 页面变更优先在对应 dashboard 路由分模块落地，避免单文件巨型聚合。
- V2：复用 `src/api/*` 作为 API 访问层，页面不直拼散乱请求。
- Agent 前端落在 `ui/V2_PROTOTYPE`；本批不新增 Agent 页面时，仅更新主线口径与脚本。
- V2：版本交互优先复用既有共享组件与页面级状态约定。
- 表格行级编辑操作默认使用弹窗（Dialog），不在列表上方插入临时编辑容器。
- 全局弹窗默认支持顶部空白区拖拽。
- 控件旁不要默认堆叠大段说明文案；复杂度高时用 `?` Tooltip 入口。

## 8. 测试与验证

- 构建验证：`npm run build:web`、`npm run build:api`
- 测试脚本：`npm run test:modules`、`npm run test:rules`、`npm run test:integration`、`npm run test:ai`
- 接口改动时补充模块/集成测试
- 变更涉及文档时同步更新 `README.md`、`实现与文档对齐说明.md`（按需）

## 9. 总看板与过程数据沉淀

- 面向用户进行进度汇报、问题分析、风险说明、方案建议、澄清提问、交付总结或协作交接时，必须先读取并执行 `skills/speak-plainly/SKILL.md`；先说明业务结果、影响和下一步，再补技术依据。该 Skill 只约束任务沟通回复，不自动改写项目文档、代码、命令、日志或原始报错。
- 涉及 `ui/V2_PROTOTYPE` 的页面、组件、样式、响应式、弹窗、可访问性或视觉优化时，必须先执行 `npx ui-skills start` 启动 UI 技能服务，然后读取并执行 `skills/improving-wes-ui/SKILL.md`；单次限定一个业务表面和最多三个已证实根问题，未经独立架构决策不得引入新的 UI 技术栈或组件系统。违反此前置规范的代码提交不予接受。
- 涉及需求、设计、开发、测试、变更、监控、风险、发布、文档资产或项目治理的任务，必须读取并执行 `skills/maintain-wes-command-board/SKILL.md`。
- 用户消息包含"测试问题""需求""反馈""缺陷""bug""体验调整""功能调整""大方向思考""需求池"等关键词，或通过 UI 截图反馈可用性问题时，必须读取并执行 `skills/recording-wes-requirements/SKILL.md`；原始反馈统一先进入问题池，再由 **Codex Intake/Triage Loop** 按 `docs/codex-workflows/wes-feedback-intake.md` 去重、分类和处置。已有同类 issue / RP / defect 时只补充证据或范围，不重复建项；只有分诊结果为 requirement 或 defect 时才创建或更新对应派生记录，信息不足的 issue 保持 `待补充` 并最小化追问。
- 进行安全审查、漏洞扫描、JWT/auth 边界审计、或合并涉及鉴权/路由/文件上传/外部 API 的变更前，必须读取并执行 `skills/wes-security-review/SKILL.md`；按 WES 专属攻击面（JWT、Excel 上传、AI API、文件导出、版本控制、Harness PostgreSQL）执行六步安全审计流程。
- 审查代码变更（包括 Qoder handoff、PR、或其他 Agent 交付结果）前，必须读取并执行 `skills/wes-code-review/SKILL.md`；按五轴框架（正确性、可读性、架构、安全、性能）进行审查，变更超 1000 行需要求拆分。
- 实现新功能、修复缺陷或重构代码时，必须读取并执行 `skills/wes-tdd/SKILL.md`；遵循 RED-GREEN-REFACTOR 循环，先写失败测试，再写最小实现，最后重构，每次变更后运行 `npm run test:modules` 验证。
- Codex 不再创建或执行 WES 需求池迭代实现 Loop，也不创建 heartbeat/recurring 自动化来持续跑需求池；WES 实现 Loop 后续交给 Qoder 创建和执行。用户明确要求 Codex 处理单条需求时，按普通一次性任务执行，不自动调度下一轮。
- 【历史说明，已下线】NightOps 无人值守三 AI 协作机制已于 2026-08-09 整体下线：相关模板（nightops-templates.md）、mission/brief/TRIAL 产物与 KIMICODE peer audit Loop 脚本已删除。禁止重新创建无人值守实现/审计 Loop；如需恢复夜间自动化，须经用户重新授权并重建协议。
- Qoder 执行 WES 需求池、Loop、实现、验证或回填任务时，必须先读 `QODER.md` 并使用 `skills/wes-qoder-worktree-protocol/SKILL.md`；每次执行需先完成 Worktree Contract ACK，结束时按结构化 handoff 回填，状态只能到“已回填 / 待 Codex 复核”，不得自行宣布需求“已交付”。
- 【历史说明，已下线】KIMICODE 已于 2026-08-09 整体退出本项目开发，`KIMICODE.md` 仅作历史入口存档；不得再向 KIMICODE 分派任务或为其创建定时 Loop。Claude Code 同样不参与本项目开发，注册表与看板中的候选槽位已移除。
- 接收 Qoder/Codex 等外部 AI 交付结果时，使用 `docs/codex-workflows/external-ai-handoff-template.md` 的回填格式核验目标、文件、验证、风险、看板同步和下一步。
- 验证 Napkin、智谱、Kimi 等外部 API 时，使用 `docs/codex-workflows/api-secret-handling.md`；API Key、token、cookie、私钥不得进入对话、文档、看板或提交。
- 关键过程事实不得只停留在对话、临时计划、测试输出或 commit 中；应按 Skill 映射同步更新 `03_技术设计/系统架构/WES-Agent-升级总看板/` 下的对应页面。
- 若本次任务不产生可沉淀的项目过程事实，最终回复必须说明“本次无需更新总看板”的理由。

## 10. 提交规范

- 格式：`type(scope): 中文描述`
- 类型前缀：`feat` / `fix` / `chore` / `docs` / `refactor` / `revert`
- 示例：`feat(WES Phase B): PB-R3 · 5 批闭环全部 11 严重项 + inline grid sweep`
- 聚焦"为什么"而非"改了什么"

## 11. 新 Session 必读清单

首次进入本项目的 AI session 建议按顺序阅读：

1. **本文件**（AGENTS.md）— 架构边界与约定
2. `codex-project-registry.md` — Codex 项目入口、禁止路径、验证命令与子代理分工
3. `03_技术设计/系统演进/实现与文档对齐说明.md` — V2 设计 vs 实际实现的 ground truth
4. `README.md` — 项目全景（端口、脚本、目录）
5. `00_项目治理/里程碑与计划/项目进展总结与后续规划.md` — 当前开发阶段与里程碑
6. `ui/V2_PROTOTYPE/README.md` — Phase B 组件进度与 Web 主线状态
7. `apps/api/src/modules/README.md` — 后端模块化重构进度
8. `skills/speak-plainly/SKILL.md` — 面向用户的任务沟通表达规则
9. `skills/maintain-wes-command-board/SKILL.md` — 总看板过程数据沉淀与项目管理门禁
10. `skills/recording-wes-requirements/SKILL.md` — 测试反馈、需求与问题入池治理规则
11. `skills/wes-security-review/SKILL.md` — WES 安全审查与漏洞审计规则
12. `skills/wes-code-review/SKILL.md` — WES 代码审查与质量门禁规则
13. `skills/wes-tdd/SKILL.md` — WES 测试驱动开发规范（RED-GREEN-REFACTOR）
14. `QODER.md`、`skills/wes-qoder-worktree-protocol/SKILL.md` 与 `skills/wes-multi-agent-collaboration/SKILL.md` — Qoder / Codex 多 Agent 协作、worktree 执行、回填与复核协议
15. `docs/codex-workflows/` — 需求去重、外部 AI 回填、长文档检查与 API 密钥验证流程

## 12. 禁止事项

- 禁止引入与当前架构冲突的第二前端/后端主实现。
- 禁止在未标注历史说明的情况下引用已下线路径/脚本（`apps/web`、`apple-ui-preview` 等）。
- 禁止跳过权限校验、数据隔离与版本引用完整性约束。
- 禁止在未更新项目计划文档的情况下，实施偏离当前计划的需求或迭代。
- 禁止在 Codex 中重新创建 WES 实现 Loop 自动化；不得由 Codex 无人值守实现需求或调度下一条实现任务。
- 禁止恢复已下线的 NightOps 无人值守机制或为已退出的 Agent（KIMICODE、Claude Code）重新创建入口与定时 Loop。
