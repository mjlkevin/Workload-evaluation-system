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
