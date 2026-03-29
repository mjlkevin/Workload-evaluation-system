# 工作量评估系统（Workload Evaluation System）

面向实施与开发场景的多页签评估系统，支持“需求导入 -> 实施评估 -> 开发评估 -> 资源人天及成本 -> 总方案归档”的完整评估链路，并提供用户隔离、版本管理与可追溯能力。

## 当前核心能力

- 多页签评估流程：
  - `总览`（评估方案列表、方案预览）
  - `需求导入`
  - `实施评估`
  - `开发评估`
  - `资源人天及成本`
  - `WBS`、`评审`（占位）
- 用户与权限：
  - 注册/登录/JWT 鉴权
  - 管理员用户管理、状态启停
  - 推荐码（邀请码）生成与注册校验
- 版本体系（前后端联动）：
  - 实施评估：`PG-`
  - 资源人天：`RS-`
  - 需求导入：`RI-`
  - 开发评估：`DV-`
  - 总方案：`GL-`
  - 后端统一版本记录与引用完整性校验
- 数据隔离与安全：
  - 前端草稿按用户隔离存储
  - 后端导出历史、下载与会话数据按 `ownerUserId` 鉴权
- 导入与解析：
  - 需求导入支持 Excel 上传解析
  - Kimi 模型解析 + 规则回退解析融合，提升结构化表单兼容性

## 重构进度（2026-03）

- 后端重构：已完成
  - 核心域全部迁移到 `apps/api/src/modules/*`
  - `auth / versions / templates / rules / ai / estimates / exports / sessions` 已模块化
  - 主要域完成 `controller/usecase/repository` 分层，兼容层保留
- 前端重构：已完成深度 UI 改造（业务逻辑保持不变）
  - 基于 `apple-ui-preview` 设计语言对现有页面做深度视觉迁移
  - 样式体系收敛为：
    - `apps/web/src/assets/apple-preview-base.css`
    - `apps/web/src/assets/apple-preview-overrides.css`
  - 结构级增强：`topbar` 标题/副标题/身份徽标语义对齐
  - 交互和业务逻辑未改动（仍保持单文件业务实现）
- 质量回归：已通过
  - `npm run test:modules`
  - `npm run test:rules`
  - `npm run test:integration`
  - `npm run build:api`
  - `npm run build:web`

## Agent-Friendly API（MVP已落地）

- 已交付高层 Agent 接口：
  - `POST /api/v1/agent/estimate`
  - `POST /api/v1/agent/session/start`
  - `POST /api/v1/agent/session/:sessionId/continue`
- 响应可解释字段：
  - `status`（`success | needs_clarification | failed`）
  - `normalizedRequest`、`missingFields`、`missingFieldsCount`
  - `assumptions`、`nextQuestions`
  - `intentCandidates`（topK + `score` + `reason`）
- 可观测性增强：
  - 已新增访问日志：`logs/api-access.log`
  - 已新增日志汇总脚本：`npm run logs:api:report`

## 技术栈

- 前端：`Vue 3` + `TypeScript` + `Vite`
- 后端：`Express` + `TypeScript`
- 存储：当前以本地文件持久化为主（非传统数据库）
  - 用户：`config/auth/users.json`
  - 推荐码：`config/auth/invite-codes.json`
  - 版本：`config/versions/records.json`

## 目录结构

- `apps/web`：前端应用
- `apps/api`：后端 API 服务
- `config/templates`：模板配置
- `config/rules`：规则配置
- `config/versions`：版本持久化记录
- `scripts`：规则抽取、回归、测试脚本
- `对话流程总结`：过程沉淀与里程碑记录

## 本地启动

```bash
npm install
npm run dev:api
npm run dev:web
```

- 前端：`http://localhost:5173/`
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
  - `GET /api/v1/downloads/:fileName`
- Agent 高层接口：
  - `POST /api/v1/agent/estimate`
  - `POST /api/v1/agent/session/start`
  - `POST /api/v1/agent/session/:sessionId/continue`

## 常用脚本

- `npm run build:web`：构建前端
- `npm run build:api`：构建后端
- `npm run test:modules`：模块级单元/行为测试（API）
- `npm run test:api:agent`：Agent 高层接口冒烟测试
- `npm run logs:api:report`：API 访问日志汇总（成功率/耗时）
- `npm run rules:standardize`：规则标准化抽取
- `npm run rules:regression`：规则回归
- `npm run rules:excel-report`：Excel 对比报告

## 文档入口

- **项目进展与后续规划（推荐阅读）**：`00_项目治理/里程碑与计划/项目进展总结与后续规划.md`
- 里程碑与协作沉淀：`对话流程总结/对话流程与里程碑总览.md`
- **实现与设计文档差异对照（以代码为准）**：`03_技术设计/系统演进/实现与文档对齐说明.md`
- 预置选择模式（实施评估）：`02_产品设计/规则与口径/PredefinedTemplate.md`
- 环境变量：`.env.example`、`docs/ENVIRONMENT.md`
- 部署占位说明：`06_发布与部署/部署说明-待完善.md`
- 调用说明：`docs/LLM_API_CALLING_GUIDE.md`
- 外部 Agent 调用模板：`docs/EXTERNAL_AGENT_SKILL_TEMPLATE.md`
