# WES Agent 后端三联实现计划（P1 + P2 + P3）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 WES Agent v1（售前估算助手）搭建后端三层基座：让 LLM Provider 支持工具调用、一个能自主多步执行的编排循环、以及把现有售前 usecase 包装成可调用的工具集。

**Architecture:** P1 给现有 `ModelProvider` 抽象层补 function-calling（请求带 `tools`、响应回 `toolCalls`），Kimi 走 OpenAI 兼容协议。P2 新建 `apps/api/src/agent/`：工具注册表（带能力位与读/写标记）+ 编排循环（plan→act→observe，含循环上限/权限/写操作确认护栏）。P3 把 `extract_requirement / estimate_implementation / export_pdf / archive_estimate` 等现有 usecase 注册为工具，并新增「归档自动匹配已有方案」repository 能力。**业务 usecase 不改，只读复用。**

**Tech Stack:** TypeScript + Express，测试用 Node 内置 `node:test` + `tsx`（`assert/strict`），测试就近放置。运行：`npm run test:modules`（modules 域）、新增测试挂到对应 test 脚本。

**关联文档:**
- 需求规格（基线 v1.0）：`01_需求管理/WES-Agent-v1-售前估算助手-需求规格.md`
- 技术方案：`03_技术设计/系统架构/WES-Agent-产品技术方案.html`

**分支:** 在 `feat/agent-workbench` worktree（`/Users/kevin/AI/Workload-evaluation-system-agent`）执行。

---

## 文件结构（先锁定边界）

| 文件 | 职责 | P |
|------|------|---|
| `apps/api/src/ai/provider/model-provider.ts`（改） | 接口加 `tools`/`toolChoice`/`toolCalls` 类型 | P1 |
| `apps/api/src/ai/provider/kimi-provider.ts`（改） | payload 注入 tools、解析 `tool_calls` | P1 |
| `apps/api/src/ai/provider/tool-calling.test.ts`（建） | P1 单测 | P1 |
| `apps/api/src/agent/agent.types.ts`（建） | 工具/调用/会话上下文类型 | P2 |
| `apps/api/src/agent/tool-registry.ts`（建） | 工具注册、按用户能力位过滤、执行分发 | P2 |
| `apps/api/src/agent/orchestrator.ts`（建） | 编排循环 + 护栏 | P2 |
| `apps/api/src/agent/agent.test.ts`（建） | P2 单测（用假 Provider/假工具） | P2 |
| `apps/api/src/agent/tools/presales.tools.ts`（建） | 售前工具：抽取/初估/导出/归档 | P3 |
| `apps/api/src/agent/tools/match.repository.ts`（建） | 归档自动匹配已有方案 | P3 |
| `apps/api/src/agent/tools/presales.tools.test.ts`（建） | P3 单测 | P3 |

> 命名一致性约定（贯穿全计划）：工具结构体字段为 `name / description / parameters / capability / mutates / execute`；调用结构体为 `{ id, name, arguments }`；Provider 响应字段为 `toolCalls`。

---

# P1 — Provider 工具调用基座

### Task 1：扩展 Provider 接口类型

**Files:**
- Modify: `apps/api/src/ai/provider/model-provider.ts`

- [ ] **Step 1：在 `model-provider.ts` 顶部类型区新增工具相关类型**

在 `ResponseFormat` 类型定义下方插入：

```typescript
/** 工具定义（OpenAI 兼容 function-calling 协议） */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    /** JSON Schema 参数对象 */
    parameters: Record<string, unknown>;
  };
}

/** 模型决定发起的一次工具调用 */
export interface ToolCall {
  /** 厂商返回的调用 id，回填结果时用 */
  id: string;
  /** 工具名 */
  name: string;
  /** 模型给出的参数（已解析为对象；解析失败为 {}） */
  arguments: Record<string, unknown>;
}

export type ToolChoice = "auto" | "none";
```

- [ ] **Step 2：给 `ChatCompletionRequest` 加可选字段**

在 `ChatCompletionRequest` 接口的 `credentialsOverride?` 字段后插入：

```typescript
  /** 可用工具清单；不传则普通对话 */
  tools?: ToolDefinition[];
  /** 工具选择策略；默认 auto */
  toolChoice?: ToolChoice;
```

- [ ] **Step 3：给 `ChatCompletionResponse` 加可选字段**

在 `ChatCompletionResponse` 接口的 `finishReason?` 字段后插入：

```typescript
  /** 模型发起的工具调用；无则 undefined 或空数组 */
  toolCalls?: ToolCall[];
```

- [ ] **Step 4：编译校验**

Run: `cd apps/api && npx tsc -p tsconfig.json --noEmit`
Expected: 通过（仅加类型，无实现变更）

- [ ] **Step 5：提交**

```bash
cd /Users/kevin/AI/Workload-evaluation-system-agent
git add apps/api/src/ai/provider/model-provider.ts
git commit -m "feat(agent): Provider 接口新增 tool-calling 类型 (P1-1)"
```

---

### Task 2：Kimi provider 解析 tool_calls（先写失败测试）

**Files:**
- Create: `apps/api/src/ai/provider/tool-calling.test.ts`
- Modify: `apps/api/src/ai/provider/kimi-provider.ts`

实现要点：抽出一个**纯函数** `parseChoiceMessage` 解析 choices[0].message，便于单测（不发真实 HTTP）。

- [ ] **Step 1：写失败测试**

```typescript
// apps/api/src/ai/provider/tool-calling.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { parseChoiceMessage } from "./kimi-provider";

test("parseChoiceMessage: 解析普通文本回复", () => {
  const r = parseChoiceMessage({
    message: { content: "你好" },
    finish_reason: "stop",
  });
  assert.equal(r.content, "你好");
  assert.equal(r.toolCalls, undefined);
});

test("parseChoiceMessage: 解析 tool_calls（content 可空）", () => {
  const r = parseChoiceMessage({
    message: {
      content: null,
      tool_calls: [
        { id: "call_1", type: "function", function: { name: "estimate_implementation", arguments: '{"packId":"RI-1"}' } },
      ],
    },
    finish_reason: "tool_calls",
  });
  assert.equal(r.content, "");
  assert.deepEqual(r.toolCalls, [{ id: "call_1", name: "estimate_implementation", arguments: { packId: "RI-1" } }]);
});

test("parseChoiceMessage: arguments 非法 JSON 兜底为空对象", () => {
  const r = parseChoiceMessage({
    message: { content: null, tool_calls: [{ id: "c2", type: "function", function: { name: "f", arguments: "{bad" } }] },
    finish_reason: "tool_calls",
  });
  assert.deepEqual(r.toolCalls?.[0].arguments, {});
});
```

- [ ] **Step 2：运行测试，确认失败**

Run: `cd apps/api && npx tsx --test src/ai/provider/tool-calling.test.ts`
Expected: FAIL（`parseChoiceMessage` 未导出）

- [ ] **Step 3：在 `kimi-provider.ts` 新增并导出 `parseChoiceMessage`**

在文件底部（`mapHttpError` 函数之后）追加：

```typescript
import type { ToolCall } from "./model-provider";

interface RawChoice {
  message?: {
    content?: string | null;
    tool_calls?: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }>;
  };
  finish_reason?: string | null;
}

/** 纯函数：把厂商 choice 解析为 { content, toolCalls, finishReason } */
export function parseChoiceMessage(choice: RawChoice): {
  content: string;
  toolCalls?: ToolCall[];
  finishReason?: string;
} {
  const content = asString(choice?.message?.content);
  const finishReason = asString(choice?.finish_reason) || undefined;
  const rawCalls = choice?.message?.tool_calls;
  if (!Array.isArray(rawCalls) || rawCalls.length === 0) {
    return { content, finishReason };
  }
  const toolCalls: ToolCall[] = rawCalls.map((c, i) => {
    let args: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(asString(c?.function?.arguments) || "{}");
      if (parsed && typeof parsed === "object") args = parsed as Record<string, unknown>;
    } catch {
      args = {};
    }
    return { id: asString(c?.id) || `call_${i}`, name: asString(c?.function?.name), arguments: args };
  });
  return { content, toolCalls, finishReason };
}
```

- [ ] **Step 4：运行测试，确认通过**

Run: `cd apps/api && npx tsx --test src/ai/provider/tool-calling.test.ts`
Expected: PASS（3 个测试全绿）

- [ ] **Step 5：提交**

```bash
git add apps/api/src/ai/provider/kimi-provider.ts apps/api/src/ai/provider/tool-calling.test.ts
git commit -m "feat(agent): Kimi parseChoiceMessage 解析 tool_calls (P1-2)"
```

---

### Task 3：Kimi `_chatCompletion` 接入 tools 并改用 parseChoiceMessage

**Files:**
- Modify: `apps/api/src/ai/provider/kimi-provider.ts`

- [ ] **Step 1：payload 注入 tools**

在 `_chatCompletion` 内构造 `body` 后（`if (req.responseFormat === "json_object") {...}` 之后）插入：

```typescript
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools;
      body.tool_choice = req.toolChoice ?? "auto";
    }
```

- [ ] **Step 2：改写 `parseSuccess` 复用 `parseChoiceMessage` 并允许「有 tool_calls 时 content 空」**

将现有 `parseSuccess` 函数体替换为：

```typescript
async function parseSuccess(
  response: globalThis.Response,
  model: string,
  attempts: number,
): Promise<ChatCompletionResponse> {
  const json = (await response.json()) as { choices?: RawChoice[] };
  const choice = json?.choices?.[0] ?? {};
  const { content, toolCalls, finishReason } = parseChoiceMessage(choice);
  if (!content && (!toolCalls || toolCalls.length === 0)) {
    throw new ProviderError("empty_response", "model_empty_response", {
      providerName: PROVIDER_NAME,
      retryable: false,
      legacyReason: "model_empty_response",
    });
  }
  return { content, rawContent: content, model, provider: PROVIDER_NAME, attempts, finishReason, toolCalls };
}
```

- [ ] **Step 3：运行 P1 测试 + 编译**

Run: `cd apps/api && npx tsx --test src/ai/provider/tool-calling.test.ts && npx tsc -p tsconfig.json --noEmit`
Expected: PASS + 编译通过

- [ ] **Step 4：运行既有 AI 测试，确认无回归**

Run: `cd apps/api && npm run test:ai`
Expected: 全绿（原有行为不变）

- [ ] **Step 5：提交**

```bash
git add apps/api/src/ai/provider/kimi-provider.ts
git commit -m "feat(agent): Kimi chatCompletion 注入 tools 并解析工具调用 (P1-3)"
```

---

# P2 — Agent 编排层

### Task 4：定义 Agent 核心类型

**Files:**
- Create: `apps/api/src/agent/agent.types.ts`

- [ ] **Step 1：写类型文件**

```typescript
// apps/api/src/agent/agent.types.ts
import type { Capability } from "../rbac/permissions";
import type { ToolDefinition } from "../ai/provider/model-provider";

/** 当前用户上下文（编排循环透传，用于权限与数据隔离） */
export interface AgentUser {
  id: string;
  capabilities: Capability[];
}

/** 一个可被 LLM 调用的工具 */
export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema 参数对象 */
  parameters: Record<string, unknown>;
  /** 所需 RBAC 能力位；调用前校验 */
  capability: Capability;
  /** 是否写操作（true 需用户确认） */
  mutates: boolean;
  /** 真正执行：调用底层 usecase */
  execute(args: Record<string, unknown>, user: AgentUser): Promise<unknown>;
}

/** 工具执行结果（回填给 LLM） */
export interface ToolResult {
  toolCallId: string;
  name: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

/** 编排单步事件（供上层流式上报前端） */
export type AgentEvent =
  | { kind: "tool_call"; name: string; arguments: Record<string, unknown> }
  | { kind: "tool_result"; name: string; ok: boolean; data?: unknown; error?: string }
  | { kind: "need_confirm"; name: string; arguments: Record<string, unknown> }
  | { kind: "final"; content: string };

/** 把 AgentTool 转为 Provider 的 ToolDefinition */
export function toToolDefinition(tool: AgentTool): ToolDefinition {
  return {
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}
```

- [ ] **Step 2：编译校验**

Run: `cd apps/api && npx tsc -p tsconfig.json --noEmit`
Expected: 通过（依赖 `Capability` 已存在于 `rbac/permissions.ts`）

- [ ] **Step 3：提交**

```bash
git add apps/api/src/agent/agent.types.ts
git commit -m "feat(agent): 定义 Agent 核心类型 (P2-4)"
```

---

### Task 5：工具注册表（先写失败测试）

**Files:**
- Create: `apps/api/src/agent/agent.test.ts`
- Create: `apps/api/src/agent/tool-registry.ts`

- [ ] **Step 1：写失败测试**

```typescript
// apps/api/src/agent/agent.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { ToolRegistry } from "./tool-registry";
import type { AgentTool, AgentUser } from "./agent.types";

function fakeTool(over: Partial<AgentTool> = {}): AgentTool {
  return {
    name: "read_tool",
    description: "读工具",
    parameters: { type: "object", properties: {} },
    capability: "estimates:read",
    mutates: false,
    execute: async () => ({ ok: 1 }),
    ...over,
  };
}

const userRead: AgentUser = { id: "u1", capabilities: ["estimates:read"] };

test("ToolRegistry: listToolsFor 仅返回用户有权限的工具", () => {
  const reg = new ToolRegistry();
  reg.register(fakeTool({ name: "a", capability: "estimates:read" }));
  reg.register(fakeTool({ name: "b", capability: "system:manage" }));
  const names = reg.listToolsFor(userRead).map((t) => t.function.name);
  assert.deepEqual(names, ["a"]);
});

test("ToolRegistry: execute 调用对应工具", async () => {
  const reg = new ToolRegistry();
  reg.register(fakeTool({ name: "a", execute: async (args) => ({ echo: args.x }) }));
  const out = await reg.execute("a", { x: 42 }, userRead);
  assert.deepEqual(out, { echo: 42 });
});

test("ToolRegistry: execute 未知工具抛错", async () => {
  const reg = new ToolRegistry();
  await assert.rejects(() => reg.execute("nope", {}, userRead), /未注册工具/);
});
```

- [ ] **Step 2：运行测试，确认失败**

Run: `cd apps/api && npx tsx --test src/agent/agent.test.ts`
Expected: FAIL（`tool-registry` 不存在）

- [ ] **Step 3：实现 `tool-registry.ts`**

```typescript
// apps/api/src/agent/tool-registry.ts
import type { ToolDefinition } from "../ai/provider/model-provider";
import { type AgentTool, type AgentUser, toToolDefinition } from "./agent.types";

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    if (!tool.name) throw new Error("ToolRegistry.register: 工具名不能为空");
    this.tools.set(tool.name, tool);
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  /** 仅返回用户能力位覆盖的工具的 Provider 定义 */
  listToolsFor(user: AgentUser): ToolDefinition[] {
    const caps = new Set(user.capabilities);
    return Array.from(this.tools.values())
      .filter((t) => caps.has(t.capability))
      .map(toToolDefinition);
  }

  async execute(name: string, args: Record<string, unknown>, user: AgentUser): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`未注册工具: ${name}`);
    if (!user.capabilities.includes(tool.capability)) {
      throw new Error(`无权限调用工具 ${name}（需 ${tool.capability}）`);
    }
    return tool.execute(args, user);
  }
}
```

- [ ] **Step 4：运行测试，确认通过**

Run: `cd apps/api && npx tsx --test src/agent/agent.test.ts`
Expected: PASS（3 个测试全绿）

- [ ] **Step 5：提交**

```bash
git add apps/api/src/agent/tool-registry.ts apps/api/src/agent/agent.test.ts
git commit -m "feat(agent): 工具注册表 + 能力位过滤 (P2-5)"
```

---

### Task 6：编排循环 + 护栏（先写失败测试）

**Files:**
- Modify: `apps/api/src/agent/agent.test.ts`（追加测试）
- Create: `apps/api/src/agent/orchestrator.ts`

编排循环用「假 Provider」驱动，避免真实 HTTP。Provider 用一个最小接口 `ChatRunner`（只需 `chatCompletion`），便于注入。

- [ ] **Step 1：在 `agent.test.ts` 追加编排测试**

```typescript
import { runAgent, type ChatRunner } from "./orchestrator";
import type { ChatCompletionResponse } from "../ai/provider/model-provider";

/** 脚本化假 Provider：按调用次序返回预设响应 */
function scriptRunner(seq: Partial<ChatCompletionResponse>[]): ChatRunner {
  let i = 0;
  return {
    async chatCompletion() {
      const r = seq[Math.min(i, seq.length - 1)];
      i += 1;
      return {
        content: r.content ?? "",
        rawContent: r.content ?? "",
        model: "fake",
        provider: "fake",
        attempts: 1,
        toolCalls: r.toolCalls,
      };
    },
  };
}

test("runAgent: 无工具调用时直接返回文本", async () => {
  const reg = new ToolRegistry();
  const events: string[] = [];
  const out = await runAgent({
    userMessage: "你好",
    user: userRead,
    registry: reg,
    runner: scriptRunner([{ content: "你好呀" }]),
    onEvent: (e) => events.push(e.kind),
    confirm: async () => true,
  });
  assert.equal(out, "你好呀");
  assert.deepEqual(events, ["final"]);
});

test("runAgent: 调读工具→回填→再返回文本", async () => {
  const reg = new ToolRegistry();
  reg.register(fakeTool({ name: "a", mutates: false, execute: async () => ({ v: 9 }) }));
  const out = await runAgent({
    userMessage: "算一下",
    user: userRead,
    registry: reg,
    runner: scriptRunner([
      { toolCalls: [{ id: "c1", name: "a", arguments: {} }] },
      { content: "结果是 9" },
    ]),
    onEvent: () => {},
    confirm: async () => true,
  });
  assert.equal(out, "结果是 9");
});

test("runAgent: 写工具需确认，confirm=false 则不执行", async () => {
  const reg = new ToolRegistry();
  let called = false;
  reg.register(fakeTool({ name: "w", capability: "estimates:read", mutates: true, execute: async () => { called = true; return {}; } }));
  await runAgent({
    userMessage: "存一下",
    user: userRead,
    registry: reg,
    runner: scriptRunner([
      { toolCalls: [{ id: "c1", name: "w", arguments: {} }] },
      { content: "已取消" },
    ]),
    onEvent: () => {},
    confirm: async () => false,
  });
  assert.equal(called, false);
});

test("runAgent: 超过最大轮数抛出上限错误", async () => {
  const reg = new ToolRegistry();
  reg.register(fakeTool({ name: "a", execute: async () => ({}) }));
  await assert.rejects(
    () =>
      runAgent({
        userMessage: "x",
        user: userRead,
        registry: reg,
        runner: scriptRunner([{ toolCalls: [{ id: "c1", name: "a", arguments: {} }] }]), // 永远调工具
        onEvent: () => {},
        confirm: async () => true,
        maxTurns: 3,
      }),
    /达到最大轮数/,
  );
});
```

- [ ] **Step 2：运行测试，确认失败**

Run: `cd apps/api && npx tsx --test src/agent/agent.test.ts`
Expected: FAIL（`orchestrator` 不存在）

- [ ] **Step 3：实现 `orchestrator.ts`**

```typescript
// apps/api/src/agent/orchestrator.ts
import type { ChatCompletionRequest, ChatCompletionResponse, ChatMessage } from "../ai/provider/model-provider";
import type { AgentEvent, AgentUser } from "./agent.types";
import type { ToolRegistry } from "./tool-registry";

/** 编排只依赖 chatCompletion，便于测试注入假 Provider */
export interface ChatRunner {
  chatCompletion(req: ChatCompletionRequest): Promise<ChatCompletionResponse>;
}

export interface RunAgentParams {
  userMessage: string;
  user: AgentUser;
  registry: ToolRegistry;
  runner: ChatRunner;
  onEvent: (e: AgentEvent) => void;
  /** 写操作确认回调；返回 false 表示用户取消 */
  confirm: (name: string, args: Record<string, unknown>) => Promise<boolean>;
  systemPrompt?: string;
  maxTurns?: number;
}

const DEFAULT_MAX_TURNS = 12;

export async function runAgent(params: RunAgentParams): Promise<string> {
  const { userMessage, user, registry, runner, onEvent, confirm } = params;
  const maxTurns = params.maxTurns ?? DEFAULT_MAX_TURNS;
  const tools = registry.listToolsFor(user);

  const messages: ChatMessage[] = [];
  if (params.systemPrompt) messages.push({ role: "system", content: params.systemPrompt });
  messages.push({ role: "user", content: userMessage });

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const reply = await runner.chatCompletion({ messages, tools, toolChoice: "auto" });

    if (reply.toolCalls && reply.toolCalls.length > 0) {
      for (const call of reply.toolCalls) {
        const tool = registry.get(call.name);
        // 写操作确认
        if (tool?.mutates) {
          onEvent({ kind: "need_confirm", name: call.name, arguments: call.arguments });
          const okToRun = await confirm(call.name, call.arguments);
          if (!okToRun) {
            messages.push(toolResultMessage(call.id, call.name, { ok: false, error: "用户取消" }));
            continue;
          }
        }
        onEvent({ kind: "tool_call", name: call.name, arguments: call.arguments });
        try {
          const data = await registry.execute(call.name, call.arguments, user);
          onEvent({ kind: "tool_result", name: call.name, ok: true, data });
          messages.push(toolResultMessage(call.id, call.name, { ok: true, data }));
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          onEvent({ kind: "tool_result", name: call.name, ok: false, error });
          messages.push(toolResultMessage(call.id, call.name, { ok: false, error }));
        }
      }
      continue; // 回填后让模型决定下一步
    }

    onEvent({ kind: "final", content: reply.content });
    return reply.content;
  }

  throw new Error(`Agent 编排已达到最大轮数 ${maxTurns}`);
}

/** 工具结果以 assistant 消息形式回填（v1 简化：用文本承载结构化结果） */
function toolResultMessage(
  toolCallId: string,
  name: string,
  result: { ok: boolean; data?: unknown; error?: string },
): ChatMessage {
  return {
    role: "assistant",
    content: `[工具结果] ${name} (callId=${toolCallId}): ${JSON.stringify(result)}`,
  };
}
```

> 说明：v1 用 assistant 文本消息回填工具结果（最稳、跨厂商兼容）；后续可升级为标准 `role:"tool"` 协议（需 P1 的 ChatMessage 扩展 tool role，列入后续）。

- [ ] **Step 4：运行测试，确认通过**

Run: `cd apps/api && npx tsx --test src/agent/agent.test.ts`
Expected: PASS（注册表 3 + 编排 4 = 7 个测试全绿）

- [ ] **Step 5：编译校验 + 提交**

Run: `cd apps/api && npx tsc -p tsconfig.json --noEmit`
Expected: 通过

```bash
git add apps/api/src/agent/orchestrator.ts apps/api/src/agent/agent.test.ts
git commit -m "feat(agent): 编排循环 + 上限/权限/写确认护栏 (P2-6)"
```

---

# P3 — 售前工具集

> 前置事实（已核对现有 usecase 签名）：
> - `calculateEstimateOnly(body: CalculateRequest): EstimateValidationResult` — `modules/estimates/estimates.usecase.ts:182`
> - `createFromExtraction(input: CreateRequirementPackInput): Promise<RequirementPackRow>` — `modules/presales/presales.usecase.ts:148`
> - `reviewPack(packId): Promise<ReviewResult>` / `getFieldConfidences(packId): Promise<FieldConfidence[]>`
> 工具的 `execute` 仅做参数转接 + 调用现有 usecase，**不复制业务逻辑**。

### Task 7：归档自动匹配 repository（先写失败测试）

**Files:**
- Modify: `apps/api/src/agent/tools/presales.tools.test.ts`（本任务先建该测试文件）
- Create: `apps/api/src/agent/tools/match.repository.ts`

匹配是纯函数：输入「已有方案列表 + 查询条件」，输出匹配结果。数据加载留给调用方（便于单测注入）。

- [ ] **Step 1：建测试文件并写失败测试**

```typescript
// apps/api/src/agent/tools/presales.tools.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import { matchExistingPlans, type PlanRecord } from "./match.repository";

const plans: PlanRecord[] = [
  { id: "p1", projectCode: "PRJ-001", customer: "阿里", product: "财务云", keywords: ["报销", "对账"] },
  { id: "p2", projectCode: "PRJ-002", customer: "腾讯", product: "供应链云", keywords: ["采购"] },
];

test("matchExistingPlans: 项目编码精准命中", () => {
  const r = matchExistingPlans(plans, { projectCode: "PRJ-002" });
  assert.equal(r.matched, true);
  assert.equal(r.candidates[0].id, "p2");
});

test("matchExistingPlans: 客户名+产品模糊命中", () => {
  const r = matchExistingPlans(plans, { customer: "阿里", product: "财务云", keywords: ["报销"] });
  assert.equal(r.matched, true);
  assert.equal(r.candidates[0].id, "p1");
});

test("matchExistingPlans: 无匹配返回 matched=false", () => {
  const r = matchExistingPlans(plans, { customer: "字节", product: "数据云" });
  assert.equal(r.matched, false);
  assert.deepEqual(r.candidates, []);
});
```

- [ ] **Step 2：运行测试，确认失败**

Run: `cd apps/api && npx tsx --test src/agent/tools/presales.tools.test.ts`
Expected: FAIL（`match.repository` 不存在）

- [ ] **Step 3：实现 `match.repository.ts`**

```typescript
// apps/api/src/agent/tools/match.repository.ts

export interface PlanRecord {
  id: string;
  projectCode?: string;
  customer?: string;
  product?: string;
  keywords?: string[];
}

export interface MatchQuery {
  projectCode?: string;
  customer?: string;
  product?: string;
  keywords?: string[];
}

export interface MatchResult {
  matched: boolean;
  /** 候选按相关度降序；精准命中只含一条 */
  candidates: PlanRecord[];
}

/** 纯函数：编码精准优先，否则客户名+产品+关键词模糊打分 */
export function matchExistingPlans(plans: PlanRecord[], query: MatchQuery): MatchResult {
  // 1) 项目编码精准
  if (query.projectCode) {
    const exact = plans.filter((p) => p.projectCode && p.projectCode === query.projectCode);
    if (exact.length > 0) return { matched: true, candidates: exact };
  }
  // 2) 模糊打分：客户名(2) + 产品(2) + 关键词命中(各1)
  const scored = plans
    .map((p) => ({ p, score: fuzzyScore(p, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return { matched: false, candidates: [] };
  return { matched: true, candidates: scored.map((x) => x.p) };
}

function fuzzyScore(p: PlanRecord, q: MatchQuery): number {
  let score = 0;
  if (q.customer && p.customer && p.customer.includes(q.customer)) score += 2;
  if (q.product && p.product && p.product.includes(q.product)) score += 2;
  if (q.keywords && p.keywords) {
    for (const k of q.keywords) if (p.keywords.includes(k)) score += 1;
  }
  return score;
}
```

- [ ] **Step 4：运行测试，确认通过**

Run: `cd apps/api && npx tsx --test src/agent/tools/presales.tools.test.ts`
Expected: PASS（3 个测试全绿）

- [ ] **Step 5：提交**

```bash
git add apps/api/src/agent/tools/match.repository.ts apps/api/src/agent/tools/presales.tools.test.ts
git commit -m "feat(agent): 归档自动匹配纯函数 + 测试 (P3-7)"
```

---

### Task 8：售前工具封装（estimate_implementation 等）

**Files:**
- Create: `apps/api/src/agent/tools/presales.tools.ts`
- Modify: `apps/api/src/agent/tools/presales.tools.test.ts`（追加工具测试）

工具用「依赖注入」封装底层 usecase（传入函数引用），便于单测用假实现验证转接逻辑，不触发真实计算/IO。

- [ ] **Step 1：追加工具测试**

```typescript
import { buildEstimateTool, type EstimateFn } from "./presales.tools";
import type { AgentUser } from "../agent.types";

const user: AgentUser = { id: "u1", capabilities: ["estimates:create"] };

test("buildEstimateTool: 元信息正确（读操作、能力位）", () => {
  const tool = buildEstimateTool((() => ({ ok: true })) as unknown as EstimateFn);
  assert.equal(tool.name, "estimate_implementation");
  assert.equal(tool.capability, "estimates:create");
  assert.equal(tool.mutates, false);
});

test("buildEstimateTool: execute 转接到底层 calculate", async () => {
  let received: unknown;
  const fakeCalc = ((body: unknown) => { received = body; return { totalDays: 5 }; }) as unknown as EstimateFn;
  const tool = buildEstimateTool(fakeCalc);
  const out = await tool.execute({ items: [{ a: 1 }] }, user);
  assert.deepEqual(out, { totalDays: 5 });
  assert.deepEqual(received, { items: [{ a: 1 }] });
});
```

- [ ] **Step 2：运行测试，确认失败**

Run: `cd apps/api && npx tsx --test src/agent/tools/presales.tools.test.ts`
Expected: FAIL（`buildEstimateTool` 未导出）

- [ ] **Step 3：实现 `presales.tools.ts`**

```typescript
// apps/api/src/agent/tools/presales.tools.ts
import type { AgentTool } from "../agent.types";

/** 底层估算函数签名（对应 estimates.usecase.calculateEstimateOnly） */
export type EstimateFn = (body: Record<string, unknown>) => unknown;

/** 实施初估工具（读操作） */
export function buildEstimateTool(calculate: EstimateFn): AgentTool {
  return {
    name: "estimate_implementation",
    description: "对已确认的需求包做实施工作量初估，返回分模块人天与合计",
    parameters: {
      type: "object",
      properties: {
        items: { type: "array", description: "需求条目数组（来自已确认的需求包）" },
      },
      required: ["items"],
    },
    capability: "estimates:create",
    mutates: false,
    async execute(args) {
      return calculate(args);
    },
  };
}
```

> 接线说明（在后续 P4 装配处，非本任务）：`buildEstimateTool(calculateEstimateOnly)` 注册进 `ToolRegistry`。本任务只验证封装/转接，不接真实 usecase，保证单测纯净。

- [ ] **Step 4：运行测试，确认通过**

Run: `cd apps/api && npx tsx --test src/agent/tools/presales.tools.test.ts`
Expected: PASS（匹配 3 + 工具 2 = 5 个测试全绿）

- [ ] **Step 5：编译 + 提交**

Run: `cd apps/api && npx tsc -p tsconfig.json --noEmit`
Expected: 通过

```bash
git add apps/api/src/agent/tools/presales.tools.ts apps/api/src/agent/tools/presales.tools.test.ts
git commit -m "feat(agent): 实施初估工具封装 + 注入式测试 (P3-8)"
```

---

### Task 9：把 agent 测试纳入 test 脚本 + 全量回归

**Files:**
- Modify: `apps/api/package.json`

- [ ] **Step 1：新增 `test:agent` 脚本**

在 `apps/api/package.json` 的 `scripts` 中，`test:modules` 行后插入：

```json
    "test:agent": "tsx --test src/ai/provider/tool-calling.test.ts src/agent/agent.test.ts src/agent/tools/presales.tools.test.ts",
```

- [ ] **Step 2：运行 agent 测试套件**

Run: `cd apps/api && npm run test:agent`
Expected: PASS（P1 3 + P2 7 + P3 5 = 15 个测试全绿）

- [ ] **Step 3：运行既有套件确认零回归**

Run: `cd apps/api && npm run test:modules && npm run test:ai && npm run build`
Expected: 全绿 + 构建通过

- [ ] **Step 4：提交**

```bash
git add apps/api/package.json
git commit -m "chore(agent): 新增 test:agent 脚本 + 后端三联回归通过 (P3-9)"
```

---

## 完成定义（本计划 DoD）

- [ ] P1：Provider 接口支持 `tools`/`toolCalls`，Kimi 能解析 `tool_calls`，原有 AI 测试零回归。
- [ ] P2：`ToolRegistry`（能力位过滤 + 执行）+ `runAgent`（循环 + 上限 + 权限 + 写确认）单测全绿。
- [ ] P3：归档自动匹配纯函数 + 实施初估工具封装单测全绿。
- [ ] `npm run test:agent` 15 测试全绿；`test:modules` / `test:ai` / `build` 无回归。
- [ ] 全程未修改任何现有业务 usecase（只读复用）。

## 不在本计划内（后续计划）
- P4：`/api/v1/agent/chat` 路由 + 流式 SSE + 会话态接线（把真实 usecase 注入注册表）。
- P5：对话工作台前端（对话区 + 结构化渲染 + 需求包确认面板 + 成果看板）。
- 工具结果升级为标准 `role:"tool"` 协议；extract/export/archive 工具接真实 usecase 与文件 IO。

---

## 自检记录（writing-plans self-review）

- **Spec 覆盖**：本计划覆盖需求规格中「工具调用基座、编排与护栏（§9 权限/成本/可观测）、自动匹配（FR-7）、初估工具（FR-4）」。FR-1 抽取、FR-6 导出、FR-7 持久化落库、FR-8 引导对话、FR-11 看板属 P4/P5，已在「不在本计划内」标注。
- **占位符扫描**：无 TBD/TODO；每个代码步骤含完整代码与可运行命令。
- **类型一致性**：`AgentTool` 字段（name/description/parameters/capability/mutates/execute）、`ToolCall`（id/name/arguments）、Provider `toolCalls` 在 P1→P2→P3 全程一致；`ChatRunner.chatCompletion` 与 Provider 接口签名一致。
