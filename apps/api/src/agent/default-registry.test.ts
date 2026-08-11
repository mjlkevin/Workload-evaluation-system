import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultRegistry } from "./default-registry";
import type { AuthUser } from "../types";
import type { Capability } from "../rbac/permissions";

const fakeUser: AuthUser = {
  id: "u-test",
  username: "agent-tester",
  passwordHash: "hash",
  role: "user",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastLoginAt: "2026-01-01T00:00:00.000Z",
};

/** 全能力位视图（覆盖全部 8 个工具所需能力位） */
const FULL_CAPS: Capability[] = ["estimates:read", "estimates:create", "estimates:write"];

function visibleNames(registry: ReturnType<typeof createDefaultRegistry>, caps: Capability[]): string[] {
  return registry
    .listToolsFor({ id: fakeUser.id, capabilities: caps })
    .map((t) => t.function.name)
    .sort();
}

test("createDefaultRegistry: 注册数 ≥9 且工具名单快照（含内置 list_tools）", () => {
  const registry = createDefaultRegistry(fakeUser);
  const names = visibleNames(registry, FULL_CAPS);

  assert.ok(names.length >= 9, `注册数应 ≥9，实际 ${names.length}`);
  assert.deepEqual(names, [
    "create_project",
    "estimate_history",
    "estimate_implementation",
    "export_report",
    "generate_wbs",
    "knowledge_query",
    "list_tools",
    "project_list",
    "rule_lookup",
  ]);
});

test("createDefaultRegistry: 能力位 → 工具映射快照", () => {
  const registry = createDefaultRegistry(fakeUser);

  // estimates:read：4 个查询工具 + 内置发现工具 list_tools
  assert.deepEqual(visibleNames(registry, ["estimates:read"]), [
    "estimate_history",
    "knowledge_query",
    "list_tools",
    "project_list",
    "rule_lookup",
  ]);
  // estimates:create：初估 + 建项目
  assert.deepEqual(visibleNames(registry, ["estimates:create"]), [
    "create_project",
    "estimate_implementation",
  ]);
  // estimates:write：WBS 生成 + 报告导出
  assert.deepEqual(visibleNames(registry, ["estimates:write"]), [
    "export_report",
    "generate_wbs",
  ]);
});

test("listToolsFor: 无能力位用户看不到任何工具", () => {
  const registry = createDefaultRegistry(fakeUser);
  const tools = registry.listToolsFor({ id: fakeUser.id, capabilities: [] });

  assert.deepEqual(tools, []);
});

test("execute: 无能力位用户调用写工具被拒绝（执行时二次校验）", async () => {
  const registry = createDefaultRegistry(fakeUser);

  await assert.rejects(
    () => registry.execute("create_project", { projectName: "x" }, { id: fakeUser.id, capabilities: [] }),
    /无权限调用工具 create_project/,
  );
});

// ============================================================
// SP-2026-007 MS3：工具发现两段式（list_tools + 注入收敛）
// ============================================================

test("MS3: 默认注册表含内置 list_tools（发现类，核心注入）", () => {
  const registry = createDefaultRegistry(fakeUser);
  const tool = registry.get("list_tools");

  assert.ok(tool, "list_tools 应已注册");
  assert.equal(tool.mutates, false);
  assert.equal(tool.category, "discovery");
  assert.notEqual(tool.discoverable, true, "list_tools 本身应常驻核心注入集");
});

test("MS3: 全量回退注入与旧行为逐字节一致（原 8 工具、原顺序、无 list_tools）", () => {
  const registry = createDefaultRegistry(fakeUser);
  const names = registry
    .listFullToolsFor({ id: fakeUser.id, capabilities: FULL_CAPS })
    .map((t) => t.function.name);

  assert.deepEqual(names, [
    "estimate_implementation",
    "project_list",
    "estimate_history",
    "knowledge_query",
    "rule_lookup",
    "create_project",
    "generate_wbs",
    "export_report",
  ]);
});

test("MS3: 默认按需发现注入集 = 核心工具 + list_tools，较全量下降 ≥50%", () => {
  const registry = createDefaultRegistry(fakeUser);
  const user = { id: fakeUser.id, capabilities: FULL_CAPS };

  const full = registry.listFullToolsFor(user).map((t) => t.function.name);
  const core = registry.listCoreToolsFor(user).map((t) => t.function.name);
  const discovery = registry.listDiscoveryToolsFor(user).map((t) => t.function.name);

  assert.deepEqual(discovery, ["list_tools"]);
  const injected = [...core, ...discovery];
  assert.ok(injected.includes("list_tools"));
  assert.ok(!injected.includes("knowledge_query"), "discoverable 工具不应默认注入");
  assert.ok(
    injected.length <= full.length / 2,
    `默认注入 ${injected.length} 应 ≤ 全量 ${full.length} 的 50%`,
  );
});

test("MS3: RP-018 知识库工具注册为首个 discoverable 试点", () => {
  const registry = createDefaultRegistry(fakeUser);
  const tool = registry.get("knowledge_query");

  assert.equal(tool?.discoverable, true);
  assert.equal(tool?.category, "knowledge");
});

test("MS3: list_tools 按意图返回匹配工具说明书子集", async () => {
  const registry = createDefaultRegistry(fakeUser);
  const result = (await registry.execute(
    "list_tools",
    { intent: "知识库" },
    { id: fakeUser.id, capabilities: FULL_CAPS },
  )) as { tools: Array<{ name: string; parameters?: unknown }> };

  const names = result.tools.map((t) => t.name);
  assert.ok(names.includes("knowledge_query"), `意图「知识库」应命中 knowledge_query，实际 ${names}`);
  assert.ok(!names.includes("list_tools"), "发现结果不应包含 list_tools 自身");
  assert.ok(result.tools.every((t) => t.parameters), "说明书应含参数 schema");
});

test("MS3: list_tools 结果经 RBAC 能力位过滤（越权工具不可见）", async () => {
  const registry = createDefaultRegistry(fakeUser);
  const result = (await registry.execute(
    "list_tools",
    {},
    { id: fakeUser.id, capabilities: ["estimates:read"] },
  )) as { tools: Array<{ name: string }> };

  const names = result.tools.map((t) => t.name);
  assert.ok(names.includes("knowledge_query"));
  assert.ok(!names.includes("create_project"), "无 estimates:create 不应看到 create_project");
  assert.ok(!names.includes("export_report"), "无 estimates:write 不应看到 export_report");
});

test("MS3: list_tools 按类别过滤", async () => {
  const registry = createDefaultRegistry(fakeUser);
  const result = (await registry.execute(
    "list_tools",
    { category: "export" },
    { id: fakeUser.id, capabilities: FULL_CAPS },
  )) as { tools: Array<{ name: string; category: string }> };

  assert.deepEqual(result.tools.map((t) => t.name), ["export_report"]);
  assert.ok(result.tools.every((t) => t.category === "export"));
});
