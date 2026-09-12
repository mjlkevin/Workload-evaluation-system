// ============================================================
// 批次 7 · MCP 工具稳定命名（裁决四的单一实现点）
// ============================================================
// `mcp__<serverId>__<toolName>` 由**我方**拼装：serverId 取自本地配置（管理员登记），
// toolName 为服务上报名。第三方永远无法通过上报一个「像别人的名字」来顶掉内部工具
// 或别家服务的工具——前缀段永远是它自己的服务 id，注册守卫再按正则二次把关。

/** MCP 工具保留前缀：代码工具不得使用（ToolRegistry.register 强制） */
export const MCP_TOOL_PREFIX = "mcp__";

/** 服务 id 形态：小写字母数字开头，允许 -_，总长 ≤32。进稳定名前必须先过此关 */
export const MCP_SERVER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** 完整稳定名形态：前缀 + 合法服务 id + 上报名（限安全字符集，长度封顶防撑爆 provider 工具名上限） */
export const MCP_TOOL_FULL_NAME_PATTERN = /^mcp__([a-z0-9][a-z0-9_-]{0,31})__([A-Za-z0-9_.-]{1,64})$/;

/** 服务上报名的合法字符集（不合规的工具直接拒绝桥接，不做静默改名——改名会让放行摘要对不上号） */
export const MCP_REPORTED_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

export function buildMcpToolName(serverId: string, reportedName: string): string {
  if (!MCP_SERVER_ID_PATTERN.test(serverId)) {
    throw new Error(`MCP 服务 id 不合法: ${serverId}`);
  }
  if (!MCP_REPORTED_NAME_PATTERN.test(reportedName)) {
    throw new Error(`MCP 工具上报名不合法: ${reportedName}`);
  }
  const fullName = `${MCP_TOOL_PREFIX}${serverId}__${reportedName}`;
  if (!MCP_TOOL_FULL_NAME_PATTERN.test(fullName)) {
    throw new Error(`MCP 工具稳定名不合法: ${fullName}`);
  }
  return fullName;
}

/** 稳定名归属的服务 id；非法名返回 null（调用方拒绝，不猜测） */
export function parseMcpToolName(fullName: string): { serverId: string; reportedName: string } | null {
  const match = MCP_TOOL_FULL_NAME_PATTERN.exec(fullName);
  if (!match) return null;
  return { serverId: match[1], reportedName: match[2] };
}
