// ============================================================
// 工单 2026-08-11-qoder-memory-panel-chip-live-link · RED→GREEN
// MS3 chip 活数据链路：dispatch trace additive 字段守护
// - toolCalls（工具发现结果）与 memoryRef（引用记忆标记）经
//   modelChat 结果 → dispatch trace 组装点透传；
// - 既有字段语义零变更，缺数据时字段缺省（前端静默降级）。
// ============================================================

import assert from "node:assert/strict";
import test from "node:test";

import type { AuthUser } from "../../types";
import { dispatchHomeWorkbenchTurn } from "./workbench-dispatch.service";

const user: AuthUser = {
  id: "user-chip-trace",
  username: "chip-tester",
  passwordHash: "test-hash",
  role: "user",
  businessRole: "pre_sales",
  status: "active",
  createdAt: "2026-08-11T00:00:00.000Z",
  lastLoginAt: "2026-08-11T00:00:00.000Z",
};

function makeInput(modelChat: (params: { systemPrompt: string; userContent: string }) => Promise<any>) {
  return {
    user,
    workflowKey: "free_chat",
    message: "帮我继续推进这个需求评估",
    businessRole: "pre_sales" as const,
    roleLabel: "售前顾问",
    model: "kimi-test",
    rolePrompt: "你是售前顾问的 AI 工作助手。",
    modelChat,
  };
}

test("chip 链路：modelChat 返回 toolCalls 时 dispatch trace 透传 additive 字段", async () => {
  const result = await dispatchHomeWorkbenchTurn(makeInput(async () => ({
    answer: "好的，继续推进。",
    rawContent: "好的，继续推进。",
    toolCalls: [
      { name: "estimate_history", source: "list_tools" },
      { name: "project_list", source: "list_tools" },
    ],
  })));

  assert.ok(Array.isArray(result.trace.toolCalls), "trace 应携带 toolCalls 数组");
  assert.deepEqual(result.trace.toolCalls, [
    { name: "estimate_history", source: "list_tools" },
    { name: "project_list", source: "list_tools" },
  ]);
});

test("chip 链路：modelChat 返回 memoryRef 时 dispatch trace 透传引用记忆标记", async () => {
  const result = await dispatchHomeWorkbenchTurn(makeInput(async () => ({
    answer: "基于已知事实继续。",
    rawContent: "基于已知事实继续。",
    memoryRef: { scenesCount: 2, atomsCount: 3 },
  })));

  assert.deepEqual(result.trace.memoryRef, { scenesCount: 2, atomsCount: 3 });
});

test("chip 链路：modelChat 无 chip 数据时 trace 不出现 additive 字段（静默降级）", async () => {
  const result = await dispatchHomeWorkbenchTurn(makeInput(async () => ({
    answer: "普通回复。",
    rawContent: "普通回复。",
  })));

  assert.equal(result.trace.toolCalls, undefined);
  assert.equal(result.trace.memoryRef, undefined);
  // 既有字段语义不变
  assert.equal(typeof result.trace.intentConfidence, "number");
  assert.equal(typeof result.trace.routingRule, "string");
  assert.ok(Array.isArray(result.trace.contextRefs));
});
