import test from "node:test";
import assert from "node:assert/strict";

import { runAgent, type ChatRunner } from "./orchestrator";
import { ToolRegistry } from "./tool-registry";
import type { AgentTool, AgentUser } from "./agent.types";
import type { ChatCompletionResponse } from "../ai/provider/model-provider";

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

test("runAgent: 超过最大轮数抛错", async () => {
  const reg = new ToolRegistry();
  reg.register(fakeTool({ name: "a", execute: async () => ({}) }));

  await assert.rejects(
    () =>
      runAgent({
        userMessage: "x",
        user: userRead,
        registry: reg,
        runner: scriptRunner([{ toolCalls: [{ id: "c1", name: "a", arguments: {} }] }]),
        onEvent: () => {},
        confirm: async () => true,
        maxTurns: 3,
      }),
    /达到最大轮数/,
  );
});

// ============================================================
// SP-2026-007 MS3：编排循环默认注入收敛（按需发现）
// ============================================================

const ALL_CAPS = ["estimates:read", "estimates:create", "estimates:write"] as const;

function ms3Registry(): ToolRegistry {
  const reg = new ToolRegistry();
  reg.register(fakeTool({ name: "core_a", category: "estimate", discoverable: false }));
  reg.register(fakeTool({ name: "core_b", category: "project", discoverable: false }));
  reg.register(fakeTool({
    name: "list_tools",
    category: "discovery",
    discoverable: false,
    execute: async () => ({ tools: [{ name: "kb", description: "知识库", category: "knowledge", mutates: false, parameters: {} }] }),
  }));
  reg.register(fakeTool({ name: "kb", category: "knowledge", discoverable: true, execute: async () => ({ hits: 1 }) }));
  reg.register(fakeTool({ name: "disc_c", category: "export", discoverable: true, capability: "estimates:write" }));
  reg.register(fakeTool({ name: "disc_d", category: "rule", discoverable: true }));
  reg.register(fakeTool({ name: "disc_e", category: "estimate", discoverable: true }));
  return reg;
}

function recordingRunner(seq: Partial<ChatCompletionResponse>[]): { runner: ChatRunner; calls: Array<string[]> } {
  const calls: Array<string[]> = [];
  let i = 0;
  return {
    calls,
    runner: {
      async chatCompletion(req) {
        calls.push((req.tools ?? []).map((t) => t.function.name));
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
    },
  };
}

test("MS3: 默认（按需发现）首轮注入 = 核心工具 + list_tools，较全量下降 ≥50%", async () => {
  const reg = ms3Registry();
  const { runner, calls } = recordingRunner([{ content: "done" }]);

  await runAgent({
    userMessage: "hi",
    user: { id: "u1", capabilities: [...ALL_CAPS] },
    registry: reg,
    runner,
    onEvent: () => {},
    confirm: async () => true,
    toolInjectionMode: "discovery",
  });

  const injected = calls[0];
  const fullCount = reg.listFullToolsFor({ id: "u1", capabilities: [...ALL_CAPS] }).length;
  assert.ok(injected.includes("list_tools"));
  assert.ok(!injected.includes("kb"), "discoverable 工具不应默认注入");
  assert.ok(injected.length <= fullCount / 2, `注入 ${injected.length} 应 ≤ 全量 ${fullCount} 的 50%`);
});

test("MS3: list_tools 发现后，命中的 discoverable 工具进入当轮后续 tools 参数", async () => {
  const reg = ms3Registry();
  const { runner, calls } = recordingRunner([
    { toolCalls: [{ id: "c1", name: "list_tools", arguments: { intent: "知识" } }] },
    { toolCalls: [{ id: "c2", name: "kb", arguments: { query: "x" } }] },
    { content: "答案" },
  ]);

  const out = await runAgent({
    userMessage: "查一下知识库",
    user: { id: "u1", capabilities: [...ALL_CAPS] },
    registry: reg,
    runner,
    onEvent: () => {},
    confirm: async () => true,
    toolInjectionMode: "discovery",
  });

  assert.equal(out, "答案");
  assert.ok(!calls[0].includes("kb"), "首轮不应注入 kb");
  assert.ok(calls[1].includes("kb"), "list_tools 命中后应注入 kb");
  assert.ok(calls[1].includes("list_tools"), "list_tools 常驻");
});

test("MS3: 全量回退模式下注入行为与旧版一致（全部业务工具、无 list_tools）", async () => {
  const reg = ms3Registry();
  const { runner, calls } = recordingRunner([{ content: "done" }]);

  await runAgent({
    userMessage: "hi",
    user: { id: "u1", capabilities: [...ALL_CAPS] },
    registry: reg,
    runner,
    onEvent: () => {},
    confirm: async () => true,
    toolInjectionMode: "full",
  });

  assert.deepEqual(calls[0], ["core_a", "core_b", "kb", "disc_c", "disc_d", "disc_e"]);
});

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
