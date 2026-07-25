# WES AI Structured Output Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 JSON Schema + Ajv 统一结构化输出契约，迁移 WES 生产 AI 结构化输出，并关闭企业画像事实伪造和 Harness V2 恢复阶段缺陷。

**Architecture:** 新增 `apps/api/src/ai/contracts`，集中提供契约、Ajv 校验、结构修复 runner 和有限格式回退。业务模块只选择契约并处理其风险级 fallback；Provider 继续独立负责网络重试。Harness 保留现有状态机和模型运行审计，通过同一 Schema 校验并记录 resumeStage。

**Tech Stack:** TypeScript 5.8、Node test runner、Ajv 8、ajv-formats、Express、Prometheus、Drizzle/PostgreSQL。

---

### Task 1: 统一契约运行时

**Files:**
- Create: `apps/api/src/ai/contracts/structured-output.ts`
- Create: `apps/api/src/ai/contracts/structured-output.test.ts`
- Create: `apps/api/src/ai/contracts/index.ts`
- Modify: `apps/api/src/metrics/index.ts`
- Modify: `apps/api/package.json`
- Modify: `package-lock.json`

- [x] **Step 1: 写失败测试**：定义一个 `{ok:boolean}` 契约，断言 runner 首次发送 `json_schema`、无效输出会带 Ajv 路径修复一次、明确不支持格式时才回退 `json_object`、鉴权错误不回退。

```ts
const contract: StructuredOutputContract<{ ok: boolean }> = {
  id: "test.ok",
  version: "1.0.0",
  name: "TestOk",
  riskTier: "R1",
  schema: {
    type: "object",
    required: ["ok"],
    additionalProperties: false,
    properties: { ok: { type: "boolean" } },
  },
};
const result = await runStructuredCompletion({ provider, contract, request });
assert.equal(result.data.ok, true);
assert.equal((provider.requests[0].responseFormat as JsonSchemaResponseFormat).type, "json_schema");
```

- [x] **Step 2: 运行红测**：`npx tsx --test src/ai/contracts/structured-output.test.ts`，预期因模块不存在或行为缺失失败。
- [x] **Step 3: 最小实现**：实现 `StructuredOutputContract<T>`、`validateStructuredValue`、`parseStructuredOutput`、`responseFormatForContract`、`runStructuredCompletion`、`StructuredOutputValidationError` 和结构化输出 Counter。
- [x] **Step 4: 运行绿测**：同一命令全部通过，并运行 `npm run build`。

### Task 2: 业务 Schema 注册表与企业画像缺陷

**Files:**
- Create: `apps/api/src/ai/contracts/wes-contracts.ts`
- Create: `apps/api/src/ai/contracts/wes-contracts.test.ts`
- Modify: `apps/api/src/services/ai/chat.service.test.ts`
- Modify: `apps/api/src/services/ai/chat.service.ts`

- [x] **Step 1: 写失败测试**：断言企业画像契约拒绝错误 candidates；模型或 API Key fallback 缺少行业时 `customerIndustry === ""`，并返回字段来源和 contract 元数据。

```ts
assert.equal(body.data.customerIndustry, "");
assert.equal(body.data.fieldProvenance.customerIndustry, "needs_user_input");
assert.equal(body.data.structuredOutput.contractId, "company-profile");
```

- [x] **Step 2: 运行红测**：聚焦运行 contract 与 chat 测试，确认固定行业和 `json_object` 断言导致失败。
- [x] **Step 3: 最小实现**：增加企业画像、附件分析/合并契约，改用 runner；移除固定行业，缺失字段标记为 `needs_user_input`。
- [x] **Step 4: 运行绿测**：`chat.service.test.ts` 与 contract 测试通过。

### Task 3: Harness 完整校验、人工干预和差异化恢复

**Files:**
- Modify: `apps/api/src/modules/harness/harness.usecase.test.ts`
- Modify: `apps/api/src/routes/harness.routes.test.ts`
- Modify: `apps/api/src/modules/harness/harness.usecase.ts`
- Modify: `apps/api/src/modules/harness/harness.types.ts`

- [x] **Step 1: 写失败测试**：断言 V1/V2 runner 收到对应 `json_schema`；confidence 越界和缺少 item 必填字段失败；interactive 失败进入 `needs_user_input` 并记录 `resumeStage`；V2 retry 恢复 `clarifying`。

```ts
assert.equal((input.responseFormat as JsonSchemaResponseFormat).type, "json_schema");
assert.equal(updated.stage, "needs_user_input");
assert.equal((updated.metadata as any).structuredOutput.resumeStage, "clarifying");
const retried = await retryHarnessRun(user, updated.harnessRunId, repo);
assert.equal(retried.stage, "clarifying");
```

- [x] **Step 2: 运行红测**：`npm run test:harness`，确认当前通用 `evidence_ready` 恢复与部分校验不足。
- [x] **Step 3: 最小实现**：parseReport 先经过 Ajv 契约；失败保存 `structuredOutput` 元数据；interactive 与 replay/regression 分流；retry 按 resumeStage 恢复。
- [x] **Step 4: 运行绿测**：Harness 全量通过。

### Task 4: 评估、变更、开发与抽取链路迁移

**Files:**
- Modify: `apps/api/src/services/ai-assessment.ts`
- Modify: `apps/api/src/services/ai/assessment.service.ts`
- Modify: `apps/api/src/modules/change-management/change-management.usecase.ts`
- Modify: `apps/api/src/services/change-management/change-submission.ts`
- Modify: `apps/api/src/services/dev-assessment/dev-assessment-ai.ts`
- Modify: `apps/api/src/services/ai/extractor.service.ts`
- Modify: `apps/api/src/ai/extractor/ai-extractor.ts`
- Modify: `apps/api/src/services/dev-assessment/dev-assessment-ai.test.ts`
- Modify: `apps/api/src/services/change-management/change-submission.test.ts`
- Modify: `apps/api/src/ai/extractor/requirement-extractor.test.ts`
- Modify: `apps/api/src/modules/modules.handlers.test.ts`

- [x] **Step 1: 写失败测试**：把现有 `responseFormat === "json_object"` 断言改为契约 id/schema，并增加无效结构 fallback、一次修复和质量分来源断言。

```ts
assert.equal((provider.lastRequest?.responseFormat as JsonSchemaResponseFormat).type, "json_schema");
assert.equal(result.usedFallback, false);
assert.equal(result.structuredOutput?.contractId, "dev-assessment-draft");
assert.equal(evidence.aiMeta?.confidenceSource, "schema_completeness");
```

- [x] **Step 2: 运行红测**：运行 provider/extractor/dev/change/assessment 聚焦测试，确认当前实现失败。
- [x] **Step 3: 最小实现**：非流式调用改用 runner；流式调用使用同一 response format 并在结束后本地校验；assessment 移除固定 0.78；旧 extractor 使用结构完整度分并记录来源。
- [x] **Step 4: 运行绿测**：聚焦测试通过，生产源码除 runner 兼容路径外无 `json_object` 字面量。

### Task 5: 文档、总看板与完整验证

**Files:**
- Modify: `03_技术设计/系统演进/实现与文档对齐说明.md`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/work-items/board-work-items.json`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/events/2026-07-15-structured-output-audit.json`
- Modify: `requirements.html`、`plan.html`、`testing.html`、`monitoring.html`、`risks.html`、`changes.html`

- [x] **Step 1: 同步事实**：更新两项 Defect 为已修复待人工复核，RP-027 标记本批自动化已交付；最小真实 Kimi strict schema canary 已通过，保留代表性业务场景与人工体验验收。
- [x] **Step 2: 运行完整验证**：`npm run build:api`、`npm run test:modules`、`npm run test:ai`、`npm run test:harness -w apps/api`、`npm run test:integration`、`npm run board:work-items:generate`、`npm run test:board-work-items`、`npm run board:check`。
- [x] **Step 3: 复核交付边界**：确认未改 JWT/RBAC、正式写动作确认和第二套前后端主线；不保存任何凭证或完整敏感模型输入。
