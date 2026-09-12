// ============================================================
// 批次 6b · 工具策略层（纯函数，不落库、不依赖 DB）
// ============================================================
// 边界（要害，不得放宽）：
//  · 工具的 execute、参数 schema、实现**留在代码**；这里只消费「挂在清单上的决定」。
//  · 清单本身仍从运行时 ToolRegistry 派生（批次 6a 裁决）——本模块不维护任何清单副本。
//  · 策略层**只做减法**：capability 过滤（注册表既有逻辑，本模块不碰）之上再叠加
//    「启用 / 角色可见 / 注入模式」三层裁切，三层与 capability 全部通过才注入。
//    未列出的工具走代码默认（启用 + 无角色限制），因此「新增工具忘了配策略」的后果
//    是维持现状，而不是静默消失，也不是静默放行。
//  · 角色可见性只能收窄：visibleRoles 里的角色名必须先在用户角色集合内才可能命中；
//    本模块不读 capability、不产生任何提权路径。
// ============================================================

import type { ToolDefinition } from "../ai/provider/model-provider";
import type { V2Role } from "../rbac/roles";
import type {
  ToolPolicyApprovalStrategy,
  ToolPolicyConfig,
  ToolPolicyEntry,
  ToolPolicyInjectionMode,
  ToolPolicyRevisionChange,
} from "../types";
import { TOOL_POLICY_APPROVAL_STRATEGIES, TOOL_POLICY_INJECTION_MODES } from "../types";
import type { AgentTool } from "./agent.types";

/** 未配置工具的默认策略：启用、无角色限制、审批按代码口径、注入模式跟随代码 */
export const DEFAULT_TOOL_POLICY_ENTRY: ToolPolicyEntry = {
  enabled: true,
  visibleRoles: [],
  approvalStrategy: "default",
  injectionMode: "default",
};

/** 取某工具的有效策略条目（稀疏覆盖 → 缺省即默认；不返回 undefined，调用方免判空） */
export function resolveToolPolicyEntry(policy: ToolPolicyConfig | undefined, toolName: string): ToolPolicyEntry {
  return policy?.policies?.[toolName] ?? DEFAULT_TOOL_POLICY_ENTRY;
}

/** 归一单条策略条目（外部输入不可信：逐字段白名单收口，非法值回落默认） */
export function normalizeToolPolicyEntry(input: unknown): ToolPolicyEntry {
  const source = (input || {}) as Partial<ToolPolicyEntry>;
  const visibleRoles = Array.isArray(source.visibleRoles)
    ? Array.from(
        new Set(
          source.visibleRoles
            .map((role) => (typeof role === "string" ? role.trim() : ""))
            .filter((role) => (V2_ROLE_NAMES as readonly string[]).includes(role)),
        ),
      )
    : [];
  return {
    enabled: source.enabled !== false,
    visibleRoles,
    approvalStrategy: isApprovalStrategy(source.approvalStrategy) ? source.approvalStrategy : "default",
    injectionMode: isInjectionMode(source.injectionMode) ? source.injectionMode : "default",
  };
}

export function normalizeToolPolicyConfig(input: unknown): ToolPolicyConfig {
  const source = (input || {}) as Partial<ToolPolicyConfig>;
  const policies: Record<string, ToolPolicyEntry> = {};
  const rawPolicies = (source.policies || {}) as Record<string, unknown>;
  for (const [toolName, entry] of Object.entries(rawPolicies)) {
    const name = toolName.trim();
    if (!name) continue;
    policies[name] = normalizeToolPolicyEntry(entry);
  }
  return {
    schemaVersion: Number.isFinite(Number(source.schemaVersion)) ? Math.max(1, Number(source.schemaVersion)) : 1,
    policies,
  };
}

function isApprovalStrategy(value: unknown): value is ToolPolicyApprovalStrategy {
  return typeof value === "string" && (TOOL_POLICY_APPROVAL_STRATEGIES as readonly string[]).includes(value);
}

function isInjectionMode(value: unknown): value is ToolPolicyInjectionMode {
  return typeof value === "string" && (TOOL_POLICY_INJECTION_MODES as readonly string[]).includes(value);
}

// V2 角色名单从 rbac 单一来源取，避免白名单与角色定义漂移
import { V2_ROLES as V2_ROLE_NAMES } from "../rbac/roles";

/**
 * 全量注入通道（工作台）的注入准入：capability 已由注册表过滤，这里叠加策略三刀。
 * 返回 false 的三种情形——停用、角色不可见、策略强制按需发现（全量通道不再主动注入）。
 */
export function isToolInjectableOnFullChannel(tool: AgentTool | undefined, policy: ToolPolicyConfig | undefined, roles: readonly V2Role[]): boolean {
  if (!tool) return false;
  const entry = resolveToolPolicyEntry(policy, tool.name);
  if (entry.enabled === false) return false;
  if (!isRoleVisible(tool, entry, roles)) return false;
  // on-demand：全量通道不主动注入（agent 发现通道另行处理）
  if (entry.injectionMode === "on-demand") return false;
  return true;
}

/** 按需发现通道的可见性（发现检索/补注入）：停用与角色不可见一律不可见；无 on-demand 降档概念（本就走发现） */
export function isToolDiscoverableUnderPolicy(tool: AgentTool, policy: ToolPolicyConfig | undefined, roles: readonly V2Role[]): boolean {
  const entry = resolveToolPolicyEntry(policy, tool.name);
  if (entry.enabled === false) return false;
  return isRoleVisible(tool, entry, roles);
}

function isRoleVisible(tool: AgentTool, entry: ToolPolicyEntry, roles: readonly V2Role[]): boolean {
  // 批次 7：MCP 工具的角色触达面来自人工放行记录，不是策略条目的 visibleRoles。
  // 空数组对代码工具意为「仅受权限位约束」，对 MCP 工具会被读成「所有人」，语义相反。
  if (tool.source === "mcp") {
    const allowed = tool.mcpAllowedRoles;
    if (!allowed || allowed.length === 0) return false;
    return allowed.some((role) => (roles as readonly string[]).includes(role));
  }
  if (entry.visibleRoles.length === 0) return true;
  return entry.visibleRoles.some((role) => (roles as readonly string[]).includes(role));
}

/**
 * 对注册表**已按 capability 过滤后**的 Provider 定义集应用策略裁切（只做减法）。
 * 入参 definitions 的顺序保持逐字节不变（过滤不重排），返回新的 Provider 定义列表。
 *
 * 判据的唯一三处出口（两条通道都调它们，不再各自内联）：
 *  · 全量注入准入 → isToolInjectableOnFullChannel
 *  · 发现通道准入 → isToolDiscoverableUnderPolicy
 *  · 要不要审批 → resolveWorkbenchToolDecisionSlot（../services/ai/workbench-tool-approval.ts）
 */
export function applyToolPolicyToDefinitions(
  definitions: readonly ToolDefinition[],
  registry: { get(name: string): AgentTool | undefined },
  ctx: { policy?: ToolPolicyConfig; roles: readonly V2Role[] },
): ToolDefinition[] {
  // 无生效策略 = 每条都拿默认条目 → 与批次 6a 行为逐字节一致（顺序、内容都不动）
  return definitions.filter((definition) =>
    isToolInjectableOnFullChannel(registry.get(definition.function.name), ctx.policy, ctx.roles),
  );
}

/**
 * 策略 diff（字段级，供变更轨迹）：prev → next。
 * 只比较**有实际差异**的条目；新增/删除条目以默认条目为另一端基准。
 */
export function diffToolPolicyConfigs(prev: ToolPolicyConfig, next: ToolPolicyConfig): ToolPolicyRevisionChange[] {
  const names = new Set([...Object.keys(prev.policies ?? {}), ...Object.keys(next.policies ?? {})]);
  const changes: ToolPolicyRevisionChange[] = [];
  for (const tool of Array.from(names).sort()) {
    const before = resolveToolPolicyEntry(prev, tool);
    const after = resolveToolPolicyEntry(next, tool);
    if (before.enabled !== after.enabled) {
      changes.push({ tool, field: "enabled", from: String(before.enabled), to: String(after.enabled) });
    }
    const rolesFrom = before.visibleRoles.join(",");
    const rolesTo = after.visibleRoles.join(",");
    if (rolesFrom !== rolesTo) {
      changes.push({ tool, field: "visibleRoles", from: rolesFrom || "（全部角色）", to: rolesTo || "（全部角色）" });
    }
    if (before.approvalStrategy !== after.approvalStrategy) {
      changes.push({ tool, field: "approvalStrategy", from: before.approvalStrategy, to: after.approvalStrategy });
    }
    if (before.injectionMode !== after.injectionMode) {
      changes.push({ tool, field: "injectionMode", from: before.injectionMode, to: after.injectionMode });
    }
  }
  return changes;
}
