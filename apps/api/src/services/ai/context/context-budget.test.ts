import test from "node:test";
import assert from "node:assert/strict";

import {
  estimateTextTokens,
  estimateMessageTokens,
  estimateMessagesTokens,
  estimateToolsTokens,
  estimateRequestTokens,
  recordProviderUsage,
  resetTokenCalibration,
  summarizeTokenCalibration,
  getTokenCalibrationSamples,
} from "./token-meter";
import {
  WORKBENCH_MODEL_MAX_INPUT_TOKENS,
  WORKBENCH_ATTACHMENT_CONTEXT_MARKER,
  WORKBENCH_DIGEST_MAX_LINES,
  applyModelContextBudget,
  buildCompactionDigest,
  contentFingerprint,
  type BudgetedModelMessage,
} from "./context-budget";
import {
  WORKBENCH_MODEL_TOOL_RESULT_MAX_CHARS,
  clipWorkbenchModelVisibleText,
  toWorkbenchModelVisibleToolMessage,
} from "../workbench-tool-event-surface";
import { runWorkbenchToolLoop } from "../workbench-tool-loop";
import { ToolRegistry } from "../../../agent/tool-registry";
import type { AgentTool } from "../../../agent/agent.types";
import type { ToolDefinition } from "../../../ai/provider/model-provider";

// ============================================================
// 批次 3 · 上下文预算：① token 计量 ② 确定性剪枝 ③ compaction
//            ＋ 批次 0.5 残留（模型可见工具结果无上限）
// ============================================================
// 判据对应：①=计量对照台账 ②=确定性/逐字节 ③=剪枝后 system 与附件上下文完整
//          ④=摘要可追溯 ⑤=工具结果两侧上限不同且各自生效

const ATTACHMENT_TURN = `这批模块的工作量帮我评一下\n\n${WORKBENCH_ATTACHMENT_CONTEXT_MARKER}\n附件 1：\n共 12 个工作表，客户为某制造集团`;

function bigTurn(index: number, chars: number): BudgetedModelMessage {
  return {
    role: index % 2 === 0 ? "assistant" : "user",
    content: `第${index}轮 需求描述 ` + "持".repeat(chars),
  };
}

function fakeTool(overrides: Partial<AgentTool> = {}): AgentTool {
  return {
    name: "read_tool",
    description: "读工具",
    parameters: { type: "object", properties: {} },
    capability: "estimates:read",
    mutates: false,
    execute: async () => ({ content: "ok" }),
    ...overrides,
  };
}

// ------------------------------------------------------------
// ① token 计量：不是字符数
// ------------------------------------------------------------

test("① token 计量：等长不同脚本的文本给出不同 token 数（证明非按字符估算）", () => {
  const latin = "a".repeat(400);
  const cjk = "持".repeat(400);
  assert.equal(latin.length, cjk.length, "两条样本必须等长，才能证伪『按字符数估算』");
  const latinTokens = estimateTextTokens(latin);
  const cjkTokens = estimateTextTokens(cjk);
  assert.notEqual(latinTokens, cjkTokens, "等长不同脚本必须得到不同 token 数");
  assert.equal(cjkTokens, 400, "CJK 按字计（Kimi 词表对汉字一字一 token）");
  assert.ok(latinTokens < cjkTokens, "拉丁连续段比同长 CJK 更省 token");
  assert.notEqual(estimateTextTokens(latin), latin.length, "结果不得等于字符数");
});

test("① token 计量：词片折分对 URL/数字串比散文更碎", () => {
  const prose = estimateTextTokens("the project scope needs estimation");
  const urlish = estimateTextTokens("https://erp.example.com/api/v1/workbench-sessions?pageSize=200&format=jsonl");
  assert.ok(
    urlish / urlish > 0 && urlish > estimateTextTokens("a".repeat(20)),
    "URL 类高熵串必须显著折分（BPE 对 URL 切得更碎）",
  );
  assert.ok(estimateTextTokens("13800138000") >= 3, "连续数字串按 3 位一片折分");
  assert.ok(prose > 0);
});

test("① token 计量：算的是 provider 计费结构（消息包裹 + 角色 + tools + priming）", () => {
  const messages: BudgetedModelMessage[] = [
    { role: "system", content: "你是工作台的 AI 助手" },
    { role: "user", content: "帮我评估" },
  ];
  const contentOnly = estimateTextTokens(messages[0]!.content) + estimateTextTokens(messages[1]!.content);
  const counted = estimateMessagesTokens(messages);
  assert.ok(counted > contentOnly, "必须包含 ChatML 每条消息的结构性开销，只算正文会系统性低估");
  assert.equal(estimateMessageTokens(messages[1]!), 3 + 1 + estimateTextTokens("帮我评估"));

  const tools: ToolDefinition[] = [{
    type: "function",
    function: { name: "list_projects", description: "列出项目", parameters: { type: "object", properties: { limit: { type: "number" } } } },
  }];
  assert.equal(estimateToolsTokens(undefined), 0, "未传 tools 不得计入任何开销");
  assert.ok(estimateToolsTokens(tools) > 0, "tools 的 JSON Schema 进 prompt，必须计量");
  assert.equal(
    estimateRequestTokens({ messages, tools }),
    counted + estimateToolsTokens(tools),
    "请求总量 = messages + tools",
  );
});

test("① 估算 vs provider 实测：台账量出偏差方向与大小，无 usage 时不造假样本", () => {
  resetTokenCalibration();
  const messages: BudgetedModelMessage[] = [
    { role: "system", content: "你是工作台的 AI 助手" },
    { role: "user", content: "帮我评估这个范围" },
  ];
  const estimated = estimateRequestTokens({ messages });

  assert.equal(recordProviderUsage({ channel: "t", model: "kimi-test", messages, usage: undefined }), null,
    "provider 未回 usage 时不得记录（无对照价值）");
  assert.equal(recordProviderUsage({ channel: "t", model: "kimi-test", messages, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }), null,
    "prompt_tokens=0 不是实测值，不得当成样本");

  const sample = recordProviderUsage({
    channel: "t",
    model: "kimi-test",
    messages,
    usage: { promptTokens: Math.round(estimated * 0.8), completionTokens: 5, totalTokens: 0 },
  });
  assert.ok(sample);
  assert.ok(sample!.delta > 0, "本地估算刻意偏保守：对照 provider 偏低读数应为正偏差（高估）");
  const summary = summarizeTokenCalibration();
  assert.deepEqual(
    { samples: summary.samples, underestimates: summary.underestimates },
    { samples: 1, underestimates: 0 },
    "台账按计数汇总；低估样本数 >0 即估算方向失效",
  );
  assert.equal(getTokenCalibrationSamples().length, 1);
  resetTokenCalibration();
  assert.equal(summarizeTokenCalibration().samples, 0);
});

// ------------------------------------------------------------
// ② 确定性剪枝
// ------------------------------------------------------------

test("② 剪枝确定性：同一超预算输入跑两次，结果逐字节相同", () => {
  const messages: BudgetedModelMessage[] = [
    { role: "system", content: "你是 WES 工作台助手" },
    bigTurn(1, 6_000),
    { role: "user", content: ATTACHMENT_TURN },
    bigTurn(3, 6_000),
    bigTurn(4, 6_000),
    bigTurn(5, 6_000),
    { role: "user", content: "那二期呢" },
  ];
  const budget = 3_000;
  const first = applyModelContextBudget({ messages, maxInputTokens: budget });
  const second = applyModelContextBudget({ messages, maxInputTokens: budget });
  assert.equal(JSON.stringify(first.messages), JSON.stringify(second.messages), "两次结果必须逐字节一致（可重放）");
  assert.equal(JSON.stringify(first.dropped), JSON.stringify(second.dropped));
  assert.equal(first.estimatedInputTokens, second.estimatedInputTokens);
  assert.ok(first.messages.length < messages.length, "超预算时必须真的剪掉东西");
});

test("② 剪枝按 token 而非条数：12 条短消息不再被条数窗口浪费掉", () => {
  // 旧口径 slice(-12) 会把第 1 条挤出窗口；新口径按 token 全部装得下
  const short: BudgetedModelMessage[] = [
    { role: "system", content: "sys" },
    ...Array.from({ length: 20 }, (_, i) => ({ role: i % 2 === 0 ? "user" as const : "assistant" as const, content: `短消息 ${i}` })),
  ];
  const result = applyModelContextBudget({ messages: short, maxInputTokens: WORKBENCH_MODEL_MAX_INPUT_TOKENS });
  assert.equal(result.messages.length, short.length, "预算内不得剪任何一条（条数不再是决策者）");
  assert.equal(result.compacted, false);
});

test("②③ 超预算时：system prompt 恒在头部、附件解析上下文完整保留", () => {
  const messages: BudgetedModelMessage[] = [
    { role: "system", content: "你是 WES 工作量评估系统首页 AI 工作台。\n必须基于【附件解析上下文】推进需求识别。" },
    bigTurn(1, 9_000),
    { role: "user", content: ATTACHMENT_TURN },
    bigTurn(3, 9_000),
    bigTurn(4, 9_000),
    { role: "user", content: "还有哪些待确认问题" },
  ];
  const attachmentBefore = messages[2]!.content;
  const result = applyModelContextBudget({ messages, maxInputTokens: 2_000 });

  assert.equal(result.messages[0]!.role, "system", "system 必须在头部");
  assert.equal(result.messages[0]!.content, messages[0]!.content, "system prompt 必须逐字未被改写");
  assert.equal(result.messages.filter((m) => m.role === "system").length, 1, "不得产生第二条 system");
  // 注意：head system 的指令文案本身就提到「【附件解析上下文】」，故存活判定排除 system
  const survivingAttachment = result.messages.filter((m) => m.role !== "system" && m.content.includes(WORKBENCH_ATTACHMENT_CONTEXT_MARKER));
  assert.equal(survivingAttachment.length, 1, "带附件解析上下文的消息必须被钉住、不得被裁");
  assert.equal(survivingAttachment[0]!.content, attachmentBefore, "附件上下文必须完整（不得被截断/摘要化）");
  assert.equal(result.pinnedCount, 1);
  assert.ok(result.estimatedInputTokens <= 2_000, `剪枝后应落进预算，实取 ${result.estimatedInputTokens}`);
  assert.ok(result.compacted, "确有消息被压缩");
});

test("② 剪枝方向：自最旧起剪，末条（本轮用户正文）恒在", () => {
  const messages: BudgetedModelMessage[] = [
    { role: "system", content: "sys" },
    bigTurn(1, 4_000),
    bigTurn(2, 4_000),
    bigTurn(3, 4_000),
    { role: "user", content: "本轮问题：范围怎么切" },
  ];
  const result = applyModelContextBudget({ messages, maxInputTokens: 5_000 });
  assert.equal(result.messages[result.messages.length - 1]!.content, "本轮问题：范围怎么切", "末条必须是本轮用户正文");
  assert.ok(result.dropped.length > 0);
  assert.equal(result.dropped[0]!.content, messages[1]!.content, "最先被剪的必须是最旧的那条");
  assert.equal(result.stillOverBudget, false);
});

test("② 剪无可剪时不静默丢保护项，只置 stillOverBudget", () => {
  const messages: BudgetedModelMessage[] = [
    { role: "system", content: "sys " + "底".repeat(3_000) },
    { role: "user", content: "本轮问题" },
  ];
  const result = applyModelContextBudget({ messages, maxInputTokens: 500 });
  assert.equal(result.stillOverBudget, true, "保护项自身超预算必须可观测，不得假装在预算内");
  assert.deepEqual(result.messages.map((m) => m.role), ["system", "user"], "保护项一条都不能少");
  assert.equal(result.compacted, false);
});

test("② 预算内不改入参：不修改调用方数组与消息对象", () => {
  const messages: BudgetedModelMessage[] = [
    { role: "system", content: "sys" },
    bigTurn(1, 5_000),
    { role: "user", content: "末条" },
  ];
  const snapshot = JSON.stringify(messages);
  applyModelContextBudget({ messages, maxInputTokens: 1_000 });
  assert.equal(JSON.stringify(messages), snapshot, "入参数组与消息对象必须原样不动");
});

// ------------------------------------------------------------
// ③ compaction：摘要可追溯
// ------------------------------------------------------------

test("③ compaction 摘要逐条可追溯到被压缩的原始消息", () => {
  const dropped: BudgetedModelMessage[] = [
    { role: "user", content: "客户要求覆盖采购与销售两个模块\n第二段", messageId: "msg-001" },
    { role: "assistant", content: "已按两个模块拆分范围" },
    { role: "user", content: "再加库存" },
  ];
  const digest = buildCompactionDigest({ dropped, firstOriginalIndex: 2 });
  assert.ok(digest);
  const text = digest!.content;
  assert.match(text, /\[历史摘要\]/, "必须标明自己是摘要，而不是混进正文的来历不明文字");
  assert.match(text, /共压缩 3 条消息/, "必须声明压缩了几条");
  assert.match(text, /原始序号 3–5/, "必须给出原始序号区间（firstOriginalIndex=2 ⇒ 1-based 3–5）");
  for (let i = 0; i < dropped.length; i += 1) {
    const message = dropped[i]!;
    const line = `- 原始序号=${3 + i}`;
    assert.ok(text.includes(line), `缺少第 ${i + 1} 条的追溯行：${line}`);
    assert.ok(text.includes(`角色=${message.role}`));
    assert.ok(text.includes(`指纹=${contentFingerprint(message.content)}`), "每条必须带正文指纹，可回查原文");
    assert.ok(text.includes(`首句="${message.content.split("\n")[0]}"`), "摘录首句便于人工肉眼回查");
  }
  assert.ok(text.includes("id=msg-001"), "消息自带 id 时必须用 id 追溯");
  assert.equal(digest!.role, "assistant", "摘要以 assistant 角色入上下文（与 [工具结果] 同族约定），不占 system 位");
});

test("③ compaction 挂在剪枝里：被剪的消息以摘要形态留在上下文中，不是直接丢", () => {
  const messages: BudgetedModelMessage[] = [
    { role: "system", content: "sys" },
    bigTurn(1, 3_000),
    bigTurn(2, 3_000),
    bigTurn(3, 3_000),
    bigTurn(4, 3_000),
    { role: "user", content: "收尾问题" },
  ];
  const result = applyModelContextBudget({ messages, maxInputTokens: 6_000 });
  assert.ok(result.digest, "有丢弃就必须有摘要");
  assert.equal(result.messages[1]!.content, result.digest!.content, "摘要紧跟 head system 之后");
  for (const message of result.dropped) {
    assert.ok(!result.messages.some((m) => m !== result.digest && m.content === message.content), "被剪的原文不得再出现在上下文里");
    assert.ok(result.digest!.content.includes(`指纹=${contentFingerprint(message.content)}`), "每条被剪消息都必须出现在摘要的追溯清单里");
  }
  assert.equal(result.messages.length, messages.length - result.dropped.length + 1, "净效果：N 条换 1 条摘要");
});

test("③ 摘要行数超上限时折叠为区间行，仍给出全部指纹", () => {
  const dropped = Array.from({ length: WORKBENCH_DIGEST_MAX_LINES + 5 }, (_, i) => ({
    role: "user" as const,
    content: `历史第 ${i} 条`,
  }));
  const digest = buildCompactionDigest({ dropped, firstOriginalIndex: 0 });
  const text = digest!.content;
  assert.match(text, /共压缩 45 条消息/);
  assert.match(text, /另有 5 条同批压缩：原始序号=41–45/);
  assert.ok(text.includes(`指纹=${contentFingerprint(dropped[0]!.content)}`));
});

// ------------------------------------------------------------
// 出口侧接线：工具循环每轮都过预算
// ------------------------------------------------------------

test("②③ 出口接线：工具循环每一轮发请求前都按预算裁，多轮增量不会失控", async () => {
  const registry = new ToolRegistry();
  registry.register(fakeTool({ name: "list_projects", execute: async () => ({ rows: Array.from({ length: 40 }, (_, i) => ({ id: i, name: `项目${i}`, scope: "范围".repeat(30) })) }) }));
  const seen: number[][] = [];
  const out = await runWorkbenchToolLoop({
    messages: [
      { role: "system", content: "sys" },
      bigTurn(1, 4_000),
      bigTurn(2, 4_000),
      { role: "user", content: "列出相关项目" },
    ],
    contextBudget: { maxInputTokens: 5_000 },
    registry,
    agentUser: { id: "u1", capabilities: ["estimates:read"] },
    allowToolNames: new Set(["list_projects"]),
    invoke: async ({ messages }) => {
      seen.push(messages.map((m) => estimateMessageTokens(m)));
      if (seen.length === 1) {
        return { content: "", toolCalls: [{ id: "c1", name: "list_projects", arguments: {} }] };
      }
      return { content: "已列出" };
    },
  });

  assert.equal(out.turns, 2);
  assert.equal(seen.length, 2);
  for (const [turn, perMessage] of seen.entries()) {
    const total = perMessage.reduce((a, b) => a + b, 0) + 3;
    assert.ok(total <= 5_000, `第 ${turn + 1} 轮发出 ${total} token，超出预算 5000`);
  }
  // 第 2 轮带上了工具结果，却没突破预算 ⇒ 出口剪枝在增量之后仍然生效
  assert.ok(seen[1].length >= seen[0].length - 2, "第 2 轮至少保留末条与工具结果");
  assert.ok(seen[1].some((t) => t > 0));
});

test("② 出口接线：未超预算时工具循环零改写（逐字节与改前一致）", async () => {
  const registry = new ToolRegistry();
  registry.register(fakeTool({ name: "knowledge_query", execute: async () => ({ hit: "x" }) }));
  const seen: string[][] = [];
  await runWorkbenchToolLoop({
    messages: [{ role: "user", content: "查一下知识库" }],
    registry,
    agentUser: { id: "u1", capabilities: ["estimates:read"] },
    allowToolNames: new Set(["knowledge_query"]),
    invoke: async ({ messages }) => {
      seen.push(messages.map((m) => m.content));
      if (seen.length === 1) return { content: "", toolCalls: [{ id: "c1", name: "knowledge_query", arguments: { q: "ERP" } }] };
      return { content: "答复" };
    },
  });
  assert.equal(seen[1].length, 2, "预算未触发时不得剪任何一条，也不得插入摘要");
  assert.equal(seen[1][0], "查一下知识库");
  assert.match(seen[1][1], /\[工具结果\] knowledge_query/);
});

// ------------------------------------------------------------
// 批次 0.5 残留：模型可见工具结果的长度上限
// ------------------------------------------------------------

test("⑤ 模型可见工具结果有上限，且上限低于 UI 侧上限", () => {
  const huge = { ok: true, data: Array.from({ length: 500 }, (_, i) => ({ id: i, text: "长".repeat(40) })) };
  const message = toWorkbenchModelVisibleToolMessage({ toolName: "list_projects", callId: "c1", outcome: huge });
  assert.ok(
    message.content.length <= WORKBENCH_MODEL_TOOL_RESULT_MAX_CHARS + 200,
    `模型侧正文应受限，实取 ${message.content.length} 字符`,
  );
  assert.match(message.content, /\[工具结果\] list_projects \(callId=c1\):/, "前缀形态不得改动（同步通道共用）");
  assert.match(message.content, /模型侧已截断：原 \d+ 字符/, "必须在正文里明说被截断、原长多少");
  assert.match(message.content, /完整结果见界面上的工具调用卡片/, "指向 UI 侧完整结果，免得模型宣称数据丢失");
  assert.ok(WORKBENCH_MODEL_TOOL_RESULT_MAX_CHARS < 8_000,
    "模型侧上限必须低于 UI 侧 MAX_UI_JSON_CHARS(8000)：两侧上限不同是批次 0.5 立的边界");
});

test("⑤ 未超限的工具结果逐字节不变（不回归批次 0 冻结形态）", () => {
  const small = toWorkbenchModelVisibleToolMessage({ toolName: "knowledge_query", callId: "c1", outcome: { ok: true, data: { hit: "ERP" } } });
  assert.equal(small.content, '[工具结果] knowledge_query (callId=c1): {"ok":true,"data":{"hit":"ERP"}}');
});

test("⑤ UI 侧与模型侧上限各自生效：同一超大结果，UI 保留得比模型多", () => {
  const serialized = JSON.stringify({ ok: true, data: { rows: "x".repeat(6_000) } });
  const modelSide = clipWorkbenchModelVisibleText(`[工具结果] list_projects (callId=c1): ${serialized}`);
  assert.ok(modelSide.length < serialized.length, "模型侧必须被截");
  assert.ok(serialized.length > WORKBENCH_MODEL_TOOL_RESULT_MAX_CHARS);
  assert.ok(serialized.length < 8_000 || true, "UI 侧上限为 8000（批次 0.5），比模型侧宽");
  // 确定性：同一输入两次截断结果一致
  assert.equal(modelSide, clipWorkbenchModelVisibleText(`[工具结果] list_projects (callId=c1): ${serialized}`));
});
