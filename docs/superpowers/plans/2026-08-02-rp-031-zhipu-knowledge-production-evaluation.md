# RP-031 智谱知识库可信运行与效果评测 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有智谱知识库配置、问答和 Trace 基线上补齐安全激活、可调检索、完整追踪、20 条样本评测与单候选对比闭环。

**Architecture:** 保留 `system.repository.ts` 的 JSON store 为单一配置权威；探针与生产调用复用一个智谱 URL policy；现有知识库工具接收版本化配置与请求 ID，并把供应商请求 ID、Prompt 和配置版本写入统一 Trace。评测复用 `runRagBaseline` 的单次查询结果，CLI 将脱敏报告写入 ignored 运行目录，不自动激活候选配置。

**Tech Stack:** Node.js 20、TypeScript、Express、React 18、Vite、Vitest、Node test runner、现有 WES CSS tokens。

---

### Task 1: 建立可重复安全基线

**Files:**
- Modify: `scripts/check-tracked-secrets.js`
- Modify: `package.json`
- Create: `scripts/check-tracked-secrets.test.js`
- Create: `apps/api/src/services/ai/knowledge-base-url-policy.ts`
- Create: `apps/api/src/services/ai/knowledge-base-url-policy.test.ts`
- Modify: `apps/api/package.json`

- [ ] **Step 1: 写安全扫描 RED 测试**

测试必须证明缺失的 ignored runtime 文件不会导致失败、受控文件中的 secret 字段会失败且输出只包含字段路径：

```js
test('missing ignored runtime config is skipped', () => {
  const result = runScanner(['config/system/not-created.json'])
  assert.equal(result.status, 0)
})

test('reports secret path without printing secret value', () => {
  const result = runScanner([fixtureWithApiKey])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /credentials\.apiKey/)
  assert.doesNotMatch(result.stderr, /unit-secret-value/)
})
```

- [ ] **Step 2: 运行测试并确认因缺失文件处理和可测试入口不存在而失败**

Run: `node --test scripts/check-tracked-secrets.test.js`

- [ ] **Step 3: 最小实现 tracked-file 发现与 missing skip**

扫描器导出 `scanFiles(paths)`；CLI 默认读取 `git ls-files '*.json'` 后扫描，不再硬编码必定存在的 ignored 文件。存在的显式 runtime 文件可以附加扫描，但缺失时跳过。

- [ ] **Step 4: 写 URL policy RED 测试**

```ts
assert.equal(assertAllowedZhipuUrl('https://open.bigmodel.cn/api/paas/v4').hostname, 'open.bigmodel.cn')
assert.throws(() => assertAllowedZhipuUrl('http://open.bigmodel.cn'))
assert.throws(() => assertAllowedZhipuUrl('https://127.0.0.1'))
assert.throws(() => assertAllowedZhipuUrl('https://user@open.bigmodel.cn'))
assert.throws(() => assertAllowedZhipuUrl('https://open.bigmodel.cn:8443'))
```

- [ ] **Step 5: 实现共享 URL policy**

```ts
export function assertAllowedZhipuUrl(raw: string): URL {
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.hostname !== 'open.bigmodel.cn' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new KnowledgeBaseUrlPolicyError('knowledge_base_url_not_allowed')
  }
  return url
}
```

- [ ] **Step 6: 将 focused tests 加入 package scripts 并跑 GREEN**

Run: `node --test scripts/check-tracked-secrets.test.js`

Run: `npx tsx --test apps/api/src/services/ai/knowledge-base-url-policy.test.ts`

- [ ] **Step 7: 提交**

```bash
git add package.json apps/api/package.json scripts/check-tracked-secrets.js scripts/check-tracked-secrets.test.js apps/api/src/services/ai/knowledge-base-url-policy.ts apps/api/src/services/ai/knowledge-base-url-policy.test.ts
git commit -m "fix(RP-031): 建立可重复的知识库安全基线"
```

### Task 2: 修复凭证三态并建立测试后激活门禁

**Files:**
- Modify: `apps/api/src/modules/system/system.contract.ts`
- Modify: `apps/api/src/modules/system/system.repository.ts`
- Modify: `apps/api/src/modules/system/system.repository.test.ts`
- Modify: `apps/api/src/modules/system/system.usecase.ts`
- Modify: `apps/api/src/modules/modules.usecase.test.ts`
- Create: `apps/api/src/services/ai/knowledge-base-access-probe.ts`
- Create: `apps/api/src/services/ai/knowledge-base-access-probe.test.ts`

- [ ] **Step 1: 写 Repository RED 测试**

覆盖 `undefined=保留`、非空字符串=替换、`null=清除`，并验证配置 hash 在模型、地址、knowledgeId、密钥或检索参数变化后改变，但不泄露密钥。

- [ ] **Step 2: 写 probe/activate RED 测试**

```ts
test('activation rejects missing successful probe with 409')
test('activation rejects probe for a changed draft hash')
test('activation rejects probe older than 24 hours')
test('zero retrieval is a successful access probe with warning')
test('probe rejects 401, 429, 5xx, business error, timeout and forbidden URL')
```

- [ ] **Step 3: 运行 RED**

Run: `npx tsx --test apps/api/src/modules/system/system.repository.test.ts apps/api/src/services/ai/knowledge-base-access-probe.test.ts`

- [ ] **Step 4: 扩展 JSON store**

```ts
type KnowledgeBaseProbe = {
  ok: boolean
  configHash: string
  testedAt: string
  warning?: 'retrieval_empty'
  providerRequestId?: string
  errorReason?: string
}
```

配置保存继续由 `saveKnowledgeBaseConfigStore` 单写 JSON；任何 draft 变更保留历史 probe 但 hash 不再匹配。API 输出只返回 `apiHint`，不返回明文。

- [ ] **Step 5: 实现独立 access probe 与激活 Gate**

探针使用 10 秒 AbortController、`redirect: 'error'`、共享 URL policy 和智谱 `knowledge_ids` 数组。激活缺少探针、探针失败、hash 变化或超过 24 小时时返回 HTTP 409 和可操作 reason。

- [ ] **Step 6: 增加 route/usecase 权限矩阵**

未登录访问四个知识库接口返回 401；普通用户返回 403；管理员可进入 handler。使用现有 JWT/RBAC 中间件，不新增角色判断。

- [ ] **Step 7: 跑 GREEN 和模块回归**

Run: `npx tsx --test apps/api/src/modules/system/system.repository.test.ts apps/api/src/services/ai/knowledge-base-access-probe.test.ts apps/api/src/modules/modules.usecase.test.ts`

- [ ] **Step 8: 提交**

```bash
git add apps/api/src/modules/system apps/api/src/services/ai/knowledge-base-access-probe.ts apps/api/src/services/ai/knowledge-base-access-probe.test.ts
git commit -m "feat(RP-031): 以真实探针守卫知识库配置激活"
```

### Task 3: 让检索参数、Prompt 与请求追踪进入生产链路

**Files:**
- Modify: `apps/api/src/modules/system/system.contract.ts`
- Modify: `apps/api/src/modules/system/system.repository.ts`
- Modify: `apps/api/src/modules/system/system.repository.test.ts`
- Modify: `apps/api/src/services/ai/knowledge-tool.service.ts`
- Modify: `apps/api/src/services/ai/knowledge-tool.service.test.ts`
- Create: `apps/api/src/services/ai/rag-eval/prompt-registry.ts`
- Create: `apps/api/src/services/ai/rag-eval/prompt-registry.test.ts`
- Create: `config/rag/prompts.json`
- Modify: `apps/api/src/services/ai/chat.service.ts`
- Modify: `apps/api/src/services/ai/chat.service.test.ts`
- Modify: `apps/api/src/services/ai/workbench-dispatch.service.ts`
- Modify: `apps/api/src/services/ai/workbench-dispatch.service.test.ts`
- Modify: `apps/api/src/modules/trace/trace.types.ts`
- Modify: `apps/api/src/modules/trace/trace.usecase.ts`
- Modify: `apps/api/src/modules/trace/trace.test.ts`

- [ ] **Step 1: 写检索参数 RED 测试**

测试 normalization 边界和实际智谱请求 body：

```ts
assert.deepEqual(body, {
  query: '如何配置实施工作台', knowledge_ids: ['kb-1'], top_k: 6, top_n: 12,
  recall_method: 'mixed', rerank_status: 1, rerank_model: 'rerank', fractional_threshold: 0.35,
  request_id: 'request-1'
})
```

- [ ] **Step 2: 写 Prompt Registry RED 测试**

验证按 `id/version` 加载、内容 hash 稳定、未知版本失败、Prompt metadata 出现在知识库 trace。

- [ ] **Step 3: 写统一 Trace RED 测试**

```ts
assert.equal(knowledgeSpan.attributes.requestId, requestId)
assert.equal(knowledgeSpan.attributes.providerRequestId, 'zhipu-request-1')
assert.equal(knowledgeSpan.attributes.promptVersion, 'v1')
assert.equal(knowledgeSpan.attributes.configVersion, 3)
assert.deepEqual(knowledgeSpan.attributes.retrievalParams, expectedParams)
```

- [ ] **Step 4: 运行 RED**

Run: `npx tsx --test apps/api/src/services/ai/knowledge-tool.service.test.ts apps/api/src/services/ai/rag-eval/prompt-registry.test.ts apps/api/src/modules/trace/trace.test.ts apps/api/src/services/ai/chat.service.test.ts`

- [ ] **Step 5: 实现 normalization、Prompt Registry 与生产接线**

`ZhipuKnowledgeToolConfig` 增加 `retrievalParams`、`promptProfile`、`configVersion`、`requestId`。检索和生成均先调用 URL policy，均传 `request_id`，均使用 `redirect: 'error'`，解析响应头或 body 的供应商 request ID。

- [ ] **Step 6: 扩展统一 Trace**

HTTP middleware 生成/接受可信 request ID；chat → dispatch → knowledge tool 贯通；`recordWorkbenchTurnTrace` 将 request/provider/prompt/config/retrieval metadata 写入现有 `knowledge_retrieval` span，不创建第二套追踪体系。

- [ ] **Step 7: 跑 GREEN 与 focused 回归**

Run: `npx tsx --test apps/api/src/services/ai/knowledge-tool.service.test.ts apps/api/src/services/ai/rag-eval/prompt-registry.test.ts apps/api/src/modules/trace/trace.test.ts apps/api/src/services/ai/chat.service.test.ts apps/api/src/services/ai/workbench-dispatch.service.test.ts`

- [ ] **Step 8: 提交**

```bash
git add apps/api/src config/rag/prompts.json
git commit -m "feat(RP-031): 贯通检索配置 Prompt 与请求追踪"
```

### Task 4: 完成知识库管理页面行为

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/hooks/useSystemManagement.js`
- Modify: `ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx`
- Modify: `ui/V2_PROTOTYPE/src/__tests__/SystemManagementKnowledgeBase.test.jsx`
- Modify: `ui/V2_PROTOTYPE/src/__tests__/KnowledgeBaseFeedback.test.jsx`
- Modify: `docs/openapi.yaml`

- [ ] **Step 1: 写 Web RED 测试**

覆盖：已保存 masked key 显示“清除已保存密钥”；确认后 PATCH `apiKey:null`；检索参数保存进 payload；409 激活错误保留输入并显示重测提示；现有保存/生效/连通性内联反馈不回退。

- [ ] **Step 2: 运行 RED**

Run: `npm run test --prefix ui/V2_PROTOTYPE -- SystemManagementKnowledgeBase.test.jsx KnowledgeBaseFeedback.test.jsx`

- [ ] **Step 3: 实现最小 UI**

在 `/system/knowledge-base` 现有表单增加一个检索参数 fieldset 和显式清除动作，继续使用现有 `input`、`btn`、CSS tokens 和 `role=status/alert`。不增加新依赖、弹窗系统或评测大屏。

- [ ] **Step 4: 更新 OpenAPI**

知识库 draft schema 包含 `retrievalParams`、`promptProfile` 和凭证三态；activate 声明 409；四个接口声明 401/403；返回 probe 状态但不返回密钥。

- [ ] **Step 5: 跑 GREEN、scope checker 与 Web 回归**

Run: `npm run test --prefix ui/V2_PROTOTYPE -- SystemManagementKnowledgeBase.test.jsx KnowledgeBaseFeedback.test.jsx`

Run: `node skills/improving-wes-ui/scripts/check-ui-scope.mjs --base 53f3b7f -- ui/V2_PROTOTYPE/src/hooks/useSystemManagement.js ui/V2_PROTOTYPE/src/pages/SystemManagement.jsx`

- [ ] **Step 6: 提交**

```bash
git add ui/V2_PROTOTYPE/src docs/openapi.yaml
git commit -m "feat(RP-031): 完成知识库调参与安全激活交互"
```

### Task 5: 将 baseline 扩展为 20 条可重复评测

**Files:**
- Modify: `apps/api/src/services/ai/rag-baseline/rag-baseline-runner.ts`
- Modify: `apps/api/src/services/ai/rag-baseline/rag-baseline-runner.test.ts`
- Create: `apps/api/src/services/ai/rag-baseline/rag-baseline-dataset.ts`
- Create: `apps/api/src/services/ai/rag-baseline/rag-baseline-dataset.test.ts`
- Create: `config/rag/baseline-samples.v1.json`

- [ ] **Step 1: 写 dataset 与报告 RED 测试**

验证数据集正好包含至少 20 条唯一 ID、问题非空、每条有 expectedKeywords/expectedDocs/expectAnswer 中至少一项；报告包含 dataset/knowledge/config/prompt/scorer 指纹、P95 延迟和平均 Token。

- [ ] **Step 2: 运行 RED**

Run: `npx tsx --test apps/api/src/services/ai/rag-baseline/rag-baseline-dataset.test.ts apps/api/src/services/ai/rag-baseline/rag-baseline-runner.test.ts`

- [ ] **Step 3: 创建脱敏业务样本与版本指纹**

样本覆盖产品能力、实施范围、行业方案、功能边界和无答案问题；不包含客户名、账号、密钥或真实敏感数据。Runner 继续保证每条样本一次 queryFn 调用。

- [ ] **Step 4: 扩展报告指标**

增加 `p95LatencyMs`、`avgTokens`、`answerableAccuracy` 和版本元数据；空数据集返回全零而不是除零异常。

- [ ] **Step 5: 跑 GREEN**

Run: `npx tsx --test apps/api/src/services/ai/rag-baseline/rag-baseline-dataset.test.ts apps/api/src/services/ai/rag-baseline/rag-baseline-runner.test.ts`

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/services/ai/rag-baseline config/rag/baseline-samples.v1.json
git commit -m "feat(RP-031): 建立二十条知识库可重复评测基线"
```

### Task 6: 增加 CLI、报告持久化与单候选比较

**Files:**
- Create: `apps/api/src/services/ai/rag-baseline/rag-baseline-comparison.ts`
- Create: `apps/api/src/services/ai/rag-baseline/rag-baseline-comparison.test.ts`
- Create: `apps/api/src/services/ai/rag-baseline/rag-baseline-report.repository.ts`
- Create: `apps/api/src/services/ai/rag-baseline/rag-baseline-report.repository.test.ts`
- Create: `apps/api/src/services/ai/rag-baseline/rag-baseline.cli.ts`
- Modify: `apps/api/package.json`
- Modify: `.gitignore`

- [ ] **Step 1: 写 comparison RED 测试**

```ts
assert.equal(compareRagReports(baseline, improved).decision, 'recommended')
assert.equal(compareRagReports(baseline, slower).decision, 'not_recommended')
assert.equal(compareRagReports(baseline, costly).reasons.includes('token_budget_exceeded'), true)
```

- [ ] **Step 2: 写报告脱敏与持久化 RED 测试**

报告路径只能位于 ignored runtime 目录；序列化结果不得包含 `apiKey`、Authorization 或测试 secret；文件名包含 dataset 版本与时间。

- [ ] **Step 3: 运行 RED**

Run: `npx tsx --test apps/api/src/services/ai/rag-baseline/rag-baseline-comparison.test.ts apps/api/src/services/ai/rag-baseline/rag-baseline-report.repository.test.ts`

- [ ] **Step 4: 实现门槛比较**

默认阈值固定为：主质量指标 +5pp、次质量指标最多 -2pp、fallback 不增加、P95 延迟最多 +20%、平均 Token 最多 +15%。返回每条未通过原因，不自动调用 activate API。

- [ ] **Step 5: 实现 CLI**

`npm run rag:baseline -w apps/api -- --dataset config/rag/baseline-samples.v1.json` 执行当前激活配置；可选 `--candidate <json>` 执行候选并输出 comparison。CLI 只打印报告路径和摘要，不打印密钥或完整请求体。

- [ ] **Step 6: 跑 GREEN 和无凭证安全 dry-run**

Run: `npx tsx --test apps/api/src/services/ai/rag-baseline/*.test.ts`

Run: `npm run rag:baseline -w apps/api -- --help`

- [ ] **Step 7: 提交**

```bash
git add .gitignore apps/api/package.json apps/api/src/services/ai/rag-baseline
git commit -m "feat(RP-031): 提供知识库评测报告与候选决策"
```

### Task 7: 浏览器验收、全量 Gate 与总看板回填

**Files:**
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/requirements.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/plan.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/testing.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/monitoring.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/risks.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/changes.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/sources.html`
- Modify: `03_技术设计/系统演进/实现与文档对齐说明.md`

- [ ] **Step 1: 启动 API/Web 并执行浏览器验证**

在 1440px 和 760px 下验证 `/system/knowledge-base` 的保存、清除、调参、测试、激活失败反馈、键盘顺序与窄屏可达性。真实凭证不可进入截图、日志或回填文本。

- [ ] **Step 2: 运行完整自动化 Gate**

Run: `npm run test:security`

Run: `npm run test:modules`

Run: `npm run test:ai`

Run: `npm run test:integration`

Run: `npm run test:web`

Run: `npm run build:api`

Run: `npm run build:web`

- [ ] **Step 3: 执行真实评测条件检查**

若当前环境存在可用的 owner 配置，运行 baseline 和候选比较；否则只运行 `--help` 与 mocked comparison，并把“真实 20 条评测待 owner 回填”保留为人工 Gate，绝不伪造 PASS。

- [ ] **Step 4: 更新事实源和总看板**

登记四批实现、测试命令、branch/commit、JSON 单一存储决策、真实评测状态和未完成人工项。旧 rework 分支继续标记为禁止整体合并。

- [ ] **Step 5: 文档一致性与 diff 检查**

Run: `rg -n "RP-031|真实评测|PostgreSQL|JSON Repository|待回填" 03_技术设计/系统架构/WES-Agent-升级总看板 03_技术设计/系统演进/实现与文档对齐说明.md`

Run: `git diff --check`

- [ ] **Step 6: 提交**

```bash
git add 03_技术设计/系统架构/WES-Agent-升级总看板 03_技术设计/系统演进/实现与文档对齐说明.md
git commit -m "docs(RP-031): 回填智谱知识库四批交付与评测门禁"
```

### Task 8: 交付分支复核

- [ ] **Step 1: 核对工作区只包含 RP-031 文件**

Run: `git status --short --branch`

Run: `git diff 53f3b7f...HEAD --stat`

- [ ] **Step 2: 重跑最终证明命令**

至少重新运行 focused RP-031 tests、`test:modules`、`test:web`、`build:api`、`build:web`，并读取完整退出码。

- [ ] **Step 3: 输出结构化 handoff**

报告目标、commit、文件、RED/GREEN 证据、全量验证、浏览器视口、真实外部评测状态、剩余风险和建议集成方式。不得把“真实智谱评测待回填”写成已交付。
