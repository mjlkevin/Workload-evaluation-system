// ============================================================
// 批次 7 · MCP 运行时接线层（配置读取 → 采集 → 注入快照）
// ============================================================
// 分层口径与工具策略一致：workbench-tool-loop 保持纯函数（mcpTools 由调用方取好传入），
// 本模块负责「读第六配置区 + 解析凭据 + 驱动连接管理器」，是 MCP 与存储/凭据域的唯一交界。
//
// 失败方向（裁决五，两条不互套）：
//  · 配置读不到（PG 挂）→ 抛错，调用方随 toolPolicy 同款处理（不能不知道规则就跑）；
//  · 服务连不上/超时 → 该服务本轮缺席，日志只记安全摘要（serverId + errorKind，
//    不转述第三方文本与底层报错原文）。

import type { AgentTool } from "../agent.types";
import type { McpServerEntry } from "../../types";
import { resolveActiveMcpConfig, loadMcpConfigStore } from "../../modules/system/system.repository";
import { getApiKey } from "../../modules/system/credentials.store";
import { collectMcpInjectableTools, freshList, resetMcpSessions, type McpCollectOutcome } from "./mcp-manager";
import { computeMcpToolDigest, isMcpToolApproved, type McpReportedTool } from "./mcp-bridge";

async function resolveCredential(scope: string): Promise<string> {
  if (!scope) return "";
  const result = await getApiKey(scope);
  return result.apiKey;
}

export type McpTurnSnapshot = {
  /** 本回合可注入的 MCP 工具（已放行 + 摘要复验通过 + 命名守卫在 attach 时二次把关） */
  tools: AgentTool[];
  outcomes: McpCollectOutcome[];
  /** 本地登记的服务展示名（id→name）；来自生效配置，不来自服务上报 */
  serverNames: Record<string, string>;
};

/**
 * 回合入口：读生效服务清单 → 逐服务现连现问 → 放行复验 → 产出注入快照。
 * 无生效服务时零开销直返（大多数部署形态下 MCP 缺席是常态，不应为它付连接成本）。
 */
export async function resolveActiveMcpTools(): Promise<McpTurnSnapshot> {
  const config = await resolveActiveMcpConfig();
  const serverNames = Object.fromEntries(config.servers.map((server) => [server.id, server.name]));
  if (config.servers.length === 0) return { tools: [], outcomes: [], serverNames };
  const result = await collectMcpInjectableTools(config.servers, { resolveCredential });
  for (const outcome of result.outcomes) {
    if (!outcome.ok) {
      // 只记安全摘要：第三方文本不进日志（日志不是模型上下文，但不必主动投毒）。
      console.warn(`[mcp] server=${outcome.serverId} absent-this-turn kind=${outcome.errorKind ?? "unknown"}`);
    }
  }
  return { tools: result.tools, outcomes: result.outcomes, serverNames };
}

export type McpProbeToolRow = {
  reportedName: string;
  stableName: string;
  description: string;
  inputSchema: Record<string, unknown> | null;
  digest: string;
  approvalStatus: "approved" | "not-approved" | "definition-changed";
  approvedBy?: string;
  approvedAt?: string;
  /** 放行清单存在该工具但当前定义已变：给出「当前摘要」供页面展示 diff */
  currentDigest: string;
};

export type McpProbeResult =
  | { ok: true; serverId: string; tools: McpProbeToolRow[] }
  | { ok: false; serverId: string; errorKind: string };

/**
 * 管理员「现问」通道（工具策略页放行前逐看 description/schema 用）。
 * 每次调用都真正连接并重取 tools/list——结果只回给调用方，**任何一层都不缓存**
 * （裁决一：出现「把 tools/list 结果存下来下次直接用」即本批失败）。
 * 每次现问后销毁该服务会话：探测通道与注入通道分开，探测异常不污染常驻会话池。
 */
export async function probeMcpServer(serverId: string, source: "draft" | "active" = "draft"): Promise<McpProbeResult> {
  const store = await loadMcpConfigStore();
  const config = source === "draft" ? store.draft : store.active;
  const server = config.servers.find((entry) => entry.id === serverId);
  if (!server) return { ok: false, serverId, errorKind: "not-configured" };
  try {
    const tools = await freshList(server, { resolveCredential });
    const rows = tools.map((tool) => probeRow(server, tool));
    return { ok: true, serverId, tools: rows };
  } catch (err) {
    const kind = (err as { mcpErrorKind?: string }).mcpErrorKind ?? "connect-failed";
    return { ok: false, serverId, errorKind: kind };
  } finally {
    await resetMcpSessions(serverId);
  }
}

function probeRow(server: McpServerEntry, tool: McpReportedTool): McpProbeToolRow {
  const digest = computeMcpToolDigest(tool);
  const decision = isMcpToolApproved(server.approvedTools, tool);
  const approvedEntry = server.approvedTools[tool.name];
  return {
    reportedName: tool.name,
    stableName: `mcp__${server.id}__${tool.name}`,
    description: tool.description ?? "",
    inputSchema: tool.inputSchema ?? null,
    digest,
    approvalStatus: decision.reason === "approved" ? "approved" : decision.reason === "definition-changed" ? "definition-changed" : "not-approved",
    ...(decision.reason === "approved" && approvedEntry
      ? { approvedBy: approvedEntry.approvedBy, approvedAt: approvedEntry.approvedAt }
      : {}),
    currentDigest: digest,
  };
}
