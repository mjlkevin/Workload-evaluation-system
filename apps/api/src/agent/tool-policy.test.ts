import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_TOOL_POLICY_ENTRY,
  applyToolPolicyToDefinitions,
  diffToolPolicyConfigs,
  isToolDiscoverableUnderPolicy,
  isToolInjectableOnFullChannel,
  normalizeToolPolicyConfig,
  normalizeToolPolicyEntry,
  resolveToolPolicyEntry,
} from "./tool-policy";
import { toToolDefinition, type AgentTool } from "./agent.types";
import { ToolRegistry } from "./tool-registry";
import type { ToolPolicyConfig } from "../types";

// ============================================================
// 批次 6b · 工具策略层纯函数
// ============================================================
// 要害是「只做减法」：本文件的反例全部朝一个方向构造——
// 试图用策略把工具变多 / 变可见 / 免审批，必须全部失败。

function tool(overrides: Partial<AgentTool> = {}): AgentTool {
  return {
    name: "read_tool",
    description: "读工具",
    parameters: { type: "object", properties: {} },
    capability: "estimates:read",
    mutates: false,
    execute: async () => ({}),
    ...overrides,
  };
}

function policy(policies: Partial<Record<string, Partial<ToolPolicyConfig["policies"][string]>>> = {}): ToolPolicyConfig {
  const normalized: ToolPolicyConfig["policies"] = {};
  for (const [name, entry] of Object.entries(policies)) {
    normalized[name] = normalizeToolPolicyEntry(entry);
  }
  return { schemaVersion: 1, policies: normalized };
}

// -------------------- 归一化：外部输入不可信 --------------------

test("normalizeToolPolicyEntry: 缺省即代码默认（启用 / 无角色限制 / default 审批 / default 注入）", () => {
  assert.deepEqual(normalizeToolPolicyEntry(undefined), DEFAULT_TOOL_POLICY_ENTRY);
  assert.deepEqual(normalizeToolPolicyEntry({}), DEFAULT_TOOL_POLICY_ENTRY);
});

test("normalizeToolPolicyEntry: 非法枚举与非法角色名回落默认，合法值保留", () => {
  const entry = normalizeToolPolicyEntry({
    enabled: "false" as unknown as boolean, // 非布尔 ≠ false → 视为启用（缺省方向与注册表一致）
    visibleRoles: ["PM", "BOGUS_ROLE", "  ADMIN  ", "PM"],
    approvalStrategy: "no-approval" as never,
    injectionMode: "force-core" as never,
  });
  assert.equal(entry.enabled, true);
  assert.deepEqual(entry.visibleRoles, ["PM", "ADMIN"], "非法角色剔除、去重、trim，顺序保留");
  assert.equal(entry.approvalStrategy, "default", "不存在的审批策略词汇（如免审批）不得生效");
  assert.equal(entry.injectionMode, "default", "不存在的注入模式词汇（如强制常驻）不得生效");
});

test("normalizeToolPolicyEntry: enabled 严格 false 才停用（null/undefined/字符串都算启用）", () => {
  assert.equal(normalizeToolPolicyEntry({ enabled: false }).enabled, false);
  assert.equal(normalizeToolPolicyEntry({ enabled: null }).enabled, true);
  assert.equal(normalizeToolPolicyEntry({ enabled: "off" }).enabled, true);
});

test("normalizeToolPolicyConfig: 空名键剔除，schemaVersion 收敛", () => {
  const config = normalizeToolPolicyConfig({
    schemaVersion: 0,
    policies: { "": { enabled: false }, " ": { enabled: false }, ok_tool: { enabled: false } },
  });
  assert.deepEqual(Object.keys(config.policies), ["ok_tool"]);
  assert.equal(config.schemaVersion, 1);
});

test("resolveToolPolicyEntry: 未配置工具返回默认条目（不是 undefined，调用方免判空）", () => {
  assert.deepEqual(resolveToolPolicyEntry(undefined, "whatever"), DEFAULT_TOOL_POLICY_ENTRY);
  assert.deepEqual(resolveToolPolicyEntry(policy(), "whatever"), DEFAULT_TOOL_POLICY_ENTRY);
});

// -------------------- 全量通道注入准入 --------------------

test("判据①：enabled=false 从全量注入集剔除", () => {
  const registry = new ToolRegistry();
  registry.register(tool({ name: "export_report", mutates: true }));
  const definitions = [toToolDefinition(tool({ name: "export_report", mutates: true }))];
  const filtered = applyToolPolicyToDefinitions(definitions, registry, {
    policy: policy({ export_report: { enabled: false } }),
    roles: ["ADMIN"],
  });
  assert.deepEqual(filtered, []);
});

test("缺省/空策略 = 批次 6a 行为：注入集逐字节不变（顺序与内容都不动）", () => {
  const registry = new ToolRegistry();
  const tools = [tool({ name: "a" }), tool({ name: "b", capability: "estimates:create" })];
  for (const item of tools) registry.register(item);
  const definitions = tools.map(toToolDefinition);
  assert.deepEqual(applyToolPolicyToDefinitions(definitions, registry, { roles: ["ADMIN"] }), definitions);
  assert.deepEqual(applyToolPolicyToDefinitions(definitions, registry, { policy: policy(), roles: ["ADMIN"] }), definitions);
});

test("判据②：角色可见性只收窄不提权——visibleRoles 未命中即剔除，命中仍受 capability 前置", () => {
  const registry = new ToolRegistry();
  const exportReport = tool({ name: "export_report", capability: "estimates:write", mutates: true });
  registry.register(exportReport);
  const definitions = [toToolDefinition(exportReport)];

  // ADMIN 在可见名单内：注入（capability 判定发生在注册表 selector，早于本层）
  assert.equal(applyToolPolicyToDefinitions(definitions, registry, { policy: policy({ export_report: { visibleRoles: ["ADMIN"] } }), roles: ["ADMIN"] }).length, 1);
  // PRE_SALES 不在名单：剔除
  assert.equal(applyToolPolicyToDefinitions(definitions, registry, { policy: policy({ export_report: { visibleRoles: ["ADMIN"] } }), roles: ["PRE_SALES"] }).length, 0);
  // 策略对 PM 开放 ≠ PM 获得 estimates:write——那是 selector 的事，本层永远不放大
  assert.equal(isToolDiscoverableUnderPolicy(tool({ name: "export_report", capability: "estimates:write", mutates: true }), policy({ export_report: { visibleRoles: ["PM"] } }), ["PM"]), true, "本层判「角色可见」，不判 capability");
});

test("多角色用户：任一持有角色命中即可见（与 capability 的并集口径同构）", () => {
  assert.equal(
    isToolInjectableOnFullChannel(tool({ name: "t" }), policy({ t: { visibleRoles: ["PM"] } }), ["PRE_SALES", "PM"]),
    true,
  );
});

test("注入模式 on-demand：全量注入集不再主动注入（两条通道同一判据）；发现通道仍可见", () => {
  const item = tool({ name: "knowledge_query", discoverable: true });
  const onDemand = policy({ knowledge_query: { injectionMode: "on-demand" } });
  assert.equal(isToolInjectableOnFullChannel(item, onDemand, ["ADMIN"]), false);
  assert.equal(isToolDiscoverableUnderPolicy(item, onDemand, ["ADMIN"]), true, "降档不是停用，发现通道保留");
  // 代码标记为常驻（discoverable !== true）的工具被策略降档：同样从注入集剔除——
  // 判据与上面同一条（编排通道与工作台通道的注入集都出自 isToolInjectableOnFullChannel）。
  const core = tool({ name: "rule_lookup" });
  assert.equal(isToolInjectableOnFullChannel(core, policy({ rule_lookup: { injectionMode: "on-demand" } }), ["ADMIN"]), false);
  assert.equal(isToolInjectableOnFullChannel(core, undefined, ["ADMIN"]), true, "无策略 = 默认条目，常驻工具照注入（零回归）");
});

test("停用 + 角色不可见叠加：任一条成立即剔除", () => {
  const item = tool({ name: "create_project", capability: "estimates:create", mutates: true });
  assert.equal(isToolInjectableOnFullChannel(item, policy({ create_project: { enabled: false, visibleRoles: ["ADMIN"] } }), ["ADMIN"]), false);
  assert.equal(isToolInjectableOnFullChannel(item, policy({ create_project: { enabled: true, visibleRoles: ["DEV"] } }), ["ADMIN"]), false);
});

test("未注册工具（查不到）一律不可注入（失败方向关闭）", () => {
  const registry = new ToolRegistry();
  assert.equal(isToolInjectableOnFullChannel(undefined, undefined, ["ADMIN"]), false);
});

test("批次 7：MCP 工具角色可见性来自放行记录 mcpAllowedRoles，不回落策略空 visibleRoles", () => {
  const mcpTool = tool({
    name: "mcp__sv__t",
    capability: "mcp:invoke",
    source: "mcp",
    mcpAllowedRoles: ["ADMIN"],
  } as Partial<AgentTool>);
  // 策略 visibleRoles 为空（代码工具语义 = 仅受 capability 约束），对 MCP 工具不得被读成「所有人可见」
  assert.equal(isToolInjectableOnFullChannel(mcpTool, policy({ "mcp__sv__t": { visibleRoles: [] } }), ["ADMIN"]), true);
  assert.equal(isToolInjectableOnFullChannel(mcpTool, policy({ "mcp__sv__t": { visibleRoles: [] } }), ["DEV"]), false);
  // 即便策略显式把 visibleRoles 设给 DEV，MCP 工具仍以放行记录为准
  assert.equal(isToolInjectableOnFullChannel(mcpTool, policy({ "mcp__sv__t": { visibleRoles: ["DEV"] } }), ["DEV"]), false);
});

test("批次 7：MCP 工具缺少 mcpAllowedRoles 时一律不可见（不存在「默认对所有人」）", () => {
  const mcpTool = tool({
    name: "mcp__sv__wide",
    capability: "mcp:invoke",
    source: "mcp",
  } as Partial<AgentTool>);
  assert.equal(isToolInjectableOnFullChannel(mcpTool, undefined, ["ADMIN"]), false);
  assert.equal(isToolDiscoverableUnderPolicy(mcpTool, undefined, ["ADMIN"]), false);
});

// -------------------- diff：变更轨迹的「改了什么」 --------------------

test("diffToolPolicyConfigs: 字段级变化逐条产出，未变条目不产噪音", () => {
  const prev = policy({ a: { enabled: true }, b: { visibleRoles: ["PM"] } });
  const next = policy({ a: { enabled: false }, b: { visibleRoles: ["PM"] }, c: { injectionMode: "on-demand" } });
  const changes = diffToolPolicyConfigs(prev, next);
  assert.deepEqual(changes, [
    { tool: "a", field: "enabled", from: "true", to: "false" },
    { tool: "c", field: "injectionMode", from: "default", to: "on-demand" },
  ]);
});

test("diffToolPolicyConfigs: 角色名单空↔非空有可读表示；默认值增删互抵", () => {
  assert.deepEqual(
    diffToolPolicyConfigs(policy({ a: { enabled: true } }), policy({ a: {} })),
    [],
    "显式默认值与缺省之间没有差异",
  );
  const changes = diffToolPolicyConfigs(policy({ a: { visibleRoles: [] } }), policy({ a: { visibleRoles: ["ADMIN"] } }));
  assert.deepEqual(changes, [{ tool: "a", field: "visibleRoles", from: "（全部角色）", to: "ADMIN" }]);
});

test("diffToolPolicyConfigs: 审批收紧与 user-confirm→default 的放宽都如实记录（审计记录事实，不替读者下判断）", () => {
  const prev = policy({ a: { approvalStrategy: "default" } });
  const next = policy({ a: { approvalStrategy: "user-confirm" } });
  assert.deepEqual(diffToolPolicyConfigs(prev, next), [{ tool: "a", field: "approvalStrategy", from: "default", to: "user-confirm" }]);
  assert.deepEqual(diffToolPolicyConfigs(next, prev), [{ tool: "a", field: "approvalStrategy", from: "user-confirm", to: "default" }]);
});
