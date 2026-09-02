import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKBENCH_TOOL_LOOP_MAX_TURNS,
  resolveReadOnlyWorkbenchTools,
  runWorkbenchToolLoop,
  runWorkbenchToolLoopStream,
  type WorkbenchToolEffectOutput,
} from "./workbench-tool-loop";
import { ToolRegistry, DISCOVERY_CATEGORY } from "../../agent/tool-registry";
import { createDefaultRegistry } from "../../agent/default-registry";
import type { AgentEvent, AgentTool } from "../../agent/agent.types";
import type { StreamingChunk } from "./workbench-dispatch.service";
import type { AuthUser } from "../../types";

// ============================================================
// 批次 0 · ②注入点只读过滤 + ③最小工具执行循环
// ============================================================
// 冻结口径：
//  · 只暴露 mutates === false 的工具（写操作确认闸门属批次 1，本批不得放宽）；
//  · 过滤发生在注入点，不改 ToolRegistry 本身；
//  · 事件词汇表复用 AgentEvent 既有 kind，不自造新事件类型；
//  · 工具异常不得阻断模型主链路。

function authUser(role: AuthUser["role"]): AuthUser {
  return {
    id: "u-batch0",
    username: "batch0",
    passwordHash: "",
    role,
    status: "active",
    createdAt: "",
    lastLoginAt: "",
  };
}

function fakeTool(overrides: Partial<AgentTool> = {}): AgentTool {
  return {
    name: "read_tool",
    description: "读工具",
    parameters: { type: "object", properties: {} },
    capability: "estimates:read",
    mutates: false,
    execute: async () => ({ content: "ok" }),
    ...overrides,
  };
}

/** 注入点解析出的工具集必须逐个为只读，且写工具/发现工具一个都不出现 */
for (const role of ["admin", "sub_admin", "user"] as const) {
  test(`resolveReadOnlyWorkbenchTools: ${role} 注入集内无任何 mutates 工具`, () => {
    const set = resolveReadOnlyWorkbenchTools(authUser(role), { registry: createDefaultRegistry(authUser(role)) });

    assert.ok(set.tools.length > 0, `${role} 的只读注入集不得为空（否则本批等于没传 tools）`);
    for (const definition of set.tools) {
      const tool = set.registry.get(definition.function.name);
      assert.ok(tool, `注入集内工具必须已注册：${definition.function.name}`);
      assert.equal(tool.mutates, false, `注入到模型的工具必须 mutates=false：${definition.function.name}`);
      assert.notEqual(tool.category, DISCOVERY_CATEGORY, `发现类工具不得注入工作台：${definition.function.name}`);
    }

    const names = set.tools.map((definition) => definition.function.name);
    assert.deepEqual(
      names,
      ["estimate_implementation", "project_list", "estimate_history", "knowledge_query", "rule_lookup"],
    );
    assert.equal(names.includes("create_project"), false);
    assert.equal(names.includes("generate_wbs"), false);
    assert.equal(names.includes("export_report"), false);
    assert.equal(names.includes("list_tools"), false);
    assert.equal(set.readOnlyToolNames.has("create_project"), false);
  });
}

test("resolveReadOnlyWorkbenchTools: 能力位由 legacy role 推导，模型入参无法扩权", () => {
  const set = resolveReadOnlyWorkbenchTools(authUser("user"), { registry: createDefaultRegistry(authUser("user")) });
  assert.ok(set.agentUser.capabilities.includes("estimates:read"));
  assert.equal(set.agentUser.capabilities.includes("system:manage"), false);
  assert.equal(set.agentUser.id, "u-batch0");
});

test("runWorkbenchToolLoop: 执行工具→回填→再问一次，返回最终答复", async () => {
  const registry = new ToolRegistry();
  let calls = 0;
  registry.register(fakeTool({ name: "knowledge_query", execute: async (args) => { calls += 1; return { hit: args.q }; } }));

  const seenMessages: { role: string; content: string }[][] = [];
  const events: AgentEvent[] = [];
  const out = await runWorkbenchToolLoop({
    messages: [{ role: "user", content: "查一下知识库" }],
    registry,
    agentUser: { id: "u1", capabilities: ["estimates:read"] },
    readOnlyToolNames: new Set(["knowledge_query"]),
    onEvent: (event) => events.push(event),
    invoke: async ({ messages }) => {
      seenMessages.push(messages.map((m) => ({ role: m.role, content: m.content })));
      if (seenMessages.length === 1) {
        return { content: "", toolCalls: [{ id: "c1", name: "knowledge_query", arguments: { q: "ERP" } }] };
      }
      return { content: "知识库结果是 …" };
    },
  });

  assert.equal(calls, 1);
  assert.equal(out.content, "知识库结果是 …");
  assert.equal(out.turns, 2);
  assert.equal(out.truncated, false);
  assert.deepEqual(out.toolCalls, [{ name: "knowledge_query" }]);
  // 第二轮必须带上工具结果回填（否则等于模型说了没人听）
  assert.equal(seenMessages[1].length, 2);
  assert.equal(seenMessages[1][0].content, "查一下知识库");
  assert.match(seenMessages[1][1].content, /\[工具结果\] knowledge_query/);
  assert.match(seenMessages[1][1].content, /"hit":"ERP"/);
  assert.deepEqual(events.map((event) => event.kind), ["tool_call", "tool_result"]);
});

test("runWorkbenchToolLoop: 写工具与未注册工具一律不执行，只回填失败结果", async () => {
  const registry = new ToolRegistry();
  let writeCalled = false;
  let readCalled = false;
  registry.register(fakeTool({ name: "export_report", mutates: true, capability: "estimates:write", execute: async () => { writeCalled = true; return {}; } }));
  registry.register(fakeTool({ name: "project_list", execute: async () => { readCalled = true; return { items: [] }; } }));

  const events: AgentEvent[] = [];
  const seenMessages: string[][] = [];
  const out = await runWorkbenchToolLoop({
    messages: [{ role: "user", content: "导出报告" }],
    registry,
    agentUser: { id: "u1", capabilities: ["estimates:read", "estimates:write"] },
    readOnlyToolNames: new Set(["project_list"]),
    onEvent: (event) => events.push(event),
    // 模型每轮都提同一批调用：上限设 2 → 第 1 轮执行并回填，第 2 轮触顶不再执行
    maxTurns: 2,
    invoke: async ({ messages }) => {
      seenMessages.push(messages.map((message) => message.content));
      return {
        content: "",
        toolCalls: [
          { id: "c1", name: "export_report", arguments: {} },
          { id: "c2", name: "not_registered", arguments: {} },
          { id: "c3", name: "project_list", arguments: {} },
        ],
      };
    },
  });

  assert.equal(writeCalled, false, "mutates 工具绝不得被执行（写确认闸门属批次 1）");
  assert.equal(readCalled, true);
  // 三个调用都不得抛错：拒绝执行为回填 ok:false
  const results = events.filter((event) => event.kind === "tool_result");
  assert.equal(results.length, 3);
  assert.deepEqual(
    (results as { name: string; ok: boolean }[]).map((event) => [event.name, event.ok]),
    [["export_report", false], ["not_registered", false], ["project_list", true]],
  );
  assert.equal(events.some((event) => event.kind === "need_confirm"), false, "只读注入下 need_confirm 结构性不可达");
  // 拒绝执行也要回填，否则模型会以为调用成功而无限重试
  assert.equal(out.turns, 2);
  assert.equal(out.truncated, true, "第 2 轮触顶，不得再执行工具");
  assert.equal(seenMessages[1].length, 4, "三个调用结果都必须在下一轮入参中");
  assert.match(seenMessages[1][1], /\[工具结果\] export_report/);
  assert.match(seenMessages[1][1], /"ok":false/);
  assert.match(seenMessages[1][2], /not_registered/);
  assert.match(seenMessages[1][2], /"ok":false/);
  assert.match(seenMessages[1][3], /project_list/);
  assert.match(seenMessages[1][3], /"ok":true/);
});

test("runWorkbenchToolLoop: 工具抛错不阻断主链路，异常摘要回填", async () => {
  const registry = new ToolRegistry();
  registry.register(fakeTool({ name: "boom", execute: async () => { throw new Error("下游超时"); } }));

  const out = await runWorkbenchToolLoop({
    messages: [{ role: "user", content: "x" }],
    registry,
    agentUser: { id: "u1", capabilities: ["estimates:read"] },
    readOnlyToolNames: new Set(["boom"]),
    invoke: async ({ messages }) =>
      messages.length === 1
        ? { content: "", toolCalls: [{ id: "c1", name: "boom", arguments: {} }] }
        : { content: "已降级回答" },
  });

  assert.equal(out.content, "已降级回答");
  assert.equal(out.turns, 2, "工具异常后必须继续下一轮，而不是中止循环");
});

test("runWorkbenchToolLoop: 达最大轮数不抛错，返回末轮内容并标记截断", async () => {
  const registry = new ToolRegistry();
  registry.register(fakeTool({ name: "a", execute: async () => ({}) }));
  let invokes = 0;

  const out = await runWorkbenchToolLoop({
    messages: [{ role: "user", content: "x" }],
    registry,
    agentUser: { id: "u1", capabilities: ["estimates:read"] },
    readOnlyToolNames: new Set(["a"]),
    maxTurns: 3,
    invoke: async () => {
      invokes += 1;
      return { content: `第${invokes}轮`, toolCalls: [{ id: `c${invokes}`, name: "a", arguments: {} }] };
    },
  });

  assert.equal(invokes, 3);
  assert.equal(out.truncated, true);
  assert.equal(out.turns, 3);
  assert.equal(out.content, "第3轮");
});

test("runWorkbenchToolLoop: 轮次上限与 orchestrator 口径一致", () => {
  assert.equal(WORKBENCH_TOOL_LOOP_MAX_TURNS, 12);
});

test("runWorkbenchToolLoop: recordToolEffect 逐次独立编号，重放命中各自 effect 不重复执行", async () => {
  const registry = new ToolRegistry();
  let toolExecutions = 0;
  registry.register(fakeTool({ name: "a", execute: async () => { toolExecutions += 1; return { n: toolExecutions }; } }));

  const effectKeys: string[] = [];
  const store = new Map<string, WorkbenchToolEffectOutput>();
  const runOnce = () =>
    runWorkbenchToolLoop({
      messages: [{ role: "user", content: "x" }],
      registry,
      agentUser: { id: "u1", capabilities: ["estimates:read"] },
      readOnlyToolNames: new Set(["a"]),
      recordToolEffect: async (ordinal, execute) => {
        const effectKey = `run-1:chat:workbench_chat_tool_call:${ordinal}`;
        effectKeys.push(effectKey);
        const existing = store.get(effectKey);
        if (existing) return existing;
        const output = await execute();
        store.set(effectKey, output);
        return output;
      },
      // 前两轮各一次工具调用，第三轮收敛 → 两个互相独立的 effect
      invoke: async ({ turnOrdinal }) =>
        turnOrdinal === 1
          ? { content: "", toolCalls: [{ id: "c1", name: "a", arguments: {} }] }
          : turnOrdinal === 2
            ? { content: "", toolCalls: [{ id: "c2", name: "a", arguments: {} }] }
            : { content: "答案" },
    });

  const first = await runOnce();
  const replay = await runOnce();

  assert.equal(first.turns, 3);
  assert.equal(replay.turns, 3);
  // 每次调用一个独立 effectKey（不是固定 key），且重放命中的是同一批序号
  assert.deepEqual(effectKeys, [
    "run-1:chat:workbench_chat_tool_call:1",
    "run-1:chat:workbench_chat_tool_call:2",
    "run-1:chat:workbench_chat_tool_call:1",
    "run-1:chat:workbench_chat_tool_call:2",
  ]);
  // 重放命中各自序号的已记录副作用：工具只真正执行过两次（每轮一次），不重复
  assert.equal(toolExecutions, 2);
  assert.equal(first.content, "答案");
});

// ---- 流式闸门 ----

function chunkOf(partial: Partial<StreamingChunk>): StreamingChunk {
  return { contentDelta: "", ...partial };
}

function turnStream(chunks: StreamingChunk[]): AsyncGenerator<StreamingChunk, void, void> {
  return (async function* () {
    for (const chunk of chunks) yield chunk;
  })();
}

async function collectStream<T>(
  stream: AsyncGenerator<StreamingChunk, T, void>,
): Promise<{ chunks: StreamingChunk[]; result: T }> {
  const chunks: StreamingChunk[] = [];
  for (;;) {
    const next = await stream.next();
    if (next.done) return { chunks, result: next.value };
    chunks.push(next.value);
  }
}

test("runWorkbenchToolLoopStream: 无工具调用时逐 chunk 原样透传（零回归）", async () => {
  const registry = new ToolRegistry();
  const out = await collectStream(
    runWorkbenchToolLoopStream({
      messages: [{ role: "user", content: "x" }],
      registry,
      agentUser: { id: "u1", capabilities: ["estimates:read"] },
      readOnlyToolNames: new Set<string>(),
      invokeStream: () =>
        turnStream([
          chunkOf({ kind: "metadata", memoryRef: { scenesCount: 1, atomsCount: 2 } }),
          chunkOf({ contentDelta: "你好" }),
          chunkOf({ contentDelta: "世界", model: "kimi-for-coding", finishReason: "stop" }),
        ]),
    }),
  );

  const seen = out.chunks;
  assert.equal(seen.length, 3, "无工具调用时不得注入任何额外 chunk");
  // 站点自己写的 memoryRef metadata chunk 必须原样透传（DEF-2026-08-27-001 通路）
  assert.equal(seen[0].kind, "metadata");
  assert.deepEqual(seen[0].memoryRef, { scenesCount: 1, atomsCount: 2 });
  assert.equal(seen[1].contentDelta, "你好");
  assert.equal(seen[2].finishReason, "stop");
  assert.equal(out.result.content, "你好世界");
  assert.equal(out.result.turns, 1);
  assert.deepEqual(out.result.toolCalls, []);
});

test("runWorkbenchToolLoopStream: 首轮工具调用执行后补发 metadata，再续流第二轮", async () => {
  const registry = new ToolRegistry();
  let executed = 0;
  registry.register(fakeTool({ name: "project_list", execute: async () => { executed += 1; return { items: ["P1"] }; } }));

  const events: AgentEvent[] = [];
  const turnOrdinals: number[] = [];
  const messagesPerTurn: number[] = [];

  const stream = runWorkbenchToolLoopStream({
    messages: [{ role: "user", content: "我有哪些项目" }],
    registry,
    agentUser: { id: "u1", capabilities: ["estimates:read"] },
    readOnlyToolNames: new Set(["project_list"]),
    onEvent: (event) => events.push(event),
    invokeStream: ({ turnOrdinal, messages }) => {
      turnOrdinals.push(turnOrdinal);
      messagesPerTurn.push(messages.length);
      if (turnOrdinal === 1) {
        return turnStream([
          chunkOf({ contentDelta: "" }),
          chunkOf({ finishReason: "tool_calls", toolCalls: [{ id: "c1", name: "project_list", arguments: {} }] }),
        ]);
      }
      return turnStream([chunkOf({ contentDelta: "你有 1 个项目" }), chunkOf({ model: "kimi-for-coding", finishReason: "stop" })]);
    },
  });

  const collected = await collectStream(stream);
  assert.equal(executed, 1);
  assert.deepEqual(turnOrdinals, [1, 2]);
  assert.deepEqual(messagesPerTurn, [1, 2], "第二轮必须带上工具结果回填");

  // metadata chunk 由循环补发，必须先于第二轮正文，chip 才能与答案同帧出现
  const metadataIndex = collected.chunks.findIndex((chunk) => chunk.kind === "metadata" && chunk.toolCalls);
  const answerIndex = collected.chunks.findIndex((chunk) => chunk.contentDelta === "你有 1 个项目");
  assert.ok(metadataIndex >= 0, "工具调用结果必须经 metadata chunk 交给 dispatch");
  assert.ok(metadataIndex < answerIndex);
  assert.deepEqual(collected.chunks[metadataIndex].toolCalls?.map((call) => call.name), ["project_list"]);
  // 正文只累加真正回答的那一轮
  assert.equal(collected.result.content, "你有 1 个项目");
  assert.deepEqual(collected.result.toolCalls, [{ name: "project_list" }]);
  assert.deepEqual(events.map((event) => event.kind), ["tool_call", "tool_result"]);
});

test("runWorkbenchToolLoopStream: 末 chunk 仍由真正回答轮决定 finishReason", async () => {
  const registry = new ToolRegistry();
  registry.register(fakeTool({ name: "a", execute: async () => ({}) }));
  const collected = await collectStream(
    runWorkbenchToolLoopStream({
      messages: [{ role: "user", content: "x" }],
      registry,
      agentUser: { id: "u1", capabilities: ["estimates:read"] },
      readOnlyToolNames: new Set(["a"]),
      invokeStream: ({ turnOrdinal }) =>
        turnOrdinal === 1
          ? turnStream([chunkOf({ finishReason: "tool_calls", toolCalls: [{ id: "c1", name: "a", arguments: {} }] })])
          : turnStream([chunkOf({ contentDelta: "最终答复" }), chunkOf({ model: "kimi-for-coding", finishReason: "stop" })]),
    }),
  );

  const last = collected.chunks[collected.chunks.length - 1];
  assert.equal(last.finishReason, "stop");
  assert.equal(last.model, "kimi-for-coding");
  assert.equal(collected.result.content, "最终答复");
  assert.equal(collected.result.turns, 2);
});

test("runWorkbenchToolLoopStream: 流式下写工具一律不执行，只回填失败结果", async () => {
  const registry = new ToolRegistry();
  let writeCalled = false;
  registry.register(fakeTool({ name: "export_report", mutates: true, capability: "estimates:write", execute: async () => { writeCalled = true; return {}; } }));

  const events: AgentEvent[] = [];
  const collected = await collectStream(
    runWorkbenchToolLoopStream({
      messages: [{ role: "user", content: "导出报告" }],
      registry,
      agentUser: { id: "u1", capabilities: ["estimates:read", "estimates:write"] },
      readOnlyToolNames: new Set<string>(),
      onEvent: (event) => events.push(event),
      invokeStream: ({ turnOrdinal }) =>
        turnOrdinal === 1
          ? turnStream([chunkOf({ finishReason: "tool_calls", toolCalls: [{ id: "c1", name: "export_report", arguments: {} }] })])
          : turnStream([chunkOf({ contentDelta: "无法导出" })]),
    }),
  );

  assert.equal(writeCalled, false, "流式路径同样受只读白名单约束（与同步路径同一判据）");
  assert.deepEqual(
    events.filter((event) => event.kind === "tool_result").map((event) => [event.name, event.ok]),
    [["export_report", false]],
  );
  assert.equal(collected.result.content, "无法导出");
});
