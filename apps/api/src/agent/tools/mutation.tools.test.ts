import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCreateProjectTool,
  buildExportReportTool,
  buildGenerateWbsTool,
  type CreateProjectInput,
} from "./mutation.tools";
import { runAgent, type ChatRunner } from "../orchestrator";
import { ToolRegistry } from "../tool-registry";
import { createRuntimeContext } from "../context/runtime-context";
import type { AgentEvent, AgentTool, AgentUser } from "../agent.types";
import type { ChatCompletionResponse } from "../../ai/provider/model-provider";

const user: AgentUser = { id: "u1", capabilities: ["estimates:create", "estimates:write"] };

const runtime = createRuntimeContext({
  actor: { userId: "u1", roles: ["SALES"], capabilities: ["estimates:create", "estimates:write"] },
  channel: "regression",
  workflowKey: "agent_chat",
  aiSessionId: "session-42",
});

test("写操作工具: 元信息快照（全部 mutates=true、能力位）", () => {
  const tools = [
    buildCreateProjectTool(async () => ({})),
    buildGenerateWbsTool(async () => ({})),
    buildExportReportTool(async () => ({ ok: true, data: {} })),
  ];

  assert.deepEqual(
    tools.map((t) => ({ name: t.name, capability: t.capability, mutates: t.mutates })),
    [
      { name: "create_project", capability: "estimates:create", mutates: true },
      { name: "generate_wbs", capability: "estimates:write", mutates: true },
      { name: "export_report", capability: "estimates:write", mutates: true },
    ],
  );
});

test("buildCreateProjectTool: projectName 必填；会话来源只取 RuntimeContext", async () => {
  const received: CreateProjectInput[] = [];
  const tool = buildCreateProjectTool((input) => {
    received.push(input);
    return { id: "p1" };
  });

  await assert.rejects(() => tool.execute({ projectName: "  " }, user, runtime), /需要 projectName 参数/);

  // 模型入参中的伪造会话 ID 不被采纳；只信任 runtime.aiSessionId
  await tool.execute({ projectName: "测试项目", aiSessionId: "forged" }, user, runtime);
  assert.deepEqual(received[0], {
    projectName: "测试项目",
    createdFromSessionId: "session-42",
  });

  // 无 RuntimeContext 时不带会话来源
  await tool.execute({ projectName: "无会话", customerName: "客户A" }, user);
  assert.deepEqual(received[1], { projectName: "无会话", customerName: "客户A" });
});

test("buildExportReportTool: items 必填；ok:false 结果抛错", async () => {
  const tool = buildExportReportTool(async (body) => {
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return { ok: false, code: 40001, message: "评估条目不能为空" };
    }
    return { ok: true, data: { totalDays: 5, downloadUrl: "/downloads/x.xlsx" } };
  });

  await assert.rejects(() => tool.execute({ items: "not-array" }, user), /需要 items 数组参数/);
  await assert.rejects(() => tool.execute({ items: [] }, user), /评估条目不能为空/);

  const out = await tool.execute({ items: [{ a: 1 }], exportType: "pdf" }, user);
  assert.deepEqual(out, { ok: true, data: { totalDays: 5, downloadUrl: "/downloads/x.xlsx" } });
});

test("buildGenerateWbsTool: execute 只转接到底层 generateWbs", async () => {
  let called = 0;
  const tool = buildGenerateWbsTool(() => {
    called += 1;
    return { items: [] };
  });

  await tool.execute({}, user);
  assert.equal(called, 1);
});

// ------------------------------------------------------------------
// 编排层口径：写工具必须触发 need_confirm，确认后才执行
// ------------------------------------------------------------------

test("runAgent + 写工具: 触发 need_confirm 事件，confirm=true 才执行", async () => {
  for (const confirmAnswer of [true, false]) {
    const reg = new ToolRegistry();
    let executed = 0;
    reg.register(
      buildCreateProjectTool(async () => {
        executed += 1;
        return { id: "p1" };
      }),
    );

    const events: AgentEvent[] = [];
    await runAgent({
      userMessage: "帮我建个项目",
      user,
      registry: reg,
      runner: scriptRunner([
        { toolCalls: [{ id: "c1", name: "create_project", arguments: { projectName: "测试" } }] },
        { content: "完成" },
      ]),
      onEvent: (event) => events.push(event),
      confirm: async () => confirmAnswer,
      runtimeContext: runtime,
    });

    const kinds = events.map((e) => e.kind);
    assert.ok(kinds.includes("need_confirm"), `confirm=${confirmAnswer} 时应触发 need_confirm`);
    if (confirmAnswer) {
      assert.ok(kinds.indexOf("need_confirm") < kinds.indexOf("tool_call"), "need_confirm 必须先于 tool_call");
    } else {
      assert.ok(!kinds.includes("tool_call"), "confirm=false 时不应发出 tool_call");
    }
    assert.equal(executed, confirmAnswer ? 1 : 0, `confirm=${confirmAnswer} 执行次数不符`);
  }
});

test("runAgent + 全部写工具: 每个都触发 need_confirm", async () => {
  const writeTools: Array<[string, AgentTool]> = [
    ["create_project", buildCreateProjectTool(async () => ({}))],
    ["generate_wbs", buildGenerateWbsTool(async () => ({}))],
    ["export_report", buildExportReportTool(async () => ({ ok: true, data: {} }))],
  ];

  for (const [name, tool] of writeTools) {
    const reg = new ToolRegistry();
    reg.register(tool);

    const events: AgentEvent[] = [];
    await runAgent({
      userMessage: "执行写操作",
      user,
      registry: reg,
      runner: scriptRunner([
        { toolCalls: [{ id: "c1", name, arguments: name === "export_report" ? { items: [] } : { projectName: "x" } }] },
        { content: "完成" },
      ]),
      onEvent: (event) => events.push(event),
      confirm: async () => true,
    });

    assert.ok(
      events.some((e) => e.kind === "need_confirm" && e.name === name),
      `写工具 ${name} 未触发 need_confirm`,
    );
  }
});

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
