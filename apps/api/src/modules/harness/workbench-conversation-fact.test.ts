// ============================================================
// 批次 2b-2 · 对话事件「完整消息信封」约定模块单测（不连库）
// ============================================================
// 本模块是事件载荷与会话消息**同一份字段**的唯一持有者，因此它自己的失败模式
// 必须当场可见：信封丢了就是 executeStep 抛，而不是悄悄退回「载荷只剩正文」——
// 后者要等到 2b-3 换读取源才暴露，正是本批要避免的发现时机。
//
// 逐字节等价的真库证据在 workbench-conversation-events.e2e.test.ts（判据①）；
// 本文件锁的是形状与「缺信封即红」这两件确定性事实。

import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKBENCH_CONVERSATION_FACT_KEY,
  attachWorkbenchConversationFact,
  buildWorkbenchUserMessageFact,
  composeWorkbenchUserMessage,
  mintWorkbenchAssistantMessage,
  readWorkbenchConversationFact,
  workbenchAssistantProjectionSource,
  workbenchUserProjectionSource,
} from "./workbench-conversation-fact";

const ATTACHMENT = {
  name: "客户需求.xlsx",
  size: 4096,
  type: "application/xlsx",
  parsedSummary: "项目：蓝海制造",
};

test("mint：本轮身份字段一次生成，附件按提交顺序取得 att- 身份", () => {
  const fact = attachWorkbenchConversationFact({ content: "正文" }, [ATTACHMENT, { name: "补充.pdf" }]).fact;
  assert.ok(fact.userMessage.messageId.startsWith("msg-"), `实取 ${fact.userMessage.messageId}`);
  assert.equal(typeof fact.userMessage.createdAt, "string");
  assert.equal(fact.attachments.length, 2);
  assert.deepEqual(
    fact.attachments.map((item) => item.name),
    ["客户需求.xlsx", "补充.pdf"],
    "附件顺序即 attachmentIds 顺序，不得重排",
  );
  assert.ok(fact.attachments.every((item) => item.attachmentId.startsWith("att-")));
  assert.ok(fact.attachments.every((item) => item.createdAt === fact.userMessage.createdAt), "本轮同一时刻 mint");
});

test("mint：两次提交各自独立，不会复用同一 messageId", () => {
  const a = attachWorkbenchConversationFact({ content: "第一轮" }).fact;
  const b = attachWorkbenchConversationFact({ content: "第二轮" }).fact;
  assert.notEqual(a.userMessage.messageId, b.userMessage.messageId);
});

test("attach：信封写进 executionConfig，且不动既有键", () => {
  const { executionConfig } = attachWorkbenchConversationFact({ content: "正文", attachments: [ATTACHMENT] }, [ATTACHMENT]);
  assert.equal(executionConfig.content, "正文", "content 仍是正文的唯一来源");
  assert.ok(Array.isArray(executionConfig.attachments), "既有 attachments 键保持原样（展示字段）");
  assert.ok(executionConfig[WORKBENCH_CONVERSATION_FACT_KEY], "信封随 Run 持久化，重放才读得回同一份");
});

test("read：信封缺失或形状不对当场抛，不回落自造一份", () => {
  assert.throws(
    () => readWorkbenchConversationFact({ content: "正文" }),
    /conversationFact is required for workbench chat/,
    "缺信封=装配错误，必须红在写入侧，而不是留下一个只剩正文的事件",
  );
  assert.throws(
    () => readWorkbenchConversationFact({ [WORKBENCH_CONVERSATION_FACT_KEY]: { userMessage: { createdAt: "x" }, attachments: [] } }),
    /requires messageId and createdAt/,
  );
  assert.throws(
    () => readWorkbenchConversationFact({ [WORKBENCH_CONVERSATION_FACT_KEY]: { userMessage: { messageId: "m", createdAt: "c" } } }),
    /attachments must be an array/,
  );
});

test("read：mint → 持久化 → 读回 是同一份身份字段", () => {
  const { executionConfig, fact } = attachWorkbenchConversationFact({ content: "正文" }, [ATTACHMENT]);
  const viaDbShape = JSON.parse(JSON.stringify(executionConfig)); // jsonb 往返
  const read = readWorkbenchConversationFact(viaDbShape);
  assert.equal(read.userMessage.messageId, fact.userMessage.messageId);
  assert.equal(read.userMessage.createdAt, fact.userMessage.createdAt);
  assert.deepEqual(read.attachments, fact.attachments);
});

test("载荷 ≡ 会话侧将要落库的那条用户消息（同一份 compose + 同一来源键）", () => {
  const { fact } = attachWorkbenchConversationFact({ content: "正文" }, [ATTACHMENT, { name: "第二份.pdf" }]);
  const runId = "run-abc";
  const payload = buildWorkbenchUserMessageFact({ runId, fact, content: "正文" });
  // 会话侧真实落库 = workflow 交给 appendSessionMessage 的那份 + 仓储补的来源键
  // （表达式见 ai-sessions-pg.repository.ts:258-261，本用例用同一组合子复刻）。
  const stored = composeWorkbenchUserMessage({ fact, content: "正文" });
  assert.deepEqual(payload, {
    messageId: stored.messageId,
    role: "user",
    content: "正文",
    createdAt: stored.createdAt,
    attachmentIds: [fact.attachments[0].attachmentId, fact.attachments[1].attachmentId],
    metadata: { projectionSource: workbenchUserProjectionSource(runId) },
  });
});

test("来源键：用户轮与助手轮分别冻结，且始终随 runId 变化", () => {
  assert.deepEqual(workbenchUserProjectionSource("r1"), {
    deduplicationKey: "r1:user:1",
    runId: "r1",
    eventType: "user_message",
  });
  assert.deepEqual(workbenchAssistantProjectionSource("r1"), {
    deduplicationKey: "r1:assistant:1",
    runId: "r1",
    eventType: "assistant_message",
  });
  // retry 是新 Run ⇒ 新键（同正文的两轮因此在会话侧仍是两条，归并口径由 2b-3 处理）
  assert.notEqual(workbenchUserProjectionSource("r1").deduplicationKey, workbenchUserProjectionSource("r2").deduplicationKey);
});

test("助手信封：metadata 原样携带，role 固定 assistant，id 每次独立", () => {
  const metadata = { intent: "domain_qa", suggestedActions: [], trace: { routingRule: "mock" } };
  const first = mintWorkbenchAssistantMessage({ content: "答复", metadata });
  const second = mintWorkbenchAssistantMessage({ content: "答复", metadata });
  assert.equal(first.role, "assistant");
  assert.equal(first.content, "答复");
  assert.deepEqual(first.metadata, metadata, "metadata 不得被本模块改写或裁剪");
  assert.notEqual(first.messageId, second.messageId, "每次定稿各自一条");
});
