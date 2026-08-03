import assert from "node:assert/strict";
import test from "node:test";

import type { KnowledgeBaseProfile } from "../../types";
import { routeKnowledgeBase } from "./knowledge-base-router.service";

function profile(overrides: Partial<KnowledgeBaseProfile>): KnowledgeBaseProfile {
  return {
    id: "solutions",
    name: "金蝶解决方案知识库",
    description: "产品方案与实施边界",
    knowledgeId: "kb-solutions",
    routingKeywords: ["产品方案", "标准模块"],
    allowedBusinessRoles: [],
    enabled: true,
    isDefault: true,
    priority: 100,
    ...overrides,
  };
}

const profiles = [
  profile({}),
  profile({
    id: "treasury",
    name: "司库与银企知识库",
    description: "资金计划、网上银行、银企直联",
    knowledgeId: "kb-treasury",
    routingKeywords: ["资金计划", "网上银行", "网银", "银企"],
    allowedBusinessRoles: ["pre_sales", "delivery", "pm"],
    isDefault: false,
    priority: 10,
  }),
  profile({
    id: "dev-private",
    name: "研发内部知识库",
    description: "研发规范",
    knowledgeId: "kb-dev",
    routingKeywords: ["研发规范"],
    allowedBusinessRoles: ["dev"],
    isDefault: false,
    priority: 20,
  }),
];

test("explicit knowledge base name wins without calling the route model", async () => {
  let called = false;
  const route = await routeKnowledgeBase({
    query: "请到司库与银企知识库查资金方案",
    businessRole: "pre_sales",
    profiles,
    modelSelect: async () => { called = true; return null; },
  });

  assert.equal(called, false);
  assert.equal(route.mode, "explicit");
  assert.equal(route.primaryProfile?.id, "treasury");
  assert.equal(route.fallbackProfile?.id, "solutions");
});

test("a unique routing keyword uses deterministic rules and skips the model", async () => {
  let called = false;
  const route = await routeKnowledgeBase({
    query: "网上银行实施边界怎么划分？",
    businessRole: "pre_sales",
    profiles,
    modelSelect: async () => { called = true; return null; },
  });

  assert.equal(called, false);
  assert.equal(route.mode, "rule");
  assert.equal(route.primaryProfile?.id, "treasury");
  assert.match(route.reason, /网银|网上银行/);
});

test("ambiguous requests let the model choose only from role-authorized candidates", async () => {
  let candidateIds: string[] = [];
  const route = await routeKnowledgeBase({
    query: "这个边界怎么判断？",
    businessRole: "pre_sales",
    profiles,
    modelSelect: async ({ candidates }) => {
      candidateIds = candidates.map((item) => item.id);
      return { knowledgeBaseId: "treasury", confidence: 0.86, reason: "涉及司库业务边界" };
    },
  });

  assert.deepEqual(candidateIds, ["treasury", "solutions"]);
  assert.equal(route.mode, "model");
  assert.equal(route.primaryProfile?.id, "treasury");
  assert.equal(route.confidence, 0.86);
});

test("invalid or low-confidence model output falls back to the authorized default", async () => {
  for (const selection of [
    { knowledgeBaseId: "dev-private", confidence: 0.99, reason: "越权" },
    { knowledgeBaseId: "treasury", confidence: 0.4, reason: "不确定" },
  ]) {
    const route = await routeKnowledgeBase({
      query: "请帮我判断",
      businessRole: "pre_sales",
      profiles,
      modelSelect: async () => selection,
    });
    assert.equal(route.mode, "default");
    assert.equal(route.primaryProfile?.id, "solutions");
  }
});

test("a role with no accessible profile resolves without querying any knowledge base", async () => {
  const lockedProfiles = profiles.map((item) => ({ ...item, allowedBusinessRoles: ["dev" as const] }));
  let called = false;
  const route = await routeKnowledgeBase({
    query: "网上银行实施边界",
    businessRole: "sales",
    profiles: lockedProfiles,
    modelSelect: async () => { called = true; return null; },
  });

  assert.equal(called, false);
  assert.equal(route.mode, "unresolved");
  assert.equal(route.primaryProfile, undefined);
  assert.equal(route.reason, "no_accessible_knowledge_base");
});
