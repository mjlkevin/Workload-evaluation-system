import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEstimateHistoryTool,
  buildKnowledgeQueryTool,
  buildProjectListTool,
  buildRuleLookupTool,
} from "./query.tools";
import type { AgentUser } from "../agent.types";

const user: AgentUser = { id: "u1", capabilities: ["estimates:read"] };

test("查询工具: 元信息快照（读操作、能力位）", () => {
  const tools = [
    buildProjectListTool(() => []),
    buildEstimateHistoryTool(() => ({ total: 0, items: [] })),
    buildKnowledgeQueryTool(async () => ({})),
    buildRuleLookupTool(() => ({})),
  ];

  assert.deepEqual(
    tools.map((t) => ({ name: t.name, capability: t.capability, mutates: t.mutates })),
    [
      { name: "project_list", capability: "estimates:read", mutates: false },
      { name: "estimate_history", capability: "estimates:read", mutates: false },
      { name: "knowledge_query", capability: "estimates:read", mutates: false },
      { name: "rule_lookup", capability: "estimates:read", mutates: false },
    ],
  );
});

test("buildProjectListTool: keyword 透传，空值不传", async () => {
  const received: Array<{ keyword?: string }> = [];
  const tool = buildProjectListTool((query) => {
    received.push(query);
    return [];
  });

  await tool.execute({ keyword: "小鹏" }, user);
  await tool.execute({}, user);

  assert.deepEqual(received, [{ keyword: "小鹏" }, {}]);
});

test("buildEstimateHistoryTool: 分页参数归一化（默认值与上限）", async () => {
  const received: Array<{ page: number; pageSize: number }> = [];
  const tool = buildEstimateHistoryTool((query) => {
    received.push(query);
    return { total: 0, items: [] };
  });

  await tool.execute({}, user);
  await tool.execute({ page: 3, pageSize: 20 }, user);
  await tool.execute({ page: -1, pageSize: 999 }, user);

  assert.deepEqual(received, [
    { page: 1, pageSize: 10 },
    { page: 3, pageSize: 20 },
    { page: 1, pageSize: 50 },
  ]);
});

test("buildKnowledgeQueryTool: query 必填且透传", async () => {
  let received = "";
  const tool = buildKnowledgeQueryTool(async (query) => {
    received = query;
    return { answer: "ok" };
  });

  await assert.rejects(() => tool.execute({ query: "  " }, user), /需要 query 参数/);

  const out = await tool.execute({ query: "财务云实施人天" }, user);
  assert.equal(received, "财务云实施人天");
  assert.deepEqual(out, { answer: "ok" });
});

test("buildRuleLookupTool: execute 只转接到底层 loadRules", async () => {
  let called = 0;
  const tool = buildRuleLookupTool(() => {
    called += 1;
    return { baseRule: "standardDays" };
  });

  const out = await tool.execute({}, user);
  assert.equal(called, 1);
  assert.deepEqual(out, { baseRule: "standardDays" });
});
