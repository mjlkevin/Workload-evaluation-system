// ============================================================
// 批次 7 · MCP 连接管理器（运行时会话池 + 每回合现问清单）
// ============================================================
// 与裁决一/二/五的对齐方式（代码结构保证，不是注释声明）：
//  · 池里缓存的是**连接会话**，永远不是工具清单——collect 每次都对新连上的
//    服务现发 tools/list（freshList），清单不落池、不落库；
//  · 放行判定（approval + digest 复验）发生在每次 collect 内，第三方改了
//    description/schema 即回落未放行，不需要任何人“发现”它改了；
//  · 连接/列表失败 ⇒ 该服务本轮缺席（error 吞成 outcome），其余服务与对话照常；
//    失败时销毁会话，下一回合重连——绝不拿上回合的清单顶上。
// 超时全部显式（连接 / 列工具 / 调用三处同一 server.timeoutMs），不依赖 SDK 默认。

import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServerEntry } from "../../types";
import { MCP_CREDENTIAL_ENV_KEY } from "../../types";
import {
  bridgeMcpTool,
  isMcpToolApproved,
  stableStringify,
  type McpBridgedTool,
  type McpReportedTool,
} from "./mcp-bridge";
import { MCP_REPORTED_NAME_PATTERN } from "./mcp-names";
import type { AgentUser } from "../agent.types";
import type { RuntimeContext } from "../context/context.types";

/** 单服务单次上报的工具数封顶：病态服务不得用万条工具撑爆上下文 */
export const MCP_TOOL_LIMIT_PER_SERVER = 100;
/** description 进模型上下文前的长度上限（第三方撰写文本的注入面裁剪） */
export const MCP_TOOL_DESCRIPTION_MAX_CHARS = 2000;

export type McpCollectOutcome = {
  serverId: string;
  serverName: string;
  ok: boolean;
  /** 失败时的粗粒度类别（不转述底层报错原文：其中可能带 URL/凭据痕迹） */
  errorKind?: "connect-timeout" | "connect-failed" | "list-timeout" | "list-failed" | "no-credential" | "bad-config";
  reportedCount: number;
  approvedCount: number;
  /** 被放行名单挡下的工具摘要（呈现「未放行/定义已变」用，不含第三方文本） */
  pending: Array<{ reportedName: string; digest: string; reason: "not-approved" | "definition-changed" | "invalid-name" }>;
};

export type McpCollectResult = {
  tools: McpBridgedTool[];
  outcomes: McpCollectOutcome[];
};

export type McpCollectOptions = {
  /** 解析 credentials 域 scope → 真实密钥；抛错/返回空视为无凭据（该服务缺席，不放行猜测） */
  resolveCredential?: (scope: string) => Promise<string>;
};

type Session = {
  client: Client;
  close: () => Promise<void>;
  fingerprint: string;
  timeoutMs: number;
};

const sessions = new Map<string, Session>();

/** 会话指纹：连接形态变（换地址/换命令/换凭据引用）即重连；不含任何凭据值 */
function serverFingerprint(server: McpServerEntry): string {
  const canonical = stableStringify({
    transport: server.transport,
    url: server.url,
    authType: server.authType,
    command: server.command,
    args: server.args,
    credentialScope: server.credentialScope,
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error("mcp-timeout"));
    }, Math.max(1, ms));
    timer.unref?.();
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer)) as Promise<T>;
}

async function openSession(server: McpServerEntry, resolveCredential: (scope: string) => Promise<string>): Promise<Session> {
  const client = new Client(
    { name: "wes-workbench-mcp-client", version: "1.0.0" },
    { capabilities: {} },
  );
  const close: () => Promise<void> = async () => {
    await client.close().catch(() => undefined);
  };
  if (server.transport === "http") {
    let token = "";
    if (server.authType === "bearer") {
      if (!server.credentialScope) throw new Error("mcp-bad-config");
      token = (await resolveCredential(server.credentialScope)).trim();
      if (!token) throw new Error("mcp-no-credential");
    }
    const transport = new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
    });
    await withTimeout(client.connect(transport), server.timeoutMs, () => void close());
    return { client, close, fingerprint: serverFingerprint(server), timeoutMs: server.timeoutMs };
  }
  const env: Record<string, string> = { ...getDefaultEnvironment(), ...server.env };
  if (server.credentialScope) {
    const token = (await resolveCredential(server.credentialScope)).trim();
    if (!token) throw new Error("mcp-no-credential");
    env[MCP_CREDENTIAL_ENV_KEY] = token;
  }
  const transport = new StdioClientTransport({ command: server.command, args: server.args, env });
  let settled = false;
  const hardClose = async () => {
    if (settled) return;
    settled = true;
    await transport.close().catch(() => undefined);
    await client.close().catch(() => undefined);
  };
  try {
    await withTimeout(client.connect(transport), server.timeoutMs, () => void hardClose());
  } catch (err) {
    await hardClose();
    throw err;
  }
  return {
    client,
    close: hardClose,
    fingerprint: serverFingerprint(server),
    timeoutMs: server.timeoutMs,
  };
}

async function getSession(server: McpServerEntry, resolveCredential: (scope: string) => Promise<string>): Promise<Session> {
  const fingerprint = serverFingerprint(server);
  const existing = sessions.get(server.id);
  if (existing && existing.fingerprint === fingerprint) return existing;
  if (existing) {
    await existing.close().catch(() => undefined);
    sessions.delete(server.id);
  }
  const opened = await openSession(server, resolveCredential);
  sessions.set(server.id, opened);
  return opened;
}

async function dropSession(serverId: string): Promise<void> {
  const session = sessions.get(serverId);
  if (!session) return;
  sessions.delete(serverId);
  await session.close().catch(() => undefined);
}

/** 上报工具形状把关：名不合字符集/缺名 → invalid；描述与 schema 收窄为可桥接形状 */
export function sanitizeReportedTools(raw: unknown): { tools: McpReportedTool[]; invalidNames: string[] } {
  const list = Array.isArray((raw as { tools?: unknown })?.tools) ? (raw as { tools: unknown[] }).tools : [];
  const tools: McpReportedTool[] = [];
  const invalidNames: string[] = [];
  for (const item of list.slice(0, MCP_TOOL_LIMIT_PER_SERVER)) {
    const candidate = (item || {}) as Record<string, unknown>;
    const name = typeof candidate.name === "string" ? candidate.name : "";
    if (!name || !MCP_REPORTED_NAME_PATTERN.test(name)) {
      invalidNames.push(typeof candidate.name === "string" ? candidate.name.slice(0, 80) : "<non-string>");
      continue;
    }
    const description =
      typeof candidate.description === "string" ? candidate.description.slice(0, MCP_TOOL_DESCRIPTION_MAX_CHARS) : "";
    const inputSchema =
      candidate.inputSchema && typeof candidate.inputSchema === "object" && !Array.isArray(candidate.inputSchema)
        ? (candidate.inputSchema as Record<string, unknown>)
        : undefined;
    tools.push({ name, description, inputSchema });
  }
  return { tools, invalidNames };
}

/** 现问单个服务的工具清单（每次调用都发 tools/list；失败抛错由上层吞成缺席） */
export async function freshList(server: McpServerEntry, options: McpCollectOptions = {}): Promise<McpReportedTool[]> {
  const resolveCredential = options.resolveCredential ?? (async () => "");
  let session: Session;
  try {
    session = await getSession(server, resolveCredential);
  } catch (err) {
    await dropSession(server.id);
    throw classify(err, "connect");
  }
  try {
    const result = await withTimeout(session.client.listTools(), session.timeoutMs, () => void dropSession(server.id));
    return sanitizeReportedTools(result).tools;
  } catch (err) {
    await dropSession(server.id);
    throw classify(err, "list");
  }
}

/** 包装错误并保留 cause（本仓 target ES2020，Error 构造器不带 ErrorOptions） */
function wrapMcpError(message: string, cause: unknown): Error {
  const error = new Error(message) as Error & { cause?: unknown };
  error.cause = cause;
  return error;
}

function classify(err: unknown, phase: "connect" | "list"): Error & { mcpErrorKind?: string } {
  const wrapped = new Error(`mcp-${phase}-failed`) as Error & { mcpErrorKind?: string };
  const message = err instanceof Error ? err.message : String(err);
  wrapped.mcpErrorKind = message === "mcp-timeout" ? `${phase}-timeout`
    : message === "mcp-no-credential" ? "no-credential"
    : message === "mcp-bad-config" ? "bad-config"
    : `${phase}-failed`;
  return wrapped;
}

/**
 * 回合级采集：对显式允许清单里的每个服务现连现问，产出「本回合注入集」快照。
 * 单服务失败只影响它自己（裁决五）；清单为空/全挂 ⇒ tools=[]，对话照常。
 */
export async function collectMcpInjectableTools(
  servers: readonly McpServerEntry[],
  options: McpCollectOptions = {},
): Promise<McpCollectResult> {
  const resolveCredential = options.resolveCredential ?? (async () => "");
  const results = await Promise.all(
    servers.map(async (server): Promise<McpCollectResult> => {
      const outcome: McpCollectOutcome = {
        serverId: server.id,
        serverName: server.name,
        ok: false,
        reportedCount: 0,
        approvedCount: 0,
        pending: [],
      };
      let reported: McpReportedTool[];
      try {
        reported = await freshList(server, { resolveCredential });
      } catch (err) {
        outcome.errorKind = ((err as { mcpErrorKind?: string }).mcpErrorKind ?? "connect-failed") as McpCollectOutcome["errorKind"];
        return { tools: [], outcomes: [outcome] };
      }
      outcome.ok = true;
      outcome.reportedCount = reported.length;
      const tools: McpBridgedTool[] = [];
      for (const tool of reported) {
        const decision = isMcpToolApproved(server.approvedTools, tool);
        if (!decision.approved) {
          outcome.pending.push({ reportedName: tool.name, digest: decision.digest, reason: decision.reason });
          continue;
        }
        try {
          tools.push(bridgeMcpTool({
            serverId: server.id,
            reported: tool,
            allowedRoles: decision.allowedRoles,
            call: async (args: Record<string, unknown>, _user: AgentUser, _runtime?: RuntimeContext) => {
              // 执行绑定活会话；会话坏了即抛错（本轮该服务余下调用都会失败并回填
              // ok:false），绝不重连重放——副作用不可靠重放第二遍。
              const current = sessions.get(server.id);
              if (!current || current.fingerprint !== serverFingerprint(server)) {
                throw new Error(`MCP 服务 ${server.id} 连接已断开，本次调用未执行`);
              }
              try {
                return await withTimeout(
                  current.client.callTool({ name: tool.name, arguments: args }),
                  current.timeoutMs,
                  () => void dropSession(server.id),
                );
              } catch (err) {
                await dropSession(server.id);
                const timeout = err instanceof Error && err.message === "mcp-timeout";
                throw wrapMcpError(
                  timeout ? `MCP 工具 ${tool.name} 执行超时，本次调用结果未知` : `MCP 工具 ${tool.name} 执行失败`,
                  err,
                );
              }
            },
          }));
        } catch {
          // 桥接拒绝（歧义稳定名等命名攻击形态）：只挡这一把工具，服务其余工具照常。
          outcome.pending.push({ reportedName: tool.name, digest: decision.digest, reason: "invalid-name" });
        }
      }
      outcome.approvedCount = tools.length;
      return { tools, outcomes: [outcome] };
    }),
  );
  return {
    tools: results.flatMap((r) => r.tools),
    outcomes: results.flatMap((r) => r.outcomes),
  };
}

/** 配置生效/测试收尾用：销毁全部会话（下一回合起按新配置重连） */
export async function resetMcpSessions(serverId?: string): Promise<void> {
  if (serverId) {
    await dropSession(serverId);
    return;
  }
  const ids = Array.from(sessions.keys());
  for (const id of ids) await dropSession(id);
}

export function mcpSessionCountForTest(): number {
  return sessions.size;
}
