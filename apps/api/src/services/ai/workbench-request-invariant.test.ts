import test from "node:test";
import assert from "node:assert/strict";

import {
  WorkbenchModelRequestInvariantError,
  assertWorkbenchModelRequestMatchesStorage,
  deriveWorkbenchModelHistoryFromSession,
  deriveWorkbenchModelHistoryFromStoredHistory,
} from "./workbench-request-invariant";
import {
  WORKBENCH_MODEL_HISTORY_WINDOW,
  buildWorkbenchChatModelInput,
  sessionRecordToHomeMessages,
} from "./handlers/workbench-shared";
import type { AiSessionRecord } from "../../modules/ai-sessions/ai-sessions.types";
import type { HomeMessageInput, WorkbenchModelMessage } from "./handlers/workbench-shared";
import type { AuthUser } from "../../types";

// ============================================================
// 批次 0 · ⑤ 弱请求重构不变量
// ============================================================
// 通过判据（工单原文）：故意构造一个「发送与存储不一致」→ 断言红；恢复 → 绿。
// 本文件把该判据固化为回归资产：每个红用例都对应一类真实失效形态，
// 其中「历史取早」与「历史被丢掉」就是 DEF-2026-08-27-001 的两层根因。
// 绿用例走【生产组装函数】buildWorkbenchChatModelInput，而不是手搓数组，
// 保证对账断言与真实请求构造点同源同形。
// ============================================================

const agentUser: AuthUser = {
  id: "u-invariant",
  username: "invariant",
  role: "user",
  status: "active",
  passwordHash: "",
  createdAt: "",
  lastLoginAt: "",
};

/** 夹住一次抛错并返回错误对象（node:assert 的 assert.throws 不返回错误）。 */
function captureError(fn: () => void): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return null;
}

function homeMessage(role: "user" | "assistant", content: string, attachments: HomeMessageInput["attachments"] = []): HomeMessageInput {
  return { role, content, attachments };
}

function sessionRecord(messages: Array<{ role: string; content: string; attachmentIds?: string[] }>, attachments: AiSessionRecord["attachments"] = []): AiSessionRecord {
  return {
    sessionId: "session-invariant",
    ownerUserId: agentUser.id,
    ownerUsername: agentUser.username,
    title: "⑤ 不变量夹具",
    domain: "business_evaluation",
    workflowKey: "free_chat",
    businessRole: "pre_sales",
    status: "temporary_chat",
    summary: "",
    messages: messages.map((message, index) => ({
      messageId: `m-${index}`,
      role: message.role as AiSessionRecord["messages"][number]["role"],
      content: message.content,
      createdAt: "",
      ...(message.attachmentIds ? { attachmentIds: message.attachmentIds } : {}),
    })),
    attachments,
    artifacts: [],
    pendingActions: [],
    linkedRecords: {},
    createdAt: "",
    updatedAt: "",
  } as AiSessionRecord;
}

/** 生产请求构造点：与 harness-boot.modelChatStream 完全同一入参形状。 */
async function buildSentFromHistory(
  history: HomeMessageInput[] | undefined,
  userContent: string,
): Promise<WorkbenchModelMessage[]> {
  const modelInput = await buildWorkbenchChatModelInput(agentUser, {
    systemPrompt: "你是售前顾问的 AI 工作助手。",
    userContent,
    ...(history ? { messages: history } : {}),
  });
  return modelInput.messages;
}

const ROUND1_USER = "客户希望提升订单处理效率";
const ROUND1_ASSISTANT = "明白，目标尚未量化。";
const ROUND2_USER = "那还缺什么？请直接复述上一轮我说过的内容";

/** 存储侧：本轮用户正文已幂等落库（生产顺序 = 先写后取历史）。 */
const storedAfterUserWrite = sessionRecord([
  { role: "user", content: ROUND1_USER },
  { role: "assistant", content: ROUND1_ASSISTANT },
  { role: "user", content: ROUND2_USER },
]);

// ------------------------------------------------------------
// 绿：正常路径必须通过，否则本批等于自杀式断言
// ------------------------------------------------------------

test("⑤绿：发送侧与存储侧一致（本轮正文已落库后再取历史）→ 断言通过", async () => {
  const sent = await buildSentFromHistory(sessionRecordToHomeMessages(storedAfterUserWrite), ROUND2_USER);

  assertWorkbenchModelRequestMatchesStorage({ sent, session: storedAfterUserWrite, userContent: ROUND2_USER });
  // 夹逼确认：断言确实收到了多轮历史，而不是在一条空数组上自娱自乐
  assert.equal(sent.length, 4);
});

test("⑤绿：首轮会话（存储为空）→ 只含 system + 本轮正文", async () => {
  const firstTurn = sessionRecord([{ role: "user", content: ROUND1_USER }]);
  const sent = await buildSentFromHistory(sessionRecordToHomeMessages(firstTurn), ROUND1_USER);

  assertWorkbenchModelRequestMatchesStorage({ sent, session: firstTurn, userContent: ROUND1_USER });
  assert.deepEqual(sent, [
    { role: "system", content: "你是售前顾问的 AI 工作助手。" },
    { role: "user", content: ROUND1_USER },
  ]);
});

test("⑤绿：system prompt 不进入对账（记忆块等头部差异合法）", async () => {
  const history = sessionRecordToHomeMessages(storedAfterUserWrite);
  const sent = await buildSentFromHistory(history, ROUND2_USER);
  const withMemoryBlock: WorkbenchModelMessage[] = [
    { role: "system", content: `${sent[0].content}\n\n【记忆】客户偏好：制造业` },
    ...sent.slice(1),
  ];

  assertWorkbenchModelRequestMatchesStorage({ sent: withMemoryBlock, session: storedAfterUserWrite, userContent: ROUND2_USER });
});

// ------------------------------------------------------------
// 红 · DEF-2026-08-27-001 两层根因复现
// ------------------------------------------------------------

test("⑤红：历史在中间管道被丢掉 → history_length_mismatch", async () => {
  // 第一层根因形态：dispatchInput 补了历史，modelChatStream 却没接（messages 缺省）
  const sent = await buildSentFromHistory(undefined, ROUND2_USER);

  assert.throws(
    () => assertWorkbenchModelRequestMatchesStorage({ sent, session: storedAfterUserWrite, userContent: ROUND2_USER }),
    (err: unknown) => {
      assert.ok(err instanceof WorkbenchModelRequestInvariantError, `必须抛不变量错误，实际 ${String(err)}`);
      assert.equal(err.reason, "history_length_mismatch: sent=1 expected=3");
      return true;
    },
  );
});

test("⑤红：历史取早了（本轮正文落库前读取）→ 上一轮 assistant 被覆盖丢失", async () => {
  // 第二层根因形态：workflow 在 appendSessionMessage 之前读会话，
  // 于是历史末条仍是上一轮 assistant，被「覆盖末条为本轮正文」吃掉一条。
  const storedBeforeUserWrite = sessionRecord([
    { role: "user", content: ROUND1_USER },
    { role: "assistant", content: ROUND1_ASSISTANT },
  ]);
  const sent = await buildSentFromHistory(sessionRecordToHomeMessages(storedBeforeUserWrite), ROUND2_USER);

  assert.throws(
    () => assertWorkbenchModelRequestMatchesStorage({ sent, session: storedAfterUserWrite, userContent: ROUND2_USER }),
    (err: unknown) => {
      assert.ok(err instanceof WorkbenchModelRequestInvariantError);
      assert.equal(err.reason, "history_length_mismatch: sent=2 expected=3");
      return true;
    },
  );
});

// ------------------------------------------------------------
// 红 · 口径漂移（刻意保留第二实现的唯一理由）
// ------------------------------------------------------------

test("⑤红：历史窗口口径漂移（一处改常量另一处没改）→ 当场红", async () => {
  const many: HomeMessageInput[] = [];
  for (let i = 0; i < WORKBENCH_MODEL_HISTORY_WINDOW + 2; i += 1) {
    many.push(homeMessage(i % 2 === 0 ? "user" : "assistant", `第 ${i} 轮`));
  }
  const session = sessionRecord(many.map((m) => ({ role: m.role, content: m.content })));
  // 发送侧多带一条（模拟 buildWorkbenchChatModelInput 的窗口被单方面放大）
  const sent: WorkbenchModelMessage[] = [
    { role: "system", content: "你是售前顾问的 AI 工作助手。" },
    ...many.slice(-(WORKBENCH_MODEL_HISTORY_WINDOW + 1)).map((m) => ({ role: m.role, content: m.content })),
  ];

  assert.throws(
    () => assertWorkbenchModelRequestMatchesStorage({ sent, session, userContent: many[many.length - 1].content }),
    (err: unknown) => {
      assert.ok(err instanceof WorkbenchModelRequestInvariantError);
      assert.match(err.reason, /^history_length_mismatch: sent=13 expected=12$/);
      return true;
    },
  );
  // 两侧同口径时窗口必然收敛到同一条数
  assert.equal(deriveWorkbenchModelHistoryFromStoredHistory({ storedHistory: many, userContent: "末轮" }).length, WORKBENCH_MODEL_HISTORY_WINDOW);
  assert.equal(deriveWorkbenchModelHistoryFromSession({ session, userContent: many[many.length - 1].content }).length, WORKBENCH_MODEL_HISTORY_WINDOW);
});

test("⑤红：附件解析上下文丢失（角色/条数都对，正文不等）→ history_content_mismatch", async () => {
  const session = sessionRecord(
    [
      { role: "user", content: "看下这份需求清单", attachmentIds: ["att-1"] },
      { role: "assistant", content: "已读到 12 条需求。" },
      { role: "user", content: "其中哪些是二期？" },
    ],
    [{ attachmentId: "att-1", name: "需求清单.xlsx", createdAt: "", parsedSummary: "12 条需求，含订单处理" }],
  );
  const fullHistory = sessionRecordToHomeMessages(session);
  // 发送侧把附件拍平成纯文本（attachmentIds 未解析），条数与角色序列不变
  const flattened: HomeMessageInput[] = fullHistory.map((m) => homeMessage(m.role, m.content));
  assert.equal(flattened.length, fullHistory.length);
  const sent = await buildSentFromHistory(flattened, "其中哪些是二期？");

  assert.throws(
    () => assertWorkbenchModelRequestMatchesStorage({ sent, session, userContent: "其中哪些是二期？" }),
    (err: unknown) => {
      assert.ok(err instanceof WorkbenchModelRequestInvariantError);
      assert.equal(err.reason, "history_content_mismatch: index=0");
      return true;
    },
  );
});

test("⑤红：角色序列被改写 → history_role_mismatch", async () => {
  const sent = await buildSentFromHistory(sessionRecordToHomeMessages(storedAfterUserWrite), ROUND2_USER);
  const tampered: WorkbenchModelMessage[] = sent.map((m, i) => (i === 2 ? { role: "user", content: m.content } : m));

  assert.throws(
    () => assertWorkbenchModelRequestMatchesStorage({ sent: tampered, session: storedAfterUserWrite, userContent: ROUND2_USER }),
    (err: unknown) => {
      assert.ok(err instanceof WorkbenchModelRequestInvariantError);
      assert.equal(err.reason, "history_role_mismatch: index=1 sent=user expected=assistant");
      return true;
    },
  );
});

// ------------------------------------------------------------
// 红 · 结构性前置检查 + 诊断脱敏
// ------------------------------------------------------------

test("⑤红：空 messages / system 不在头部 / system 出现在中间", async () => {
  assert.throws(
    () => assertWorkbenchModelRequestMatchesStorage({ sent: [], session: storedAfterUserWrite, userContent: ROUND2_USER }),
    (err: unknown) => err instanceof WorkbenchModelRequestInvariantError && err.reason === "sent_messages_empty",
  );

  assert.throws(
    () =>
      assertWorkbenchModelRequestMatchesStorage({
        sent: [{ role: "user", content: ROUND2_USER }],
        session: null,
        userContent: ROUND2_USER,
      }),
    (err: unknown) => err instanceof WorkbenchModelRequestInvariantError && err.reason === "system_prompt_not_first",
  );

  assert.throws(
    () =>
      assertWorkbenchModelRequestMatchesStorage({
        sent: [
          { role: "system", content: "S" },
          { role: "system", content: "S2" },
          { role: "user", content: ROUND2_USER },
        ],
        session: null,
        userContent: ROUND2_USER,
      }),
    (err: unknown) => err instanceof WorkbenchModelRequestInvariantError && err.reason === "system_prompt_not_only_head: index=1",
  );
});

test("⑤诊断脱敏：错误原因只报结构差异，不得回传客户端需求原文", async () => {
  const secretHistory = sessionRecord([
    { role: "user", content: "客户预算 380 万，联系人张总手机 13800000000" },
    { role: "assistant", content: "记下了。" },
    { role: "user", content: "二期什么时候启动？" },
  ]);
  const sent = await buildSentFromHistory(undefined, "二期什么时候启动？");

  const err = captureError(() =>
    assertWorkbenchModelRequestMatchesStorage({ sent, session: secretHistory, userContent: "二期什么时候启动？" }),
  );

  assert.ok(err instanceof WorkbenchModelRequestInvariantError, `必须抛不变量错误，实际 ${String(err)}`);
  for (const leak of ["380 万", "13800000000", "客户预算", "记下了", "二期什么时候启动"]) {
    assert.ok(!err.message.includes(leak), `诊断不得携带正文片段：${leak}`);
  }
});

/**
 * 工单通过判据的字面固化：同一夹具下，先构造发送-vs-存储不一致（红），
 * 再恢复成一致（绿）。红/绿各断一次，避免只留下其中一半。
 */
test("⑤红→绿：同一夹具构造不一致即红、恢复即绿", async () => {
  const history = sessionRecordToHomeMessages(storedAfterUserWrite);

  const broken = await buildSentFromHistory(history.slice(0, 1), ROUND2_USER);
  const red = captureError(() =>
    assertWorkbenchModelRequestMatchesStorage({ sent: broken, session: storedAfterUserWrite, userContent: ROUND2_USER }),
  );
  assert.ok(red instanceof WorkbenchModelRequestInvariantError, "构造不一致必须当场抛错");
  assert.equal(red.reason, "history_length_mismatch: sent=1 expected=3");

  const restored = await buildSentFromHistory(history, ROUND2_USER);
  assertWorkbenchModelRequestMatchesStorage({ sent: restored, session: storedAfterUserWrite, userContent: ROUND2_USER });
});
