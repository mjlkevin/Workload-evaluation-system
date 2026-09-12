// ============================================================
// 批次 7 · MCP 桥接层（纯函数：归一化 / 摘要 / 桥接判定）
// ============================================================
// 三条硬口径都在这里落地，且都可单测：
//  · 裁决二：MCP 工具默认不可用——进入注入集的前提是「人工放行清单里有这个名字
//    **且**当前定义摘要与放行时一致」。缺省不是放行，是拒绝。
//  · 裁决三：exfiltrates 按构造赋 true，不读服务上报的任何字段；服务谎报
//    annotations / exfiltrates:false 一律无效。
//  · 裁决四：稳定名由我方拼装并经 mcp-names 校验；上报名不合字符集直接拒绝桥接。

import { createHash } from "node:crypto";
import type { AgentTool, AgentUser } from "../agent.types";
import type { Capability } from "../../rbac/permissions";
import type { RuntimeContext } from "../context/context.types";
import {
  MCP_CREDENTIAL_ENV_KEY,
  MCP_SERVER_LIMIT,
  MCP_SERVER_TIMEOUT_BOUNDS,
  MCP_SERVER_DEFAULT_TIMEOUT_MS,
  MCP_STDIO_COMMAND_ALLOWLIST,
  MCP_TRANSPORTS,
  type McpConfig,
  type McpRevisionChange,
  type McpServerEntry,
  type McpToolApproval,
  type McpTransport,
} from "../../types";
import { buildMcpToolName, MCP_SERVER_ID_PATTERN, parseMcpToolName } from "./mcp-names";
// 角色名单的唯一来源：不在本文件重列一份，避免白名单与角色定义漂移。
import { V2_ROLES, type V2Role } from "../../rbac/roles";

/** 角色的规范序（按 V2_ROLES 定义序）：同一份角色集合无论输入顺序如何都归一成同一串，轨迹 diff 才不产生噪音 */
function canonicalRoleOrder(roles: readonly string[]): V2Role[] {
  return V2_ROLES.filter((role) => roles.includes(role));
}

/** 服务上报的工具形状（tools/list 单条；字段全部不可信，逐把关） */
export type McpReportedTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  /** 第三方任何自述字段都不参与安全判定，仅在此声明「有我们也无视」 */
  [key: string]: unknown;
};

/** 递归排序键的稳定序列化：与审批摘要同一算法（键序不同必须得到同一摘要） */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

/**
 * 工具定义摘要：绑定「上报名 + description + inputSchema」三样。
 * 这三样全部由第三方撰写、随时可改（裁决二的要害），所以放行不是永久的：
 * 每回合现算，对不上即回落未放行。
 */
export function computeMcpToolDigest(tool: Pick<McpReportedTool, "name" | "description" | "inputSchema">): string {
  const canonical = stableStringify({
    name: tool.name,
    description: tool.description ?? "",
    inputSchema: tool.inputSchema ?? null,
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

/** 放行判定：名单里有 + 摘要逐字节相等才注入；任何一项不满足都是拒绝（裁决二） */
export type McpApprovalDecision =
  | { approved: true; digest: string; reason: "approved"; allowedRoles: [V2Role, ...V2Role[]] }
  | { approved: false; digest: string; reason: "not-approved" | "definition-changed" };

export function isMcpToolApproved(
  approvedTools: Record<string, McpToolApproval>,
  reported: Pick<McpReportedTool, "name" | "description" | "inputSchema">,
): McpApprovalDecision {
  const digest = computeMcpToolDigest(reported);
  const entry = Object.prototype.hasOwnProperty.call(approvedTools, reported.name)
    ? approvedTools[reported.name]
    : undefined;
  if (!entry) return { approved: false, digest, reason: "not-approved" };
  if (entry.digest !== digest) return { approved: false, digest, reason: "definition-changed" };
  // 角色触达面随判定一起交出：注入侧不需要、也不得再去别处找一份角色口径（两处口径 = 一处漂移）。
  // 非空由两处把关保证：归一化（不可信 JSON 的入口）丢弃无角色条目，bridgeMcpTool 构造时无角色即抛。
  return { approved: true, digest, reason: "approved", allowedRoles: entry.allowedRoles };
}

/** 桥接产出的工具附带归属信息，供清单页呈现（origin 分流）与执行侧回查 */
export interface McpBridgedTool extends AgentTool {
  source: "mcp";
  /** 归属服务 id（本地登记的，不是上报的） */
  mcpServerId: string;
  /** 服务上报名（放行清单的键） */
  mcpReportedName: string;
  /** 当前定义摘要 */
  mcpDigest: string;
  /**
   * 放行记录里的角色触达面（非空）。注入期角色可见性的**唯一**来源：
   * MCP 工具不得回落到 DEFAULT_TOOL_POLICY_ENTRY 的空 visibleRoles
   * ——空数组对代码工具意为「仅受权限位约束」，对 MCP 工具会被读成「所有人」，语义相反。
   */
  mcpAllowedRoles: [V2Role, ...V2Role[]];
}

/**
 * 把一个「已放行」的上报工具桥接为 AgentTool。execute 由调用方注入
 * （绑定到活连接；执行失败以异常上抛，由工具循环收敛为 ok:false 回填）。
 *
 * mutates 固定 true：第三方实现是否改状态我方无从证明，且无论 true/false
 * 审批槽都先被 exfiltrates 钉在 ask——这里取安全侧仅为了「策略停用之外还留写语义下限」。
 */
export function bridgeMcpTool(input: {
  serverId: string;
  reported: McpReportedTool;
  call: (args: Record<string, unknown>, user: AgentUser, runtime?: RuntimeContext) => Promise<unknown>;
}): McpBridgedTool {
  const reportedName = input.reported.name;
  if (typeof reportedName !== "string" || !reportedName) {
    throw new Error(`bridgeMcpTool[${input.serverId}]: 上报名为空`);
  }
  const stableName = buildMcpToolName(input.serverId, reportedName);
  // 歧义回读校验：稳定名必须**唯一**回读成 (本服务, 本上报名)。
  // 例：服务 s1 上报 "mcp__evil__x" 会拼出 mcp__s1__mcp__evil__x——按最长前缀
  // 规则它回读成服务 "s1__mcp" 的工具，归属对不上。此类名字宁可拒绝，
  // 也不能带着「注册时按另一套解析放行」的裂缝进注册表（裁决四）。
  const roundTrip = parseMcpToolName(stableName);
  if (!roundTrip || roundTrip.serverId !== input.serverId || roundTrip.reportedName !== reportedName) {
    throw new Error(`bridgeMcpTool[${input.serverId}]: 上报名产生歧义稳定名，拒绝桥接: ${reportedName}`);
  }
  const description = typeof input.reported.description === "string" ? input.reported.description : "";
  const parameters =
    input.reported.inputSchema && typeof input.reported.inputSchema === "object"
      ? (input.reported.inputSchema as Record<string, unknown>)
      : { type: "object", properties: {} };
  return {
    name: stableName,
    description,
    parameters,
    capability: "mcp:invoke" as Capability,
    mutates: true,
    // 裁决三：外发按构造赋值，不接受第三方输入。
    exfiltrates: true,
    category: "mcp",
    discoverable: false,
    source: "mcp",
    mcpServerId: input.serverId,
    mcpReportedName: reportedName,
    mcpDigest: computeMcpToolDigest(input.reported),
    execute: (args, user, runtime) => input.call(args ?? {}, user, runtime),
  };
}

// ============================================================
// 配置归一化（外部输入不可信：PATCH 载荷逐字段白名单收口）
// ============================================================

function clampTimeout(value: unknown): number {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return MCP_SERVER_DEFAULT_TIMEOUT_MS;
  return Math.min(MCP_SERVER_TIMEOUT_BOUNDS.max, Math.max(MCP_SERVER_TIMEOUT_BOUNDS.min, Math.round(ms)));
}

function isSafeUrl(value: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/** stdio 命令：白名单解释器或绝对路径（相对命令名除白名单外一律拒绝） */
function isAllowedCommand(value: string): boolean {
  if (!value) return false;
  if ((MCP_STDIO_COMMAND_ALLOWLIST as readonly string[]).includes(value)) return true;
  return value.startsWith("/");
}

/**
 * 放行条目归一化（不可信 JSON 的唯一入口；「放行了但没说给谁用」在这里就表示不出来）：
 *  · digest 必须是 32 位十六进制——形态不合即条目不可信，整条丢弃；
 *  · **allowedRoles 必须是 V2 角色名单的非空子集**——缺字段、空数组、全是不认识的角色
 *    同样整条丢弃。宁可回落「未放行」（该工具进不了注入集），也不存在「已放行但对
 *    全体角色可见」这条中间态：后者对本批的第三方工具就是提权。
 *  · approvedBy **允许为空**：页面新增放行时不带操作人，由 usecase 在服务端按 JWT 可信
 *    身份盖章（updateMcpConfigDraft 落章后这里再也不会见到空值）。
 */
function normalizeApprovedTools(input: unknown): Record<string, McpToolApproval> {
  const out: Record<string, McpToolApproval> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const [name, raw] of Object.entries(input as Record<string, unknown>)) {
    if (typeof name !== "string" || !name) continue;
    const entry = (raw || {}) as Partial<McpToolApproval>;
    const digest = String(entry.digest ?? "").trim();
    if (!/^[0-9a-f]{32}$/.test(digest)) continue; // 摘要形态不合 = 条目不可信，丢弃
    const allowedRoles = canonicalRoleOrder(
      Array.isArray(entry.allowedRoles)
        ? entry.allowedRoles.map((role) => (typeof role === "string" ? role.trim() : ""))
        : [],
    );
    if (allowedRoles.length === 0) continue; // 无角色 = 没说放行给谁，丢弃（不是「放行给所有人」）
    out[name] = {
      digest,
      allowedRoles: allowedRoles as [V2Role, ...V2Role[]], // 上一行已实证非空
      approvedBy: String(entry.approvedBy ?? "").trim().slice(0, 64),
      approvedAt: String(entry.approvedAt ?? "").trim().slice(0, 64),
    };
  }
  return out;
}

export function normalizeMcpServerEntry(input: unknown): McpServerEntry | null {
  const source = (input || {}) as Partial<McpServerEntry>;
  const id = String(source.id ?? "").trim();
  if (!MCP_SERVER_ID_PATTERN.test(id)) return null;
  const transport = (MCP_TRANSPORTS as readonly string[]).includes(String(source.transport))
    ? (source.transport as McpTransport)
    : null;
  if (!transport) return null;
  const url = String(source.url ?? "").trim();
  const command = String(source.command ?? "").trim();
  if (transport === "http" && !isSafeUrl(url)) return null;
  if (transport === "stdio" && !isAllowedCommand(command)) return null;
  const args = Array.isArray(source.args)
    ? source.args.filter((arg): arg is string => typeof arg === "string").slice(0, 16)
    : [];
  const env: Record<string, string> = {};
  if (source.env && typeof source.env === "object" && !Array.isArray(source.env)) {
    for (const [key, value] of Object.entries(source.env as Record<string, unknown>)) {
      if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(key)) continue;
      if (key === MCP_CREDENTIAL_ENV_KEY) continue; // 凭据键保留：只可能来自 credentials 域注入
      if (typeof value !== "string") continue;
      env[key] = value.slice(0, 512);
    }
  }
  return {
    id,
    name: String(source.name ?? id).trim().slice(0, 64) || id,
    transport,
    url: transport === "http" ? url : "",
    authType: transport === "http" && source.authType === "bearer" ? "bearer" : "none",
    command: transport === "stdio" ? command : "",
    args,
    env,
    credentialScope: String(source.credentialScope ?? "").trim().slice(0, 96),
    timeoutMs: clampTimeout(source.timeoutMs),
    approvedTools: normalizeApprovedTools(source.approvedTools),
  };
}

export function createDefaultMcpConfig(): McpConfig {
  return { schemaVersion: 1, servers: [] };
}

export function normalizeMcpConfig(input: unknown): McpConfig {
  const source = (input || {}) as Partial<McpConfig>;
  const rawServers = Array.isArray(source.servers) ? source.servers : [];
  const servers: McpServerEntry[] = [];
  const seen = new Set<string>();
  for (const raw of rawServers.slice(0, MCP_SERVER_LIMIT)) {
    const entry = normalizeMcpServerEntry(raw);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    servers.push(entry);
  }
  return {
    schemaVersion: Number.isFinite(Number(source.schemaVersion)) ? Math.max(1, Number(source.schemaVersion)) : 1,
    servers,
  };
}

// ============================================================
// 变更轨迹 diff（字段级；放行名单逐工具记一条）
// ============================================================

const SERVER_FIELD_KEYS = ["name", "transport", "url", "authType", "command", "credentialScope", "timeoutMs"] as const;

function approvalSummary(entry: McpToolApproval | undefined): string {
  if (!entry) return "";
  return `${entry.approvedBy}@${entry.digest.slice(0, 8)}`;
}

export function diffMcpConfigs(prev: McpConfig, next: McpConfig): McpRevisionChange[] {
  const changes: McpRevisionChange[] = [];
  const prevServers = new Map(prev.servers.map((server) => [server.id, server]));
  const nextServers = new Map(next.servers.map((server) => [server.id, server]));
  const ids = Array.from(new Set([...prevServers.keys(), ...nextServers.keys()])).sort();
  for (const id of ids) {
    const before = prevServers.get(id);
    const after = nextServers.get(id);
    if (!before && after) {
      changes.push({ target: `server:${id}`, field: "server", from: "", to: "新增服务" });
    } else if (before && !after) {
      changes.push({ target: `server:${id}`, field: "server", from: "移除服务", to: "" });
      continue;
    } else if (!before || !after) {
      continue;
    } else {
      for (const field of SERVER_FIELD_KEYS) {
        if (String(before[field]) !== String(after[field])) {
          changes.push({ target: `server:${id}`, field, from: String(before[field]), to: String(after[field]) });
        }
      }
      if (stableStringify(before.args) !== stableStringify(after.args)) {
        changes.push({ target: `server:${id}`, field: "args", from: before.args.join(" "), to: after.args.join(" ") });
      }
    }
    const toolNames = Array.from(
      new Set([...Object.keys(before?.approvedTools ?? {}), ...Object.keys(after?.approvedTools ?? {})]),
    ).sort();
    for (const toolName of toolNames) {
      const from = approvalSummary(before?.approvedTools[toolName]);
      const to = approvalSummary(after?.approvedTools[toolName]);
      if (from !== to) {
        changes.push({ target: `server:${id}#${toolName}`, field: "approvedTool", from, to });
      }
    }
  }
  return changes;
}
