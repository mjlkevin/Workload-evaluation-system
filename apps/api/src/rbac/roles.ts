// ============================================================
// RBAC - 7 角色常量与旧角色映射
// ============================================================
// v2 架构 7 角色定义，源自需求深度分析 §03 用户画像。
//
// 旧角色兼容策略（P0 不迁 users.json）：
//   - admin      → ADMIN（全部能力）
//   - sub_admin  → PM（大部分能力，无 ADMIN 专属）
//   - user       → PRE_SALES（基本能力）
//   - 未知/兜底   → PRE_SALES

export const V2_ROLES = [
  "SALES",
  "PRE_SALES",
  "IMPL",
  "PM",
  "DEV",
  "PMO",
  "ADMIN",
] as const;

export type V2Role = (typeof V2_ROLES)[number];

/** 旧角色 → v2 角色映射（多对一，返回数组便于未来扩展多角色） */
export function legacyRoleToV2Roles(legacyRole: string): V2Role[] {
  switch (legacyRole) {
    case "admin":
      return ["ADMIN"];
    case "sub_admin":
      return ["PM"];
    case "user":
      return ["PRE_SALES"];
    default:
      return ["PRE_SALES"];
  }
}

/** 判断是否为有效 v2 角色 */
export function isValidV2Role(role: string): role is V2Role {
  return V2_ROLES.includes(role as V2Role);
}
