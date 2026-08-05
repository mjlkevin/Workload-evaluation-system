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

test("createDefaultRegistry: 注册数 ≥8 且工具名单快照", () => {
  const registry = createDefaultRegistry(fakeUser);
  const names = visibleNames(registry, FULL_CAPS);

  assert.ok(names.length >= 8, `注册数应 ≥8，实际 ${names.length}`);
  assert.deepEqual(names, [
    "create_project",
    "estimate_history",
    "estimate_implementation",
    "export_report",
    "generate_wbs",
    "knowledge_query",
    "project_list",
    "rule_lookup",
  ]);
});

test("createDefaultRegistry: 能力位 → 工具映射快照", () => {
  const registry = createDefaultRegistry(fakeUser);

  // estimates:read：4 个查询工具
  assert.deepEqual(visibleNames(registry, ["estimates:read"]), [
    "estimate_history",
    "knowledge_query",
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
