# RP-018 Knowledge Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only, discoverable, auditable Zhipu knowledge-base tool for the AI workbench so product-knowledge questions can be answered with retrieval status and confidence boundaries.

**Architecture:** Add a focused AI service under `apps/api/src/services/ai/` that wraps Zhipu chat completions through native `fetch`, with no `prompt_template`. Route product-knowledge intents from the existing home workbench dispatch layer, return a compact `knowledgeTool` trace, and render a small reference indicator in `ui/V2_PROTOTYPE` without changing formal estimation or Harness write-action boundaries.

**Tech Stack:** Node 22 native `fetch`, Express AI service layer, Node `node:test` module tests, Vite + React 18 frontend, existing `docs/openapi.yaml` and WES command board governance.

**Progress 2026-06-24:** Task 1 through Task 7 are complete for the RP-018 MVP implementation batch. Implemented `knowledge-tool.service.ts`, `knowledge_query` routing, `trace.knowledgeTool` dispatch output, assistant message `metadata.knowledgeTool`, OpenAPI `KnowledgeToolTrace`, Zhipu config wiring, AI 工作台 `知识库参考` trace chip, and command-board closure；verified focused dispatch 4 pass, focused session metadata 50 pass, `npm run test:modules` 98 pass, `npm run build:api` pass, `HomeWorkspace.test.jsx` 39 pass, V2 frontend 79 pass, `npm run build:web` pass, board consistency checks, and `git diff --check` pass. Remaining work is manual MT-1H-B-003 with a configured Zhipu key.

---

## File Structure

- Create: `apps/api/src/services/ai/knowledge-tool.service.ts`
  - Owns Zhipu configuration detection, request construction, response parsing, retrieval-trigger classification, and safe unavailable/error fallbacks.
- Create: `apps/api/src/services/ai/knowledge-tool.service.test.ts`
  - Unit tests for missing config, request payload, `prompt_template` exclusion, token-threshold confidence, and request failure fallback.
- Modify: `apps/api/src/services/ai/workbench-intent.service.ts`
  - Add `knowledge_query` to `WorkbenchIntentType` and route product-knowledge questions.
- Modify: `apps/api/src/services/ai/workbench-intent.service.test.ts`
  - Add classification tests for product-knowledge queries and regression tests that existing WES project queries still route as WES data queries.
- Modify: `apps/api/src/services/ai/workbench-dispatch.service.ts`
  - Call `queryZhipuKnowledgeBase` for `knowledge_query`, expose `trace.knowledgeTool`, and include a read-only answer section.
- Modify: `apps/api/src/services/ai/workbench-dispatch.service.test.ts`
  - Mock the knowledge service and verify success, missing config, and low-confidence dispatch outputs.
- Modify: `apps/api/src/services/ai/chat.service.ts`
  - Persist `metadata.knowledgeTool` on AI session assistant messages when dispatch returns a knowledge trace.
- Modify: `apps/api/src/modules/ai-sessions/ai-sessions.types.ts`
  - Extend metadata typing for `knowledgeTool` while preserving current `formBlock`.
- Modify: `apps/api/package.json`
  - Add `src/services/ai/knowledge-tool.service.test.ts` to `test:modules` so the new service stays in the standard backend module baseline.
- Modify: `docs/openapi.yaml`
  - Document `data.trace.knowledgeTool` and assistant message metadata shape.
- Modify: `apps/api/.env.example`
  - Keep or add `ZHIPU_API_KEY`, `ZHIPU_MODEL`, `ZHIPU_KNOWLEDGE_ID`, and `ZHIPU_API_BASE_URL`.
- Modify: `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx`
  - Render a compact "知识库参考" trace chip for assistant messages that include `metadata.knowledgeTool`.
- Modify: `ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx`
  - Cover the visible trace chip and low-confidence wording.
- Modify: `03_技术设计/系统演进/实现与文档对齐说明.md`
  - Record the contract and boundary after implementation.
- Modify command-board pages after each delivery batch:
  - `03_技术设计/系统架构/WES-Agent-升级总看板/requirements.html`
  - `03_技术设计/系统架构/WES-Agent-升级总看板/requirements-editor.html`
  - `03_技术设计/系统架构/WES-Agent-升级总看板/plan.html`
  - `03_技术设计/系统架构/WES-Agent-升级总看板/changes.html`
  - `03_技术设计/系统架构/WES-Agent-升级总看板/testing.html`
  - `03_技术设计/系统架构/WES-Agent-升级总看板/monitoring.html`
  - `03_技术设计/系统架构/WES-Agent-升级总看板/risks.html`
  - `03_技术设计/系统架构/WES-Agent-升级总看板/sources.html`

## Contract

Use this shape consistently across service, dispatch, OpenAPI, session metadata, and frontend rendering:

```ts
export type KnowledgeToolConfidence = 'high' | 'low';

export type KnowledgeToolFallbackReason =
  | 'missing_config'
  | 'retrieval_not_triggered'
  | 'request_failed'
  | 'empty_answer';

export interface KnowledgeToolTrace {
  toolId: 'knowledge_base.query_product_knowledge';
  available: boolean;
  retrievalTriggered: boolean;
  confidence: KnowledgeToolConfidence;
  fallbackReason?: KnowledgeToolFallbackReason;
  query: string;
  answer: string;
  model: string;
  knowledgeId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  contextRef: string;
}
```

Retrieval trigger rule for MVP: `retrievalTriggered = promptTokens >= 1000`. This follows `docs/智谱AI知识库集成指南.md`, where non-retrieved calls are typically below 100 prompt tokens and retrieved calls are above 1000.

## Task 1: Knowledge Service Unit Boundary

**Files:**
- Create: `apps/api/src/services/ai/knowledge-tool.service.ts`
- Create: `apps/api/src/services/ai/knowledge-tool.service.test.ts`

- [x] **Step 1: Write the missing-config test**

```ts
import { describe, expect, it } from 'vitest';
import { queryZhipuKnowledgeBase } from './knowledge-tool.service';

describe('queryZhipuKnowledgeBase', () => {
  it('returns an unavailable trace when Zhipu config is missing', async () => {
    const result = await queryZhipuKnowledgeBase('智能会计平台是什么', {
      apiKey: '',
      knowledgeId: '',
      model: 'glm-4.6',
      apiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4'
    });

    expect(result.available).toBe(false);
    expect(result.fallbackReason).toBe('missing_config');
    expect(result.retrievalTriggered).toBe(false);
    expect(result.confidence).toBe('low');
    expect(result.toolId).toBe('knowledge_base.query_product_knowledge');
  });
});
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `npm exec -w apps/api -- tsx --test --test-global-setup=./test-setup.mts src/services/ai/knowledge-tool.service.test.ts`

Expected: FAIL because `knowledge-tool.service.ts` does not exist.

- [x] **Step 3: Add the minimal service types and missing-config branch**

```ts
export type KnowledgeToolConfidence = 'high' | 'low';

export type KnowledgeToolFallbackReason =
  | 'missing_config'
  | 'retrieval_not_triggered'
  | 'request_failed'
  | 'empty_answer';

export interface ZhipuKnowledgeToolConfig {
  apiKey?: string;
  knowledgeId?: string;
  model?: string;
  apiBaseUrl?: string;
}

export interface KnowledgeToolTrace {
  toolId: 'knowledge_base.query_product_knowledge';
  available: boolean;
  retrievalTriggered: boolean;
  confidence: KnowledgeToolConfidence;
  fallbackReason?: KnowledgeToolFallbackReason;
  query: string;
  answer: string;
  model: string;
  knowledgeId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  contextRef: string;
}

const DEFAULT_MODEL = 'glm-4.6';
const DEFAULT_API_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';

export async function queryZhipuKnowledgeBase(
  query: string,
  config: ZhipuKnowledgeToolConfig = {}
): Promise<KnowledgeToolTrace> {
  const model = config.model || DEFAULT_MODEL;
  const apiBaseUrl = config.apiBaseUrl || DEFAULT_API_BASE_URL;
  const knowledgeId = config.knowledgeId || '';

  if (!config.apiKey || !knowledgeId) {
    return {
      toolId: 'knowledge_base.query_product_knowledge',
      available: false,
      retrievalTriggered: false,
      confidence: 'low',
      fallbackReason: 'missing_config',
      query,
      answer: '知识库工具未启用：缺少 ZHIPU_API_KEY 或 ZHIPU_KNOWLEDGE_ID。',
      model,
      knowledgeId,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: 0,
      contextRef: `knowledge:${knowledgeId || 'unconfigured'}:unavailable`
    };
  }

  return {
    toolId: 'knowledge_base.query_product_knowledge',
    available: true,
    retrievalTriggered: false,
    confidence: 'low',
    fallbackReason: 'request_failed',
    query,
    answer: '知识库工具调用尚未完成。',
    model,
    knowledgeId,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    latencyMs: 0,
    contextRef: `knowledge:${knowledgeId}:pending`
  };
}
```

- [x] **Step 4: Run the focused test and verify it passes**

Run: `npm exec -w apps/api -- tsx --test --test-global-setup=./test-setup.mts src/services/ai/knowledge-tool.service.test.ts`

Expected: PASS for the missing-config case.

## Task 2: Zhipu Fetch Payload And Retrieval Parsing

**Files:**
- Modify: `apps/api/src/services/ai/knowledge-tool.service.ts`
- Modify: `apps/api/src/services/ai/knowledge-tool.service.test.ts`

- [x] **Step 1: Add the fetch payload test**

```ts
it('calls Zhipu with a retrieval tool and without prompt_template', async () => {
  const fetchCalls: unknown[] = [];
  const fetchMock = async (url: string, init: RequestInit) => {
    fetchCalls.push([url, init]);
    return new Response(JSON.stringify({
      choices: [{ message: { content: '智能会计平台用于财务核算、税务、资金等场景。' } }],
      usage: { prompt_tokens: 1430, completion_tokens: 42, total_tokens: 1472 }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await queryZhipuKnowledgeBase('智能会计平台是什么', {
    apiKey: 'test-key',
    knowledgeId: '2057857904412954624',
    model: 'glm-4.6',
    apiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4'
  }, fetchMock as typeof fetch);

  expect(result.available).toBe(true);
  expect(result.retrievalTriggered).toBe(true);
  expect(result.confidence).toBe('high');
  expect(result.promptTokens).toBe(1430);
  expect(result.contextRef).toContain('knowledge:2057857904412954624:');

  const [, init] = fetchCalls[0] as [string, RequestInit];
  const body = JSON.parse(String(init.body));
  expect(body.tools).toEqual([
    { type: 'retrieval', retrieval: { knowledge_id: '2057857904412954624' } }
  ]);
  expect(JSON.stringify(body)).not.toContain('prompt_template');
});
```

- [x] **Step 2: Add the low-confidence parsing test**

```ts
it('marks low confidence when prompt tokens show retrieval did not trigger', async () => {
  const fetchMock = async () => new Response(JSON.stringify({
    choices: [{ message: { content: '未找到可靠知识库依据。' } }],
    usage: { prompt_tokens: 88, completion_tokens: 12, total_tokens: 100 }
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  const result = await queryZhipuKnowledgeBase('未覆盖问题', {
    apiKey: 'test-key',
    knowledgeId: '2057857904412954624'
  }, fetchMock as typeof fetch);

  expect(result.retrievalTriggered).toBe(false);
  expect(result.confidence).toBe('low');
  expect(result.fallbackReason).toBe('retrieval_not_triggered');
});
```

- [x] **Step 3: Run the focused test and verify it fails**

Run: `npm exec -w apps/api -- tsx --test --test-global-setup=./test-setup.mts src/services/ai/knowledge-tool.service.test.ts`

Expected: FAIL because the fetch branch and response parsing are not implemented.

- [x] **Step 4: Implement native fetch call and parsing**

```ts
interface ZhipuCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

function buildContextRef(knowledgeId: string, query: string, promptTokens: number): string {
  const safeQuery = query.replace(/\s+/g, '').slice(0, 16) || 'empty';
  return `knowledge:${knowledgeId}:${safeQuery}:${promptTokens}`;
}

export async function queryZhipuKnowledgeBase(
  query: string,
  config: ZhipuKnowledgeToolConfig = {},
  fetcher: typeof fetch = fetch
): Promise<KnowledgeToolTrace> {
  const startedAt = Date.now();
  const model = config.model || DEFAULT_MODEL;
  const apiBaseUrl = config.apiBaseUrl || DEFAULT_API_BASE_URL;
  const knowledgeId = config.knowledgeId || '';

  if (!config.apiKey || !knowledgeId) {
    return {
      toolId: 'knowledge_base.query_product_knowledge',
      available: false,
      retrievalTriggered: false,
      confidence: 'low',
      fallbackReason: 'missing_config',
      query,
      answer: '知识库工具未启用：缺少 ZHIPU_API_KEY 或 ZHIPU_KNOWLEDGE_ID。',
      model,
      knowledgeId,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: 0,
      contextRef: `knowledge:${knowledgeId || 'unconfigured'}:unavailable`
    };
  }

  try {
    const response = await fetcher(`${apiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: query }],
        tools: [{ type: 'retrieval', retrieval: { knowledge_id: knowledgeId } }]
      })
    });

    if (!response.ok) {
      throw new Error(`zhipu_http_${response.status}`);
    }

    const payload = await response.json() as ZhipuCompletionResponse;
    const answer = payload.choices?.[0]?.message?.content?.trim() || '';
    const promptTokens = payload.usage?.prompt_tokens || 0;
    const completionTokens = payload.usage?.completion_tokens || 0;
    const totalTokens = payload.usage?.total_tokens || promptTokens + completionTokens;
    const retrievalTriggered = promptTokens >= 1000;

    return {
      toolId: 'knowledge_base.query_product_knowledge',
      available: true,
      retrievalTriggered,
      confidence: retrievalTriggered && answer ? 'high' : 'low',
      fallbackReason: retrievalTriggered && answer ? undefined : answer ? 'retrieval_not_triggered' : 'empty_answer',
      query,
      answer: answer || '知识库没有返回可用答案。',
      model,
      knowledgeId,
      promptTokens,
      completionTokens,
      totalTokens,
      latencyMs: Date.now() - startedAt,
      contextRef: buildContextRef(knowledgeId, query, promptTokens)
    };
  } catch {
    return {
      toolId: 'knowledge_base.query_product_knowledge',
      available: true,
      retrievalTriggered: false,
      confidence: 'low',
      fallbackReason: 'request_failed',
      query,
      answer: '知识库工具调用失败，已降级为普通回答。',
      model,
      knowledgeId,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: Date.now() - startedAt,
      contextRef: `knowledge:${knowledgeId}:request_failed`
    };
  }
}
```

- [x] **Step 5: Run the focused test and verify it passes**

Run: `npm exec -w apps/api -- tsx --test --test-global-setup=./test-setup.mts src/services/ai/knowledge-tool.service.test.ts`

Expected: PASS for missing config, high-confidence retrieval, and low-confidence parsing.

- [x] **Step 6: Add the service test to the module baseline**

Modify `apps/api/package.json` so the `test:modules` script includes the new test file before the existing workbench dispatch tests:

```json
"test:modules": "tsx --test --test-global-setup=./test-setup.mts src/services/ai/knowledge-tool.service.test.ts src/services/ai/workbench-intent.service.test.ts src/services/ai/workbench-dispatch.service.test.ts src/modules/modules.unit.test.ts src/modules/modules.usecase.test.ts src/modules/modules.handlers.test.ts src/routes/project-evaluations.routes.test.ts"
```

Run: `npm run test:modules`

Expected: PASS for the full backend module suite with the new knowledge service tests included.

## Task 3: Intent Routing

**Files:**
- Modify: `apps/api/src/services/ai/workbench-intent.service.ts`
- Modify: `apps/api/src/services/ai/workbench-intent.service.test.ts`

- [x] **Step 1: Add intent tests**

```ts
it('routes product knowledge questions to knowledge_query', () => {
  const intent = routeWorkbenchIntent({
    message: '智能会计平台是什么，可以支持哪些模块？',
    attachments: []
  });

  expect(intent.intent).toBe('knowledge_query');
  expect(intent.confidence).toBeGreaterThanOrEqual(0.8);
});

it('keeps owner-scoped project list questions as WES data queries', () => {
  const intent = routeWorkbenchIntent({
    message: '我之前创建过哪些项目？',
    attachments: []
  });

  expect(intent.intent).toBe('wes_data_query');
});
```

- [x] **Step 2: Run intent tests and verify failure**

Run: `npm exec -w apps/api -- tsx --test --test-global-setup=./test-setup.mts src/services/ai/workbench-intent.service.test.ts`

Expected: FAIL because `knowledge_query` is not part of the intent union.

- [x] **Step 3: Add the intent type and routing pattern**

Add `knowledge_query` to `WorkbenchIntentType`.

Use these trigger terms in the existing rule order after WES data-query checks and before generic domain QA:

```ts
const PRODUCT_KNOWLEDGE_TERMS = [
  '智能会计平台',
  '金蝶云',
  '金蝶产品',
  '产品知识',
  '模块是什么',
  '资金管理',
  '网上银行',
  '融资管理',
  '销售管理',
  '供应链',
  '财务云'
];
```

Set the route result:

```ts
return {
  intent: 'knowledge_query',
  confidence: 0.86,
  routingRule: 'product_knowledge_terms'
};
```

- [x] **Step 4: Run intent tests and full module tests**

Run: `npm exec -w apps/api -- tsx --test --test-global-setup=./test-setup.mts src/services/ai/workbench-intent.service.test.ts`

Expected: PASS for intent tests.

Run: `npm run test:modules`

Expected: PASS for the full backend module suite.

## Task 4: Dispatch Integration And Session Metadata

**Files:**
- Modify: `apps/api/src/services/ai/workbench-dispatch.service.ts`
- Modify: `apps/api/src/services/ai/workbench-dispatch.service.test.ts`
- Modify: `apps/api/src/services/ai/chat.service.ts`
- Modify: `apps/api/src/modules/ai-sessions/ai-sessions.types.ts`

- [x] **Step 1: Add dispatch tests for success and unavailable states**

```ts
it('answers knowledge_query with knowledge trace and source boundary', async () => {
  const result = await dispatchHomeWorkbenchTurn({
    message: '智能会计平台是什么',
    businessRole: 'presales',
    attachments: [],
    knowledgeQuery: async () => ({
      toolId: 'knowledge_base.query_product_knowledge',
      available: true,
      retrievalTriggered: true,
      confidence: 'high',
      query: '智能会计平台是什么',
      answer: '智能会计平台用于财务核算、税务、资金等场景。',
      model: 'glm-4.6',
      knowledgeId: '2057857904412954624',
      promptTokens: 1430,
      completionTokens: 42,
      totalTokens: 1472,
      latencyMs: 320,
      contextRef: 'knowledge:2057857904412954624:智能会计平台是什么:1430'
    })
  });

  expect(result.intent.intent).toBe('knowledge_query');
  expect(result.answer).toContain('知识库参考');
  expect(result.answer).toContain('智能会计平台用于财务核算');
  expect(result.trace.knowledgeTool?.retrievalTriggered).toBe(true);
  expect(result.trace.contextRefs).toContain('knowledge:2057857904412954624:智能会计平台是什么:1430');
});

it('explains unavailable knowledge tool without breaking chat', async () => {
  const result = await dispatchHomeWorkbenchTurn({
    message: '智能会计平台是什么',
    businessRole: 'presales',
    attachments: [],
    knowledgeQuery: async () => ({
      toolId: 'knowledge_base.query_product_knowledge',
      available: false,
      retrievalTriggered: false,
      confidence: 'low',
      fallbackReason: 'missing_config',
      query: '智能会计平台是什么',
      answer: '知识库工具未启用：缺少 ZHIPU_API_KEY 或 ZHIPU_KNOWLEDGE_ID。',
      model: 'glm-4.6',
      knowledgeId: '',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: 0,
      contextRef: 'knowledge:unconfigured:unavailable'
    })
  });

  expect(result.answer).toContain('知识库工具未启用');
  expect(result.trace.knowledgeTool?.fallbackReason).toBe('missing_config');
});
```

- [x] **Step 2: Run dispatch tests and verify failure**

Run: `npm exec -w apps/api -- tsx --test --test-global-setup=./test-setup.mts src/services/ai/workbench-dispatch.service.test.ts`

Expected: FAIL because dispatch does not accept or emit `knowledgeTool`.

- [x] **Step 3: Extend dispatch data shape**

Add:

```ts
import type { KnowledgeToolTrace } from './knowledge-tool.service';
import { queryZhipuKnowledgeBase } from './knowledge-tool.service';

export interface WorkbenchDispatchTrace {
  intentConfidence: number;
  routingRule: string;
  contextRefs: string[];
  knowledgeTool?: KnowledgeToolTrace;
}
```

Allow dependency injection in test input:

```ts
knowledgeQuery?: typeof queryZhipuKnowledgeBase;
```

For `knowledge_query`, call `knowledgeQuery || queryZhipuKnowledgeBase`, append `contextRef`, and answer with this boundary:

```text
知识库参考（只读）

<answer>

检索状态：已触发 / 未触发；置信度：high / low。
该内容仅作为产品知识参考，不会自动改写正式工作量或传统记录。
```

- [x] **Step 4: Persist metadata in chat service**

When appending assistant messages, keep existing `metadata.formBlock` behavior and add:

```ts
metadata: {
  ...existingMetadata,
  formBlock: dispatchData.formBlock,
  knowledgeTool: dispatchData.trace.knowledgeTool
}
```

- [x] **Step 5: Run module tests and API build**

Run: `npm run test:modules`

Expected: PASS.

Run: `npm run build:api`

Expected: PASS.

## Task 5: API Contract And Env Documentation

**Files:**
- Modify: `docs/openapi.yaml`
- Modify: `apps/api/.env.example`
- Modify: `03_技术设计/系统演进/实现与文档对齐说明.md`

- [x] **Step 1: Update OpenAPI schemas**

Add `KnowledgeToolTrace` under components and reference it from home-workbench chat `data.trace.knowledgeTool` and AI session message `metadata.knowledgeTool`.

Required fields:

```yaml
toolId:
  type: string
  enum: [knowledge_base.query_product_knowledge]
available:
  type: boolean
retrievalTriggered:
  type: boolean
confidence:
  type: string
  enum: [high, low]
fallbackReason:
  type: string
  enum: [missing_config, retrieval_not_triggered, request_failed, empty_answer]
query:
  type: string
answer:
  type: string
model:
  type: string
knowledgeId:
  type: string
promptTokens:
  type: integer
completionTokens:
  type: integer
totalTokens:
  type: integer
latencyMs:
  type: integer
contextRef:
  type: string
```

- [x] **Step 2: Ensure env examples are present**

`apps/api/.env.example` must include:

```bash
ZHIPU_API_KEY=
ZHIPU_MODEL=glm-4.6
ZHIPU_KNOWLEDGE_ID=2057857904412954624
ZHIPU_API_BASE_URL=https://open.bigmodel.cn/api/paas/v4
```

- [x] **Step 3: Update implementation alignment notes**

Add a short current-fact paragraph:

```md
### RP-018 知识库工具

AI 工作台可通过 `knowledge_base.query_product_knowledge` 查询智谱知识库。该工具只读、可关闭、可审计，不使用 `prompt_template`；缺少 ZHIPU 配置时返回 `available=false`，不影响普通 AI 工作台对话。工具结果通过 `trace.knowledgeTool` 和 session message `metadata.knowledgeTool` 保存，正式工作量和传统记录仍必须经过 Kimi/WES 规则与人工确认。
```

- [x] **Step 4: Run contract checks**

Run: `rg "KnowledgeToolTrace|knowledgeTool|ZHIPU_KNOWLEDGE_ID" docs/openapi.yaml apps/api/.env.example 03_技术设计/系统演进/实现与文档对齐说明.md`

Expected: output includes all three files.

Run: `npm run build:api`

Expected: PASS.

## Task 6: Frontend Trace Rendering

**Files:**
- Modify: `ui/V2_PROTOTYPE/src/pages/AiHomeWorkbench.jsx`
- Modify: `ui/V2_PROTOTYPE/src/__tests__/HomeWorkspace.test.jsx`
- Modify if needed: `ui/V2_PROTOTYPE/src/__tests__/mocks/handlers.js`

- [x] **Step 1: Add frontend test**

```jsx
it('renders knowledge tool trace on assistant messages', async () => {
  render(<HomeWorkspace />);

  await screen.findByText(/知识库参考/);
  expect(screen.getByText(/retrievalTriggered=true/)).toBeInTheDocument();
  expect(screen.getByText(/glm-4.6/)).toBeInTheDocument();
});
```

Use the existing MSW session response shape and add this metadata to an assistant message:

```js
metadata: {
  knowledgeTool: {
    toolId: 'knowledge_base.query_product_knowledge',
    available: true,
    retrievalTriggered: true,
    confidence: 'high',
    query: '智能会计平台是什么',
    answer: '智能会计平台用于财务核算、税务、资金等场景。',
    model: 'glm-4.6',
    knowledgeId: '2057857904412954624',
    promptTokens: 1430,
    completionTokens: 42,
    totalTokens: 1472,
    latencyMs: 320,
    contextRef: 'knowledge:2057857904412954624:智能会计平台是什么:1430'
  }
}
```

- [x] **Step 2: Run focused frontend test and verify failure**

Run: `npm run test --prefix ui/V2_PROTOTYPE -- --run src/__tests__/HomeWorkspace.test.jsx`

Expected: FAIL because the trace chip is not rendered.

- [x] **Step 3: Render compact trace chip**

In the assistant message renderer, read:

```jsx
const knowledgeTool = message?.metadata?.knowledgeTool;
```

Render below the rich message body:

```jsx
{knowledgeTool ? (
  <div className="ai-message-trace" aria-label="知识库参考">
    <span>知识库参考</span>
    <code>{knowledgeTool.model}</code>
    <span>{`retrievalTriggered=${knowledgeTool.retrievalTriggered ? 'true' : 'false'}`}</span>
    <span>{knowledgeTool.confidence === 'high' ? '高置信' : '低置信'}</span>
  </div>
) : null}
```

Keep the UI compact; do not add a new right-side panel in this MVP.

- [x] **Step 4: Run frontend tests and build**

Run: `npm run test --prefix ui/V2_PROTOTYPE -- --run src/__tests__/HomeWorkspace.test.jsx`

Expected: PASS.

Run: `npm run test --prefix ui/V2_PROTOTYPE`

Expected: PASS.

Run: `npm run build:web`

Expected: PASS with only known Vite chunk-size warnings.

## Task 7: Board Closure For Implementation Batch

**Files:**
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/requirements.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/requirements-editor.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/plan.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/changes.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/testing.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/monitoring.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/risks.html`
- Modify: `03_技术设计/系统架构/WES-Agent-升级总看板/sources.html`

- [x] **Step 1: Update requirement status**

Move RP-018 from `已排期` to `实施中` when implementation begins, and to `已交付` only after backend, frontend, contract docs, and verification all pass.

- [x] **Step 2: Add testing evidence**

Record these commands with actual results:

```bash
npm run test:modules
npm run build:api
npm run test --prefix ui/V2_PROTOTYPE
npm run build:web
```

- [x] **Step 3: Keep manual test pending**

Add or update `MT-1H-B-003`:

```text
RP-018 知识库工具真实调用验收：输入“智能会计平台是什么”，确认工具可发现、retrievalTriggered=true、trace 可见；缺失配置时显示不可用原因；低置信问题不伪装为知识库命中。
```

Status stays `待执行` until a human runs it with a configured Zhipu key.

- [x] **Step 4: Run board consistency checks**

Run: `rg "RP-018|knowledgeTool|KnowledgeToolTrace|2026-06-24-wes-agent-rp-018-knowledge-tool" 03_技术设计/系统架构/WES-Agent-升级总看板 docs/superpowers/plans docs/openapi.yaml`

Expected: output includes the plan, requirement status, plan page, testing page, monitoring page, risks page, and OpenAPI contract.

Run: `rg "RP-018[^\\n]*(待规划|候选包保留|需先完成工具协议评审)" 03_技术设计/系统架构/WES-Agent-升级总看板`

Expected: no stale current-status wording after implementation is complete; historical context may remain only where explicitly describing prior analysis.

## Acceptance Criteria

- AI workbench classifies product-knowledge questions as `knowledge_query`.
- Knowledge tool can be discovered in the capability answer or trace and has a stable tool ID: `knowledge_base.query_product_knowledge`.
- Missing `ZHIPU_API_KEY` or `ZHIPU_KNOWLEDGE_ID` returns `available=false` and does not break normal chat.
- Successful query sends retrieval tool payload with `knowledge_id` only and no `prompt_template`.
- Query "智能会计平台是什么" returns a knowledge answer with `retrievalTriggered=true` when prompt tokens meet the threshold.
- Low-token or uncovered queries return `confidence=low` and `fallbackReason=retrieval_not_triggered` or `empty_answer`.
- `trace.knowledgeTool` and session `metadata.knowledgeTool` include model, knowledgeId, query, promptTokens, retrievalTriggered, latencyMs, contextRef, and answer summary.
- Frontend shows a compact knowledge-reference trace without occupying the right-side workspace.
- Knowledge answers are read-only references and do not create projects, estimates, versions, ToolEvent write actions, or formal records.

## Not In MVP

- Knowledge-base management UI.
- Automatic knowledge synchronization.
- Sending customer attachment fragments to Zhipu for joint retrieval.
- Replacing Kimi for SOW interpretation or formal workload estimation.
- Automatic rewrite of project estimates, pricing, delivery plans, or customer-facing formal reports.
