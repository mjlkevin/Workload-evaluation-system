// ============================================================
// 批次 2a · 会话历史派生缝（deriveSessionMessages）逐字节对照基准
// ============================================================
// 本批是纯重构：所有「取会话历史」的读取点改为经由 modules/ai-sessions/session-history
// 那一个函数，存储侧仍是 ai_sessions.messages（jsonb 快照），行为必须逐字节不变。
//
// 本文件是这道「不变」的**确定性**证据：不连库、断言无条件执行，样本全部合成，
// 因此在 CI 的空测试库里同样成立。真实存量数据上的同一对照由
// scripts/session-history-derive-parity.ts 另取一次证据（本地开发库 100 条，逐条），
// 两者互补：
//  · 本文件锁形状（含空历史、system/tool 角色、悬挂附件引用、窗口边界、判据形状异常）；
//  · 脚本锁实存（存量数据没被弄坏）。
// 之所以不能只靠脚本：开发库 100 条会话里 84 条 messages 为空数组，
// 「100 条全一致」对空数组样本几乎没有判别力——必须另有合成边界样本兜底。
//
// 反循环约束（架构侧 2026-09-06 确认）：下方 LEGACY_* 是**改造前代码的原样冻结副本**，
// 只读 session 对象自身字段，绝不 import 被改函数；否则比较退化为自己等于自己。
// 同理 workbench-request-invariant 的整形第二实现不入缝——两边同源则不变式永真。
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";

import { deriveSessionMessages } from "./session-history";
import { summarizeSessionForAdminAudit } from "./ai-sessions.usecase";
import type { AdminAiSessionSummary } from "./ai-sessions.usecase";
import { asString } from "../../utils/helpers";
import type {
  AiArtifact,
  AiAttachment,
  AiMessage,
  AiSessionRecord,
} from "./ai-sessions.types";
import {
  WORKBENCH_MODEL_HISTORY_WINDOW,
  buildHomeMessageContentForModel,
  sessionRecordToHomeMessages,
} from "../../services/ai/handlers/workbench-shared";
import type { HomeMessageInput } from "../../services/ai/handlers/workbench-shared";
import { hasOngoingWorkbenchToolInteraction } from "../../services/ai/workbench-intent.service";
import { deriveWorkbenchModelHistoryFromSession } from "../../services/ai/workbench-request-invariant";

// ============================================================
// LEGACY 冻结副本（改造前逐字照抄，勿改）
// ============================================================

/** 旧路径 1：workbench-shared.ts:295-308 原样冻结 */
function legacySessionRecordToHomeMessages(session: AiSessionRecord | null | undefined): HomeMessageInput[] {
  if (!session || !Array.isArray(session.messages)) return [];
  const attachmentsById = new Map((Array.isArray(session.attachments) ? session.attachments : []).map((attachment) => [attachment.attachmentId, attachment]));
  return session.messages
    .filter((message) => (message.role === "user" || message.role === "assistant") && asString(message.content))
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: message.content,
      attachments: (message.attachmentIds ?? [])
        .map((id) => attachmentsById.get(id))
        .filter((attachment): attachment is NonNullable<typeof attachment> => Boolean(attachment))
        .map((attachment) => ({ name: attachment.name, size: attachment.size, type: attachment.type, parsedSummary: attachment.parsedSummary })),
    }));
}

/** 旧路径 2：workbench-request-invariant 存储侧整形（与 LEGACY 2 串起来即改造前完整推导） */
function legacyModelHistory(session: AiSessionRecord | null | undefined, userContent: string) {
  const storedHistory = legacySessionRecordToHomeMessages(session);
  const shaped = storedHistory
    .slice(-WORKBENCH_MODEL_HISTORY_WINDOW)
    .map((message) => ({ role: message.role, content: buildHomeMessageContentForModel(message) }));
  if (shaped.length > 0) shaped[shaped.length - 1] = { role: "user", content: userContent };
  else shaped.push({ role: "user", content: userContent });
  return shaped;
}

const ADMIN_AUDIT_TEXT_MAX = 120;

/** 旧路径 3：ai-sessions.usecase.ts:185-206 原样冻结（含 truncateAuditText） */
function legacyTruncateAuditText(value: unknown, max = ADMIN_AUDIT_TEXT_MAX): string {
  const text = asString(value).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function legacyAdminSummary(session: AiSessionRecord): AdminAiSessionSummary {
  const firstUserMessage = session.messages.find((message) => message.role === "user");
  const lastAssistantMessage = [...session.messages].reverse().find((message) => message.role === "assistant");
  return {
    sessionId: session.sessionId,
    title: session.title,
    ownerUserId: session.ownerUserId,
    ownerUsername: session.ownerUsername,
    businessRole: asString(session.businessRole),
    domain: session.domain,
    workflowKey: session.workflowKey,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    turnCount: session.messages.filter((message) => message.role === "user").length,
    attachmentCount: session.attachments.length,
    artifactCount: session.artifacts.length,
    firstUserMessage: legacyTruncateAuditText(firstUserMessage?.content),
    lastAssistantMessage: legacyTruncateAuditText(lastAssistantMessage?.content),
  };
}

/** 旧路径 4：workbench-view.usecase.ts:242 的计数表达式原样冻结 */
function legacyViewMessageCount(session: AiSessionRecord): number {
  return session.messages?.length ?? 0;
}

// ============================================================
// 合成样本
// ============================================================

function makeMessage(overrides: Partial<AiMessage> & { content: string }): AiMessage {
  return {
    messageId: overrides.messageId ?? `msg-${overrides.content.slice(0, 8)}`,
    role: overrides.role ?? "user",
    content: overrides.content,
    createdAt: overrides.createdAt ?? "2026-09-01T00:00:00.000Z",
    ...(overrides.attachmentIds ? { attachmentIds: overrides.attachmentIds } : {}),
    ...(overrides.artifactIds ? { artifactIds: overrides.artifactIds } : {}),
    ...(overrides.metadata ? { metadata: overrides.metadata } : {}),
  };
}

function makeSession(
  overrides: Omit<Partial<AiSessionRecord>, "messages"> & { messages?: unknown },
): AiSessionRecord {
  const base: AiSessionRecord = {
    sessionId: "sess-parity-001",
    ownerUserId: "user-1",
    ownerUsername: "tester",
    title: "对照会话",
    domain: "business_evaluation",
    workflowKey: "free_chat",
    businessRole: "pre_sales",
    status: "temporary_chat",
    summary: "",
    messages: [],
    attachments: [],
    artifacts: [],
    pendingActions: [],
    linkedRecords: {},
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
  return { ...base, ...overrides } as AiSessionRecord;
}

const attachment = (overrides: Partial<AiAttachment> & { attachmentId: string }): AiAttachment => ({
  name: overrides.name ?? `附件-${overrides.attachmentId}.xlsx`,
  createdAt: "2026-09-01T00:00:00.000Z",
  ...overrides,
});

const sampleAttachments: AiAttachment[] = [
  attachment({ attachmentId: "att-1", size: 1024, type: "application/xlsx", parsedSummary: "客户：深圳蓝海集团\n行业：综合集团" }),
  attachment({ attachmentId: "att-2" }),
  attachment({ attachmentId: "att-3", name: "无解析摘要.pdf", type: "application/pdf" }),
];

const multiTurn: AiMessage[] = [
  makeMessage({ content: "帮我解析客户需求材料", attachmentIds: ["att-1"] }),
  makeMessage({ content: "已识别为售前需求解析任务。", role: "assistant", artifactIds: ["art-1"] }),
  makeMessage({ content: "继续补充风险", attachmentIds: ["att-2", "att-3"] }),
  makeMessage({ content: "风险：口径未确认。", role: "assistant" }),
];

const toolTraceMessages: AiMessage[] = [
  makeMessage({ content: "创建项目" }),
  makeMessage({
    content: "已创建。",
    role: "assistant",
    metadata: { toolCalls: [{ name: "create_project", source: "model" }] },
  }),
];

const noToolTraceMessages: AiMessage[] = [
  makeMessage({ content: "你好" }),
  makeMessage({ content: "你好，需要什么帮助？", role: "assistant" }),
];

const withSystemAndTool: AiMessage[] = [
  makeMessage({ content: "系统上下文", role: "system" }),
  makeMessage({ content: "" , role: "user" }),
  makeMessage({ content: "工具返回", role: "tool" }),
  makeMessage({ content: "正文为空", role: "assistant", metadata: { formBlock: { blockId: "clarify-project" } } }),
  makeMessage({ content: "带附件的提问", attachmentIds: ["att-1", "att-missing", "att-1"] }),
  makeMessage({ content: "回答", role: "assistant" }),
];

const longHistory: AiMessage[] = Array.from({ length: 25 }, (_, index) =>
  makeMessage({
    content: `第 ${index + 1} 轮正文`,
    role: index % 2 === 0 ? "user" : "assistant",
    messageId: `msg-long-${index}`,
  }),
);

const artifact: AiArtifact = {
  artifactId: "art-1",
  type: "note",
  title: "需求包",
  content: { modules: ["财务云"] },
  status: "generated",
  createdAt: "2026-09-01T00:00:00.000Z",
};

// 逐字节对照用样本集：名称 → 会话记录
const SAMPLES: Array<[string, AiSessionRecord | null | undefined]> = [
  ["空历史", makeSession({ messages: [] })],
  ["典型多轮", makeSession({ messages: multiTurn, attachments: sampleAttachments, artifacts: [artifact] })],
  ["含 system/tool/空正文 + 悬挂与重复附件引用", makeSession({ sessionId: "sess-parity-002", messages: withSystemAndTool, attachments: sampleAttachments })],
  ["超过模型窗口", makeSession({ sessionId: "sess-parity-003", messages: longHistory })],
  ["工具痕迹会话", makeSession({ sessionId: "sess-parity-004", messages: toolTraceMessages })],
  ["无工具痕迹会话", makeSession({ sessionId: "sess-parity-005", messages: noToolTraceMessages })],
  ["末条为 assistant", makeSession({ sessionId: "sess-parity-006", messages: noToolTraceMessages, attachments: sampleAttachments })],
  ["无附件数组", makeSession({ sessionId: "sess-parity-007", messages: multiTurn, attachments: undefined as unknown as AiAttachment[] })],
  ["null 会话", null],
  ["undefined 会话", undefined],
];

/** JSON.stringify 后严格相等（本批的过线判据即「逐字节」，不用 deepEqual 以免放过键序差异） */
function assertByteIdentical(label: string, legacy: unknown, derived: unknown): void {
  assert.equal(JSON.stringify(derived), JSON.stringify(legacy), `${label}：派生缝输出与改造前不一致`);
}

// ============================================================
// ① 原始历史序列
// ============================================================

test("批次2a·缝：原始历史序列与改造前直读 session.messages 逐字节相同", () => {
  for (const [name, session] of SAMPLES) {
    const derived = deriveSessionMessages(session);
    if (!session) {
      // 改造前各消费端对空会话的前置守卫（workbench-shared.ts:296 首行）等价于空历史
      assertByteIdentical(`${name} → 空历史`, [], derived);
      continue;
    }
    assertByteIdentical(`${name} → 原始历史`, session.messages, derived);
  }
});

test("批次2a·缝：返回新数组，改不动存储侧记录", () => {
  const session = makeSession({ messages: multiTurn });
  const derived = deriveSessionMessages(session);
  assert.notEqual(derived, session.messages, "缝必须返回自己的数组，不得把存储侧数组引用外泄给消费端");
  assert.equal(session.messages.length, 4);
});

test("批次2a·缝：messages 非数组时归一为空历史（并钉死这种形状下与旧口径的唯一分歧）", () => {
  // 形状前提：ai_sessions.messages 为 NOT NULL DEFAULT '[]'::jsonb
  // （db/schema/json_runtime.ts:213），且仓储 row→record 已 `?? []`
  // （ai-sessions-pg.repository.ts:80）——非数组无可达写入路径。
  // 本用例不是宣称二者一致，而是把「万一出现非数组」时新旧各自的行为钉成可查的账：
  // 对照脚本每次实取全库 jsonb_typeof 非 array 的行数并打印（应为 0）。
  const BROKEN: Array<[unknown, string]> = [
    [null, "null"],
    [undefined, "undefined"],
    [{}, "object"],
    [42, "number"],
    ["x", "string"],
  ];
  for (const [broken, label] of BROKEN) {
    const session = makeSession({ messages: broken });
    const derived = deriveSessionMessages(session);
    assert.deepEqual(derived, [], `messages=${label} 应派生为空历史`);

    // ① 模型历史整形：旧实现本就带 `!Array.isArray → []` 守卫，与缝逐字节一致
    assertByteIdentical(
      `messages=${label} → 模型历史整形`,
      legacySessionRecordToHomeMessages(session as AiSessionRecord),
      sessionRecordToHomeMessages(session),
    );

    // ② 视图计数：旧口径是 `session.messages?.length ?? 0`，对 JSON 字符串
    //    会取到字符长度（把「3 个字符」当成「3 条消息」）——这是本批**唯一**
    //    观察到的行为差异，登记为 F-2a-1，仅在非数组行上成立。
    const legacyCount = legacyViewMessageCount(session);
    if (label === "string") {
      assert.equal(legacyCount, 1, "旧口径：'x'.length === 1（字符数被当成消息数）");
      assert.equal(derived.length, 0, "改道后：非数组一律空历史");
    } else {
      assertByteIdentical(`messages=${label} → 视图计数`, legacyCount, derived.length);
    }

    // ③ 管理员审计：旧表达式（`session.messages.find(...)`）在这种行上直接抛
    //    TypeError，改道后不抛——同属 F-2a-1 的不可达形状。
    assert.throws(() => legacyAdminSummary(session as AiSessionRecord), TypeError);
    assert.doesNotThrow(() => summarizeSessionForAdminAudit(session as AiSessionRecord));
  }
});

// ============================================================
// ② 模型历史整形（sessionRecordToHomeMessages）
// ============================================================

test("批次2a·整形：sessionRecordToHomeMessages 改道后与冻结旧实现逐字节相同", () => {
  for (const [name, session] of SAMPLES) {
    assertByteIdentical(
      `${name} → HomeMessageInput[]`,
      legacySessionRecordToHomeMessages(session),
      sessionRecordToHomeMessages(session),
    );
  }
});

// ============================================================
// ③ 模型请求窗口（含不变式模块的存储侧推导）
// ============================================================

test("批次2a·窗口：发给模型的历史窗口与改造前逐字节相同", () => {
  const userContent = "本轮用户正文：客户名称深圳蓝海集团";
  for (const [name, session] of SAMPLES) {
    assertByteIdentical(
      `${name} → 模型请求窗口`,
      legacyModelHistory(session, userContent),
      deriveWorkbenchModelHistoryFromSession({ session, userContent }),
    );
  }
});

// ============================================================
// ④ 进行中工具交互判据（批次 1c 的数据源）
// ============================================================

test("批次2a·判据：经缝取历史后的「进行中工具交互」判定与直读逐字节相同", () => {
  const CASES: Array<[string, AiMessage[]]> = [
    ["有工具痕迹", toolTraceMessages],
    ["无工具痕迹", noToolTraceMessages],
    ["空历史", []],
    ["末条非 assistant", [...noToolTraceMessages, makeMessage({ content: "补充：行业=综合集团" })]],
    ["工具痕迹为空数组", [makeMessage({ content: "q" }), makeMessage({ content: "a", role: "assistant", metadata: { toolCalls: [] } })]],
    ["工具痕迹形状异常", [makeMessage({ content: "q" }), makeMessage({ content: "a", role: "assistant", metadata: { toolCalls: "not-an-array" } })]],
    ["多条 assistant 取最近一条", [
      makeMessage({ content: "a1", role: "assistant", metadata: { toolCalls: [{ name: "x" }] } }),
      makeMessage({ content: "q2" }),
      makeMessage({ content: "a2", role: "assistant" }),
    ]],
  ];
  for (const [name, messages] of CASES) {
    const session = makeSession({ messages });
    assertByteIdentical(
      `${name} → 判据`,
      hasOngoingWorkbenchToolInteraction(session.messages),
      hasOngoingWorkbenchToolInteraction(deriveSessionMessages(session)),
    );
  }
});

// ============================================================
// ⑤ 管理员审计摘要（ai-sessions.usecase 消费端）
// ============================================================

test("批次2a·审计：管理员摘要各字段与冻结旧实现逐字节相同", () => {
  const withLongContent = makeSession({
    sessionId: "sess-parity-008",
    messages: [
      makeMessage({ content: "长".repeat(200) }),
      makeMessage({ content: "尾部".repeat(80), role: "assistant" }),
    ],
  });
  const whitespace = makeSession({
    sessionId: "sess-parity-009",
    messages: [makeMessage({ content: "  多行\n\n正文  " }), makeMessage({ content: "答复", role: "assistant" })],
    attachments: sampleAttachments,
    artifacts: [artifact],
  });
  // 审计摘要除历史外还直读 attachments/artifacts 的条数，故本层只对照
  // 「记录齐形」的样本（仓储映射恒给 `?? []`，非数组同样属 F-2a-1 的不可达形状）。
  const wellFormed = SAMPLES.filter(
    (entry): entry is [string, AiSessionRecord] =>
      Boolean(entry[1]) && Array.isArray(entry[1]!.attachments) && Array.isArray(entry[1]!.artifacts),
  );
  const extra: Array<[string, AiSessionRecord]> = [["超长正文截断", withLongContent], ["空白折叠", whitespace]];
  for (const [name, session] of [...wellFormed, ...extra]) {
    assertByteIdentical(
      `${name} → 审计摘要`,
      legacyAdminSummary(session),
      summarizeSessionForAdminAudit(session),
    );
  }
});

test("批次2a·审计：摘要计数口径未随改道漂移（messageCount 含 system/tool，turnCount 只数 user）", () => {
  // 锁住一个非显然事实：两个计数不是同一个分母——含 system/tool 的历史里必然不等。
  // 改道若顺手把「过滤后的模型历史」当成 messageCount，本断言即红。
  const session = makeSession({ messages: withSystemAndTool });
  const summary = summarizeSessionForAdminAudit(session);
  assert.equal(summary.messageCount, withSystemAndTool.length);
  assert.equal(summary.turnCount, withSystemAndTool.filter((m) => m.role === "user").length);
});
