import test from "node:test";
import assert from "node:assert/strict";

import { buildToolInventory } from "./tool-inventory";
import type { AuthUser } from "../types";
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
      "callable",
      "capability",
      "category",
      "description",
      "discoverable",
      "mutates",
      "name",
    ]);
  }
});

test("buildToolInventory: 清单恒为注册表全量，不按查看者业务权限裁剪", () => {
  // 回归本批缺陷：端点由 system:manage 守卫，而系统管理员通常不持有 estimates:* ——
  // 一旦按查看者权限过滤，审计页会对着 0 条或 5 条清单让人误判「系统里就这么几个工具」。
  for (const caps of [[], ["system:manage"], ["estimates:read"], FULL_CAPS] as Capability[][]) {
    const items = inventory(caps);
    assert.equal(items.length, 9, `查看者能力位为 [${caps.join(",")}] 时仍须列出全部 9 个工具`);
    assert.equal(items.filter((item) => item.mutates).length, 3);
  }
});

test("buildToolInventory: callable 随查看者权限变化，标记「有这个工具但你本人调不了」", () => {
  const callableCount = (caps: Capability[]) => inventory(caps).filter((item) => item.callable).length;

  assert.equal(callableCount([]), 0);
  // 纯系统管理员：9 个工具全部可见，但本人一个都调不动
  assert.equal(callableCount(["system:manage"]), 0);
  // 只有读权限：4 个 estimates:read 业务工具 + list_tools 可调，3 个写工具与初估工具不可调
  assert.equal(callableCount(["estimates:read"]), 5);
  assert.equal(callableCount(FULL_CAPS), 9);

  const readOnlyViewer = new Map(inventory(["estimates:read"]).map((item) => [item.name, item]));
  assert.equal(readOnlyViewer.get("project_list")?.callable, true);
  assert.equal(readOnlyViewer.get("create_project")?.callable, false);
  assert.equal(readOnlyViewer.get("create_project")?.capability, "estimates:create");
});
