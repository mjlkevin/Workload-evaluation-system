import test from "node:test";
import assert from "node:assert/strict";

import { runAgent, type ChatRunner } from "./orchestrator";
import { ToolRegistry } from "./tool-registry";
import type { AgentTool } from "./agent.types";
import type { ChatCompletionResponse } from "../ai/provider/model-provider";
import type { AuthUser, ToolPolicyConfig } from "../types";
import { resolveWorkbenchInjectableTools, runWorkbenchToolLoop } from "../services/ai/workbench-tool-loop";
import { LIST_TOOLS_TOOL_NAME } from "./tools/list-tools.tools";

// ============================================================
// 批次 6b 返修（④）·两条通道的审批/注入判据必须出自同一处
// ============================================================
// 病根：编排通道（/agent/chat）与工作台通道（Run 事件流）过去各内联一份「要不要审批」
// 与「能不能注入」的判据。今天两份结果碰巧一致，改一边就分家——而这两份判据守的是
// 同一件事：哪些工具能被模型看到、哪些必须先问人。
//
// 本文件**不各测各的**：它对同一组 (工具, 策略, 角色) 输入，分别驱动两条通道的真实
// 执行路径（runAgent / runWorkbenchToolLoop），比较三件事——
//  · 注入集是否一致；
//  · 无审批链路时是否执行（判为 ask 则两条都必须失败关闭）；
//  · 接上审批链路后是否执行（证明差异来自判定，而不是某条通道压根跑不了）。
// 任何一侧把判据改回内联副本，这三条里至少一条会红。
// ============================================================

function authUser(role: AuthUser["role"]): AuthUser {
  return {
    id: "u-parity",
    username: "parity",
    passwordHash: "",
    role,
    status: "active",
    createdAt: "",
    lastLoginAt: "",
  };
}

function entry(overrides: Partial<ToolPolicyConfig["policies"][string]> = {}): ToolPolicyConfig["policies"][string] {
  return { enabled: true, visibleRoles: [], approvalStrategy: "default", injectionMode: "default", ...overrides };
}

function policyFor(name: string, overrides: Partial<ToolPolicyConfig["policies"][string]>): ToolPolicyConfig {
  return { schemaVersion: 1, policies: { [name]: entry(overrides) } };
}

function makeTool(name: string, overrides: Partial<AgentTool>, onExecute: () => void): AgentTool {
  return {
    name,
    description: `${name} 描述`,
    parameters: { type: "object", properties: {} },
    capability: "estimates:read",
    mutates: false,
    ...overrides,
    execute: async () => {
      onExecute();
      return { content: "ok" };
    },
  };
}

/** 让模型第 1 轮点名 toolName、第 2 轮收尾；同时记录每次请求实际注入给模型的工具名 */
function scriptRunner(toolName: string, injected: string[][]): ChatRunner {
  let turn = 0;
  return {
    async chatCompletion(req): Promise<ChatCompletionResponse> {
      injected.push((req.tools ?? []).map((definition) => definition.function.name));
      turn += 1;
      const toolCalls =
        turn === 1 ? [{ id: "c1", name: toolName, arguments: {} as Record<string, unknown> }] : undefined;
      const content = turn === 1 ? "" : "收尾";
      return { content, rawContent: content, model: "fake", provider: "fake", attempts: 1, toolCalls };
    },
  };
}

type Case = {
  title: string;
  tool: { name: string; overrides?: Partial<AgentTool> };
  policy?: (name: string) => ToolPolicyConfig;
  /** 期望：该工具是否应落进注入集（不注入 = 连被模型点名的资格都不该有） */
  injected: boolean;
  /** 期望：是否需要审批（ask 档） */
  requiresApproval: boolean;
};

const CASES: Case[] = [
  { title: "只读工具：allow 档，两条通道都不问人", tool: { name: "rd" }, injected: true, requiresApproval: false },
  { title: "写工具：ask 档", tool: { name: "wr", overrides: { mutates: true } }, injected: true, requiresApproval: true },
  {
    title: "外发工具（mutates:false + exfiltrates:true）：ask 档，独立于写入维度",
    tool: { name: "ex", overrides: { mutates: false, exfiltrates: true } },
    injected: true,
    requiresApproval: true,
  },
  {
    title: "写标志缺失（mutates 未标）：落 ask——失败方向关闭，不是「没标就等于免审批」",
    // 两份判据副本在这里必然分家：决策槽要求 mutates **严格 false** 才 allow；
    // 旧的内联 Boolean(tool?.mutates) 则把「没标」当成只读直接放行。
    tool: { name: "noflag", overrides: { mutates: undefined as unknown as boolean } },
    injected: true,
    requiresApproval: true,
  },
  {
    title: "只读工具被策略设成 user-confirm：ask 档（策略只能收紧）",
    tool: { name: "rd2" },
    policy: (name) => policyFor(name, { approvalStrategy: "user-confirm" }),
    injected: true,
    requiresApproval: true,
  },
  {
    title: "写工具被策略标 default（想免审批）：仍 ask——策略没有放宽方向",
    tool: { name: "wr2", overrides: { mutates: true } },
    policy: (name) => policyFor(name, { approvalStrategy: "default" }),
    injected: true,
    requiresApproval: true,
  },
  {
    title: "策略停用：两条通道的注入集里都没有它",
    tool: { name: "off" },
    policy: (name) => policyFor(name, { enabled: false }),
    injected: false,
    requiresApproval: true, // 不进注入集 ⇒ 谈不上审批；断言按「不执行」口径统一处理
  },
  {
    title: "角色不可见：两条通道同样不注入",
    tool: { name: "hidden" },
    policy: (name) => policyFor(name, { visibleRoles: ["DEV"] }),
    injected: false,
    requiresApproval: true,
  },
  {
    title: "on-demand 降档：两条通道同样从注入集剔除",
    tool: { name: "lazy" },
    policy: (name) => policyFor(name, { injectionMode: "on-demand" }),
    injected: false,
    requiresApproval: true,
  },
];

for (const testCase of CASES) {
  test(`跨通道同判定 · ${testCase.title}`, async () => {
    const name = testCase.tool.name;
    const policy = testCase.policy?.(name);

    // —— 工作台通道（异步 Run / 同步兜底共用的注入解析 + 工具循环）——
    let workbenchRuns = 0;
    const workbenchRegistry = new ToolRegistry();
    workbenchRegistry.register(makeTool(name, testCase.tool.overrides ?? {}, () => (workbenchRuns += 1)));
    const set = resolveWorkbenchInjectableTools(authUser("admin"), {
      registry: workbenchRegistry,
      ...(policy ? { toolPolicy: policy } : {}),
    });
    assert.equal(set.injectedToolNames.has(name), testCase.injected, `工作台注入集判定不符（期望 injected=${testCase.injected}）`);

    const workbenchGateAsks: string[] = [];
    await runWorkbenchToolLoop({
      messages: [{ role: "user", content: "跑一下" }],
      registry: set.registry,
      agentUser: set.agentUser,
      allowToolNames: set.allowToolNames,
      injectedToolNames: set.injectedToolNames,
      ...(policy ? { toolPolicy: policy } : {}),
      // 无审批链路：ask 档必须失败关闭（批次 1a 同步兜底通道口径）
      invoke: async ({ turnOrdinal }) =>
        turnOrdinal === 1
          ? { content: "", toolCalls: [{ id: "c1", name, arguments: {} }] }
          : { content: "收尾" },
    });

    // —— 编排通道（/agent/chat，同样不接审批端口）——
    let agentRuns = 0;
    const agentRegistry = new ToolRegistry();
    agentRegistry.register(makeTool(name, testCase.tool.overrides ?? {}, () => (agentRuns += 1)));
    const agentInjected: string[][] = [];
    await runAgent({
      userMessage: "跑一下",
      // 角色/能力位取工作台通道解析出的同一份，保证两条通道的输入逐字段相同
      user: set.agentUser,
      registry: agentRegistry,
      runner: scriptRunner(name, agentInjected),
      onEvent: () => {},
      toolInjectionMode: "full", // 与工作台同为全量注入通道，剥离 MS3 发现轴后再比判定
      ...(policy ? { toolPolicy: policy } : {}),
    });

    // ① 注入集：两条通道必须给出同一份工具名全集（不只是「这个工具在不在」）
    assert.deepEqual(
      [...agentInjected[0]].sort(),
      [...set.injectedToolNames].sort(),
      "两条通道的注入集不一致——判据又分家了",
    );

    // ② 无审批链路时的执行：两条通道必须同判（ask → 都不执行；allow → 都执行）
    const expectExecute = testCase.injected && !testCase.requiresApproval ? 1 : 0;
    assert.equal(workbenchRuns, expectExecute, `工作台侧执行次数不符（期望 ${expectExecute}）`);
    assert.equal(agentRuns, expectExecute, `编排侧执行次数不符（期望 ${expectExecute}）`);
    assert.equal(
      agentRuns,
      workbenchRuns,
      "同一 (工具, 策略) 输入下两条通道对「要不要问人」的判定出现了分叉",
    );

    // ③ 接上审批链路后：两条通道都该放行（证明 ② 的差异来自判定，而非某条通道跑不了）
    if (!testCase.injected) return; // 不进注入集的工具，批准也不该给它执行机会
    let workbenchRunsApproved = 0;
    const approvedWorkbenchRegistry = new ToolRegistry();
    approvedWorkbenchRegistry.register(makeTool(name, testCase.tool.overrides ?? {}, () => (workbenchRunsApproved += 1)));
    await runWorkbenchToolLoop({
      messages: [{ role: "user", content: "跑一下" }],
      registry: approvedWorkbenchRegistry,
      agentUser: set.agentUser,
      allowToolNames: set.allowToolNames,
      injectedToolNames: set.injectedToolNames,
      ...(policy ? { toolPolicy: policy } : {}),
      toolApprovalGate: async (call) => {
        workbenchGateAsks.push(call.toolName);
        return { decision: "execute" };
      },
      invoke: async ({ turnOrdinal }) =>
        turnOrdinal === 1 ? { content: "", toolCalls: [{ id: "c1", name, arguments: {} }] } : { content: "收尾" },
    });

    let agentRunsApproved = 0;
    const approvedAgentRegistry = new ToolRegistry();
    approvedAgentRegistry.register(makeTool(name, testCase.tool.overrides ?? {}, () => (agentRunsApproved += 1)));
    const agentConfirmAsks: string[] = [];
    await runAgent({
      userMessage: "跑一下",
      user: set.agentUser,
      registry: approvedAgentRegistry,
      runner: scriptRunner(name, []),
      onEvent: () => {},
      confirm: async (confirmedName) => {
        agentConfirmAsks.push(confirmedName);
        return true;
      },
      toolInjectionMode: "full",
      ...(policy ? { toolPolicy: policy } : {}),
    });

    assert.equal(workbenchRunsApproved, 1, "工作台侧批准后应执行一次");
    assert.equal(agentRunsApproved, 1, "编排侧批准后应执行一次");
    assert.equal(
      agentConfirmAsks.length,
      workbenchGateAsks.length,
      "两条通道向人要确认的次数不一致——审批门槛不等高",
    );
    assert.equal(
      agentConfirmAsks.length > 0,
      testCase.requiresApproval,
      `ask 档判定与「是否问过人」不符（期望 requiresApproval=${testCase.requiresApproval}）`,
    );
  });
}

// ------------------------------------------------------------
// 编排通道独有的一道边界（④ 第 3 条）：模型凭空点名「未注入」的工具
// ------------------------------------------------------------
// discovery 模式下 discoverable 工具首轮不注入，必须经 list_tools 发现后才进注入集。
// 过去编排层没有这道边界，模型凭空点名一个 on-demand 降档 / discoverable 工具仍能执行；
// 现在与工作台 executeToolCallBatch 同形：注入集之外不给执行机会，也不给审批机会。

test("编排通道·未经发现的 discoverable 工具：不执行，且不给确认机会", async () => {
  const registry = new ToolRegistry();
  let runs = 0;
  registry.register(makeTool("lazy_one", { discoverable: true }, () => (runs += 1)));
  registry.register(
    makeTool(LIST_TOOLS_TOOL_NAME, { capability: "estimates:read", category: "discovery" }, () => {}),
  );
  const errors: string[] = [];
  await runAgent({
    userMessage: "直接点名没发现的工具",
    user: { id: "u1", capabilities: ["estimates:read"], roles: ["ADMIN"] },
    registry,
    runner: scriptRunner("lazy_one", []),
    onEvent: (event) => {
      if (event.kind === "tool_result" && !event.ok) errors.push(event.error ?? "");
    },
    confirm: async () => {
      throw new Error("未注入的工具不该拿到确认机会");
    },
    toolInjectionMode: "discovery",
  });
  assert.equal(runs, 0, "未经发现的 discoverable 工具不得执行");
  assert.match(errors.join("\n"), /未经发现|停用|不可见/, "拒绝原因必须说清是注入边界挡下的");
});

test("编排通道·经 list_tools 发现后即可执行（边界不误伤正常发现路径）", async () => {
  const registry = new ToolRegistry();
  let runs = 0;
  registry.register(makeTool("lazy_one", { discoverable: true }, () => (runs += 1)));
  const listTool = makeTool(LIST_TOOLS_TOOL_NAME, { capability: "estimates:read", category: "discovery" }, () => {});
  listTool.execute = async () => ({ tools: [{ name: "lazy_one" }] });
  registry.register(listTool);

  let turn = 0;
  const runner: ChatRunner = {
    async chatCompletion(): Promise<ChatCompletionResponse> {
      turn += 1;
      const call =
        turn === 1
          ? { id: "c1", name: LIST_TOOLS_TOOL_NAME, arguments: { intent: "lazy" } }
          : turn === 2
            ? { id: "c2", name: "lazy_one", arguments: {} }
            : undefined;
      const content = call ? "" : "收尾";
      return { content, rawContent: content, model: "fake", provider: "fake", attempts: 1, toolCalls: call && [call] };
    },
  };
  await runAgent({
    userMessage: "先发现再调用",
    user: { id: "u1", capabilities: ["estimates:read"], roles: ["ADMIN"] },
    registry,
    runner,
    onEvent: () => {},
    toolInjectionMode: "discovery",
  });
  assert.equal(runs, 1, "list_tools 命中后补注入的工具应能执行");
});

// ------------------------------------------------------------
// 批次 6b 返修（③）：无审批链路的通道对 ask 档失败关闭
// ------------------------------------------------------------

test("编排通道·ask 档且无 confirm 端口：回「没有审批链路」原因，且不发 need_confirm", async () => {
  let runs = 0;
  const registry = new ToolRegistry();
  registry.register(makeTool("wr3", { mutates: true }, () => (runs += 1)));
  const events: string[] = [];
  const errors: string[] = [];
  await runAgent({
    userMessage: "建个项目",
    user: { id: "u1", capabilities: ["estimates:read"], roles: ["ADMIN"] },
    registry,
    runner: scriptRunner("wr3", []),
    onEvent: (event) => {
      events.push(event.kind);
      if (event.kind === "tool_result" && !event.ok) errors.push(event.error ?? "");
    },
    // 不传 confirm：本通道没有可持久化的审批闸门（/agent/chat 即此形态）
    toolInjectionMode: "full",
  });
  assert.equal(runs, 0, "无审批链路时写工具一次都不得执行");
  assert.ok(!events.includes("need_confirm"), `没问过人不该发 need_confirm，实取事件：${events.join(",")}`);
  assert.match(errors.join("\n"), /没有审批链路/, "拒绝原因必须说明是缺审批链路");
});
