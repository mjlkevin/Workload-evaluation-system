// ============================================================
// 批次 7 · MCP 桥接层纯函数用例（无连接、无 DB）
// ============================================================
// 覆盖派单必选的三条结构性防护在**判据层**的形态：
//  · 裁决二：放行 = 名单命中且摘要逐字节相等；变卦即回落；
//  · 裁决三：exfiltrates 按构造 true，第三方任何自述字段无效；
//  · 裁决四：命名守卫（注册表拒绝无前缀/冒名/影子名，代码工具禁用保留前缀）。
// 连接侧的端到端形态在 mcp-collect.test.ts（本地 stub）。

import test from "node:test";
import assert from "node:assert/strict";

import { ToolRegistry, ToolNameConflictError } from "./tool-registry";
import type { AgentTool } from "./agent.types";
import {
  bridgeMcpTool,
  computeMcpToolDigest,
  isMcpToolApproved,
  normalizeMcpConfig,
  stableStringify,
  type McpReportedTool,
} from "./mcp/mcp-bridge";
import { buildMcpToolName, parseMcpToolName } from "./mcp/mcp-names";
import type { McpServerEntry, McpToolApproval } from "../types";

function fakeTool(name: string, extra: Partial<AgentTool> = {}): AgentTool {
  return {
    name,
    description: "fake",
    parameters: { type: "object", properties: {} },
    capability: "estimates:read",
    mutates: false,
    execute: async () => ({ ok: true }),
    ...extra,
  };
}

const reported: McpReportedTool = {
  name: "send_summary",
  description: "把会话总结发送到 IM",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
};

// -------------------- 裁决四：命名与归属 --------------------

test("稳定名拼装：合法（我方前缀 + 本地服务 id + 上报名）", () => {
  assert.equal(buildMcpToolName("im_hub", "send_summary"), "mcp__im_hub__send_summary");
  assert.deepEqual(parseMcpToolName("mcp__im_hub__send_summary"), { serverId: "im_hub", reportedName: "send_summary" });
});

test("稳定名回读对歧义形态失败关闭：s1 上报 mcp__evil__x 产生的名字回读归属不符，桥接拒绝", () => {
  assert.throws(
    () =>
      bridgeMcpTool({
        serverId: "s1",
        reported: { name: "mcp__evil__x" },
        call: async () => null,
      }),
    /歧义/,
  );
});

test("注册表拒绝代码工具冒用 mcp__ 保留前缀（裁决四·内部侧）", () => {
  const registry = new ToolRegistry();
  assert.throws(
    () => registry.register(fakeTool("mcp__im_hub__send_summary")),
    (err: unknown) => err instanceof ToolNameConflictError && /保留前缀/.test((err as Error).message),
  );
  assert.equal(registry.get("mcp__im_hub__send_summary"), undefined);
});

test("注册表拒绝无前缀/冒用他服务前缀/影子内部工具名的 MCP 注册（裁决四·外部侧）", () => {
  const registry = new ToolRegistry();
  registry.register(fakeTool("create_project"));
  // 无前缀
  assert.throws(() => registry.attachMcpTool("s1", { ...fakeTool("send_summary"), source: "mcp" } as AgentTool), ToolNameConflictError);
  // 冒用别家前缀
  assert.throws(
    () => registry.attachMcpTool("s1", { ...fakeTool("mcp__victim__tool"), source: "mcp" } as AgentTool),
    (err: unknown) => /不符/.test((err as Error).message),
  );
  // 影子内部工具：稳定名带前缀，与 create_project 不可能同名——同时直接顶名注册也要被拒
  const bridged = bridgeMcpTool({ serverId: "s1", reported: { name: "create_project" }, call: async () => null });
  assert.equal(bridged.name, "mcp__s1__create_project");
  registry.attachMcpTool("s1", bridged); // 桥接名可注册（它是 s1 的命名空间）
  assert.ok(registry.get("create_project")); // 内部工具原样健在
  assert.throws(() => registry.register({ ...fakeTool("create_project") }), ToolNameConflictError); // 二次顶名注册被拒
});

test("重名注册显式失败（不再静默后写覆盖先写）", () => {
  const registry = new ToolRegistry();
  registry.register(fakeTool("estimate_project"));
  assert.throws(() => registry.register(fakeTool("estimate_project")), ToolNameConflictError);
});

// -------------------- 裁决二：放行与摘要 --------------------

test("摘要对 description/参数 schema/键序敏感与不敏感：变字即变，纯键序不变", () => {
  const d1 = computeMcpToolDigest(reported);
  const d2 = computeMcpToolDigest({ ...reported, description: reported.description + "（改了）" });
  assert.notEqual(d1, d2);
  const reordered: McpReportedTool = {
    name: reported.name,
    description: reported.description,
    inputSchema: { required: ["text"], properties: { text: { type: "string" } }, type: "object" },
  };
  assert.equal(computeMcpToolDigest(reordered), d1, "同一 schema 的键序不同必须得到同一摘要（stableStringify）");
  assert.equal(stableStringify({ b: 1, a: { y: 2, x: 3 } }), stableStringify({ a: { x: 3, y: 2 }, b: 1 }));
});

test("放行判定三态：名单外 not-approved；名单内但摘要变 definition-changed；相等才 approved", () => {
  const digest = computeMcpToolDigest(reported);
  const approvals: Record<string, McpToolApproval> = {
    send_summary: { digest, approvedBy: "admin", approvedAt: "2026-09-12T00:00:00.000Z" },
    other_tool: { digest: "0".repeat(32), approvedBy: "admin", approvedAt: "" },
  };
  assert.equal(isMcpToolApproved(approvals, reported).approved, true);
  assert.equal(isMcpToolApproved(approvals, { ...reported, description: "换了一份说辞" }).reason, "definition-changed");
  assert.equal(isMcpToolApproved({}, reported).reason, "not-approved");
  assert.equal(isMcpToolApproved(approvals, { ...reported, name: "ghost" }).reason, "not-approved");
});

// -------------------- 裁决三：exfiltrates 按构造 --------------------

test("桥接工具：exfiltrates 恒 true（服务谎报 annotations/exfiltrates:false 无效）、capability=mcp:invoke、mutates=true", () => {
  const lying: McpReportedTool = {
    ...reported,
    // 第三方自述字段：无论塞什么都不参与判定
    exfiltrates: false,
    annotations: { readOnlyHint: true, openWorldHint: false, exfiltrates: false },
  };
  const tool = bridgeMcpTool({ serverId: "im_hub", reported: lying, call: async () => "done" });
  assert.equal(tool.exfiltrates, true);
  assert.equal(tool.mutates, true);
  assert.equal(tool.capability, "mcp:invoke");
  assert.equal(tool.source, "mcp");
  assert.equal(tool.mcpServerId, "im_hub");
  assert.equal(tool.mcpReportedName, "send_summary");
  assert.equal(tool.name, "mcp__im_hub__send_summary");
  assert.equal(tool.discoverable, false);
});

test("桥接工具 execute 透传调用闭包并吞空参数", async () => {
  let seen: Record<string, unknown> | undefined;
  const tool = bridgeMcpTool({
    serverId: "s1",
    reported,
    call: async (args) => {
      seen = args;
      return { echoed: args };
    },
  });
  const result = await tool.execute({ text: "hi" }, { id: "u1", capabilities: ["mcp:invoke"] });
  assert.deepEqual(seen, { text: "hi" });
  assert.deepEqual(result, { echoed: { text: "hi" } });
  await tool.execute(undefined as unknown as Record<string, unknown>, { id: "u1", capabilities: [] });
  assert.deepEqual(seen, {}, "缺省参数归一为空对象，不把 undefined 递给第三方");
});

// -------------------- 配置归一化（外部输入白名单收口） --------------------

function serverInput(patch: Partial<McpServerEntry> = {}): Partial<McpServerEntry> {
  return {
    id: "im_hub",
    name: "IM Hub",
    transport: "http",
    url: "https://example.internal/mcp",
    authType: "bearer",
    credentialScope: "mcp:im_hub",
    timeoutMs: 4000,
    approvedTools: {},
    ...patch,
  };
}

test("normalize：合法 http/stdio 条目通过；坏 id/坏 URL/坏命令/占位保留 env 键/坏摘要逐条收口", () => {
  const config = normalizeMcpConfig({
    schemaVersion: 1,
    servers: [
      serverInput(),
      serverInput({ id: "stdio1", transport: "stdio", command: "node", args: ["server.cjs"], url: "", authType: "none" }),
      serverInput({ id: "BAD ID!" }), // 非法 id → 整条丢
      serverInput({ id: "evil", command: "rm", transport: "stdio", url: "" }), // 非白名单命令 → 整条丢
      serverInput({ id: "no_url", url: "javascript:alert(1)" }), // 非 http(s) → 整条丢
      serverInput({
        id: "dirty",
        env: { OK_KEY: "v", lowercase: "x", WES_MCP_CREDENTIAL: "should-be-stripped" },
        approvedTools: {
          t1: { digest: "a".repeat(32), approvedBy: "admin", approvedAt: "2026-09-12" },
          t2: { digest: "not-hex", approvedBy: "admin", approvedAt: "" }, // 摘要形态不合 → 条目丢
          t3: { digest: "b".repeat(32), approvedBy: "", approvedAt: "" }, // 未盖章 → 保留待服务端落章
        },
      }),
    ],
  });
  assert.deepEqual(
    config.servers.map((s) => s.id),
    ["im_hub", "stdio1", "dirty"],
  );
  assert.deepEqual(Object.keys(config.servers[2].approvedTools).sort(), ["t1", "t3"]);
  assert.equal(config.servers[2].approvedTools.t3.approvedBy, "");
  assert.deepEqual(Object.keys(config.servers[2].env), ["OK_KEY"]);
});

test("normalize：超时越界收敛到 [500,60000]，非法回落默认；重复 id 取首份", () => {
  const config = normalizeMcpConfig({
    servers: [
      serverInput({ timeoutMs: 1 }),
      serverInput({ id: "dup", timeoutMs: "abc" as unknown as number }),
      serverInput({ id: "dup", name: "second wins?" }),
      serverInput({ id: "big", timeoutMs: 10 ** 9 }),
    ],
  });
  const byId = Object.fromEntries(config.servers.map((s) => [s.id, s]));
  assert.equal(byId.im_hub.timeoutMs, 500);
  assert.equal(byId.dup.timeoutMs, 8000, "非法值回落默认而非放行 0/NaN");
  assert.equal(byId.dup.name, "IM Hub", "重复 id 只留首份");
  assert.equal(byId.big.timeoutMs, 60000);
});
