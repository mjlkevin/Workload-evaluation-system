# Workload Evaluation System

轻量化工作量评估系统（Excel 规则迁移 + 可视化勾选 + 计算导出），用于替代原始估算表的手工流程。

## What this system does

- 以模板/规则文件驱动评估（配置化，不写死口径）
- 支持按层级勾选条目：工作表 -> 云产品 -> SKU -> 应用分组 -> 条目
- 支持计算、导出（Excel/PDF）和导出历史
- 支持会话态估算（不落库）和最小 RBAC（`X-Role`）
- 支持规则标准化与回归校验（脚本化）

## Repo layout

- `apps/web`: Vue 3 + Vite 前端（Dashboard + 评估工作台）
- `apps/api`: Express + TypeScript API
- `config/templates`: 模板配置
- `config/rules`: 规则配置
- `scripts`: 规则标准化、回归、集成校验脚本
- `05_测试与质量/测试报告`: 回归报告产物

## Quick start

```bash
npm install
npm run dev:api
npm run dev:web
```

- 前端: `http://localhost:5173/`
- 后端健康检查: `http://localhost:3000/api/v1/health`

## Frontend navigation

- `Dashboard`: 模板风格首页（概览 + 列表）
- `评估`: 当前系统主工作台（真实 API 数据）

## Key API endpoints

- 模板:
  - `GET /api/v1/templates`
  - `GET /api/v1/templates/:templateId`
  - `POST /api/v1/templates/import-excel`（`X-Role: admin`）
  - `POST /api/v1/templates/import-json`（`X-Role: admin`）
- 规则:
  - `GET /api/v1/rule-sets/active`
  - `GET /api/v1/rule-sets/meta`
  - `POST /api/v1/rule-sets/import-json`（`X-Role: admin`）
- 估算:
  - `POST /api/v1/estimates/calculate`
  - `POST /api/v1/estimates/calculate-and-export`
  - `POST /api/v1/estimates/export/excel`
  - `POST /api/v1/estimates/export/pdf`
  - `GET /api/v1/exports/history`
- 会话态:
  - `POST /api/v1/sessions/start`
  - `POST /api/v1/sessions/:sessionId/calculate`

## Script commands

- `npm run rules:standardize`: 从原始 Excel 抽取并标准化规则
- `npm run rules:regression`: 规则级回归（用户分段/组织增量）
- `npm run rules:excel-report`: 生成 Excel 对比报告（JSON + Markdown）
- `npm run test:rules`: 规则引擎单测
- `npm run test:integration`: API 集成测试
- `npm run test:all`: 一键测试闭环（单测 + 集成 + 回归 + 报告）

## Current implementation status

- 已完成:
  - 模板/规则导入（Excel/JSON）
  - 估算计算引擎 + pipeline 可配置执行
  - 会话态估算（不落库）
  - 导出（Excel/PDF）+ 幂等回放
  - 最小访问控制（`X-Role`）
  - 前端评估页真实 API 接入
  - 自动化测试与回归脚本
- 待完成:
  - 部署与发布链路（Docker、环境模板、发布回滚说明）
  - 手册与试点复盘