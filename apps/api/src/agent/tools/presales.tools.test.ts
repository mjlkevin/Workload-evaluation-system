import test from "node:test";
import assert from "node:assert/strict";

import { matchExistingPlans, type PlanRecord } from "./match.repository";
import { buildEstimateTool, type EstimateFn } from "./presales.tools";
import type { AgentUser } from "../agent.types";

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

const user: AgentUser = { id: "u1", capabilities: ["estimates:create"] };

test("buildEstimateTool: 元信息正确（读操作、能力位）", () => {
  const tool = buildEstimateTool((() => ({ ok: true })) as unknown as EstimateFn);

  assert.equal(tool.name, "estimate_implementation");
  assert.equal(tool.capability, "estimates:create");
  assert.equal(tool.mutates, false);
});

test("buildEstimateTool: execute 只转接到底层 calculate", async () => {
  let received: unknown;
  const fakeCalc = ((body: unknown) => { received = body; return { totalDays: 5 }; }) as unknown as EstimateFn;
  const tool = buildEstimateTool(fakeCalc);

  const out = await tool.execute({ items: [{ a: 1 }] }, user);

  assert.deepEqual(out, { totalDays: 5 });
  assert.deepEqual(received, { items: [{ a: 1 }] });
});
