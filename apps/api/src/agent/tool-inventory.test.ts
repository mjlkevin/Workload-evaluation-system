import test from "node:test";
import assert from "node:assert/strict";

import { buildToolInventory } from "./tool-inventory";
import { estimateToolsTokens } from "../services/ai/context/token-meter";
import { toToolDefinition } from "./agent.types";
import { createDefaultRegistry } from "./default-registry";
import type { AuthUser, ToolPolicyConfig } from "../types";
import type { Capability } from "../rbac/permissions";

const fakeUser: AuthUser = {
  id: "u-inventory-test",
  username: "inventory-tester",
  passwordHash: "",
  role: "admin",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastLoginAt: "2026-01-01T00:00:00.000Z",
};

/** 查看者侧的「全部业务工具所需能力位」视图（清单本身不再受它裁剪） */
const FULL_CAPS: Capability[] = ["estimates:read", "estimates:create", "estimates:write"];

function inventory(capabilities: Capability[]) {
  return buildToolInventory(fakeUser, capabilities).items;
}

function inventoryWithPolicy(capabilities: Capability[], policy: ToolPolicyConfig) {
  return buildToolInventory(fakeUser, capabilities, { policy, viewerRoles: ["ADMIN"] }).items;
}

test("buildToolInventory: 全能力位下派生 11 个工具，保持注册顺序", () => {
  const items = inventory(FULL_CAPS);

  assert.equal(items.length, 11);
  assert.deepEqual(
    items.map((item) => item.name),
    [
      "estimate_implementation",
      "project_list",
      "estimate_history",
      "knowledge_query",
      "rule_lookup",
      "create_project",
      "generate_wbs",
      "export_report",
      "ask_user",
      // 批次 4：capability_discovery 正则退役后的承接工具，注册在 ask_user 之后
      "describe_capabilities",
      "list_tools",
    ],
  );
});

test("buildToolInventory: mutates=true 恰为 3 个写操作工具", () => {
  const writers = inventory(FULL_CAPS)
    .filter((item) => item.mutates)
    .map((item) => item.name)
    .sort();

  assert.deepEqual(writers, ["create_project", "export_report", "generate_wbs"]);
});

test("buildToolInventory: 每条都带权限位/分类/可发现性，供后台显示谁能用", () => {
  const byName = new Map(inventory(FULL_CAPS).map((item) => [item.name, item]));

  const projectList = byName.get("project_list");
  assert.ok(projectList);
  assert.ok(projectList.description.length > 0, "描述须为模型看到的那段文字");
  assert.equal(projectList.capability, "estimates:read");
  assert.equal(projectList.mutates, false);
  assert.equal(projectList.category, "project");
  assert.equal(projectList.discoverable, false);

  assert.equal(byName.get("create_project")?.capability, "estimates:create");
  assert.equal(byName.get("knowledge_query")?.discoverable, true);
  assert.equal(byName.get("list_tools")?.category, "discovery");
});

test("buildToolInventory: 不返回 execute 实现，也不返回参数 schema（批次 6b 边界：新增字段仍不含二者）", () => {
  for (const item of inventory(FULL_CAPS)) {
    assert.deepEqual(Object.keys(item).sort(), [
      "activePolicy",
      "callable",
      "capability",
      "category",
      "description",
      "discoverable",
      "exfiltrates",
      "injected",
      "mcpApproval",
      "mcpDigest",
      "mcpServer",
      "mutates",
      "name",
      "origin",
      "tokens",
    ]);
  }
});

test("buildToolInventory: 清单恒为注册表全量，不按查看者业务权限裁剪", () => {
  // 回归本批缺陷：端点由 system:manage 守卫，而系统管理员通常不持有 estimates:* ——
  // 一旦按查看者权限过滤，审计页会对着 0 条或 5 条清单让人误判「系统里就这么几个工具」。
  for (const caps of [[], ["system:manage"], ["estimates:read"], FULL_CAPS] as Capability[][]) {
    const items = inventory(caps);
    assert.equal(items.length, 11, `查看者能力位为 [${caps.join(",")}] 时仍须列出全部 11 个工具`);
    assert.equal(items.filter((item) => item.mutates).length, 3);
  }
});

test("buildToolInventory: callable 随查看者权限变化，标记「有这个工具但你本人调不了」", () => {
  const callableCount = (caps: Capability[]) => inventory(caps).filter((item) => item.callable).length;

  assert.equal(callableCount([]), 0);
  // 纯系统管理员：11 个工具全部可见，但本人一个都调不动
  assert.equal(callableCount(["system:manage"]), 0);
  // 只有读权限：4 个 estimates:read 业务工具 + 批次 4 能力清单 + ask_user + list_tools 可调，
  // 3 个写工具与初估工具不可调
  assert.equal(callableCount(["estimates:read"]), 7);
  assert.equal(callableCount(FULL_CAPS), 11);

  const readOnlyViewer = new Map(inventory(["estimates:read"]).map((item) => [item.name, item]));
  assert.equal(readOnlyViewer.get("project_list")?.callable, true);
  assert.equal(readOnlyViewer.get("create_project")?.callable, false);
  assert.equal(readOnlyViewer.get("create_project")?.capability, "estimates:create");
});

// -------------------- 批次 6b：token 计量 / 外发维度 / 策略生效视图 --------------------

test("批次6b·判据④：tokens 与批次 3 estimateToolsTokens 逐工具一致（同函数同输入，非页面自算）", () => {
  const registry = createDefaultRegistry(fakeUser);
  const byName = new Map(inventory(FULL_CAPS).map((item) => [item.name, item]));
  for (const [name, definition] of registry.listToolsFor({ id: fakeUser.id, capabilities: FULL_CAPS }).entries()) {
    void name;
    const tool = registry.get(definition.function.name);
    assert.ok(tool);
    const expected = estimateToolsTokens([toToolDefinition(tool)]);
    assert.equal(byName.get(tool.name)?.tokens, expected, `${tool.name} 的清单 token 须等于计量函数输出`);
    assert.ok(expected > 0, `${tool.name} token 必须为正`);
  }
});

test("批次6b：当前工具集无外发工具，但维度逐条在场且独立于 mutates", () => {
  const items = inventory(FULL_CAPS);
  for (const item of items) {
    assert.equal(typeof item.exfiltrates, "boolean");
    // 注册表事实：本批没有任何工具标外发（批次 7 接入后由代码侧声明）
    assert.equal(item.exfiltrates, false, `${item.name} 当前不应声明外发`);
  }
});

test("批次6b：缺省策略下 activePolicy=代码默认、injected=capability∩非on-demand降档", () => {
  const items = inventory(FULL_CAPS);
  const defaultEntry = { enabled: true, visibleRoles: [], approvalStrategy: "default", injectionMode: "default" };
  for (const item of items) {
    assert.deepEqual(item.activePolicy, defaultEntry);
  }
  // 全能力位查看者：全部业务工具注入（含 discoverable，与工作台全量通道同口径）；
  // 内置 discovery 类（list_tools）不在该通道
  const byName = new Map(items.map((item) => [item.name, item]));
  assert.equal(byName.get("project_list")?.injected, true);
  assert.equal(byName.get("knowledge_query")?.injected, true, "discoverable 业务工具在工作台全量通道仍注入");
  assert.equal(byName.get("list_tools")?.injected, false, "内置 discovery 类不算注入");
});

test("批次6b·判据①②：策略停用 → injected=false 且不计入合计；启用提不了权（无 capability 仍不注入）", () => {
  const policy: ToolPolicyConfig = {
    schemaVersion: 1,
    policies: {
      // 停用两个工具（一个有权限、一个查看者本人无权限）
      export_report: { enabled: false, visibleRoles: [], approvalStrategy: "default", injectionMode: "default" },
      generate_wbs: { enabled: false, visibleRoles: [], approvalStrategy: "default", injectionMode: "default" },
      // 策略「启用」一个查看者无能力位的工具——不得因此变 injected
      create_project: { enabled: true, visibleRoles: [], approvalStrategy: "default", injectionMode: "default" },
    },
  };
  // 只读查看者：create_project 需要 estimates:create，策略启用也提不了权
  const readOnly = inventoryWithPolicy(["estimates:read"], policy);
  const byName = new Map(readOnly.map((item) => [item.name, item]));
  assert.equal(byName.get("export_report")?.injected, false);
  assert.equal(byName.get("generate_wbs")?.injected, false);
  assert.equal(byName.get("create_project")?.injected, false, "策略只做减法：启用不得越过 capability 过滤");
  assert.equal(byName.get("create_project")?.activePolicy.enabled, true, "生效视图仍如实呈现策略决定");

  // 合计口径同步收紧
  const full = buildToolInventory(fakeUser, FULL_CAPS, { policy, viewerRoles: ["ADMIN"] });
  const injectedNames = full.items.filter((item) => item.injected).map((item) => item.name);
  assert.equal(injectedNames.includes("export_report"), false);
  assert.equal(injectedNames.includes("generate_wbs"), false);
  assert.equal(full.summary.injectedCount, injectedNames.length);
});

test("批次6b·角色可见性：visibleRoles 不含查看者角色 → injected=false（叠加在 capability 之上）", () => {
  const policy: ToolPolicyConfig = {
    schemaVersion: 1,
    policies: {
      project_list: { enabled: true, visibleRoles: ["PM"], approvalStrategy: "default", injectionMode: "default" },
    },
  };
  // 查看者 = ADMIN（legacy admin），策略只放行 PM → 角色层裁掉
  const items = buildToolInventory(fakeUser, FULL_CAPS, { policy, viewerRoles: ["ADMIN"] }).items;
  assert.equal(items.find((item) => item.name === "project_list")?.injected, false);
  // 查看者 = PM → 放行
  const pmItems = buildToolInventory(fakeUser, FULL_CAPS, { policy, viewerRoles: ["PM"] }).items;
  assert.equal(pmItems.find((item) => item.name === "project_list")?.injected, true);
});

test("批次6b·注入模式：on-demand 降档把常驻工具逐出全量注入集（减法方向）", () => {
  const policy: ToolPolicyConfig = {
    schemaVersion: 1,
    policies: {
      rule_lookup: { enabled: true, visibleRoles: [], approvalStrategy: "default", injectionMode: "on-demand" },
    },
  };
  const items = inventoryWithPolicy(FULL_CAPS, policy);
  assert.equal(items.find((item) => item.name === "rule_lookup")?.injected, false);
  assert.equal(items.find((item) => item.name === "rule_lookup")?.callable, true, "降档不等于收权，本人仍可调");
});

test("批次6b：summary 合计 = 各注入工具 tokens 之和（页面与后端同一份账）", () => {
  const full = buildToolInventory(fakeUser, FULL_CAPS, { viewerRoles: ["ADMIN"] });
  const expected = full.items.filter((item) => item.injected).reduce((sum, item) => sum + item.tokens, 0);
  assert.equal(full.summary.injectedTokens, expected);
  assert.ok(expected > 0);
});
