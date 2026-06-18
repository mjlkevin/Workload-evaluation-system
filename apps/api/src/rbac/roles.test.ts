// ============================================================
// RBAC - 角色、权限矩阵、查询 helpers 测试
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  V2_ROLES,
  legacyRoleToV2Roles,
  isValidV2Role,
  type V2Role,
} from "./roles";
import {
  ROLE_CAPABILITIES,
  roleHasCapability,
  anyRoleHasCapability,
  getRoleCapabilities,
  getCombinedCapabilities,
  type Capability,
} from "./permissions";

// ------------------------------------------------------------------
// 角色常量
// ------------------------------------------------------------------

test("V2_ROLES 包含 7 个角色", () => {
  assert.equal(V2_ROLES.length, 7);
  assert.deepStrictEqual(V2_ROLES, [
    "SALES",
    "PRE_SALES",
    "IMPL",
    "PM",
    "DEV",
    "PMO",
    "ADMIN",
  ]);
});

test("isValidV2Role: 有效角色", () => {
  assert.equal(isValidV2Role("ADMIN"), true);
  assert.equal(isValidV2Role("PMO"), true);
  assert.equal(isValidV2Role("SALES"), true);
});

test("isValidV2Role: 无效角色", () => {
  assert.equal(isValidV2Role("admin"), false);
  assert.equal(isValidV2Role("USER"), false);
  assert.equal(isValidV2Role(""), false);
});

// ------------------------------------------------------------------
// 旧角色映射
// ------------------------------------------------------------------

test("legacyRoleToV2Roles: admin → ADMIN", () => {
  assert.deepStrictEqual(legacyRoleToV2Roles("admin"), ["ADMIN"]);
});

test("legacyRoleToV2Roles: sub_admin → PM", () => {
  assert.deepStrictEqual(legacyRoleToV2Roles("sub_admin"), ["PM"]);
});

test("legacyRoleToV2Roles: user → PRE_SALES", () => {
  assert.deepStrictEqual(legacyRoleToV2Roles("user"), ["PRE_SALES"]);
});

test("legacyRoleToV2Roles: 未知角色 → PRE_SALES（兜底）", () => {
  assert.deepStrictEqual(legacyRoleToV2Roles("unknown"), ["PRE_SALES"]);
  assert.deepStrictEqual(legacyRoleToV2Roles(""), ["PRE_SALES"]);
});

// ------------------------------------------------------------------
// 权限矩阵
// ------------------------------------------------------------------

test("ADMIN 拥有全部 ADMIN 专属能力", () => {
  const adminCaps = getRoleCapabilities("ADMIN");
  assert.ok(adminCaps.includes("dsl:manage"));
  assert.ok(adminCaps.includes("template:manage"));
  assert.ok(adminCaps.includes("user:manage"));
  assert.ok(adminCaps.includes("system:manage"));
});

test("ADMIN 拥有 estimates:create（超级管理员可执行全部业务操作）", () => {
  assert.equal(roleHasCapability("ADMIN", "estimates:create"), true);
});

test("DEV 只有 dev:read 和 dev:write", () => {
  const devCaps = getRoleCapabilities("DEV");
  assert.equal(devCaps.length, 2);
  assert.ok(devCaps.includes("dev:read"));
  assert.ok(devCaps.includes("dev:write"));
  assert.equal(roleHasCapability("DEV", "estimates:read"), false);
});

test("PMO 有 deliverable:review 和 deliverable:reject", () => {
  assert.equal(roleHasCapability("PMO", "deliverable:review"), true);
  assert.equal(roleHasCapability("PMO", "deliverable:reject"), true);
  assert.equal(roleHasCapability("PMO", "evidence:read"), true);
  assert.equal(roleHasCapability("PMO", "evidence:write"), false);
});

test("PRE_SALES 有 extractor:trigger 但没有 assessment:create", () => {
  assert.equal(roleHasCapability("PRE_SALES", "extractor:trigger"), true);
  assert.equal(roleHasCapability("PRE_SALES", "assessment:create"), false);
});

test("SALES 只有 estimates 和 contract 相关能力", () => {
  const salesCaps = getRoleCapabilities("SALES");
  assert.ok(salesCaps.includes("estimates:create"));
  assert.ok(salesCaps.includes("contract:initiate"));
  assert.equal(roleHasCapability("SALES", "evidence:read"), false);
});

test("IMPL 有 evidence:write（SOW 写权限）", () => {
  assert.equal(roleHasCapability("IMPL", "evidence:write"), true);
  assert.equal(roleHasCapability("IMPL", "assessment:create"), true);
});

test("PM 有 assessment:handoff 和 man-day:adjust", () => {
  assert.equal(roleHasCapability("PM", "assessment:handoff"), true);
  assert.equal(roleHasCapability("PM", "man-day:adjust"), true);
  assert.equal(roleHasCapability("PM", "deliverable:generate"), true);
});

// ------------------------------------------------------------------
// 组合查询
// ------------------------------------------------------------------

test("anyRoleHasCapability: 多角色 OR 判断", () => {
  assert.equal(anyRoleHasCapability(["PRE_SALES", "IMPL"], "evidence:read"), true);
  assert.equal(anyRoleHasCapability(["PRE_SALES", "DEV"], "evidence:write"), false);
});

test("getCombinedCapabilities: 角色并集", () => {
  const combined = getCombinedCapabilities(["PRE_SALES", "IMPL"]);
  assert.ok(combined.includes("extractor:trigger"));   // PRE_SALES 有
  assert.ok(combined.includes("assessment:create"));    // IMPL 有
  assert.ok(combined.includes("evidence:read"));        // 两者都有
  // 去重验证
  const unique = new Set(combined);
  assert.equal(combined.length, unique.size);
});

// ------------------------------------------------------------------
// 全角色 × 全能力位覆盖检查（防漏配）
// ------------------------------------------------------------------

test("每个角色至少有一个能力位", () => {
  for (const role of V2_ROLES) {
    const caps = getRoleCapabilities(role);
    assert.ok(caps.length > 0, `${role} 应至少有一个能力位`);
  }
});

test("没有重复的能力位在同一角色内", () => {
  for (const role of V2_ROLES) {
    const caps = getRoleCapabilities(role);
    const set = new Set(caps);
    assert.equal(
      caps.length,
      set.size,
      `${role} 的能力位不应有重复`
    );
  }
});
