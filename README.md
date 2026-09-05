# 工作量评估系统（Workload Evaluation System）

面向实施与开发场景的多页签评估系统，支持“需求 -> 实施评估 -> 开发评估 -> 资源人天及成本 -> 总方案归档”的完整评估链路，并提供用户隔离、版本管理与可追溯能力。

> 🛠️ 阶段 2 存储切换已收官，当前处于阶段 3——接手前请先读 [`AGENTS.md`](AGENTS.md)，最新进展见 [WES-Agent-升级总看板](03_技术设计/系统架构/WES-Agent-升级总看板/index.html)。

## 当前核心能力

- 多页签评估流程：
  - `总览`（评估方案列表、方案预览、关系图与嵌入子模块预览）
  - `需求`（`RI-` 等编码以**系统管理**中生效规则为准；Kimi 实施评估预览支持**导出 PDF**（打印为 PDF）、进行中弹窗固定日志区高度；评估结果**云产品/ SKU 维度**由后端归一，避免财务云/供应链云等域云误填在 SKU 列）
  - `实施评估`（模板/规则/多组织/导出与版本；**项目名称**字段，与总方案联动或手填；**当前生效版本**下拉仅展示最新一条，历史在「版本历史」中查看，**按历史版本创建新版**用新编码继承快照；**导出 Excel** 列至表头「小计」、页脚无尾部多余空行，与参考版式一致）
  - `开发评估`（**项目名称**与总方案联动/手填，与实施评估一致）
  - `资源人天及成本`
  - `系统管理`（**admin**：版本号编码规则列表、配置、生效、禁用；持久化 PostgreSQL `version_code_rules` / `system_configs`，seed 源仍为 `config/versions/version-code-rules.json` 等只读 fixture）
  - `WBS`（只读派生视图，见下文 API）、`评审`（团队评审能力见 `/api/v1/teams/.../reviews`）
- 用户与权限：
  - 注册/登录/JWT 鉴权，支持“记住 7 天”会话
  - 自助密码重置（一次性 token，文件持久化；无邮件服务时返回本地重置链接）
  - 管理员用户管理、状态启停
  - 推荐码（邀请码）生成与注册校验
- 版本体系（前后端联动）：
  - 各模块版本号由**已生效的编码规则**生成（未传 `versionCode` 创建时由后端按规则出号）；常见前缀随配置变化（如实施评估 `AS-`、开发 `DV-`、总方案 `GLOBAL-`、需求 `RI-`、资源 `RS-` 等，以 `version-code-rules.json` 为准）
  - 后端统一版本记录、检出/检入/升版/强制解锁与引用完整性校验
- 数据隔离与安全：
  - 前端草稿按用户隔离存储
  - 后端导出历史、下载与会话数据按 `ownerUserId` 鉴权
- 导入与解析：
  - 需求支持 Excel 上传解析
  - Kimi 模型解析 + 规则回退解析融合，提升结构化表单兼容性
- 团队协同（后端 P0）：
  - 团队、成员、方案绑定、评审与评论：`/api/v1/teams/*`（持久化 PostgreSQL `teams` / `team_plan_bindings`，阶段 2 S5，2026-08-30；原 `config/teams/store.json` 已随 JSON 读写路径删除）

## 前端与重构说明（2026-03 起）

- **Web 前端主线**：[`ui/V2_PROTOTYPE`](ui/V2_PROTOTYPE)（Vite + React，端口 `3002`，代理 `/api` 到 API `3000`）。根目录 `npm run dev:web` / `npm run build:web` 指向此处；Phase B 组件库与 18 页面全量集成已完成。详见 [`ui/V2_PROTOTYPE/README.md`](ui/V2_PROTOTYPE/README.md)。
- **【历史说明，已下线】V0 资产**：`ui/V0_SAAS`（Next.js + TypeScript）已于 2026-08-06 清理删除；如需追溯请查看 Git 历史或 `99_归档/` 目录。
- **后端**：[`apps/api`](apps/api) 10/17 核心域已迁至 `apps/api/src/modules/*`（含 auth、versions、ai、templates、rules、estimates、exports、sessions、system、team），路由聚合于 [`apps/api/src/routes/index.ts`](apps/api/src/routes/index.ts)。

## 质量回归（建议每次发布前执行）

首发统一硬门禁（严格 MVP）：

- `npm run test:modules`
- `npm run test:rules`
- `npm run test:integration`
- `npm run build:api`
- `npm run build:web`
- `npm run test:api:team`（团队 API 契约冒烟，见 `scripts/team-api-check.js`）

## Agent-Friendly API（V1 基座）

当前已挂载 `POST /api/v1/agent/chat`（JWT 鉴权），返回统一 JSON 事件数组；V1 先支持 Provider tool-calling、Agent 编排、售前初估工具和基础事件协议。抽取、PDF、真实归档工具与 V2 前端工作台仍在后续批次接线；契约说明见 [`docs/openapi.yaml`](docs/openapi.yaml)。

## WES Harness Phase 1A-1D

Harness 是 AI 工作台与 Agent 之间的受控业务工作环境，已从 Phase 1A 的 PostgreSQL-backed 基座推进到文件解析、证据沉淀、需求解析报告 v1/v2 与确认动作审计链路。当前 Harness 可持久化 HarnessRun、文件元数据、证据、产物、模型运行轨迹和工具事件；AI 工作台上传文件后进入 Harness 编排，报告 v2 的确认动作可生成传统项目/实施评估草稿，仍需人工确认/编辑后进入正式评估。

验证：

```bash
npm run test:harness -w apps/api
npm run test:modules -w apps/api
npm run build -w apps/api
```

## 技术栈

- Web 前端：Vite + React（`ui/V2_PROTOTYPE`）
- 后端：Express + TypeScript（`apps/api`）
- 存储：PostgreSQL 是九域业务数据的唯一主存储（阶段 2 于 2026-08-31 收官，`WES_STORE_*_PG` 开关机制已退役、各域选择器恒装配 PG）；`config/*.json` 不再承载业务 store，只剩三类资产：
  - 用户：PostgreSQL `users`（阶段 2 S1）；原 `config/auth/users.json` 已删除（切换前快照见 `99_归档/阶段2-users-store-切换前快照/`）
  - 密码重置令牌 / 邀请码：PostgreSQL `password_reset_tokens` / `invite_codes`（阶段 2 批 1）；原 `config/auth/*.json` 归档至 `99_归档/`
  - 版本记录：PostgreSQL `version_records`（阶段 2 S4，2026-08-30）；原 `config/versions/records.json` 已随 JSON 读写路径删除
  - 团队：PostgreSQL `teams` / `team_plan_bindings`（阶段 2 S5，2026-08-30）；原 `config/teams/store.json` 已删除
  - **seed 源 fixture（只读）**：`db/seed.ts` 的播种来源，不是运行时写入目标——`config/versions/version-code-rules.json`、`config/templates/example-template.json`、`config/rules/example-rule-set.json`、`config/system/requirement-settings.json`、`config/system/implementation-dependency-rules.json`、`config/knowledge/store.json`
  - **运行时状态文件（非 store，永久豁免）**：`config/system/model-verify-status.json`（模型校验状态缓存，读写方 `system-effective.ts`）
  - **离线评测资产（非请求路径）**：`config/rag/*.json`（baseline-samples / knowledge-retrieval-samples / prompts）

## 目录结构

- `ui/V2_PROTOTYPE`：当前唯一 Web 前端主线（Vite + React，Phase B）
- `apps/api`：后端 API 服务
- `config/templates` / `config/rules` / `config/knowledge`：模板 / 规则集 / 知识词条的 **seed 源 fixture**（本体已改存 PostgreSQL `templates` / `rule_sets` 等表）
- `config/system`：系统配置 seed 源 + `model-verify-status.json`（运行时状态缓存，非 store）
- `config/versions`：版本号编码规则 seed 源 fixture（编码规则与版本记录本体均已改存 PostgreSQL）
- `config/rag`：RAG 离线评测样本与 prompt 配置资产
- 【历史说明，已下线】`config/auth` / `config/teams`：目录已随阶段 2 批 1 与 S5 删除，数据改存 PostgreSQL
- `scripts`：规则抽取、回归、测试脚本
- `对话流程总结`：过程沉淀与里程碑记录

## 本地启动

```bash
npm install
npm run dev:api
npm run dev:web
```

- Web 前端端口：以 `ui/V2_PROTOTYPE` 启动日志为准，默认 `3002`（勿与 API 默认 `3000` 冲突）。
- 后端健康检查：`http://localhost:3000/api/v1/health`

## 关键 API（节选）

- 认证与用户：
  - `POST /api/v1/auth/register`
  - `POST /api/v1/auth/login`
  - `GET /api/v1/auth/me`
  - `GET /api/v1/auth/users`（admin）
  - `PATCH /api/v1/auth/users/:userId/status`（admin）
- 推荐码：
  - `POST /api/v1/auth/invite-codes/generate`（admin）
  - `GET /api/v1/auth/invite-codes`（admin）
- 版本管理：
  - `GET /api/v1/versions`
  - `POST /api/v1/versions`（未传 `versionCode` 时按已生效规则生成）
  - `POST /api/v1/versions/:id/checkout` / `checkin` / `undo-checkout` / `promote` 等（见 OpenAPI）
  - `PATCH /api/v1/versions/:recordId/status`
  - `DELETE /api/v1/versions/:type/:versionCode`
- 系统管理（**admin**）：
  - `GET /api/v1/system/version-code-rules`
  - `PATCH /api/v1/system/version-code-rules/:ruleId/config`
  - `POST /api/v1/system/version-code-rules/:ruleId/activate` / `disable`
- 模板与规则：
  - `GET /api/v1/templates`
  - `GET /api/v1/rule-sets/active`
- 估算与导出：
  - `POST /api/v1/estimates/calculate`
  - `POST /api/v1/estimates/calculate-and-export`
  - `GET /api/v1/exports/history`
  - `GET /downloads/:fileName`
- 团队协同（节选，完整见 OpenAPI 与对齐说明）：
  - `POST /api/v1/teams`
  - `GET /api/v1/teams/:teamId`
  - `GET|POST /api/v1/teams/:teamId/reviews` 等
- WBS（只读派生）：
  - `GET /api/v1/wbs`（基于当前用户最新 `GL-` 总方案生成任务行，无独立持久化）

## 常用脚本

- `npm run build:web`：构建 Web 前端主线（Vite + React）
- `npm run build:api`：构建后端
- `npm run test:modules`：模块级单元/行为测试（API）
- `npm run test:api:team`：团队 API 冒烟（`scripts/team-api-check.js`）
- `npm run test:api:integration`：API 集成检查脚本（`scripts/api-integration-check.js`）
- `npm run rules:standardize`：规则标准化抽取
- `npm run rules:regression`：规则回归
- `npm run rules:excel-report`：Excel 对比报告
- `docker compose up --build`：根目录最小编排（API + Web，见部署说明）
- `npm run test:web`：运行 Web 前端主线 Vitest 测试
- `npm run test:e2e:web`：当前临时映射到 `npm run test:web`；V2 e2e 后续补齐后再切回专用端到端脚本
- `npm run ops:backup:config`：备份 `config/*` 到 `backups/config/*`

> 【历史说明，已下线】原列于此的 `npm run ops:check:config` / `ops:check:config:repair`
> （配置完整性校验与修复）已于 2026-08-31 随阶段 2 S7（D15 执行）整链删除；校验器的
> `REQUIRED_FILES` 在九域 JSON 读写路径删完后已空，现行防线为 migrate fail-fast +
> seed 守卫 + 防漂移测试（均进 CI）。

## 文档入口

- **Codex 项目入口**：`codex-project-registry.md`（正确路径、禁止路径、验证命令、子代理分工）
- **AI Session 入口**：`AGENTS.md`（架构规则、约定、新 session 必读清单）；`CLAUDE.md` 仅保留为兼容入口并指向 `AGENTS.md`
- **Codex 工作流模板**：`docs/codex-workflows/`（需求反馈去重、长文档/Skill 交叉检查、外部 AI 回填、API 密钥验证）
- **前端迭代明细**：`04_开发实现/前端/前端迭代日志.md`
- **当前进展索引**：`03_技术设计/系统架构/WES-Agent-升级总看板/index.html`
- **需求基线分层（首发/二轮/三轮）**：`01_需求管理/需求基线V1-首发与迭代分层清单.md`
- 里程碑与协作沉淀：`对话流程总结/对话流程与里程碑总览.md`
- **实现与设计文档差异对照（以代码为准）**：`03_技术设计/系统演进/实现与文档对齐说明.md`
- 预置选择模式（实施评估）：`02_产品设计/规则与口径/PredefinedTemplate.md`
- 环境变量：`.env.example`、`docs/ENVIRONMENT.md`
- 部署与 Docker：`06_发布与部署/部署说明-待完善.md`
- 调用说明：`docs/LLM_API_CALLING_GUIDE.md`
- 外部 Agent 调用模板（需按当前已挂载路径调整）：`docs/EXTERNAL_AGENT_SKILL_TEMPLATE.md`
