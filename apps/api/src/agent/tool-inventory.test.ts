import test from "node:test";
import assert from "node:assert/strict";

import { buildToolInventory } from "./tool-inventory";
import type { AuthUser } from "../types";
import type { Capability } from "../rbac/permissions";

const fakeUser: AuthUser = {
  id: "u-inventory-test",
  username: "inventory-tester",
  passwordHash: "hash",
  role: "admin",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastLoginAt: "2026-01-01T00:00:00.000Z",
};

/** 与 default-registry.test.ts 同口径的全能力位视图（覆盖全部工具所需能力位） */
const FULL_CAPS: Capability[] = ["estimates:read", "estimates:create", "estimates:write"];

function inventory(capabilities: Capability[]) {
  return buildToolInventory(fakeUser, capabilities);
}

test("buildToolInventory: 全能力位下派生 9 个工具，保持注册顺序", () => {
  const items = inventory(FULL_CAPS);

  assert.equal(items.length, 9);
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

test("buildToolInventory: 不返回 execute 实现，也不返回参数 schema", () => {
  for (const item of inventory(FULL_CAPS)) {
    assert.deepEqual(Object.keys(item).sort(), [
      "capability",
      "category",
      "description",
      "discoverable",
      "mutates",
      "name",
    ]);
  }
});

test("buildToolInventory: 按调用方能力位过滤，无能力位则清单为空", () => {
  assert.equal(inventory(["estimates:read"]).length, 5);
  assert.equal(inventory(["estimates:read"]).some((item) => item.mutates), false);
  assert.deepEqual(inventory([]), []);
});
