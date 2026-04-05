# 工作量评估系统（Workload Evaluation System）

面向实施与开发场景的多页签评估系统，支持“需求 -> 实施评估 -> 开发评估 -> 资源人天及成本 -> 总方案归档”的完整评估链路，并提供用户隔离、版本管理与可追溯能力。

## 当前核心能力

- 多页签评估流程：
  - `总览`（评估方案列表、方案预览）
  - `需求`
  - `实施评估`
  - `开发评估`
  - `资源人天及成本`
  - `WBS`（只读派生视图，见下文 API）、`评审`（团队评审能力见 `/api/v1/teams/.../reviews`）
- 用户与权限：
  - 注册/登录/JWT 鉴权
  - 管理员用户管理、状态启停
  - 推荐码（邀请码）生成与注册校验
- 版本体系（前后端联动）：
  - 实施评估：`PG-`
  - 资源人天：`RS-`
  - 需求：`RI-`
  - 开发评估：`DV-`
  - 总方案：`GL-`
  - 后端统一版本记录与引用完整性校验
- 数据隔离与安全：
  - 前端草稿按用户隔离存储
  - 后端导出历史、下载与会话数据按 `ownerUserId` 鉴权
- 导入与解析：
  - 需求支持 Excel 上传解析
  - Kimi 模型解析 + 规则回退解析融合，提升结构化表单兼容性
- 团队协同（后端 P0）：
  - 团队、成员、方案绑定、评审与评论：`/api/v1/teams/*`（持久化 `config/teams/store.json`）

## 前端与重构说明（2026-03 起）

- **主产品前端**：[`ui/V0_SAAS`](ui/V0_SAAS)（Next.js + TypeScript）。根目录 `npm run dev:web` / `npm run build:web` 指向此处。本地联调端口以子项目与代理配置为准（常见为 API `3000`，前端经代理占用其他端口，详见 [`docs/PROJECT_STATUS_2026-03-30.md`](docs/PROJECT_STATUS_2026-03-30.md)）。
- **后端**：[`apps/api`](apps/api) 核心域已迁至 `apps/api/src/modules/*`，路由聚合于 [`apps/api/src/routes/index.ts`](apps/api/src/routes/index.ts)。

## 质量回归（建议每次发布前执行）

首发统一硬门禁（严格 MVP）：

- `npm run test:modules`
- `npm run test:rules`
- `npm run test:integration`
- `npm run build:api`
- `npm run build:web`
- `npm run test:api:team`（团队 API 契约冒烟，见 `scripts/team-api-check.js`）

## Agent-Friendly API（规划项，当前运行时未挂载）

高层 `/api/v1/agent/*` **未包含在当前主线 Express 路由中**。规划与分阶段任务见 [`00_项目治理/里程碑与计划/项目开发TODO.md`](00_项目治理/里程碑与计划/项目开发TODO.md)。外部自动化或 Agent 集成请优先使用既有 **`POST /api/v1/estimates/calculate`**、**`/api/v1/sessions/*`** 等接口；契约说明见 [`docs/openapi.yaml`](docs/openapi.yaml) 文首注释。

## 技术栈

- 主前端：Next.js（`ui/V0_SAAS`）
- 后端：Express + TypeScript（`apps/api`）
- 存储：当前以本地文件持久化为主（非传统数据库）
  - 用户：`config/auth/users.json`
  - 推荐码：`config/auth/invite-codes.json`
  - 版本：`config/versions/records.json`
  - 团队：`config/teams/store.json`

## 目录结构

- `ui/V0_SAAS`：主前端（Next.js）
- `apps/api`：后端 API 服务
- `config/templates`：模板配置
- `config/rules`：规则配置
- `config/versions`：版本持久化记录
- `config/teams`：团队协同数据
- `scripts`：规则抽取、回归、测试脚本
- `对话流程总结`：过程沉淀与里程碑记录

## 本地启动

```bash
npm install
npm run dev:api
npm run dev:web
```

- 主前端端口：以 `ui/V0_SAAS` 启动日志为准（勿与 API 默认 `3000` 冲突）。
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
  - `POST /api/v1/versions`
  - `PATCH /api/v1/versions/:recordId/status`
  - `DELETE /api/v1/versions/:type/:versionCode`
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

- `npm run build:web`：构建主前端（Next）
- `npm run build:api`：构建后端
- `npm run test:modules`：模块级单元/行为测试（API）
- `npm run test:api:team`：团队 API 冒烟（`scripts/team-api-check.js`）
- `npm run test:api:integration`：API 集成检查脚本（`scripts/api-integration-check.js`）
- `npm run rules:standardize`：规则标准化抽取
- `npm run rules:regression`：规则回归
- `npm run rules:excel-report`：Excel 对比报告
- `docker compose up --build`：根目录最小编排（API + Web，见部署说明）
- `npm run test:e2e:web`：Next 端 Playwright 冒烟（需先 `npx playwright install chromium` 于 `ui/V0_SAAS`，并先启动 `npm run dev`）
- `npm run ops:backup:config`：备份 `config/*` 到 `backups/config/*`
- `npm run ops:check:config`：执行配置完整性校验
- `npm run ops:check:config:repair`：按兜底结构修复缺失/损坏配置，并记录日志

## 文档入口

- **项目现状总结（2026-03-30）**：`docs/PROJECT_STATUS_2026-03-30.md`
- **项目进展与后续规划（推荐阅读）**：`00_项目治理/里程碑与计划/项目进展总结与后续规划.md`
- **需求基线分层（首发/二轮/三轮）**：`01_需求管理/需求基线V1-首发与迭代分层清单.md`
- 里程碑与协作沉淀：`对话流程总结/对话流程与里程碑总览.md`
- **实现与设计文档差异对照（以代码为准）**：`03_技术设计/系统演进/实现与文档对齐说明.md`
- 预置选择模式（实施评估）：`02_产品设计/规则与口径/PredefinedTemplate.md`
- 环境变量：`.env.example`、`docs/ENVIRONMENT.md`
- 部署与 Docker：`06_发布与部署/部署说明-待完善.md`
- 调用说明：`docs/LLM_API_CALLING_GUIDE.md`
- 外部 Agent 调用模板（需按当前已挂载路径调整）：`docs/EXTERNAL_AGENT_SKILL_TEMPLATE.md`
