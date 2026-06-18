# Work Log — P1-1 售前审查 Agent

**日期**: 2026-04-25
**分支**: feat/requirement-assessment-list-ux-polish (main project)
**提交**: 1f0f6ea

---

## 完成情况

P1-1 售前审查 Agent 端到端流程已实现，覆盖 US-5~US-8、US-21。

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/services/presales/requirement-pack.ts` | RequirementPackService：CRUD + 审阅(DSL) + 置信度 + 问询生成 |
| `src/services/presales/initial-estimate.ts` | InitialEstimateService：从需求包规则化生成初估包 |
| `src/services/presales/sow.ts` | SowService：从需求包生成 SOW 条目 + 版本升级 |
| `src/services/presales/index.ts` | Barrel export |
| `src/routes/presales.routes.ts` | 14 个端点，全量 RBAC 守卫 |
| `src/utils/errors.ts` | ApiError 业务异常类型 |
| `src/services/presales/presales.service.test.ts` | 9 个集成测试用例 |

### 修改文件

| 文件 | 说明 |
|------|------|
| `src/middleware/error-handler.ts` | 识别 ApiError 返回对应 HTTP 状态码 |
| `src/routes/index.ts` | 注册 `/presales` 路由 |
| `src/test-helpers/db.ts` | TRUNCATE 新增 3 张表 |
| `package.json` | test:ai 加入 presales 测试 |

### API 端点一览

| 方法 | 路径 | 能力位 | 说明 |
|------|------|--------|------|
| POST | `/presales/requirement-packs` | extractor:trigger | 从 extraction 创建需求包 |
| GET | `/presales/requirement-packs` | requirement:upload | 列出自己的需求包 |
| GET | `/presales/requirement-packs/:id` | requirement:upload | 详情 |
| PATCH | `/presales/requirement-packs/:id` | requirement:maintain | 更新 |
| DELETE | `/presales/requirement-packs/:id` | requirement:maintain | 删除 |
| POST | `/presales/requirement-packs/:id/review` | extractor:trigger | DSL 审阅 + 问询生成 |
| GET | `/presales/requirement-packs/:id/confidences` | requirement:upload | 字段级置信度(US-8) |
| POST | `/presales/requirement-packs/:id/initial-estimate` | estimates:create | 生成初估包(US-7) |
| GET | `/presales/initial-estimates/:id` | estimates:read | 初估包详情 |
| PATCH | `/presales/initial-estimates/:id` | estimates:write | 更新初估包 |
| POST | `/presales/requirement-packs/:id/sow` | estimates:create | 生成 SOW 条目 |
| GET | `/presales/sow-documents/:id` | estimates:read | SOW 详情 |
| PATCH | `/presales/sow-documents/:id` | estimates:write | 更新 SOW |
| GET | `/presales/requirement-packs/:id/sow` | estimates:read | 列出需求包关联 SOW |

### 测试报告

| 套件 | 用例数 | 结果 |
|------|--------|------|
| test:ai | 79 | ✅ 全绿 |
| test:modules | 39 | ✅ 全绿 |
| test:rules | 8 | ✅ 全绿 |
| test:integration | 1 | ✅ 全绿 |
| **合计** | **127** | **127/127** |

### 已知局限（P1-1 刻意保留）

1. **Inquiry 生成当前从 DSL violations 直接映射**，未接入 LLM 生成开放式问题。P1-3 可扩展。
2. **InitialEstimate 为规则化估算**，未接入 AI 估算。P1-3 可接入 KimiProvider 做智能估算。
3. **SOW 追加告警（US-21）** 仅做了 schema 设计（linkedAssessmentVersionId），主动告警逻辑需 P1-3 AssessmentVersion PG 化后实现。
4. **Evidence 覆盖历史** 已有 repository 方法，但 presales routes 中暂未暴露 PATCH evidence 端点。前端需要时可快速添加。

---

## 下一步

按 v2 路线图：P1-1 → **P1-3 PM/PMO Web 工作台** → P1-2 销售快报 Skill。
