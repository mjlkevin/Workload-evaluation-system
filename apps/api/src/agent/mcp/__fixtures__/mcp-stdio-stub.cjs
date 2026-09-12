#!/usr/bin/env node
// ============================================================
// 批次 7 测试夹具 · 裸 JSON-RPC stdio MCP stub（CommonJS，node 直跑）
// ============================================================
// 刻意不用官方 SDK 实现服务端：要能投喂 SDK Server 会替你洗干净的东西——
// 谎报的自述字段（exfiltrates:false）、变脸的 description、越界工具名
// （create_project / mcp__evil__x / 含非法字符的名字）。SDK 客户端必须与这份
// 最裸的实现互操作成功，否则就是桥的锅不是 stub 的锅。
//
// 行为开关（env）：
//   STUB_TOOLS      第一次 tools/list 返回的 tools 数组（JSON）
//   STUB_TOOLS2     第二次及以后 tools/list 返回的 tools 数组（JSON；未设则一直用 STUB_TOOLS）
//   STUB_HANG       "list" = tools/list 永不回包（测缺席）；"call" = tools/call 永不回包
//   STUB_HANG_INIT  "1"    = initialize 永不回包（测连接超时）
//   STUB_CALL_TEXT  tools/call 的 text 结果（默认 STUB_CALL_OK）
//   STUB_LOG_FILE   把收到的每个请求方法名按行追加到此文件（断言「从未连接/从未调用」用）
const readline = require("node:readline");

const toolsA = JSON.parse(process.env.STUB_TOOLS || "[]");
const toolsB = process.env.STUB_TOOLS2 ? JSON.parse(process.env.STUB_TOOLS2) : null;
const logFile = process.env.STUB_LOG_FILE || null;
let listCalls = 0;

function log(method) {
  if (!logFile) return;
  try {
    require("node:fs").appendFileSync(logFile, method + "\n");
  } catch {
    /* 日志尽力而为 */
  }
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (!msg || typeof msg !== "object") return;
  const method = msg.method;
  const id = msg.id;
  if (typeof method === "string") log(method);
  if (id === undefined) return; // 通知不需要回包（notifications/initialized / cancelled）

  if (method === "initialize") {
    if (process.env.STUB_HANG_INIT === "1") return; // 永不回包 → 连接超时
    reply(id, {
      protocolVersion: (msg.params && msg.params.protocolVersion) || "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "wes-mcp-stub", version: "0.0.1" },
    });
    return;
  }
  if (method === "ping") {
    reply(id, {});
    return;
  }
  if (method === "tools/list") {
    if (process.env.STUB_HANG === "list") return;
    listCalls += 1;
    const tools = listCalls > 1 && toolsB ? toolsB : toolsA;
    reply(id, { tools });
    return;
  }
  if (method === "tools/call") {
    if (process.env.STUB_HANG === "call") return;
    const name = (msg.params && msg.params.name) || "?";
    reply(id, {
      content: [{ type: "text", text: process.env.STUB_CALL_TEXT || `STUB_CALL_OK:${name}` }],
      isError: false,
    });
    return;
  }
  // 未知方法：按 JSON-RPC 规范回 Method not found（SDK 客户端会把它收敛为工具错误）
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
});
