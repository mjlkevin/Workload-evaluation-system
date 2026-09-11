// ============================================================
// RBAC - 能力位（Capability）与权限矩阵
// ============================================================
// 能力位命名规范：domain:action（小写 kebab-case）
//   domain  表示业务域（estimates / requirement / assessment / deliverable / evidence / dsl ...）
//   action  表示动作（create / read / write / manage / trigger / review / reject ...）
//
// 权限矩阵：ROLE_CAPABILITIES[role] = 该角色拥有的全部能力位数组

import type { V2Role } from "./roles";

// ------------------------------------------------------------------
// 能力位定义
// ------------------------------------------------------------------

export type Capability =
  // --- 评估包 / 商机 ---
  | "estimates:create"
  | "estimates:read"
  | "estimates:write"
  | "contract:initiate"
  // --- 需求 / 抽取 ---
  | "requirement:upload"
  | "extractor:trigger"
  | "requirement:maintain"
  // --- 评估 / 实施 ---
  | "assessment:create"
  | "dev:assign"
  | "assumption:write"
  | "assessment:handoff"
  | "man-day:adjust"
  // --- 开发顾问 ---
  | "dev:read"
  | "dev:write"
  // --- 交付物 / PMO ---
  | "deliverable:generate"
  | "deliverable:review"
  | "deliverable:reject"
  // --- 证据链 ---
  | "evidence:read"
  | "evidence:write"
  // --- 批次 7：MCP 第三方工具 ---
  // 全角色授予：MCP 工具的「默认不可用」不靠能力位实现，而由显式允许清单（配了才连）、
  // 工具级人工放行（未放行不进注册表）与外发恒 ask 三层承担；本位是 RBAC 侧总开关。
  | "mcp:invoke"
  // --- ADMIN 专属 ---
  | "dsl:manage"
  | "template:manage"
  | "rate-card:manage"
  | "methodology:manage"
  | "rule:manage"
  | "user:manage"
  | "system:manage";

// ------------------------------------------------------------------
// 权限矩阵
// ------------------------------------------------------------------

export const ROLE_CAPABILITIES: Record<V2Role, Capability[]> = {
  SALES: [
    "estimates:create",
    "estimates:read",
    "estimates:write",
    "contract:initiate",
    "mcp:invoke",
  ],

  PRE_SALES: [
    "estimates:create",
    "estimates:read",
    "requirement:upload",
    "extractor:trigger",
    "requirement:maintain",
    "evidence:read",
    "deliverable:review",
    "mcp:invoke",
  ],

  IMPL: [
    "estimates:create",
    "estimates:read",
    "estimates:write",
    "assessment:create",
    "dev:assign",
    "assumption:write",
    "evidence:read",
    "evidence:write",
    "mcp:invoke",
  ],

  PM: [
    "estimates:create",
    "estimates:read",
    "estimates:write",
    "assessment:handoff",
    "man-day:adjust",
    "deliverable:generate",
    "evidence:read",
    "mcp:invoke",
  ],

  DEV: [
    "dev:read",
    "dev:write",
    "mcp:invoke",
  ],

  PMO: [
    "estimates:read",
    "deliverable:review",
    "deliverable:reject",
    "evidence:read",
    "mcp:invoke",
  ],

  ADMIN: [
    "estimates:create",
    "estimates:read",
    "estimates:write",
    "contract:initiate",
    "requirement:upload",
    "extractor:trigger",
    "requirement:maintain",
    "assessment:create",
    "dev:assign",
    "assumption:write",
    "assessment:handoff",
    "man-day:adjust",
    "deliverable:generate",
    "dev:read",
    "dev:write",
    "deliverable:review",
    "deliverable:reject",
    "evidence:read",
    "evidence:write",
    "dsl:manage",
    "template:manage",
    "rate-card:manage",
    "methodology:manage",
    "rule:manage",
    "user:manage",
    "system:manage",
    "mcp:invoke",
  ],
};

// ------------------------------------------------------------------
// 查询 helpers
// ------------------------------------------------------------------

/** 判断指定角色是否拥有某能力位 */
export function roleHasCapability(role: V2Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

/** 判断一组角色中是否有任意角色拥有某能力位 */
export function anyRoleHasCapability(roles: V2Role[], capability: Capability): boolean {
  return roles.some((r) => roleHasCapability(r, capability));
}

/** 获取某角色拥有的全部能力位（去重拷贝） */
export function getRoleCapabilities(role: V2Role): readonly Capability[] {
  return ROLE_CAPABILITIES[role];
}

/** 获取一组角色的能力位并集 */
export function getCombinedCapabilities(roles: V2Role[]): Capability[] {
  const set = new Set<Capability>();
  for (const r of roles) {
    for (const c of ROLE_CAPABILITIES[r]) {
      set.add(c);
    }
  }
  return Array.from(set);
}
