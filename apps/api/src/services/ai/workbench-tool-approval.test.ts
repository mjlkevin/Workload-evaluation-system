import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKBENCH_TOOL_ACTION_ID_MAX_CHARS,
  WORKBENCH_TOOL_CALL_ID_MAX_CHARS,
  WORKBENCH_TOOL_DECISION_SLOTS,
  WorkbenchToolApprovalPendingError,
  buildWorkbenchToolActionId,
  computeWorkbenchToolArgsDigest,
  createWorkbenchToolApprovalGate,
  normalizeWorkbenchToolCallId,
  resolveWorkbenchToolDecisionSlot,
} from "./workbench-tool-approval";
import type { WorkbenchToolApprovalPorts } from "./workbench-tool-approval";
import type { AgentTool } from "../../agent/agent.types";

// ============================================================
// 批次 1a · 写操作工具的执行前审批闸门（决策槽 + 服务端判定）
// ============================================================
// 三条不可让步约束在本文件的落点：
//  (1) 「要不要审批」由服务端按策略判定，模型无从表达；查不到/抛错/不在已知清单
//      一律落到 ask —— 失败方向关闭。
//  (2) 审批请求只带 callId，不带第二份工具参数（参数唯一来源是 tool.call.started）。
//      本文件钉的是 actionId 的推导：绑死 (runId, stepKey, ordinal, toolName, argsDigest)，
//      换工具或换参数即换 actionId ⇒ 旧批准对新调用天然无效，且不复制参数。
//  (3) 挂起走可持久机制（pauseForApproval 端口），不使用阻塞回调。

function tool(overrides: Partial<AgentTool> = {}): AgentTool {
  return {
    name: "read_tool",
    description: "t",
    parameters: {},
    capability: "estimates:read",
    mutates: false,
    execute: async () => ({}),
    ...overrides,
  };
}

test("决策槽只有三档：allow / ask / skip", () => {
  assert.deepEqual([...WORKBENCH_TOOL_DECISION_SLOTS], ["allow", "ask", "skip"]);
});

test("resolveWorkbenchToolDecisionSlot: mutates=false → allow（只读直放）", () => {
  assert.equal(resolveWorkbenchToolDecisionSlot(tool({ mutates: false })), "allow");
});

test("resolveWorkbenchToolDecisionSlot: mutates=true → ask", () => {
  assert.equal(resolveWorkbenchToolDecisionSlot(tool({ name: "create_project", mutates: true })), "ask");
});

// 失败方向关闭：任何「不是明确 false」的 mutates 都必须落到 ask
for (const [label, value] of [
  ["undefined", undefined],
  ["null", null],
  ["字符串 true", "true"],
  ["1", 1],
] as const) {
  test(`resolveWorkbenchToolDecisionSlot: mutates=${label} 视为需审批（ask）`, () => {
    assert.equal(
      resolveWorkbenchToolDecisionSlot(tool({ mutates: value as unknown as boolean })),
      "ask",
      `mutates 非严格 false 时不得放行：${label}`,
    );
  });
}

test("resolveWorkbenchToolDecisionSlot: 工具不在已知清单（查不到）→ ask", () => {
  assert.equal(resolveWorkbenchToolDecisionSlot(undefined), "ask");
});

test("buildWorkbenchToolActionId: 同参同工具同序号 → 同一 actionId（重放可对账）", () => {
  const base = { runId: "r1", stepKey: "chat", ordinal: 1, toolName: "create_project", arguments: { projectName: "甲" } };
  assert.equal(buildWorkbenchToolActionId(base), buildWorkbenchToolActionId({ ...base }));
});

test("buildWorkbenchToolActionId: 换工具/换参数/换序号 → actionId 必变（旧批准不可复用）", () => {
  const base = { runId: "r1", stepKey: "chat", ordinal: 1, toolName: "create_project", arguments: { projectName: "甲" } };
  const id = buildWorkbenchToolActionId(base);
  assert.notEqual(id, buildWorkbenchToolActionId({ ...base, toolName: "generate_wbs" }), "换工具不得沿用同一批准");
  assert.notEqual(id, buildWorkbenchToolActionId({ ...base, arguments: { projectName: "乙" } }), "改参数不得沿用同一批准");
  assert.notEqual(id, buildWorkbenchToolActionId({ ...base, ordinal: 2 }), "不同调用不得共用决策");
  assert.notEqual(id, buildWorkbenchToolActionId({ ...base, runId: "r2" }), "跨 Run 不得串决策");
});

test("buildWorkbenchToolActionId: 不含参数明文，只含摘要", () => {
  const id = buildWorkbenchToolActionId({
    runId: "r1",
    stepKey: "chat",
    ordinal: 1,
    toolName: "create_project",
    arguments: { projectName: "绝密客户名" },
  });
  assert.equal(id.includes("绝密客户名"), false, `actionId 不得携带参数明文，实取 ${id}`);
});

test("computeWorkbenchToolArgsDigest: 键序无关、值敏感", () => {
  assert.equal(computeWorkbenchToolArgsDigest({ a: 1, b: 2 }), computeWorkbenchToolArgsDigest({ b: 2, a: 1 }));
  assert.notEqual(computeWorkbenchToolArgsDigest({ a: 1 }), computeWorkbenchToolArgsDigest({ a: 2 }));
});

function ports(overrides: Partial<WorkbenchToolApprovalPorts> = {}): WorkbenchToolApprovalPorts & {
  pauseCalls: unknown[];
  lookupCalls: string[];
} {
  const state = {
    pauseCalls: [] as unknown[],
    lookupCalls: [] as string[],
    findDecision: async () => null as "approved" | "rejected" | null,
    ...overrides,
  };
  return {
    pauseCalls: state.pauseCalls,
    lookupCalls: state.lookupCalls,
    findDecision: async (input) => {
      state.lookupCalls.push(input.actionId);
      return state.findDecision(input);
    },
    pauseForApproval: async (input) => {
      state.pauseCalls.push(input);
    },
  };
}

const GATE_BASE = { runId: "r1", attemptId: "a1", stepKey: "chat" };
const CALL = { ordinal: 1, toolName: "create_project", callId: "call_1", arguments: { projectName: "甲" } };

test("gate: 无决策 → 落可持久挂起并抛 Pending，绝不执行", async () => {
  const p = ports();
  const gate = createWorkbenchToolApprovalGate(GATE_BASE, p);
  await assert.rejects(() => gate(CALL), (err: unknown) => err instanceof WorkbenchToolApprovalPendingError);
  assert.equal(p.pauseCalls.length, 1, "必须经 pause 端口留痕（可持久，非阻塞回调）");
  const pause = p.pauseCalls[0] as Record<string, unknown>;
  assert.equal(pause.runId, "r1");
  assert.equal(pause.attemptId, "a1");
  assert.equal(pause.toolName, "create_project");
  assert.equal(pause.callId, "call_1");
  assert.equal("arguments" in pause, false, "挂起请求不得携带第二份工具参数");
  assert.equal("args" in pause, false, "挂起请求不得携带第二份工具参数");
});

test("gate: 已批准 → 返回 execute 决策", async () => {
  const p = ports({ findDecision: async () => "approved" });
  const gate = createWorkbenchToolApprovalGate(GATE_BASE, p);
  assert.deepEqual(await gate(CALL), { decision: "execute" });
  assert.equal(p.pauseCalls.length, 0, "已批准不得再挂起");
});

test("gate: 已拒绝 → 返回 reject 决策（skip 档：不执行，模型继续作答）", async () => {
  const p = ports({ findDecision: async () => "rejected" });
  const gate = createWorkbenchToolApprovalGate(GATE_BASE, p);
  const outcome = await gate(CALL);
  assert.equal(outcome.decision, "reject");
  assert.equal(p.pauseCalls.length, 0);
});

test("gate: 决策查询抛错 → 按无决策处理并挂起（失败方向关闭）", async () => {
  const p = ports({
    findDecision: async () => {
      throw new Error("db down");
    },
  });
  const gate = createWorkbenchToolApprovalGate(GATE_BASE, p);
  await assert.rejects(() => gate(CALL), (err: unknown) => err instanceof WorkbenchToolApprovalPendingError);
  assert.equal(p.pauseCalls.length, 1);
});

test("gate: 挂起写入失败 → 抛错且不执行（不得退化为放行）", async () => {
  const p = ports();
  const gate = createWorkbenchToolApprovalGate(GATE_BASE, {
    ...p,
    pauseForApproval: async () => {
      throw new Error("run not running");
    },
  });
  await assert.rejects(() => gate(CALL), /run not running/);
});

test("gate: 同一 actionId 在一次 Run 内只挂起一次（重放不重复发审批事件）", async () => {
  const p = ports();
  const gate = createWorkbenchToolApprovalGate(GATE_BASE, p);
  await assert.rejects(() => gate(CALL), (err: unknown) => err instanceof WorkbenchToolApprovalPendingError);
  await assert.rejects(() => gate({ ...CALL }), (err: unknown) => err instanceof WorkbenchToolApprovalPendingError);
  assert.equal(p.lookupCalls[0], p.lookupCalls[1], "actionId 必须可重放推导（同一调用同一决策键）");
});

// ============================================================
// 入站上限：callId / actionId 都是模型可影响的字符串，且会落进持久 payload
// ============================================================
// 不封顶等于让模型用一条超长 id 撑大事件表（并原样回放给界面）。
// 归一化只有一处（normalizeWorkbenchToolCallId），由工具循环统一调用，
// 保证 tool.call.started 与审批事件里的 callId 逐字节相同、能对上账。

test("callId 归一化：去空白 + 封顶 200，不原样存模型给的超长 id", () => {
  assert.equal(normalizeWorkbenchToolCallId("  call_abc  "), "call_abc");
  assert.equal(normalizeWorkbenchToolCallId(undefined), "");
  const huge = "x".repeat(50_000);
  assert.equal(normalizeWorkbenchToolCallId(huge).length, WORKBENCH_TOOL_CALL_ID_MAX_CHARS);
});

test("actionId 封顶：决策键不得被撑长（它同样进 payload）", () => {
  const id = buildWorkbenchToolActionId({
    runId: "r".repeat(500),
    stepKey: "chat",
    ordinal: 1,
    toolName: "create_project",
    arguments: {},
  });
  assert.ok(id.length <= WORKBENCH_TOOL_ACTION_ID_MAX_CHARS, `实取长度 ${id.length}`);
});

test("闸门持久化的是归一化后的 callId（超长入站 id 不得直落库）", async () => {
  const p = ports();
  const gate = createWorkbenchToolApprovalGate(GATE_BASE, p);
  const huge = "y".repeat(10_000);
  await assert.rejects(
    () => gate({ ...CALL, callId: `  ${huge}_padding` }),
    (err: unknown) => err instanceof WorkbenchToolApprovalPendingError,
  );
  const pause = p.pauseCalls[0] as { callId: string };
  assert.equal(pause.callId.length, WORKBENCH_TOOL_CALL_ID_MAX_CHARS, `实取 ${pause.callId.length}`);
  assert.equal(pause.callId.startsWith("y".repeat(50)), true);
});
